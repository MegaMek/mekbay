export const APPROXIMATE_MARGIN = 5;

export type TechAdvancementDatePurpose = 'extinct' | 'availability';

export function parseAdvancementYear(value: string | number | undefined): number | null {
    if (value === undefined || value === null || value === '' || value === '-') return null;
    if (typeof value === 'number') return value;
    if (value === 'ES') return 1950;
    if (value === 'PS') return 2100;
    const digits = value.replace(/\D/g, '');
    return digits ? parseInt(digits, 10) : null;
}

export function getEffectiveAdvancementYear(value: string | number | undefined, purpose: TechAdvancementDatePurpose): number | null {
    const year = parseAdvancementYear(value);
    if (year === null) return null;
    if (typeof value !== 'string' || !value.trim().startsWith('~')) return year;
    return purpose === 'extinct'
        ? year + APPROXIMATE_MARGIN
        : year - APPROXIMATE_MARGIN;
}