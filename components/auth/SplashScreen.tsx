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
    <div className="fixed inset-0 z-[100] bg-gradient-to-br from-coffee via-mocha to-coffee flex flex-col items-center justify-center p-8 text-center overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center opacity-[0.05]">
         <OmWatermark />
      </div>
      
      <div className="relative z-10 flex flex-col items-center animate-in zoom-in duration-1000">
        <div className="mb-12">
            <LotusLoader size={120} />
        </div>
        
        <h1 className="font-header font-bold text-4xl text-white mb-2 tracking-tight drop-shadow-lg">
          Sabha <span className="text-gold">Ride</span> Seva
        </h1>
        <p className="text-gold/80 text-lg font-medium tracking-[0.2em] mb-12 uppercase italic">
          BAPS Swaminarayan Sanstha
        </p>

        {!showButton ? (
          <div className="w-64 h-1 bg-white/5 rounded-full overflow-hidden backdrop-blur-sm relative">
            <div 
              className="h-full bg-gradient-to-r from-saffron via-gold to-saffron transition-all duration-150 ease-out"
              style={{ width: `${loadingProgress}%` }}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <button 
              onClick={onFinish}
              className="group relative bg-gradient-to-r from-saffron to-saffron-dark text-white font-bold py-4 px-10 rounded-2xl shadow-[0_10px_30px_rgba(255,107,53,0.4)] active:scale-95 transition-all hover:shadow-[0_15px_40px_rgba(255,107,53,0.6)] btn-feedback flex items-center gap-3 overflow-hidden"
            >
              <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out" />
              <Sparkles size={18} className="text-gold animate-pulse" />
              <span>Get Started</span>
              <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <p className="text-gold/60 text-[10px] font-bold tracking-[0.4em] uppercase animate-pulse">Jai Swaminarayan</p>
          </div>
        )}
      </div>

      <div className="absolute bottom-12 text-gold/30 text-[10px] font-bold uppercase tracking-widest flex items-center gap-3">
        <div className="w-12 h-px bg-gold/10"></div>
        Community Mobility
        <div className="w-12 h-px bg-gold/10"></div>
      </div>
    </div>
  );
};