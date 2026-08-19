import React, { useState } from 'react';
import { Ride } from '../types';
import { Calendar, Clock, ChevronDown, ChevronUp, MapPin, Car, Loader2 } from 'lucide-react';

interface MyRidesProps {
  history: Ride[];
  upcoming: Ride[];
  onLoadMore?: () => void;
  hasMoreHistory?: boolean;
  loadingMore?: boolean;
}

const RideCard: React.FC<{ ride: Ride; isHistory?: boolean }> = ({ ride }) => {
  // "Details ›" had no onClick at all. There is no ride-detail screen to route
  // to, but the ride document already carries the pickup address and the
  // vehicle — so the button reveals them in place rather than promising a
  // destination that does not exist.
  const [expanded, setExpanded] = useState(false);

  return (
  <div className="clay-card flex flex-col gap-3">
    <div className="flex justify-between items-start">
      <div className="flex gap-3">
        <div className="bg-cream-300 w-12 h-12 rounded-lg flex flex-col items-center justify-center text-saffron-800 shrink-0">
          <span className="text-xs font-bold uppercase">{new Date(ride.date).toLocaleDateString('en-US', { month: 'short' })}</span>
          <span className="text-lg font-bold leading-none">{new Date(ride.date).getDate()}</span>
        </div>
        <div>
          <h4 className="font-medium text-coffee">Weekly Sabha</h4>
          <div className="flex items-center gap-1 text-xs text-coffee-500 mt-0.5">
            <Clock size={12} />
            <span>{ride.timeSlot}</span>
          </div>
        </div>
      </div>
      <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${ride.status === 'completed' ? 'bg-cream-300 text-coffee-500' : 'bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))]'
        }`}>
        {ride.status.replace('_', ' ')}
      </div>
    </div>

    <div className="w-full h-px bg-cream-300"></div>

    <div className="flex justify-between items-center">
      <div className="flex items-center gap-2">
        {ride.driver && (
          <>
            <img src={ride.driver.avatarUrl} className="w-6 h-6 rounded-full" alt="Sarthi" />
            <span className="text-xs text-coffee-700">{ride.driver.name}</span>
          </>
        )}
      </div>
      <button
        onClick={() => setExpanded(prev => !prev)}
        aria-expanded={expanded}
        className="text-saffron-800 text-xs font-medium flex items-center gap-0.5 hover:underline"
      >
        Details {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
    </div>

    {expanded && (
      <div className="border-t border-hairline/10 pt-3 space-y-2 text-xs text-coffee-700">
        <div className="flex items-start gap-2">
          <MapPin size={12} className="mt-0.5 shrink-0 text-saffron" />
          <span>{ride.pickupAddress || 'No pickup address recorded'}</span>
        </div>
        <div className="flex items-start gap-2">
          <Car size={12} className="mt-0.5 shrink-0 text-saffron" />
          <span>
            {ride.driver
              ? `${ride.driver.carColor || ''} ${ride.driver.carModel || 'Vehicle'}`.trim()
                + (ride.driver.plateNumber ? ` — ${ride.driver.plateNumber}` : '')
              : 'No driver assigned yet'}
          </span>
        </div>
      </div>
    )}
  </div>
  );
};

export const MyRides: React.FC<MyRidesProps> = ({
  history,
  upcoming,
  onLoadMore,
  hasMoreHistory = false,
  loadingMore = false
}) => {
  const [activeTab, setActiveTab] = useState<'upcoming' | 'history'>('upcoming');

  return (
    <div className="space-y-4 pb-6">
      <h2 className="text-xl font-header font-bold text-coffee px-4 pt-4">My Rides</h2>

      {/* Tabs */}
      <div className="px-4">
        <div className="bg-cream-300 p-1 rounded-xl flex">
          <button
            onClick={() => setActiveTab('upcoming')}
            className={`flex-1 py-3 text-sm font-medium rounded-lg transition-all ${activeTab === 'upcoming' ? 'bg-surface text-coffee shadow-sm' : 'text-coffee-700'
              }`}
          >
            Upcoming
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-3 text-sm font-medium rounded-lg transition-all ${activeTab === 'history' ? 'bg-surface text-coffee shadow-sm' : 'text-coffee-700'
              }`}
          >
            History
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 space-y-3">
        {activeTab === 'upcoming' ? (
          upcoming.length > 0 ? (
            upcoming.map(ride => <RideCard key={ride.id} ride={ride} />)
          ) : (
            <div className="text-center py-12 bg-surface rounded-xl border border-dashed border-hairline/20">
              <div className="w-12 h-12 bg-cream-200 rounded-full flex items-center justify-center mx-auto mb-3 text-coffee-400">
                <Calendar size={24} />
              </div>
              <p className="text-coffee-500 font-medium">No upcoming rides</p>
              <p className="text-xs text-coffee-500 mt-1">Request a pickup from the home screen</p>
            </div>
          )
        ) : (
          <>
            {history.length > 0 ? (
              <>
                {history.map(ride => <RideCard key={ride.id} ride={ride} isHistory />)}

                {/* Load More Button */}
                {hasMoreHistory && onLoadMore && (
                  <button
                    onClick={onLoadMore}
                    disabled={loadingMore}
                    className="w-full py-3 bg-surface border border-hairline/20 rounded-xl text-sm font-medium text-coffee hover:bg-cream-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Loading...
                      </>
                    ) : (
                      'Load More'
                    )}
                  </button>
                )}
              </>
            ) : (
              <div className="text-center py-12 bg-surface rounded-xl border border-dashed border-hairline/20">
                <div className="w-12 h-12 bg-cream-200 rounded-full flex items-center justify-center mx-auto mb-3 text-coffee-400">
                  <Calendar size={24} />
                </div>
                <p className="text-coffee-500 font-medium">No ride history</p>
                <p className="text-xs text-coffee-500 mt-1">Your completed rides will appear here</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};