// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { IntrinsicWeaponKind } from '../entity/types/weapon';
import type { MekPhysicalAttackCheckTriggerKindV2 } from '../runtime/mek-movement-psr-v2';

/** A resolvable physical attack: an intrinsic attack or a mounted physical weapon. */
export type PhysicalAttackKind = Exclude<IntrinsicWeaponKind, 'airmek-ram' | 'frenzy'> | 'weapon';

export const PHYSICAL_ATTACK_KINDS: readonly PhysicalAttackKind[] = Object.freeze([
    'punch', 'kick', 'club', 'push', 'charge', 'death-from-above', 'weapon',
]);

/** Which location table a hit is read on: the standard 2D6 table, or the 1D6 punch or kick table. */
export type HitTable = 'standard' | 'punch' | 'kick';

/**
 * The table a physical attack uses against a standing Mek (TW pp.145-150; Core pp.78-83): punches, DFAs and
 * claws use the punch table, kicks the kick table. Other targets, and prone Meks, use their standard table.
 */
export function physicalHitTable(kind: PhysicalAttackKind, claws: boolean): HitTable {
    switch (kind) {
        case 'punch':
        case 'death-from-above':
            return 'punch';
        case 'kick':
            return 'kick';
        case 'weapon':
            return claws ? 'punch' : 'standard';
        default:
            return 'standard';
    }
}

/** Charges and DFAs strike in 5-point groupings; every other physical attack strikes as one. */
export function physicalDamageGroupSize(kind: PhysicalAttackKind, damage: number): number {
    return kind === 'charge' || kind === 'death-from-above' ? 5 : damage;
}

/**
 * The comparative modifier of a charge or DFA: the attacker's Piloting minus the target's, taking 4 for an
 * immobile target (TW p.144; Core p.77).
 */
export function comparativePilotingModifier(attackerPiloting: number, targetPiloting: number, targetImmobile: boolean): number {
    return attackerPiloting - (targetImmobile ? 4 : targetPiloting);
}

/**
 * What a successful charge or DFA costs the attacker: 1 point per 10 tons of the target for a charge, read on
 * its standard table; 1 point per 5 of its own tons for a DFA, read on the kick table. Both from the front,
 * in 5-point groupings (TW pp.148-150; Core pp.78-80).
 */
export function physicalSelfDamage(
    kind: PhysicalAttackKind,
    attackerTons: number,
    targetTons: number,
): Readonly<{ damage: number; table: HitTable }> | null {
    if (kind === 'charge') return Object.freeze({ damage: Math.ceil(targetTons / 10), table: 'standard' });
    if (kind === 'death-from-above') return Object.freeze({ damage: Math.ceil(attackerTons / 5), table: 'kick' });
    return null;
}

/**
 * The modifier of one physical-attack Piloting Skill Roll under `ruleset`, or null when that ruleset makes
 * no such roll: Core alone makes a clubbed Mek roll, and Total Warfare's DFA attacker rolls at +4, Core's
 * at +2 (TW p.60; Core p.111).
 */
export function physicalAttackCheckModifier(ruleset: CBTRuleset, triggerKind: MekPhysicalAttackCheckTriggerKindV2): number | null {
    switch (triggerKind) {
        case 'kicked':
        case 'pushed':
        case 'missed-kick':
            return 0;
        case 'clubbed':
            return ruleset === 'core-2026' ? 0 : null;
        case 'charged':
        case 'made-charge':
        case 'struck-by-death-from-above':
            return 2;
        case 'made-death-from-above':
            return ruleset === 'core-2026' ? 2 : 4;
    }
}

/** The Piloting Skill Rolls one resolved physical attack forces, on each side (TW p.60; Core p.111). */
export function physicalAttackPilotChecks(
    ruleset: CBTRuleset,
    kind: PhysicalAttackKind,
    hit: boolean,
): Readonly<{
    attacker: readonly MekPhysicalAttackCheckTriggerKindV2[];
    target: readonly MekPhysicalAttackCheckTriggerKindV2[];
    attackerFalls: boolean;
}> {
    const checks = (...triggerKinds: MekPhysicalAttackCheckTriggerKindV2[]): readonly MekPhysicalAttackCheckTriggerKindV2[] =>
        Object.freeze(triggerKinds.filter(triggerKind => physicalAttackCheckModifier(ruleset, triggerKind) !== null));
    const result = (attacker = checks(), target = checks(), attackerFalls = false) =>
        Object.freeze({ attacker, target, attackerFalls });
    switch (kind) {
        case 'kick':
            return hit ? result(checks(), checks('kicked')) : result(checks('missed-kick'));
        case 'push':
            return hit ? result(checks(), checks('pushed')) : result();
        case 'club':
            return hit ? result(checks(), checks('clubbed')) : result();
        case 'charge':
            return hit ? result(checks('made-charge'), checks('charged')) : result();
        case 'death-from-above':
            return hit
                ? result(checks('made-death-from-above'), checks('struck-by-death-from-above'))
                : result(checks(), checks(), true);
        default:
            return result();
    }
}
