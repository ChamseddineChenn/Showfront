// Remembers a logged-out buyer's selection across the login/signup round trip.

const MAX_AGE_MS = 30 * 60 * 1000;

export interface PendingPurchase {
  formData: {
    buyerName: string;
    buyerEmail: string;
    buyerPhoneNumber: string;
    selectedTicketType: string;
  };
  selectedSeats: { sectionId: string; seatId: string; price: number }[];
  savedAt: number;
}

const storageKey = (eventId: string) => `pendingPurchase:${eventId}`;

export function savePendingPurchase(
  eventId: string,
  purchase: Omit<PendingPurchase, 'savedAt'>,
) {
  try {
    sessionStorage.setItem(
      storageKey(eventId),
      JSON.stringify({ ...purchase, savedAt: Date.now() }),
    );
  } catch {
    // Storage can be unavailable (private mode); the buyer just re-enters details.
  }
}

/** Returns and removes the pending purchase, or null if absent or expired. */
export function takePendingPurchase(eventId: string): PendingPurchase | null {
  try {
    const raw = sessionStorage.getItem(storageKey(eventId));
    if (!raw) return null;
    sessionStorage.removeItem(storageKey(eventId));

    const purchase = JSON.parse(raw) as PendingPurchase;
    if (!purchase?.savedAt || Date.now() - purchase.savedAt > MAX_AGE_MS) {
      return null;
    }
    return purchase;
  } catch {
    return null;
  }
}

/** Only same-site relative paths are allowed as post-login destinations. */
export function safeRedirectPath(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return null;
  }
  return value;
}

export function isPurchaseRedirect(path: string | null | undefined) {
  return !!path && (path.startsWith('/event/') || path.startsWith('/checkout'));
}
