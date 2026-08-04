/**
 * Password Validation and Strength Utility
 */

export interface PasswordCriteria {
    hasMinLength: boolean;
    hasNumber: boolean;
    hasSpecialChar: boolean;
    hasUppercase: boolean;
}

export interface PasswordStrengthResult {
    score: 'weak' | 'fair' | 'strong';
    label: string;
    percentage: number;
    criteria: PasswordCriteria;
    isValid: boolean;
}

export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
    const criteria: PasswordCriteria = {
        hasMinLength: password.length >= 8,
        hasNumber: /[0-9]/.test(password),
        hasSpecialChar: /[^a-zA-Z0-9]/.test(password),
        hasUppercase: /[A-Z]/.test(password),
    };

    let passedCount = 0;
    if (criteria.hasMinLength) passedCount++;
    if (criteria.hasNumber) passedCount++;
    if (criteria.hasSpecialChar) passedCount++;
    if (criteria.hasUppercase) passedCount++;

    let score: 'weak' | 'fair' | 'strong' = 'weak';
    let label = 'Weak';
    let percentage = 25;

    if (passedCount === 4) {
        score = 'strong';
        label = 'Strong';
        percentage = 100;
    } else if (passedCount >= 2 && criteria.hasMinLength) {
        score = 'fair';
        label = 'Fair';
        percentage = 65;
    } else {
        score = 'weak';
        label = 'Weak';
        percentage = Math.max(20, passedCount * 25);
    }

    // Password is valid for sign up if length >= 8 and has at least one number and one special char
    const isValid = criteria.hasMinLength && (criteria.hasNumber || criteria.hasSpecialChar);

    return {
        score,
        label,
        percentage,
        criteria,
        isValid,
    };
}
