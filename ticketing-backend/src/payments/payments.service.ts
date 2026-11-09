import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { Payment, PaymentDocument } from './payment.schema';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { TicketsService } from '../tickets/tickets.service';
import { EventsService } from '../events/events.service';
import { RequestUser } from '../auth/guards/user-type.guard';
import { UserType } from '../users/enums/user-type.enum';
import {
  EarlyBirdSoldOutException,
  InvalidTicketTypeException,
  PastEventException,
  SeatUnavailableException,
} from '../common/exceptions/custom-exceptions';

const MAX_SEATS_PER_PURCHASE = 10;

type SeatSelection = { sectionId: string; seatId: string };

@Injectable()
export class PaymentsService {
  private stripe: Stripe;
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    private ticketsService: TicketsService,
    private eventsService: EventsService,
  ) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-12-15.clover',
    });
  }

  async createCheckoutSession(userId: string, dto: CreateCheckoutSessionDto) {
    try {
      // Log raw DTO to see what's being received
      this.logger.debug('RAW DTO received from frontend:', {
        dtoType: typeof dto,
        dtoKeys: Object.keys(dto),
        ticketIdsType: typeof dto.ticketIds,
        ticketIdsIsArray: Array.isArray(dto.ticketIds),
        ticketIdsLength: Array.isArray(dto.ticketIds)
          ? dto.ticketIds.length
          : 'N/A',
        ticketIdsValue: JSON.stringify(dto.ticketIds),
        firstItemType:
          Array.isArray(dto.ticketIds) && dto.ticketIds[0]
            ? typeof dto.ticketIds[0]
            : 'N/A',
        firstItem:
          Array.isArray(dto.ticketIds) && dto.ticketIds[0]
            ? JSON.stringify(dto.ticketIds[0])
            : 'N/A',
      });

      const {
        eventId,
        buyerEmail,
        buyerName,
        buyerPhoneNumber,
        successUrl,
        cancelUrl,
      } = dto;
      const ticketType = dto.ticketType || 'Standard';

      // Validate input
      if (!userId || !eventId || !dto.ticketIds?.length) {
        throw new BadRequestException('Invalid checkout session parameters');
      }

      // dto.totalAmount is client-supplied and deliberately ignored
      const { ticketIds, amountInCents } = await this.resolvePurchase(
        eventId,
        ticketType,
        dto.ticketIds,
      );

      if (amountInCents <= 0) {
        throw new BadRequestException(
          'This purchase is free. Use /payments/create-free-ticket instead.',
        );
      }

      // Create Stripe Payment Intent
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: amountInCents,
        currency: 'usd',
        metadata: {
          userId,
          eventId,
          ticketIds: JSON.stringify(ticketIds),
        },
      });

      // For guest users (userId starts with 'guest-'), store as string
      // For authenticated users, convert to ObjectId
      let userIdValue: any;
      try {
        userIdValue = new Types.ObjectId(userId);
      } catch {
        // If not a valid ObjectId, use the string directly (guest user)
        userIdValue = userId;
      }

      // Transform ticketIds for storage
      // If it's 'auto-assigned', convert to proper format
      this.logger.log('CHECKPOINT: ticketIds RECEIVED from frontend:', {
        ticketIds,
        type: typeof ticketIds,
        isArray: Array.isArray(ticketIds),
        length: Array.isArray(ticketIds) ? ticketIds.length : 'N/A',
        stringified: JSON.stringify(ticketIds),
      });

      let processedTicketIds = ticketIds;
      if (ticketIds.length === 1 && ticketIds[0] === 'auto-assigned') {
        // For events without seating, store a placeholder
        processedTicketIds = [
          { sectionId: 'general', seatId: 'auto-assigned' },
        ];
      }

      this.logger.log('CHECKPOINT: ticketIds AFTER PROCESSING:', {
        processedTicketIds,
        stringified: JSON.stringify(processedTicketIds),
      });

      const payment = new this.paymentModel({
        userId: userIdValue,
        eventId: new Types.ObjectId(eventId),
        ticketIds: processedTicketIds,
        amount: amountInCents,
        currency: 'usd',
        stripePaymentIntentId: paymentIntent.id,
        status: 'pending',
        metadata: {
          buyerEmail,
          buyerName,
          buyerPhoneNumber,
          ticketType,
          successUrl,
          cancelUrl,
        },
      });

      await payment.save();

      this.logger.log('CHECKPOINT: Payment SAVED to DB:', {
        paymentId: payment._id.toString(),
        storedTicketIds: JSON.stringify(payment.ticketIds),
      });

      return {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: amountInCents,
      };
    } catch (error) {
      this.logger.error('Error creating checkout session:', error);
      throw error;
    }
  }

  async handlePaymentSuccess(paymentIntentId: string) {
    try {
      const payment = await this.paymentModel.findOne({
        stripePaymentIntentId: paymentIntentId,
      });

      if (!payment) {
        throw new NotFoundException('Payment not found');
      }

      // IDEMPOTENCY CHECK: If payment already succeeded and tickets were created, don't process again
      if (payment.status === 'succeeded') {
        this.logger.log(
          `Payment ${paymentIntentId} already processed, skipping duplicate webhook`,
        );
        // Check if tickets already exist for this payment
        const existingTickets = await this.ticketsService.getTicketsByPaymentId(
          payment._id.toString(),
        );
        return { payment, createdTickets: existingTickets || [] };
      }

      // Update payment status first
      payment.status = 'succeeded';
      payment.paidAt = new Date();
      await payment.save();

      this.logger.log(`Payment ${paymentIntentId} marked as succeeded`);

      // NOW create tickets after payment succeeds
      // Extract ticket creation data from payment metadata
      const ticketCreationData = payment.metadata || {};

      try {
        // Properly deserialize ticketIds from MongoDB - handle mixed types
        let parsedTicketIds: any[] = [];
        const event = await this.eventsService.findById(
          payment.eventId.toString(),
        );
        const isSeatingEvent = event?.seatingLayout?.enabled;

        this.logger.log('RAW payment.ticketIds from DB:', {
          type: typeof payment.ticketIds,
          isArray: Array.isArray(payment.ticketIds),
          value: JSON.stringify(payment.ticketIds),
          length: Array.isArray(payment.ticketIds)
            ? payment.ticketIds.length
            : 'N/A',
          isSeatingEvent,
        });

        if (Array.isArray(payment.ticketIds) && payment.ticketIds.length > 0) {
          // Convert Mongoose document to plain object and filter based on event type
          parsedTicketIds = payment.ticketIds
            .map((item: any, index: number) => {
              const converted =
                item && typeof item === 'object' && item.toObject
                  ? item.toObject()
                  : item;
              this.logger.log(`Processing ticketId[${index}]:`, {
                original: JSON.stringify(item),
                converted: JSON.stringify(converted),
                type: typeof item,
                hasToObject: item && typeof item.toObject === 'function',
              });
              return converted;
            })
            .filter((item: any) => {
              // For seating events: only keep valid seat objects with sectionId and seatId
              if (isSeatingEvent) {
                if (
                  item &&
                  typeof item === 'object' &&
                  item.sectionId &&
                  item.seatId
                ) {
                  return true;
                }
                return false;
              }
              // For non-seating events: keep auto-assigned or treat empty arrays as auto-assigned
              if (typeof item === 'string' && item === 'auto-assigned')
                return true;
              if (Array.isArray(item)) return true; // Keep arrays for counting purposes
              return false;
            });
        } else if (!isSeatingEvent) {
          // Non-seating event with no tickets - default to single auto-assigned
          parsedTicketIds = ['auto-assigned'];
        }

        this.logger.log('FINAL PARSED ticketIds after filtering:', {
          count: parsedTicketIds.length,
          data: JSON.stringify(parsedTicketIds),
          eachItem: parsedTicketIds.map((item, idx) => ({
            index: idx,
            type: typeof item,
            value: JSON.stringify(item),
            hasSectionId: item?.sectionId ? 'yes' : 'no',
            hasSeatId: item?.seatId ? 'yes' : 'no',
          })),
        });

        this.logger.log('ABOUT TO CALL createTicketsFromPayment with:', {
          paymentId: payment._id.toString(),
          eventId: payment.eventId.toString(),
          ticketIdsCount: parsedTicketIds.length,
          ticketIds: JSON.stringify(parsedTicketIds),
        });

        const createdTickets =
          await this.ticketsService.createTicketsFromPayment(
            payment._id.toString(),
            payment.userId.toString(),
            payment.eventId.toString(),
            parsedTicketIds,
            ticketCreationData.buyerEmail || '',
            ticketCreationData.buyerName || '',
            ticketCreationData.buyerPhoneNumber || '',
            ticketCreationData.ticketType || 'Standard',
          );

        this.logger.log(
          `Created ${createdTickets.length} tickets for payment ${paymentIntentId}`,
        );
        return { payment, createdTickets };
      } catch (ticketError) {
        this.logger.error(
          `Failed to create tickets for payment ${paymentIntentId}:`,
          ticketError,
        );

        // Check if tickets were actually created despite the error (idempotency)
        const existingTickets = await this.ticketsService.getTicketsByPaymentId(
          payment._id.toString(),
        );

        if (existingTickets && existingTickets.length > 0) {
          // Tickets were created successfully! The error occurred after ticket creation.
          // Treat this as success (idempotent).
          this.logger.log(
            `Tickets exist for payment despite error - treating as success (likely duplicate webhook):`,
            {
              paymentIntentId,
              ticketCount: existingTickets.length,
            },
          );
          return { payment, createdTickets: existingTickets };
        }

        // Mark payment with ticket creation error only if tickets don't exist
        payment.status = 'ticket_creation_failed';
        payment.failureReason = ticketError.message;
        await payment.save();
        // Payment is marked succeeded, but tickets failed - log this critical issue
        throw new Error(
          `Payment succeeded but ticket creation failed: ${ticketError.message}`,
        );
      }
    } catch (error) {
      this.logger.error('Error handling payment success:', error);
      throw error;
    }
  }

  async handlePaymentFailure(paymentIntentId: string, reason: string) {
    try {
      const payment = await this.paymentModel.findOne({
        stripePaymentIntentId: paymentIntentId,
      });

      if (!payment) {
        throw new NotFoundException('Payment not found');
      }

      // Update payment status
      payment.status = 'failed';
      payment.failureReason = reason;
      await payment.save();

      this.logger.log(`Payment ${paymentIntentId} marked as failed: ${reason}`);
      return payment;
    } catch (error) {
      this.logger.error('Error handling payment failure:', error);
      throw error;
    }
  }

  /**
   * Validates a purchase request against the event stored in MongoDB and
   * computes the authoritative amount. Mirrors the checks that
   * TicketsService.createTicketsFromPayment applies when issuing tickets.
   */
  private async resolvePurchase(
    eventId: string,
    ticketType: string,
    requestedTicketIds: any[],
  ): Promise<{ event: any; ticketIds: any[]; amountInCents: number }> {
    if (!Types.ObjectId.isValid(eventId)) {
      throw new BadRequestException('Invalid eventId');
    }

    const event: any = await this.eventsService.findById(eventId);

    if (new Date(event.date) < new Date()) {
      throw new PastEventException();
    }

    if (!event.ticketTypes?.[ticketType]?.enabled) {
      throw new InvalidTicketTypeException(ticketType);
    }

    if (ticketType === 'EarlyBird') {
      const earlyBirdLimit = event.ticketTypes.EarlyBird.limit;
      if (
        earlyBirdLimit &&
        earlyBirdLimit > 0 &&
        event.earlyBirdCount >= earlyBirdLimit
      ) {
        throw new EarlyBirdSoldOutException();
      }
    }

    const seats: SeatSelection[] = [];
    let ticketIds: any[];

    if (event.seatingLayout?.enabled) {
      if (
        requestedTicketIds.length === 0 ||
        requestedTicketIds.length > MAX_SEATS_PER_PURCHASE
      ) {
        throw new BadRequestException(
          `Select between 1 and ${MAX_SEATS_PER_PURCHASE} seats`,
        );
      }

      const seen = new Set<string>();
      for (const item of requestedTicketIds) {
        if (
          !item ||
          typeof item !== 'object' ||
          typeof item.sectionId !== 'string' ||
          typeof item.seatId !== 'string'
        ) {
          throw new BadRequestException(
            'Each ticket must be a seat with sectionId and seatId',
          );
        }

        const key = `${item.sectionId}:${item.seatId}`;
        if (seen.has(key)) {
          throw new BadRequestException(
            `Seat ${item.seatId} was selected more than once`,
          );
        }
        seen.add(key);

        const section = event.seatingLayout.sections?.find(
          (s) => s.id === item.sectionId,
        );
        const seat = section?.seats?.find((s) => s.seatId === item.seatId);
        if (!seat) {
          throw new BadRequestException(
            `Seat ${item.seatId} does not exist for this event`,
          );
        }
        if (seat.status === 'unavailable') {
          throw new SeatUnavailableException(
            `Seat ${item.seatId} is already sold`,
          );
        }

        seats.push({ sectionId: item.sectionId, seatId: item.seatId });
      }
      ticketIds = seats;
    } else {
      if (
        requestedTicketIds.length !== 1 ||
        requestedTicketIds[0] !== 'auto-assigned'
      ) {
        throw new BadRequestException(
          "ticketIds must be ['auto-assigned'] for events without seating",
        );
      }
      ticketIds = ['auto-assigned'];
    }

    const price = this.ticketsService.calculatePaymentTicketPrice(
      event,
      ticketType,
      seats,
    );

    return { event, ticketIds, amountInCents: Math.round(price * 100) };
  }

  /**
   * Returns the payment only if the user owns it or is an admin. Any other
   * case gets the same 404 as a missing payment so existence isn't leaked.
   */
  private assertPaymentAccess(
    payment: PaymentDocument | null,
    user: RequestUser,
  ): PaymentDocument {
    const isOwner =
      !!payment && !!user?.userId && payment.userId?.toString() === user.userId;
    const isAdmin = user?.userType === UserType.ADMIN.toString();

    if (!payment || !(isOwner || isAdmin)) {
      throw new NotFoundException('Payment not found');
    }
    return payment;
  }

  async getPaymentById(paymentId: string, user: RequestUser) {
    // Validate paymentId is provided and looks like a valid ObjectId
    if (!paymentId || paymentId === 'undefined') {
      throw new BadRequestException('Invalid payment ID provided');
    }

    // First, try to find by MongoDB ObjectId
    try {
      if (Types.ObjectId.isValid(paymentId)) {
        const payment = await this.paymentModel.findById(paymentId);
        if (payment) {
          return this.assertPaymentAccess(payment, user);
        }
      }
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }
      // Continue to next check if ObjectId parsing fails
    }

    // If not found by ObjectId, try to find by Stripe payment intent ID
    const payment = await this.paymentModel.findOne({
      stripePaymentIntentId: paymentId,
    });

    return this.assertPaymentAccess(payment, user);
  }

  async getUserPayments(userId: string) {
    return this.paymentModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 });
  }

  async getPaymentByPaymentIntentId(paymentIntentId: string) {
    return this.paymentModel.findOne({
      stripePaymentIntentId: paymentIntentId,
    });
  }

  async getPaymentByIntent(paymentIntentId: string, user: RequestUser) {
    const payment = await this.paymentModel.findOne({
      stripePaymentIntentId: paymentIntentId,
    });
    return this.assertPaymentAccess(payment, user);
  }

  async createFreeTicket(userId: string, dto: any) {
    try {
      this.logger.log('[PaymentsService] Creating free ticket for user:', {
        userId,
        eventId: dto.eventId,
        ticketIds: JSON.stringify(dto.ticketIds),
      });

      // Validate input
      if (
        !userId ||
        !dto.eventId ||
        !dto.ticketIds ||
        dto.ticketIds.length === 0
      ) {
        throw new BadRequestException('Invalid free ticket parameters');
      }

      const { event, ticketIds, amountInCents } = await this.resolvePurchase(
        dto.eventId,
        dto.ticketType,
        dto.ticketIds,
      );

      if (amountInCents > 0) {
        throw new BadRequestException(
          `Ticket type "${dto.ticketType}" is not free for this event`,
        );
      }
      dto.ticketIds = ticketIds;

      this.logger.log('[PaymentsService] Event found:', {
        eventName: event.name,
      });

      // For guest users (userId starts with 'guest-'), store as string
      // For authenticated users, convert to ObjectId
      let userIdValue: any;
      try {
        userIdValue = new Types.ObjectId(userId);
      } catch {
        // If not a valid ObjectId, use the string directly (guest user)
        userIdValue = userId;
        this.logger.log('[PaymentsService] Using guest user ID:', { userId });
      }

      // Check for idempotency - if we already created a free ticket for this user/event in the last minute, return it
      const oneMinuteAgo = new Date(Date.now() - 60000);
      const existingPayment = await this.paymentModel.findOne({
        userId: userIdValue,
        eventId: new Types.ObjectId(dto.eventId),
        amount: 0,
        createdAt: { $gte: oneMinuteAgo },
      });

      if (existingPayment) {
        this.logger.log(
          '[PaymentsService] Found existing free ticket payment, returning cached result:',
          { paymentId: existingPayment._id.toString() },
        );

        try {
          // Get existing tickets for this payment
          const existingTickets = await this.ticketsService.findByPaymentId(
            existingPayment._id.toString(),
          );

          if (existingTickets && existingTickets.length > 0) {
            const ticketId = existingTickets[0]._id.toString();
            const ticketNumber = existingTickets[0].ticketNumber;
            const paymentId = existingPayment._id.toString();

            this.logger.log(
              '[PaymentsService] Returning existing free ticket:',
              {
                ticketId,
                ticketNumber,
                paymentId,
              },
            );

            return {
              ticketId,
              ticketNumber,
              paymentId,
            };
          }
        } catch (err) {
          this.logger.warn(
            '[PaymentsService] Error fetching existing tickets, proceeding with new creation:',
            err instanceof Error ? err.message : JSON.stringify(err),
          );
          // If we can't fetch existing tickets, proceed with creating new ones
        }
      }

      // Transform ticketIds for storage
      // If it's 'auto-assigned', convert to proper format
      let processedTicketIds = dto.ticketIds;
      if (dto.ticketIds.length === 1 && dto.ticketIds[0] === 'auto-assigned') {
        // For events without seating, store a placeholder
        processedTicketIds = [
          { sectionId: 'general', seatId: 'auto-assigned' },
        ];
      }

      // Create dummy payment record for free ticket (for audit trail)
      const payment = new this.paymentModel({
        userId: userIdValue,
        eventId: new Types.ObjectId(dto.eventId),
        ticketIds: processedTicketIds,
        amount: 0,
        currency: 'usd',
        stripePaymentIntentId: `free-${Date.now()}`, // Fake payment intent for free tickets
        status: 'succeeded', // Free tickets are immediately succeeded
        metadata: {
          buyerEmail: dto.buyerEmail,
          buyerName: dto.buyerName,
          buyerPhoneNumber: dto.buyerPhoneNumber,
          ticketType: dto.ticketType,
        },
      });

      await payment.save();

      this.logger.log(
        '[PaymentsService] Payment record created for free ticket:',
        {
          paymentId: payment._id.toString(),
          userId: payment.userId,
        },
      );

      // Create tickets directly (bypass the normal ticketIds filtering since there's no Stripe)
      this.logger.log(
        '[PaymentsService] About to create tickets from payment:',
        {
          processedTicketIds: JSON.stringify(processedTicketIds),
          paymentId: payment._id.toString(),
        },
      );

      const createdTickets = await this.ticketsService.createTicketsFromPayment(
        payment._id.toString(),
        userId,
        dto.eventId,
        processedTicketIds,
        dto.buyerEmail,
        dto.buyerName,
        dto.buyerPhoneNumber || '',
        dto.ticketType,
      );

      this.logger.log('[PaymentsService] Tickets created from payment:', {
        ticketCount: createdTickets.length,
        firstTicketId: createdTickets[0]?._id,
      });

      if (!createdTickets || createdTickets.length === 0) {
        throw new Error('Failed to create free ticket');
      }

      const ticketId = createdTickets[0]._id.toString();
      const ticketNumber = createdTickets[0].ticketNumber;
      const paymentId = payment._id.toString();

      this.logger.log('[PaymentsService] Free ticket created successfully:', {
        ticketId,
        ticketNumber,
        paymentId,
      });

      // Return just the data object - ResponseInterceptor will wrap it
      return {
        ticketId,
        ticketNumber,
        paymentId,
      };
    } catch (error) {
      this.logger.error(
        '[PaymentsService] Error creating free ticket:',
        error instanceof Error ? error.message : JSON.stringify(error),
      );
      if (error instanceof Error) {
        this.logger.error('[PaymentsService] Stack:', error.stack);
      }
      throw error;
    }
  }

  verifyWebhookSignature(body: string, signature: string): object {
    try {
      return this.stripe.webhooks.constructEvent(
        body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (error) {
      this.logger.error('Webhook signature verification failed:', error);
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  // In-memory webhook event deduplication (cleared on app restart)
  // For production, consider using Redis or a database table
  private processedWebhookEvents = new Set<string>();

  async getProcessedEvent(eventId: string): Promise<boolean> {
    return this.processedWebhookEvents.has(eventId);
  }

  async markEventAsProcessed(eventId: string): Promise<void> {
    this.processedWebhookEvents.add(eventId);
    // Clean up old events from memory (keep last 1000)
    if (this.processedWebhookEvents.size > 1000) {
      const eventsArray = Array.from(this.processedWebhookEvents);
      const toDelete = eventsArray.slice(0, eventsArray.length - 1000);
      toDelete.forEach((e) => this.processedWebhookEvents.delete(e));
    }
  }
}
