import { Injectable } from '@nestjs/common';
import sgMail from '@sendgrid/mail';
import PDFDocument from 'pdfkit';
import { AppLogger } from '../common/utils/logger';
import { generateReceiptHTML } from './receipt-generator';

@Injectable()
export class SendGridService {
  private readonly logger = new AppLogger();
  private isConfigured = false;

  constructor() {
    this.initializeSendGrid();
  }

  private initializeSendGrid() {
    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;

    if (!apiKey || !fromEmail) {
      this.logger.warn(
        'SendGrid not configured - email sending disabled',
        SendGridService.name,
        { hasApiKey: !!apiKey, hasEmail: !!fromEmail },
      );
      this.isConfigured = false;
      return;
    }

    sgMail.setApiKey(apiKey);
    const baseUrl = `${(
      process.env.SENDGRID_BASE_URL || 'https://app.mailroomly.com'
    ).replace(/\/+$/, '')}/`;
    (
      sgMail as unknown as {
        client: { setDefaultRequest: (key: string, value: string) => void };
      }
    ).client.setDefaultRequest('baseUrl', baseUrl);
    this.isConfigured = true;
    this.logger.log('Mail client initialized', SendGridService.name, {
      fromEmail,
      baseUrl,
    });
  }

  private mailErrorDetails(error: any) {
    const body = error?.response?.body;
    return {
      message: error?.message,
      status: error?.code ?? error?.response?.statusCode,
      body:
        typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined,
    };
  }

  /**
   * Generate PDF from structured ticket data using PDFKit
   * Clean, elegant design with Showfront brand colors (amber/gold)
   * Returns Buffer or null if generation fails
   */
  async generatePdfFromData(ticketData: {
    ticketNumber: string;
    eventName: string;
    customerName: string;
    amount: number;
    purchaseDate: string;
    eventDate?: string;
    eventTime?: string;
    eventLocation?: string;
    ticketType?: string;
    seats?: Array<{ sectionId?: string; seatId: string }>;
    qrCodeDataUrl?: string;
  }): Promise<Buffer | null> {
    try {
      this.logger.log('Generating PDF with PDFKit', SendGridService.name);

      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
      });

      const pageWidth = 595.28;
      const pageHeight = 841.89;
      const marginLeft = 50;
      const marginRight = 50;
      const contentWidth = pageWidth - marginLeft - marginRight;

      // ======== BRAND COLORS (Showfront - Amber/Stone palette) ========
      const colors = {
        amber600: '#d97706', // Primary brand color
        amber700: '#b45309', // Darker amber
        amber100: '#fef3c7', // Light amber background
        stone800: '#292524', // Dark text
        stone600: '#57534e', // Secondary text
        stone400: '#a8a29e', // Muted text
        stone200: '#e7e5e4', // Light borders
        stone100: '#f5f5f4', // Light background
        white: '#ffffff',
      };

      // ======== HEADER - Amber gradient effect ========
      doc.rect(0, 0, pageWidth, 100).fill(colors.amber600);

      // Brand name
      doc
        .font('Helvetica-Bold')
        .fontSize(14)
        .fillColor(colors.white)
        .text('GOLDEN MOMENT', marginLeft, 25, {
          width: contentWidth,
          align: 'center',
        });

      // Main heading
      doc
        .font('Helvetica-Bold')
        .fontSize(28)
        .fillColor(colors.white)
        .text('Booking Confirmed', marginLeft, 50, {
          width: contentWidth,
          align: 'center',
        });

      // Decorative line under header
      doc
        .moveTo(pageWidth / 2 - 60, 95)
        .lineTo(pageWidth / 2 + 60, 95)
        .strokeColor(colors.white)
        .lineWidth(2)
        .stroke();

      let yPos = 130;

      // ======== GREETING ========
      doc
        .font('Helvetica')
        .fontSize(12)
        .fillColor(colors.stone600)
        .text(`Dear ${ticketData.customerName},`, marginLeft, yPos);

      yPos += 20;
      doc
        .fontSize(11)
        .fillColor(colors.stone600)
        .text(
          'Thank you for your purchase! Your ticket has been confirmed. Please find your booking details below.',
          marginLeft,
          yPos,
          { width: contentWidth },
        );

      yPos += 40;

