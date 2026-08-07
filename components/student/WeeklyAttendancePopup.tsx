import React, { useState } from 'react';
import { User } from '../../types';
import { submitWeeklyAttendance } from '../../hooks/useFirestore';
import { useCurrentEvent } from '../../hooks/useCurrentEvent';
import '../../claymorphism.css';

interface WeeklyAttendancePopupProps {
    user: User;
    onResponse: (response: 'yes' | 'no') => void;
}

export const WeeklyAttendancePopup: React.FC<WeeklyAttendancePopupProps> = ({ user, onResponse }) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // The gathering this response belongs to, from the server. Never derived
    // from the device clock — see useCurrentEvent.
    const { eventId, hasEvent } = useCurrentEvent();
    // No gathering scheduled means there is nothing to respond to. Both buttons
    // would otherwise return silently on the !eventId guard below — tappable and
    // inert, which is the exact failure this app was full of.
    const blocked = !hasEvent;

    const handleResponse = async (response: 'yes' | 'no') => {
        if (isSubmitting || !eventId) return;

        setIsSubmitting(true);
        setError(null);
        try {
            await submitWeeklyAttendance(user.id, response, {
                name: user.name,
                phone: user.phone,
                address: user.address
            }, eventId);
            onResponse(response);
        } catch (error) {
            console.error('Error submitting attendance:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to submit attendance. Please try again.';
            setError(errorMessage);
            setIsSubmitting(false);
        }
    };

    return (
        <div className="clay-modal-overlay" style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            backdropFilter: 'blur(4px)'
        }}>
            <div className="clay-card" style={{
                maxWidth: '380px',
                width: '90%',
                padding: '32px 28px',
                textAlign: 'center',
                animation: 'slideUp 0.3s ease-out'
            }}>
                {/* Header Icon */}
                <div style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    background: 'linear-gradient(145deg, var(--clay-fill-primary), var(--clay-fill-primary-dark))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px',
                    boxShadow: '4px 4px 12px rgba(61, 47, 20, 0.2), inset 2px 2px 4px rgba(255, 255, 255, 0.3)'
                }}>
                    <span style={{ fontSize: '28px' }}>🙏</span>
                </div>

                {/* Title */}
                <h2 style={{
                    fontSize: '1.5rem',
                    fontWeight: '700',
                    color: 'var(--clay-text-primary)',
                    marginBottom: '12px',
                    fontFamily: 'var(--clay-font-family)'
                }}>
                    Weekly Sabha Check-in
                </h2>

                {/* Question */}
                <p style={{
                    fontSize: '1.1rem',
                    color: 'var(--clay-text-secondary)',
                    marginBottom: '28px',
                    lineHeight: '1.5'
                }}>
                    Are you going to attend sabha this Friday?
                </p>

                {/* Error Message */}
                {error && (
                    <div style={{
                        backgroundColor: '#fee',
                        border: '1px solid #fcc',
                        borderRadius: '8px',
                        padding: '12px',
                        marginBottom: '20px',
                        color: '#c33',
                        fontSize: '0.9rem',
                        textAlign: 'left'
                    }}>
                        {error}
                    </div>
                )}

                {/* Buttons - Stacked */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                }}>
                    <button
                        className="clay-button-primary"
                        onClick={() => handleResponse('yes')}
                        disabled={isSubmitting || blocked}
                        style={{
                            padding: '16px 24px',
                            fontSize: '1rem',
                            fontWeight: '600',
                            width: '100%',
                            cursor: isSubmitting ? 'wait' : blocked ? 'not-allowed' : 'pointer',
                            opacity: (isSubmitting || blocked) ? 0.7 : 1
                        }}
                    >
                        {isSubmitting ? 'Submitting...' : 'Yes, of course!'}
                    </button>

                    <button
                        className="clay-button-secondary"
                        onClick={() => handleResponse('no')}
                        disabled={isSubmitting || blocked}
                        style={{
                            padding: '14px 24px',
                            fontSize: '0.95rem',
                            fontWeight: '500',
                            width: '100%',
                            cursor: isSubmitting ? 'wait' : blocked ? 'not-allowed' : 'pointer',
                            opacity: (isSubmitting || blocked) ? 0.7 : 1,
                            background: 'transparent',
                            color: 'var(--clay-text-secondary)',
                            border: '2px solid var(--clay-border)'
                        }}
                    >
                        Nah! not this time
                    </button>
                </div>

                {/* Subtle footer text — or the reason the buttons are disabled */}
                <p style={{
                    fontSize: '0.75rem',
                    color: blocked ? '#b91c1c' : 'var(--clay-text-muted)',
                    fontWeight: blocked ? 600 : 400,
                    marginTop: '20px',
                }}>
                    {blocked
                        ? 'No sabha is scheduled yet — please check back soon.'
                        : 'This helps us plan rides for everyone 🚗'}
                </p>
            </div>
        </div>
    );
};
