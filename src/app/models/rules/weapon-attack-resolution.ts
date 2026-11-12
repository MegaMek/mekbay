// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { clusterHits } from '../../utils/cluster-hit-table';
import { type AmmoEquipment, type WeaponDamage, WeaponEquipment } from '../equipment.model';
import { isHagEquipment } from '../hag-mode.model';
import { rapidFireAutocannonJamRoll, rapidFireAutocannonShotCount } from '../runtime/component-rapid-fire-autocannon';
import type { ComponentId } from '../entity/entity-identifiers';
import type { WeaponType } from '../weapon-types.model';
import type { CBTGameRules } from './game-rules';
import type { MekHitArc } from '../../utils/record-sheet-reference-table';
import { physicalDamageGroupSize, type HitTable, type PhysicalAttackKind } from './physical-attack-rules';
import { infernoMeetsCover, isInfernoAmmo, platoonInfernoMissiles } from './inferno-rules';
import type { PlatoonAttackFacts } from './conventional-infantry-combat-rules';
import type { CBTRuleset } from '../cbt-ruleset.model';
import { FLAMER_HEAT_MODE } from '../flamer-mode.model';
import {
    heatWeaponMode,
    heatWeaponOf,
    resolveHeatWeaponHit,
    type HeatWeapon,
    type HeatWeaponMode,
    type HeatWeaponTarget,
} from './heat-weapon-rules';

export type TwoDice = readonly [number, number];

/** One hit-location roll: 2D6 on the standard table, 1D6 on the punch and kick tables. */
export type HitLocationDice = TwoDice | readonly [number];

/**
 * How one attack turns a successful to-hit roll into hit-location groups (TW Cluster Hits Table): a fired
 * weapon, or a physical attack.
 */
export interface WeaponAttackProfile {
    /** The fired weapon; null for an intrinsic physical attack. */
    readonly componentId: ComponentId | null;
    readonly name: string;
    readonly targetNumber: number;
    readonly damagePerHit: number;
    /** Missiles, pellets or shots that may hit; 1 is a single hit. */
    readonly projectiles: number;
    /** Every projectile hits on a successful to-hit roll (Streak). */
    readonly allHit: boolean;
    /** Damage points sharing one hit-location roll. */
    readonly groupSize: number;
    /** Weapon damage types, for armors that resist them. */
    readonly types: readonly WeaponType[];
    /** The target stands in partial cover at this weapon's range: leg hits strike the cover. */
    readonly partialCover: boolean;
    /** The to-hit roll at or below which this rapid-fire attack jams the weapon. */
    readonly jamRoll: number | null;
    /** The table each group is read on: the punch and kick tables roll 1D6. */
    readonly table: HitTable;
    /** A physical attack, whose hit or miss also forces Piloting Skill Rolls. */
    readonly physical?: PhysicalAttackKind;
    /** The table column this attack strikes regardless of its direction (a DFA on a prone Mek or a vehicle). */
    readonly arc?: MekHitArc;
    /** Inferno missiles: each group is one missile whose effect the struck unit decides (TW pp. 141-142). */
    readonly inferno?: true;
    /** A platoon's damage when that many troopers hit, indexed by troopers hitting; replaces damage per hit. */
    readonly damageByHits?: readonly number[];
    /** A heat-causing weapon: its hit may deliver heat as well as, or instead of, damage. */
    readonly heatWeapon?: AttackHeatWeapon;
}

/** A heat-causing weapon as one attack resolves it, against the target it fires at. */
export interface AttackHeatWeapon {
    readonly weapon: HeatWeapon;
    readonly mode: HeatWeaponMode;
    readonly ruleset: CBTRuleset;
    readonly target: HeatWeaponTarget;
}

/** Without the struck unit at hand, a heat weapon is resolved as against a Mek. */
const UNKNOWN_HEAT_TARGET: HeatWeaponTarget = Object.freeze({ tracksHeat: true, fireResistant: false });

/** The highest roll of every heat die, for sizing an attack's hit-location rolls before the dice are known. */
const MAXIMUM_HEAT_DICE: readonly number[] = Object.freeze([6, 6, 6]);

/** The heat weapon a fired weapon or platoon attack is, with its declared mode and target. */
export function attackHeatWeapon(
    equipment: WeaponEquipment,
    mode: string | undefined,
    ruleset: CBTRuleset,
    enhancedFlamers: boolean,
    target: HeatWeaponTarget | null,
): AttackHeatWeapon | undefined {
    const weapon = heatWeaponOf(equipment);
    return weapon === null ? undefined : Object.freeze({
        weapon,
        mode: heatWeaponMode(weapon, ruleset, enhancedFlamers, mode === FLAMER_HEAT_MODE),
        ruleset,
        target: target ?? UNKNOWN_HEAT_TARGET,
    });
}

