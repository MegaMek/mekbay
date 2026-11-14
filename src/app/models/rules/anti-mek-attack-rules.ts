// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BattleArmorEntity } from '../entity/entities/infantry/battle-armor-entity';
import { resolveWeaponDamage, WeaponEquipment } from '../equipment.model';
import type { TnTargetUnitType } from '../target-number-calculator.model';

/**
 * Anti-'Mech attacks (TW pp. 220-223): infantry in a 'Mech's hex attack its legs or swarm it, resolved in the Weapon
 * Attack Phase on the unit's Anti-'Mech Skill. Core has no infantry, so both rulesets read Total Warfare.
 */

/**
 * The attacks an infantry unit declares: a leg attack, a swarm, and for a unit already swarming its damage and the
 * end of the swarm.
 */
export type AntiMekAttackKind = 'leg-attack' | 'swarm' | 'swarm-damage' | 'end-swarm';

const ANTI_MEK_ATTACK_KINDS: ReadonlySet<string> = new Set<AntiMekAttackKind>([
    'leg-attack', 'swarm', 'swarm-damage', 'end-swarm',
]);

export function isAntiMekAttack(kind: string | null | undefined): kind is AntiMekAttackKind {
    return kind != null && ANTI_MEK_ATTACK_KINDS.has(kind);
}

/** A leg attack's damage; each vibro-claw a trooper carries adds 1 (TW p. 220). */
export const LEG_ATTACK_DAMAGE = 4;

/** Vehicles are easier to climb than a moving 'Mech (TW p. 220). */
export const SWARM_VEHICLE_MODIFIER = -2;

/** Battle armor with magnetic claws swarms at -1 (TW p. 220). */
export const SWARM_MAGNETIC_CLAW_MODIFIER = -1;

/** A conventional platoon's swarm damage strikes in 2-point groupings (TW p. 223). */
export const PLATOON_SWARM_DAMAGE_GROUP = 2;

/** Magnetic claws make every roll to remove the battle armor 1 harder (TW p. 222). */
export const MAGNETIC_CLAW_SHAKE_OFF_MODIFIER = 1;

/** A jumping 'Mech's roll to shake infantry off (TW p. 222). */
export const SHAKE_OFF_JUMP_MODIFIER = 4;

/** A vehicle's erratic manoeuvres: +4 to the roll at the end of its movement, +2 on VTOL MP (TW p. 222). */
export function erraticManoeuvresModifier(vtol: boolean): number {
    return vtol ? 2 : 4;
}

/**
 * How swarming infantry came off the unit it swarmed: the 'Mech jumped or fell, a vehicle made erratic manoeuvres
 * (a VTOL or WiGE at its Elevation), or the 'Mech waded into Depth 2 or deeper water. Each carries the water depth of
 * the hex the infantry lands in.
 */
export type SwarmShakeOffCause =
    | Readonly<{ kind: 'jump'; jumpMp: number; waterDepth: number }>
    | Readonly<{ kind: 'fall'; waterDepth: number }>
    | Readonly<{ kind: 'erratic'; waterDepth: number; elevation?: number }>
    | Readonly<{ kind: 'deep-water'; waterDepth: number }>;

/**
 * What swarming infantry takes coming off: destroyed in Depth 1 or deeper water without UMU MP (and in the Depth 2
 * water a swarmed 'Mech wades into); one 2D6 hit off a falling 'Mech; off a jump or erratic manoeuvres, 1 point per
 * battle armor trooper for each Jump MP used (1 off a ground vehicle, 1 for each Elevation off a VTOL or WiGE), and a
 * conventional platoon one 3D6 hit (TW p. 222, errata v12.0 as MegaMek plays it). Infantry with Jump or VTOL movement
 * drops off a VTOL or WiGE unharmed. Null: the infantry is not harmed and holds on (UMU MP in deep water).
 */
export type SwarmShakeOffDamage =
    | Readonly<{ kind: 'destroyed' }>
    | Readonly<{ kind: 'none' }>
    | Readonly<{ kind: 'per-trooper'; damage: number }>
    | Readonly<{ kind: 'dice'; dice: 2 | 3 }>;

export function swarmShakeOffDamage(
    cause: SwarmShakeOffCause,
    swarmer: Readonly<{ battleArmor: boolean; umu: boolean; flies?: boolean }>,
): SwarmShakeOffDamage | null {
    if (cause.waterDepth >= 1 && !swarmer.umu) return Object.freeze({ kind: 'destroyed' });
    if (cause.kind === 'deep-water') return null;
    if (cause.kind === 'fall') return Object.freeze({ kind: 'dice', dice: 2 });
    const elevation = cause.kind === 'erratic' ? cause.elevation : undefined;
    if (elevation !== undefined && (swarmer.flies === true || elevation === 0)) return Object.freeze({ kind: 'none' });
    if (!swarmer.battleArmor) return Object.freeze({ kind: 'dice', dice: 3 });
    return Object.freeze({
        kind: 'per-trooper',
        damage: cause.kind === 'jump' ? Math.max(1, cause.jumpMp) : elevation ?? 1,
    });
}

/**
 * The to-hit modifier for the troopers still active, or null when too few remain to attack (Leg Attacks Table and
 * Swarm Attacks Table, TW p. 221).
 */
