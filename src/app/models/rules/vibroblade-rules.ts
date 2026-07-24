import type { Equipment } from '../equipment.model';

export interface VibrobladeProfile {
    readonly activeDamage: number;
    readonly activeHeat: number;
}

const VIBROBLADE_PROFILES = [
    { flag: 'S_VIBRO_LARGE', profile: { activeDamage: 14, activeHeat: 7 } },
    { flag: 'S_VIBRO_MEDIUM', profile: { activeDamage: 10, activeHeat: 5 } },
    { flag: 'S_VIBRO_SMALL', profile: { activeDamage: 7, activeHeat: 3 } },
] as const;

export function getVibrobladeProfile(equipment: Equipment | null | undefined): VibrobladeProfile | null {
    if (equipment?.type !== 'misc' || !equipment.hasFlag('F_CLUB')) return null;
    return VIBROBLADE_PROFILES.find(candidate => equipment.hasFlag(candidate.flag))?.profile ?? null;
}

export function getVibrobladeHeat(equipment: Equipment | null | undefined): number {
    return getVibrobladeProfile(equipment)?.activeHeat ?? 0;
}