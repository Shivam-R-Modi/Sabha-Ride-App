import React from 'react';
import { StudentRequest, Driver } from '../../types';
import { MapPin, Car } from 'lucide-react';

interface MapVisualizationProps {
  students: StudentRequest[];
  drivers: Driver[];
}

export const MapVisualization: React.FC<MapVisualizationProps> = ({ students, drivers }) => {
  return (
    <div className="w-full h-full bg-gray-100 rounded-2xl relative overflow-hidden border border-gray-200 shadow-inner group">
      {/* Background Grid */}
      <div className="absolute inset-0 opacity-10" 
           style={{ 
             backgroundImage: 'radial-gradient(#3D2914 1px, transparent 1px)', 
             backgroundSize: '20px 20px' 
           }}>
      </div>
      
      {/* Venue */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-10">
         <div className="w-4 h-4 bg-coffee rounded-full ring-4 ring-coffee/20 animate-pulse"></div>
         <span className="text-[10px] font-bold text-coffee mt-1 bg-white/80 px-1 rounded">Mandir</span>
      </div>

      {/* Student Pins */}
      {students.map((student) => {
         const isUrgent = (Date.now() - new Date(student.requestTime).getTime()) > 30 * 60 * 1000;
         return (
            <div 
                key={student.id}
                className="absolute transition-all duration-500 hover:scale-150 hover:z-20 cursor-pointer"
                style={{ left: `${student.coordinates.x}%`, top: `${student.coordinates.y}%` }}
                title={student.name}
            >
                <div className={`w-2 h-2 rounded-full shadow-sm ${isUrgent ? 'bg-red-500 ring-2 ring-red-200' : 'bg-saffron ring-1 ring-orange-200'}`}></div>
            </div>
         );
      })}

      {/* Driver Pins */}
      {drivers.map((driver, idx) => {
         // Mock position based on index
         const x = 20 + (idx * 15);
         const y = 80 - (idx % 2 * 10);
         return (
            <div 
                key={driver.id}
                className="absolute transition-all duration-700 hover:z-20 cursor-pointer"
                style={{ left: `${x}%`, top: `${y}%` }}
            >
                <div className="bg-white p-1 rounded-full shadow-md border border-gray-200 flex items-center gap-1">
                    <Car size={12} className={driver.status === 'available' ? 'text-green-600' : 'text-blue-600'} />
                    <span className="text-[8px] font-bold">{driver.capacity}</span>
                </div>
            </div>
         );
      })}

      {/* Legend overlay */}
      <div className="absolute bottom-2 right-2 bg-white/90 backdrop-blur-sm p-2 rounded-lg text-[10px] border border-gray-100 shadow-sm">
         <div className="flex items-center gap-1 mb-1"><div className="w-2 h-2 rounded-full bg-saffron"></div> Request</div>
         <div className="flex items-center gap-1 mb-1"><div className="w-2 h-2 rounded-full bg-red-500"></div> Urgent (>30m)</div>
         <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-600"></div> Available Driver</div>
      </div>
    </div>
  );
};