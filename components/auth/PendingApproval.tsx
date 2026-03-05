import React from 'react';

interface PendingApprovalProps {
    role: string;
    onBack: () => void;
}

export const PendingApproval: React.FC<PendingApprovalProps> = ({ role, onBack }) => {
    return (
        <div className="min-h-screen bg-gradient-to-br from-saffron/10 via-white to-gold/10 flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-saffron to-gold text-white py-8 text-center">
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
                        <p className="text-mocha/70">
                            Your {role} account is currently pending approval from a Sabha coordinator.
                        </p>
                        <p className="text-mocha/70">
                            Please check back later or contact the Sabha coordinator for updates.
                        </p>
                    </div>

                    {/* Info Box */}
                    <div className="bg-orange-50 border-2 border-saffron/20 rounded-xl p-4">
                        <p className="text-sm text-coffee/80">
                            <span className="font-semibold">Note:</span> This usually takes 1-2 business days.
                            If you have any questions, please contact the Sabha office.
                        </p>
                    </div>

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