/** What the attacker knows about one declared physical attack and its target. */
export interface PhysicalAttackFacts {
    readonly name: string;
    readonly kind: PhysicalAttackKind;
    readonly damage: number;
    readonly targetNumber: number;
    readonly table: HitTable;
    readonly partialCover: boolean;
    readonly arc?: MekHitArc;
}

/** What the attacker knows about one fired weapon and its target. */
export interface WeaponAttackFacts {
    readonly componentId: ComponentId;
    readonly equipment: WeaponEquipment;
    readonly mode: string | undefined;
    readonly damage: WeaponDamage;
    readonly ammo: AmmoEquipment | null;
    readonly types: readonly WeaponType[];
    readonly name: string;
    readonly targetNumber: number;
    readonly partialCover: boolean;
    readonly heatWeapon?: AttackHeatWeapon;
}

export interface WeaponAttackOutcome {
    readonly hit: boolean;
    /** The rapid-fire weapon jammed; its shots still fire. */
    readonly jammed: boolean;
    /** Projectiles that hit; 0 on a miss. */
    readonly hits: number;
    /** Damage per hit-location roll, in roll order. */
    readonly groups: readonly number[];
    /** Outside heat a heat-causing weapon's hit applies to the target. */
    readonly heat: number;
}

/**
 * Profiles a fired weapon from the exact damage the equipment table shows. Weapons without damage
 * (TAG, NARC pods, AMS) have no attack to resolve.
 */
export function weaponAttackProfile(facts: WeaponAttackFacts, rules: CBTGameRules): WeaponAttackProfile | null {
    const { equipment, mode, damage, ammo } = facts;
    const perHit = damage.values[0] ?? 0;
    const profile = (damagePerHit: number, projectiles: number, groupSize: number, jamRoll: number | null = null) =>
        Object.freeze({
            componentId: facts.componentId,
            jamRoll,
            table: 'standard' as const,
            name: facts.name,
            targetNumber: facts.targetNumber,
            types: Object.freeze([...facts.types]),
            partialCover: facts.partialCover,
            damagePerHit,
            projectiles: Math.max(1, projectiles),
            allHit: equipment.ammoType === 'SRM_STREAK' || equipment.ammoType === 'LRM_STREAK',
            groupSize: Math.max(damagePerHit, groupSize),
        });
    // Each inferno missile that hits is its own group: one hit-location roll, no damage.
    if (isInfernoAmmo(ammo)) {
        return Object.freeze({
            ...profile(1, equipment.rackSize, 1),
            partialCover: facts.partialCover && infernoMeetsCover(rules.id),
            inferno: true as const,
        });
    }
    const standard = (): WeaponAttackProfile | null => {
        if (perHit <= 0) return null;
        if (damage.unit === 'missile') {
            return profile(perHit, equipment.rackSize, equipment.getClusterSize(ammo, null, rules));
        }
        if (isHagEquipment(equipment)) return profile(1, equipment.rackSize, equipment.getClusterSize(ammo, null, rules));
        // A machine gun array rolls the Cluster Hits Table on its linked guns; each gun strikes its own location.
        if (equipment.hasFlag('F_MGA')) return profile(perHit, Math.round(damage.maximum / perHit), perHit);
        if (equipment.ammoType === 'AC_LBX' && ammo?.hasMunitionType('M_CLUSTER')) {
            return profile(1, equipment.rackSize, 1);
        }
        const shots = rapidFireAutocannonShotCount(equipment, mode);
        return profile(perHit, shots, perHit, rapidFireAutocannonJamRoll(equipment, rules.id, shots));
    };
    // A heat weapon's hits are resolved by its heat rules; a plasma cannon has no Damage Value of its own.
    if (facts.heatWeapon) return Object.freeze({ ...(standard() ?? profile(0, 1, 1)), heatWeapon: facts.heatWeapon });
    return standard();
}

/** What the attacker knows about a conventional platoon's attack or disposable weapon and its target. */
export interface PlatoonAttackProfileFacts {
    readonly componentId: ComponentId;
    readonly name: string;
    readonly targetNumber: number;
    readonly types: readonly WeaponType[];
    readonly partialCover: boolean;
    readonly attack: PlatoonAttackFacts;
    /** Flamer platoons may declare heat in place of damage (TW p. 215, infantry table). */
    readonly heatWeapon?: AttackHeatWeapon;
}

/**
 * A platoon rolls the Cluster Hits Table on its troopers and deals the damage those troopers hitting deal, in
 * 2-point groups (TW p. 217; MegaMek InfantryWeaponHandler).
 */
export function platoonAttackProfile(facts: PlatoonAttackProfileFacts, rules: CBTGameRules): WeaponAttackProfile {
    return Object.freeze({
        componentId: facts.componentId,
        name: facts.name,
        targetNumber: facts.targetNumber,
        damagePerHit: 2,
        projectiles: Math.max(1, facts.attack.troopers),
        allHit: false,
        groupSize: 2,
        types: Object.freeze([...facts.types]),
        partialCover: facts.partialCover && (!facts.attack.inferno || infernoMeetsCover(rules.id)),
        jamRoll: null,
        table: 'standard',
        damageByHits: facts.attack.damageByTroopers,
        ...(facts.attack.inferno ? { inferno: true as const } : {}),
        ...(facts.heatWeapon === undefined ? {} : { heatWeapon: facts.heatWeapon }),
    });
}

