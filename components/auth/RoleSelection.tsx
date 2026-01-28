
import React, { useState } from 'react';
import { UserRole } from '../../types';
import { GraduationCap, Car, LayoutDashboard, ChevronRight, Loader2, ChevronLeft } from 'lucide-react';
import { doc, setDoc } from '@firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';

interface RoleSelectionProps {
  onSelectRole: (role: UserRole) => void;
}

export const RoleSelection: React.FC<RoleSelectionProps> = ({ onSelectRole }) => {
  const { currentUser, refreshProfile, logout } = useAuth();
  const [loadingRole, setLoadingRole] = useState<UserRole | null>(null);

  const handleRoleClick = async (role: UserRole) => {
    if (!currentUser) return;
    setLoadingRole(role);
    
    try {
        // Save initial role and email to Firestore
        await setDoc(doc(db, 'users', currentUser.uid), {
            id: currentUser.uid,
            email: currentUser.email || '',
            phone: currentUser.phoneNumber || '', // Optional now
            role: role,
            createdAt: new Date().toISOString()
        }, { merge: true });

        // Refresh context to trigger App redirect/next step
        await refreshProfile();
        
        // Callback for parent
        onSelectRole(role);
    } catch (error) {
        console.error("Error saving role:", error);
        setLoadingRole(null);
    }
  };

  const roles = [
    {
        id: 'student',
        title: 'Student',
        desc: 'I need a ride to sabha',
        icon: GraduationCap,
        color: 'text-blue-600',
        bg: 'bg-blue-50',
        border: 'border-blue-100'
    },
    {
        id: 'driver',
        title: 'Volunteer Driver',
        desc: 'I can offer rides',
        icon: Car,
        color: 'text-orange-600',
        bg: 'bg-orange-50',
        border: 'border-orange-100'
    },
    {
        id: 'manager',
        title: 'Coordinator',
        desc: 'I manage the logistics',
        icon: LayoutDashboard,
        color: 'text-purple-600',
        bg: 'bg-purple-50',
        border: 'border-purple-100'
    }
  ];

  return (
    <div className="min-h-screen bg-cream px-6 py-12 flex flex-col justify-center relative">
      <button 
        onClick={logout}
        className="absolute top-6 left-6 p-2 text-gray-400 hover:text-coffee transition-colors flex items-center gap-1"
      >
          <ChevronLeft size={20} />
          <span className="text-sm font-medium">Back</span>
      </button>

      <div className="text-center mb-10">
         <h2 className="font-header font-bold text-3xl text-coffee mb-2">Who are you?</h2>
         <p className="text-gray-500">Select your role to continue setup</p>
      </div>

      <div className="space-y-4 max-w-sm mx-auto w-full">
        {roles.map((role) => {
            const Icon = role.icon;
            const isLoading = loadingRole === role.id;
            
            return (
                <button 
                    key={role.id}
                    onClick={() => handleRoleClick(role.id as UserRole)}
                    disabled={loadingRole !== null}
                    className={`w-full bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between group hover:shadow-md hover:border-saffron/30 transition-all active:scale-[0.98] ${loadingRole && !isLoading ? 'opacity-50' : ''}`}
                >
                    <div className="flex items-center gap-4">
                        <div className={`w-14 h-14 rounded-full flex items-center justify-center ${role.bg} ${role.color} ${role.border} border-2`}>
                            {isLoading ? <Loader2 className="animate-spin" /> : <Icon size={28} />}
                        </div>
                        <div className="text-left">
                            <h3 className="font-header font-bold text-lg text-coffee group-hover:text-saffron transition-colors">{role.title}</h3>
                            <p className="text-sm text-gray-500">{role.desc}</p>
                        </div>
                    </div>
                    <ChevronRight className="text-gray-300 group-hover:text-saffron group-hover:translate-x-1 transition-all" />
                </button>
            )
        })}
      </div>
    </div>
  );
};