      // ======== TICKET NUMBER - Prominent Display ========
      doc.rect(marginLeft, yPos, contentWidth, 50).fill(colors.stone100);

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(colors.stone600)
        .text('TICKET NUMBER', marginLeft + 20, yPos + 10);

      doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .fillColor(colors.amber700)
        .text(ticketData.ticketNumber, marginLeft + 20, yPos + 25);

      yPos += 70;

      // ======== TWO COLUMN LAYOUT: Event Details & Ticket Info ========
      const colWidth = (contentWidth - 20) / 2;

      // Left Column - Event Details
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(colors.amber600)
        .text('EVENT DETAILS', marginLeft, yPos);

      yPos += 20;
      const eventDetailsStartY = yPos;

      doc.font('Helvetica').fontSize(10).fillColor(colors.stone600);

      doc.text('Event', marginLeft, yPos);
      doc
        .font('Helvetica-Bold')
        .fillColor(colors.stone800)
        .text(ticketData.eventName, marginLeft, yPos + 12, {
          width: colWidth - 10,
        });

      yPos += 35;

      if (ticketData.eventDate) {
        doc
          .font('Helvetica')
          .fillColor(colors.stone600)
          .text('Date', marginLeft, yPos);
        doc
          .font('Helvetica-Bold')
          .fillColor(colors.stone800)
          .text(ticketData.eventDate, marginLeft, yPos + 12);
        yPos += 35;
      }

      if (ticketData.eventTime) {
        doc
          .font('Helvetica')
          .fillColor(colors.stone600)
          .text('Time', marginLeft, yPos);
        doc
          .font('Helvetica-Bold')
          .fillColor(colors.stone800)
          .text(ticketData.eventTime, marginLeft, yPos + 12);
        yPos += 35;
      }

      if (ticketData.eventLocation) {
        doc
          .font('Helvetica')
          .fillColor(colors.stone600)
          .text('Venue', marginLeft, yPos);
        doc
          .font('Helvetica-Bold')
          .fillColor(colors.stone800)
          .text(ticketData.eventLocation, marginLeft, yPos + 12, {
            width: colWidth - 10,
          });
        yPos += 35;
      }

      // Right Column - Ticket Info (positioned at same starting Y)
      const rightColX = marginLeft + colWidth + 20;
      let rightY = eventDetailsStartY - 20;

      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(colors.amber600)
        .text('PURCHASE DETAILS', rightColX, rightY);

      rightY += 20;

      doc.font('Helvetica').fontSize(10).fillColor(colors.stone600);

      if (ticketData.ticketType) {
        doc.text('Ticket Type', rightColX, rightY);
        doc
          .font('Helvetica-Bold')
          .fillColor(colors.stone800)
          .text(ticketData.ticketType, rightColX, rightY + 12);
        rightY += 35;
      }

      doc
        .font('Helvetica')
        .fillColor(colors.stone600)
        .text('Purchase Date', rightColX, rightY);
      doc
        .font('Helvetica-Bold')
        .fillColor(colors.stone800)
        .text(ticketData.purchaseDate, rightColX, rightY + 12);
      rightY += 35;

      doc
        .font('Helvetica')
        .fillColor(colors.stone600)
        .text('Amount Paid', rightColX, rightY);
      doc
        .font('Helvetica-Bold')
        .fontSize(16)
        .fillColor(colors.amber700)
        .text(`$${ticketData.amount.toFixed(2)}`, rightColX, rightY + 12);

      // Update yPos to be below both columns
      yPos = Math.max(yPos, rightY + 40);

