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
}

export interface WeaponAttackOutcome {
    readonly hit: boolean;
    /** The rapid-fire weapon jammed; its shots still fire. */
    readonly jammed: boolean;
    /** Projectiles that hit; 0 on a miss. */
    readonly hits: number;
    /** Damage per hit-location roll, in roll order. */
    readonly groups: readonly number[];
}

/**
 * Profiles a fired weapon from the exact damage the equipment table shows. Weapons without damage
 * (TAG, NARC pods, AMS) have no attack to resolve.
 */
export function weaponAttackProfile(facts: WeaponAttackFacts, rules: CBTGameRules): WeaponAttackProfile | null {
    const { equipment, mode, damage, ammo } = facts;
    const perHit = damage.values[0] ?? 0;
    if (perHit <= 0) return null;
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
): WeaponAttackOutcome {
    const jammed = profile.jamRoll !== null && toHit[0] + toHit[1] <= profile.jamRoll;
    if (!toHitSucceeds(toHit, profile.targetNumber)) return Object.freeze({ hit: false, jammed, hits: 0, groups: [] });
    let hits = profile.projectiles;
    if (needsClusterRoll(profile)) {
        if (!cluster) throw new RangeError(`${profile.name} needs a Cluster Hits Table roll`);
        hits = clusterHits(Math.max(2, Math.min(12, cluster[0] + cluster[1] + clusterModifier)), profile.projectiles);
    }
    return Object.freeze({ hit: true, jammed, hits, groups: damageGroups(hits * profile.damagePerHit, profile.groupSize) });
}

/** Splits total damage into location groups of at most `groupSize` points. */
export function damageGroups(damage: number, groupSize: number): readonly number[] {
    const groups: number[] = [];
    for (let remaining = damage; remaining > 0; remaining -= groupSize) {
        groups.push(Math.min(groupSize, remaining));
    }
    return Object.freeze(groups);
}
