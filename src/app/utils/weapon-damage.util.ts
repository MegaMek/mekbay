import { WeaponDamage } from '../models/equipment.model';

export type WeaponDamageRange = 'short' | 'medium' | 'long';

export interface WeaponDamageFormat {
    readonly showZero?: boolean;
    readonly shotSuffix?: '/Shot' | '/Sht';
    readonly specialLabel?: string;
    readonly variableLabel?: string;
}

/** Formats resolved damage without adding weapon classification labels. */
export function formatWeaponDamage(
    damage: WeaponDamage,
    options: WeaponDamageFormat = {},
): string {
    const value = damage.label === 'Special'
        ? options.specialLabel ?? damage.label
        : damage.label === 'Variable'
            ? options.variableLabel ?? damage.label
            : damage.label ?? damage.values
                .map(value => value === 0 && !options.showZero ? '' : String(value))
                .join('/');

    if (!value) return '';
    if (damage.unit === 'missile') return `${value}/Msl`;
    if (damage.unit === 'shot') return `${value}${options.shotSuffix ?? '/Shot'}`;
    if (damage.unit === 'artillery') return `${value}A`;
    return value;
}
