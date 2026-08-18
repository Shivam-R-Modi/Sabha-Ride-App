import React from 'react';
import { Download, Share, X } from 'lucide-react';
import { useNavigation } from '../contexts/NavigationContext';
import { usePwaInstall } from '../hooks/usePwaInstall';

/**
 * Offers to install the app — one tap where the browser allows it, written
 * steps where only the user can do it.
 *
 * The steps branch exists because this banner previously rendered nothing at
 * all on an iPhone. It listened for `beforeinstallprompt`, which WebKit never
 * fires, and every iOS browser is WebKit. See `src/utils/pwaInstall.ts` for the
 * platform split; this file only chooses a body.
 */
export const PWAPrompt: React.FC = () => {
  // Rendered in App.tsx OUTSIDE ResponsiveLayout, so it inherits none of the
  // layout's sidebar padding — but it is inside NavigationProvider, so it can
  // read the same state the layout uses rather than duplicating it.
  const { isSidebarCollapsed, isFocusMode } = useNavigation();
  const { availability, bannerVisible, steps, install, dismiss } = usePwaInstall();

  if (!bannerVisible) return null;

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
      {/* Inverted pair — see the note in components/UpdateBanner.tsx. */}
      <div className="bg-coffee text-cream p-4 rounded-xl shadow-2xl flex items-start justify-between gap-3">
        {availability === 'manual' ? (
          <div className="min-w-0">
            <h4 className="font-bold text-sm flex items-center gap-1.5">
              <Share size={14} className="shrink-0" /> Add to Home Screen
            </h4>
            <p className="text-xs text-cream/70 mt-0.5">Opens like an app, without the address bar.</p>
            {/* Numbered rather than prose: this is a route through two menus,
                and a driver reads it one-handed in a car park. */}
            <ol className="mt-2 space-y-1">
              {steps.map((step, index) => (
                <li key={step} className="text-xs text-cream/90 flex items-start gap-2">
                  <span className="shrink-0 w-4 h-4 rounded-full bg-saffron text-white text-[10px] font-bold flex items-center justify-center mt-px">
                    {index + 1}
                  </span>
                  <span className="min-w-0">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="min-w-0">
            <h4 className="font-bold text-sm">Install App</h4>
            <p className="text-xs text-cream/70">Add to home screen for better experience</p>
          </div>
        )}

        <div className="flex gap-3 items-center shrink-0">
          {/* No Install button in the manual case: nothing this app can call
              performs the install on iOS, and a button that only looks like it
              works is the defect this branch was added to remove. */}
          {availability === 'prompt' && (
            <button
              onClick={install}
              className="bg-saffron text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shadow-md active:scale-95"
            >
              <Download size={14} /> Install
            </button>
          )}
          <button onClick={dismiss} aria-label="Dismiss" className="text-cream/50 hover:text-cream">
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};
