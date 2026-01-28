
import React, { useState } from 'react';
import { UserRole, User, Driver } from '../../types';
import { Camera, MapPin, User as UserIcon, Save, Loader2, Phone, ChevronLeft } from 'lucide-react';
import { doc, setDoc, updateDoc, deleteField } from '@firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';

interface ProfileSetupProps {
  role: UserRole;
  email: string;
  onComplete: (profile: User | Driver) => void;
}

export const ProfileSetup: React.FC<ProfileSetupProps> = ({ role, email, onComplete }) => {
  const { currentUser, refreshProfile } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');

  const handleBack = async () => {
    if (!currentUser) return;
    // We don't necessarily need to set isLoading here for the UI, 
    // but it prevents double clicking.
    setIsLoading(true);
    try {
        // Remove the role field to go back to Role Selection
        await updateDoc(doc(db, 'users', currentUser.uid), {
            role: deleteField()
        });
        await refreshProfile();
    } catch (error) {
        console.error("Error going back:", error);
        setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    setIsLoading(true);
    
    // Default account status logic
    // Students are auto-approved. Drivers and Managers are pending.
    let initialAccountStatus: 'pending' | 'approved' = 'approved';
    if (role === 'driver' || role === 'manager') {
        initialAccountStatus = 'pending';
    }

    const baseProfile = {
        id: currentUser.uid,
        name,
        address,
        email,
        phone,
        role,
        accountStatus: initialAccountStatus,
        avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`
    };

    try {
        if (role === 'driver') {
            const driverProfile: Driver = {
                ...baseProfile,
                status: 'available',
                // Car details will be set when selecting a vehicle from the fleet
                carModel: '',
                carColor: '',
                plateNumber: '',
                capacity: 0
            };
            await setDoc(doc(db, 'users', currentUser.uid), driverProfile, { merge: true });
            await refreshProfile();
            onComplete(driverProfile);
        } else {
            await setDoc(doc(db, 'users', currentUser.uid), baseProfile, { merge: true });
            await refreshProfile();
            onComplete(baseProfile as User);
        }
    } catch (error) {
        console.error("Error saving profile:", error);
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
       <div className="p-6 border-b border-gray-100 bg-cream/50 flex items-center gap-3">
          <button 
            onClick={handleBack} 
            className="p-1 -ml-2 text-gray-400 hover:text-coffee transition-colors rounded-full hover:bg-black/5"
            type="button"
          >
              <ChevronLeft size={28} />
          </button>
          <div>
              <h2 className="font-header font-bold text-2xl text-coffee">Complete Profile</h2>
              <p className="text-sm text-gray-500">Just a few more details</p>
          </div>
       </div>

       <form onSubmit={handleSubmit} className="p-6 space-y-6 flex-1 overflow-y-auto pb-24">
          
          {/* Avatar Upload Placeholder */}
          <div className="flex justify-center mb-6">
              <div className="w-24 h-24 bg-gray-100 rounded-full flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-300 cursor-pointer hover:bg-gray-50 hover:border-saffron hover:text-saffron transition-all">
                  <Camera size={24} className="mb-1" />
                  <span className="text-[10px] font-bold">ADD PHOTO</span>
              </div>
          </div>

          <div className="space-y-4">
              <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Full Name</label>
                  <div className="relative">
                      <UserIcon size={18} className="absolute left-3 top-3.5 text-gray-400" />
                      <input 
                        required
                        value={name}
                        onChange={e => setName(e.target.value)}
                        className="w-full pl-10 p-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-saffron" 
                        placeholder="First Last"
                      />
                  </div>
              </div>

              <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Phone Number</label>
                  <div className="relative">
                      <Phone size={18} className="absolute left-3 top-3.5 text-gray-400" />
                      <input 
                        required
                        type="tel"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        className="w-full pl-10 p-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-saffron" 
                        placeholder="(555) 000-0000"
                      />
                  </div>
              </div>

              <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">
                    {role === 'driver' ? 'Home Base Address' : 'Pickup Address'}
                  </label>
                  <div className="relative">
                      <MapPin size={18} className="absolute left-3 top-3.5 text-gray-400" />
                      <input 
                        required
                        value={address}
                        onChange={e => setAddress(e.target.value)}
                        className="w-full pl-10 p-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-saffron" 
                        placeholder="123 Street, City, State"
                      />
                  </div>
              </div>
              
              {role === 'driver' && (
                  <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                      <p className="text-sm text-blue-800">
                          <strong>Note for Drivers:</strong> You will select your vehicle from the Sabha fleet when you log in to your dashboard.
                      </p>
                  </div>
              )}
          </div>

          <button 
            type="submit"
            disabled={isLoading}
            className="w-full bg-coffee text-white font-bold py-4 rounded-xl shadow-lg mt-8 flex items-center justify-center gap-2 disabled:opacity-70"
           >
             {isLoading ? <Loader2 className="animate-spin" /> : <><Save size={18} /> Save & Continue</>}
           </button>
       </form>
    </div>
  );
};
