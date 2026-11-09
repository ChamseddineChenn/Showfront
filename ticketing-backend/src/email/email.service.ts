import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { AppLogger } from '../common/utils/logger';
import { generateReceiptHTML } from './receipt-generator';
import { SendGridService } from './sendgrid.service';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new AppLogger();
  private isConfigured = false;

  constructor(private readonly sendGridService: SendGridService) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    // Try SMTP_* vars first, then fall back to MAIL_* vars
    const smtpHost =
      process.env.SMTP_HOST || process.env.MAIL_HOST || 'smtp.gmail.com';
    const smtpPort = parseInt(
      process.env.SMTP_PORT || process.env.MAIL_PORT || '587',
    );
    const smtpUser = process.env.SMTP_USER || process.env.MAIL_USER;
    const smtpPass = process.env.SMTP_PASS || process.env.MAIL_PASSWORD;
    const fromEmail =
      process.env.SMTP_FROM_EMAIL || process.env.MAIL_FROM || smtpUser;
    const fromName = process.env.SMTP_FROM_NAME || 'Showfront';

    this.logger.log('Initializing email transporter', EmailService.name, {
      smtpHost,
      smtpPort,
      smtpUser: smtpUser ? '***configured***' : 'NOT SET',
      fromEmail,
      fromName,
    });

    if (!smtpUser || !smtpPass) {
      this.logger.warn(
        'Email service not configured - SMTP credentials missing',
        EmailService.name,
      );
      this.isConfigured = false;
      return;
    }

    this.isConfigured = true;

    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      connectionTimeout: 15000, // 15 seconds
      socketTimeout: 15000, // 15 seconds
      tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      },
    });

    // Verify connection (non-blocking)
    this.transporter.verify((error) => {
      if (error) {
        this.logger.error(
          'Email service initialization failed',
          EmailService.name,
          { error: error.message },
        );
      } else {
        this.logger.log(
          'Email service ready - SMTP connection verified',
          EmailService.name,
        );
      }
    });
  }

  /**
   * Send receipt email
   */
  async sendTicketReceipt(
    ticketData: {
      email: string;
      ticketNumber: string;
      eventName: string;
      ticketType?: string;
      purchaseDate: string;
      totalAmount: number;
      customerName: string;
      receiptHtml?: string;
      eventDate?: Date;
      eventLocation?: string;
      qrCode?: string;
      seats?: Array<{ sectionId?: string; seatId: string }>;
    },
    options?: {
      attachPdf?: boolean;
      receiptUrl?: string;
    },
  ): Promise<{ success: boolean; message: string }> {
    try {
      const { email, ticketNumber, eventName, customerName } = ticketData;

      this.logger.log('Starting sendTicketReceipt', EmailService.name, {
        email,
        ticketNumber,
        eventName,
        customerName,
        attachPdf: options?.attachPdf,
      });

      // Generate professional HTML email (WITHOUT QR code for email body)
      const htmlContent = generateReceiptHTML(
        {
          ticketNumber,
          customerName,
          customerEmail: email,
          price: ticketData.totalAmount,
          ticketType: ticketData.ticketType || 'Standard',
          createdAt: new Date(),
          qrCode: ticketData.qrCode,
          seats: ticketData.seats,
        },
        {
          name: eventName,
          date: ticketData.eventDate,
          location: ticketData.eventLocation,
        },
        {
          includeQrCode: false, // Don't include QR code in email body
        },
      );

      const attachments: any[] = [];

      // Generate PDF if requested (WITH QR code for PDF)
      if (options?.attachPdf) {
        try {
          this.logger.log('Generating PDF attachment', EmailService.name, {
            ticketNumber,
          });
          const pdfBuffer = await this.sendGridService.generatePdfFromData({
            ticketNumber,
            eventName,
            customerName,
            amount: ticketData.totalAmount,
            purchaseDate: ticketData.purchaseDate,
            eventDate: ticketData.eventDate
              ? new Date(ticketData.eventDate).toLocaleDateString()
              : undefined,
            eventLocation: ticketData.eventLocation,
            ticketType: ticketData.ticketType || 'Standard',
            seats: ticketData.seats,
            qrCodeDataUrl: ticketData.qrCode,
          });
          if (pdfBuffer) {
            attachments.push({
              filename: `receipt-${ticketNumber}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf',
            });
          }
          this.logger.log('PDF generated successfully', EmailService.name, {
            ticketNumber,
          });
        } catch (pdfError) {
          this.logger.warn(
            'PDF generation failed, sending email without attachment',
            EmailService.name,
            {
              ticketNumber,
              error:
                pdfError instanceof Error ? pdfError.message : String(pdfError),
            },
          );
        }
      }

      // Check if email service is configured
      if (!this.isConfigured) {
        this.logger.warn(
          'Email service not configured - skipping email send',
          EmailService.name,
          { ticketNumber, email },
        );
        return {
          success: false,
          message: 'Email service not configured',
        };
      }

      // Use fallback values for missing env vars
      const fromEmail =
        process.env.SMTP_FROM_EMAIL ||
        process.env.SMTP_USER ||
        process.env.MAIL_USER ||
        process.env.MAIL_FROM;
      const fromName = process.env.SMTP_FROM_NAME || 'Showfront';

      const mailOptions = {
        from: `${fromName} <${fromEmail}>`,
        to: email,
        subject: `Your Ticket Receipt - ${eventName}`,
        html: htmlContent,
        attachments,
      };

      this.logger.log('Sending email via SMTP', EmailService.name, {
        to: email,
        from: mailOptions.from,
        subject: mailOptions.subject,
        attachmentCount: attachments.length,
      });

      // Retry logic with exponential backoff
      let lastError: Error | null = null;
      const maxRetries = 3;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const info = await this.transporter.sendMail(mailOptions);

          this.logger.log(
            '✅ Receipt email sent successfully',
            EmailService.name,
            {
              email,
              ticketNumber,
              messageId: info.messageId,
              response: info.response,
              attempt: attempt + 1,
            },
          );

          return {
            success: true,
            message: `Receipt sent to ${email}`,
          };
        } catch (retryError: any) {
          lastError = retryError;
          this.logger.warn(
            `Email send attempt ${attempt + 1}/${maxRetries} failed`,
            EmailService.name,
            { error: retryError.message, email, ticketNumber },
          );

          if (attempt < maxRetries - 1) {
            const delayMs = Math.pow(2, attempt) * 1000;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }

      throw lastError;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack =
        error instanceof Error ? error.stack : 'No stack trace';

      this.logger.error('❌ Failed to send receipt email', EmailService.name, {
        ticketNumber: ticketData.ticketNumber,
        email: ticketData.email,
        errorMessage,
        errorStack,
        smtpConfig: {
          host: process.env.SMTP_HOST || process.env.MAIL_HOST || 'NOT SET',
          port: process.env.SMTP_PORT || process.env.MAIL_PORT || 'NOT SET',
          user:
            process.env.SMTP_USER || process.env.MAIL_USER
              ? '***configured***'
              : 'NOT SET',
        },
      });

      throw error;
    }
  }

  /**
   * Send bulk receipts
   */
  async sendBulkReceipts(
    tickets: Array<{
      email: string;
      ticketNumber: string;
      eventName: string;
      purchaseDate: string;
      totalAmount: number;
      customerName: string;
    }>,
  ): Promise<{ success: number; failed: number; errors: any[] }> {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as any[],
    };

    for (const ticket of tickets) {
      try {
        await this.sendTicketReceipt(ticket);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          ticketNumber: ticket.ticketNumber,
          email: ticket.email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }
}
