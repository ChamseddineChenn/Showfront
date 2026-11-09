import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { Ticket, TicketSchema } from './ticket.schema';
import { Payment, PaymentSchema } from '../payments/payment.schema';
import { EventsModule } from '../events/events.module';
import { EmailModule } from '../email/email.module';
import { LogsModule } from '../logs/logs.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ticket.name, schema: TicketSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
    forwardRef(() => EventsModule),
    EmailModule,
    LogsModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
