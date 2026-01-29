import React from 'react';
import { Ride } from '../../types';
import { CheckCircle2, Calendar } from 'lucide-react';

export const DriverHistory: React.FC = () => {
   return (
      <div className="pb-24 pt-6 px-4 space-y-4">
         <h2 className="text-xl font-header font-bold text-coffee">Drive History</h2>

         <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="clay-card p-4 border-l-4 border-l-saffron">
               <p className="text-xs text-gray-500 uppercase font-bold">Total Rides</p>
               <p className="text-2xl font-bold text-saffron">0</p>
            </div>
            <div className="clay-card p-4 border-l-4 border-l-blue-400">
               <p className="text-xs text-gray-500 uppercase font-bold">Students Moved</p>
               <p className="text-2xl font-bold text-blue-600">0</p>
            </div>
         </div>

         <div className="space-y-3">
            {[].map((ride: Ride, idx: number) => (
               <div key={idx} className="clay-card p-4 flex justify-between items-center transition-transform hover:scale-[1.01]">
                  <div className="flex items-center gap-3">
                     <div className="bg-gray-100 p-2 rounded-lg text-gray-500">
                        <Calendar size={20} />
                     </div>
                     <div>
                        <p className="font-bold text-coffee">{new Date(ride.date).toLocaleDateString()}</p>
                        <p className="text-xs text-gray-500">{ride.peers.length + 1} Passengers</p>
                     </div>
                  </div>
                  <div className="flex items-center gap-1 text-green-600 text-xs font-bold bg-green-50 px-2 py-1 rounded">
                     <CheckCircle2 size={12} />
                     Completed
                  </div>
               </div>
            ))}
         </div>
      </div>
   );
};