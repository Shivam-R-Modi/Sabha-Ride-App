import React, { useState, useEffect } from 'react';
import { StudentRequest, Driver } from '../../types';
import { 
  MapPin, 
  Maximize2, 
  Minimize2, 
  Plus, 
  Minus, 
  Navigation, 
  Car, 
  Info,
  X,
  Navigation2
} from 'lucide-react';

interface ResponsiveMapProps {
  students: StudentRequest[];
  drivers: Driver[];
  selectedStudentId?: string | null;
  onMarkerClick: (id: string, type: 'student' | 'driver') => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const ResponsiveMap: React.FC<ResponsiveMapProps> = ({ 
  students, 
  drivers, 
  selectedStudentId,
  onMarkerClick,
  isFullscreen = false,
  onToggleFullscreen
}) => {
  const [zoom, setZoom] = useState(1);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Auto-pan logic simulation: center on selected student if it exists
  const selectedStudent = students.find(s => s.id === selectedStudentId);

  return (
    <div className={`
      relative bg-[#f8f5f0] border border-orange-100 shadow-inner overflow-hidden transition-all duration-500
      ${isFullscreen ? 'fixed inset-0 z-[70] h-full w-full' : 'rounded-2xl w-full h-[300px] sm:h-[400px] lg:h-full'}
    `}>
      {/* Simulated Map Background Grid */}
      <div 
        className="absolute inset-0 transition-transform duration-500 ease-out origin-center"
        style={{ 
          transform: `scale(${zoom})`,
          backgroundImage: 'radial-gradient(#3D2914 1px, transparent 1px)', 
          backgroundSize: '40px 40px',
          opacity: 0.05
        }}
      />

      {/* The Map Content Layer */}
      <div 
        className="absolute inset-0 transition-transform duration-500 ease-out origin-center"
        style={{ transform: `scale(${zoom})` }}
      >
        {/* Mandir - Fixed Central Point */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <div className="relative">
            <div className="absolute inset-0 animate-ping bg-gold/30 rounded-full" />
            <div className="w-6 h-6 bg-coffee rounded-full flex items-center justify-center text-white shadow-xl border-2 border-white relative z-10">
              <Navigation size={12} fill="currentColor" />
            </div>
          </div>
          <span className="mt-2 px-2 py-0.5 bg-white/90 backdrop-blur-sm rounded-full text-[10px] font-bold text-coffee shadow-sm border border-orange-50">
            BAPS Mandir
          </span>
        </div>

        {/* Student Markers */}
        {students.map(student => {
          const isSelected = student.id === selectedStudentId;
          const isHovered = student.id === hoveredId;
          const isUrgent = (Date.now() - new Date(student.requestTime).getTime()) > 30 * 60 * 1000;

          return (
            <div 
              key={student.id}
              onClick={() => onMarkerClick(student.id, 'student')}
              onMouseEnter={() => setHoveredId(student.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`absolute cursor-pointer transition-all duration-300 z-20 flex flex-col items-center
                ${isSelected ? 'scale-125 z-30' : 'hover:scale-110'}
              `}
              style={{ left: `${student.coordinates.x}%`, top: `${student.coordinates.y}%` }}
            >
              <div className={`
                relative flex items-center justify-center transition-all
                lg:w-6 lg:h-6 w-8 h-8 rounded-full shadow-lg border-2 border-white
                ${isUrgent ? 'bg-red-500' : 'bg-saffron'}
                ${isSelected ? 'ring-4 ring-gold' : ''}
              `}>
                <MapPin className="text-white lg:w-3 lg:h-3 w-4 h-4" />
                
                {/* Desktop Hover Info Window */}
                {(isHovered || isSelected) && (
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden lg:block animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <div className="bg-white p-2 rounded-xl shadow-2xl border border-orange-50 min-w-[120px]">
                      <p className="text-[10px] font-bold text-coffee truncate">{student.name}</p>
                      <p className="text-[8px] text-gray-400 truncate">{student.address}</p>
                    </div>
                    <div className="w-2 h-2 bg-white rotate-45 mx-auto -mt-1 border-r border-b border-orange-50" />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Driver Markers */}
        {drivers.map((driver, idx) => {
          const mockX = 30 + (idx * 12);
          const mockY = 20 + (idx % 2 * 15);
          return (
            <div 
              key={driver.id}
              className="absolute transition-all duration-300 cursor-pointer z-10"
              style={{ left: `${mockX}%`, top: `${mockY}%` }}
              onClick={() => onMarkerClick(driver.id, 'driver')}
            >
              <div className="bg-white/90 backdrop-blur-md p-1 rounded-full shadow-md border border-blue-100 flex items-center gap-1.5 px-2">
                <Car size={14} className="text-blue-600" />
                <span className="text-[10px] font-bold text-blue-900">{driver.name.split(' ')[0]}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Map Controls - Responsive Layout */}
      <div className={`
        absolute flex flex-col gap-2 transition-all duration-300
        lg:top-6 lg:right-6 lg:bottom-auto bottom-6 right-6
      `}>
        <div className="flex flex-col bg-white/90 backdrop-blur-md rounded-2xl shadow-xl border border-orange-50 overflow-hidden">
          <button onClick={() => setZoom(prev => Math.min(prev + 0.2, 2))} className="p-3 hover:bg-orange-50 text-coffee transition-colors border-b border-orange-50">
            <Plus size={20} />
          </button>
          <button onClick={() => setZoom(prev => Math.max(prev - 0.2, 0.5))} className="p-3 hover:bg-orange-50 text-coffee transition-colors">
            <Minus size={20} />
          </button>
        </div>

        <button 
          onClick={onToggleFullscreen}
          className="p-3 bg-white/90 backdrop-blur-md rounded-2xl shadow-xl border border-orange-50 text-coffee hover:bg-orange-50 transition-colors"
        >
          {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
        </button>
      </div>

      {/* Info Legend Overlay (Mobile: Hidden, Desktop: Bottom-Right) */}
      <div className="absolute bottom-6 left-6 hidden sm:flex flex-col gap-2 bg-white/80 backdrop-blur-sm p-4 rounded-2xl border border-orange-50 shadow-sm animate-in fade-in slide-in-from-left-4">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-saffron" />
          <span className="text-[10px] font-bold text-coffee uppercase tracking-widest">Active Request</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] font-bold text-coffee uppercase tracking-widest">Urgent (>30m)</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-6 h-3 rounded-full bg-blue-100 flex items-center justify-center">
            <Car size={8} className="text-blue-600" />
          </div>
          <span className="text-[10px] font-bold text-coffee uppercase tracking-widest">Volunteer Driver</span>
        </div>
      </div>

      {/* Fullscreen Close Button */}
      {isFullscreen && (
        <button 
          onClick={onToggleFullscreen}
          className="lg:hidden absolute top-6 left-6 w-12 h-12 bg-coffee text-white rounded-full flex items-center justify-center shadow-2xl z-[80]"
        >
          <X size={24} />
        </button>
      )}
    </div>
  );
};