import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  RawBodyRequest,
  Req,
  BadRequestException,
  UsePipes,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { GetCurrentUser } from '../auth/decorators/get-current-user.decorator';
import { RequestUser } from '../auth/guards/user-type.guard';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post('create-checkout-session')
  async createCheckoutSession(
    @GetCurrentUser() user: RequestUser,
    @Req() request: any, // Get raw express request to access body before transformation
  ) {
    // Get the raw body directly from Express request - bypasses class-transformer whitelist
    const rawBody = request.body;

    // Manual validation
    if (!rawBody?.eventId || typeof rawBody.eventId !== 'string') {
      throw new BadRequestException('eventId is required');
    }
    if (
      !rawBody?.ticketIds ||
      !Array.isArray(rawBody.ticketIds) ||
      rawBody.ticketIds.length === 0
    ) {
      throw new BadRequestException('ticketIds array is required');
    }

    // Build DTO from raw body - preserving ticketIds exactly as received.
    // totalAmount is still accepted from older clients but never forwarded:
    // the charged amount is computed server-side.
    const dto = {
      eventId: rawBody.eventId,
      ticketIds: rawBody.ticketIds, // Preserved without stripping!
      buyerEmail: rawBody.buyerEmail,
      buyerName: rawBody.buyerName,
      buyerPhoneNumber: rawBody.buyerPhoneNumber,
      ticketType: rawBody.ticketType,
      successUrl: rawBody.successUrl,
      cancelUrl: rawBody.cancelUrl,
    };

    return this.paymentsService.createCheckoutSession(user.userId, dto as any);
  }

  @Post('create-free-ticket')
  async createFreeTicket(
    @GetCurrentUser() user: RequestUser,
    @Req() request: any,
  ) {
    // Get raw body - free ticket creation bypasses Stripe
    const rawBody = request.body;

    // Validation
    if (!rawBody?.eventId || typeof rawBody.eventId !== 'string') {
      throw new BadRequestException('eventId is required');
    }
    if (
      !rawBody?.ticketIds ||
      !Array.isArray(rawBody.ticketIds) ||
      rawBody.ticketIds.length === 0
    ) {
      throw new BadRequestException('ticketIds array is required');
    }

    const dto = {
      eventId: rawBody.eventId,
      ticketIds: rawBody.ticketIds,
      buyerEmail: rawBody.buyerEmail,
      buyerName: rawBody.buyerName,
      buyerPhoneNumber: rawBody.buyerPhoneNumber,
      ticketType: rawBody.ticketType || 'Free',
    };

    return this.paymentsService.createFreeTicket(user.userId, dto as any);
  }

  @Public()
  @Post('webhook')
  async handleWebhook(@Req() req: any) {
    const signature = req.headers['stripe-signature'] as string;
    if (!signature) {
      throw new BadRequestException('No Stripe signature provided');
    }

    // Get the raw body - handle Buffer objects from stringified body
    let body = req.rawBody;
    if (!body && req.body) {
      if (Buffer.isBuffer(req.body)) {
        body = req.body;
      } else if (typeof req.body === 'string') {
        body = req.body;
      } else if (req.body.type === 'Buffer' && Array.isArray(req.body.data)) {
        // Handle stringified Buffer object from middleware
        body = Buffer.from(req.body.data);
      } else {
        // Last resort: stringify the body
        body = JSON.stringify(req.body);
      }
    }

    if (!body) {
      throw new BadRequestException('No request body provided');
    }

    const event = this.paymentsService.verifyWebhookSignature(body, signature);
    const eventId = event['id']; // Stripe event ID - guaranteed unique

    // Check if this event was already processed
    const processedEvent =
      await this.paymentsService.getProcessedEvent(eventId);
    if (processedEvent) {
      // This event was already successfully processed - return success without reprocessing
      console.log(`Webhook event ${eventId} already processed, skipping...`);
      return { received: true };
    }

    try {
      switch (event['type']) {
        case 'payment_intent.succeeded':
          await this.paymentsService.handlePaymentSuccess(
            event['data']['object']['id'],
          );
          break;
        case 'payment_intent.payment_failed':
          await this.paymentsService.handlePaymentFailure(
            event['data']['object']['id'],
            event['data']['object']['last_payment_error']?.['message'] ||
              'Unknown error',
          );
          break;
        default:
          console.log(`Unhandled event type ${event['type']}`);
      }

      // Mark this event as successfully processed
      await this.paymentsService.markEventAsProcessed(eventId);
    } catch (error) {
      // Don't mark as processed - let Stripe retry
      throw error;
    }

    return { received: true };
  }

  @Get('by-intent/:paymentIntentId')
  async getPaymentByIntent(
    @Param('paymentIntentId') paymentIntentId: string,
    @GetCurrentUser() user: RequestUser,
  ) {
    return this.paymentsService.getPaymentByIntent(paymentIntentId, user);
  }

  @Get(':paymentId')
  async getPayment(
    @Param('paymentId') paymentId: string,
    @GetCurrentUser() user: RequestUser,
  ) {
    return this.paymentsService.getPaymentById(paymentId, user);
  }

  @Get('user/payments')
  async getUserPayments(@GetCurrentUser('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }
    return this.paymentsService.getUserPayments(userId);
  }
}
