'use client';

import { useState, useEffect } from 'react';
import { eventsAPI, ticketsAPI, seatsAPI } from '@/lib/api';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import SeatMap from '@/components/SeatMap';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  savePendingPurchase,
  takePendingPurchase,
} from '@/lib/pendingPurchase';

interface Event {
  _id: string;
  name: string;
  description: string;
  longDescription?: string;
  coverImage?: string;
  date: string;
  venue: string;
  soldTickets: number;
  totalSeats?: number;
  ticketTypes?: {
    Free: { enabled: boolean; price?: number; description?: string };
    Standard: { enabled: boolean; price?: number; description?: string };
    EarlyBird: {
      enabled: boolean;
      price?: number;
      limit?: number;
      description?: string;
    };
    VIP: { enabled: boolean; price?: number; description?: string };
  };
  earlyBirdCount?: number;
  category?: string;
  isDraft?: boolean;
  isPublished?: boolean;
  seatingLayout?: {
    enabled: boolean;
    sections: any[];
  };
}

interface Ticket {
  _id: string;
  ticketNumber: string;
}

interface SelectedSeat {
  sectionId: string;
  seatId: string;
  price: number;
}

export default function EventDetailPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.id as string;
  const { user, loading: authLoading } = useAuth();

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedSeats, setSelectedSeats] = useState<SelectedSeat[]>([]);
  const [totalPrice, setTotalPrice] = useState(0);
  const [restoredSeats, setRestoredSeats] = useState<SelectedSeat[]>();
  const [selectionRestored, setSelectionRestored] = useState(false);

  const [formData, setFormData] = useState({
    buyerName: '',
    buyerEmail: '',
    buyerPhoneNumber: '',
    selectedTicketType: 'Free',
  });

  // Selected seats are tracked locally only - NOT synced to backend until payment
  // This removes the live reservation system

  // Helper to get available ticket types for this event
  const getAvailableTicketTypes = () => {
    if (!event?.ticketTypes) return [];
    const available: Array<{
      type: string;
      enabled: boolean;
      price: number;
      limit?: number;
      description?: string;
    }> = [];
    for (const [type, config] of Object.entries(event.ticketTypes)) {
      if (config.enabled) {
        available.push({
          type,
          enabled: true,
          price: config.price || 0,
          limit: type === 'EarlyBird' ? (config as any).limit : undefined,
          description: (config as any).description,
        });
      }
    }
    return available;
  };

  // Check if EarlyBird tickets are sold out
  const isEarlyBirdSoldOut = () => {
    if (!event?.ticketTypes?.EarlyBird) return false;
    const limit = (event.ticketTypes.EarlyBird as any).limit;
    return limit && (event.earlyBirdCount ?? 0) >= limit;
  };

  // Get price for selected ticket type
  const getTicketTypePrice = () => {
    const types = getAvailableTicketTypes();
    const selected = types.find((t) => t.type === formData.selectedTicketType);
    return selected?.price || 0;
  };

  useEffect(() => {
    const fetchEvent = async () => {
      try {
        const response = await eventsAPI.getById(eventId);

        // Extract data from standardized response format { success, statusCode, data, timestamp }
        const eventData = response.data.data || response.data;

        setEvent(eventData);
      } catch (err) {
        setError('Failed to load event details');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    if (eventId) {
      fetchEvent();
    }

    // NO CLEANUP: Seats are only locked at payment time, not during selection
    // Users can navigate away without unreserving - seats remain available for others
  }, [eventId]);

  useEffect(() => {
    // Update selected ticket type when event loads to use first available type
    if (event) {
      const availableTypes = getAvailableTicketTypes();
      if (availableTypes.length > 0) {
        // Set to first available type if current selection is not available
        if (
          !availableTypes.find((t) => t.type === formData.selectedTicketType)
        ) {
          setFormData((prev) => ({
            ...prev,
            selectedTicketType: availableTypes[0].type,
          }));
        }
      }
    }
  }, [event]);

  // Resume a purchase started before the buyer logged in or signed up.
  // Declared after the ticket-type default effect so the restored type wins.
  useEffect(() => {
    if (!event || authLoading || !user) return;

    const pending = takePendingPurchase(event._id);
    if (!pending) return;

    const isTypeAvailable = getAvailableTicketTypes().some(
      (t) => t.type === pending.formData.selectedTicketType,
    );

    setFormData((prev) => ({
      ...prev,
      ...pending.formData,
      selectedTicketType: isTypeAvailable
        ? pending.formData.selectedTicketType
        : prev.selectedTicketType,
      buyerEmail: pending.formData.buyerEmail || user.email || '',
    }));
    // SeatMap keeps only the seats that are still available
    if (pending.selectedSeats.length > 0) {
      setRestoredSeats(pending.selectedSeats);
    }
    setSelectionRestored(true);
  }, [event, authLoading, user]);

  // Recalculate total price when ticket type changes (for visual seating)
  useEffect(() => {
    if (selectedSeats.length > 0) {
      const pricePerSeat = getTicketTypePrice();
      const newTotal = selectedSeats.length * pricePerSeat;
      setTotalPrice(newTotal);
    }
  }, [formData.selectedTicketType, event?.ticketTypes]);

  const handleBuyTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;

    try {
      setSubmitting(true);
      setError(null);

      // Validate required fields
      if (!formData.buyerEmail || !formData.buyerName) {
        setError('Please provide your name and email address');
        setSubmitting(false);
        return;
      }

      // Validate selected ticket type is available
      const availableTypes = getAvailableTicketTypes();
      if (!availableTypes.find((t) => t.type === formData.selectedTicketType)) {
        setError(
          `Ticket type "${formData.selectedTicketType}" is not available for this event`,
        );
        setSubmitting(false);
        return;
      }

      // Validate max 10 seat purchase limit
      if (selectedSeats.length > 10) {
        setError('Maximum 10 seats per purchase. Please select fewer seats.');
        setSubmitting(false);
        return;
      }

      // Checkout requires an account: keep the selection, send the buyer to
      // log in or sign up, and resume here afterwards. No seats are reserved.
      if (!user) {
        savePendingPurchase(event._id, { formData, selectedSeats });
        const returnTo = `/event/${event._id}?resume=1`;
        router.push(`/auth/login?redirect=${encodeURIComponent(returnTo)}`);
        return;
      }

      // Get ticket IDs (seat IDs or auto-assigned)
      let ticketIds: any[] = [];
      if (event.seatingLayout?.enabled && selectedSeats.length > 0) {
        // Pass full seat objects with sectionId and seatId for locking seats
        console.log('[EventDetail] handleBuyTicket - Visual seating event');
        console.log('[EventDetail] selectedSeats from state:', selectedSeats);

        ticketIds = selectedSeats.map((s) => ({
          sectionId: s.sectionId,
          seatId: s.seatId,
        }));

        console.log('[EventDetail] ticketIds after mapping:', ticketIds);

        // RESERVE SEATS TEMPORARILY (5 minutes)
        try {
          await seatsAPI.reserveSeats(event._id, ticketIds);
          console.log('[EventDetail] Seats reserved successfully');
        } catch (reserveError) {
          console.error('[EventDetail] Failed to reserve seats:', reserveError);
          setError(
            reserveError instanceof Error
              ? reserveError.message
              : 'Failed to reserve seats. Some seats may have been taken. Please try again.',
          );
          setSubmitting(false);
          return;
        }
      } else {
        // For non-seating events, generate a placeholder ticket ID
        console.log(
          '[EventDetail] Non-visual seating event or no seats selected',
        );
        ticketIds = ['auto-assigned'];
      }

      // Calculate total amount
      const pricePerTicket = getTicketTypePrice();
      const totalAmount = (ticketIds.length || 1) * pricePerTicket;

      // Build checkout URL with parameters
      const checkoutParams = new URLSearchParams({
        eventId: event._id,
        eventName: event.name,
        ticketIds: JSON.stringify(ticketIds),
        totalAmount: totalAmount.toString(),
        buyerEmail: formData.buyerEmail,
        buyerName: formData.buyerName,
        buyerPhoneNumber: formData.buyerPhoneNumber,
        ticketType: formData.selectedTicketType,
      });

      console.log('[EventDetail] CHECKOUT REDIRECT - ticketIds param:', {
        ticketIds: ticketIds,
        stringified: JSON.stringify(ticketIds),
      });

      // Redirect to checkout page
      router.push(`/checkout?${checkoutParams.toString()}`);
    } catch (err) {
      console.error('[EventDetail] Checkout redirect failed:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to proceed to checkout',
      );
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-stone-200 border-t-amber-500 rounded-full animate-spin mx-auto"></div>
          <p className="text-stone-600 mt-4">Loading event details...</p>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-stone-50">
        <header className="bg-white border-b border-stone-200">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <Link
              href="/"
              className="text-amber-600 hover:text-amber-700 font-medium flex items-center gap-2"
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
        </header>
        <div className="max-w-7xl mx-auto px-6 py-16 text-center">
          <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-stone-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-xl font-semibold text-stone-900">
            Event not found
          </p>
          <p className="text-stone-500 mt-2">
            The event you&apos;re looking for doesn&apos;t exist or has been
            removed.
          </p>
        </div>
      </div>
    );
  }

  // Check if event is sold out
  const eventTotalSeats = event.totalSeats || 0;
  const isSoldOut = eventTotalSeats > 0 && event.soldTickets >= eventTotalSeats;

  if (isSoldOut) {
    return (
      <div className="min-h-screen bg-stone-50">
        <header className="bg-white border-b border-stone-200">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <Link
              href="/"
              className="text-amber-600 hover:text-amber-700 font-medium flex items-center gap-2"
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
        </header>
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="max-w-lg mx-auto text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
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
                  d="M12 9v2m0 4v2m0 4v2M6.343 3h11.314a2 2 0 011.857 1.043l1.914 3.86a1 1 0 01.14.381H2.412a1 1 0 01.14-.381l1.914-3.86A2 2 0 016.343 3M6.343 3a2 2 0 00-1.857 1.043L2.571 7.903"
                />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-stone-900 mb-3">
              Event Sold Out
            </h1>
            <p className="text-stone-600 mb-4 text-lg">
              Sorry, this event has reached its maximum capacity and is no
              longer available for purchase.
            </p>
            <p className="text-stone-500 mb-8">
              All tickets for &quot;{event.name}&quot; have been sold. Please
              check back later for other events or sign up for notifications.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-6 py-3 rounded-lg font-semibold transition"
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
              Back to Browse Events
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Check if event is expired
  const eventDate = new Date(event.date);
  const isExpired = eventDate < new Date();

  if (isExpired) {
    return (
      <div className="min-h-screen bg-stone-50">
        <header className="bg-white border-b border-stone-200">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <Link
              href="/"
              className="text-amber-600 hover:text-amber-700 font-medium flex items-center gap-2"
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
        </header>
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="max-w-lg mx-auto text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
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
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-stone-900 mb-3">
              Event Expired
            </h1>
            <p className="text-stone-600 mb-4 text-lg">
              This event has already taken place.
            </p>
            <p className="text-stone-500 mb-8">
              &quot;{event.name}&quot; was scheduled for{' '}
              {eventDate.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}{' '}
              and is no longer available for ticket purchases.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-6 py-3 rounded-lg font-semibold transition"
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
              Back to Browse Events
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            <Link
              href="/"
              className="text-stone-600 hover:text-stone-900 font-medium flex items-center gap-2 transition"
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

            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-amber-600 rounded-lg flex items-center justify-center">
                <span className="text-white text-sm font-bold">S</span>
              </div>
              <span className="font-bold text-stone-900">Showfront</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Cover Image with Overlay */}
      <div
        className="relative w-full h-96 bg-stone-900"
        style={{
          backgroundImage: event.coverImage
            ? `url('${event.coverImage}')`
            : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {/* Dark overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/50 to-transparent"></div>

        {/* Content overlaid on image */}
        <div className="relative h-full max-w-7xl mx-auto px-6 flex flex-col justify-between py-16">
          {/* Top section - Back button */}
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300 font-medium transition"
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

          {/* Bottom section - Title and description */}
          <div className="flex items-end justify-between flex-wrap gap-6">
            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-2 bg-amber-500/20 text-amber-300 px-3 py-1 rounded-full text-sm font-medium mb-4">
                <svg
                  className="w-4 h-4"
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
                {eventDate.toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
              <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white">
                {event.name}
              </h1>
              <p className="text-xl text-stone-200 max-w-2xl">
                {event.description}
              </p>
            </div>

            {/* Date Card */}
            <div className="bg-white text-stone-900 rounded-2xl p-6 text-center shadow-xl min-w-[140px]">
              <p className="text-sm font-bold text-amber-600 uppercase">
                {eventDate.toLocaleString('en-US', { month: 'short' })}
              </p>
              <p className="text-5xl font-bold -mt-1">{eventDate.getDate()}</p>
              <p className="text-stone-500 text-sm">
                {eventDate.toLocaleString('en-US', { weekday: 'long' })}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Event Info Bar */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex flex-col md:flex-row justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-amber-600"
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
              <div>
                <p className="text-sm text-stone-500">Venue</p>
                <p className="font-semibold text-stone-900">{event.venue}</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-amber-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm text-stone-500">Ticket Types</p>
                <p className="font-semibold text-stone-900">
                  {event.ticketTypes &&
                  Object.values(event.ticketTypes).some((t) => t.enabled)
                    ? Object.entries(event.ticketTypes)
                        .filter(([_, config]) => config.enabled)
                        .map(([type]) => type)
                        .join(', ')
                    : 'TBD'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-amber-600"
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
              <div>
                <p className="text-sm text-stone-500">Time</p>
                <p className="font-semibold text-stone-900">
                  {eventDate.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-amber-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm text-stone-500">Status</p>
                <p className="font-semibold text-stone-900">
                  {event.soldTickets > 0 ? 'Tickets Available' : 'Now Open'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Long Description Section */}
      {event.longDescription && (
        <div className="bg-stone-50 border-y border-stone-200">
          <div className="max-w-7xl mx-auto px-6 py-12">
            <h2 className="text-3xl font-bold text-stone-900 mb-6">
              About This Event
            </h2>
            <div className="prose prose-stone max-w-none">
              <p className="text-lg text-stone-700 leading-relaxed whitespace-pre-wrap">
                {event.longDescription}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        {selectionRestored && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-6 py-4 rounded-xl mb-8 flex items-center justify-between gap-3">
            <span>
              Your selection was restored. Review it and click Complete
              Purchase.
            </span>
            <button
              type="button"
              onClick={() => setSelectionRestored(false)}
              className="text-amber-700 hover:text-amber-900 font-semibold text-sm"
            >
              Dismiss
            </button>
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl mb-8 flex items-center gap-3">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Booking Form */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl border border-stone-200 p-8">
              <h2 className="text-2xl font-bold text-stone-900 mb-2">
                Book Your Ticket
              </h2>
              <p className="text-stone-600 mb-8">
                Fill in your details to secure your spot
              </p>

              <>
                {/* Visual Seat Selection */}
                {event.seatingLayout?.enabled ? (
                  <div className="space-y-6">
                    {/* Ticket Type Selection - BEFORE Seat Map */}
                    <div>
                      <label className="block text-sm font-semibold text-stone-700 mb-2">
                        Select Ticket Type
                      </label>
                      {getAvailableTicketTypes().length > 1 ? (
                        <div className="space-y-3">
                          {getAvailableTicketTypes().map((ticketType) => {
                            const isEarlyBirdAndSoldOut =
                              ticketType.type === 'EarlyBird' &&
                              isEarlyBirdSoldOut();
                            return (
                              <label
                                key={ticketType.type}
                                className={`flex items-center gap-3 p-3 border rounded-xl transition ${
                                  isEarlyBirdAndSoldOut
                                    ? 'border-stone-200 bg-stone-100 cursor-not-allowed opacity-60'
                                    : 'border-stone-200 cursor-pointer hover:border-amber-500 hover:bg-amber-50'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="ticketType"
                                  value={ticketType.type}
                                  checked={
                                    formData.selectedTicketType ===
                                    ticketType.type
                                  }
                                  onChange={(e) =>
                                    setFormData({
                                      ...formData,
                                      selectedTicketType: e.target.value,
                                    })
                                  }
                                  disabled={isEarlyBirdAndSoldOut}
                                  className="w-4 h-4 rounded border-stone-300 text-amber-600 cursor-pointer disabled:cursor-not-allowed"
                                />
                                <div className="flex-1">
                                  <p className="font-semibold text-stone-900">
                                    {ticketType.type}
                                  </p>
                                  <p className="text-sm text-stone-600">
                                    {ticketType.price === 0
                                      ? 'Free'
                                      : `$${ticketType.price.toFixed(2)}`}
                                  </p>
                                  {ticketType.description && (
                                    <p className="text-xs text-stone-500 mt-1">
                                      {ticketType.description}
                                    </p>
                                  )}
                                  {ticketType.type === 'EarlyBird' &&
                                    ticketType.limit && (
                                      <p
                                        className={`text-xs ${
                                          isEarlyBirdAndSoldOut
                                            ? 'text-red-700'
                                            : 'text-amber-700'
                                        }`}
                                      >
                                        {event?.earlyBirdCount || 0}/
                                        {ticketType.limit}{' '}
                                        {isEarlyBirdAndSoldOut
                                          ? 'sold out'
                                          : 'sold'}
                                      </p>
                                    )}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-3 border border-stone-200 rounded-xl bg-stone-50">
                          <p className="font-semibold text-stone-900">
                            {getAvailableTicketTypes()[0]?.type}
                          </p>
                          <p className="text-sm text-stone-600">
                            {getTicketTypePrice() === 0
                              ? 'Free'
                              : `$${getTicketTypePrice().toFixed(2)}`}
                          </p>
                          {getAvailableTicketTypes()[0]?.description && (
                            <p className="text-xs text-stone-500 mt-1">
                              {getAvailableTicketTypes()[0].description}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Seat Map */}
                    <SeatMap
                      eventId={eventId}
                      selectedTicketType={formData.selectedTicketType}
                      ticketTypePrice={getTicketTypePrice()}
                      initialSelectedSeats={restoredSeats}
                      onSeatsSelected={(seats, total) => {
                        setSelectedSeats(seats);
                        setTotalPrice(total);
                      }}
                    />

                    {selectedSeats.length > 0 && (
                      <div className="border-t border-stone-200 pt-6">
                        <h3 className="text-lg font-bold text-stone-900 mb-4">
                          Complete Your Booking
                        </h3>
                        <form onSubmit={handleBuyTicket} className="space-y-6">
                          <div>
                            <label className="block text-sm font-semibold text-stone-700 mb-2">
                              Full Name
                            </label>
                            <input
                              type="text"
                              placeholder="Your full name"
                              value={formData.buyerName}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  buyerName: e.target.value,
                                })
                              }
                              className="w-full px-4 py-3 border border-stone-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-stone-900"
                              required
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-semibold text-stone-700 mb-2">
                              Email Address
                            </label>
                            <input
                              type="email"
                              placeholder="your@email.com"
                              value={formData.buyerEmail}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  buyerEmail: e.target.value,
                                })
                              }
                              className="w-full px-4 py-3 border border-stone-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-stone-900"
                              required
                            />
                            <p className="text-xs text-stone-500 mt-2">
                              Your e-ticket will be sent to this address
                            </p>
                          </div>

                          <div>
                            <label className="block text-sm font-semibold text-stone-700 mb-2">
                              Phone Number
                            </label>
                            <input
                              type="tel"
                              placeholder="+1 (555) 123-4567"
                              value={formData.buyerPhoneNumber}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  buyerPhoneNumber: e.target.value,
                                })
                              }
                              className="w-full px-4 py-3 border border-stone-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-stone-900"
                              required
                            />
                            <p className="text-xs text-stone-500 mt-2">
                              Required for event entry and communication
                            </p>
                          </div>

                          <button
                            type="submit"
                            disabled={submitting}
                            className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-white py-4 rounded-xl font-semibold hover:from-amber-600 hover:to-amber-700 transition shadow-lg shadow-amber-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            {submitting ? (
                              <>
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                Processing...
                              </>
                            ) : (
                              <>
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
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                                Complete Purchase (${totalPrice.toFixed(2)})
                              </>
                            )}
                          </button>

                          <p className="text-xs text-stone-500 text-center">
                            Your tickets will be instantly generated with unique
                            QR codes
                          </p>
                        </form>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Automatic Seat Assignment - No visual seating */
                  <form onSubmit={handleBuyTicket} className="space-y-6">
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
                      <div className="flex items-start gap-3">
                        <svg
                          className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0"
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
                        <div>
                          <p className="text-sm font-semibold text-blue-900">
                            Automatic Seat Assignment
                          </p>
                          <p className="text-xs text-blue-700 mt-1">
                            Your seat will be automatically assigned when you
                            complete your purchase
                          </p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-stone-700 mb-2">
                        Ticket Type
                      </label>
                      {getAvailableTicketTypes().length > 1 ? (
                        <div className="space-y-3">
                          {getAvailableTicketTypes().map((ticketType) => {
                            const isEarlyBirdAndSoldOut =
                              ticketType.type === 'EarlyBird' &&
                              isEarlyBirdSoldOut();
                            return (
                              <label
                                key={ticketType.type}
                                className={`flex items-center gap-3 p-3 border rounded-xl transition ${
                                  isEarlyBirdAndSoldOut
                                    ? 'border-stone-200 bg-stone-100 cursor-not-allowed opacity-60'
                                    : 'border-stone-200 cursor-pointer hover:border-amber-500 hover:bg-amber-50'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="ticketType"
                                  value={ticketType.type}
                                  checked={
                                    formData.selectedTicketType ===
                                    ticketType.type
                                  }
                                  onChange={(e) =>
                                    setFormData({
                                      ...formData,
                                      selectedTicketType: e.target.value,
                                    })
                                  }
                                  disabled={isEarlyBirdAndSoldOut}
                                  className="w-4 h-4 rounded border-stone-300 text-amber-600 cursor-pointer cursor-pointer"
                                />
                                <div className="flex-1">
                                  <p className="font-semibold text-stone-900">
                                    {ticketType.type}
                                  </p>
                                  <p className="text-sm text-stone-600">
                                    ${ticketType.price.toFixed(2)}
                                  </p>
                                  {ticketType.description && (
                                    <p className="text-xs text-stone-500 mt-1">
                                      {ticketType.description}
                                    </p>
                                  )}
                                  {ticketType.type === 'EarlyBird' &&
                                    ticketType.limit && (
                                      <p
                                        className={`text-xs ${
                                          isEarlyBirdAndSoldOut
                                            ? 'text-red-700'
                                            : 'text-amber-700'
                                        }`}
                                      >
                                        {event?.earlyBirdCount || 0}/
                                        {ticketType.limit}{' '}
                                        {isEarlyBirdAndSoldOut
                                          ? 'sold out'
                                          : 'sold'}
                                      </p>
                                    )}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-3 border border-stone-200 rounded-xl bg-stone-50">
                          <p className="font-semibold text-stone-900">
                            {getAvailableTicketTypes()[0]?.type}
                          </p>
                          <p className="text-sm text-stone-600">
                            ${getTicketTypePrice().toFixed(2)}
                          </p>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-stone-700 mb-2">
                        Full Name
                      </label>
                      <input
                        type="text"
                        placeholder="Your full name"
                        value={formData.buyerName}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            buyerName: e.target.value,
                          })
                        }
                        className="w-full px-4 py-3 border border-stone-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-stone-900"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-stone-700 mb-2">
                        Email Address
                      </label>
                      <input
                        type="email"
                        placeholder="your@email.com"
                        value={formData.buyerEmail}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            buyerEmail: e.target.value,
                          })
                        }
                        className="w-full px-4 py-3 border border-stone-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-stone-900"
                        required
                      />
                      <p className="text-xs text-stone-500 mt-2">
                        Your e-ticket will be sent to this address
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-stone-700 mb-2">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        placeholder="+1 (555) 123-4567"
                        value={formData.buyerPhoneNumber}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            buyerPhoneNumber: e.target.value,
                          })
                        }
                        className="w-full px-4 py-3 border border-stone-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-stone-900"
                        required
                      />
                      <p className="text-xs text-stone-500 mt-2">
                        Required for event entry and communication
                      </p>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-white py-4 rounded-xl font-semibold hover:from-amber-600 hover:to-amber-700 transition shadow-lg shadow-amber-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {submitting ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          Processing...
                        </>
                      ) : (
                        <>
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
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          Complete Purchase ($
                          {getTicketTypePrice().toFixed(2)})
                        </>
                      )}
                    </button>

                    <p className="text-xs text-stone-500 text-center">
                      Your ticket will be instantly generated with a unique QR
                      code
                    </p>
                  </form>
                )}
              </>
            </div>
          </div>

          {/* Sidebar */}
          <div>
            <div className="bg-white rounded-2xl border border-stone-200 p-6 sticky top-24">
              <h3 className="text-lg font-bold text-stone-900 mb-6">
                About This Event
              </h3>

              <div className="mt-8 space-y-4">
                <h4 className="text-sm font-semibold text-stone-700">
                  What you&apos;ll get:
                </h4>

                <div className="flex items-start gap-3 text-sm text-stone-600">
                  <svg
                    className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>Instant email confirmation</span>
                </div>

                <div className="flex items-start gap-3 text-sm text-stone-600">
                  <svg
                    className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>Digital e-ticket with QR code</span>
                </div>

                <div className="flex items-start gap-3 text-sm text-stone-600">
                  <svg
                    className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>Download as PDF</span>
                </div>

                <div className="flex items-start gap-3 text-sm text-stone-600">
                  <svg
                    className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>Secure transaction</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-stone-900 text-white mt-12">
        <div className="max-w-7xl mx-auto px-6 py-8 text-center">
          <p className="text-stone-400 text-sm">
            © 2026 Showfront Events. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
