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
                /* CONTENT box: the SMALL viewport — the screen with browser chrome
                   SHOWING. Sized this way on purpose, so "Tap to continue" is never
                   underneath a browser toolbar. The previous attempt used
                   `100lvh + safe-area`, which is the opposite end of the range, and
                   pushed that line off the bottom of a phone: the report came back
                   with the text sliced in half.
                   If `svh` is unsupported the declaration is dropped and `inset-0`
                   sizes this exactly as it always did. */
                height: '100svh',
                /* Behind the photo, and behind the layer below, for the moment before
                   the image decodes. A FIXED dark brown, not a theme token: this
                   screen is dark in both themes, so `--canvas` would put a near-white
                   band under a dark photograph in light mode. */
                backgroundColor: '#1C1815',
            }}
        >
            {/* THE PHOTOGRAPH, on its own layer, deliberately TALLER than the box
                above.

                Two viewports are in play on a phone and they are different sizes:
                `svh` is the screen with browser chrome showing, `lvh` is the screen
                with it retracted. Content has to live inside the small one to stay
                visible; the picture has to fill the large one so no strip is left
                behind when the chrome hides. One element cannot be both, which is
                why this is split in two.

                `aria-hidden`: it is decoration, and the quote below is the content.

                NOTE for whoever reads this next: a flat, featureless band along the
                bottom of a phone that CLIPS this screen's text is not this element.
                Page content cannot be clipped by something painted behind it — that
                band is the browser's own toolbar, drawn over the page, which Safari
                and Chrome on iOS tint by sampling the page background. It went from
                black to the app's colour the moment `html` got a background, which is
                how it was identified. Installing to the home screen removes it; no
                amount of CSS here can. */}
            <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 -z-10 pointer-events-none"
                style={{
                    height: 'calc(100lvh + env(safe-area-inset-bottom, 0px))',
                    backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.3)), url(${backgroundImage})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                }}
            />

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
