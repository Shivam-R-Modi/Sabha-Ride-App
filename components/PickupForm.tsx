import React, { useState } from 'react';
import { User, Driver } from '../types';
import { MapPin, ChevronLeft, CheckCircle2, AlertCircle, Minus, Plus, Users } from 'lucide-react';
import { createRideRequest } from '../hooks/useRides';
import { MIN_SEATS, MAX_SEATS, DEFAULT_SEATS } from '../src/constants/seats';
import { useSettings, formatTime } from '../hooks/useSettings';
import { useCurrentEvent } from '../hooks/useCurrentEvent';
import { LotusLoader, DiyaIcon } from '../constants';

interface PickupFormProps {
  user: User | Driver;
  onClose: () => void;
  onSubmit: (details: any) => void;
  /**
   * Rendered inside a <Sheet>, which already supplies the surface, the title and
   * a close button. Without this the rider gets two of each — a chevron and an
   * X that do the same thing, one above the other.
   */
  embedded?: boolean;
}

export const PickupForm: React.FC<PickupFormProps> = ({ user, onClose, onSubmit, embedded = false }) => {
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

  // How many people are travelling. Until now a request WAS one seat, so a family
  // arriving together was booked a single place and the driver turned up with room
  // for one. Defaults to 1, which is what every existing rider means.
  const [seats, setSeats] = useState(DEFAULT_SEATS);
  // Some families would rather wait and travel in one car than be separated.
  // Default is to allow splitting — getting people there usually beats waiting —
  // but the choice belongs to them, not to the dispatcher.
  const [keepTogether, setKeepTogether] = useState(false);

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
        seats,
        allowSplit: !keepTogether,
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
          <div className="w-24 h-24 bg-[rgb(var(--success-bg))] rounded-full flex items-center justify-center text-[rgb(var(--success-text))]">
            <svg className="w-16 h-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path className="success-draw" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="absolute -top-2 -right-2">
            <DiyaIcon className="w-8 h-8 text-gold animate-bounce" />
          </div>
        </div>
        <h3 className="text-2xl font-header font-bold text-coffee mb-2">Seva Registered!</h3>
        <p className="text-coffee-500 max-w-xs mx-auto">
          Jai Swaminarayan! {seats > 1
            ? `Your ride for ${seats} people has been requested.`
            : 'Your ride for the next sabha has been requested.'}
        </p>
        {/* Said here rather than discovered at the kerb. With the current fleet a
            party of four or more cannot travel in one car. */}
        {seats > 1 && !keepTogether && (
          <p className="text-xs text-coffee-500 max-w-xs mx-auto mt-3">
            If no single car is big enough, we may send two — some of you will
            travel in the first, the rest in the next one.
          </p>
        )}
      </div>
    );
  }

  const body = (
    <div className={embedded ? 'space-y-6' : 'p-8 space-y-6'}>
        {error && (
          <div className="bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))] p-4 rounded-2xl text-sm flex items-center gap-3 border border-[rgb(var(--danger))]/25">
            <AlertCircle size={20} /> {error}
          </div>
        )}

        <div className="text-center space-y-2">
          <DiyaIcon className="w-12 h-12 mx-auto text-saffron mb-2" />
          <p className="text-xs font-bold text-gold-700 uppercase tracking-[0.2em]">Next Sabha</p>
          <h3 className="text-xl font-header font-bold text-coffee">{eventDateFormatted()}</h3>
          {/* Only claim a time and a place when there is a gathering to claim them
              for. With no event published, `arrivalTime` is the global default and
              `venueAddress` the default venue — printing those under "Next Sabha"
              stated a start time for a sabha that does not exist. */}
          {hasEvent ? (
            <>
              <p className="text-sm text-coffee-500">Sabha starts at {arrivalTime}</p>
              <p className="text-xs text-coffee-500">{venueAddress}</p>
            </>
          ) : (
            <p className="text-sm text-coffee-500">
              No sabha is on the calendar yet, so rides cannot be requested.
            </p>
          )}
        </div>

        <div className="bg-cream/50 rounded-2xl p-5 border border-hairline/10 space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-surface rounded-lg shadow-sm">
              <MapPin size={18} className="text-saffron" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-coffee-500 uppercase tracking-wider">Pickup From</p>
              <p className="text-sm font-medium text-coffee leading-tight">{user.address}</p>
            </div>
          </div>
        </div>

        {/* How many seats. A stepper rather than a text field: the value is a
            small count, and typing invites the 0 and the "two" that a number
            input happily accepts. */}
        <div className="bg-cream/50 rounded-2xl p-5 border border-hairline/10 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-surface rounded-lg shadow-sm">
                <Users size={18} className="text-saffron" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-coffee-500 uppercase tracking-wider">How many of you?</p>
                <p className="text-sm font-medium text-coffee leading-tight">Include yourself</p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setSeats(s => Math.max(MIN_SEATS, s - 1))}
                disabled={seats <= MIN_SEATS}
                aria-label="One fewer person"
                className="w-11 h-11 rounded-full bg-surface shadow-sm flex items-center justify-center text-coffee disabled:opacity-30 btn-feedback"
              >
                <Minus size={18} />
              </button>
              <span
                className="w-8 text-center text-xl font-header font-bold text-coffee tabular-nums"
                aria-live="polite"
              >
                {seats}
              </span>
              <button
                type="button"
                onClick={() => setSeats(s => Math.min(MAX_SEATS, s + 1))}
                disabled={seats >= MAX_SEATS}
                aria-label="One more person"
                className="w-11 h-11 rounded-full bg-surface shadow-sm flex items-center justify-center text-coffee disabled:opacity-30 btn-feedback"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>

          {/* Only offered when it can actually happen. Shown to a single rider it
              would be a decision about nothing. */}
          {seats > 1 && (
            <label className="flex items-start gap-3 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={keepTogether}
                onChange={e => setKeepTogether(e.target.checked)}
                className="mt-1 w-5 h-5 accent-saffron shrink-0"
              />
              <span className="text-sm text-coffee leading-snug">
                Keep us in one car
                <span className="block text-xs text-coffee-500">
                  We may need to send two cars if no single car is big enough. Tick
                  this to wait for one car instead — it can mean a longer wait.
                </span>
              </span>
            </label>
          )}
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
          <p className="text-center text-[10px] text-coffee-500 mt-4 px-4 italic">
            By confirming, you agree to be ready at your pickup location 5 minutes before the ETA.
          </p>
        </div>
    </div>
  );

  if (embedded) return body;

  return (
    <div className="clay-card clay-card-lg overflow-hidden mx-4 mt-8">
      <div className="bg-gradient-to-r from-cream-300 to-cream p-4 border-b border-hairline/10 flex items-center justify-between">
        <button onClick={onClose} className="p-2 hover:bg-cream-300/50 rounded-full transition-colors text-coffee btn-feedback">
          <ChevronLeft size={20} />
        </button>
        <h2 className="font-header font-bold text-coffee gold-shimmer">Confirm Ride</h2>
        <div className="w-10"></div> {/* Spacer */}
      </div>
      {body}
    </div>
  );
};