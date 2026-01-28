import React from 'react';
import { Ride, RideStatus } from '../types';
import { Phone, MessageSquare, MapPin, Navigation, Clock } from 'lucide-react';

interface RideStatusCardProps {
  ride: Ride;
}

const STATUS_CONFIG: Record<RideStatus, { label: string; color: string; bg: string }> = {
  requested: { label: 'Looking for Driver', color: 'text-orange-600', bg: 'bg-orange-100' },
  assigned: { label: 'Driver Assigned', color: 'text-blue-600', bg: 'bg-blue-100' },
  driver_en_route: { label: 'Driver En Route', color: 'text-purple-600', bg: 'bg-purple-100' },
  arriving: { label: 'Arriving Soon', color: 'text-green-600', bg: 'bg-green-100' },
  completed: { label: 'Completed', color: 'text-gray-600', bg: 'bg-gray-100' },
  cancelled: { label: 'Cancelled', color: 'text-red-600', bg: 'bg-red-100' },
};

export const RideStatusCard: React.FC<RideStatusCardProps> = ({ ride }) => {
  const config = STATUS_CONFIG[ride.status];
  const driver = ride.driver;

  if (ride.status === 'requested') {
    return (
      <div className="clay-card text-center animate-pulse">
        <div className="w-16 h-16 bg-orange-100 rounded-full mx-auto flex items-center justify-center mb-3">
          <Clock className="text-saffron w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-coffee">Request Received</h3>
        <p className="text-gray-500 text-sm mt-1">Coordinating with nearby sevaks...</p>
      </div>
    );
  }

  if (!driver) return null;

  return (
    <div className="clay-card clay-card-lg overflow-hidden w-full">
      {/* Header Status */}
      <div className={`${config.bg} px-4 py-2.5 flex justify-between items-center`}>
        <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider ${config.color}`}>
          {config.label}
        </span>
        {ride.etaMinutes && (
          <span className="text-[10px] sm:text-xs font-semibold bg-white/60 px-2 py-0.5 rounded text-coffee">
            ETA: {ride.etaMinutes} min
          </span>
        )}
      </div>

      <div className="p-4 sm:p-5">
        {/* Driver Info */}
        <div className="flex items-center sm:items-start gap-3 sm:gap-4 mb-5">
          <img
            src={driver.avatarUrl}
            alt={driver.name}
            className="w-12 h-12 sm:w-16 sm:h-16 rounded-full object-cover border-2 border-white shadow-md shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h3 className="font-header font-bold text-base sm:text-lg text-coffee truncate">{driver.name}</h3>
            <p className="text-[10px] sm:text-sm text-gray-500 truncate">{driver.carColor} {driver.carModel}</p>
            <div className="inline-block bg-gray-100 px-2 py-0.5 rounded text-[10px] font-mono font-medium text-gray-700 mt-1">
              {driver.plateNumber}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <a href={`tel:${driver.phone}`} className="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center hover:bg-green-200 transition-colors btn-feedback">
              <Phone size={18} />
            </a>
            <button className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center hover:bg-blue-200 transition-colors btn-feedback">
              <MessageSquare size={18} />
            </button>
          </div>
        </div>

        {/* Route Info */}
        <div className="relative pl-5 border-l-2 border-dashed border-gray-200 space-y-5 mb-5 ml-1">
          <div className="relative">
            <div className="absolute -left-[27px] top-0 bg-white p-1">
              <div className="w-3 h-3 rounded-full bg-saffron border-2 border-white shadow-sm ring-1 ring-gray-100"></div>
            </div>
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Pickup</p>
            <p className="text-xs sm:text-sm font-medium text-coffee line-clamp-1">{ride.pickupAddress}</p>
            <p className="text-[10px] text-saffron font-bold">{ride.timeSlot}</p>
          </div>
          <div className="relative">
            <div className="absolute -left-[27px] top-0 bg-white p-1">
              <div className="w-3 h-3 rounded-full bg-coffee border-2 border-white shadow-sm ring-1 ring-gray-100"></div>
            </div>
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Drop-off</p>
            <p className="text-xs sm:text-sm font-medium text-coffee">BAPS Mandir</p>
          </div>
        </div>

        {/* Peers */}
        {ride.peers && ride.peers.length > 0 && (
          <div className="border-t border-gray-100 pt-4">
            <p className="text-[10px] text-gray-400 font-bold uppercase mb-2 tracking-wider">Riding with</p>
            <div className="flex items-center -space-x-2">
              {ride.peers.map(peer => (
                <img
                  key={peer.id}
                  src={peer.avatarUrl}
                  alt={peer.name}
                  className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-white shadow-sm"
                  title={peer.name}
                />
              ))}
              {ride.peers.length > 3 && (
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-gray-500">
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