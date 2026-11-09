import {
  IsString,
  IsNumber,
  IsArray,
  IsOptional,
  IsNotEmpty,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateCheckoutSessionDto {
  @IsString()
  @IsNotEmpty()
  eventId: string;

  // ticketIds can be array of:
  // - strings: ['auto-assigned']
  // - objects with sectionId/seatId: [{sectionId: 'A', seatId: '1'}, ...]
  // CRITICAL: We use Transform to capture the raw value BEFORE whitelist strips properties
  // This is necessary because whitelist: true + forbidNonWhitelisted: true
  // strips unknown properties from nested objects
  @IsArray()
  @IsNotEmpty()
  @Transform(({ obj }) => obj.ticketIds)
  ticketIds: any[];

  // Accepted for backward compatibility only; the charged amount is always
  // computed server-side from the event's stored prices.
  @IsOptional()
  @IsNumber()
  totalAmount?: number;

  @IsOptional()
  @IsString()
  buyerEmail?: string;

  @IsOptional()
  @IsString()
  buyerName?: string;

  @IsOptional()
  @IsString()
  buyerPhoneNumber?: string;

  @IsOptional()
  @IsString()
  ticketType?: string;

  @IsOptional()
  @IsString()
  successUrl?: string;

  @IsOptional()
  @IsString()
  cancelUrl?: string;
}
