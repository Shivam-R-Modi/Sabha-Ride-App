import React, { useEffect, useId, useRef, useState } from 'react';
import {
    CountryCode,
    SUPPORTED_COUNTRIES,
    DEFAULT_COUNTRY,
    formatLocalNumber,
    extractDigits,
    validatePhoneNumber,
    parsePhoneNumber,
} from '../../src/utils/phoneUtils';
import { CheckCircle2, ShieldCheck } from 'lucide-react';

interface PhoneNumberInputProps {
    value: string;
    onChange: (fullFormatted: string, e164: string, isValid: boolean) => void;
    disabled?: boolean;
    required?: boolean;
    error?: string;
    label?: string;
    /**
     * The privacy line under the field. On by default so every existing call site is
     * unchanged, and turned OFF for the second and third of a stack — the airport
     * request form asks for three numbers, and the same sentence three times reads as
     * a rendering fault rather than as a promise.
     */
    showPrivacyNote?: boolean;
}

export const PhoneNumberInput: React.FC<PhoneNumberInputProps> = ({
    value,
    onChange,
    disabled = false,
    required = true,
    error,
    label = 'Phone Number',
    showPrivacyNote = true,
}) => {
    // Initialize parsed state
    const parsed = parsePhoneNumber(value);
    const [selectedCountry, setSelectedCountry] = useState<CountryCode>(parsed.country);
    const [rawDigits, setRawDigits] = useState<string>(parsed.localDigits);

    /**
     * The digits as they stand, readable without becoming a dependency.
     *
     * The sync below compares against them so it does not clobber what someone is
     * mid-way through typing — but it must run when the PROP changes, not on every
     * keystroke. Listing `rawDigits` as a dependency would do the latter and fight
     * the caret; omitting it silently is what the lint rule objects to, correctly.
     * A ref is the honest third option: the effect reads the current value and
     * still depends only on `value`.
     */
    const rawDigitsRef = useRef(rawDigits);
    rawDigitsRef.current = rawDigits;

    /**
     * The label was tied to NOTHING. No `htmlFor`, no `id`, so every screen reader on
     * every form in this app announced this as an unlabelled text box — registration,
     * profile, and three times over on the airport request form.
     *
     * `useId` rather than a prop, because that airport form stacks three of these and a
     * hardcoded id would make one label point at another field's box, which is worse
     * than none.
     */
    const inputId = useId();
    const messageId = `${inputId}-message`;

    // Re-sync when `value` changes externally and differs from what is typed.
    useEffect(() => {
        if (!value) {
            setRawDigits('');
            return;
        }
        const updated = parsePhoneNumber(value);
        if (updated.localDigits !== rawDigitsRef.current) {
            setSelectedCountry(updated.country);
            setRawDigits(updated.localDigits);
        }
    }, [value]);

    const formattedLocal = formatLocalNumber(rawDigits, selectedCountry);
    const validation = validatePhoneNumber(rawDigits, selectedCountry);

    const handleDigitsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputVal = e.target.value;
        const newDigits = extractDigits(inputVal);

        // Limit digits length to country maxDigits
        if (newDigits.length > selectedCountry.maxDigits) return;

        setRawDigits(newDigits);

        const newFormattedLocal = formatLocalNumber(newDigits, selectedCountry);
        const newValidation = validatePhoneNumber(newDigits, selectedCountry);
        const fullDisplayValue = `${selectedCountry.dialCode} ${newFormattedLocal}`.trim();

        onChange(fullDisplayValue, newValidation.e164 || '', newValidation.isValid);
    };

    const handleCountryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const countryCode = e.target.value;
        const found = SUPPORTED_COUNTRIES.find((c) => c.code === countryCode) || DEFAULT_COUNTRY;
        setSelectedCountry(found);

        // Re-validate with new country
        const newValidation = validatePhoneNumber(rawDigits, found);
        const formattedLocalNew = formatLocalNumber(rawDigits, found);
        const fullDisplayValue = `${found.dialCode} ${formattedLocalNew}`.trim();

        onChange(fullDisplayValue, newValidation.e164 || '', newValidation.isValid);
    };

    return (
        <div className="space-y-1.5">
            {label && (
                <label htmlFor={inputId} className="block text-sm font-medium text-coffee">
                    {label} {required && <span className="text-[rgb(var(--danger-text))]">*</span>}
                </label>
            )}

            <div className="relative flex items-center">
                {/* Country Code Selector */}
                <div className="relative">
                    <select
                        value={selectedCountry.code}
                        onChange={handleCountryChange}
                        disabled={disabled}
                        className="appearance-none bg-cream-300/60 hover:bg-cream-300/70 border-2 border-r-0 border-mocha/20 rounded-l-xl px-3 py-3 pr-7 text-sm font-medium text-coffee focus:outline-none focus:border-saffron transition-colors cursor-pointer disabled:opacity-50"
                        // `title` alone is not an accessible name for a control — it is a
                        // tooltip, and it is not announced reliably by anything.
                        aria-label="Country code"
                        title="Select Country Code"
                    >
                        {SUPPORTED_COUNTRIES.map((c) => (
                            <option key={c.code} value={c.code}>
                                {c.flag} {c.dialCode} ({c.code})
                            </option>
                        ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-coffee-500 text-xs">
                        ▼
                    </div>
                </div>

                {/* Phone Input */}
                <div className="relative flex-1">
                    <input
                        id={inputId}
                        type="tel"
                        inputMode="numeric"
                        value={formattedLocal}
                        onChange={handleDigitsChange}
                        placeholder={selectedCountry.mask}
                        disabled={disabled}
                        required={required}
                        // So the refusal below is READ OUT, rather than sitting there
                        // being looked at by people who can see it.
                        aria-invalid={Boolean(error) || (rawDigits.length > 0 && !validation.isValid)}
                        aria-describedby={messageId}
                        className={`w-full px-4 py-3 rounded-r-xl border-2 border-mocha/20 focus:border-saffron focus:outline-none transition-colors text-coffee font-medium placeholder-mocha/30 disabled:opacity-50 ${
                            validation.isValid ? 'pr-10 border-[rgb(var(--success))]/50' : ''
                        }`}
                    />

                    {/* Valid Checkmark Indicator */}
                    {validation.isValid && (
                        <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-[rgb(var(--success-text))]">
                            <CheckCircle2 size={18} />
                        </div>
                    )}
                </div>
            </div>

            {/* Validation / Custom Error */}
            <div id={messageId} role={error ? 'alert' : undefined}>
            {error ? (
                <p className="text-xs text-[rgb(var(--danger-text))] font-medium">{error}</p>
            ) : !validation.isValid && rawDigits.length > 0 ? (
                <p className="text-xs text-coffee-500">{validation.error}</p>
            ) : validation.isValid ? (
                <p className="text-xs text-[rgb(var(--success-text))] font-medium flex items-center gap-1">
                    {/* `e164` ALREADY CARRIES THE DIAL CODE. Printing `selectedCountry.dialCode`
                        beside it rendered "+91 +911293812944" — the country code twice, once
                        detached and once attached, on the line whose whole job is to reassure
                        somebody the number is right. */}
                    ✓ Valid phone number ({validation.e164})
                </p>
            ) : null}
            </div>

            {/* SMS & Privacy Legal Consent Notice */}
            {showPrivacyNote && (
                <div className="pt-1 flex items-start gap-1.5 text-[11px] text-coffee-500 leading-tight">
                    <ShieldCheck size={14} className="text-saffron shrink-0 mt-0.5" />
                    <span>
                        Kept private, used only to arrange your ride.
                    </span>
                </div>
            )}
        </div>
    );
};
