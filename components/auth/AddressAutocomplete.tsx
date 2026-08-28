/**
 * AddressAutocomplete — Google Places-powered address input
 *
 * Renders a styled text input with a dropdown of address suggestions.
 * When the user selects a suggestion, lat/lng is captured automatically
 * via Place Details and passed to the parent via onSelect.
 *
 * THE DROPDOWN IS PORTALLED TO `document.body`, and it has to be.
 *
 * Reported on 2026-08-25 from the manager's Setup screen: the suggestion list was cut
 * off at the bottom edge of the card. It was `position: absolute` inside the input's
 * wrapper, and FOUR of the six call sites sit inside an `overflow-hidden` ancestor —
 * SabhaCalendar's two cards, LocationSettings, and `Disclosure`, which wraps every
 * section of the airport request form. `overflow: hidden` clips an absolutely
 * positioned descendant no matter how high its z-index is, so no amount of stacking
 * would have fixed it.
 *
 * Fixed HERE rather than by removing `overflow-hidden` from four cards: those cards
 * need it, because their coloured header and footer bands have square corners and the
 * card is rounded. And escaping its ancestors is a property of a dropdown, not of any
 * one card — the same reasoning `tailwind.config.js` records for the `chrome` z-rung,
 * where a sticky header's stacking context had capped the role menu.
 *
 * `position: fixed` off the input's measured rect, re-measured on scroll and resize.
 * Scroll is listened for with `capture: true`, so a scroll in ANY ancestor moves it —
 * a window-only listener would leave the list floating where the input used to be.
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
    /**
     * The portalled list is NOT inside `wrapperRef` any more, so the outside-click
     * check has to know about it too. Without this, a `mousedown` on a suggestion is an
     * outside click: the list closes before the `click` lands, and selecting an address
     * silently does nothing.
     */
    const dropdownRef = useRef<HTMLUListElement>(null);

    const open = showDropdown && predictions.length > 0;

    /** Where to pin the portalled list, in viewport coordinates. */
    const [anchor, setAnchor] = useState<
        { top: number; left: number; width: number; maxHeight: number } | null
    >(null);

    useEffect(() => {
        if (!open) return;
        const measure = () => {
            const el = wrapperRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            const GAP = 4;
            const PREFERRED = 240;

            /**
             * NO USABLE VIEWPORT HEIGHT, NO CLEVERNESS. Some embedded contexts report
             * `innerHeight` as 0 — the in-app browser pane does — and the arithmetic
             * below then concludes there is no room anywhere and crams the list into
             * 96px at the top of the screen. When the height cannot be trusted, open
             * downward at full size, which is what this did before any of it.
             */
            const vh = window.innerHeight || document.documentElement?.clientHeight || 0;
            if (vh <= 0) {
                setAnchor({ top: r.bottom + GAP, left: r.left, width: r.width, maxHeight: PREFERRED });
                return;
            }

            /**
             * FLIPS ABOVE WHEN THERE IS NO ROOM BELOW, and that is not a nicety once the
             * list is `position: fixed`. Absolutely positioned, it scrolled with the
             * page, so a list running past the bottom could still be reached. Pinned to
             * the viewport it cannot — it would simply sit off-screen with no way to
             * scroll to it, which is a worse bug than the clipping this replaced.
             *
             * `maxHeight` is clamped to whichever side is used, so the list scrolls
             * internally rather than overflowing at all.
             */
            const below = vh - r.bottom - GAP;
            const above = r.top - GAP;
            const flip = below < Math.min(PREFERRED, above);
            const maxHeight = Math.max(96, Math.min(PREFERRED, flip ? above : below));

            setAnchor({
                top: flip ? r.top - GAP - maxHeight : r.bottom + GAP,
                left: r.left,
                width: r.width,
                maxHeight,
            });
        };
        measure();
        // capture: true — a scroll inside a card or a sheet does not bubble to window,
        // and the list must follow the input rather than hang where it started.
        window.addEventListener('scroll', measure, true);
        window.addEventListener('resize', measure);
        return () => {
            window.removeEventListener('scroll', measure, true);
            window.removeEventListener('resize', measure);
        };
    }, [open, predictions.length]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            const inInput = wrapperRef.current?.contains(target) ?? false;
            const inList = dropdownRef.current?.contains(target) ?? false;
            if (!inInput && !inList) setShowDropdown(false);
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

            {/* Dropdown — see the note at the top of this file for why it is a portal. */}
            {open && anchor && createPortal(
                <ul
                    ref={dropdownRef}
                    className="z-dropdown"
                    style={{
                        position: 'fixed',
                        top: anchor.top,
                        left: anchor.left,
                        width: anchor.width,
                        maxHeight: anchor.maxHeight,
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
                </ul>,
                document.body,
            )}
        </div>
    );
};
