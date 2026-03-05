import React, { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';
import { UserRole } from '../../types';

interface RoleSelectionProps {
    onSelectRole: () => void;
}

export const RoleSelection: React.FC<RoleSelectionProps> = ({ onSelectRole }) => {
    const { currentUser } = useAuth();
    const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
    const [managerCode, setManagerCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const roles = [
        {
            id: 'student' as UserRole,
            title: 'Student',
            description: 'Request rides to and from Sabha',
            icon: (
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
            ),
        },
        {
            id: 'driver' as UserRole,
            title: 'Driver',
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
            // Students are auto-approved; drivers and managers start as pending
            const initialStatus = selectedRole === 'student' ? 'approved' : 'pending';

            await setDoc(doc(db, 'users', currentUser.uid), {
                role: selectedRole,
                registeredRole: selectedRole,
                roles: [selectedRole],
                activeRole: selectedRole,
                email: currentUser.email,
                phone: currentUser.phoneNumber,
                accountStatus: initialStatus,
                createdAt: new Date().toISOString(),
            }, { merge: true });

            // If manager provided an access code, verify it server-side
            if (selectedRole === 'manager' && managerCode.trim()) {
                try {
                    const { verifyManagerCode } = await import('../../src/utils/cloudFunctions');
                    const result = await verifyManagerCode(managerCode.trim());
                    if (!result.valid) {
                        // Code was wrong — account stays pending, that's fine
                        console.log('Manager code invalid, account will remain pending');
                    }
                    // If valid, the Cloud Function already updated accountStatus to 'approved'
                } catch (verifyError) {
                    // Verification failed — account stays pending
                    console.error('Manager code verification error:', verifyError);
                }
            }

            onSelectRole();
        } catch (err: any) {
            console.error('Error saving role:', err);
            setError('Failed to save role. Please try again.');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-saffron/10 via-white to-gold/10 flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-saffron to-gold text-white py-8 text-center">
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
                                    : 'bg-orange-50 text-saffron'
                                    }`}>
                                    {role.icon}
                                </div>
                                <div>
                                    <h3 className="text-xl font-header font-bold text-coffee">{role.title}</h3>
                                    <p className="text-sm text-mocha/70 mt-2">{role.description}</p>
                                </div>
                            </button>
                        ))}
                    </div>

                    {/* Manager Secret Code Input */}
                    {selectedRole === 'manager' && (
                        <div className="clay-card p-6 animate-in slide-in-from-top-4">
                            <label className="block text-sm font-bold text-coffee mb-2">
                                Manager Access Code (Optional)
                            </label>
                            <p className="text-xs text-mocha/60 mb-3">
                                Enter the secret code to get instant approval. Otherwise, your account will be pending.
                            </p>
                            <input
                                type="password"
                                value={managerCode}
                                onChange={(e) => setManagerCode(e.target.value)}
                                placeholder="Enter admin code..."
                                className="w-full px-4 py-3 rounded-xl border-2 border-mocha/20 focus:border-saffron focus:outline-none transition-colors"
                            />
                        </div>
                    )}

                    {error && (
                        <div className="clay-card bg-red-50 border border-red-200 p-4">
                            <p className="text-red-700 text-center">{error}</p>
                        </div>
                    )}

                    <div className="text-center">
                        <button
                            onClick={handleSubmit}
                            disabled={loading || !selectedRole}
                            className="clay-button bg-gradient-to-r from-saffron to-gold text-white px-12 py-4 rounded-xl font-semibold text-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? 'Saving...' : 'Continue'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
