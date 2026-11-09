/**
 * Generate professional HTML email template for ticket receipt
 * Design matches Showfront website (amber/stone color scheme)
 * PDF-optimized for attachment
 */
export function generateReceiptHTML(
  ticketData: {
    ticketNumber: string;
    customerName: string;
    customerEmail: string;
    price: number;
    ticketType: string;
    createdAt?: Date;
    qrCode?: string;
    seats?: Array<{ sectionId?: string; seatId: string }>;
  },
  eventData: {
    name: string;
    date?: Date;
    location?: string;
    description?: string;
    image?: string;
  },
  options?: {
    includeQrCode?: boolean; // Include QR code in the HTML (for PDF), false for email
  },
): string {
  const eventDate = eventData.date ? new Date(eventData.date) : null;
  const formattedEventDate = eventDate
    ? eventDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'TBA';

  const eventTime = eventDate
    ? eventDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'TBA';

  const purchaseDate = ticketData.createdAt
    ? new Date(ticketData.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : new Date().toLocaleDateString();

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Ticket Receipt - ${ticketData.ticketNumber}</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          html {
            font-size: 16px;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background-color: #fafaf9;
            padding: 20px;
            color: #292524;
            line-height: 1.6;
          }
          .receipt-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
          }
          
          /* Header */
          .header {
            background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
            padding: 40px 30px;
            text-align: center;
            color: white;
          }
          .header h1 {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
          }
          .header-subtitle {
            font-size: 14px;
            opacity: 0.95;
            font-weight: 500;
          }
          
          /* Body */
          .receipt-body {
            padding: 40px 30px;
          }
          
          /* Greeting */
          .greeting {
            font-size: 16px;
            color: #292524;
            margin-bottom: 24px;
            line-height: 1.5;
          }
          .greeting strong {
            color: #b45309;
            font-weight: 600;
          }
          
          /* Section */
          .section {
            margin-bottom: 28px;
          }
          @media print {
            .section {
              page-break-inside: avoid;
            }
          }
          .section-title {
            font-size: 13px;
            font-weight: 700;
            color: #b45309;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 16px;
            padding-bottom: 10px;
            border-bottom: 2px solid #fcd34d;
          }
          
          /* Event Details */
          .event-details {
            background-color: #fffbeb;
            border-left: 4px solid #d97706;
            padding: 16px;
            border-radius: 6px;
            margin-bottom: 16px;
          }
          .event-detail-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
            font-size: 14px;
          }
          .event-detail-row:last-child {
            margin-bottom: 0;
          }
          .event-detail-label {
            font-weight: 600;
            color: #78350f;
            width: 100px;
          }
          .event-detail-value {
            color: #292524;
            flex: 1;
            text-align: right;
          }
          
          /* Ticket Info */
          .ticket-info {
            background-color: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 16px;
          }
          .ticket-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            font-size: 14px;
            padding: 12px 0;
            border-bottom: 1px solid #e5e7eb;
          }
          .ticket-row:last-child {
            margin-bottom: 0;
            padding-bottom: 0;
            border-bottom: none;
          }
          .ticket-label {
            font-weight: 600;
            color: #6b7280;
            min-width: 120px;
          }
          .ticket-value {
            color: #292524;
            font-weight: 500;
            text-align: right;
            flex: 1;
          }
          .ticket-number {
            font-family: 'Courier New', monospace;
            font-weight: 700;
          }
          .ticket-type-badge {
            display: inline-block;
            background-color: #fcd34d;
            color: #78350f;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 700;
          }
          
          /* Price Section */
          .price-section {
            background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            margin-bottom: 24px;
          }
          .price-label {
            font-size: 12px;
            font-weight: 700;
            color: #92400e;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
          }
          .price-amount {
            font-size: 32px;
            font-weight: 700;
            color: #b45309;
          }
          
          /* QR Code Section */
          .qr-section {
            text-align: center;
            padding: 20px;
            background-color: #f9fafb;
            border-radius: 8px;
            margin-bottom: 24px;
          }
          .qr-section p {
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .qr-code-img {
            max-width: 150px;
            height: auto;
            border: 2px solid #e5e7eb;
            border-radius: 6px;
            padding: 8px;
            background: white;
          }
          
          /* Important Notice */
          .important-notice {
            background-color: #f0fdf4;
            border: 1px solid #dcfce7;
            border-left: 4px solid #22c55e;
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 24px;
          }
          .important-notice p {
            font-size: 13px;
            color: #166534;
            margin: 0;
          }
          .important-notice strong {
            font-weight: 700;
          }
          
          /* Footer */
          .footer {
            border-top: 1px solid #e5e7eb;
            padding-top: 20px;
            margin-top: 24px;
            text-align: center;
            font-size: 12px;
            color: #6b7280;
          }
          .footer p {
            margin-bottom: 8px;
          }
          
          @media (max-width: 600px) {
            .receipt-container {
              border-radius: 0;
            }
            .receipt-body {
              padding: 24px 20px;
            }
            .header {
              padding: 32px 20px;
            }
            .header h1 {
              font-size: 24px;
            }
            .event-detail-row {
              flex-direction: column;
              align-items: flex-start;
            }
            .event-detail-value {
              text-align: left;
              margin-top: 4px;
            }
            .price-amount {
              font-size: 28px;
            }
          }
          
          @media print {
            body {
              background: white;
              padding: 0;
            }
            .receipt-container {
              box-shadow: none;
              border-radius: 0;
            }
          }
        </style>
      </head>
      <body>
        <div class="receipt-container">
          <!-- Header -->
          <div class="header">
            <h1>✓ Booking Confirmed</h1>
            <p class="header-subtitle">Your ticket is ready</p>
          </div>
          
          <!-- Body -->
          <div class="receipt-body">
            <!-- Greeting -->
            <div class="greeting">
              Thank you, <strong>${ticketData.customerName}</strong>! Your ticket has been successfully purchased and confirmed.
            </div>
            
            <!-- Event Details Section -->
            <div class="section">
              <h2 class="section-title">Event Details</h2>
              <div class="event-details">
                <div class="event-detail-row">
                  <span class="event-detail-label">Event</span>
                  <span class="event-detail-value" style="text-align: right; font-weight: 600; color: #d97706;">${eventData.name}</span>
                </div>
                <div class="event-detail-row">
                  <span class="event-detail-label">Date</span>
                  <span class="event-detail-value">${formattedEventDate}</span>
                </div>
                <div class="event-detail-row">
                  <span class="event-detail-label">Time</span>
                  <span class="event-detail-value">${eventTime}</span>
                </div>
                ${
                  eventData.location
                    ? `
                <div class="event-detail-row">
                  <span class="event-detail-label">Location</span>
                  <span class="event-detail-value">${eventData.location}</span>
                </div>
                `
                    : ''
                }
              </div>
            </div>
            
            <!-- Ticket Information Section -->
            <div class="section">
              <h2 class="section-title">Ticket Information</h2>
              <div class="ticket-info">
                <div class="ticket-row">
                  <span class="ticket-label">Ticket Number</span>
                  <span class="ticket-value ticket-number">${ticketData.ticketNumber}</span>
                </div>
                <div class="ticket-row">
                  <span class="ticket-label">Ticket Type</span>
                  <span class="ticket-type-badge">${ticketData.ticketType}</span>
                </div>
                <div class="ticket-row">
                  <span class="ticket-label">Purchase Date</span>
                  <span class="ticket-value">${purchaseDate}</span>
                </div>
                <div class="ticket-row">
                  <span class="ticket-label">Total Amount</span>
                  <span class="ticket-value" style="font-weight: 700; color: #b45309; font-size: 16px;">$${ticketData.price.toFixed(2)}</span>
                </div>
              </div>
            </div>
            
            <!-- Seats Section (if available) -->
            ${
              ticketData.seats && ticketData.seats.length > 0
                ? `
            <div class="section" style="page-break-before: avoid; page-break-inside: avoid; margin-top: 60px;">
              <h2 class="section-title">Seats</h2>
              <div class="ticket-info">
                ${ticketData.seats
                  .map((seat, index) => {
                    // Parse seatId format like "S2-B5" to extract section number and seat number
                    const seatIdMatch = seat.seatId.match(/^S(\d+)-(.+)$/);
                    const sectionNumber = seatIdMatch ? seatIdMatch[1] : '';
                    const seatNumber = seatIdMatch
                      ? seatIdMatch[2]
                      : seat.seatId;
                    return `
                <div class="ticket-row">
                  <span class="ticket-label">Seat ${index + 1}</span>
                  <span class="ticket-value">Section ${sectionNumber} Number ${seatNumber} (${seat.seatId})</span>
                </div>
                `;
                  })
                  .join('')}
              </div>
            </div>
            `
                : ''
            }
            
            <!-- Price Highlight -->
            <div class="price-section">
              <div class="price-label">Total Paid</div>
              <div class="price-amount">$${ticketData.price.toFixed(2)}</div>
            </div>
            
            <!-- QR Code Section -->
            ${
              ticketData.qrCode && options?.includeQrCode
                ? `
            <div class="section">
              <h2 class="section-title">QR Code</h2>
              <div class="qr-section">
                <p>Show this QR code at the event entrance</p>
                <img src="${ticketData.qrCode}" alt="QR Code" class="qr-code-img">
              </div>
            </div>
            `
                : ''
            }
            
            <!-- Important Notice -->
            <div class="important-notice">
              <p><strong>✓ Important:</strong> This receipt is your official ticket. Please keep it safe for your records and bring it or your ticket number to the event entrance.</p>
            </div>
            
            <!-- Footer -->
            <div class="footer">
              <p>Thank you for your purchase!</p>
              <p>For support, contact <strong>support@showfront.events</strong></p>
              <p style="margin-top: 16px; color: #9ca3af;">© Showfront Events. All rights reserved.</p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  return htmlContent;
}
