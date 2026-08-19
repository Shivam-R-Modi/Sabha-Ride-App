import React, { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';
import { redeemManagerInvite } from '../../src/utils/cloudFunctions';
import { FOUNDING_CITY_ID, FOUNDING_LOCATION_ID } from '../../src/constants/tenancy';
import { UserRole } from '../../types';
import { Eye, EyeOff } from 'lucide-react';

interface RoleSelectionProps {
    onSelectRole: () => void;
}

export const RoleSelection: React.FC<RoleSelectionProps> = ({ onSelectRole }) => {
    const { currentUser, refreshClaims } = useAuth();
    const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
    const [managerCode, setManagerCode] = useState('');
    const [showManagerCode, setShowManagerCode] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const roles = [
        {
            id: 'student' as UserRole,
            title: 'Bhulku',
            description: 'Request rides to and from Sabha',
            icon: (
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
            ),
        },
        {
            id: 'driver' as UserRole,
            title: 'Sarthi',
            description: 'Volunteer to drive students',
            icon: (
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
            ),
        },
        {
            id: 'manager' as UserRole,
            title: 'Manager',
            description: 'Coordinate and manage rides',
            icon: (
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
            ),
        },
    ];

    const handleSubmit = async () => {
        if (!selectedRole) {
            setError('Please select a role');
            return;
        }

        if (!currentUser) {
            setError('User not authenticated');
            return;
        }

        setLoading(true);
        setError('');

        try {
            let initialStatus: 'approved' | 'pending' = 'pending';

            if (selectedRole === 'student') {
                // Students are auto-approved
                initialStatus = 'approved';
            } else if (selectedRole === 'manager') {
                const rawInput = managerCode.trim();
                if (!rawInput) {
                    setError('Manager access code is required');
                    setLoading(false);
                    return;
                }

                // The code is checked server-side, and the manager profile is
                // written server-side with the Admin SDK.
                //
                // This screen used to compare the input against
                // ['sabha2026','sabha2024'] hardcoded right here — shipped in
                // the bundle to every visitor, readable with View Source, and
                // impossible to rotate without a redeploy. It then wrote
                // accountStatus:'approved' onto its own user document, so even
                // the check was optional: skip it, write the field, be a
                // manager. Neither the code nor the privilege fields belong in
                // the browser.
                const { redeemed, message } = await redeemManagerInvite(rawInput);

                if (!redeemed) {
                    setError(message || 'That invite code was not recognised. Please check with the Sabha coordinator.');
                    setLoading(false);
                    return;
                }

                // redeemManagerInvite has already created the approved manager
                // profile. Writing it again from here would be denied, and
                // would be the very thing this change removes.
                //
                // It also set a `mgr` claim, which only lands on a token when one
                // is minted — so force a refresh rather than leaving the new
                // manager's first hour running on the slower document check.
                await refreshClaims();

                onSelectRole();
                return;
            } else {
                // Drivers (Riders) require manager approval
                initialStatus = 'pending';
            }

            // Save user profile with final determined accountStatus
            await setDoc(doc(db, 'users', currentUser.uid), {
                role: selectedRole,
                registeredRole: selectedRole,
                roles: [selectedRole],
                activeRole: selectedRole,
                email: currentUser.email,
                phone: currentUser.phoneNumber,
                accountStatus: initialStatus,
                // Stamped on BOTH profile writes. A profile is created here and
                // completed in ProfileSetup, with a gap between; stamping only one
                // leaves a window where the document exists unstamped.
                cityId: FOUNDING_CITY_ID,
                locationId: FOUNDING_LOCATION_ID,
                createdAt: new Date().toISOString(),
            }, { merge: true });

            onSelectRole();
        } catch (err: unknown) {
            console.error('Error saving role:', err);
            // redeemManagerInvite throws for rate limiting, and that message is
            // the actionable part. A blanket "Failed to save role" hid it and left
            // the user retyping a correct code. Bad codes do not come through
            // here — they resolve with a reason, handled above.
            const message = err instanceof Error ? err.message : '';
            setError(message || 'Failed to save role. Please try again.');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-saffron/10 via-surface to-gold/10 flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-saffron-800 to-gold-700 text-white py-8 text-center">
                <h1 className="text-3xl md:text-4xl font-header font-bold">Choose Your Role</h1>
                <p className="text-sm md:text-base mt-2 opacity-90">How would you like to serve?</p>
            </div>

            {/* Role Selection */}
            <div className="flex-1 flex items-center justify-center p-6">
                <div className="max-w-4xl w-full space-y-6 animate-in fade-in zoom-in duration-500">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {roles.map((role) => (
                            <button
                                key={role.id}
                                onClick={() => {
                                    setSelectedRole(role.id);
                                    setError('');
                                }}
                                className={`clay-card p-6 text-center space-y-4 transition-all hover:scale-105 ${selectedRole === role.id
                                    ? 'ring-4 ring-saffron shadow-xl'
                                    : 'hover:shadow-lg'
                                    }`}
                                disabled={loading}
                            >
                                <div className={`inline-flex p-4 rounded-2xl ${selectedRole === role.id
                                    ? 'bg-saffron text-white'
                                    : 'bg-cream-300 text-saffron'
                                    }`}>
                                    {role.icon}
                                </div>
                                <div>
                                    <h3 className="text-xl font-header font-bold text-coffee">{role.title}</h3>
                                    <p className="text-sm text-coffee-700 mt-2">{role.description}</p>
                                </div>
                            </button>
                        ))}
                    </div>

                    {/* Manager Secret Code Input */}
                    {selectedRole === 'manager' && (
                        <div className="clay-card p-6 animate-in slide-in-from-top-4">
                            <label className="block text-sm font-bold text-coffee mb-2">
                                Manager Access Code <span className="text-[rgb(var(--danger-text))]">*</span>
                            </label>
                            <p className="text-xs text-coffee-500 mb-3">
                                Enter the access code provided by the Sabha coordinator to register as a manager.
                            </p>
                            <div className="relative">
                                <input
                                    type={showManagerCode ? 'text' : 'password'}
                                    value={managerCode}
                                    onChange={(e) => setManagerCode(e.target.value)}
                                    placeholder="Enter admin code..."
                                    className="w-full px-4 py-3 pr-10 rounded-xl border-2 border-mocha/20 focus:border-saffron focus:outline-none transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowManagerCode(!showManagerCode)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-coffee-500 hover:text-coffee transition-colors"
                                    title={showManagerCode ? 'Hide Code' : 'Show Code'}
                                >
                                    {showManagerCode ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="clay-card bg-[rgb(var(--danger-bg))] border border-[rgb(var(--danger))]/40 p-4">
                            <p className="text-[rgb(var(--danger-text))] text-center">{error}</p>
                        </div>
                    )}

                    <div className="text-center">
                        <button
                            onClick={handleSubmit}
                            disabled={loading || !selectedRole}
                            className="clay-button bg-gradient-to-r from-saffron-800 to-gold-700 text-white px-12 py-4 rounded-xl font-semibold text-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? 'Saving...' : 'Continue'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
