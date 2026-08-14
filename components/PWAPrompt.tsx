import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useNavigation } from '../contexts/NavigationContext';

export const PWAPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  // Rendered in App.tsx OUTSIDE ResponsiveLayout, so it inherits none of the
  // layout's sidebar padding — but it is inside NavigationProvider, so it can
  // read the same state the layout uses rather than duplicating it.
  const { isSidebarCollapsed, isFocusMode } = useNavigation();

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
    // Clears the sidebar instead of sliding under it. The banner is `fixed`, so
    // `left-4` put it at the viewport edge and the sidebar — which is also fixed
    // and on a higher rung — drew straight over its first 240px, hiding the
    // heading and the start of the text.
    //
    // The offsets are the sidebar's own widths plus the 1rem gutter: w-20 (5rem)
    // + 1rem = left-24, w-60 (15rem) + 1rem = left-64. They match the `lg:pl-20`
    // / `lg:pl-60` the layout applies to page content, so the banner lines up
    // with the content above it rather than merely avoiding the sidebar.
    //
    // Below `lg` the sidebar is `hidden`, so the mobile `left-4` is correct and
    // stays. Focus mode hides the sidebar at every width, so it stays too.
    <div className={`fixed bottom-safe-nav right-4 z-sticky animate-in slide-in-from-bottom-10 left-4 ${isFocusMode ? '' : isSidebarCollapsed ? 'lg:left-24' : 'lg:left-64'
      }`}>
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