export function antiMekTrooperModifier(attack: 'leg-attack' | 'swarm', battleArmor: boolean, troopers: number): number | null {
    if (troopers <= 0) return null;
    if (attack === 'leg-attack') {
        if (battleArmor) return troopers >= 4 ? 0 : troopers === 3 ? 2 : troopers === 2 ? 5 : 7;
        return troopers >= 22 ? 0 : troopers >= 16 ? 2 : troopers >= 10 ? 5 : troopers >= 5 ? 7 : null;
    }
    if (battleArmor) return troopers >= 4 ? 2 : 5;
    return troopers >= 22 ? 2 : troopers >= 16 ? 5 : null;
}

/** Whether the unit type has legs to attack: a 'Mech; a target of no declared type is one. */
export function legAttackTarget(unitType: TnTargetUnitType | undefined): boolean {
    return unitType === undefined || unitType.startsWith('mek-');
}

/**
 * Whether the unit can be swarmed: a 'Mech or a vehicle, and a VTOL or WiGE only once landed; never a ProtoMech,
 * aerospace unit or infantry (TW p. 220).
 */
export function swarmTarget(unitType: TnTargetUnitType | undefined, airborne: boolean): boolean {
    return legAttackTarget(unitType) || unitType === 'vehicle' || (unitType === 'vtol-wige' && !airborne);
}

/** The vibro-claws a battle armor trooper carries, at most two: each adds 1 to leg and swarm damage. */
export function battleArmorVibroClaws(entity: BattleArmorEntity): number {
    return Math.min(2, entity.equipment().filter(mount => mount.equipment?.hasFlag('F_VIBROCLAW') === true).length);
}

/**
 * Battle armor's swarm damage, dealt to one location: the damage of its arm-mounted weapons other than missiles and
 * anti-personnel weapons, a squad weapon once per active trooper, plus 1 per vibro-claw (TW p. 223; MegaMek
 * BattleArmor.calculateSwarmDamage).
 */
export function battleArmorSwarmDamage(entity: BattleArmorEntity, troopers: number): number {
    const weapons = entity.equipment().reduce((total, mount) => {
        const weapon = mount.equipment;
        if (!(weapon instanceof WeaponEquipment) || weapon.hasFlag('F_MISSILE') || weapon.isInfantryWeapon()
            || mount.baMountLocation === 'Body') return total;
        const damage = resolveWeaponDamage(weapon, entity.getEquipmentRegistry()).values[0] ?? 0;
        return total + Math.max(0, damage) * (mount.location === 'Squad' ? troopers : 1);
    }, 0);
    return weapons + battleArmorVibroClaws(entity);
}

/**
 * Where swarm damage strikes a 'Mech: the 2D6 Swarm Attacks Hit Location Table, bipedal or four-legged (TW p. 222).
 * `rear` is a torso's rear armor.
 */
export function swarmHitLocation(quad: boolean, roll: number): Readonly<{ location: string; rear: boolean }> {
    const biped: Readonly<Record<number, readonly [string, boolean]>> = {
        2: ['HD', false], 3: ['CT', true], 4: ['RT', true], 5: ['RT', false], 6: ['RA', false], 7: ['CT', false],
        8: ['LA', false], 9: ['LT', false], 10: ['LT', true], 11: ['CT', true], 12: ['HD', false],
    };
    const fourLegged: Readonly<Record<number, readonly [string, boolean]>> = {
        2: ['HD', false], 3: ['RT', false], 4: ['CT', true], 5: ['RT', true], 6: ['RT', false], 7: ['CT', false],
        8: ['LT', false], 9: ['LT', true], 10: ['CT', true], 11: ['LT', false], 12: ['HD', false],
    };
    const cell = (quad ? fourLegged : biped)[roll];
    if (!cell) throw new RangeError(`Swarm hit-location roll ${roll} is not a 2D6 total`);
    return Object.freeze({ location: cell[0], rear: cell[1] });
}

/** Where a hit on a swarmed unit lands: on the unit, on the swarming infantry, or split between them. */
export interface SwarmedHitSplit {
    readonly carrier: number;
    readonly infantry: number;
    /** The battle armor trooper (from 1) the infantry's share strikes; absent for a platoon. */
    readonly trooper?: number;
}

/**
 * The hits on a swarmed unit (TW pp. 222-223): each hit that may strike the swarming infantry (`eligible`: a 'Mech's
 * torso, any location of a vehicle) does so on a 5 or 6 on 1D6. Battle armor (`troopers`: the points each trooper
 * still has, by trooper number) takes it on a random trooper still standing until that trooper is destroyed, and the
 * rest strikes the unit; a platoon (`troopers` null) takes the whole hit, marked off as from infantry.
 */
export function splitSwarmedHits(
    hits: readonly Readonly<{ damage: number; eligible: boolean }>[],
    troopers: ReadonlyMap<number, number> | null,
    rolls: Readonly<{ d6: () => number; pick: (count: number) => number }>,
): readonly SwarmedHitSplit[] {
    const standing = new Map(troopers ?? []);
    return Object.freeze(hits.map(({ damage, eligible }) => {
        if (!eligible || rolls.d6() < 5) return Object.freeze({ carrier: damage, infantry: 0 });
        if (troopers === null) return Object.freeze({ carrier: 0, infantry: damage });
        const alive = [...standing].filter(([, points]) => points > 0);
        if (alive.length === 0) return Object.freeze({ carrier: damage, infantry: 0 });
        const [trooper, points] = alive[rolls.pick(alive.length)]!;
        const infantry = Math.min(damage, points);
        standing.set(trooper, points - infantry);
        return Object.freeze({ carrier: damage - infantry, infantry, trooper });
    }));
}