      // ======== SEATS SECTION (if applicable) ========
      if (ticketData.seats && ticketData.seats.length > 0) {
        // Separator line
        doc
          .moveTo(marginLeft, yPos)
          .lineTo(marginLeft + contentWidth, yPos)
          .strokeColor(colors.stone200)
          .lineWidth(1)
          .stroke();

        yPos += 15;

        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .fillColor(colors.amber600)
          .text('SEAT ASSIGNMENT', marginLeft, yPos);

        yPos += 15;
        doc.font('Helvetica').fontSize(10).fillColor(colors.stone800);

        ticketData.seats.forEach((seat, index) => {
          // Parse seatId format (e.g., S2-D4 -> Section 2, Seat D4)
          const seatIdStr = seat.seatId || '';
          let sectionNum = '';
          let seatNum = '';

          if (seatIdStr.includes('-')) {
            const parts = seatIdStr.split('-');
            // Extract section number from S2 -> 2
            sectionNum = parts[0].replace('S', '') || 'General';
            seatNum = parts[1] || '';
          } else {
            seatNum = seatIdStr;
          }

          const seatLabel =
            sectionNum && seatNum
              ? `Section ${sectionNum} • Seat ${seatNum} (${seatIdStr})`
              : `Seat ${seatIdStr}`;
          doc.text(`${index + 1}. ${seatLabel}`, marginLeft + 10, yPos);
          yPos += 16;
        });

        yPos += 5;
      }

      // ======== QR CODE SECTION - Large and prominent (ALWAYS on Page 2) ========
      if (ticketData.qrCodeDataUrl) {
        try {
          // Force page break - QR code always starts on page 2
          doc.addPage();

          // Reset position for new page
          let page2Pos = marginLeft;

          // QR Code label
          doc
            .font('Helvetica-Bold')
            .fontSize(11)
            .fillColor(colors.amber600)
            .text('YOUR ENTRY QR CODE', marginLeft, page2Pos, {
              width: contentWidth,
              align: 'center',
            });

          page2Pos += 25;

          // Convert data URL to buffer
          const base64Data = ticketData.qrCodeDataUrl.replace(
            /^data:image\/png;base64,/,
            '',
          );
          const qrBuffer = Buffer.from(base64Data, 'base64');

          // Large QR code - doubled size for better scannability
          const qrSize = 200;
          const qrX = (pageWidth - qrSize) / 2;

          // QR code with subtle border
          doc
            .rect(qrX - 10, page2Pos - 5, qrSize + 20, qrSize + 20)
            .fill(colors.white);
          doc
            .rect(qrX - 10, page2Pos - 5, qrSize + 20, qrSize + 20)
            .strokeColor(colors.stone200)
            .lineWidth(1)
            .stroke();

          doc.image(qrBuffer, qrX, page2Pos, { width: qrSize, height: qrSize });

          page2Pos += qrSize + 20;

          // Scan instruction
          doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .fillColor(colors.stone800)
            .text(
              'Present this QR code at the event entrance',
              marginLeft,
              page2Pos,
              {
                width: contentWidth,
                align: 'center',
              },
            );

          page2Pos += 25;

          // Separator line before footer
          doc
            .moveTo(marginLeft, page2Pos)
            .lineTo(marginLeft + contentWidth, page2Pos)
            .strokeColor(colors.stone200)
            .lineWidth(1)
            .stroke();

          page2Pos += 15;

          // Footer content
          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor(colors.stone600)
            .text(
              'Keep this receipt safe. This is your official ticket confirmation.',
              marginLeft,
              page2Pos,
              { width: contentWidth, align: 'center' },
            );

          page2Pos += 12;
          doc
            .fontSize(9)
            .fillColor(colors.stone400)
            .text(
              'Questions? Contact support@showfront.events',
              marginLeft,
              page2Pos,
              { width: contentWidth, align: 'center' },
            );

          page2Pos += 12;
          doc
            .fontSize(8)
            .fillColor(colors.stone400)
            .text(
              '© Showfront Events. All rights reserved.',
              marginLeft,
              page2Pos,
              { width: contentWidth, align: 'center' },
            );
        } catch (qrError: any) {
          this.logger.warn('QR code embedding failed', SendGridService.name, {
            error: qrError.message,
          });
        }
      }

