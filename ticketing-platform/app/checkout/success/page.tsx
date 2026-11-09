'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { paymentsAPI, ticketsAPI } from '@/lib/api';

interface Payment {
  _id: string;
  amount: number;
  status: 'succeeded' | 'pending' | 'failed' | 'ticket_creation_failed';
  failureReason?: string;
  paidAt?: string;
  metadata?: {
    buyerEmail?: string;
    buyerName?: string;
    buyerPhoneNumber?: string;
  };
}

interface Ticket {
  _id: string;
  ticketNumber: string;
}

function CheckoutSuccessContent() {
  const searchParams = useSearchParams();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  // Fetch payment details
  useEffect(() => {
    const fetchPayment = async () => {
      try {
        const paymentId = searchParams.get('paymentId');
        if (!paymentId) {
          setError('No payment ID found');
          setLoading(false);
          return;
        }

        const response = await paymentsAPI.getPayment(paymentId);
        setPayment(response.data.data);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching payment:', err);
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to fetch payment details',
        );
        setLoading(false);
      }
    };

    fetchPayment();
  }, [searchParams]);

  // Poll for tickets until they are created by webhook
  useEffect(() => {
    if (!payment?._id) return;

    let pollCount = 0;
    const maxAttempts = 30; // 30 seconds max (with 1 second intervals)
    let timeoutId: NodeJS.Timeout;

    const pollTickets = async () => {
      pollCount++;

      try {
        // First check payment status to detect failures early
        const paymentResponse = await paymentsAPI.getPayment(payment._id);
        const updatedPayment = paymentResponse.data.data;

        // Check if ticket creation failed
        if (
          updatedPayment?.status === 'ticket_creation_failed' ||
          updatedPayment?.status === 'failed'
        ) {
          const failureReason =
            updatedPayment?.failureReason || 'Unknown error';
          setError(
            `Payment processing failed: ${failureReason}. Please try again or contact support.`,
          );
          setTicketsLoading(false);
          return;
        }

        // Then check for tickets
        const response = await ticketsAPI.getByPaymentId(payment._id);
        const fetchedTickets = response.data.data || response.data;

        if (Array.isArray(fetchedTickets) && fetchedTickets.length > 0) {
          setTickets(fetchedTickets);
          setTicketsLoading(false);
          return;
        }

        // Check if we've exceeded max polling time
        if (pollCount >= maxAttempts) {
          setTimedOut(true);
          setError(
            'Tickets took too long to process. Your payment was successful, but tickets are still being created. Please check your email or try refreshing this page in a moment.',
          );
          setTicketsLoading(false);
          return;
        }

        // Tickets not yet created, retry in 1 second
        timeoutId = setTimeout(pollTickets, 1000);
      } catch (err) {
        console.error('Error fetching tickets:', err);

        // Check if this is a "seats unavailable" error (race condition detected)
        if (err instanceof Error && err.message.includes('unavailable')) {
          setError(
            'The seats you selected were purchased by another customer. Your payment has been refunded. Please select different seats and try again.',
          );
          setTicketsLoading(false);
          return;
        }

        // Check if we've exceeded max polling time
        if (pollCount >= maxAttempts) {
          setTimedOut(true);
          setError(
            'Tickets took too long to process. Your payment was successful, but there was an issue creating your tickets. Please contact support.',
          );
          setTicketsLoading(false);
          return;
        }

        // Retry on other errors
        timeoutId = setTimeout(pollTickets, 1000);
      }
    };

    // Start polling after a small delay to allow webhook to process
    timeoutId = setTimeout(pollTickets, 500);
    return () => clearTimeout(timeoutId);
  }, [payment?._id]);

  if (loading || ticketsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-stone-50 via-stone-50 to-amber-50/30">
        <div className="text-center max-w-md">
          <div className="mb-6">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-amber-200 border-t-amber-600 mx-auto"></div>
          </div>
          <h2 className="text-2xl font-bold text-stone-900 mb-2">
            Processing Payment
          </h2>
          <p className="text-stone-600 mb-4">
            {ticketsLoading
              ? 'Creating your tickets...'
              : 'Loading payment confirmation...'}
          </p>
          <p className="text-sm text-stone-500">
            This may take a few moments. Please don&apos;t close this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-stone-50 via-stone-50 to-amber-50/30 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl shadow-xl border border-stone-200/50 overflow-hidden">
          {/* Error State - Race Condition or Timeout */}
          {error && (
            <div className="bg-linear-to-r from-red-500 to-red-600 px-8 py-8 text-center">
              <div className="mb-4">
                <div className="mx-auto w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
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
                      d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              </div>
              <h1 className="text-4xl font-bold text-white mb-2">
                {timedOut ? 'Processing Timeout' : 'Unable to Complete'}
              </h1>
              <p className="text-red-50 mb-6">{error}</p>
              <div className="space-y-3">
                <button
                  onClick={() => window.location.reload()}
                  className="block w-full bg-white hover:bg-red-50 text-red-600 font-bold py-3 px-4 rounded-lg transition"
                >
                  Refresh This Page
                </button>
                <Link
                  href="/"
                  className="block w-full bg-red-700 hover:bg-red-800 text-white font-bold py-3 px-4 rounded-lg transition text-center"
                >
                  Back to Home
                </Link>
              </div>
            </div>
          )}

          {/* Success State */}
          {!error && payment && tickets.length > 0 && (
            <>
              {/* Success Header */}
              <div className="bg-linear-to-r from-amber-500 to-amber-600 px-8 py-8 text-center">
                <div className="mb-4">
                  <div className="mx-auto w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
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
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                </div>
                <h1 className="text-4xl font-bold text-white mb-2">
                  Payment Successful!
                </h1>
                <p className="text-amber-50">
                  Your tickets have been created and confirmation has been sent
                  to your email.
                </p>
              </div>

              {/* Payment Details */}
              {payment && (
                <div className="p-8 border-b border-stone-200">
                  <h2 className="text-lg font-bold text-stone-900 mb-6">
                    Payment Details
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-stone-50 rounded-lg p-4">
                      <p className="text-stone-600 text-sm font-semibold uppercase mb-1">
                        Amount Paid
                      </p>
                      <p className="text-3xl font-bold text-amber-600">
                        ${(payment.amount / 100).toFixed(2)}
                      </p>
                    </div>
                    <div className="bg-stone-50 rounded-lg p-4">
                      <p className="text-stone-600 text-sm font-semibold uppercase mb-1">
                        Payment ID
                      </p>
                      <p className="text-sm font-mono text-stone-900 break-all">
                        {payment._id}
                      </p>
                    </div>
                    <div className="bg-stone-50 rounded-lg p-4">
                      <p className="text-stone-600 text-sm font-semibold uppercase mb-1">
                        Status
                      </p>
                      <p className="inline-block bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-semibold">
                        {payment.status === 'succeeded'
                          ? '✓ Confirmed'
                          : 'Processing'}
                      </p>
                    </div>
                    <div className="bg-stone-50 rounded-lg p-4">
                      <p className="text-stone-600 text-sm font-semibold uppercase mb-1">
                        Date
                      </p>
                      <p className="text-sm text-stone-900">
                        {payment.paidAt
                          ? new Date(payment.paidAt).toLocaleString()
                          : 'N/A'}
                      </p>
                    </div>
                    {payment.metadata?.buyerEmail && (
                      <div className="bg-stone-50 rounded-lg p-4 md:col-span-2">
                        <p className="text-stone-600 text-sm font-semibold uppercase mb-1">
                          Confirmation Email
                        </p>
                        <p className="text-sm text-stone-900">
                          {payment.metadata.buyerEmail}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tickets Created */}
              {tickets.length > 0 && (
                <div className="p-8 border-b border-stone-200">
                  <h2 className="text-lg font-bold text-stone-900 mb-4">
                    Tickets Created ({tickets.length})
                  </h2>
                  <div className="space-y-3">
                    {tickets.map((ticket, idx) => (
                      <div
                        key={ticket._id}
                        className="bg-amber-50 border border-amber-200 rounded-lg p-4"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-semibold text-stone-900">
                              Ticket {idx + 1}
                            </p>
                            <p className="text-sm text-stone-600">
                              ID: {ticket.ticketNumber}
                            </p>
                          </div>
                          <Link
                            href={`/receipt/${ticket._id}`}
                            className="text-amber-600 hover:text-amber-700 font-semibold text-sm"
                          >
                            View →
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="p-8 bg-stone-50 space-y-3">
                {tickets.length > 0 && (
                  <Link
                    href={`/receipt/${tickets[0]._id}`}
                    className="block w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 px-4 rounded-lg transition text-center"
                  >
                    View Receipt
                  </Link>
                )}
                <Link
                  href="/"
                  className="block w-full bg-stone-200 hover:bg-stone-300 text-stone-900 font-bold py-3 px-4 rounded-lg transition text-center"
                >
                  Back to Home
                </Link>
              </div>

              {/* Additional Info */}
              <div className="px-8 py-6 border-t border-stone-200 bg-white">
                <p className="text-sm text-stone-600 mb-2">
                  ✓ A confirmation email with your tickets has been sent. Please
                  check your inbox and spam folder.
                </p>
                <p className="text-sm text-stone-600">
                  Need help?{' '}
                  <span className="font-semibold">
                    Contact support@showfront.events
                  </span>
                </p>
              </div>
            </>
          )}

          {/* Loading/Pending State */}
          {!error && (!payment || tickets.length === 0) && (
            <div className="p-8 text-center">
              <p className="text-stone-600">Still processing your payment...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-stone-50 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-stone-200 border-t-amber-500 rounded-full animate-spin mx-auto"></div>
            <p className="text-stone-600 mt-4">Loading...</p>
          </div>
        </div>
      }
    >
      <CheckoutSuccessContent />
    </Suspense>
  );
}
