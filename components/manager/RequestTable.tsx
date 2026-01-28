import React, { useState, useEffect } from 'react';
import { StudentRequest, RideStatus } from '../../types';
import { 
  Search, Filter, MoreVertical, Phone, CheckCircle, XCircle, 
  ChevronDown, ChevronUp, User, MapPin, Clock, ArrowUpDown,
  Check, Trash2, UserPlus, RefreshCw, AlertCircle
} from 'lucide-react';

interface RequestTableProps {
  requests: StudentRequest[];
  loading: boolean;
  onAssign: (requestId: string) => void;
  onDismiss: (requestId: string) => void;
  onBulkAssign: (ids: string[]) => void;
}

export const RequestTable: React.FC<RequestTableProps> = ({ 
  requests, loading, onAssign, onDismiss, onBulkAssign 
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [sortField, setSortField] = useState<'name' | 'time' | 'wait'>('wait');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  const handleRefresh = () => {
      setIsRefreshing(true);
      setTimeout(() => setIsRefreshing(false), 800);
  };

  if (loading) return <LoadingSkeleton />;

  if (requests.length === 0) return <EmptyState />;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* Sticky Filter Bar */}
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-gray-100 p-4">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
            <input 
              type="text" 
              placeholder="Search students or locations..." 
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-saffron/20 focus:outline-none transition-all"
            />
          </div>
          
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {selectedIds.length > 0 && (
                <div className="flex items-center gap-2 animate-in slide-in-from-right-4">
                    <span className="text-xs font-bold text-coffee mr-2">{selectedIds.length} Selected</span>
                    <button 
                        onClick={() => onBulkAssign(selectedIds)}
                        className="flex items-center gap-2 bg-saffron text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg shadow-orange-100 btn-feedback"
                    >
                        <UserPlus size={14} /> Assign Bulk
                    </button>
                </div>
            )}
            <button 
                onClick={handleRefresh}
                className={`p-2 text-gray-400 hover:text-coffee rounded-xl border border-gray-100 transition-all ${isRefreshing ? 'animate-spin text-saffron' : ''}`}
            >
                <RefreshCw size={18} />
            </button>
            <div className="md:hidden">
                <select 
                    value={sortField}
                    onChange={(e) => setSortField(e.target.value as any)}
                    className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-coffee focus:outline-none"
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
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr className="border-b border-gray-100">
                <th className="p-4 w-12">
                  <input 
                    type="checkbox" 
                    checked={selectedIds.length === sortedRequests.length && sortedRequests.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-gray-300 text-saffron focus:ring-saffron cursor-pointer" 
                  />
                </th>
                <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest cursor-pointer hover:text-coffee" onClick={() => setSortField('name')}>
                  <div className="flex items-center gap-1">Student <ArrowUpDown size={12} /></div>
                </th>
                <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest hidden lg:table-cell">Pickup Address</th>
                <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest cursor-pointer hover:text-coffee" onClick={() => setSortField('time')}>
                  <div className="flex items-center gap-1">Time <ArrowUpDown size={12} /></div>
                </th>
                <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest cursor-pointer hover:text-coffee" onClick={() => setSortField('wait')}>
                  <div className="flex items-center gap-1">Status <ArrowUpDown size={12} /></div>
                </th>
                <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedRequests.map((req) => (
                <React.Fragment key={req.id}>
                  <tr 
                    onClick={() => setExpandedRow(expandedRow === req.id ? null : req.id)}
                    className={`border-b border-gray-50 hover:bg-orange-50/30 transition-colors cursor-pointer group ${selectedIds.includes(req.id) ? 'bg-orange-50/50' : ''}`}
                  >
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                       <input 
                        type="checkbox" 
                        checked={selectedIds.includes(req.id)}
                        onChange={() => toggleSelect(req.id)}
                        className="w-4 h-4 rounded border-gray-300 text-saffron focus:ring-saffron cursor-pointer" 
                      />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <img src={req.avatarUrl} className="w-8 h-8 rounded-full shadow-sm" alt="" />
                        <span className="text-sm font-bold text-coffee">{req.name}</span>
                      </div>
                    </td>
                    <td className="p-4 hidden lg:table-cell text-xs text-gray-500 max-w-xs truncate">
                      {req.address}
                    </td>
                    <td className="p-4">
                      <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded-lg uppercase tracking-tighter">
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
                            className="p-2 bg-green-50 text-green-600 hover:bg-green-100 rounded-lg transition-colors"
                            title="Assign to Driver"
                        >
                          <Check size={18} />
                        </button>
                        <button 
                            onClick={() => onDismiss(req.id)}
                            className="p-2 bg-red-50 text-red-400 hover:bg-red-100 rounded-lg transition-colors"
                            title="Dismiss Request"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* Tablet Expanded Address (Hidden on large desktop) */}
                  {expandedRow === req.id && (
                    <tr className="lg:hidden bg-gray-50/50">
                        <td colSpan={6} className="px-16 py-3">
                            <p className="text-xs text-gray-500 flex items-center gap-2">
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

        {/* Mobile View (Cards) */}
        <div className="md:hidden p-4 space-y-4">
          {sortedRequests.map((req) => (
             <SwipeableCard 
                key={req.id} 
                request={req} 
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
    onAssign: () => void, 
    onDismiss: () => void 
}> = ({ request, onAssign, onDismiss }) => {
    const [offset, setOffset] = useState(0);
    const [startX, setStartX] = useState(0);

    const handleTouchStart = (e: React.TouchEvent) => setStartX(e.touches[0].clientX);
    const handleTouchMove = (e: React.TouchEvent) => {
        const currentX = e.touches[0].clientX;
        const diff = currentX - startX;
        if (Math.abs(diff) > 20) setOffset(diff);
    };
    const handleTouchEnd = () => {
        if (offset > 120) onAssign();
        if (offset < -120) onDismiss();
        setOffset(0);
    };

    const waitMinutes = Math.floor((Date.now() - new Date(request.requestTime).getTime()) / 60000);
    const isUrgent = waitMinutes > 30;

    return (
        <div className="relative group overflow-hidden rounded-2xl">
            {/* Background Actions */}
            <div className="absolute inset-0 flex items-center justify-between px-6">
                <div className="flex items-center gap-2 text-green-600 font-bold">
                    <UserPlus size={24} /> <span className="text-xs">ASSIGN</span>
                </div>
                <div className="flex items-center gap-2 text-red-500 font-bold">
                    <span className="text-xs">DISMISS</span> <Trash2 size={24} />
                </div>
            </div>

            {/* Foreground Card */}
            <div 
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{ transform: `translateX(${offset}px)` }}
                className={`relative z-10 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm transition-transform duration-200 flex items-center gap-4 ${isUrgent ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-saffron'}`}
            >
                <img src={request.avatarUrl} className="w-12 h-12 rounded-full shrink-0" alt="" />
                <div className="min-w-0 flex-1">
                    <div className="flex justify-between items-start">
                        <h4 className="font-bold text-coffee truncate pr-2">{request.name}</h4>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isUrgent ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                            {waitMinutes}m
                        </span>
                    </div>
                    <p className="text-xs text-gray-500 truncate mb-1">{request.address}</p>
                    <div className="flex items-center gap-3">
                         <div className="flex items-center gap-1 text-[10px] text-gray-400 font-bold uppercase">
                            <Clock size={12} /> {request.requestedTimeSlot}
                         </div>
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                     <button onClick={onAssign} className="w-8 h-8 rounded-full bg-orange-50 text-saffron flex items-center justify-center">
                        <UserPlus size={16} />
                     </button>
                     <button onClick={onDismiss} className="w-8 h-8 rounded-full bg-gray-50 text-gray-300 flex items-center justify-center">
                        <MoreVertical size={16} />
                     </button>
                </div>
            </div>
        </div>
    );
};

const getWaitBadge = (time: string) => {
    const minutes = Math.floor((Date.now() - new Date(time).getTime()) / 60000);
    if (minutes > 30) return (
        <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-full animate-pulse">
            <AlertCircle size={12} /> {minutes}m wait
        </span>
    );
    return (
        <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full">
            {minutes}m wait
        </span>
    );
};

const LoadingSkeleton = () => (
    <div className="p-4 space-y-4">
        {[1,2,3,4,5].map(i => (
            <div key={i} className="h-16 bg-gray-50 rounded-2xl animate-pulse"></div>
        ))}
    </div>
);

const EmptyState = () => (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-24 h-24 bg-orange-50 rounded-full flex items-center justify-center mb-6 text-saffron relative">
            <CheckCircle size={40} className="animate-float" />
            <div className="absolute inset-0 border-4 border-dashed border-gold/20 rounded-full"></div>
        </div>
        <h3 className="text-2xl font-header font-bold text-coffee mb-2">All Caught Up!</h3>
        <p className="text-gray-500 max-w-xs mx-auto text-sm">Every student has been assigned a ride for this week's sabha. Great job coordination!</p>
    </div>
);