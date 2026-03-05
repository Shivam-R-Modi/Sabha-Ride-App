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
                backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.3)), url(${backgroundImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
            }}
        >
            {/* Rotating Spiritual Quote */}
            <div className="text-center px-6 mb-8 animate-in fade-in slide-in-from-bottom duration-700">
                <p
                    className="text-2xl md:text-3xl font-medium drop-shadow-lg leading-relaxed"
                    style={{
                        fontFamily: "'GJDW', 'Inter', sans-serif",
                        color: '#FF6B35'
                    }}
                >
                    {currentQuote}
                </p>
            </div>

            {/* Tap to Continue */}
            <div className="text-center animate-in fade-in slide-in-from-bottom duration-700 delay-300">
                <p className="text-white text-lg md:text-xl font-medium drop-shadow-lg animate-pulse">
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
