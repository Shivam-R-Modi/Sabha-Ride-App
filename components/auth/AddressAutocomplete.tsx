/**
 * AddressAutocomplete — Google Places-powered address input
 *
 * Renders a styled text input with a dropdown of address suggestions.
 * When the user selects a suggestion, lat/lng is captured automatically
 * via Place Details and passed to the parent via onSelect.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useGooglePlaces, PlaceDetails } from '../../hooks/useGooglePlaces';

interface AddressAutocompleteProps {
    value: string;
    onChange: (value: string) => void;
    onSelect: (details: PlaceDetails) => void;
    disabled?: boolean;
    placeholder?: string;
}

export const AddressAutocomplete: React.FC<AddressAutocompleteProps> = ({
    value,
    onChange,
    onSelect,
    disabled = false,
    placeholder = 'Start typing your address…',
}) => {
    const {
        predictions,
        loading,
        getPlacePredictions,
        getPlaceDetails,
        clearPredictions,
    } = useGooglePlaces();

    const [showDropdown, setShowDropdown] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [fetchingDetails, setFetchingDetails] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        onChange(val);
        setActiveIndex(-1);

        if (val.trim().length >= 3) {
            getPlacePredictions(val);
            setShowDropdown(true);
        } else {
            clearPredictions();
            setShowDropdown(false);
        }
    };

    const handleSelect = async (placeId: string, description: string) => {
        setFetchingDetails(true);
        setShowDropdown(false);
        clearPredictions();
        onChange(description);

        try {
            const details = await getPlaceDetails(placeId);
            onSelect(details);
        } catch (err) {
            console.error('Failed to get place details:', err);
        } finally {
            setFetchingDetails(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!showDropdown || predictions.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((prev) => (prev < predictions.length - 1 ? prev + 1 : 0));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((prev) => (prev > 0 ? prev - 1 : predictions.length - 1));
        } else if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault();
            const selected = predictions[activeIndex];
            handleSelect(selected.placeId, selected.description);
        } else if (e.key === 'Escape') {
            setShowDropdown(false);
        }
    };

    return (
        <div ref={wrapperRef} style={{ position: 'relative' }}>
            {/* Input */}
            <input
                type="text"
                value={value}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                    if (predictions.length > 0) setShowDropdown(true);
                }}
                placeholder={placeholder}
                disabled={disabled || fetchingDetails}
                className="w-full px-4 py-3 rounded-xl border-2 border-mocha/20 focus:border-saffron focus:outline-none transition-colors"
                autoComplete="off"
            />

            {/* Loading indicator */}
            {(loading || fetchingDetails) && (
                <div style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                }}>
                    <svg className="animate-spin h-5 w-5 text-saffron" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                </div>
            )}

            {/* Dropdown */}
            {showDropdown && predictions.length > 0 && (
                <ul
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        zIndex: 50,
                        marginTop: '4px',
                        maxHeight: '240px',
                        overflowY: 'auto',
                        borderRadius: '12px',
                        border: '1px solid rgba(92, 64, 51, 0.15)',
                        backgroundColor: '#fff',
                        boxShadow: '0 8px 24px rgba(61, 41, 20, 0.12)',
                    }}
                >
                    {predictions.map((prediction, index) => (
                        <li
                            key={prediction.placeId}
                            onClick={() => handleSelect(prediction.placeId, prediction.description)}
                            onMouseEnter={() => setActiveIndex(index)}
                            style={{
                                padding: '10px 14px',
                                cursor: 'pointer',
                                backgroundColor: index === activeIndex ? 'rgba(255, 107, 53, 0.08)' : 'transparent',
                                borderBottom: index < predictions.length - 1 ? '1px solid rgba(92, 64, 51, 0.06)' : 'none',
                                transition: 'background-color 0.15s ease',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                {/* Pin icon */}
                                <svg
                                    width="16" height="16" viewBox="0 0 24 24" fill="none"
                                    stroke="#FF6B35" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                    style={{ marginTop: '2px', flexShrink: 0 }}
                                >
                                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                    <circle cx="12" cy="10" r="3" />
                                </svg>
                                <div>
                                    <div style={{ fontWeight: 500, fontSize: '14px', color: '#3D2914' }}>
                                        {prediction.mainText}
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#5C4033', opacity: 0.7, marginTop: '1px' }}>
                                        {prediction.secondaryText}
                                    </div>
                                </div>
                            </div>
                        </li>
                    ))}
                    {/* Google attribution (required by ToS) */}
                    <li style={{
                        padding: '6px 14px',
                        textAlign: 'right',
                        borderTop: '1px solid rgba(92, 64, 51, 0.08)',
                    }}>
                        <img
                            src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3_hdpi.png"
                            alt="Powered by Google"
                            style={{ height: '14px', display: 'inline-block' }}
                        />
                    </li>
                </ul>
            )}
        </div>
    );
};
