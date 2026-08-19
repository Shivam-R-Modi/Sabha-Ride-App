/**
 * Phone Number Utilities for Bhulka Gaadi
 * Supports formatting, validation, country code selection, and E.164 normalization.
 */

export interface CountryCode {
    code: string;        // ISO 2-letter country code e.g. 'US'
    name: string;        // Country display name
    dialCode: string;    // International dial code e.g. '+1'
    flag: string;        // Emoji flag
    mask: string;        // Display mask e.g. '(###) ###-####'
    minDigits: number;   // Expected min digits
    maxDigits: number;   // Expected max digits
}

export const SUPPORTED_COUNTRIES: CountryCode[] = [
    {
        code: 'US',
        name: 'United States & Canada',
        dialCode: '+1',
        flag: '🇺🇸',
        mask: '(###) ###-####',
        minDigits: 10,
        maxDigits: 10,
    },
    {
        code: 'IN',
        name: 'India',
        dialCode: '+91',
        flag: '🇮🇳',
        mask: '##### #####',
        minDigits: 10,
        maxDigits: 10,
    },
    {
        code: 'GB',
        name: 'United Kingdom',
        dialCode: '+44',
        flag: '🇬🇧',
        mask: '##### ######',
        minDigits: 10,
        maxDigits: 10,
    },
    {
        code: 'AU',
        name: 'Australia',
        dialCode: '+61',
        flag: '🇦🇺',
        mask: '#### ### ###',
        minDigits: 9,
        maxDigits: 9,
    },
    {
        code: 'NZ',
        name: 'New Zealand',
        dialCode: '+64',
        flag: '🇳🇿',
        mask: '## ### ####',
        minDigits: 8,
        maxDigits: 10,
    },
];

export const DEFAULT_COUNTRY = SUPPORTED_COUNTRIES[0]; // US/CA (+1)

/**
 * Extract digits only from raw input
 */
export function extractDigits(input: string): string {
    return input.replace(/\D/g, '');
}

/**
 * Format local raw digits according to country mask
 */
export function formatLocalNumber(digits: string, country: CountryCode = DEFAULT_COUNTRY): string {
    const cleanDigits = extractDigits(digits);
    if (!cleanDigits) return '';

    let formatted = '';
    let digitIndex = 0;
    const mask = country.mask;

    for (let i = 0; i < mask.length && digitIndex < cleanDigits.length; i++) {
        if (mask[i] === '#') {
            formatted += cleanDigits[digitIndex];
            digitIndex++;
        } else {
            formatted += mask[i];
        }
    }

    // Append any extra trailing digits if input exceeds mask
    if (digitIndex < cleanDigits.length) {
        formatted += cleanDigits.slice(digitIndex);
    }

    return formatted;
}

/**
 * Validate phone number digits for selected country
 */
export function validatePhoneNumber(
    digits: string,
    country: CountryCode = DEFAULT_COUNTRY
): { isValid: boolean; error?: string; e164?: string } {
    const cleanDigits = extractDigits(digits);

    if (!cleanDigits) {
        return { isValid: false, error: 'Phone number is required' };
    }

    if (cleanDigits.length < country.minDigits) {
        return {
            isValid: false,
            error: `Please enter a valid ${country.minDigits}-digit phone number`,
        };
    }

    if (cleanDigits.length > country.maxDigits) {
        return {
            isValid: false,
            error: `Phone number cannot exceed ${country.maxDigits} digits`,
        };
    }

    // E.164 normalization e.g. +15551234567
    const e164 = `${country.dialCode}${cleanDigits}`;
    return { isValid: true, e164 };
}

/**
 * Parse an existing phone string (E.164 or formatted) into country and local digits
 */
export function parsePhoneNumber(phone: string): { country: CountryCode; localDigits: string; formatted: string } {
    if (!phone) {
        return { country: DEFAULT_COUNTRY, localDigits: '', formatted: '' };
    }

    const trimmed = phone.trim();

    // Check matching dial code prefix
    for (const country of SUPPORTED_COUNTRIES) {
        if (trimmed.startsWith(country.dialCode)) {
            const rawDigits = extractDigits(trimmed.slice(country.dialCode.length));
            return {
                country,
                localDigits: rawDigits,
                formatted: formatLocalNumber(rawDigits, country),
            };
        }
    }

    // Fallback: If 11 digits starting with 1, assume US/CA
    const digits = extractDigits(trimmed);
    if (digits.length === 11 && digits[0] === '1') {
        const localDigits = digits.slice(1);
        return {
            country: DEFAULT_COUNTRY,
            localDigits,
            formatted: formatLocalNumber(localDigits, DEFAULT_COUNTRY),
        };
    }

    // Fallback default country
    const localDigits = digits.length > 10 ? digits.slice(-10) : digits;
    return {
        country: DEFAULT_COUNTRY,
        localDigits,
        formatted: formatLocalNumber(localDigits, DEFAULT_COUNTRY),
    };
}
