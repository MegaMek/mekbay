// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { TnTargetNumberCalculatorState, TnTargetUnitType } from '../target-number-calculator.model';
import type { IntrinsicWeaponKind } from '../entity/types/weapon';
import type { MekPhysicalAttackCheckTriggerKindV2 } from '../runtime/mek-movement-psr-v2';
import { legAttackTarget, SWARM_VEHICLE_MODIFIER, swarmTarget } from './anti-mek-attack-rules';

/**
 * A resolvable physical attack: an intrinsic attack or a mounted physical weapon. Infantry anti-'Mech attacks are
 * declared and reported the same way, though they resolve in the Weapon Attack Phase (`isAntiMekAttack`); a swarming
 * unit's Swarm Attack is its swarm damage.
 */
export type PhysicalAttackKind = Exclude<IntrinsicWeaponKind, 'airmek-ram' | 'frenzy'> | 'weapon' | 'swarm-damage';

export const PHYSICAL_ATTACK_KINDS: readonly PhysicalAttackKind[] = Object.freeze([
    'punch', 'kick', 'mule-kick', 'club', 'push', 'charge', 'death-from-above', 'thrash', 'weapon',
    'leg-attack', 'swarm', 'swarm-damage', 'end-swarm', 'brush-off',
]);

/**
 * Physical attacks the record sheet leaves out: play options of a prone or swarmed 'Mech, which the inventory panel
 * offers when they apply.
 */
export const UNPRINTED_PHYSICAL_ATTACKS: ReadonlySet<string> = new Set<PhysicalAttackKind>(['thrash', 'brush-off']);

/**
 * Whether the attacker's movement counts against the attack: not for the anti-'Mech attacks (TW p. 220), nor for a
 * brush off, which is a Piloting Skill Roll (TW p. 221).
 */
export function physicalAttackTakesMovement(kind: PhysicalAttackKind | null | undefined): boolean {
    return kind !== 'brush-off' && kind !== 'leg-attack' && kind !== 'swarm' && kind !== 'swarm-damage'
        && kind !== 'end-swarm';
}

/**
 * A thrash automatically succeeds, so it rolls no to-hit (TW p. 151); so does the damage of a unit already swarming
 * (TW p. 223) and its choice to end the swarm.
 */
export function physicalAttackAlwaysHits(kind: PhysicalAttackKind | null | undefined): boolean {
    return kind === 'thrash' || kind === 'swarm-damage' || kind === 'end-swarm';
}

/**
 * Which location table a hit is read on: the standard 2D6 table, the 1D6 punch or kick table, or the 2D6 Swarm
 * Attacks Hit Location Table.
 */
export type HitTable = 'standard' | 'punch' | 'kick' | 'swarm';

/** The dice of one roll on a hit-location table: 1D6 on the punch and kick tables, 2D6 on the others. */
export function hitTableDice(table: HitTable): 1 | 2 {
    return table === 'punch' || table === 'kick' ? 1 : 2;
}

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
        case 'mule-kick':
            return 'kick';
        case 'weapon':
            return claws ? 'punch' : 'standard';
        default:
            return 'standard';
    }
}

/**
 * The table a physical attack strikes a target on, and the column a DFA strikes: the punch and kick tables are for a
 * standing 'Mech, anything else is struck on its standard table, and a DFA strikes a prone 'Mech's rear and any other
 * target's front (TW p. 151; Core p. 80).
 */
export function physicalStrike(
    kind: PhysicalAttackKind,
    standingMekTable: HitTable,
    target: Readonly<{ mek: boolean; prone: boolean }>,
): Readonly<{ table: HitTable; arc?: 'rear' | 'front' }> {
    if (target.mek && !target.prone) return Object.freeze({ table: standingMekTable });
    return Object.freeze(kind === 'death-from-above'
        ? { table: 'standard', arc: target.mek ? 'rear' : 'front' }
        : { table: 'standard' });
}

/**
 * Whether a target's partial cover (a building's) counts against a physical attack, with both 'Mechs at the same
 * level. Total Warfare applies it to every attack but a DFA, whose roll is not modified for terrain (pp. 102, 144);
 * Core never to a charge or to an attack on the punch table (p. 66). Core's exception is for tables with no leg
 * hits: a quad's punch table has them, which this does not tell apart.
 */
export function physicalAttackMeetsBuildingCover(ruleset: CBTRuleset, kind: PhysicalAttackKind | null, table: HitTable): boolean {
    return ruleset === 'core-2026' ? kind !== 'charge' && table !== 'punch' : kind !== 'death-from-above';
}

