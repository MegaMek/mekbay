// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Default Total Warfare crew skill values used by summaries and force DTOs. */
export const DEFAULT_GUNNERY_SKILL = 4;
export const DEFAULT_PILOTING_SKILL = 5;

export const DEAD_CREW_HIT_THRESHOLD = 6;
export const CRIPPLED_CREW_HIT_THRESHOLD = 4;
const CONSCIOUSNESS_TARGETS = [3, 5, 7, 10, 11] as const;

export function consciousnessTargetForWounds(wounds: number): number | null {
    return CONSCIOUSNESS_TARGETS[Math.trunc(wounds) - 1] ?? null;
}

export function woundsForConsciousnessTarget(target: number): number | null {
    const index = CONSCIOUSNESS_TARGETS.indexOf(Math.trunc(target) as typeof CONSCIOUSNESS_TARGETS[number]);
    return index < 0 ? null : index + 1;
}

export type SkillType = 'gunnery' | 'piloting';
export type CrewMemberState = 'healthy' | 'ejected' | 'unconscious' | 'dead' | 'killed' | 'stunned';

/** Detached crew row used by force previews and import/export DTOs. */
export interface CrewMemberDetails {
    readonly id: number;
    readonly name: string;
    readonly gunnery: number;
    readonly piloting: number;
    readonly asfGunnery?: number;
    readonly asfPiloting?: number;
}
