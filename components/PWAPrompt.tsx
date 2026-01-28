import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

export const PWAPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowPrompt(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowPrompt(false);
    }
    setDeferredPrompt(null);
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 animate-in slide-in-from-bottom-10">
      <div className="bg-coffee text-white p-4 rounded-xl shadow-2xl flex items-center justify-between">
        <div>
          <h4 className="font-bold text-sm">Install App</h4>
          <p className="text-xs text-white/70">Add to home screen for better experience</p>
        </div>
        <div className="flex gap-3 items-center">
            <button 
                onClick={handleInstall}
                className="bg-saffron text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shadow-md active:scale-95"
            >
                <Download size={14} /> Install
            </button>
            <button onClick={() => setShowPrompt(false)} className="text-white/50 hover:text-white">
                <X size={18} />
            </button>
        </div>
      </div>
    </div>
  );
};