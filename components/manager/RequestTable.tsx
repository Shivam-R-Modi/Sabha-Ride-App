import React, { useState, useEffect } from 'react';
import { StudentRequest, RideStatus } from '../../types';
import {
  Search, CheckCircle, ChevronDown, ChevronUp, MapPin, Clock, ArrowUpDown,
  Check, Trash2, UserPlus, AlertCircle, Users
} from 'lucide-react';
import { useMaxFleetSeats } from '../../hooks/useVehicles';

interface RequestTableProps {
  requests: StudentRequest[];
  loading: boolean;
  onAssign: (requestId: string) => void;
  onDismiss: (requestId: string) => void;
  onBulkAssign: (ids: string[]) => void;
}

/**
 * Seats, and anything about them a manager has to know.
 *
 * Without this the queue reads "7 waiting" when it is 7 requests and 14 people,
 * and a party no vehicle can carry looks exactly like a rider who has merely not
 * been picked up yet. That silence is how a large family gets passed over by
 * every driver, all evening, with nothing on any screen to show it.
 */
const SeatBadges: React.FC<{ req: StudentRequest; maxFleetSeats: number }> = ({ req, maxFleetSeats }) => {
  const seats = req.seats ?? 1;
  const needsSeveralCars = maxFleetSeats > 0 && seats > maxFleetSeats;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg tabular-nums ${
        seats > 1 ? 'bg-cream-300 text-saffron-800' : 'bg-cream-300 text-coffee-700'
      }`}>
        <Users size={11} /> {seats}
      </span>

      {req.isRemainder && req.groupSeatsTotal && (
        <span
          className="text-[10px] font-bold bg-[rgb(var(--info-bg))] text-[rgb(var(--info-text))] px-2 py-1 rounded-lg"
          title={`Part of a group of ${req.groupSeatsTotal}; the rest are already with a driver.`}
        >
          {seats} of {req.groupSeatsTotal} left
        </span>
      )}

      {needsSeveralCars && req.keepTogether && (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-bold bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))] px-2 py-1 rounded-lg"
          title="No vehicle seats this many and the rider asked not to be split. Nobody can pick them up until a larger vehicle is registered, or they agree to travel separately."
        >
          <AlertCircle size={11} /> No car this big
        </span>
      )}

      {needsSeveralCars && !req.keepTogether && !req.isRemainder && (
        <span
          className="text-[10px] font-bold bg-[rgb(var(--warning-bg))] text-[rgb(var(--warning-text))] px-2 py-1 rounded-lg"
          title={`Larger than any vehicle in the fleet (${maxFleetSeats} passenger seats), so they will travel in more than one car.`}
        >
          Needs 2 cars
        </span>
      )}
    </div>
  );
};

export const RequestTable: React.FC<RequestTableProps> = ({
  requests, loading, onAssign, onDismiss, onBulkAssign
}) => {
  const maxFleetSeats = useMaxFleetSeats();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [sortField, setSortField] = useState<'name' | 'time' | 'wait'>('wait');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  /**
   * Clicking a column header sorts by it; clicking the same one again reverses.
   * setSortOrder was never called anywhere, so direction was permanently 'desc'
   * and the arrows on every header were decoration.
   */
  const sortBy = (field: 'name' | 'time' | 'wait') => {
    if (field === sortField) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const SortArrow: React.FC<{ field: 'name' | 'time' | 'wait' }> = ({ field }) =>
    field !== sortField
      ? <ArrowUpDown size={12} className="opacity-40" />
      : sortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;

  // Sorting logic
  const sortedRequests = [...requests].sort((a, b) => {
    let comparison = 0;
    if (sortField === 'name') comparison = a.name.localeCompare(b.name);
    if (sortField === 'time') comparison = a.requestedTimeSlot.localeCompare(b.requestedTimeSlot);
    if (sortField === 'wait') {
        comparison = new Date(a.requestTime).getTime() - new Date(b.requestTime).getTime();
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  }).filter(r => r.name.toLowerCase().includes(filterQuery.toLowerCase()) || r.address.toLowerCase().includes(filterQuery.toLowerCase()));

  const toggleSelectAll = () => {
    if (selectedIds.length === sortedRequests.length) setSelectedIds([]);
    else setSelectedIds(sortedRequests.map(r => r.id));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  if (loading) return <LoadingSkeleton />;

  if (requests.length === 0) return <EmptyState />;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface">
      {/* Sticky Filter Bar */}
      <div className="sticky top-0 z-sticky bg-surface/90 backdrop-blur-md border-b border-hairline/10 p-4">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-2.5 text-coffee-500" size={18} />
            <input 
              type="text" 
              placeholder="Search students or locations..." 
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-cream-200 border border-hairline/20 rounded-xl text-sm focus:ring-2 focus:ring-saffron/20 focus:outline-none transition-all"
            />
          </div>
          
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {selectedIds.length > 0 && (
                <div className="flex items-center gap-2 animate-in slide-in-from-right-4">
                    <span className="text-xs font-bold text-coffee mr-2">{selectedIds.length} Selected</span>
                    <button 
                        onClick={() => onBulkAssign(selectedIds)}
                        className="flex items-center gap-2 bg-[rgb(var(--cta))] text-[rgb(var(--text-on-accent))] px-4 py-2 rounded-xl text-xs font-bold min-h-11 btn-feedback"
                    >
                        <UserPlus size={14} /> Assign Bulk
                    </button>
                </div>
            )}
            {/* The Refresh button was removed rather than repaired. It set a
                spinner state and cleared it 800ms later — it refetched nothing.
                And it never needed to: this list comes from an onSnapshot
                subscription, so it is already live. A refresh control implies
                the opposite, which is worse than not having one. */}
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-[rgb(var(--success-text))] uppercase tracking-widest px-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[rgb(var(--success))] animate-pulse" />
                Live
            </div>
            <div className="md:hidden">
                <select 
                    value={sortField}
                    onChange={(e) => setSortField(e.target.value as any)}
                    className="bg-cream-200 border border-hairline/20 rounded-xl px-3 py-2 text-xs font-bold text-coffee focus:outline-none"
                >
                    <option value="wait">Sort: Wait Time</option>
                    <option value="name">Sort: Name</option>
                    <option value="time">Sort: Sabha Time</option>
                </select>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Desktop View (Table) */}
        <div className="hidden md:block">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-cream-200 z-raised">
              <tr className="border-b border-hairline/10">
                <th className="p-4 w-12">
                  <input 
                    type="checkbox" 
                    checked={selectedIds.length === sortedRequests.length && sortedRequests.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-hairline/20 text-saffron focus:ring-saffron cursor-pointer" 
                  />
                </th>
                <th className="p-4 text-xs font-bold text-coffee-500 uppercase tracking-widest cursor-pointer hover:text-coffee" onClick={() => sortBy('name')}>
                  <div className="flex items-center gap-1">Student <SortArrow field="name" /></div>
                </th>
                <th className="p-4 text-xs font-bold text-coffee-500 uppercase tracking-widest">Seats</th>
                <th className="p-4 text-xs font-bold text-coffee-500 uppercase tracking-widest hidden lg:table-cell">Pickup Address</th>
                <th className="p-4 text-xs font-bold text-coffee-500 uppercase tracking-widest cursor-pointer hover:text-coffee" onClick={() => sortBy('time')}>
                  <div className="flex items-center gap-1">Time <SortArrow field="time" /></div>
                </th>
                <th className="p-4 text-xs font-bold text-coffee-500 uppercase tracking-widest cursor-pointer hover:text-coffee" onClick={() => sortBy('wait')}>
                  <div className="flex items-center gap-1">Status <SortArrow field="wait" /></div>
                </th>
                <th className="p-4 text-xs font-bold text-coffee-500 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedRequests.map((req) => (
                <React.Fragment key={req.id}>
                  <tr 
                    onClick={() => setExpandedRow(expandedRow === req.id ? null : req.id)}
                    className={`border-b border-hairline/10 hover:bg-cream-300/30 transition-colors cursor-pointer group ${selectedIds.includes(req.id) ? 'bg-cream-300/50' : ''}`}
                  >
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                       <input 
                        type="checkbox" 
                        checked={selectedIds.includes(req.id)}
                        onChange={() => toggleSelect(req.id)}
                        className="w-4 h-4 rounded border-hairline/20 text-saffron focus:ring-saffron cursor-pointer" 
                      />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <img src={req.avatarUrl} className="w-8 h-8 rounded-full shadow-sm" alt="" />
                        <span className="text-sm font-bold text-coffee">{req.name}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <SeatBadges req={req} maxFleetSeats={maxFleetSeats} />
                    </td>
                    <td className="p-4 hidden lg:table-cell text-xs text-coffee-500 max-w-xs truncate">
                      {req.address}
                    </td>
                    <td className="p-4">
                      <span className="text-[10px] font-bold bg-cream-300 text-coffee-700 px-2 py-1 rounded-lg uppercase tracking-tighter">
                        {req.requestedTimeSlot}
                      </span>
                    </td>
                    <td className="p-4">
                      {getWaitBadge(req.requestTime)}
                    </td>
                    <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                            onClick={() => onAssign(req.id)}
                            className="p-2 bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))] hover:bg-[rgb(var(--success-bg))] rounded-lg transition-colors"
                            title="Assign to Driver"
                        >
                          <Check size={18} />
                        </button>
                        <button 
                            onClick={() => onDismiss(req.id)}
                            className="p-2 bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))] hover:bg-[rgb(var(--danger-bg))] rounded-lg transition-colors"
                            title="Dismiss Request"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* Tablet Expanded Address (Hidden on large desktop) */}
                  {expandedRow === req.id && (
                    <tr className="lg:hidden bg-cream-200/50">
                        <td colSpan={7} className="px-16 py-3">
                            <p className="text-xs text-coffee-500 flex items-center gap-2">
                                <MapPin size={12} className="text-saffron" /> {req.address}
                            </p>
                        </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile View (Cards).
            Selection used to exist only in the desktop table above, so on a
            phone the checkboxes and "Assign Bulk" were simply unreachable —
            recorded as a known gap in STATUS.md. A manager triaging on a phone
            on a Friday evening is exactly who needs to move six requests at
            once. */}
        <div className="md:hidden p-4 space-y-4">
          {sortedRequests.map((req) => (
             <SwipeableCard
                key={req.id}
                request={req}
                selected={selectedIds.includes(req.id)}
                selectionMode={selectedIds.length > 0}
                onToggleSelect={() => toggleSelect(req.id)}
                onAssign={() => onAssign(req.id)}
                onDismiss={() => onDismiss(req.id)}
             />
          ))}
        </div>
      </div>
    </div>
  );
};

const SwipeableCard: React.FC<{
    request: StudentRequest,
    selected: boolean,
    selectionMode: boolean,
    onToggleSelect: () => void,
    onAssign: () => void,
    onDismiss: () => void
}> = ({ request, selected, selectionMode, onToggleSelect, onAssign, onDismiss }) => {
    // Same fleet threshold the desktop table uses. A manager triaging on a phone
    // on a Friday evening is exactly who needs to see that a party cannot fit.
    const maxFleetSeats = useMaxFleetSeats();
    const [offset, setOffset] = useState(0);
    const [startX, setStartX] = useState(0);

    const handleTouchStart = (e: React.TouchEvent) => {
        setStartX(e.touches[0].clientX);
        holdTimer.current = setTimeout(onToggleSelect, 450);
    };
    const handleTouchMove = (e: React.TouchEvent) => {
        const currentX = e.touches[0].clientX;
        const diff = currentX - startX;
        // Any real movement means this is a swipe, not a hold.
        if (Math.abs(diff) > 8) cancelHold();
        if (Math.abs(diff) > 20) setOffset(diff);
    };
    const handleTouchEnd = () => {
        cancelHold();
        // Swipe actions are suspended while selecting — otherwise a sloppy
        // tap-to-select dismisses somebody.
        if (!selectionMode) {
            if (offset > 120) onAssign();
            if (offset < -120) onDismiss();
        }
        setOffset(0);
    };

    const waitMinutes = Math.floor((Date.now() - new Date(request.requestTime).getTime()) / 60000);
    const isUrgent = waitMinutes > 30;

    /**
     * Long-press enters selection mode. Deliberately not a permanent row of
     * checkboxes: triage is one-at-a-time most of the time, and a checkbox on
     * every card would cost width on the screen where width is scarcest.
     */
    const holdTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelHold = () => {
        if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    };
    React.useEffect(() => cancelHold, []);

    return (
        <div className="relative group overflow-hidden rounded-2xl">
            {/* Background Actions */}
            <div className="absolute inset-0 flex items-center justify-between px-6">
                <div className="flex items-center gap-2 text-[rgb(var(--success-text))] font-bold">
                    <UserPlus size={24} /> <span className="text-xs">ASSIGN</span>
                </div>
                <div className="flex items-center gap-2 text-[rgb(var(--danger-text))] font-bold">
                    <span className="text-xs">DISMISS</span> <Trash2 size={24} />
                </div>
            </div>

            {/* Foreground Card */}
            <div 
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onClick={() => { if (selectionMode) onToggleSelect(); }}
                style={{ transform: `translateX(${offset}px)` }}
                className={`relative z-raised p-4 rounded-2xl border shadow-sm transition-transform
                    duration-200 flex items-center gap-4 border-l-4
                    ${selected ? 'bg-[rgb(var(--accent-tint-1))] border-saffron' : 'bg-surface border-hairline/10'}
                    ${isUrgent ? 'border-l-[rgb(var(--danger))]' : 'border-l-saffron'}`}
            >
                {selectionMode && (
                    <input
                        type="checkbox"
                        checked={selected}
                        onChange={onToggleSelect}
                        onClick={e => e.stopPropagation()}
                        aria-label={`Select ${request.name}`}
                        className="w-5 h-5 shrink-0 accent-saffron"
                    />
                )}
                <img src={request.avatarUrl} className="w-12 h-12 rounded-full shrink-0" alt="" />
                <div className="min-w-0 flex-1">
                    <div className="flex justify-between items-start">
                        <h4 className="font-bold text-coffee truncate pr-2">{request.name}</h4>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isUrgent ? 'bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))]' : 'bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))]'}`}>
                            {waitMinutes}m
                        </span>
                    </div>
                    <p className="text-xs text-coffee-500 truncate mb-1">{request.address}</p>
                    <div className="flex items-center gap-3 flex-wrap">
                         <div className="flex items-center gap-1 text-[10px] text-coffee-500 font-bold uppercase">
                            <Clock size={12} /> {request.requestedTimeSlot}
                         </div>
                         <SeatBadges req={request} maxFleetSeats={maxFleetSeats} />
                    </div>
                </div>
                <div className={`flex flex-col gap-2 ${selectionMode ? 'hidden' : ''}`}>
                     <button onClick={onAssign} aria-label={`Assign ${request.name}`} className="w-8 h-8 rounded-full bg-cream-300 text-saffron-800 flex items-center justify-center">
                        <UserPlus size={16} />
                     </button>
                     {/* Was a MoreVertical (⋮) icon — the universal "open a
                         menu" affordance — wired straight to the destructive
                         dismiss. Now it looks like what it does. */}
                     <button
                        onClick={onDismiss}
                        title="Dismiss Request"
                        className="w-8 h-8 rounded-full bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))] flex items-center justify-center"
                     >
                        <Trash2 size={16} />
                     </button>
                </div>
            </div>
        </div>
    );
};

