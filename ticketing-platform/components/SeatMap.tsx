'use client';

import { useState, useEffect, useRef } from 'react';
import { seatsAPI } from '@/lib/api';

interface SeatObject {
  seatId: string;
  row: number;
  column: string;
  status: 'available' | 'unavailable';
}

interface SeatSection {
  id: string;
  name: string;
  priceModifier?: number;
  seats: SeatObject[];
}

interface SeatMapData {
  event: {
    id: string;
    name: string;
    venue: string;
    date: string;
    basePrice: number;
  };
  seatingLayout: {
    enabled: boolean;
    sections: SeatSection[];
  };
}

interface SelectedSeat {
  sectionId: string;
  seatId: string;
  price: number;
}

interface SeatMapProps {
  eventId: string;
  selectedTicketType?: string;
  ticketTypePrice?: number;
  initialSelectedSeats?: SelectedSeat[];
  onSeatsSelected?: (seats: SelectedSeat[], total: number) => void;
}

export default function SeatMap({
  eventId,
  selectedTicketType,
  ticketTypePrice = 0,
  initialSelectedSeats,
  onSeatsSelected,
}: SeatMapProps) {
  const [seatMapData, setSeatMapData] = useState<SeatMapData | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<SelectedSeat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const appliedInitialSeats = useRef<SelectedSeat[] | undefined>(undefined);

  // Apply a restored selection once, dropping seats that are no longer available
  useEffect(() => {
    if (
      !seatMapData ||
      !initialSelectedSeats?.length ||
      appliedInitialSeats.current === initialSelectedSeats
    ) {
      return;
    }
    appliedInitialSeats.current = initialSelectedSeats;

    const stillAvailable = initialSelectedSeats.filter((selected) =>
      seatMapData.seatingLayout.sections
        .find((section) => section.id === selected.sectionId)
        ?.seats.some(
          (seat) =>
            seat.seatId === selected.seatId && seat.status === 'available',
        ),
    );
    setSelectedSeats(stillAvailable.slice(0, 10));
  }, [initialSelectedSeats, seatMapData]);

  useEffect(() => {
    loadSeatMap();
    // Reload seat map every 2 seconds to see when seats become unavailable (sold by others)
    const interval = setInterval(loadSeatMap, 2000);
    return () => clearInterval(interval);
  }, [eventId]);

  useEffect(() => {
    // Recalculate total whenever ticket type price changes
    const total = selectedSeats.length * (ticketTypePrice || 0);
    console.log('[SeatMap] CALLBACK: Calling onSeatsSelected with:', {
      seatsCount: selectedSeats.length,
      seats: selectedSeats,
      total: total,
    });
    onSeatsSelected?.(selectedSeats, total);
  }, [selectedSeats, ticketTypePrice, onSeatsSelected]);

  const loadSeatMap = async () => {
    try {
      const response = await seatsAPI.getSeatMap(eventId);
      const seatData = response.data.data || response.data;
      setSeatMapData(seatData);
      setLoading(false);

      // Log unavailable count
      const unavailableCount =
        seatData?.seatingLayout?.sections?.reduce(
          (count: number, section: SeatSection) =>
            count +
            section.seats.filter((s) => s.status === 'unavailable').length,
          0,
        ) || 0;
      console.log('[SeatMap] Current unavailable seats:', unavailableCount);
    } catch (err) {
      setError('Failed to load seat map');
      console.error(err);
      setLoading(false);
    }
  };

  // Select or deselect a seat (local selection only, no backend sync)
  const toggleSeat = (sectionId: string, seat: SeatObject) => {
    if (seat.status !== 'available') return; // Can't select unavailable seats

    const isSelected = selectedSeats.some(
      (s) => s.sectionId === sectionId && s.seatId === seat.seatId,
    );

    if (isSelected) {
      // Deselect
      setSelectedSeats(
        selectedSeats.filter(
          (s) => !(s.sectionId === sectionId && s.seatId === seat.seatId),
        ),
      );
      console.log('[SeatMap] Deselected seat:', seat.seatId);
    } else {
      // Check max 10 seat limit
      if (selectedSeats.length >= 10) {
        console.log('[SeatMap] Cannot select more than 10 seats');
        return;
      }

      // Select
      // Use the ticket type price passed from parent, or fallback to basePrice
      const price = ticketTypePrice || seatMapData!.event.basePrice;

      const newSeat: SelectedSeat = {
        sectionId,
        seatId: seat.seatId,
        price,
      };

      console.log('[SeatMap] Creating new seat:', {
        sectionId: sectionId,
        seatId: seat.seatId,
        seatObject: JSON.stringify(seat),
        newSeat: JSON.stringify(newSeat),
      });

      setSelectedSeats([...selectedSeats, newSeat]);
      console.log(
        '[SeatMap] Selected seat:',
        seat.seatId,
        'Total selected:',
        selectedSeats.length + 1,
      );
    }
  };

  const isSeatSelected = (sectionId: string, seatId: string) => {
    return selectedSeats.some(
      (s) => s.sectionId === sectionId && s.seatId === seatId,
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="inline-block w-12 h-12 border-4 border-stone-200 border-t-amber-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error || !seatMapData) {
    return (
      <div className="text-center py-20">
        <p className="text-red-600">{error || 'Failed to load seat map'}</p>
      </div>
    );
  }

  if (!seatMapData.seatingLayout || !seatMapData.seatingLayout.enabled) {
    return (
      <div className="text-center py-20">
        <p className="text-stone-600">
          Visual seat selection not available for this event
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-2xl border border-stone-200 p-6">
        <h2 className="text-2xl font-bold text-stone-900 mb-2">
          {seatMapData.event.name}
        </h2>
        <div className="flex flex-wrap gap-4 text-sm text-stone-600">
          <span>📍 {seatMapData.event.venue}</span>
          <span>
            📅 {new Date(seatMapData.event.date).toLocaleDateString()}
          </span>
          <span>💰 From ₹{seatMapData.event.basePrice}</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-4">
        <div className="flex flex-wrap gap-6 items-center justify-center text-sm">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-green-500 rounded border border-green-600"></div>
            <span className="text-stone-700">Available</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-amber-500 rounded border border-amber-600"></div>
            <span className="text-stone-700">Selected</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-red-500 rounded border border-red-600"></div>
            <span className="text-stone-700">Sold</span>
          </div>
        </div>
      </div>

      {seatMapData.seatingLayout.sections.map((section) => {
        const rows = Math.max(...section.seats.map((s) => s.row));
        const columns = [...new Set(section.seats.map((s) => s.column))].sort();

        return (
          <div
            key={section.id}
            className="bg-white rounded-2xl border border-stone-200 p-6"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-stone-900">
                {section.name}
              </h3>
              {section.priceModifier && section.priceModifier !== 0 && (
                <span className="text-sm font-semibold text-amber-600">
                  {section.priceModifier > 0 ? '+' : ''}₹
                  {section.priceModifier.toFixed(2)}
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <div className="inline-block min-w-full">
                <div className="flex gap-1 mb-1 pl-8">
                  {columns.map((col) => (
                    <div
                      key={col}
                      className="w-8 h-6 text-center text-xs font-semibold text-stone-600"
                    >
                      {col}
                    </div>
                  ))}
                </div>

                {Array.from({ length: rows }).map((_, rowIdx) => {
                  const row = rowIdx + 1;
                  return (
                    <div key={row} className="flex gap-1 mb-1">
                      <div className="w-8 h-8 flex items-center justify-center text-xs font-semibold text-stone-600">
                        {row}
                      </div>

                      {columns.map((col) => {
                        const seat = section.seats.find(
                          (s) => s.row === row && s.column === col,
                        );

                        if (!seat) {
                          return (
                            <div key={`${row}-${col}`} className="w-8 h-8" />
                          );
                        }

                        const isSelected = isSeatSelected(
                          section.id,
                          seat.seatId,
                        );
                        const price =
                          seatMapData.event.basePrice +
                          (section.priceModifier || 0);

                        let bgColor = '';
                        let hoverClass = '';
                        let disabled = false;

                        if (seat.status === 'available') {
                          bgColor = isSelected
                            ? 'bg-amber-500 border-amber-600'
                            : 'bg-green-500 border-green-600';
                          hoverClass = !isSelected
                            ? 'hover:bg-green-600 cursor-pointer transform hover:scale-110'
                            : 'cursor-pointer opacity-100';
                        } else {
                          // Unavailable (sold)
                          bgColor = 'bg-red-500 border-red-600';
                          hoverClass = 'cursor-not-allowed opacity-60';
                          disabled = true;
                        }

                        return (
                          <button
                            key={seat.seatId}
                            type="button"
                            onClick={() => toggleSeat(section.id, seat)}
                            disabled={disabled}
                            className={`w-8 h-8 rounded border transition-all ${bgColor} ${hoverClass}`}
                            title={`${seat.seatId} - ₹${price} - ${seat.status}`}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

      {selectedSeats.length > 0 && (
        <div className="sticky bottom-4 bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-2xl p-6 shadow-2xl">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h3 className="font-bold text-lg mb-2">Selected Seats</h3>
              <div className="flex flex-wrap gap-2">
                {selectedSeats.map((seat) => (
                  <span
                    key={`${seat.sectionId}-${seat.seatId}`}
                    className="bg-white/20 px-3 py-1 rounded-full text-sm font-semibold"
                  >
                    {seat.seatId}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
