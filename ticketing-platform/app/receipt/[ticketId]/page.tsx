'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { ticketsAPI, paymentsAPI } from '@/lib/api';
import Link from 'next/link';
import jsPDF from 'jspdf';

interface Ticket {
  _id: string;
  ticketNumber: string;
  paymentId?: string;
  eventId:
    | {
        _id: string;
        name: string;
        description: string;
        date: string;
        venue: string;
      }
    | string;
  seats: Array<{ sectionId?: string; seatId: string }>;
  buyerName: string;
  buyerEmail: string;
  buyerPhoneNumber: string;
  purchaseDate: string;
  qrCode: string;
}

interface Payment {
  _id: string;
  amount: number;
  status: string;
  paidAt: string;
  metadata?: {
    buyerEmail: string;
    buyerName: string;
    buyerPhoneNumber: string;
  };
}

export default function ReceiptPage() {
  const params = useParams();
  const ticketId = params.ticketId as string;
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchTicketOrPayment = async () => {
      try {
        // First, try to fetch as ticket ID (most common case)
        try {
          const response = await ticketsAPI.getById(ticketId);
          const ticketData = response.data.data || response.data;

          // Check if event has expired
          if (ticketData.eventId && typeof ticketData.eventId === 'object') {
            const eventDate = new Date(ticketData.eventId.date);
            const now = new Date();
            if (eventDate < now) {
              setError('TICKET_EXPIRED');
              setLoading(false);
              return;
            }
          }

          setTicket(ticketData);

          // If ticket has paymentId, fetch payment details
          if (ticketData.paymentId) {
            try {
              const paymentResponse = await paymentsAPI.getPayment(
                ticketData.paymentId,
              );
              const paymentData =
                paymentResponse.data.data || paymentResponse.data;
              setPayment(paymentData);
            } catch (paymentErr) {
              console.warn(
                '[Receipt Page] Could not fetch payment details:',
                paymentErr,
              );
              // Continue without payment data
            }
          }

          setLoading(false);
          return;
        } catch (ticketErr) {
          // Not a ticket ID, try as payment ID (for legacy flow)
          const paymentResponse = await paymentsAPI.getPayment(ticketId);
          const paymentData = paymentResponse.data.data || paymentResponse.data;
          setPayment(paymentData);
          setLoading(false);
          return;
        }
      } catch (err: any) {
        // Handle different error types
        if (err.response?.status === 404) {
          setError('Ticket or payment not found');
        } else if (err.response?.status === 500) {
          setError('Server error. Please try again later.');
        } else {
          setError(
            'Failed to load receipt. Please check the ID and try again.',
          );
        }
        console.error('[Receipt Page] Error fetching receipt:', err);
        setLoading(false);
      }
    };

    if (ticketId) {
      fetchTicketOrPayment();
    }
  }, [ticketId]);

  const handleDownloadPDF = async () => {
    if (!ticket) return;

    setDownloading(true);

    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = pdf.internal.pageSize.getWidth();

      const eventInfo =
        typeof ticket.eventId === 'object' ? ticket.eventId : null;
      const eventDate = eventInfo ? new Date(eventInfo.date) : new Date();

      // Header
      pdf.setFillColor(41, 37, 36);
      pdf.rect(0, 0, pageWidth, 60, 'F');

      // Logo
      pdf.setFillColor(245, 158, 11);
      pdf.roundedRect(20, 15, 16, 16, 3, 3, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text('G', 25, 26);

      pdf.setFontSize(18);
      pdf.setTextColor(255, 255, 255);
      pdf.text('Showfront Events', 42, 22);

      pdf.setFontSize(10);
      pdf.setTextColor(168, 162, 158);
      pdf.text('E-Ticket / Entry Pass', 42, 30);

      // Ticket number
      pdf.setFillColor(245, 158, 11);
      pdf.roundedRect(pageWidth - 55, 18, 40, 12, 2, 2, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.text(ticket.ticketNumber, pageWidth - 35, 26, { align: 'center' });

      // Event title
      pdf.setTextColor(41, 37, 36);
      pdf.setFontSize(24);
      pdf.setFont('helvetica', 'bold');
      const eventName = eventInfo?.name || 'Event';
      pdf.text(eventName, 20, 80);

      // Main Section - Split vertically (1:3 ratio - seats : date/reserved)
      const pageMargins = 20;
      const availableWidth = pageWidth - pageMargins * 2 - 5; // 5mm gap
      const seatSectionWidth = availableWidth / 4; // 1 part for seats
      const dateReservedWidth = (availableWidth * 3) / 4; // 3 parts for date & reserved
      const seatSectionStartX = pageMargins;
      const dateReservedStartX = seatSectionStartX + seatSectionWidth + 5; // 5mm gap
      const sectionHeight = 95;
      const sectionMargin = 3;
      const sectionY = 90;

      // LEFT SECTION - Seats (narrower)
      pdf.setFillColor(254, 243, 224); // from-amber-50
      pdf.roundedRect(
        seatSectionStartX,
        sectionY,
        seatSectionWidth,
        sectionHeight,
        3,
        3,
        'F',
      );

      pdf.setFontSize(8);
      pdf.setTextColor(180, 83, 9);
      pdf.setFont('helvetica', 'bold');
      pdf.text(
        `SEATS (${ticket.seats.length})`,
        seatSectionStartX + seatSectionWidth / 2,
        sectionY + 8,
        { align: 'center' },
      );

      // Format seat numbers with section info - max 10, with wrapping
      const seatIds = ticket.seats.map((s) => {
        if (s.sectionId) {
          return `${s.sectionId}-${s.seatId}`;
        }
        return s.seatId;
      });
      const seatsPerLine = 1; // Max 1 seat per line to fit section + seat info
      pdf.setFontSize(10);
      pdf.setTextColor(120, 53, 15); // text-amber-900
      pdf.setFont('helvetica', 'bold');

      let seatY = sectionY + 20;
      for (let i = 0; i < Math.min(seatIds.length, 10); i += seatsPerLine) {
        const seatLine = seatIds.slice(i, i + seatsPerLine).join(', ');
        pdf.text(seatLine, seatSectionStartX + seatSectionWidth / 2, seatY, {
          align: 'center',
        });
        seatY += 9;
      }

      // RIGHT SECTION - Date & Time (Top) + Reserved By (Bottom) stacked
      // Top: Date, Time, Venue
      pdf.setFillColor(250, 250, 249); // stone-50
      pdf.roundedRect(
        dateReservedStartX,
        sectionY,
        dateReservedWidth,
        (sectionHeight - sectionMargin) / 2,
        3,
        3,
        'F',
      );

      pdf.setFontSize(7);
      pdf.setTextColor(120, 113, 108);
      pdf.setFont('helvetica', 'bold');
      pdf.text('DATE & TIME', dateReservedStartX + 8, sectionY + 8);

      pdf.setFontSize(9);
      pdf.setTextColor(41, 37, 36);
      pdf.setFont('helvetica', 'bold');
      const dateStr = eventDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      const timeStr = eventDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
      pdf.text(dateStr, dateReservedStartX + 8, sectionY + 16);
      pdf.text(timeStr, dateReservedStartX + 8, sectionY + 23);

      pdf.setFontSize(7);
      pdf.setTextColor(120, 113, 108);
      pdf.setFont('helvetica', 'bold');
      pdf.text('VENUE', dateReservedStartX + 8, sectionY + 31);
      pdf.setFontSize(8);
      pdf.setTextColor(41, 37, 36);
      pdf.setFont('helvetica', 'normal');
      const venueLines = pdf.splitTextToSize(
        eventInfo?.venue || 'TBA',
        dateReservedWidth - 16,
      );
      pdf.text(venueLines, dateReservedStartX + 8, sectionY + 38);

      // Bottom: Reserved by (Name, Email, Phone)
      pdf.setFillColor(245, 245, 244); // stone-50
      pdf.roundedRect(
        dateReservedStartX,
        sectionY + (sectionHeight - sectionMargin) / 2 + sectionMargin,
        dateReservedWidth,
        (sectionHeight - sectionMargin) / 2,
        3,
        3,
        'F',
      );

      let bottomY =
        sectionY + (sectionHeight - sectionMargin) / 2 + sectionMargin + 8;
      pdf.setFontSize(7);
      pdf.setTextColor(120, 113, 108);
      pdf.setFont('helvetica', 'bold');
      pdf.text('RESERVED BY', dateReservedStartX + 8, bottomY);

      bottomY += 7;
      pdf.setFontSize(9);
      pdf.setTextColor(41, 37, 36);
      pdf.setFont('helvetica', 'bold');
      const nameLines = pdf.splitTextToSize(
        ticket.buyerName,
        dateReservedWidth - 16,
      );
      pdf.text(nameLines, dateReservedStartX + 8, bottomY);
      bottomY += nameLines.length * 5 + 2;

      pdf.setFontSize(7);
      pdf.setTextColor(120, 113, 108);
      pdf.setFont('helvetica', 'bold');
      pdf.text('EMAIL', dateReservedStartX + 8, bottomY);
      bottomY += 5;
      pdf.setFontSize(7);
      pdf.setTextColor(87, 83, 82);
      pdf.setFont('helvetica', 'normal');
      const emailLines = pdf.splitTextToSize(
        ticket.buyerEmail,
        dateReservedWidth - 16,
      );
      pdf.text(emailLines, dateReservedStartX + 8, bottomY);
      bottomY += emailLines.length * 4 + 2;

      pdf.setFontSize(7);
      pdf.setTextColor(120, 113, 108);
      pdf.setFont('helvetica', 'bold');
      pdf.text('PHONE', dateReservedStartX + 8, bottomY);
      bottomY += 5;
      pdf.setFontSize(7);
      pdf.setTextColor(87, 83, 82);
      pdf.setFont('helvetica', 'normal');
      const phoneLines = pdf.splitTextToSize(
        ticket.buyerPhoneNumber,
        dateReservedWidth - 16,
      );
      pdf.text(phoneLines, dateReservedStartX + 8, bottomY);

      // QR Section (Dark Stone) - with margin from main section
      const qrMargin = 5;
      const qrY = sectionY + sectionHeight + qrMargin;
      pdf.setFillColor(28, 25, 23); // from-stone-800
      pdf.roundedRect(20, qrY, pageWidth - 40, 70, 3, 3, 'F');

      pdf.setFontSize(10);
      pdf.setTextColor(168, 162, 158); // text-stone-400
      pdf.setFont('helvetica', 'bold');
      pdf.text('SCAN QR CODE FOR ENTRY', pageWidth / 2, qrY + 15, {
        align: 'center',
      });

      if (ticket.qrCode) {
        try {
          const qrSize = 40;
          const qrX = (pageWidth - qrSize) / 2;
          // White background for QR
          pdf.setFillColor(255, 255, 255);
          pdf.rect(qrX - 2, qrY + 20 - 2, qrSize + 4, qrSize + 4, 'F');
          pdf.addImage(ticket.qrCode, 'PNG', qrX, qrY + 20, qrSize, qrSize);
        } catch (qrError) {
          console.error('Error adding QR code:', qrError);
        }
      }

      pdf.setFontSize(8);
      pdf.setTextColor(120, 113, 108);
      pdf.text(
        'Present this QR code at the venue entrance',
        pageWidth / 2,
        qrY + 65,
        { align: 'center' },
      );

      // Purchase date
      const purchaseDate = new Date(ticket.purchaseDate);
      pdf.setFontSize(8);
      pdf.setTextColor(120, 113, 108);
      pdf.text(
        `Purchased on ${purchaseDate.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}`,
        pageWidth / 2,
        265,
        { align: 'center' },
      );

      // Footer (Dark Stone) - extends to bottom of page
      pdf.setFillColor(28, 25, 23); // stone-900
      pdf.rect(0, 285, pageWidth, 12, 'F');

      pdf.setFontSize(8);
      pdf.setTextColor(168, 162, 158);
      pdf.text(
        'Showfront Events • www.showfront.events • support@showfront.events',
        pageWidth / 2,
        290.5,
        { align: 'center' },
      );

      pdf.save(`ticket-${ticket.ticketNumber}.pdf`);
    } catch (err) {
      console.error('Error generating PDF:', err);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-stone-200 border-t-amber-500 rounded-full animate-spin mx-auto"></div>
          <p className="text-stone-600 mt-4">Loading your ticket...</p>
        </div>
      </div>
    );
  }

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-stone-600">Loading ticket...</p>
        </div>
      </div>
    );
  }

  // Show ticket expired error
  if (error === 'TICKET_EXPIRED') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-8 text-center max-w-md shadow-lg border border-stone-200">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-orange-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-stone-900 mb-2">
            Ticket Expired
          </h1>
          <p className="text-stone-600 mb-6">
            The event for this ticket has already passed. This ticket is no
            longer valid.
          </p>
          <Link
            href="/"
            className="inline-block bg-stone-900 text-white px-6 py-3 rounded-xl font-semibold hover:bg-stone-800 transition"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  // Show other errors
  if (error || (!ticket && !payment)) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-8 text-center max-w-md shadow-lg border border-stone-200">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-stone-900 mb-2">
            Ticket Not Found
          </h1>
          <p className="text-stone-600 mb-6">
            {error || "We couldn't find the ticket you're looking for."}
          </p>
          <Link
            href="/"
            className="inline-block bg-stone-900 text-white px-6 py-3 rounded-xl font-semibold hover:bg-stone-800 transition"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  // Show payment receipt if available
  if (payment && !ticket) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-stone-50 via-stone-50 to-amber-50/30">
        {/* Header */}
        <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-stone-200/50 shadow-sm">
          <div className="max-w-5xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <Link
                href="/"
                className="flex items-center gap-3 hover:opacity-80 transition"
              >
                <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-amber-600 rounded-lg flex items-center justify-center shadow-lg shadow-amber-500/20">
                  <span className="text-white font-bold text-lg">S</span>
                </div>
                <span className="font-bold text-stone-900">Showfront</span>
              </Link>
              <h1 className="text-xl font-bold text-stone-900">
                Payment Receipt
              </h1>
              <Link
                href="/"
                className="text-stone-600 hover:text-stone-900 transition"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </Link>
            </div>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-6 py-8">
          {/* Receipt Card */}
          <div className="bg-white rounded-2xl shadow-xl border border-stone-200/50 overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-8 py-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-3xl font-bold text-white mb-2">
                    Payment Confirmed
                  </h2>
                  <p className="text-amber-50">
                    Thank you for your purchase. Your tickets have been created.
                  </p>
                </div>
                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                {/* Left Column - Amount */}
                <div className="bg-gradient-to-br from-amber-50 to-stone-50 rounded-xl p-6 border border-amber-200/50">
                  <p className="text-stone-600 text-sm font-semibold uppercase mb-2">
                    Amount Paid
                  </p>
                  <p className="text-4xl font-bold text-amber-600 mb-4">
                    ${(payment.amount / 100).toFixed(2)}
                  </p>
                  <div className="flex items-center gap-2 text-green-600 font-semibold">
                    <svg
                      className="w-5 h-5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {payment.status === 'succeeded'
                      ? 'Payment Successful'
                      : 'Processing'}
                  </div>
                </div>

                {/* Right Column - Buyer Info */}
                <div className="space-y-4">
                  <div>
                    <p className="text-stone-600 text-sm font-semibold uppercase mb-1">
                      Buyer Name
                    </p>
                    <p className="text-lg font-semibold text-stone-900">
                      {payment.metadata?.buyerName || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-stone-600 text-sm font-semibold uppercase mb-1">
                      Email
                    </p>
                    <p className="text-lg font-semibold text-stone-900">
                      {payment.metadata?.buyerEmail || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-stone-600 text-sm font-semibold uppercase mb-1">
                      Phone
                    </p>
                    <p className="text-lg font-semibold text-stone-900">
                      {payment.metadata?.buyerPhoneNumber || 'N/A'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <hr className="border-stone-200 my-8" />

              {/* Receipt Details */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-stone-600 text-sm font-semibold uppercase mb-2">
                    Payment Date
                  </p>
                  <p className="text-stone-900 font-semibold">
                    {new Date(payment.paidAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </div>
                <div>
                  <p className="text-stone-600 text-sm font-semibold uppercase mb-2">
                    Time
                  </p>
                  <p className="text-stone-900 font-semibold">
                    {new Date(payment.paidAt).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <div>
                  <p className="text-stone-600 text-sm font-semibold uppercase mb-2">
                    Status
                  </p>
                  <p className="inline-block bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-semibold">
                    {payment.status === 'succeeded' ? 'Confirmed' : 'Pending'}
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-stone-50 px-8 py-6 border-t border-stone-200">
              <p className="text-stone-600 text-sm text-center mb-4">
                Your tickets have been created and a confirmation email has been
                sent to{' '}
                <span className="font-semibold">
                  {payment.metadata?.buyerEmail}
                </span>
              </p>
              <div className="flex gap-3 justify-center">
                <Link
                  href="/"
                  className="px-6 py-3 bg-stone-900 text-white rounded-lg font-semibold hover:bg-stone-800 transition"
                >
                  Back to Home
                </Link>
                <Link
                  href="/admin/tickets"
                  className="px-6 py-3 bg-stone-100 text-stone-900 rounded-lg font-semibold hover:bg-stone-200 transition"
                >
                  View My Tickets
                </Link>
              </div>
            </div>
          </div>

          {/* Important Information */}
          <div className="mt-10 bg-white rounded-2xl p-8 border border-stone-200/50 shadow-lg">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-amber-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-stone-900">
                What Happens Next?
              </h3>
            </div>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 text-stone-600">
              <li className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Check your email for ticket confirmation</span>
              </li>
              <li className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Your tickets are reserved and locked</span>
              </li>
              <li className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>View and download your tickets anytime</span>
              </li>
              <li className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Contact support@showfront.events for help</span>
              </li>
            </ul>
          </div>
        </main>

        {/* Footer */}
        <footer className="bg-stone-900 text-white mt-12">
          <div className="max-w-5xl mx-auto px-6 py-8 text-center">
            <p className="text-stone-400 text-sm">
              © 2026 Showfront Events. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-8 text-center max-w-md shadow-lg border border-stone-200">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-stone-900 mb-2">
            Ticket Not Found
          </h2>
          <p className="text-stone-600 mb-6">
            We couldn't find this ticket. It may have been deleted or the link
            is invalid.
          </p>
          <Link
            href="/"
            className="inline-block px-6 py-3 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 transition"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const eventInfo = typeof ticket.eventId === 'object' ? ticket.eventId : null;
  const eventDate = eventInfo ? new Date(eventInfo.date) : new Date();
  const purchaseDate = new Date(ticket.purchaseDate);

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-stone-50 to-amber-50/30">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-stone-200/50 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="flex items-center gap-3 hover:opacity-80 transition"
            >
              <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-amber-600 rounded-lg flex items-center justify-center shadow-lg shadow-amber-500/20">
                <span className="text-white text-lg font-bold">S</span>
              </div>
              <div>
                <h1 className="text-lg font-bold text-stone-900">
                  Showfront
                </h1>
                <p className="text-xs text-stone-500 -mt-0.5">
                  Events & Experiences
                </p>
              </div>
            </Link>

            <Link
              href="/"
              className="text-stone-600 hover:text-stone-900 transition flex items-center gap-2 font-medium text-sm"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              Back to Events
            </Link>
          </div>
        </div>
      </header>

      {/* Success Banner */}
      <div className="bg-gradient-to-r from-emerald-500 via-green-500 to-teal-500 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 right-0 w-96 h-96 bg-white rounded-full -mr-48 -mt-48"></div>
        </div>
        <div className="max-w-5xl mx-auto px-6 py-8 relative z-10">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-white/20 backdrop-blur rounded-full flex items-center justify-center">
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-bold">Booking Confirmed!</h2>
              <p className="text-green-100 text-sm mt-1">
                Your e-ticket has been sent to your email • Ticket ID:{' '}
                {ticket.ticketNumber}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Actions Bar */}
        <div className="flex flex-col sm:flex-row gap-4 mb-10">
          <button
            onClick={handleDownloadPDF}
            disabled={downloading}
            className="flex-1 bg-gradient-to-r from-amber-500 to-amber-600 text-white px-8 py-4 rounded-xl font-semibold hover:from-amber-600 hover:to-amber-700 transition shadow-lg shadow-amber-500/20 flex items-center justify-center gap-3 disabled:opacity-50 group"
          >
            {downloading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                Generating PDF...
              </>
            ) : (
              <>
                <svg
                  className="w-5 h-5 group-hover:scale-110 transition"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Download PDF Ticket
              </>
            )}
          </button>

          <button className="flex-1 bg-white text-stone-700 px-8 py-4 rounded-xl font-semibold border border-stone-200 hover:bg-stone-50 transition flex items-center justify-center gap-3 group">
            <svg
              className="w-5 h-5 group-hover:scale-110 transition"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
              />
            </svg>
            Share Ticket
          </button>
        </div>

        {/* Ticket Card */}
        <div
          ref={receiptRef}
          id="receipt-content"
          className="bg-white rounded-3xl overflow-hidden shadow-2xl border border-stone-200/50"
        >
          {/* Ticket Header with Gradient */}
          <div className="bg-gradient-to-r from-stone-900 via-stone-800 to-stone-900 text-white p-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full -mr-32 -mt-32"></div>
            <div className="relative z-10 flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-gradient-to-br from-amber-400 to-amber-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/30">
                  <span className="text-xl font-bold text-stone-900">S</span>
                </div>
                <div>
                  <p className="font-bold text-lg">Showfront Events</p>
                  <p className="text-stone-300 text-sm">Premium E-Ticket</p>
                </div>
              </div>
              <div className="bg-gradient-to-br from-amber-400 to-amber-500 text-stone-900 px-6 py-2 rounded-lg text-sm font-bold shadow-lg">
                {ticket.ticketNumber}
              </div>
            </div>
          </div>

          {/* Event Title Section */}
          <div className="px-8 py-6 bg-gradient-to-b from-stone-50 to-white border-b border-stone-200/50">
            <h2 className="text-4xl font-bold text-stone-900 leading-tight">
              {eventInfo?.name || 'Event'}
            </h2>
            <p className="text-stone-500 mt-2">
              Event ticket for entry at {eventInfo?.venue || 'TBA'}
            </p>
          </div>

          {/* Main Content - 2 Column Layout */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-8">
            {/* Left Column - Event Details */}
            <div className="md:col-span-2 space-y-6">
              {/* Date & Venue Row */}
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-gradient-to-br from-amber-50 to-amber-100/30 rounded-2xl p-6 border border-amber-200/50">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                      <svg
                        className="w-5 h-5 text-amber-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
                      Date & Time
                    </p>
                  </div>
                  <p className="text-lg font-bold text-stone-900 mb-2">
                    {eventDate.toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                  <p className="text-stone-600">
                    {eventDate.toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>

                <div className="bg-gradient-to-br from-stone-50 to-stone-100/30 rounded-2xl p-6 border border-stone-200/50">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-stone-100 rounded-lg flex items-center justify-center">
                      <svg
                        className="w-5 h-5 text-stone-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                    </div>
                    <p className="text-xs font-semibold text-stone-700 uppercase tracking-wider">
                      Venue
                    </p>
                  </div>
                  <p className="text-lg font-bold text-stone-900">
                    {eventInfo?.venue || 'TBA'}
                  </p>
                </div>
              </div>

              {/* Seats & Attendee Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="bg-gradient-to-br from-amber-50 to-amber-100/30 rounded-2xl p-6 border border-amber-200/50">
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-4">
                    Seats ({ticket.seats.length})
                  </p>
                  <div className="space-y-2">
                    {ticket.seats.map((seat, idx) => (
                      <div
                        key={idx}
                        className="text-sm font-semibold text-amber-900 bg-white/50 rounded px-3 py-1 inline-block"
                      >
                        {seat.seatId}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-stone-50 to-stone-100/30 rounded-2xl p-6 border border-stone-200/50">
                  <p className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-4">
                    Attendee
                  </p>
                  <p className="text-base font-bold text-stone-900 mb-3">
                    {ticket.buyerName}
                  </p>
                  <div className="space-y-1 text-sm">
                    <p className="text-stone-600">
                      <span className="text-xs font-semibold text-stone-500">
                        Email:
                      </span>{' '}
                      {ticket.buyerEmail}
                    </p>
                    <p className="text-stone-600">
                      <span className="text-xs font-semibold text-stone-500">
                        Phone:
                      </span>{' '}
                      {ticket.buyerPhoneNumber}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - QR Code */}
            <div className="md:col-span-1 flex flex-col items-center">
              <div className="bg-gradient-to-b from-stone-50 to-stone-100/50 rounded-3xl p-6 border border-stone-200/50 w-full flex flex-col items-center">
                <p className="text-xs font-semibold text-stone-600 uppercase tracking-wider mb-4">
                  Entry QR Code
                </p>
                {ticket.qrCode && (
                  <div className="bg-white p-4 rounded-2xl shadow-lg shadow-stone-200/50 w-full aspect-square flex items-center justify-center">
                    <img
                      src={ticket.qrCode}
                      alt="QR Code"
                      className="w-full h-full"
                    />
                  </div>
                )}
                <p className="text-xs text-stone-600 text-center mt-4">
                  Show this QR code at the venue entrance
                </p>
              </div>
            </div>
          </div>

          {/* Purchase Info Footer */}
          <div className="px-8 py-6 bg-gradient-to-r from-stone-50 to-stone-100/50 border-t border-stone-200/50">
            <p className="text-center text-sm text-stone-600">
              <span className="font-semibold">Purchased:</span>{' '}
              {purchaseDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}{' '}
              at{' '}
              {purchaseDate.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>

          {/* Bottom Branding */}
          <div className="bg-stone-900 text-center py-6 border-t border-stone-800">
            <p className="text-stone-400 text-sm">
              Showfront Events • www.showfront.events •
              support@showfront.events
            </p>
          </div>
        </div>

        {/* Important Information Section */}
        <div className="mt-10 bg-white rounded-2xl p-8 border border-stone-200/50 shadow-lg">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
              <svg
                className="w-5 h-5 text-amber-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-stone-900">
              Important Information
            </h3>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 text-stone-600">
            <li className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Arrive 30 minutes before the event starts</span>
            </li>
            <li className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Have your QR code ready for scanning</span>
            </li>
            <li className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Ticket is non-transferable, valid for one entry only</span>
            </li>
            <li className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Contact support@showfront.events for assistance</span>
            </li>
          </ul>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-stone-900 text-white mt-12">
        <div className="max-w-5xl mx-auto px-6 py-8 text-center">
          <p className="text-stone-400 text-sm">
            © 2026 Showfront Events. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
