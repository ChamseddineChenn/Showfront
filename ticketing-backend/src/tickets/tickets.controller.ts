import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Delete,
  ConflictException,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { Public } from '../auth/decorators/public.decorator';
import { GetCurrentUser } from '../auth/decorators/get-current-user.decorator';
import { RequestUser } from '../auth/guards/user-type.guard';
import { UserTypes } from '../auth/decorators/user-types.decorator';
import { UserType } from '../users/enums/user-type.enum';
import { AppLogger } from '../common/utils/logger';

@Controller('tickets')
export class TicketsController {
  private readonly logger = new AppLogger(TicketsController.name);

  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  @UserTypes(UserType.ORGANIZER, UserType.ADMIN)
  async create(@Body() createTicketDto: CreateTicketDto) {
    this.logger.log('POST /tickets - creating ticket', TicketsController.name, {
      eventId: createTicketDto.eventId.toString(),
      ticketType: createTicketDto.ticketType,
    });
    try {
      const result = await this.ticketsService.create(createTicketDto);
      this.logger.log('Ticket created successfully', TicketsController.name, {
        ticketId: result._id.toString(),
      });
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to create ticket';

      this.logger.error('Error creating ticket', TicketsController.name, {
        error: message,
      });

      // Return 409 for capacity/conflict errors, 400 for validation errors
      if (
        message.includes('sold out') ||
        message.includes('capacity') ||
        message.includes('Not enough')
      ) {
        throw new ConflictException(message);
      }

      throw error;
    }
  }

  @Public()
  @Post('validate-qr')
  async validateQR(@Body() body: { encryptedToken: string }) {
    this.logger.log('POST /tickets/validate-qr', TicketsController.name);
    const result = await this.ticketsService.validateByQRToken(
      body.encryptedToken,
    );
    this.logger.log('QR validation result', TicketsController.name, {
      success: result.success,
    });
    return result;
  }

  @Public()
  @Post('validate')
  async validateTicket(@Body() body: { ticketNumber: string }) {
    this.logger.log('POST /tickets/validate', TicketsController.name, {
      ticketNumber: body.ticketNumber,
    });
    const result = await this.ticketsService.validateTicketByNumber(
      body.ticketNumber,
    );
    this.logger.log('Ticket validation result', TicketsController.name, {
      success: result.success,
    });
    return result;
  }

  @Get('search')
  @UserTypes(UserType.ORGANIZER, UserType.ADMIN)
  async search(@Query('q') query: string) {
    this.logger.log('GET /tickets/search', TicketsController.name, { query });
    return this.ticketsService.search(query);
  }

  @Get('by-payment/:paymentId')
  async findByPaymentId(
    @Param('paymentId') paymentId: string,
    @GetCurrentUser() user: RequestUser,
  ) {
    this.logger.log(
      'GET /tickets/by-payment/:paymentId',
      TicketsController.name,
      {
        paymentId,
      },
    );
    return this.ticketsService.findByPaymentIdForUser(paymentId, user);
  }

  @Get('by-number/:ticketNumber')
  @UserTypes(UserType.ORGANIZER, UserType.ADMIN)
  async findByTicketNumber(@Param('ticketNumber') ticketNumber: string) {
    this.logger.log(
      'GET /tickets/by-number/:ticketNumber',
      TicketsController.name,
      {
        ticketNumber,
      },
    );
    return this.ticketsService.findByTicketNumber(ticketNumber);
  }

  @Get('event/:eventId')
  @UserTypes(UserType.ORGANIZER, UserType.ADMIN)
  async findByEventId(@Param('eventId') eventId: string) {
    this.logger.log('GET /tickets/event/:eventId', TicketsController.name, {
      eventId,
    });
    return this.ticketsService.findByEventId(eventId);
  }

  @Get(':id')
  async findById(@Param('id') id: string, @GetCurrentUser() user: RequestUser) {
    this.logger.log('GET /tickets/:id', TicketsController.name, { id });
    return this.ticketsService.findByIdForUser(id, user);
  }

  @Get()
  @UserTypes(UserType.ORGANIZER, UserType.ADMIN)
  async findAll() {
    this.logger.log('GET /tickets', TicketsController.name);
    return this.ticketsService.findAll();
  }

  @Post(':id/mark-used')
  @UserTypes(UserType.ORGANIZER, UserType.ADMIN)
  async markAsUsed(@Param('id') id: string) {
    this.logger.log('POST /tickets/:id/mark-used', TicketsController.name, {
      id,
    });
    return this.ticketsService.markAsUsed(id);
  }

  @Delete(':id')
  @UserTypes(UserType.ORGANIZER, UserType.ADMIN)
  async delete(@Param('id') id: string) {
    this.logger.log('DELETE /tickets/:id', TicketsController.name, { id });
    return this.ticketsService.delete(id);
  }
}
