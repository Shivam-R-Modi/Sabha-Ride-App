import React from 'react';
import { Ride, RideStatus } from '../types';
import { Phone, MessageSquare, MapPin, Navigation, Clock } from 'lucide-react';

interface RideStatusCardProps {
  ride: Ride;
}

/**
 * Status colours come from tokens, not from Tailwind's stock palette.
 *
 * They used to be Tailwind's stock scales — blue-100 behind blue-800 and so on.
 * Those are fixed light values that stay light whatever the theme, so on a dark
 * surface the header band was a pale slab and the text on it did not move with
 * it. Six hues collapse to four token pairs, which is also more honest: "en
 * route" and "arriving" are stages of the same thing, not different kinds of
 * thing.
 */
const STATUS_CONFIG: Record<RideStatus, { label: string; tone: string }> = {
  requested: { label: 'Looking for Driver', tone: 'bg-[rgb(var(--warning-bg))] text-[rgb(var(--warning-text))]' },
  assigned: { label: 'Driver Assigned', tone: 'bg-[rgb(var(--info-bg))] text-[rgb(var(--info-text))]' },
  driver_en_route: { label: 'Driver En Route', tone: 'bg-[rgb(var(--info-bg))] text-[rgb(var(--info-text))]' },
  arriving: { label: 'Arriving Soon', tone: 'bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))]' },
  in_progress: { label: 'In Progress', tone: 'bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))]' },
  completed: { label: 'Completed', tone: 'bg-cream-300 text-coffee-700' },
  cancelled: { label: 'Cancelled', tone: 'bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))]' },
};

export const RideStatusCard: React.FC<RideStatusCardProps> = ({ ride }) => {
  const config = STATUS_CONFIG[ride.status];
  const driver = ride.driver;

  if (ride.status === 'requested') {
    return (
      <div className="clay-card text-center">
        <div className="w-16 h-16 bg-cream-300 rounded-full mx-auto flex items-center justify-center mb-3">
          <Clock className="text-saffron w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-coffee">Request Received</h3>
        <p className="text-coffee-500 text-sm mt-1">Coordinating with nearby sevaks…</p>
      </div>
    );
  }

  if (!driver) return null;

  return (
    <div className="clay-card clay-card-lg overflow-hidden w-full">
      {/* Header Status */}
      <div className={`${config.tone} px-4 py-2.5 flex justify-between items-center`}>
        <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider">
          {config.label}
        </span>
        {ride.etaMinutes && (
          // Inherits the band's own text colour. It used to be a fixed
          // white-at-60% box with coffee text, which on a dark theme is light
          // text inside a light box.
          <span className="text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded
                           bg-[rgb(var(--surface)/0.35)] border border-current/20">
            ETA: {ride.etaMinutes} min
          </span>
        )}
      </div>

      <div className="p-4 sm:p-5">
        {/* Driver Info.
            Contact moved to its own row below rather than sharing this one.
            At 330px the avatar, two 40px circles and the name were competing
            for the same line, and the name lost — "Ramesh Patel" rendered as
            "Ra…", which is the single most important word on the card. The
            buttons also gain a proper label and a full-width target, which is
            what someone standing on a kerb in the dark actually needs. */}
        <div className="flex items-center gap-3 sm:gap-4 mb-4">
          <img
            src={driver.avatarUrl}
            alt=""
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover border-2 border-surface shadow-md shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h3 className="font-header font-bold text-base sm:text-lg text-coffee">{driver.name}</h3>
            <p className="text-xs sm:text-sm text-coffee-500">
              {[driver.carColor, driver.carModel].filter(Boolean).join(' ')}
            </p>
            {driver.plateNumber && (
              <div className="inline-block bg-cream-300/70 px-2 py-0.5 rounded text-[11px] font-mono font-medium text-coffee-700 mt-1">
                {driver.plateNumber}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 mb-5">
          <a
            href={`tel:${driver.phone}`}
            className="flex-1 min-h-11 rounded-xl bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))]
                       flex items-center justify-center gap-2 font-semibold text-sm
                       hover:opacity-90 transition-opacity btn-feedback no-underline"
          >
            <Phone size={16} /> Call
          </a>
          {/* Had no onClick — a message button that did nothing. There is no
              in-app messaging, so it opens the phone's SMS composer to the same
              number the call button uses. Hidden entirely when the driver's
              phone is unknown, rather than sitting there inert. */}
          {driver.phone && (
            <a
              href={`sms:${driver.phone}`}
              className="flex-1 min-h-11 rounded-xl bg-[rgb(var(--info-bg))] text-[rgb(var(--info-text))]
                         flex items-center justify-center gap-2 font-semibold text-sm
                         hover:opacity-90 transition-opacity btn-feedback no-underline"
            >
              <MessageSquare size={16} /> Text
            </a>
          )}
        </div>

        {/* Route Info */}
        <div className="relative pl-5 border-l-2 border-dashed border-hairline/20 space-y-5 mb-5 ml-1">
          <div className="relative">
            <div className="absolute -left-[27px] top-0 bg-surface p-1">
              <div className="w-3 h-3 rounded-full bg-saffron border-2 border-surface shadow-sm"></div>
            </div>
            <p className="text-[10px] text-coffee-500 uppercase font-bold tracking-wider">Pickup</p>
            <p className="text-sm font-medium text-coffee">{ride.pickupAddress}</p>
            <p className="text-[10px] text-saffron-800 font-bold">{ride.timeSlot}</p>
          </div>
          <div className="relative">
            <div className="absolute -left-[27px] top-0 bg-surface p-1">
              <div className="w-3 h-3 rounded-full bg-coffee border-2 border-surface shadow-sm"></div>
            </div>
            <p className="text-[10px] text-coffee-500 uppercase font-bold tracking-wider">Drop-off</p>
            <p className="text-sm font-medium text-coffee">BAPS Mandir</p>
          </div>
        </div>

        {/* Peers */}
        {ride.peers && ride.peers.length > 0 && (
          <div className="border-t border-hairline/10 pt-4">
            <p className="text-[10px] text-coffee-500 font-bold uppercase mb-2 tracking-wider">Riding with</p>
            <div className="flex items-center -space-x-2">
              {ride.peers.map(peer => (
                <img
                  key={peer.id}
                  src={peer.avatarUrl}
                  alt={peer.name}
                  className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-surface shadow-sm"
                  title={peer.name}
                />
              ))}
              {ride.peers.length > 3 && (
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-cream-300 border-2 border-surface flex items-center justify-center text-[10px] font-bold text-coffee-500">
                  +{ride.peers.length - 3}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};