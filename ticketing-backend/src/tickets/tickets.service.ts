import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { Ticket, TicketStatus } from './ticket.schema';
import { loadQrEncryptionKey } from './qr-encryption-key';
import { Payment, PaymentDocument } from '../payments/payment.schema';
import { RequestUser } from '../auth/guards/user-type.guard';
import { UserType } from '../users/enums/user-type.enum';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { EventsService } from '../events/events.service';
import { SeatsService } from '../events/seats.service';
import { SendGridService } from '../email/sendgrid.service';
import { LogsService } from '../logs/logs.service';
import { LogAction } from '../logs/log.schema';
import { AppLogger } from '../common/utils/logger';
import {
  TicketNotFoundException,
  InvalidTicketTypeException,
  SeatUnavailableException,
  EarlyBirdSoldOutException,
  PastEventException,
} from '../common/exceptions/custom-exceptions';

@Injectable()
export class TicketsService {
  private readonly encryptionKey: Buffer;
  private readonly algorithm = 'aes-256-gcm';
  private readonly logger = new AppLogger(TicketsService.name);

  constructor(
    @InjectModel(Ticket.name) private ticketModel: Model<Ticket>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    private readonly eventsService: EventsService,
    private readonly seatsService: SeatsService,
    private readonly sendGridService: SendGridService,
    private readonly logsService: LogsService,
  ) {
    this.encryptionKey = loadQrEncryptionKey();
  }

  // Generate a secure encrypted QR token
  private generateQrToken(): { token: string; encryptedToken: string } {
    const token = crypto.randomBytes(32).toString('hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      this.algorithm,
      this.encryptionKey,
      iv,
    );
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    const encryptedToken = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    return { token, encryptedToken };
  }

