import React, { useState } from 'react';
import { User } from '../../types';
import { updateAttendanceResponse } from '../../hooks/useFirestore';
import '../../claymorphism.css';

interface AttendanceBlockedScreenProps {
    user: User;
    onUnblock: () => void;
}

export const AttendanceBlockedScreen: React.FC<AttendanceBlockedScreenProps> = ({ user, onUnblock }) => {
    const [isUpdating, setIsUpdating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleChangeMind = async () => {
        if (isUpdating) return;

        setIsUpdating(true);
        setError(null);

        try {
            const result = await updateAttendanceResponse(user.id, 'yes', 'no');
            if (result.success) {
                onUnblock();
            } else {
                setError(result.error || 'Failed to update response');
            }
        } catch (err) {
            console.error('Error updating response:', err);
            setError('Something went wrong. Please try again.');
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: 'linear-gradient(180deg, var(--clay-background) 0%, var(--clay-surface) 100%)',
            textAlign: 'center'
        }}>
            {/* Main Card */}
            <div className="clay-card" style={{
                maxWidth: '420px',
                width: '100%',
                padding: '48px 32px',
                textAlign: 'center'
            }}>
                {/* Emoji */}
                <div style={{
                    fontSize: '80px',
                    marginBottom: '24px',
                    lineHeight: 1
                }}>
                    🙏
                </div>

                {/* Main Message */}
                <h1 style={{
                    fontSize: '1.75rem',
                    fontWeight: '700',
                    color: 'var(--clay-text-primary)',
                    marginBottom: '16px',
                    lineHeight: '1.3',
                    fontFamily: 'var(--clay-font-family)'
                }}>
                    Hope to see you next time
                </h1>

                <p style={{
                    fontSize: '1.25rem',
                    color: 'var(--clay-primary)',
                    fontWeight: '600',
                    marginBottom: '32px'
                }}>
                    Jai Swaminarayan! 🙏
                </p>

                {/* Subtle divider */}
                <div style={{
                    width: '60px',
                    height: '3px',
                    background: 'linear-gradient(90deg, var(--clay-primary), var(--clay-accent))',
                    borderRadius: '2px',
                    margin: '0 auto 32px'
                }} />

                {/* Info text */}
                <p style={{
                    fontSize: '0.95rem',
                    color: 'var(--clay-text-secondary)',
                    marginBottom: '24px',
                    lineHeight: '1.6'
                }}>
                    You've indicated that you won't be attending this Friday's sabha.
                    Ride requests are disabled for this week.
                </p>

                {/* Error message */}
                {error && (
                    <div style={{
                        padding: '12px 16px',
                        background: 'rgba(220, 53, 69, 0.1)',
                        border: '1px solid rgba(220, 53, 69, 0.3)',
                        borderRadius: '8px',
                        color: '#dc3545',
                        fontSize: '0.9rem',
                        marginBottom: '16px'
                    }}>
                        {error}
                    </div>
                )}

                {/* Changed your mind link */}
                <button
                    onClick={handleChangeMind}
                    disabled={isUpdating}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--clay-primary)',
                        fontSize: '1rem',
                        fontWeight: '600',
                        cursor: isUpdating ? 'wait' : 'pointer',
                        textDecoration: 'underline',
                        textUnderlineOffset: '3px',
                        opacity: isUpdating ? 0.6 : 1,
                        transition: 'opacity 0.2s ease'
                    }}
                >
                    {isUpdating ? 'Updating...' : 'Changed your mind? ✨'}
                </button>
            </div>

            {/* Footer */}
            <p style={{
                marginTop: '32px',
                fontSize: '0.8rem',
                color: 'var(--clay-text-muted)',
                opacity: 0.6
            }}>
                Sabha Ride Seva
            </p>
        </div>
    );
};
