import React, { useState, useEffect } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../firebase/config';
import { Mail, X, CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react';

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

interface ForgotPasswordModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialEmail?: string;
}

export const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({
    isOpen,
    onClose,
    initialEmail = '',
}) => {
    const [email, setEmail] = useState(initialEmail);
    const [isLoading, setIsLoading] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Sync initialEmail when modal opens
    useEffect(() => {
        if (isOpen) {
            setEmail(initialEmail);
            setStatus(null);
        }
    }, [isOpen, initialEmail]);

    // Cooldown timer
    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = setInterval(() => {
            setCooldown((prev) => prev - 1);
        }, 1000);
        return () => clearInterval(timer);
    }, [cooldown]);

    if (!isOpen) return null;

    const handleSendReset = async (e: React.FormEvent) => {
        e.preventDefault();

        const trimmedEmail = email.trim();
        if (!EMAIL_REGEX.test(trimmedEmail)) {
            setStatus({ type: 'error', message: 'Please enter a valid email address.' });
            return;
        }

        if (cooldown > 0 || isLoading) return;

        setIsLoading(true);
        setStatus(null);

        try {
            await sendPasswordResetEmail(auth, trimmedEmail);
            setStatus({
                type: 'success',
                message: `Password reset email sent to ${trimmedEmail}! Please check your Inbox and Spam/Junk folder.`,
            });
            setCooldown(60); // 60s cooldown timer
        } catch (err: any) {
            console.error('Password Reset Error:', err);
            if (err.code === 'auth/user-not-found') {
                setStatus({ type: 'error', message: 'No registered account was found with this email.' });
            } else if (err.code === 'auth/too-many-requests') {
                setStatus({ type: 'error', message: 'Too many requests. Please wait a few minutes before trying again.' });
            } else {
                setStatus({ type: 'error', message: 'Failed to send reset email. Please try again.' });
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="clay-card max-w-md w-full p-6 space-y-5 bg-white relative animate-in zoom-in-95 duration-200">
                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-mocha/50 hover:text-coffee transition-colors p-1 rounded-full hover:bg-mocha/10"
                    title="Close"
                >
                    <X size={20} />
                </button>

                {/* Header */}
                <div className="text-center space-y-2 pt-2">
                    <div className="inline-flex p-3 rounded-2xl bg-orange-50 text-saffron mb-1">
                        <Mail size={32} />
                    </div>
                    <h3 className="text-2xl font-header font-bold text-coffee">Reset Your Password</h3>
                    <p className="text-xs text-mocha/70 max-w-xs mx-auto">
                        Enter your registered email address and we will send you a secure link to reset your password.
                    </p>
                </div>

                {/* Status Message */}
                {status && (
                    <div
                        className={`p-3 rounded-xl text-xs flex items-start gap-2 border ${
                            status.type === 'success'
                                ? 'bg-green-50 text-green-700 border-green-200'
                                : 'bg-red-50 text-red-700 border-red-200'
                        }`}
                    >
                        {status.type === 'success' ? (
                            <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                        ) : (
                            <AlertCircle size={16} className="shrink-0 mt-0.5" />
                        )}
                        <span>{status.message}</span>
                    </div>
                )}

                {/* Reset Form */}
                <form onSubmit={handleSendReset} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-coffee mb-1 uppercase">Email Address</label>
                        <input
                            type="email"
                            placeholder="name@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border-2 border-mocha/20 focus:border-saffron focus:outline-none transition-colors text-coffee font-medium text-sm"
                            disabled={isLoading}
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading || cooldown > 0}
                        className="w-full bg-gradient-to-r from-saffron to-gold text-white py-3 rounded-xl font-bold text-sm hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? (
                            <Loader2 className="animate-spin" size={18} />
                        ) : cooldown > 0 ? (
                            <>
                                <RefreshCw size={16} /> Resend Link ({cooldown}s)
                            </>
                        ) : (
                            'Send Reset Email'
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};
