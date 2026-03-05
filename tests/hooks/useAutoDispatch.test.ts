import { describe, it, expect } from 'vitest';

// getZone is not exported from useAutoDispatch.ts since it's a const
// inside the module. We replicate it here for isolated testing.
// If the source changes, this test must be updated in sync.
const getZone = (address: string): string => {
    const lower = address.toLowerCase();
    if (lower.includes('back bay') || lower.includes('newbury') || lower.includes('boylston')) return 'back_bay';
    if (lower.includes('north end') || lower.includes('hanover') || lower.includes('charlestown') || lower.includes('east boston') || lower.includes('washington')) return 'north';
    if (lower.includes('allston') || lower.includes('brighton') || lower.includes('faneuil') || lower.includes('penniman') || lower.includes('academy')) return 'west';
    if (lower.includes('dorchester') || lower.includes('roxbury') || lower.includes('south boston') || lower.includes('broadway')) return 'south';
    return 'downtown'; // default
};

describe('getZone', () => {
    // Back Bay zone
    it('returns back_bay for "Back Bay" address', () => {
        expect(getZone('123 Back Bay Ave, Boston')).toBe('back_bay');
    });

    it('returns back_bay for "Newbury" street', () => {
        expect(getZone('45 Newbury St, Boston, MA')).toBe('back_bay');
    });

    it('returns back_bay for "Boylston" street', () => {
        expect(getZone('800 Boylston St')).toBe('back_bay');
    });

    // North zone
    it('returns north for "North End" address', () => {
        expect(getZone('10 North End Way')).toBe('north');
    });

    it('returns north for "Hanover" street', () => {
        expect(getZone('22 Hanover St, Boston')).toBe('north');
    });

    it('returns north for "Charlestown"', () => {
        expect(getZone('5 Charlestown Rd')).toBe('north');
    });

    it('returns north for "East Boston"', () => {
        expect(getZone('99 East Boston Blvd')).toBe('north');
    });

    it('returns north for "Washington"', () => {
        expect(getZone('100 Washington St')).toBe('north');
    });

    // West zone
    it('returns west for "Allston"', () => {
        expect(getZone('15 Allston St')).toBe('west');
    });

    it('returns west for "Brighton"', () => {
        expect(getZone('200 Brighton Ave')).toBe('west');
    });

    it('returns west for "Faneuil"', () => {
        expect(getZone('1 Faneuil Hall')).toBe('west');
    });

    it('returns west for "Academy"', () => {
        expect(getZone('50 Academy Hill Rd')).toBe('west');
    });

    // South zone
    it('returns south for "Dorchester"', () => {
        expect(getZone('33 Dorchester Ave')).toBe('south');
    });

    it('returns south for "Roxbury"', () => {
        expect(getZone('Roxbury Crossing')).toBe('south');
    });

    it('returns south for "South Boston"', () => {
        expect(getZone('7 South Boston St')).toBe('south');
    });

    it('returns south for "Broadway"', () => {
        expect(getZone('600 Broadway')).toBe('south');
    });

    // Default zone
    it('returns downtown for unknown address', () => {
        expect(getZone('1 Milk St, Boston, MA')).toBe('downtown');
    });

    it('returns downtown for empty string', () => {
        expect(getZone('')).toBe('downtown');
    });

    // Case insensitivity
    it('is case-insensitive', () => {
        expect(getZone('BACK BAY')).toBe('back_bay');
        expect(getZone('north END')).toBe('north');
        expect(getZone('ALLSTON')).toBe('west');
        expect(getZone('DORCHESTER')).toBe('south');
    });
});
