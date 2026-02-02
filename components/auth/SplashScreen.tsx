import React, { useState, useEffect } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer1 = setTimeout(() => setStep(1), 1500);
    const timer2 = setTimeout(() => setStep(2), 3000);
    const timer3 = setTimeout(() => onComplete(), 4500);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [onComplete]);

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-orange-500 via-orange-600 to-blue-900 flex items-center justify-center">
      <div className="text-center">
        {step === 0 && (
          <div className="animate-pulse">
            <div className="w-32 h-32 mx-auto bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
              <span className="text-6xl">🚗</span>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="animate-fadeIn">
            <h1 className="text-6xl font-bold text-white mb-4">Sabha</h1>
            <p className="text-2xl text-white/90">Ride Seva</p>
          </div>
        )}

        {step === 2 && (
          <div className="animate-fadeIn">
            <p className="text-xl text-white/80">Connecting Communities</p>
            <p className="text-lg text-white/60 mt-2">One Ride at a Time</p>
          </div>
        )}
      </div>
    </div>
  );
}