      // Convert stream to buffer
      const chunks: Buffer[] = [];
      return new Promise((resolve, reject) => {
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (err) => {
          this.logger.error('PDF generation failed', SendGridService.name, {
            error: err.message,
          });
          reject(err);
        });
        doc.end();
      });
    } catch (error: any) {
      this.logger.warn('PDF generation error', SendGridService.name, {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Legacy method - generate PDF from HTML (kept for backwards compatibility)
   * Returns Buffer or null if generation fails
   */
  async generatePdfFromHtml(htmlContent: string): Promise<Buffer | null> {
    try {
      this.logger.log('Generating PDF with PDFKit', SendGridService.name);

      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
      });

      // Extract key information from HTML

      const ticketMatch = htmlContent.match(
        /Ticket Number[^<]*<[^>]*>([^<]+)</i,
      );
      const ticketNumber = ticketMatch ? ticketMatch[1].trim() : 'N/A';

      const eventMatch = htmlContent.match(/Event[^<]*<[^>]*>([^<]+)</i);
      const eventName = eventMatch ? eventMatch[1].trim() : 'Event';

      const customerMatch = htmlContent.match(
        /Thank you[,\s]+([^<]+[a-zA-Z])/i,
      );
      const customerName = customerMatch
        ? customerMatch[1].trim()
        : 'Valued Customer';

      const amountMatch = htmlContent.match(
        /Total\s+(?:Amount|Paid)[^<]*<[^>]*>([^<]+)</i,
      );
      const amount = amountMatch ? amountMatch[1].trim() : '$0.00';

      const dateMatch = htmlContent.match(/Purchase Date[^<]*<[^>]*>([^<]+)</i);
      const purchaseDate = dateMatch
        ? dateMatch[1].trim()
        : new Date().toLocaleDateString();

      // Header
      doc
        .fontSize(20)
        .font('Helvetica-Bold')
        .text('TICKET RECEIPT', { align: 'center' })
        .fontSize(11)
        .font('Helvetica')
        .text('Your booking is confirmed', { align: 'center' })
        .moveDown(0.5);

      // Orange divider line
      doc
        .strokeColor(217, 119, 6)
        .moveTo(40, doc.y)
        .lineTo(555, doc.y)
        .stroke()
        .moveDown(1);

      // Event Section
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .fillColor(184, 83, 9)
        .text('EVENT DETAILS', { underline: true })
        .moveDown(0.3);

      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor(0, 0, 0)
        .text(`Event: ${eventName}`, { indent: 10 })
        .text(`Ticket Number: ${ticketNumber}`, { indent: 10 })
        .text(`Purchase Date: ${purchaseDate}`, { indent: 10 })
        .moveDown(0.5);

      // Price Section
      doc
        .fontSize(10)
        .font('Helvetica')
        .text('Total Amount:', { indent: 10 })
        .moveDown(0.2)
        .fontSize(24)
        .font('Helvetica-Bold')
        .fillColor(217, 119, 6)
        .text(amount, { indent: 20 })
        .moveDown(0.8);

      // Reset color
      doc.fillColor(0, 0, 0);

      // Gray divider line
      doc
        .strokeColor(229, 231, 235)
        .moveTo(40, doc.y)
        .lineTo(555, doc.y)
        .stroke()
        .moveDown(1);

      // Important Notice
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor(22, 101, 52)
        .text(
          'IMPORTANT: This is your official ticket. Please keep it safe and bring it to the event entrance.',
          { align: 'left', width: 515 },
        )
        .moveDown(1);

      // Footer
      doc
        .fillColor(107, 114, 128)
        .fontSize(9)
        .font('Helvetica')
        .text('Showfront Events', { align: 'center' })
        .text('Thank you for your purchase!', { align: 'center' })
        .moveDown(0.3)
        .fontSize(8)
        .fillColor(156, 163, 175)
        .text(`Generated: ${new Date().toLocaleDateString()}`, {
          align: 'center',
        });

      // Convert stream to buffer
      const chunks: Buffer[] = [];
      return new Promise((resolve, reject) => {
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (err) => {
          this.logger.error('PDF generation failed', SendGridService.name, {
            error: err.message,
          });
          reject(err);
        });
        doc.end();
      });
    } catch (error: any) {
      this.logger.warn('PDF generation error', SendGridService.name, {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Simple HTML to text extraction
   */
  private extractTextFromHtml(html: string): string {
    // Remove script and style tags
    let text = html.replace(
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      '',
    );
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    // Remove HTML tags
    text = text.replace(/<[^>]*>/g, '');
    // Decode HTML entities
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    return text;
  }

  /**
   * Send verification email via SendGrid
   */
  async sendVerificationEmail(
    email: string,
    token: string,
    frontendUrl?: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.isConfigured) {
      this.logger.warn(
        'SendGrid not configured - skipping email send',
        SendGridService.name,
        { email },
      );
      return {
        success: false,
        message: 'Email service not configured',
      };
    }

    try {
      const verificationUrl = `${frontendUrl || process.env.FRONTEND_URL}/auth/verify-email?token=${token}`;

      const msg = {
        to: email,
        from: `${process.env.SENDGRID_FROM_NAME || 'Showfront'} <${process.env.SENDGRID_FROM_EMAIL}>`,
        subject: '✨ Verify Your Showfront Account',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
              .button { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
              .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🎉 Welcome to Showfront!</h1>
              </div>
              <div class="content">
                <p>Hi there,</p>
                <p>Thank you for signing up! We're excited to have you join our community of event enthusiasts.</p>
                <p>To get started, please verify your email address by clicking the button below:</p>
                <div style="text-align: center;">
                  <a href="${verificationUrl}" class="button">Verify Email Address</a>
                </div>
                <p>Or copy and paste this link into your browser:</p>
                <p style="word-break: break-all; color: #f59e0b;">${verificationUrl}</p>
                <p><strong>This link will expire in 24 hours.</strong></p>
                <p>If you didn't create an account with Showfront, please ignore this email.</p>
              </div>
              <div class="footer">
                <p>Showfront Events © 2026</p>
                <p>Tunis, Tunisia</p>
              </div>
            </div>
          </body>
          </html>
        `,
      };

      await sgMail.send(msg as any);

      this.logger.log(
        'Verification email sent successfully',
        SendGridService.name,
        {
          email,
        },
      );

      return {
        success: true,
        message: `Verification email sent to ${email}`,
      };
    } catch (error: any) {
      this.logger.error(
        'Failed to send verification email',
        SendGridService.name,
        { email, ...this.mailErrorDetails(error) },
      );
      throw error;
    }
  }

  /**
   * Send ticket receipt email via SendGrid
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
    if (!this.isConfigured) {
      this.logger.warn(
        'SendGrid not configured - skipping email send',
        SendGridService.name,
        { email: ticketData.email },
      );
      return {
        success: false,
        message: 'Email service not configured',
      };
    }

    try {
      const { email, ticketNumber, eventName, customerName } = ticketData;

      this.logger.log(
        'Sending ticket receipt via SendGrid',
        SendGridService.name,
        {
          email,
          ticketNumber,
          eventName,
          attachPdf: options?.attachPdf,
        },
      );

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
          includeQrCode: false, // Don't include QR in email body
        },
      );

      const attachments: any[] = [];

      // Generate PDF if requested
      if (options?.attachPdf) {
        try {
          // Format event date and time
          let eventDateStr = '';
          let eventTimeStr = '';
          if (ticketData.eventDate) {
            const date = new Date(ticketData.eventDate);
            eventDateStr = date.toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            });
            eventTimeStr = date.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            });
          }

          const pdfBuffer = await this.generatePdfFromData({
            ticketNumber,
            eventName,
            customerName,
            amount: ticketData.totalAmount,
            purchaseDate: ticketData.purchaseDate,
            eventDate: eventDateStr,
            eventTime: eventTimeStr,
            eventLocation: ticketData.eventLocation,
            ticketType: ticketData.ticketType,
            seats: ticketData.seats,
            qrCodeDataUrl: ticketData.qrCode,
          });
          if (pdfBuffer) {
            attachments.push({
              filename: `receipt_${ticketNumber}.pdf`,
              content: pdfBuffer.toString('base64'),
              type: 'application/pdf',
            });
            this.logger.log('PDF attachment generated', SendGridService.name, {
              ticketNumber,
            });
          }
        } catch (pdfError: any) {
          this.logger.warn(
            'PDF generation failed - sending without attachment',
            SendGridService.name,
            { error: pdfError.message },
          );
        }
      }

      const msg = {
        to: email,
        from: `${process.env.SENDGRID_FROM_NAME || 'Showfront'} <${process.env.SENDGRID_FROM_EMAIL}>`,
        subject: `Your Ticket Receipt - ${eventName}`,
        html: htmlContent,
        attachments,
      };

      await sgMail.send(msg as any);

      this.logger.log('Receipt email sent successfully', SendGridService.name, {
        email,
        ticketNumber,
        attachmentCount: attachments.length,
      });

      return {
        success: true,
        message: `Receipt sent to ${email}`,
      };
    } catch (error: any) {
      this.logger.error('Failed to send receipt email', SendGridService.name, {
        ticketNumber: ticketData.ticketNumber,
        email: ticketData.email,
        ...this.mailErrorDetails(error),
      });
      throw error;
    }
  }

  /**
   * Send password reset email via SendGrid
   */
  async sendPasswordResetEmail(
    email: string,
    token: string,
    frontendUrl?: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.isConfigured) {
      this.logger.warn(
        'SendGrid not configured - skipping email send',
        SendGridService.name,
        { email },
      );
      return {
        success: false,
        message: 'Email service not configured',
      };
    }

    try {
      const resetUrl = `${frontendUrl || process.env.FRONTEND_URL}/auth/reset-password?token=${token}`;

      const msg = {
        to: email,
        from: `${process.env.SENDGRID_FROM_NAME || 'Showfront'} <${process.env.SENDGRID_FROM_EMAIL}>`,
        subject: '🔐 Reset Your Showfront Password',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
              .button { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
              .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
              .warning { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🔐 Password Reset Request</h1>
              </div>
              <div class="content">
                <p>Hello,</p>
                <p>We received a request to reset your password for your Showfront account.</p>
                <p>Click the button below to reset your password:</p>
                <div style="text-align: center;">
                  <a href="${resetUrl}" class="button">Reset Password</a>
                </div>
                <p>Or copy and paste this link into your browser:</p>
                <p style="word-break: break-all; color: #f59e0b;">${resetUrl}</p>
                <div class="warning">
                  <strong>⚠️ This link will expire in 1 hour.</strong><br>
                  If you did not request a password reset, please ignore this email or contact our support team.
                </div>
                <p>For security reasons, we recommend using a strong password that includes uppercase and lowercase letters, numbers, and special characters.</p>
              </div>
              <div class="footer">
                <p>Showfront Events © 2026</p>
                <p>Tunis, Tunisia</p>
              </div>
            </div>
          </body>
          </html>
        `,
      };

      await sgMail.send(msg as any);

      this.logger.log(
        'Password reset email sent successfully',
        SendGridService.name,
        {
          email,
        },
      );

      return {
        success: true,
        message: `Password reset email sent to ${email}`,
      };
    } catch (error: any) {
      this.logger.error(
        'Failed to send password reset email',
        SendGridService.name,
        { email, ...this.mailErrorDetails(error) },
      );
      throw error;
    }
  }

  /**
   * Send password reset confirmation email via SendGrid
   */
  async sendPasswordResetConfirmation(
    email: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.isConfigured) {
      this.logger.warn(
        'SendGrid not configured - skipping email send',
        SendGridService.name,
        { email },
      );
      return {
        success: false,
        message: 'Email service not configured',
      };
    }

    try {
      const msg = {
        to: email,
        from: `${process.env.SENDGRID_FROM_NAME || 'Showfront'} <${process.env.SENDGRID_FROM_EMAIL}>`,
        subject: '✅ Password Changed Successfully',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
              .button { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
              .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
              .success { background-color: #d1fae5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>✅ Password Changed Successfully</h1>
              </div>
              <div class="content">
                <p>Hello,</p>
                <p>Your password has been successfully changed.</p>
                <div class="success">
                  <strong>✓ Your account is now secure with your new password.</strong>
                </div>
                <p>You can now log in with your new password:</p>
                <div style="text-align: center;">
                  <a href="${process.env.FRONTEND_URL || 'https://www.showfront.events'}/auth/login" class="button">Log In to Your Account</a>
                </div>
                <p>If you did not make this change or have any concerns about your account security, please contact our support team immediately.</p>
              </div>
              <div class="footer">
                <p>Showfront Events © 2026</p>
                <p>Tunis, Tunisia</p>
              </div>
            </div>
          </body>
          </html>
        `,
      };

      await sgMail.send(msg as any);

      this.logger.log(
        'Password reset confirmation sent successfully',
        SendGridService.name,
        {
          email,
        },
      );

      return {
        success: true,
        message: `Confirmation email sent to ${email}`,
      };
    } catch (error: any) {
      this.logger.error(
        'Failed to send password reset confirmation',
        SendGridService.name,
        { email, ...this.mailErrorDetails(error) },
      );
      throw error;
    }
  }
}