  // Decrypt an encrypted QR token
  private decryptQrToken(encryptedToken: string): string | null {
    try {
      const parts = encryptedToken.split(':');
      if (parts.length !== 3) {
        this.logger.warn('Invalid encrypted token format', TicketsService.name);
        return null;
      }

      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];

      const decipher = crypto.createDecipheriv(
        this.algorithm,
        this.encryptionKey,
        iv,
      );
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      this.logger.error('Decryption error', TicketsService.name, error);
      return null;
    }
  }

  private async generateTicketNumber(): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const bytes = crypto.randomBytes(8);
      let ticketNumber = 'TK';
      for (let i = 0; i < 8; i++) {
        ticketNumber += alphabet[bytes[i] % alphabet.length];
      }

      const existing = await this.ticketModel.exists({ ticketNumber });
      if (!existing) {
        return ticketNumber;
      }
    }

    throw new ConflictException('Failed to generate unique ticket number');
  }

  async create(createTicketDto: CreateTicketDto): Promise<Ticket> {
    try {
      console.log('\n\n🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫');
      console.log('🎫 CREATE() METHOD CALLED');
      console.log('🎫 Event ID:', createTicketDto.eventId);
      console.log('🎫 Ticket Type:', createTicketDto.ticketType);
      console.log('🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫\n\n');
      
      this.logger.log('Creating ticket', TicketsService.name, {
        eventId: createTicketDto.eventId.toString(),
        ticketType: createTicketDto.ticketType,
        buyerEmail: createTicketDto.buyerEmail,
      });

      // Get event details
      const event = await this.eventsService.findById(
        createTicketDto.eventId.toString(),
      );

      if (!event) {
        throw new Error('Event not found');
      }

      // Check if event date has passed
      const now = new Date();
      const eventDate = new Date(event.date);
      if (eventDate < now) {
        this.logger.warn(
          'Ticket purchase attempt for past event',
          TicketsService.name,
          {
            eventId: createTicketDto.eventId.toString(),
            eventDate: eventDate.toISOString(),
          },
        );
        throw new PastEventException();
      }

      // VALIDATE TICKET TYPE AVAILABILITY BEFORE LOCKING SEATS
      const ticketType = createTicketDto.ticketType || 'Free';
      if (!event.ticketTypes?.[ticketType]?.enabled) {
        this.logger.warn('Invalid ticket type requested', TicketsService.name, {
          ticketType,
          eventId: createTicketDto.eventId.toString(),
        });
        throw new InvalidTicketTypeException(ticketType);
      }

      // Check Early Bird limit BEFORE locking seats
      if (ticketType === 'EarlyBird') {
        const earlyBirdLimit = event.ticketTypes.EarlyBird.limit;
        if (
          earlyBirdLimit &&
          earlyBirdLimit > 0 &&
          event.earlyBirdCount >= earlyBirdLimit
        ) {
          this.logger.warn('Early Bird tickets sold out', TicketsService.name, {
            eventId: createTicketDto.eventId.toString(),
          });
          throw new EarlyBirdSoldOutException();
        }
      }

      // VALIDATE TOTAL CAPACITY: Ensure purchase won't exceed total seats
      if (event.totalSeats && event.totalSeats > 0) {
        const seatsToAdd =
          (createTicketDto.seats && createTicketDto.seats.length) || 1;

        // For events with seating layout (sections): verify available seats in sections
        if (
          event.seatingLayout?.enabled &&
          event.seatingLayout.sections?.length > 0
        ) {
          // Count total available seats across all sections
          let totalAvailable = 0;
          for (const section of event.seatingLayout.sections) {
            if (section.seats && Array.isArray(section.seats)) {
              const availableInSection = section.seats.filter(
                (s) => s.status === 'available',
              ).length;
              totalAvailable += availableInSection;
            }
          }

          if (totalAvailable < seatsToAdd) {
            this.logger.warn(
              'Insufficient seats available',
              TicketsService.name,
              {
                eventId: createTicketDto.eventId.toString(),
                requested: seatsToAdd,
                available: totalAvailable,
              },
            );
            throw new SeatUnavailableException(
              `Not enough seats available. Requested: ${seatsToAdd}, Available: ${totalAvailable}`,
            );
          }
        } else {
          // For standing room events (no seating layout): compare against totalSeats vs soldTickets
          const remainingCapacity = event.totalSeats - (event.soldTickets || 0);
          if (remainingCapacity < seatsToAdd) {
            this.logger.warn('Event sold out', TicketsService.name, {
              eventId: createTicketDto.eventId.toString(),
              remaining: Math.max(0, remainingCapacity),
              requested: seatsToAdd,
            });
            throw new SeatUnavailableException(
              `Event is sold out or insufficient capacity. Remaining: ${Math.max(0, remainingCapacity)}, Requested: ${seatsToAdd}`,
            );
          }
        }
      }

      // Validate max 10 seat purchase limit
      if (createTicketDto.seats && createTicketDto.seats.length > 10) {
        this.logger.warn('Seat purchase limit exceeded', TicketsService.name, {
          eventId: createTicketDto.eventId.toString(),
          requested: createTicketDto.seats.length,
        });
        throw new Error(
          'Maximum 10 seats per purchase allowed. Please select fewer seats.',
        );
      }

      // Auto-assign seats if not provided
      if (!createTicketDto.seats || createTicketDto.seats.length === 0) {
        const ticketCountForEvent = await this.ticketModel.countDocuments({
          eventId: createTicketDto.eventId,
        });
        createTicketDto.seats = [
          {
            seatId: `SEAT-${String(ticketCountForEvent + 1).padStart(4, '0')}`,
          },
        ];
      }

      // CRITICAL: Atomically lock seats BEFORE creating ticket
      // This prevents double-booking by ensuring only one customer can buy each seat
      const seatsWithSection = createTicketDto.seats.filter((s) => s.sectionId);

      if (seatsWithSection.length > 0) {
        // Call finalizePurchase - this will throw ConflictException if seat already sold
        // If this throws, the ticket will NEVER be created
        await this.seatsService.finalizePurchase(
          createTicketDto.eventId.toString(),
          seatsWithSection as { sectionId: string; seatId: string }[],
        );
      }

      // NOW create the ticket (after seats are locked)
      const ticketNumber = await this.generateTicketNumber();
      const expiresAt = new Date(eventDate.getTime() + 15 * 60 * 1000);

      // Generate secure QR token
      const { token, encryptedToken } = this.generateQrToken();

      // QR code only contains the encrypted token (not sensitive data)
      const qrCode = await QRCode.toDataURL(encryptedToken);

      // Calculate total price based on ticket type
      let totalPrice = 0;
      // (ticketType already validated above before seat locking)

      // Determine base price from ticket type
      const basePrice = event.ticketTypes[ticketType]?.price || 0;

      // Calculate total price with seat modifiers
      if (
        createTicketDto.seats &&
        createTicketDto.seats.length > 0 &&
        event.seatingLayout?.enabled
      ) {
        for (const seat of createTicketDto.seats) {
          const section = event.seatingLayout.sections.find(
            (s) => s.id === seat.sectionId,
          );
          if (section) {
            totalPrice += basePrice + (section.priceModifier || 0);
          } else {
            totalPrice += basePrice;
          }
        }
      } else {
        totalPrice = basePrice;
      }

      const ticketData = {
        eventId: createTicketDto.eventId,
        seats: createTicketDto.seats,
        buyerEmail: createTicketDto.buyerEmail,
        buyerName: createTicketDto.buyerName,
        buyerPhoneNumber: createTicketDto.buyerPhoneNumber,
        ticketNumber,
        qrCode,
        qrToken: token,
        expiresAt,
        totalPrice,
        ticketType,
        metadata: createTicketDto.metadata || {},
      };

      const createdTicket = new this.ticketModel(ticketData);
      const savedTicket = await createdTicket.save();

      this.logger.log('Ticket created successfully', TicketsService.name, {
        id: savedTicket._id.toString(),
        ticketNumber,
        price: totalPrice,
      });

      // Log the ticket purchase
      await this.logsService.createLog(LogAction.TICKET_PURCHASE, {
        ticketName: `Ticket #${ticketNumber}`,
        eventName: event.name,
        eventId: createTicketDto.eventId.toString(),
        ticketId: savedTicket._id.toString(),
        metadata: {
          ticketType,
          buyerEmail: createTicketDto.buyerEmail,
          buyerName: createTicketDto.buyerName,
          totalPrice,
        },
      });

      // Update event's Early Bird count if applicable
      const updateData: any = {};
      if (ticketType === 'EarlyBird') {
        updateData.earlyBirdCount = (event.earlyBirdCount || 0) + 1;
      }

      // Update event's sold tickets count
      if (event.seatingLayout?.enabled) {
        // IMPORTANT: Fetch the event AGAIN to get the updated seat statuses after locking
        const updatedEvent = await this.eventsService.findById(
          createTicketDto.eventId.toString(),
        );
        if (updatedEvent?.seatingLayout) {
          let unavailableSeatsCount = 0;
          for (const section of updatedEvent.seatingLayout.sections) {
            if (section.seats && Array.isArray(section.seats)) {
              unavailableSeatsCount += section.seats.filter(
                (s) => s.status === 'unavailable',
              ).length;
            }
          }
          updateData.soldTickets = unavailableSeatsCount;
        }
      } else {
        const ticketCountForEvent = await this.ticketModel.countDocuments({
          eventId: createTicketDto.eventId,
        });
        updateData.soldTickets = ticketCountForEvent;
      }

      if (Object.keys(updateData).length > 0) {
        console.log('🎫 TICKET SERVICE: Calling updateInternal with:', Object.keys(updateData));
        await this.eventsService.updateInternal(
          createTicketDto.eventId.toString(),
          updateData,
        );
        console.log('🎫 TICKET SERVICE: updateInternal call completed');
      }

      try {
        await this.sendReceiptEmailAsync(savedTicket, event);
      } catch (error) {
        this.logger.warn('Failed to send receipt email', TicketsService.name, {
          ticketId: savedTicket._id.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Convert to plain JSON object for response serialization
      return JSON.parse(JSON.stringify(savedTicket));
    } catch (error) {
      this.logger.error('Error creating ticket', TicketsService.name, error);
      throw error;
    }
  }

  // Helper method to update expired tickets based on event date
  private async updateExpiredTickets(): Promise<void> {
    const now = new Date();

    // Find all tickets that are still "valid" and belong to events that have passed
    const validTickets = await this.ticketModel
      .find({ status: TicketStatus.VALID })
      .populate('eventId')
      .exec();

    for (const ticket of validTickets) {
      // Check if eventId is populated (is an object with date property)
      if (
        ticket.eventId &&
        typeof ticket.eventId === 'object' &&
        'date' in ticket.eventId
      ) {
        const eventDate = new Date((ticket.eventId as any).date);
        // If event date has passed, mark ticket as expired
        if (eventDate < now) {
          await this.ticketModel.findByIdAndUpdate(ticket._id, {
            status: TicketStatus.EXPIRED,
          });
        }
      }
    }
  }

  async findByEventId(eventId: string): Promise<Ticket[]> {
    this.logger.log('Finding tickets by event ID', TicketsService.name, {
      eventId,
    });
    await this.updateExpiredTickets();
    return this.ticketModel.find({ eventId }).populate('eventId').lean().exec();
  }

  async findById(ticketId: string): Promise<Ticket | null> {
    this.logger.log('Finding ticket by ID', TicketsService.name, {
      ticketId,
    });

    // Validate ticketId is provided and looks like a valid ObjectId
    if (!ticketId || ticketId === 'undefined') {
      throw new BadRequestException('Invalid ticket ID provided');
    }

    const ticket = await this.ticketModel
      .findById(ticketId)
      .populate('eventId')
      .lean()
      .exec();

    if (!ticket) {
      this.logger.warn('Ticket not found', TicketsService.name, { ticketId });
      throw new TicketNotFoundException(ticketId);
    }

    return ticket;
  }

  // Organizers and admins already see every ticket via the staff routes.
  private isStaff(user: RequestUser): boolean {
    return (
      user?.userType === UserType.ADMIN.toString() ||
      user?.userType === UserType.ORGANIZER.toString()
    );
  }

  private async userOwnsPayment(
    paymentId: Types.ObjectId | string | undefined,
    user: RequestUser,
  ): Promise<boolean> {
    if (
      !paymentId ||
      !user?.userId ||
      !Types.ObjectId.isValid(paymentId.toString()) ||
      !Types.ObjectId.isValid(user.userId)
    ) {
      return false;
    }
    // Payment.userId is a Mixed path, so query values are not cast to ObjectId
    const owned = await this.paymentModel.exists({
      _id: new Types.ObjectId(paymentId.toString()),
      userId: new Types.ObjectId(user.userId),
    });
    return !!owned;
  }

  /**
   * Returns the ticket only to the buyer (owner of its payment) or staff.
   * Anyone else gets the same 404 as a missing ticket.
   */
  async findByIdForUser(ticketId: string, user: RequestUser): Promise<Ticket> {
    if (!Types.ObjectId.isValid(ticketId)) {
      throw new TicketNotFoundException(ticketId);
    }

    const ticket = await this.findById(ticketId);

    if (
      this.isStaff(user) ||
      (await this.userOwnsPayment(ticket.paymentId, user))
    ) {
      return ticket;
    }

    throw new TicketNotFoundException(ticketId);
  }

  async findByPaymentIdForUser(
    paymentId: string,
    user: RequestUser,
  ): Promise<Ticket[]> {
    if (
      !Types.ObjectId.isValid(paymentId) ||
      !(this.isStaff(user) || (await this.userOwnsPayment(paymentId, user)))
    ) {
      throw new NotFoundException('Payment not found');
    }

    return this.findByPaymentId(paymentId);
  }

  /**
   * Send receipt email asynchronously
   */
  private async sendPaymentReceiptEmailAsync(
    ticket: any,
    event: any,
    paymentId: string,
  ): Promise<void> {
    try {
      this.logger.log(
        'Starting payment receipt email process',
        TicketsService.name,
        {
          ticketId: ticket._id.toString(),
          email: ticket.buyerEmail,
          ticketNumber: ticket.ticketNumber,
          eventName: event.name,
          paymentId,
        },
      );

      const qrCode = ticket.qrCode;

      // Generate HTML with payment info included
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .section { margin: 20px 0; padding: 15px; background: white; border-radius: 8px; border: 1px solid #e5e7eb; }
            .label { font-weight: bold; color: #6b7280; font-size: 12px; text-transform: uppercase; }
            .value { font-size: 16px; color: #111827; margin-top: 5px; }
            .payment-info { background: #ecfdf5; border-left: 4px solid #10b981; padding: 15px; margin: 15px 0; }
            .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
            .button { display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 10px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✓ Payment Confirmed</h1>
              <p>Your ticket has been successfully created</p>
            </div>
            <div class="content">
              <p>Hi <strong>${ticket.buyerName}</strong>,</p>
              <p>Thank you for your purchase! Your payment has been confirmed and your ticket is now ready.</p>
              
              <div class="payment-info">
                <div class="label">Payment ID</div>
                <div class="value">${paymentId}</div>
              </div>

              <div class="section">
                <div class="label">Ticket Number</div>
                <div class="value">${ticket.ticketNumber}</div>
              </div>

              <div class="section">
                <div class="label">Event</div>
                <div class="value">${event.name}</div>
              </div>

              <div class="section">
                <div class="label">Date & Time</div>
                <div class="value">${new Date(event.date).toLocaleDateString(
                  'en-US',
                  {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  },
                )} at ${new Date(event.date).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}</div>
              </div>

              <div class="section">
                <div class="label">Venue</div>
                <div class="value">${event.venue}</div>
              </div>

              <div class="section">
                <div class="label">Ticket Type</div>
                <div class="value">${ticket.ticketType}</div>
              </div>

              <div class="section">
                <div class="label">Amount Paid</div>
                <div class="value" style="font-size: 20px; color: #f59e0b;">\\$${(ticket.totalPrice / 100).toFixed(2)}</div>
              </div>

              <p style="margin-top: 20px; text-align: center;">
                <a href="http://localhost:3000/receipt/${ticket._id}" class="button">View Your Receipt</a>
              </p>

              <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <strong>Important:</strong> Please arrive 30 minutes before the event starts. Have your QR code ready for scanning at the entrance.
              </p>
            </div>
            <div class="footer">
              <p>Golden Moment Events © 2026</p>
              <p>For support, contact support@goldenmoment.tn</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const receiptResult = await this.sendGridService.sendTicketReceipt(
        {
          email: ticket.buyerEmail,
          ticketNumber: ticket.ticketNumber,
          eventName: event.name,
          ticketType: ticket.ticketType,
          purchaseDate: new Date(ticket.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }),
          totalAmount: ticket.totalPrice,
          customerName: ticket.buyerName,
          eventDate: new Date(event.date),
          eventLocation: event.venue,
          qrCode,
          receiptHtml: htmlContent,
          seats: ticket.seats,
        },
        {
          attachPdf: true,
        },
      );
      if (!receiptResult.success) {
        throw new Error(receiptResult.message);
      }

      this.logger.log(
        'Payment receipt email sent successfully',
        TicketsService.name,
        {
          ticketId: ticket._id.toString(),
          email: ticket.buyerEmail,
          paymentId,
        },
      );
    } catch (error) {
      this.logger.error(
        'Error sending payment receipt email',
        TicketsService.name,
        error,
      );
      throw error;
    }
  }

  private async sendReceiptEmailAsync(ticket: any, event: any): Promise<void> {
    try {
      this.logger.log('Starting receipt email process', TicketsService.name, {
        ticketId: ticket._id.toString(),
        email: ticket.buyerEmail,
        ticketNumber: ticket.ticketNumber,
        eventName: event.name,
      });

      // Use the already-generated QR code from the ticket (don't regenerate)
      const qrCode = ticket.qrCode;

      this.logger.log(
        'Calling sendGridService.sendTicketReceipt',
        TicketsService.name,
        {
          email: ticket.buyerEmail,
          ticketNumber: ticket.ticketNumber,
          eventName: event.name,
          totalAmount: ticket.totalPrice,
          attachPdf: true,
          hasQrCode: !!qrCode,
        },
      );

      const receiptResult = await this.sendGridService.sendTicketReceipt(
        {
          email: ticket.buyerEmail,
          ticketNumber: ticket.ticketNumber,
          eventName: event.name,
          ticketType: ticket.ticketType,
          purchaseDate: new Date(ticket.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }),
          totalAmount: ticket.totalPrice,
          customerName: ticket.buyerName,
          eventDate: new Date(event.date),
          eventLocation: event.venue,
          qrCode, // Include the QR code data URL
        },
        {
          attachPdf: true, // Enable PDF attachment with receipt
        },
      );
      if (!receiptResult.success) {
        throw new Error(receiptResult.message);
      }

      this.logger.log(
        'Receipt email queued successfully',
        TicketsService.name,
        {
          ticketId: ticket._id.toString(),
          email: ticket.buyerEmail,
        },
      );
    } catch (error) {
      this.logger.error(
        'Error queuing receipt email',
        TicketsService.name,
        error,
      );
      // Re-throw to be caught by the caller
      throw error;
    }
  }

  async findAll(): Promise<Ticket[]> {
    this.logger.log('Finding all tickets', TicketsService.name);
    await this.updateExpiredTickets();
    return this.ticketModel.find().populate('eventId').lean().exec();
  }

  async search(query: string): Promise<Ticket[]> {
    this.logger.log('Searching tickets', TicketsService.name, { query });
    // Search by ticket number, event name, ticket holder name, or email
    return this.ticketModel
      .find({
        $or: [
          { ticketNumber: { $regex: query, $options: 'i' } },
          { buyerName: { $regex: query, $options: 'i' } },
          { buyerEmail: { $regex: query, $options: 'i' } },
        ],
      })
      .populate('eventId')
      .lean()
      .exec();
  }

  /**
   * Flips a ticket from VALID to USED in a single conditional update, so two
   * concurrent redemptions can never both succeed. Returns null if the ticket
   * was not VALID at the moment of the update.
   */
  private async redeemTicketAtomically(
    ticketId: Types.ObjectId | string,
  ): Promise<Ticket | null> {
    return this.ticketModel
      .findOneAndUpdate(
        { _id: ticketId, status: TicketStatus.VALID },
        { $set: { status: TicketStatus.USED, usedAt: new Date() } },
        { new: true },
      )
      .populate('eventId')
      .exec();
  }

  async markAsUsed(ticketId: string): Promise<Ticket | null> {
    this.logger.log('Marking ticket as used', TicketsService.name, {
      ticketId,
    });

    if (!Types.ObjectId.isValid(ticketId)) {
      throw new TicketNotFoundException(ticketId);
    }

    const redeemed = await this.redeemTicketAtomically(ticketId);
    if (redeemed) {
      return redeemed;
    }

    const exists = await this.ticketModel.exists({ _id: ticketId });
    if (!exists) {
      throw new TicketNotFoundException(ticketId);
    }
    throw new ConflictException('Ticket has already been used or is not valid');
  }

  async validateByQRToken(encryptedToken: string): Promise<{
    success: boolean;
    message: string;
    ticket?: Ticket;
  }> {
    this.logger.log('Validating ticket by QR token', TicketsService.name);

    // Decrypt the token
    const plainToken = this.decryptQrToken(encryptedToken);
    if (!plainToken) {
      this.logger.warn('Failed to decrypt QR token', TicketsService.name);
      return {
        success: false,
        message: 'Invalid QR code format. Could not decrypt token.',
      };
    }

    // Find ticket by qrToken
    const ticket = await this.ticketModel
      .findOne({ qrToken: plainToken })
      .populate('eventId')
      .exec();

    if (!ticket) {
      this.logger.warn('Ticket not found by QR token', TicketsService.name);
      return {
        success: false,
        message: 'Ticket not found. This QR code is invalid.',
      };
    }

    // Check if ticket is expired (15 minutes after event start)
    const now = new Date();
    if (ticket.expiresAt && now > new Date(ticket.expiresAt)) {
      // Update status to expired if not already
      if (ticket.status !== TicketStatus.EXPIRED) {
        await this.ticketModel.findByIdAndUpdate(ticket._id, {
          status: TicketStatus.EXPIRED,
        });
        ticket.status = TicketStatus.EXPIRED;
      }
      this.logger.warn('Ticket expired', TicketsService.name, {
        ticketId: ticket._id.toString(),
      });
      return {
        success: false,
        message:
          'This ticket has expired. The 15-minute entry window has closed.',
        ticket,
      };
    }

    if (ticket.status === TicketStatus.USED) {
      this.logger.warn('Ticket already used', TicketsService.name, {
        ticketId: ticket._id.toString(),
        usedAt: ticket.usedAt?.toISOString(),
      });
      return {
        success: false,
        message: `This ticket has already been used on ${ticket.usedAt?.toLocaleString() || 'a previous date'}.`,
        ticket,
      };
    }

    if (ticket.status === TicketStatus.EXPIRED) {
      this.logger.warn('Ticket is expired', TicketsService.name, {
        ticketId: ticket._id.toString(),
      });
      return {
        success: false,
        message: 'This ticket has expired.',
        ticket,
      };
    }

    // Mark as used (only succeeds if the ticket is still valid)
    const updatedTicket = await this.redeemTicketAtomically(ticket._id);
    if (!updatedTicket) {
      this.logger.warn(
        'Ticket redeemed concurrently by another request',
        TicketsService.name,
        { ticketId: ticket._id.toString() },
      );
      return {
        success: false,
        message: 'This ticket has already been used.',
      };
    }

    this.logger.log('Ticket validated successfully', TicketsService.name, {
      ticketId: ticket._id.toString(),
      ticketNumber: ticket.ticketNumber,
    });

    return {
      success: true,
      message: 'Ticket validated successfully! Entry granted.',
      ticket: updatedTicket,
    };
  }

  async validateTicketByNumber(ticketNumber: string): Promise<{
    success: boolean;
    message: string;
    ticket?: Ticket;
  }> {
    this.logger.log('Validating ticket by number', TicketsService.name, {
      ticketNumber,
    });

    const ticket = await this.ticketModel
      .findOne({ ticketNumber })
      .populate('eventId')
      .exec();

    if (!ticket) {
      this.logger.warn('Ticket not found by number', TicketsService.name, {
        ticketNumber,
      });
      return {
        success: false,
        message: 'Ticket not found. This QR code is invalid.',
      };
    }

    // Check if ticket is expired (15 minutes after event start)
    const now = new Date();
    if (ticket.expiresAt && now > new Date(ticket.expiresAt)) {
      // Update status to expired if not already
      if (ticket.status !== TicketStatus.EXPIRED) {
        await this.ticketModel.findByIdAndUpdate(ticket._id, {
          status: TicketStatus.EXPIRED,
        });
        ticket.status = TicketStatus.EXPIRED;
      }
      this.logger.warn('Ticket expired', TicketsService.name, {
        ticketId: ticket._id.toString(),
      });
      return {
        success: false,
        message:
          'This ticket has expired. The 15-minute entry window has closed.',
        ticket,
      };
    }

    if (ticket.status === TicketStatus.USED) {
      this.logger.warn('Ticket already used', TicketsService.name, {
        ticketId: ticket._id.toString(),
        usedAt: ticket.usedAt?.toISOString(),
      });
      return {
        success: false,
        message: `This ticket has already been used on ${ticket.usedAt?.toLocaleString() || 'a previous date'}.`,
        ticket,
      };
    }

    if (ticket.status === TicketStatus.EXPIRED) {
      this.logger.warn('Ticket is expired', TicketsService.name, {
        ticketId: ticket._id.toString(),
      });
      return {
        success: false,
        message: 'This ticket has expired.',
        ticket,
      };
    }

    // Mark as used (only succeeds if the ticket is still valid)
    const updatedTicket = await this.redeemTicketAtomically(ticket._id);
    if (!updatedTicket) {
      this.logger.warn(
        'Ticket redeemed concurrently by another request',
        TicketsService.name,
        { ticketId: ticket._id.toString() },
      );
      return {
        success: false,
        message: 'This ticket has already been used.',
      };
    }

    this.logger.log('Ticket validated successfully', TicketsService.name, {
      ticketId: ticket._id.toString(),
      ticketNumber,
    });

    return {
      success: true,
      message: 'Ticket validated successfully! Entry granted.',
      ticket: updatedTicket,
    };
  }

  async findByPaymentId(paymentId: string): Promise<Ticket[]> {
    return this.ticketModel
      .find({ paymentId: new (require('mongoose').Types.ObjectId)(paymentId) })
      .exec();
  }

  async findByTicketNumber(ticketNumber: string): Promise<Ticket | null> {
    this.logger.log('Finding ticket by number', TicketsService.name, {
      ticketNumber,
    });
    return this.ticketModel
      .findOne({ ticketNumber })
      .populate('eventId')
      .lean()
      .exec();
  }

  async delete(id: string): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log('Deleting ticket', TicketsService.name, { id });

      // Find the ticket to get event info and seat info BEFORE deleting
      const ticket = await this.ticketModel.findById(id).exec();
      if (!ticket) {
        throw new TicketNotFoundException(id);
      }

      const eventId = ticket.eventId.toString();

      // Get the event to check seating status BEFORE deleting
      // Note: Event may have been deleted already, which is OK - we just skip seat cleanup
      let event: any = null;
      try {
        event = await this.eventsService.findById(eventId);
      } catch (err) {
        // Event was deleted - that's OK, we'll skip seat cleanup
        this.logger.warn(
          'Event not found during ticket deletion',
          TicketsService.name,
          { eventId },
        );
      }

      // STEP 1: Unreserve seats if this is a seated event (only if event still exists)
      if (
        event?.seatingLayout?.enabled &&
        ticket.seats &&
        ticket.seats.length > 0
      ) {
        // Mark all seats as available again
        for (const seat of ticket.seats) {
          if (seat.sectionId && seat.seatId) {
            // Atomically mark the seat as available
            await this.seatsService
              .markSeatAvailable(eventId, seat.sectionId, seat.seatId)
              .catch(() => {
                // Silently ignore if seat cleanup fails (event may not exist)
                this.logger.warn(
                  'Could not mark seat available',
                  TicketsService.name,
                  {
                    eventId,
                    sectionId: seat.sectionId,
                    seatId: seat.seatId,
                  },
                );
              });
          }
        }
      }

      // STEP 2: Delete the ticket
      await this.ticketModel.findByIdAndDelete(id).exec();

      this.logger.log('Ticket deleted', TicketsService.name, { id });

      // Log the ticket deletion
      await this.logsService
        .createLog(LogAction.TICKET_DELETED, {
          ticketName: `Ticket #${ticket.ticketNumber}`,
          eventName: event?.name || 'Event Unknown',
          eventId: eventId,
          ticketId: id,
          metadata: {
            ticketType: ticket.ticketType,
            buyerEmail: ticket.buyerEmail,
          },
        })
        .catch(() => {
          // Don't let logging errors affect the deletion
          this.logger.warn(
            'Failed to log ticket deletion',
            TicketsService.name,
            { id },
          );
        });

      // STEP 3: Recalculate event counts (only if event still exists)
      if (event) {
        const updateData: any = {};

        // Recalculate soldTickets
        if (event.seatingLayout?.enabled) {
          // For seated events, count unavailable seats
          let unavailableSeatsCount = 0;
          let updatedEvent: any = null;
          try {
            updatedEvent = await this.eventsService.findById(eventId);
          } catch (err) {
            // Event no longer exists, skip seat counting
            this.logger.warn(
              'Event not found during seat count update',
              TicketsService.name,
              { eventId },
            );
          }
          if (updatedEvent?.seatingLayout) {
            for (const section of updatedEvent.seatingLayout.sections) {
              if (section.seats && Array.isArray(section.seats)) {
                unavailableSeatsCount += section.seats.filter(
                  (s) => s.status === 'unavailable',
                ).length;
              }
            }
          }
          updateData.soldTickets = unavailableSeatsCount;
        } else {
          // For non-seated events, count remaining tickets
          const ticketCountForEvent = await this.ticketModel.countDocuments({
            eventId: eventId,
          });
          updateData.soldTickets = ticketCountForEvent;
        }

        // Recalculate earlyBirdCount
        if (ticket.ticketType === 'EarlyBird') {
          const earlyBirdCountForEvent = await this.ticketModel.countDocuments({
            eventId: eventId,
            ticketType: 'EarlyBird',
          });
          updateData.earlyBirdCount = earlyBirdCountForEvent;
        }

        // STEP 4: Update the event
        if (Object.keys(updateData).length > 0) {
          await this.eventsService
            .updateInternal(eventId, updateData)
            .catch(() => {
              // Silently ignore if event update fails (event may have been deleted)
              this.logger.warn(
                'Could not update event counts',
                TicketsService.name,
                { eventId },
              );
            });
        }
      }

      return {
        success: true,
        message: 'Ticket deleted successfully and availability counts updated',
      };
    } catch (error) {
      // If event wasn't found, that's OK - ticket still got deleted
      if (
        error?.response?.statusCode === 404 ||
        (error instanceof Error && error.message?.includes('not found'))
      ) {
        this.logger.warn(
          'Event was deleted but ticket deletion succeeded',
          TicketsService.name,
          {
            id,
            errorMessage: error?.message,
          },
        );
        return {
          success: true,
          message: 'Ticket deleted successfully (event was already deleted)',
        };
      }

      // Only re-throw TicketNotFound errors
      if (error instanceof TicketNotFoundException) {
        throw error;
      }

      // For any other error, log it and re-throw
      this.logger.error('Error deleting ticket', TicketsService.name, {
        id,
        error,
      });
      throw error;
    }
  }

  /**
   * Price of a ticket issued from a payment, in the event's currency units.
   * Shared by checkout (to set the Stripe amount) and ticket creation so the
   * amount charged always matches the ticket's stored totalPrice.
   */
  calculatePaymentTicketPrice(
    event: any,
    ticketType: string,
    seats: { sectionId: string; seatId: string }[],
  ): number {
    const basePrice = event.ticketTypes?.[ticketType]?.price || 0;
    let totalPrice = basePrice * (seats.length || 1);
    if (seats.length > 0 && event.seatingLayout?.enabled) {
      // Add seat price modifiers
      const sectionPrices = new Map<string, number>();
      for (const seat of seats) {
        const section = event.seatingLayout.sections.find(
          (s) => s.id === seat.sectionId,
        );
        if (section && !sectionPrices.has(seat.sectionId)) {
          sectionPrices.set(seat.sectionId, section.priceModifier || 0);
        }
      }
      // Add all section modifiers
      for (const modifier of sectionPrices.values()) {
        totalPrice += modifier;
      }
    }
    return totalPrice;
  }

  /**
   * Create tickets ONLY after payment succeeds
   * Called by payment webhook after payment_intent.succeeded event
   * @param paymentId - Payment document ID
   * @param userId - User ID
   * @param eventId - Event ID
   * @param ticketIds - Array of requested seat selections
   * @param buyerEmail - Customer email
   * @param buyerName - Customer name
   * @param buyerPhoneNumber - Customer phone
   * @param ticketType - Type of ticket (Free, Standard, EarlyBird, VIP)
   * @returns Array of created tickets
   */
  async createTicketsFromPayment(
    paymentId: string,
    userId: string,
    eventId: string,
    ticketIds: any[],
    buyerEmail: string,
    buyerName: string,
    buyerPhoneNumber: string,
    ticketType: string = 'Standard',
  ): Promise<Ticket[]> {
    try {
      console.log('\n\n🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫');
      console.log('🎫 CREATETICKETSFFROMPAYMENT STARTED');
      console.log('🎫 Payment ID:', paymentId);
      console.log('🎫 Event ID:', eventId);
      console.log('🎫 Ticket Type:', ticketType);
      console.log('🎫 Ticket Count:', ticketIds.length);
      console.log('🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫\n\n');
      
      this.logger.log('Creating tickets from payment', TicketsService.name, {
        paymentId,
        eventId,
        ticketCount: ticketIds.length,
        ticketIdsFormat: JSON.stringify(ticketIds),
      });

      // Get event details
      const event = await this.eventsService.findById(eventId);
      if (!event) {
        throw new Error('Event not found');
      }

      // Check if event date has passed
      const now = new Date();
      const eventDate = new Date(event.date);
      if (eventDate < now) {
        throw new PastEventException();
      }

      // Validate ticket type
      if (!event.ticketTypes?.[ticketType]?.enabled) {
        throw new InvalidTicketTypeException(ticketType);
      }

      // Validate early bird limit
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

      // Validate capacity
      if (event.totalSeats && event.totalSeats > 0) {
        const seatsToAdd = ticketIds.length || 1;
        if (
          event.seatingLayout?.enabled &&
          event.seatingLayout.sections?.length > 0
        ) {
          let totalAvailable = 0;
          for (const section of event.seatingLayout.sections) {
            if (section.seats && Array.isArray(section.seats)) {
              const availableInSection = section.seats.filter(
                (s) => s.status === 'available',
              ).length;
              totalAvailable += availableInSection;
            }
          }
          if (totalAvailable < seatsToAdd) {
            throw new SeatUnavailableException(
              `Not enough seats available. Requested: ${seatsToAdd}, Available: ${totalAvailable}`,
            );
          }
        } else {
          const remainingCapacity = event.totalSeats - (event.soldTickets || 0);
          if (remainingCapacity < seatsToAdd) {
            throw new SeatUnavailableException(
              `Event is sold out. Remaining: ${Math.max(0, remainingCapacity)}`,
            );
          }
        }
      }

      // Lock seats atomically
      this.logger.log('Ticket IDs received for locking:', TicketsService.name, {
        ticketIds,
        count: ticketIds.length,
        fullData: JSON.stringify(ticketIds),
      });

      const seatsWithSection = ticketIds.filter(
        (s) => s && typeof s === 'object' && s.sectionId && s.seatId,
      );

      this.logger.log(
        'Seats to lock (filtered for section+seatId):',
        TicketsService.name,
        {
          seatsWithSection,
          count: seatsWithSection.length,
          fullData: JSON.stringify(seatsWithSection),
        },
      );

      if (seatsWithSection.length > 0) {
        this.logger.log(
          'CALLING finalizePurchase with seats',
          TicketsService.name,
          {
            eventId,
            seatCount: seatsWithSection.length,
            seats: JSON.stringify(seatsWithSection),
          },
        );
        try {
          const result = await this.seatsService.finalizePurchase(
            eventId,
            seatsWithSection as { sectionId: string; seatId: string }[],
          );
          this.logger.log(
            'finalizePurchase completed successfully',
            TicketsService.name,
            {
              eventId,
              result,
            },
          );
        } catch (lockError) {
          this.logger.error('finalizePurchase FAILED', TicketsService.name, {
            eventId,
            error:
              lockError instanceof Error
                ? lockError.message
                : String(lockError),
            stack: lockError instanceof Error ? lockError.stack : 'no stack',
          });
          throw lockError;
        }
      } else {
        this.logger.warn(
          'NO SEATS WITH SECTION FOUND - seats will NOT be locked',
          TicketsService.name,
          {
            eventId,
            totalTicketIds: ticketIds.length,
            ticketIds: JSON.stringify(ticketIds),
          },
        );
      }

      // Create tickets
      const createdTickets: Ticket[] = [];
      const expiresAt = new Date(eventDate.getTime() + 15 * 60 * 1000);

      // Filter seats for seating events (use different name to avoid duplicate)
      const seatsForTicket = ticketIds.filter(
        (s) => s && typeof s === 'object' && s.sectionId && s.seatId,
      );

      this.logger.log(
        'Filtered seats for ticket creation',
        TicketsService.name,
        {
          originalCount: ticketIds.length,
          filteredCount: seatsForTicket.length,
          filteredSeats: JSON.stringify(seatsForTicket),
          ticketIds: JSON.stringify(ticketIds),
        },
      );

      // Create a SINGLE ticket with ALL seats (not one per seat)
      const ticketNumber = await this.generateTicketNumber();
      const { token, encryptedToken } = this.generateQrToken();
      const qrCode = await QRCode.toDataURL(encryptedToken);

      const totalPrice = this.calculatePaymentTicketPrice(
        event,
        ticketType,
        seatsForTicket,
      );

      const ticketData = {
        eventId: new (require('mongoose').Types.ObjectId)(eventId),
        paymentId: new (require('mongoose').Types.ObjectId)(paymentId),
        // For seating events use actual seats, for non-seating events leave empty
        seats: seatsForTicket.length > 0 ? seatsForTicket : [],
        buyerEmail,
        buyerName,
        buyerPhoneNumber,
        ticketNumber,
        qrCode,
        qrToken: token,
        expiresAt,
        totalPrice,
        ticketType,
        metadata: { userId },
      };

      this.logger.log('Creating ticket with data:', TicketsService.name, {
        seatsCount: seatsForTicket.length,
        seatsData: JSON.stringify(ticketData.seats),
        ticketNumber,
      });

      const createdTicket = new this.ticketModel(ticketData);
      const savedTicket = await createdTicket.save();
      createdTickets.push(savedTicket);

      this.logger.log('Ticket created from payment', TicketsService.name, {
        id: savedTicket._id.toString(),
        ticketNumber,
        paymentId,
        seatsCount: seatsForTicket.length,
        savedSeats: JSON.stringify(savedTicket.seats),
      });

      // Update event stats
      const updateData: any = {};
      if (ticketType === 'EarlyBird') {
        updateData.earlyBirdCount =
          (event.earlyBirdCount || 0) + createdTickets.length;
      }

      // Update sold tickets count
      if (event.seatingLayout?.enabled) {
        const updatedEvent = await this.eventsService.findById(eventId);
        if (updatedEvent?.seatingLayout) {
          let unavailableSeatsCount = 0;
          for (const section of updatedEvent.seatingLayout.sections) {
            if (section.seats && Array.isArray(section.seats)) {
              unavailableSeatsCount += section.seats.filter(
                (s) => s.status === 'unavailable',
              ).length;
            }
          }
          updateData.soldTickets = unavailableSeatsCount;
        }
      } else {
        updateData.soldTickets =
          (event.soldTickets || 0) + createdTickets.length;
      }

      // Update event with internal counters (sold tickets, early bird count)
      if (Object.keys(updateData).length > 0) {
        console.log('\n\n🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫');
        console.log('🎫 ABOUT TO CALL updateInternal WITH:');
        console.log('🎫 Event ID:', eventId);
        console.log('🎫 Update Data:', JSON.stringify(updateData));
        console.log('🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫🎫\n\n');
        await this.eventsService.updateInternal(eventId, updateData);
        console.log('\n\n🎫 updateInternal RETURNED SUCCESSFULLY\n\n');
      }

      // Log ticket purchase
      await this.logsService.createLog(LogAction.TICKET_PURCHASE, {
        ticketName: `Tickets from Payment ${paymentId}`,
        eventName: event.name,
        eventId,
        metadata: {
          paymentId,
          ticketsCount: createdTickets.length,
          buyerEmail,
          ticketType,
        },
      });

      for (const ticket of createdTickets) {
        try {
          await this.sendPaymentReceiptEmailAsync(ticket, event, paymentId);
        } catch (error) {
          this.logger.error(
            'Failed to send payment receipt email',
            TicketsService.name,
            error,
          );
        }
      }

      return createdTickets;
    } catch (error) {
      this.logger.error(
        'Error creating tickets from payment',
        TicketsService.name,
        error,
      );
      throw error;
    }
  }

  // Get tickets by payment ID (for idempotency check)
  async getTicketsByPaymentId(paymentId: string): Promise<Ticket[]> {
    try {
      const tickets = await this.ticketModel.find({
        paymentId: new (require('mongoose').Types.ObjectId)(paymentId),
      });
      return tickets;
    } catch (error) {
      this.logger.error(
        'Error fetching tickets by payment ID',
        TicketsService.name,
        error,
      );
      return [];
    }
  }
}