/**
 * Whether Depth 1 water around a standing target gives partial cover against a physical attack, as a building's
 * cover does (`physicalAttackMeetsBuildingCover`); Core gives none against a fully submerged 'Mech's attack (p. 66) or
 * a kick from legs in the water (p. 77).
 */
export function physicalAttackMeetsWaterCover(
    ruleset: CBTRuleset,
    kind: PhysicalAttackKind | null,
    table: HitTable,
    attackerWater: Readonly<{ partiallyUnderwater: boolean; submerged: boolean }>,
): boolean {
    if (!physicalAttackMeetsBuildingCover(ruleset, kind, table)) return false;
    if (ruleset !== 'core-2026') return true;
    if (attackerWater.submerged) return false;
    return table !== 'kick' || !attackerWater.partiallyUnderwater;
}

/**
 * Physical attack damage underwater: halved, rounding down (Core pp. 77, 127; BMM pp. 35, 65), and still at least
 * 1 point (Core p. 88).
 */
export function underwaterPhysicalDamage(damage: number): number {
    return Math.max(1, Math.floor(damage / 2));
}

/**
 * Charges and DFAs strike in 5-point groupings, as does a thrash against battle armor (TW pp. 148-151); every other
 * physical attack strikes as one. Against conventional infantry an attack strikes as one, its troopers eliminated
 * from its whole damage (`physicalAttackTroopersHit`, TW p. 217).
 */
export function physicalDamageGroupSize(
    kind: PhysicalAttackKind,
    damage: number,
    targetUnitType?: TnTargetUnitType,
): number {
    if (targetUnitType === 'infantry') return damage;
    return kind === 'charge' || kind === 'death-from-above' || (kind === 'thrash' && targetUnitType === 'battle-armor')
        ? 5 : damage;
}

/**
 * Targets a physical attack reaches only in the attacker's own hex: a thrash (which a swarmed 'Mech cannot make at
 * the infantry swarming it), a prone 'Mech's punch, and the infantry's anti-'Mech attacks.
 */
export type PhysicalAttackReach = 'infantry-in-hex' | 'unswarming-infantry-in-hex' | 'vehicle-in-hex'
    | 'legs-in-hex' | 'swarmable-in-hex' | 'swarmed-in-hex' | 'swarming-infantry';

export function infantryTarget(unitType: TnTargetUnitType | undefined): boolean {
    return unitType === 'infantry' || unitType === 'battle-armor';
}

/**
 * Why a physical attack cannot strike a target, or null: infantry cannot be charged (TW p. 148); a thrash strikes
 * only infantry in the 'Mech's hex, which must be clear or paved (no declared woods, water or building), and a prone
 * 'Mech punches only a vehicle there (TW p. 151).
 */
export function physicalTargetIssue(
    kind: PhysicalAttackKind | null | undefined,
    reach: PhysicalAttackReach | undefined,
    target: Readonly<{
        unitType?: TnTargetUnitType;
        distance: number;
        tnCalculator?: Pick<TnTargetNumberCalculatorState,
            'targetHexCover' | 'waterDepth' | 'buildingCover' | 'isAirborne' | 'swarmed' | 'swarming'>;
    }>,
): 'invalid' | 'out-of-range' | null {
    if (kind === 'charge' && infantryTarget(target.unitType)) return 'invalid';
    if (reach === undefined) return null;
    const hex = target.tnCalculator;
    // The infantry a 'Mech brushes off clings to it, wherever its distance is recorded.
    if (reach === 'swarming-infantry') return infantryTarget(target.unitType) && hex?.swarming === true ? null : 'invalid';
    const matches = (): boolean => {
        switch (reach) {
            case 'infantry-in-hex':
            case 'unswarming-infantry-in-hex':
                // TW p. 151: swarming infantry is dislodged by the anti-'Mech rules, never thrashed at. The one unit
                // that swarms a 'Mech shares its hex, so swarming infantry there is taken to be that unit.
                return infantryTarget(target.unitType) && !hex?.waterDepth && !hex?.buildingCover
                    && (hex?.targetHexCover === undefined || hex.targetHexCover === 'none')
                    && (reach === 'infantry-in-hex' || hex?.swarming !== true);
            case 'vehicle-in-hex':
                return target.unitType === 'vehicle';
            case 'legs-in-hex':
                return legAttackTarget(target.unitType);
            // A unit is swarmed by one unit at a time (TW p. 220).
            case 'swarmable-in-hex':
                return swarmTarget(target.unitType, hex?.isAirborne === true) && hex?.swarmed !== true;
            case 'swarmed-in-hex':
                return swarmTarget(target.unitType, hex?.isAirborne === true);
        }
        return false;
    };
    if (!matches()) return 'invalid';
    return target.distance === 0 ? null : 'out-of-range';
}

