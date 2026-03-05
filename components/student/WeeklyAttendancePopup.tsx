import React, { useState } from 'react';
import { User } from '../../types';
import { submitWeeklyAttendance } from '../../hooks/useFirestore';
import '../../claymorphism.css';

interface WeeklyAttendancePopupProps {
    user: User;
    onResponse: (response: 'yes' | 'no') => void;
}

export const WeeklyAttendancePopup: React.FC<WeeklyAttendancePopupProps> = ({ user, onResponse }) => {
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleResponse = async (response: 'yes' | 'no') => {
        if (isSubmitting) return;

        setIsSubmitting(true);
        try {
            await submitWeeklyAttendance(user.id, response, {
                name: user.name,
                phone: user.phone,
                address: user.address
            });
            onResponse(response);
        } catch (error) {
            console.error('Error submitting attendance:', error);
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
                    background: 'linear-gradient(145deg, var(--clay-primary), var(--clay-primary-dark))',
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

                {/* Buttons - Stacked */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                }}>
                    <button
                        className="clay-button-primary"
                        onClick={() => handleResponse('yes')}
                        disabled={isSubmitting}
                        style={{
                            padding: '16px 24px',
                            fontSize: '1rem',
                            fontWeight: '600',
                            width: '100%',
                            cursor: isSubmitting ? 'wait' : 'pointer',
                            opacity: isSubmitting ? 0.7 : 1
                        }}
                    >
                        {isSubmitting ? 'Submitting...' : 'Yes, of course!'}
                    </button>

                    <button
                        className="clay-button-secondary"
                        onClick={() => handleResponse('no')}
                        disabled={isSubmitting}
                        style={{
                            padding: '14px 24px',
                            fontSize: '0.95rem',
                            fontWeight: '500',
                            width: '100%',
                            cursor: isSubmitting ? 'wait' : 'pointer',
                            opacity: isSubmitting ? 0.7 : 1,
                            background: 'transparent',
                            color: 'var(--clay-text-secondary)',
                            border: '2px solid var(--clay-border)'
                        }}
                    >
                        Nah! not this time
                    </button>
                </div>

                {/* Subtle footer text */}
                <p style={{
                    fontSize: '0.75rem',
                    color: 'var(--clay-text-muted)',
                    marginTop: '20px',
                    opacity: 0.7
                }}>
                    This helps us plan rides for everyone 🚗
                </p>
            </div>
        </div>
    );
};
