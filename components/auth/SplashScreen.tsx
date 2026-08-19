import React, { useEffect, useState } from 'react';
import backgroundImage from '../Assets/smruti-1768861058554.png';

interface SplashScreenProps {
    onComplete: () => void;
}

// Spiritual quotes to rotate through
const SPIRITUAL_QUOTES = [
    "બસ એક તુ રાજી થા",
    "તમે ભગવાન તરાફ એક પગલુ ભરશો, બાકીના નવ્વાણું પગ્લા ભગવાન તમારી તરફ ભરશે",
    "ચિંતા કરી સમય બગાડવો એના કરતા ભજન કરી સમય સુધરવો",
];

const QUOTE_INDEX_KEY = 'sabha_ride_quote_index';

/**
 * THIS SCREEN WAITS FOR A TAP. It does not dismiss itself.
 *
 * The history matters, because it has now gone both ways. A tap was originally
 * required; that was removed in the Phase 3 redesign as "one mandatory, meaningless
 * tap before every launch", including for a rider opening the app just to see
 * whether their driver had arrived. The owner reversed it on 2026-08-19: the tap is
 * wanted, deliberately.
 *
 * So there is no timer here on purpose. If a timer reappears, it is not a tidy-up —
 * it undoes an explicit decision, and `tests/quality/root-background.test.ts` says
 * so.
 */
export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
    const [currentQuote, setCurrentQuote] = useState<string>('');

    useEffect(() => {
        // Get the last quote index from localStorage
        const lastIndex = localStorage.getItem(QUOTE_INDEX_KEY);
        const currentIndex = lastIndex ? parseInt(lastIndex, 10) : 0;

        // Set the current quote
        setCurrentQuote(SPIRITUAL_QUOTES[currentIndex]);

        // Calculate next index (rotate through quotes)
        const nextIndex = (currentIndex + 1) % SPIRITUAL_QUOTES.length;

        // Store the next index for the next visit
        localStorage.setItem(QUOTE_INDEX_KEY, nextIndex.toString());
    }, []);

    return (
        <div
            className="fixed inset-0 flex flex-col items-center justify-end cursor-pointer animate-in fade-in duration-500 pb-16"
            onClick={onComplete}
            style={{
                /* COVER THE SCREEN BY OVERSHOOTING IT, rather than by trying to match
                   it exactly.
                   `position: fixed` is sized to the VISUAL viewport, while the page
                   canvas — which `html` paints — can extend further, under retracted
                   browser chrome and into the home-indicator safe area. The difference
                   is the strip that kept showing along the bottom of a phone. It is
                   not reproducible on a desktop emulator: measured there, the element
                   covers 812 of 812 pixels with nothing missing, because there are no
                   insets and no chrome to create the gap.
                   `min-height: 100lvh` alone did not fix it on the device, so this
                   stops chasing the exact number and adds the bottom inset on top.
                   Overshooting is free: the excess is off-screen on a fixed element.
                   If `lvh` is unsupported the whole calc is invalid, height falls back
                   to auto, and `inset-0` sizes it as before — no worse than it was. */
                height: 'calc(100lvh + env(safe-area-inset-bottom, 0px))',
                /* Behind the photo, for the moment before it decodes and for any
                   sliver the crop cannot reach. A FIXED dark brown, not a theme
                   token: this screen is dark in both themes, so `--canvas` would put
                   a near-white band under a dark photo in light mode. Matches the
                   dark canvas, rgb(28 24 21). */
                backgroundColor: '#1C1815',
                backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.3)), url(${backgroundImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
            }}
        >
            {/* Rotating Spiritual Quote */}
            <div className="text-center px-6 mb-8 animate-in fade-in slide-in-from-bottom duration-700">
                <p
                    className="text-2xl md:text-3xl font-semibold leading-relaxed tracking-wide drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]"
                    style={{
                        fontFamily: "'Noto Sans Gujarati', 'Inter', sans-serif",
                        color: '#B84318'
                    }}
                >
                    {currentQuote}
                </p>
            </div>

            {/* Tap to Continue */}
            <div className="text-center animate-in fade-in slide-in-from-bottom duration-700 delay-300">
                <p className="text-white text-lg md:text-xl font-medium drop-shadow-lg">
                    Tap to continue
                </p>
                <div className="mt-3 flex justify-center">
                    <svg
                        className="w-6 h-6 text-white animate-bounce"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
                        />
                    </svg>
                </div>
            </div>
        </div>
    );
};
