
import React, { useState, useRef } from 'react';
import { UserRole, User, Driver } from '../../types';
import { Camera, MapPin, User as UserIcon, Save, Loader2, Phone, ChevronLeft, X } from 'lucide-react';
import { doc, setDoc, updateDoc, deleteField } from '@firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from '@firebase/storage';
import { db, storage } from '../../firebase/config';
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
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentUser) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert('Image size should be less than 5MB');
            return;
        }

        setUploadingPhoto(true);
        try {
            // Create a reference to the storage location
            const storageRef = ref(storage, `profile-photos/${currentUser.uid}/${Date.now()}_${file.name}`);

            // Upload the file
            await uploadBytes(storageRef, file);

            // Get the download URL
            const downloadURL = await getDownloadURL(storageRef);

            setAvatarUrl(downloadURL);
        } catch (error) {
            console.error("Error uploading photo:", error);
            alert('Failed to upload photo. Please try again.');
        } finally {
            setUploadingPhoto(false);
        }
    };

    const handleRemovePhoto = () => {
        setAvatarUrl(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
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
            avatarUrl: avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`
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
        <div className="min-h-screen flex flex-col">
            <div className="p-6 border-b border-gray-100/50 bg-cream/50 flex items-center gap-3">
                <button
                    onClick={handleBack}
                    className="p-2 -ml-2 text-gray-500 hover:text-coffee transition-all rounded-full hover:bg-white hover:shadow-sm active:scale-95"
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

                {/* Avatar Upload */}
                <div className="flex justify-center mb-6">
                    <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileSelect}
                    />
                    <div
                        onClick={() => fileInputRef.current?.click()}
                        className={`w-28 h-28 rounded-full flex flex-col items-center justify-center cursor-pointer transition-all clay-card active:scale-95 relative overflow-hidden ${avatarUrl ? 'bg-white' : 'bg-gray-50 text-gray-400 hover:text-saffron'}`}
                    >
                        {avatarUrl ? (
                            <>
                                <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleRemovePhoto(); }}
                                    className="absolute top-0 right-0 bg-red-500 text-white p-1 rounded-full shadow-md hover:bg-red-600"
                                >
                                    <X size={14} />
                                </button>
                            </>
                        ) : uploadingPhoto ? (
                            <Loader2 className="animate-spin text-saffron" size={28} />
                        ) : (
                            <>
                                <Camera size={28} className="mb-1" />
                                <span className="text-[10px] font-bold">ADD PHOTO</span>
                            </>
                        )}
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
                                className="clay-input w-full pl-10"
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
                                className="clay-input w-full pl-10"
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
                                className="clay-input w-full pl-10"
                                placeholder="123 Street, City, State"
                            />
                        </div>
                    </div>

                    {role === 'driver' && (
                        <div className="bg-blue-50/50 p-4 rounded-3xl border border-blue-100/50 backdrop-blur-sm">
                            <p className="text-sm text-blue-800">
                                <strong>Note for Drivers:</strong> You will select your vehicle from the Sabha fleet when you log in to your dashboard.
                            </p>
                        </div>
                    )}
                </div>

                <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full clay-button-primary clay-button-primary-lg mt-8 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                    {isLoading ? <Loader2 className="animate-spin" /> : <><Save size={18} /> Save & Continue</>}
                </button>
            </form>
        </div>
    );
};
