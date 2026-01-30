import React from 'react';

// --- Icons & Motifs ---

export const LotusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12,2.5c0,0-1.2,2.4-1.2,3.8c0,1,0.5,1.8,1.2,1.8s1.2-0.8,1.2-1.8C13.2,4.9,12,2.5,12,2.5z M12,21.5c-4.2,0-7.8-2.6-9.3-6.4c1.8,1.5,4.1,2.4,6.7,2.4c1.1,0,2.2-0.2,3.2-0.5c-0.2,0.1-0.4,0.3-0.6,0.5C12,17.5,12,21.5,12,21.5z M4.5,13c0-2.5,1.5-4.7,3.6-5.8c-0.6,1.4-1,3,1,4.6c0,0.4,0,0.8,0.1,1.2C7.2,13,7.2,13,7.2,13L4.5,13z M19.5,13c0-2.5-1.5-4.7,3.6-5.8c0.6,1.4,1,3,1,4.6c0,0.4,0,0.8-0.1,1.2C16.8,13,16.8,13,16.8,13L19.5,13z" />
  </svg>
);

export const DiyaIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 2c.5 2 2.5 4 2.5 6S12.5 12 12 12s-2.5-2-2.5-4S11.5 4 12 2z" fill="#FF6B35" stroke="none" />
    <path d="M4 12c0 4.4 3.6 8 8 8s8-3.6 8-8c0-1.1-.2-2.1-.6-3H4.6c-.4.9-.6 1.9-.6 3z" />
  </svg>
);

export const LotusLoader: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <div className="flex flex-col items-center justify-center animate-in fade-in duration-500">
    <div className="relative" style={{ width: size, height: size }}>
      <LotusIcon className="w-full h-full text-saffron animate-pulse-slow drop-shadow-sm" />
      <div className="absolute inset-0 border-2 border-gold/20 rounded-full animate-spin-slow"></div>
    </div>
  </div>
);

export const OmWatermark: React.FC = () => null;

// --- Production Configuration ---

export const VENUE_ADDRESS = "BAPS Shri Swaminarayan Mandir, Edison";
