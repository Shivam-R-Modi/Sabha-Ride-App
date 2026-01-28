import React, { useState, useEffect } from 'react';
import { RideGroup, Driver } from '../../types';
import { MOCK_OPTIMIZED_GROUPS } from '../../constants';
import { Loader2, CheckCircle2, AlertCircle, X, Shuffle, User as UserIcon, MoveRight } from 'lucide-react';

interface OptimizationModalProps {
  onClose: () => void;
  onConfirm: (groups: RideGroup[]) => void;
}

export const OptimizationModal: React.FC<OptimizationModalProps> = ({ onClose, onConfirm }) => {
  const [step, setStep] = useState<'processing' | 'results' | 'success'>('processing');
  const [groups, setGroups] = useState<RideGroup[]>([]);
  const [loadingText, setLoadingText] = useState("Clustering student locations...");

  useEffect(() => {
    // Simulate complex algorithm
    if (step === 'processing') {
        const timer1 = setTimeout(() => setLoadingText("Calculating optimal routes..."), 1500);
        const timer2 = setTimeout(() => setLoadingText("Assigning drivers based on capacity..."), 3000);
        const timer3 = setTimeout(() => {
            setGroups(MOCK_OPTIMIZED_GROUPS);
            setStep('results');
        }, 4500);
        return () => { clearTimeout(timer1); clearTimeout(timer2); clearTimeout(timer3); };
    }
  }, [step]);

  const handleManualMove = (groupId: string) => {
    // Simulate manual adjustment functionality (mock)
    alert("In a real app, you would drag and drop students here.");
  };

  const handleConfirm = () => {
      setStep('success');
      setTimeout(() => {
          onConfirm(groups);
      }, 1500);
  };

  if (step === 'processing') {
      return (
          <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl animate-in zoom-in-95">
                  <div className="relative w-20 h-20 mx-auto mb-6">
                      <div className="absolute inset-0 border-4 border-orange-100 rounded-full"></div>
                      <div className="absolute inset-0 border-4 border-saffron border-t-transparent rounded-full animate-spin"></div>
                      <Shuffle className="absolute inset-0 m-auto text-saffron" size={24} />
                  </div>
                  <h3 className="text-xl font-header font-bold text-coffee mb-2">Optimizing Routes</h3>
                  <p className="text-gray-500 animate-pulse">{loadingText}</p>
              </div>
          </div>
      );
  }

  if (step === 'success') {
     return (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
             <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
                 <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600 animate-in zoom-in">
                     <CheckCircle2 size={40} />
                 </div>
                 <h3 className="text-xl font-header font-bold text-coffee mb-2">Assignments Sent!</h3>
                 <p className="text-gray-500">6 drivers assigned, 35 students notified.</p>
             </div>
        </div>
     );
  }

  return (
    <div className="fixed inset-0 z-[60] bg-cream/90 backdrop-blur-md flex items-center justify-center p-4 sm:p-8">
      <div className="bg-white w-full max-w-4xl h-full max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-orange-100">
         
         {/* Header */}
         <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-orange-50/50">
             <div>
                 <h2 className="text-2xl font-header font-bold text-coffee">Proposed Assignments</h2>
                 <p className="text-sm text-gray-500">Review generated groups before confirming.</p>
             </div>
             <div className="flex gap-3">
                 <button onClick={onClose} className="px-4 py-2 rounded-xl text-gray-500 hover:bg-gray-100 font-medium transition-colors">Cancel</button>
                 <button 
                    onClick={handleConfirm}
                    className="px-6 py-2 rounded-xl bg-saffron text-white font-bold shadow-lg shadow-orange-200 hover:bg-saffron-dark transition-colors flex items-center gap-2"
                >
                     <CheckCircle2 size={18} /> Confirm & Send
                 </button>
             </div>
         </div>

         {/* Content */}
         <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 {groups.map(group => (
                     <div key={group.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                         {/* Card Header */}
                         <div className="p-4 border-b border-gray-100 flex justify-between items-center" style={{ borderLeft: `4px solid ${group.routeColor}` }}>
                             <div>
                                 <h4 className="font-bold text-coffee">{group.driverName}</h4>
                                 <div className="flex items-center gap-2 text-xs text-gray-500">
                                     <span>{group.estimatedDistance}</span>
                                     <span>•</span>
                                     <span>{group.estimatedDuration}</span>
                                 </div>
                             </div>
                             <div className="bg-gray-100 px-2 py-1 rounded text-xs font-bold text-gray-600">
                                 {group.studentIds.length}/{group.driverCapacity}
                             </div>
                         </div>
                         
                         {/* Student List */}
                         <div className="p-2">
                             {group.studentIds.map((sid, idx) => (
                                 <div key={sid} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg group/item">
                                     <div className="flex items-center gap-2">
                                         <div className="bg-orange-50 p-1 rounded-full text-saffron">
                                             <UserIcon size={12} />
                                         </div>
                                         <span className="text-sm text-gray-700">Student {sid.split('_')[1]}</span>
                                     </div>
                                     <button onClick={() => handleManualMove(group.id)} className="opacity-0 group-hover/item:opacity-100 text-gray-400 hover:text-blue-500 transition-opacity">
                                         <MoveRight size={14} />
                                     </button>
                                 </div>
                             ))}
                             {group.studentIds.length < group.driverCapacity && (
                                 <div className="p-2 text-center border-t border-dashed border-gray-200 mt-2">
                                     <span className="text-xs text-gray-400 italic">Space for {group.driverCapacity - group.studentIds.length} more</span>
                                 </div>
                             )}
                         </div>
                     </div>
                 ))}
                 
                 {/* Unassigned Pool Warning */}
                 <div className="bg-red-50 rounded-2xl border border-red-100 p-4 flex flex-col items-center justify-center text-center">
                     <AlertCircle className="text-red-400 mb-2" size={32} />
                     <h4 className="font-bold text-red-800">12 Students Unassigned</h4>
                     <p className="text-xs text-red-600 mb-4">Not enough driver capacity for this region.</p>
                     <button className="text-xs font-bold bg-white text-red-600 px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50">View Unassigned</button>
                 </div>
             </div>
         </div>

      </div>
    </div>
  );
};