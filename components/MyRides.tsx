import React, { useState } from 'react';
import { Ride } from '../types';
import { Calendar, Clock, ChevronRight } from 'lucide-react';

interface MyRidesProps {
  history: Ride[];
  upcoming: Ride[];
}

const RideCard: React.FC<{ ride: Ride; isHistory?: boolean }> = ({ ride, isHistory = false }) => (
  <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex flex-col gap-3">
    <div className="flex justify-between items-start">
      <div className="flex gap-3">
        <div className="bg-orange-50 w-12 h-12 rounded-lg flex flex-col items-center justify-center text-saffron shrink-0">
          <span className="text-xs font-bold uppercase">{new Date(ride.date).toLocaleDateString('en-US', { month: 'short' })}</span>
          <span className="text-lg font-bold leading-none">{new Date(ride.date).getDate()}</span>
        </div>
        <div>
          <h4 className="font-medium text-coffee">Weekly Sabha</h4>
          <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
            <Clock size={12} />
            <span>{ride.timeSlot}</span>
          </div>
        </div>
      </div>
      <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
          ride.status === 'completed' ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700'
      }`}>
          {ride.status.replace('_', ' ')}
      </div>
    </div>

    <div className="w-full h-px bg-gray-100"></div>

    <div className="flex justify-between items-center">
      <div className="flex items-center gap-2">
          {ride.driver && (
              <>
              <img src={ride.driver.avatarUrl} className="w-6 h-6 rounded-full" alt="Driver" />
              <span className="text-xs text-gray-600">{ride.driver.name}</span>
              </>
          )}
      </div>
      <button className="text-saffron text-xs font-medium flex items-center">
          Details <ChevronRight size={14} />
      </button>
    </div>
  </div>
);

export const MyRides: React.FC<MyRidesProps> = ({ history, upcoming }) => {
  const [activeTab, setActiveTab] = useState<'upcoming' | 'history'>('upcoming');

  return (
    <div className="space-y-4 pb-24">
      <h2 className="text-xl font-header font-bold text-coffee px-4 pt-4">My Rides</h2>
      
      {/* Tabs */}
      <div className="px-4">
        <div className="bg-gray-100 p-1 rounded-xl flex">
            <button 
                onClick={() => setActiveTab('upcoming')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                    activeTab === 'upcoming' ? 'bg-white text-coffee shadow-sm' : 'text-gray-500'
                }`}
            >
                Upcoming
            </button>
            <button 
                onClick={() => setActiveTab('history')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                    activeTab === 'history' ? 'bg-white text-coffee shadow-sm' : 'text-gray-500'
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
                <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-200">
                    <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3 text-gray-300">
                        <Calendar size={24} />
                    </div>
                    <p className="text-gray-500 font-medium">No upcoming rides</p>
                    <p className="text-xs text-gray-400 mt-1">Request a pickup from the home screen</p>
                </div>
            )
        ) : (
            history.map(ride => <RideCard key={ride.id} ride={ride} isHistory />)
        )}
      </div>
    </div>
  );
};