/**
 * What the target's type adds to a physical attack: kicks and DFAs take +3 against infantry and battle armor
 * (TW pp. 118, 147), and a swarm -2 against a vehicle (TW p. 220).
 */
export function physicalTargetModifier(
    kind: PhysicalAttackKind | null,
    unitType: TnTargetUnitType | undefined,
): Readonly<{ label: string; modifier: number }> | null {
    if ((kind === 'kick' || kind === 'mule-kick' || kind === 'death-from-above') && infantryTarget(unitType)) {
        return Object.freeze({ label: 'Infantry', modifier: 3 });
    }
    return kind === 'swarm' && (unitType === 'vehicle' || unitType === 'vtol-wige')
        ? Object.freeze({ label: 'Vehicle', modifier: SWARM_VEHICLE_MODIFIER })
        : null;
}

/** A vehicle kicked, stomped or punched in the attacker's own hex takes the hit on a random side (TW pp. 147, 151). */
export function physicalStrikesRandomSide(
    kind: PhysicalAttackKind,
    target: Readonly<{ unitType?: TnTargetUnitType; distance: number }>,
): boolean {
    return target.unitType === 'vehicle' && target.distance === 0
        && (kind === 'kick' || kind === 'mule-kick' || kind === 'punch');
}

/**
 * Conventional troopers a physical attack eliminates: its damage / 10, rounding up, twice that against mechanized
 * infantry; a thrash eliminates its damage (TW p. 217, which excludes thrashing).
 */
export function physicalAttackTroopersHit(kind: PhysicalAttackKind, damage: number, mechanized: boolean): number {
    // Infantry brushed off take a punch's full damage, as from an infantry attack (TW p. 221).
    if (kind === 'thrash' || kind === 'brush-off') return damage;
    return Math.ceil(damage / 10) * (mechanized ? 2 : 1);
}

/**
 * The comparative modifier of a charge or DFA: the attacker's Piloting minus the target's, taking 4 for an
 * immobile target (TW p.144; Core p.77).
 */
export function comparativePilotingModifier(attackerPiloting: number, targetPiloting: number, targetImmobile: boolean): number {
    return attackerPiloting - (targetImmobile ? 4 : targetPiloting);
}

/**
 * What a physical attack costs the attacker, all from the front: a successful charge 1 point per 10 tons of the
 * target on its standard table, a successful DFA 1 point per 5 of its own tons on the kick table, both in 5-point
 * groupings (TW pp.148-150; Core pp.78-80); a failed brush off the punch it meant for the infantry, on the punch
 * table (TW p. 222). A submerged charger takes its charge damage underwater, halved like the attack itself.
 */
export function physicalSelfDamage(
    kind: PhysicalAttackKind,
    hit: boolean,
    facts: Readonly<{ attackerTons: number; targetTons: number; attackDamage: number; attackerSubmerged: boolean }>,
): Readonly<{ damage: number; table: HitTable; groupSize: number }> | null {
    if (kind === 'brush-off' && !hit) {
        return Object.freeze({ damage: facts.attackDamage, table: 'punch', groupSize: Math.max(1, facts.attackDamage) });
    }
    if (!hit) return null;
    if (kind === 'charge') {
        const damage = Math.ceil(facts.targetTons / 10);
        return Object.freeze({
            damage: facts.attackerSubmerged ? underwaterPhysicalDamage(damage) : damage,
            table: 'standard',
            groupSize: 5,
        });
    }
    if (kind === 'death-from-above') {
        return Object.freeze({ damage: Math.ceil(facts.attackerTons / 5), table: 'kick', groupSize: 5 });
    }
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
        case 'made-thrash':
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
        case 'mule-kick':
            return hit ? result(checks(), checks('kicked')) : result(checks('missed-kick'));
        case 'push':
            return hit ? result(checks(), checks('pushed')) : result();
        case 'club':
            return hit ? result(checks(), checks('clubbed')) : result();
        case 'charge':
            return hit ? result(checks('made-charge'), checks('charged')) : result();
        // A thrash always hits; failing its roll deals falling damage as a failed attempt to stand (TW p. 151).
        case 'thrash':
            return result(checks('made-thrash'));
        case 'death-from-above':
            return hit
                ? result(checks('made-death-from-above'), checks('struck-by-death-from-above'))
                : result(checks(), checks(), true);
        default:
            return result();
    }
}
