// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { clusterHits } from '../../utils/cluster-hit-table';
import { type AmmoEquipment, type WeaponDamage, WeaponEquipment } from '../equipment.model';
import { isHagEquipment } from '../hag-mode.model';
import { rapidFireAutocannonJamRoll, rapidFireAutocannonShotCount } from '../runtime/component-rapid-fire-autocannon';
import type { ComponentId } from '../entity/entity-identifiers';
import { isFusilladeLauncher } from '../entity/utils/weapon-damage-kernel';
import type { WeaponType } from '../weapon-types.model';
import type { ArmorSpecialAmmo } from './armor-damage-rules';
import type { CBTGameRules } from './game-rules';
import type { MekHitArc } from '../../utils/record-sheet-reference-table';
import type { TnTargetUnitType } from '../target-number-calculator.model';
import { physicalDamageGroupSize, type HitTable, type PhysicalAttackKind } from './physical-attack-rules';
import { isInfernoAmmo, platoonInfernoMissiles } from './inferno-rules';
import type { PlatoonAttackFacts } from './conventional-infantry-combat-rules';
import type { CBTRuleset } from '../cbt-ruleset.model';
import { FLAMER_HEAT_MODE } from '../flamer-mode.model';
import type { OptionalRules } from '../options.model';
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
    /** The Cluster Hits Table modifier the attack starts with, which the player may change (hostile ECM); 0 if absent. */
    readonly clusterModifier?: number;
    /** A laser with a working laser insulator, which a to-hit roll of 2 can damage (`LASER_INSULATOR_FAILURE_TARGET`). */
    readonly insulated?: true;
    /** A charged PPC that burns out on a natural 2 (TO:AUE p. 149). */
    readonly capacitorBurnoutOnTwo?: true;
    /** The table each group is read on: the punch and kick tables roll 1D6. */
    readonly table: HitTable;
    /** A physical attack, whose hit or miss also forces Piloting Skill Rolls. */
    readonly physical?: PhysicalAttackKind;
    /** The table column this attack strikes regardless of its direction (a DFA on a prone Mek or a vehicle). */
    readonly arc?: MekHitArc;
    /** The attack strikes a side rolled at random, one of the four alike (`physicalStrikesRandomSide`). */
    readonly randomSide?: true;
    /** Inferno missiles: each group is one missile whose effect the struck unit decides (TW pp. 141-142). */
    readonly inferno?: true;
    /** A platoon's damage when that many troopers hit, indexed by troopers hitting; replaces damage per hit. */
    readonly damageByHits?: readonly number[];
    /** A heat-causing weapon: its hit may deliver heat as well as, or instead of, damage. */
    readonly heatWeapon?: AttackHeatWeapon;
    /** A rifle: each hit loses 3 points where it strikes (`rifleHitDamage`). */
    readonly rifle?: true;
    /** Ammunition with a special effect on the armor struck (`resolveArmorDamage`). */
    readonly ammo?: ArmorSpecialAmmo;
    /** The size of the autocannon firing armor-piercing rounds (`armorPiercingCheckModifiers`). */
    readonly rackSize?: number;
    /** A hit also rolls on the Determining Critical Hits Table: a leg attack, battle armor's swarm damage. */
    readonly critical?: true;
    /**
     * An aimed shot: after a hit, a roll of `dice` dice decides whether the named location is struck
     * (`aimedShotStrikes`). `rerollLegs` when the target stands in partial cover: the shot takes no cover itself, and
     * a leg result of its hit-location roll is rerolled.
     */
    readonly aim?: Readonly<{ location: string; dice: 1 | 2; rerollLegs: boolean }>;
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
    optionalRules: OptionalRules,
    target: HeatWeaponTarget | null,
): AttackHeatWeapon | undefined {
    const weapon = heatWeaponOf(equipment);
    return weapon === null ? undefined : Object.freeze({
        weapon,
        mode: heatWeaponMode(weapon, ruleset, optionalRules, mode === FLAMER_HEAT_MODE),
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
    readonly randomSide?: boolean;
    readonly targetUnitType?: TnTargetUnitType;
    /** Damage points sharing one hit-location roll, where the attack's kind does not say. */
    readonly groupSize?: number;
    /** A hit also rolls on the Determining Critical Hits Table. */
    readonly critical?: boolean;
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
    /** The location an aimed shot names, and the dice of its roll (`aimedShotDice`). */
    readonly aim?: Readonly<{ location: string; dice: 1 | 2 }>;
    /** The laser has a working laser insulator. */
    readonly insulated?: boolean;
    readonly chargedPpc?: boolean;
    /** The weapon fires indirectly, as the target's calculator declares. */
    readonly indirect?: boolean;
    /**
     * Hostile ECM interferes: the attacker is jammed or the target is shielded by hostile ECM, either of which
     * nullifies Artemis (TW p. 134, Core p. 200).
     */
    readonly hostileEcm?: boolean;
}

export interface WeaponAttackOutcome {
    readonly hit: boolean;
    readonly capacitorBurnout?: true;
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
 * A Streak launcher, or an iATM fired directly, locks on: on a hit every missile strikes, and a missed lock fires
 * nothing and makes no heat (TW p. 138; IO:AE p. 60). An attack's lock-on also needs direct fire (`weaponAttackProfile`):
 * an iATM firing indirectly "resolves the attack like a standard LRM ... and must roll on the appropriate Cluster Hits
 * Table" (IO:AE p. 60), and "Streak LRMs may not be fired indirectly" (TO:AUE p. 139).
 * The Fusillade, the ProtoMek launcher that fires iATM munitions, does not: "Fusillade launchers lack the Streak-like
 * features ... will fire even if the attack roll fails, and must roll on the 3 column of the Cluster Hits Table"
 * (IO:AE p. 59).
 */
export function locksOnTarget(equipment: WeaponEquipment): boolean {
    return equipment.ammoType === 'SRM_STREAK' || equipment.ammoType === 'LRM_STREAK'
        || (equipment.ammoType === 'IATM' && !isFusilladeLauncher(equipment));
}

/**
 * The integral Artemis IV of an ATM, with any of its munitions, and of a Fusillade: "add +2 to the Cluster Hits Table
 * die roll for the weapon ... and may be jammed by enemy ECM" (TW p. 138; Core p. 186), and "unless hostile ECM
 * interferes" (IO:AE p. 59). An iATM needs none: fired directly it hits with every missile, and fired indirectly it
 * rolls as a standard LRM (IO:AE p. 60), which Artemis doesn't help (TW p. 130).
 */
const INTEGRAL_ARTEMIS_CLUSTER_MODIFIER = 2;

function hasIntegralArtemis(equipment: WeaponEquipment): boolean {
    return equipment.ammoType === 'ATM' || isFusilladeLauncher(equipment);
}

/** Special AC rounds (Core p.191) and short-range missile warheads (Core p.192, TO:AUE p.184). */
function armorSpecialAmmo(equipment: WeaponEquipment, ammo: AmmoEquipment | null): ArmorSpecialAmmo | null {
    if (ammo?.hasMunitionType('M_AX_HEAD')) return 'acid';
    if (ammo?.hasMunitionType('M_TANDEM_CHARGE')) return 'tandem-charge';
    return ammo?.hasMunitionType('M_ARMOR_PIERCING') && equipment.hasFlag('F_AC') ? 'armor-piercing' : null;
}

/**
 * Profiles a fired weapon from the exact damage the equipment table shows. Weapons without damage
 * (TAG, NARC pods, AMS) have no attack to resolve.
 */
export function weaponAttackProfile(facts: WeaponAttackFacts, rules: CBTGameRules): WeaponAttackProfile | null {
    const { equipment, mode, damage, ammo } = facts;
    const perHit = damage.values[0] ?? 0;
    const specialAmmo = armorSpecialAmmo(equipment, ammo);
    const clusterModifier = (specialAmmo === 'acid' ? rules.acidMissileClusterModifier : 0)
        + (hasIntegralArtemis(equipment) && facts.hostileEcm !== true ? INTEGRAL_ARTEMIS_CLUSTER_MODIFIER : 0);
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
            allHit: locksOnTarget(equipment) && facts.indirect !== true,
            groupSize: Math.max(damagePerHit, groupSize),
            ...(equipment.ammoType === 'RIFLE' ? { rifle: true as const } : {}),
            ...(specialAmmo === null ? {} : { ammo: specialAmmo }),
            ...(specialAmmo === 'armor-piercing' ? { rackSize: equipment.rackSize } : {}),
            ...(facts.insulated ? { insulated: true as const } : {}),
            ...(facts.chargedPpc && rules.id === 'total-warfare' ? { capacitorBurnoutOnTwo: true as const } : {}),
            ...(clusterModifier === 0 ? {} : { clusterModifier }),
        });
    // Each inferno missile that hits is its own group: one hit-location roll, no damage. Core p. 192 skips the roll, but
    // partial cover and heat-dissipating armor can depend on it (Xotl, Core Rulebook forum ruling, 19 Oct 2026).
    if (isInfernoAmmo(ammo)) {
        return Object.freeze({ ...profile(1, equipment.rackSize, 1), inferno: true as const });
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
    // An aimed shot meets no cover: its leg results are rerolled instead.
    const aimed = (attack: WeaponAttackProfile | null): WeaponAttackProfile | null =>
        attack === null || facts.aim === undefined ? attack : Object.freeze({
            ...attack,
            partialCover: false,
            aim: Object.freeze({ ...facts.aim, rerollLegs: facts.partialCover }),
        });
    // A heat weapon's hits are resolved by its heat rules; a plasma cannon has no Damage Value of its own.
    if (facts.heatWeapon) {
        return aimed(Object.freeze({ ...(standard() ?? profile(0, 1, 1)), heatWeapon: facts.heatWeapon }));
    }
    return aimed(standard());
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

/** A platoon's damage, and its heat, strike in groups of this many points (TW p. 215). */
export const PLATOON_DAMAGE_GROUP = 2;

/**
 * A platoon rolls the Cluster Hits Table on its troopers and deals the damage those troopers hitting deal, in
 * 2-point groups (TW p. 217; MegaMek InfantryWeaponHandler).
 */
export function platoonAttackProfile(facts: PlatoonAttackProfileFacts): WeaponAttackProfile {
    return Object.freeze({
        componentId: facts.componentId,
        name: facts.name,
        targetNumber: facts.targetNumber,
        damagePerHit: 2,
        projectiles: Math.max(1, facts.attack.troopers),
        allHit: false,
        groupSize: PLATOON_DAMAGE_GROUP,
        types: Object.freeze([...facts.types]),
        partialCover: facts.partialCover,
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
    // A platoon's heat-only attack still strikes in its 2-point groups, each rolling a location (TW p. 215).
    const heatOnlyGroups = profile.damageByHits === undefined ? [0] : damageGroups(hit.heat, groupSize).map(() => 0);
    const groups = hit.damage > 0 || hit.heat === 0 ? damageGroups(hit.damage, groupSize) : Object.freeze(heatOnlyGroups);
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
        groupSize: Math.max(1, facts.groupSize ?? physicalDamageGroupSize(facts.kind, damage, facts.targetUnitType)),
        types: Object.freeze([]),
        partialCover: facts.partialCover,
        jamRoll: null,
        table: facts.table,
        physical: facts.kind,
        ...(facts.arc === undefined ? {} : { arc: facts.arc }),
        ...(facts.randomSide ? { randomSide: true as const } : {}),
        ...(facts.critical ? { critical: true as const } : {}),
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
    clusterModifier = profile.clusterModifier ?? 0,
    heatDice: readonly number[] = MAXIMUM_HEAT_DICE,
): WeaponAttackOutcome {
    const jammed = profile.jamRoll !== null && toHit[0] + toHit[1] <= profile.jamRoll;
    if (profile.capacitorBurnoutOnTwo && toHit[0] + toHit[1] === 2) {
        return Object.freeze({ hit: false, capacitorBurnout: true, jammed, hits: 0, groups: [], heat: 0 });
    }
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
