import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { verifyManagerCode } from '../../src/utils/cloudFunctions';

interface PendingApprovalProps {
    role: string;
    onBack: () => void;
}

export const PendingApproval: React.FC<PendingApprovalProps> = ({ role, onBack }) => {
    const { currentUser } = useAuth();
    const [managerCode, setManagerCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const handleUnlockManager = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentUser) return;

        const rawInput = managerCode.trim();
        if (!rawInput) {
            setError('Please enter the access code');
            return;
        }

        setLoading(true);
        setError('');
        setSuccessMessage('');

        try {
            // Same server-side check as RoleSelection. This screen carried its
            // own copy of the hardcoded ['sabha2026','sabha2024'] pair and its
            // own self-approving updateDoc — which firestore.rules now denies
            // anyway, since a user may not write accountStatus on themselves.
            // The callable does the comparison and the approval.
            const { valid } = await verifyManagerCode(rawInput);

            if (!valid) {
                setError('Invalid manager access code');
                setLoading(false);
                return;
            }

            setSuccessMessage('Account approved! Redirecting...');
        } catch (err: unknown) {
            console.error('Error approving manager:', err);
            const message = err instanceof Error ? err.message : '';
            setError(message || 'Failed to approve account. Please try again.');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-saffron/10 via-white to-gold/10 flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-saffron-800 to-gold-700 text-white py-8 text-center">
                <h1 className="text-3xl md:text-4xl font-header font-bold">Account Pending</h1>
            </div>

            {/* Pending Message */}
            <div className="flex-1 flex items-center justify-center p-6">
                <div className="clay-card max-w-md w-full p-8 text-center space-y-6 animate-in fade-in zoom-in duration-500">
                    {/* Icon */}
                    <div className="inline-flex p-6 rounded-full bg-gold/20">
                        <svg className="w-16 h-16 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>

                    {/* Message */}
                    <div className="space-y-3">
                        <h2 className="text-2xl font-header font-bold text-coffee">
                            Approval Pending
                        </h2>
                        <p className="text-coffee-700">
                            Your {role} account is currently pending approval from a Sabha coordinator.
                        </p>
                        <p className="text-coffee-700">
                            Please check back later or contact the Sabha coordinator for updates.
                        </p>
                    </div>

                    {/* Manager Access Code Form for Managers */}
                    {role === 'manager' && (
                        <form onSubmit={handleUnlockManager} className="bg-orange-50 border-2 border-saffron/30 rounded-xl p-4 text-left space-y-3">
                            <label className="block text-sm font-bold text-coffee">
                                Have a Manager Access Code?
                            </label>
                            <p className="text-xs text-coffee-700">
                                Enter your code below to instantly approve your account.
                            </p>
                            <input
                                type="password"
                                value={managerCode}
                                onChange={(e) => setManagerCode(e.target.value)}
                                placeholder="Enter access code..."
                                className="w-full px-3 py-2 rounded-lg border border-mocha/20 text-sm focus:outline-none focus:border-saffron bg-white"
                                disabled={loading}
                            />
                            {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
                            {successMessage && <p className="text-xs text-green-700 font-semibold">{successMessage}</p>}
                            <button
                                type="submit"
                                disabled={loading || !managerCode.trim()}
                                className="w-full bg-saffron text-white py-2 rounded-lg text-sm font-bold hover:bg-saffron/90 transition-all disabled:opacity-50"
                            >
                                {loading ? 'Verifying...' : 'Unlock Manager Account'}
                            </button>
                        </form>
                    )}

                    {/* Info Box */}
                    {role !== 'manager' && (
                        <div className="bg-orange-50 border-2 border-saffron/20 rounded-xl p-4">
                            <p className="text-sm text-coffee/80">
                                <span className="font-semibold">Note:</span> This usually takes 1-2 business days.
                                If you have any questions, please contact the Sabha office.
                            </p>
                        </div>
                    )}

                    {/* Back Button */}
                    <button
                        onClick={onBack}
                        className="w-full border-2 border-mocha/30 text-coffee py-3 rounded-xl font-semibold hover:bg-mocha/5 transition-all"
                    >
                        Sign Out
                    </button>
                </div>
            </div>
        </div>
    );
};
