import React, { useEffect, useState } from 'react';
import { OmWatermark } from '../../constants';

interface SplashScreenProps {
  onFinish: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onFinish }) => {
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [showTapPrompt, setShowTapPrompt] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setLoadingProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setShowTapPrompt(true);
          return 100;
        }
        return prev + 4;
      });
    }, 30);
    return () => clearInterval(interval);
  }, []);

  const handleTap = () => {
    if (showTapPrompt) {
      onFinish();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-8 text-center overflow-hidden cursor-pointer"
      onClick={handleTap}
    >
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url(/assets/splash-background.png)' }}
      />
      {/* Dark Overlay for better text visibility */}
      <div className="absolute inset-0 bg-black/50" />

      <div className="absolute inset-0 flex items-center justify-center opacity-[0.05]">
        <OmWatermark />
      </div>

      <div className="absolute top-16 left-0 right-0 z-10 flex flex-col items-center">
        {!showTapPrompt ? (
          <div className="clay-progress-track w-64">
            <div
              className="clay-progress-fill"
              style={{ width: `${loadingProgress}%` }}
            />
          </div>
        ) : (
          <p className="text-white/80 text-lg font-medium tracking-wide animate-pulse">
            Tap anywhere to continue
          </p>
        )}
      </div>
    </div>
  );
};