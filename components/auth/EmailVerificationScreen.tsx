import React, { useState, useEffect } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { Mail, CheckCircle2, RefreshCw, LogOut, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface EmailVerificationScreenProps {
    onBack: () => void;
}

export const EmailVerificationScreen: React.FC<EmailVerificationScreenProps> = ({ onBack }) => {
    const { currentUser, refreshProfile } = useAuth();
    const [cooldown, setCooldown] = useState(0);
    const [isResending, setIsResending] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = setInterval(() => {
            setCooldown((prev) => prev - 1);
        }, 1000);
        return () => clearInterval(timer);
    }, [cooldown]);

    const handleResend = async () => {
        if (!currentUser || cooldown > 0 || isResending) return;

        setIsResending(true);
        setMessage(null);

        try {
            await sendEmailVerification(currentUser);
            setMessage({ text: 'Verification email resent! Please check your inbox.', type: 'success' });
            setCooldown(60); // 60s cooldown
        } catch (err: any) {
            console.error('Error sending verification email:', err);
            if (err.code === 'auth/too-many-requests') {
                setMessage({ text: 'Too many requests. Please wait a few minutes before trying again.', type: 'error' });
            } else {
                setMessage({ text: 'Failed to send verification email. Please try again.', type: 'error' });
            }
        } finally {
            setIsResending(false);
        }
    };

    const handleCheckVerification = async () => {
        if (!currentUser || isChecking) return;

        setIsChecking(true);
        setMessage(null);

        try {
            // Force Firebase to reload user token & verify state
            await currentUser.reload();
            if (currentUser.emailVerified) {
                setMessage({ text: 'Email verified successfully! Loading your account...', type: 'success' });
                await refreshProfile();
                // Trigger page refresh if needed to update state cleanly
                window.location.reload();
            } else {
                setMessage({ text: 'Email not verified yet. Please check your inbox and click the verification link.', type: 'error' });
            }
        } catch (err) {
            console.error('Error refreshing auth state:', err);
            setMessage({ text: 'Could not verify status. Please try again.', type: 'error' });
        } finally {
            setIsChecking(false);
        }
    };

    const userEmail = currentUser?.email || 'your email';

    return (
        <div className="min-h-screen bg-gradient-to-br from-saffron/10 via-surface to-gold/10 flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-saffron-800 to-gold-700 text-[rgb(var(--text-on-accent))] py-8 text-center">
                <h1 className="text-3xl md:text-4xl font-header font-bold">Verify Your Email</h1>
                <p className="text-sm md:text-base mt-2 opacity-90">One quick step to activate your Seva account</p>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex items-center justify-center p-6">
                <div className="clay-card max-w-md w-full p-8 text-center space-y-6 animate-in fade-in zoom-in duration-500">
                    {/* Mail Icon */}
                    <div className="inline-flex p-6 rounded-full bg-saffron/10 text-saffron">
                        <Mail className="w-16 h-16 animate-bounce" />
                    </div>

                    {/* Instructions */}
                    <div className="space-y-3">
                        <h2 className="text-2xl font-header font-bold text-coffee">
                            Check Your Inbox
                        </h2>
                        <p className="text-coffee-700 text-sm">
                            We sent a verification email to:
                        </p>
                        <div className="bg-cream-300 border border-saffron/20 py-2 px-4 rounded-xl font-bold text-coffee text-sm break-all">
                            {userEmail}
                        </div>
                        <p className="text-coffee-700 text-xs">
                            Click the verification link inside the email to complete your registration.
                        </p>
                    </div>

                    {/* Status Alert Message */}
                    {message && (
                        <div className={`p-3 rounded-xl text-xs flex items-center justify-center gap-2 border ${message.type === 'success' ? 'bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))] border-[rgb(var(--success))]/40' : 'bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))] border-[rgb(var(--danger))]/40'}`}>
                            {message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                            <span>{message.text}</span>
                        </div>
                    )}

                    {/* Primary Action Buttons */}
                    <div className="space-y-3 pt-2">
                        {/* Check Status Button */}
                        <button
                            onClick={handleCheckVerification}
                            disabled={isChecking}
                            className="w-full clay-button bg-gradient-to-r from-saffron-800 to-gold-700 text-[rgb(var(--text-on-accent))] py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:shadow-lg transition-all disabled:opacity-50"
                        >
                            {isChecking ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                            I Have Verified
                        </button>

                        {/* Resend Email Button */}
                        <button
                            onClick={handleResend}
                            disabled={cooldown > 0 || isResending}
                            className="w-full border-2 border-saffron/30 text-saffron-800 hover:bg-saffron/5 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isResending ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                            {cooldown > 0 ? `Resend Email (${cooldown}s)` : 'Resend Verification Email'}
                        </button>
                    </div>

                    {/* Sign Out Link */}
                    <div className="pt-4 border-t border-mocha/10">
                        <button
                            onClick={onBack}
                            className="w-full min-h-11 flex items-center justify-center gap-2 text-coffee-500 hover:text-[rgb(var(--danger-text))] text-xs font-bold transition-colors"
                        >
                            <LogOut size={14} />
                            Sign Out / Use Different Email
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
