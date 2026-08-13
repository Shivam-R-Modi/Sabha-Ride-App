import React, { useState, useEffect } from 'react';
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
}

export const PhoneNumberInput: React.FC<PhoneNumberInputProps> = ({
    value,
    onChange,
    disabled = false,
    required = true,
    error,
    label = 'Phone Number',
}) => {
    // Initialize parsed state
    const parsed = parsePhoneNumber(value);
    const [selectedCountry, setSelectedCountry] = useState<CountryCode>(parsed.country);
    const [rawDigits, setRawDigits] = useState<string>(parsed.localDigits);

    // Re-sync when value changes externally (and differs from current internal state)
    useEffect(() => {
        if (!value) {
            setRawDigits('');
            return;
        }
        const updated = parsePhoneNumber(value);
        if (updated.localDigits !== rawDigits) {
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
                <label className="block text-sm font-medium text-coffee">
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
                        type="tel"
                        inputMode="numeric"
                        value={formattedLocal}
                        onChange={handleDigitsChange}
                        placeholder={selectedCountry.mask}
                        disabled={disabled}
                        required={required}
                        className={`w-full px-4 py-3 rounded-r-xl border-2 border-mocha/20 focus:border-saffron focus:outline-none transition-colors text-coffee font-medium placeholder-mocha/30 disabled:opacity-50 ${
                            validation.isValid ? 'pr-10 border-green-500/50' : ''
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
            {error ? (
                <p className="text-xs text-[rgb(var(--danger-text))] font-medium">{error}</p>
            ) : !validation.isValid && rawDigits.length > 0 ? (
                <p className="text-xs text-coffee-500">{validation.error}</p>
            ) : validation.isValid ? (
                <p className="text-xs text-[rgb(var(--success-text))] font-medium flex items-center gap-1">
                    ✓ Valid phone number ({selectedCountry.dialCode} {validation.e164})
                </p>
            ) : null}

            {/* SMS & Privacy Legal Consent Notice */}
            <div className="pt-1 flex items-start gap-1.5 text-[11px] text-coffee-500 leading-tight">
                <ShieldCheck size={14} className="text-saffron shrink-0 mt-0.5" />
                <span>
                    Phone numbers are kept private and used exclusively for ride updates and volunteer driver/student pickup coordination.
                </span>
            </div>
        </div>
    );
};
