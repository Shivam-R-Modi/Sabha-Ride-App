import React, { useEffect, useState } from 'react';
import { LotusIcon, OmWatermark, LotusLoader } from '../../constants';
import { ChevronRight, Sparkles } from 'lucide-react';

interface SplashScreenProps {
  onFinish: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onFinish }) => {
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setLoadingProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setShowButton(true);
          return 100;
        }
        return prev + 4; // Faster progress bar for a better feel
      });
    }, 30);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-8 text-center overflow-hidden">
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url(/assets/smruti-1768861058554.png)' }}
      />
      {/* Dark Overlay for better text visibility */}
      <div className="absolute inset-0 bg-black/50" />

      <div className="absolute inset-0 flex items-center justify-center opacity-[0.05]">
        <OmWatermark />
      </div>

      <div className="relative z-10 flex flex-col items-center animate-in zoom-in duration-1000">
        {!showButton ? (
          <div className="clay-progress-track w-64">
            <div
              className="clay-progress-fill"
              style={{ width: `${loadingProgress}%` }}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <button
              onClick={onFinish}
              className="clay-button-primary clay-button-primary-lg clay-button-primary-pulse group relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out" />
              <Sparkles size={18} className="text-gold animate-pulse" />
              <span>Ride Seva</span>
              <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </button>

          </div>
        )}
      </div>


    </div>
  );
};