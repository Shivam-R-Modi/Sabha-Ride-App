import React, { useState } from 'react';
import { User, Driver } from '../types';
import { MapPin, ChevronLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import { createRideRequest } from '../hooks/useRides';
import { useSettings, formatTime } from '../hooks/useSettings';
import { useCurrentEvent } from '../hooks/useCurrentEvent';
import { LotusLoader, DiyaIcon } from '../constants';

interface PickupFormProps {
  user: User | Driver;
  onClose: () => void;
  onSubmit: (details: any) => void;
}

export const PickupForm: React.FC<PickupFormProps> = ({ user, onClose, onSubmit }) => {
  // Everything shown here comes from the gathering the server has published,
  // falling back to the global defaults only until it has.
  //
  // This used to read `settings.timeSlot` (a field useSettings never returned, so
  // it always fell through to a hardcoded '5:30 PM') and computed the date as
  // "next Friday" from the DEVICE clock — so a rider requesting a ride for a
  // Thursday sabha filed it against the following Friday.
  const { sabhaStartTime, sabhaLocation } = useSettings();
  const { event, eventId, hasEvent } = useCurrentEvent();

  const arrivalTime = formatTime(
    event?.startsAt
      ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
          .format(new Date(event.startsAt))
      : sabhaStartTime
  );
  const venueAddress = event?.venue?.address || sabhaLocation.address;

  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The gathering's own date, formatted from its parts so no timezone shift. */
  const eventDateFormatted = () => {
    if (!eventId) return 'Not scheduled yet';
    const [y, m, d] = eventId.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  };

  const handleConfirm = async () => {
    if (!eventId) {
      setError('No sabha is scheduled yet. Please check back soon.');
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const formData = {
        address: user.address,
        // The gathering's id IS its date, so the ride is filed against the sabha
        // it is for rather than against a guessed Friday.
        date: eventId,
        eventDate: eventId,
        time: arrivalTime,
        studentName: user.name,
        notes: ''
      };

      await createRideRequest(user.id, formData);

      setIsLoading(false);
      setIsSuccess(true);
      setTimeout(() => {
        onSubmit(formData);
      }, 2000);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to submit request. Please try again.");
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[50vh] p-8 text-center animate-in zoom-in duration-300">
        <div className="relative mb-6">
          <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center text-green-700">
            <svg className="w-16 h-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path className="success-draw" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="absolute -top-2 -right-2">
            <DiyaIcon className="w-8 h-8 text-gold animate-bounce" />
          </div>
        </div>
        <h3 className="text-2xl font-header font-bold text-coffee mb-2">Seva Registered!</h3>
        <p className="text-gray-500 max-w-xs mx-auto">
          Jai Swaminarayan! Your ride for the next sabha has been requested.
        </p>
      </div>
    );
  }

  return (
    <div className="clay-card clay-card-lg overflow-hidden mx-4 mt-8">
      <div className="bg-gradient-to-r from-orange-50 to-cream p-4 border-b border-orange-100 flex items-center justify-between">
        <button onClick={onClose} className="p-2 hover:bg-orange-100/50 rounded-full transition-colors text-coffee btn-feedback">
          <ChevronLeft size={20} />
        </button>
        <h2 className="font-header font-bold text-coffee gold-shimmer">Confirm Ride</h2>
        <div className="w-10"></div> {/* Spacer */}
      </div>

      <div className="p-8 space-y-6">
        {error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-2xl text-sm flex items-center gap-3 border border-red-100">
            <AlertCircle size={20} /> {error}
          </div>
        )}

        <div className="text-center space-y-2">
          <DiyaIcon className="w-12 h-12 mx-auto text-saffron mb-2 animate-float" />
          <p className="text-xs font-bold text-gold-700 uppercase tracking-[0.2em]">Next Sabha</p>
          <h3 className="text-xl font-header font-bold text-coffee">{eventDateFormatted()}</h3>
          <p className="text-sm text-coffee-500">Sabha starts at {arrivalTime}</p>
          <p className="text-xs text-coffee-500">{venueAddress}</p>
        </div>

        <div className="bg-cream/50 rounded-2xl p-5 border border-orange-50 space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-white rounded-lg shadow-sm">
              <MapPin size={18} className="text-saffron" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Pickup From</p>
              <p className="text-sm font-medium text-coffee leading-tight">{user.address}</p>
            </div>
          </div>
        </div>

        <div className="pt-4">
          <button
            onClick={handleConfirm}
            disabled={isLoading || !hasEvent}
            className="clay-button-primary w-full disabled:opacity-50"
          >
            {isLoading ? (
              <LotusLoader size={24} />
            ) : hasEvent ? (
              <>I want a ride to this sabha</>
            ) : (
              <>No sabha scheduled yet</>
            )}
          </button>
          <p className="text-center text-[10px] text-gray-500 mt-4 px-4 italic">
            By confirming, you agree to be ready at your pickup location 5 minutes before the ETA.
          </p>
        </div>
      </div>
    </div>
  );
};