const getWaitBadge = (time: string) => {
    const minutes = Math.floor((Date.now() - new Date(time).getTime()) / 60000);
    if (minutes > 30) return (
        <span className="flex items-center gap-1 text-[10px] font-bold text-[rgb(var(--danger-text))] bg-[rgb(var(--danger-bg))] px-2 py-1 rounded-full">
            <AlertCircle size={12} /> {minutes}m wait
        </span>
    );
    return (
        <span className="text-[10px] font-bold text-[rgb(var(--success-text))] bg-[rgb(var(--success-bg))] px-2 py-1 rounded-full">
            {minutes}m wait
        </span>
    );
};

const LoadingSkeleton = () => (
    <div className="p-4 space-y-4">
        {[1,2,3,4,5].map(i => (
            <div key={i} className="h-16 bg-cream-200 rounded-2xl animate-pulse"></div>
        ))}
    </div>
);

const EmptyState = () => (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-24 h-24 bg-cream-300 rounded-full flex items-center justify-center mb-6 text-saffron relative">
            <CheckCircle size={40} />
            <div className="absolute inset-0 border-4 border-dashed border-gold/20 rounded-full"></div>
        </div>
        <h3 className="text-2xl font-header font-bold text-coffee mb-2">All Caught Up!</h3>
        <p className="text-coffee-500 max-w-xs mx-auto text-sm">Every student has been assigned a ride for this week's sabha. Great job coordination!</p>
    </div>
);