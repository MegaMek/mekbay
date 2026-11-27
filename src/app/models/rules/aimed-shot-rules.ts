// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import { BIPED_LEG_LOCATIONS, QUAD_LEG_LOCATIONS, TRIPOD_LEG_LOCATIONS } from '../entity/types/mek';
import type { TnTargetUnitType } from '../target-number-calculator.model';
import type { WeaponType } from '../weapon-types.model';

/**
 * Aimed shots (TW pp. 110 and 143, Core pp. 70 and 200). The two books agree except on the roll that decides
 * whether the shot strikes the named location, and on which units may be aimed at. Total Warfare is silent on
 * partial cover and on the head shot of an attacker with a targeting computer; both follow Core.
 */

/** Added for aiming at a 'Mech's head, and for aiming at a mobile target with a targeting computer. */
export const AIMED_SHOT_MODIFIER = 3;

/** Hit-location rerolls rolled ahead for a target in partial cover, whose leg results are rerolled. */
export const AIMED_SHOT_LEG_REROLLS = 6;

const FORBIDDEN_TYPES: ReadonlySet<WeaponType> = new Set<WeaponType>(['AE', 'C', 'F']);
const MEK_LEGS: ReadonlySet<string> = new Set<string>([
    ...BIPED_LEG_LOCATIONS, ...TRIPOD_LEG_LOCATIONS, ...QUAD_LEG_LOCATIONS,
]);
const MEK_HEAD = 'HD';

/** Why the weapon may aim: the target cannot move, or a targeting computer aims at a mobile one. */
export type AimedShotKind = 'immobile' | 'targeting-computer';

export interface AimedShotWeapon {
    /** Weapon types with the selected ammunition. */
    readonly types: readonly WeaponType[];
    /** The attack is one shot striking one location: no cluster roll, no burst of rapid fire. */
    readonly singleHit: boolean;
    /** A targeting computer's -1 applies to this weapon's attacks. */
    readonly computerAided: boolean;
}

export interface AimedShotTarget {
    readonly unitType: TnTargetUnitType | undefined;
    readonly immobile: boolean;
    readonly indirectFire: boolean;
    /** Partial cover hides a 'Mech's legs. */
    readonly partialCover: boolean;
}

export interface AimedShot {
    readonly kind: AimedShotKind;
    readonly location: string;
    /** A 'Mech's head: +3 in place of the immobile modifier, and never with a targeting computer. */
    readonly head: boolean;
}

/**
 * The units whose locations may be named: 'Mechs in both rulesets, and vehicles in Total Warfare (p. 110). A target
 * of no declared type is a 'Mech.
 */
export function aimedShotTargetFamily(
    ruleset: CBTRuleset,
    unitType: TnTargetUnitType | undefined,
): 'mek' | 'vehicle' | null {
    if (unitType === undefined || unitType.startsWith('mek-')) return 'mek';
    return ruleset === 'total-warfare' && (unitType === 'vehicle' || unitType === 'vtol-wige') ? 'vehicle' : null;
}

/** How this weapon may aim at this target; null when it may not. */
export function aimedShotKind(
    ruleset: CBTRuleset,
    weapon: AimedShotWeapon,
    target: AimedShotTarget,
): AimedShotKind | null {
    if (aimedShotTargetFamily(ruleset, target.unitType) === null) return null;
    if (target.indirectFire || !weapon.singleHit || weapon.types.some(type => FORBIDDEN_TYPES.has(type))) return null;
    if (target.immobile) return 'immobile';
    // Pulse weapons never aim with a targeting computer.
    return weapon.computerAided && !weapon.types.includes('P') ? 'targeting-computer' : null;
}

/** The aimed shot this weapon makes at `location`; null when it may not aim there. */
export function aimedShot(
    ruleset: CBTRuleset,
    weapon: AimedShotWeapon,
    target: AimedShotTarget,
    location: string,
): AimedShot | null {
    const kind = aimedShotKind(ruleset, weapon, target);
    if (kind === null) return null;
    const mek = aimedShotTargetFamily(ruleset, target.unitType) === 'mek';
    const head = mek && location === MEK_HEAD;
    if (head && kind === 'targeting-computer') return null;
    if (mek && target.partialCover && MEK_LEGS.has(location)) return null;
    return Object.freeze({ kind, location, head });
}

/**
 * Whether the shot goes without the targeting computer's -1: the computer helps only shots at an immobile target's
 * locations other than the head, and never a pulse weapon's.
 */
export function aimedShotIgnoresComputer(shot: AimedShot, weapon: AimedShotWeapon): boolean {
    return shot.head || shot.kind === 'targeting-computer' || weapon.types.includes('P');
}

/** An aimed shot as the attacker rolled it, for the struck unit to read on its own tables. */
export interface AimedShotRoll {
    /** The named location, as the target's sheet codes it. */
    readonly location: string;
    /** The roll that decides whether that location is struck: 2D6 or 1D6 (`aimedShotDice`). */
    readonly roll: readonly number[];
    /** Hit-location rolls that replace a leg result, when the target stands in partial cover. */
    readonly rerolls?: readonly (readonly [number, number])[];
}

/** The dice of the roll that follows a hit: 2D6 in Total Warfare, 1D6 in Core. */
export function aimedShotDice(ruleset: CBTRuleset): 1 | 2 {
    return ruleset === 'total-warfare' ? 2 : 1;
}

/** Whether that roll strikes the named location: 6, 7 or 8 on 2D6 (TW p. 110), 4+ on 1D6 (Core p. 70). */
export function aimedShotStrikes(roll: readonly number[]): boolean {
    const total = roll.reduce((sum, die) => sum + die, 0);
    return roll.length === 1 ? total >= 4 : total >= 6 && total <= 8;
}