/**
 * The location groups and outside heat `hits` projectiles deliver. A platoon reads its damage by troopers hitting,
 * and an SRM platoon firing infernos turns every 2 points of that damage into one missile (TW p. 142). A heat
 * weapon's hit divides into damage and heat by its rules, reading `heatDice`.
 */
export function attackEffect(
    profile: WeaponAttackProfile,
    hits: number,
    heatDice: readonly number[] = MAXIMUM_HEAT_DICE,
): Readonly<{ groups: readonly number[]; heat: number }> {
    const damage = profile.damageByHits === undefined
        ? hits * profile.damagePerHit
        : profile.damageByHits[Math.min(hits, profile.damageByHits.length - 1)] ?? 0;
    if (profile.inferno && profile.damageByHits !== undefined) {
        return Object.freeze({ groups: damageGroups(platoonInfernoMissiles(damage), 1), heat: 0 });
    }
    const heatWeapon = profile.heatWeapon;
    if (!heatWeapon || hits === 0) return Object.freeze({ groups: damageGroups(damage, profile.groupSize), heat: 0 });
    const hit = resolveHeatWeaponHit(heatWeapon.weapon, damage, heatWeapon.mode, heatWeapon.ruleset, heatWeapon.target, heatDice);
    // A platoon keeps its 2-point groups; a weapon groups its damage as its heat rules say. A hit that only heats
    // still rolls one location: heat striking partial cover is lost (TW p. 102).
    const groupSize = profile.damageByHits === undefined ? hit.groupSize : profile.groupSize;
    const groups = hit.damage > 0 || hit.heat === 0 ? damageGroups(hit.damage, groupSize) : Object.freeze([0]);
    return Object.freeze({ groups, heat: hit.heat });
}

/** The most location groups an attack can need: every projectile hits and every heat die rolls 6. */
export function attackGroups(profile: WeaponAttackProfile, hits: number): readonly number[] {
    return attackEffect(profile, hits).groups;
}

/** A physical attack strikes once; charges and DFAs split their damage into 5-point groupings. */
export function physicalAttackProfile(facts: PhysicalAttackFacts): WeaponAttackProfile {
    const damage = Math.max(0, facts.damage);
    return Object.freeze({
        componentId: null,
        name: facts.name,
        targetNumber: facts.targetNumber,
        damagePerHit: damage,
        projectiles: 1,
        allHit: false,
        groupSize: Math.max(1, physicalDamageGroupSize(facts.kind, damage)),
        types: Object.freeze([]),
        partialCover: facts.partialCover,
        jamRoll: null,
        table: facts.table,
        physical: facts.kind,
        ...(facts.arc === undefined ? {} : { arc: facts.arc }),
    });
}

/** Whether the attack needs a Cluster Hits Table roll after it hits. */
export function needsClusterRoll(profile: WeaponAttackProfile): boolean {
    return profile.projectiles > 1 && !profile.allHit;
}

/** An attack hits when its 2d6 to-hit roll reaches the target number. */
export function toHitSucceeds(toHit: TwoDice, targetNumber: number): boolean {
    return toHit[0] + toHit[1] >= targetNumber;
}

export function resolveWeaponAttack(
    profile: WeaponAttackProfile,
    toHit: TwoDice,
    cluster: TwoDice | null,
    clusterModifier = 0,
    heatDice: readonly number[] = MAXIMUM_HEAT_DICE,
): WeaponAttackOutcome {
    const jammed = profile.jamRoll !== null && toHit[0] + toHit[1] <= profile.jamRoll;
    if (!toHitSucceeds(toHit, profile.targetNumber)) return Object.freeze({ hit: false, jammed, hits: 0, groups: [], heat: 0 });
    let hits = profile.projectiles;
    if (needsClusterRoll(profile)) {
        if (!cluster) throw new RangeError(`${profile.name} needs a Cluster Hits Table roll`);
        hits = clusterHits(Math.max(2, Math.min(12, cluster[0] + cluster[1] + clusterModifier)), profile.projectiles);
    }
    const effect = attackEffect(profile, hits, heatDice);
    return Object.freeze({ hit: true, jammed, hits, groups: effect.groups, heat: effect.heat });
}

/** Splits total damage into location groups of at most `groupSize` points. */
export function damageGroups(damage: number, groupSize: number): readonly number[] {
    const groups: number[] = [];
    for (let remaining = damage; remaining > 0; remaining -= groupSize) {
        groups.push(Math.min(groupSize, remaining));
    }
    return Object.freeze(groups);
}
