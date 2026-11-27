// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { ComponentId, LocationId } from '../entity/entity-identifiers';
import type { UnitWaterState } from '../unit-cover.model';
import { groupAvailable, type MekLimbProfile, type MekMechanicsProfile } from './mek-mechanics-profile';
import {
    kickActuatorLegs,
    kickTalonLegs,
    kickTalonsIntact,
    isMekKick,
    selectMekKickingLegs,
} from './mek-kicking-leg';
import { mekPunchBaseDamage, mekPunchDamage } from '../entity/utils/mek-intrinsic-actions';
import {
    isFlailFlags,
    isHandClawFlags,
    physicalEquipmentOperatingHeatFromFlags,
    resolvePhysicalWeaponDamageFromFlags,
} from '../entity/utils/physical-weapon-kernel';
import {
    isShieldEquipment,
    isSpotWelderEquipment,
} from '../entity/utils/physical-weapon';
import type { IntrinsicWeapon } from '../entity/types/weapon';
import { intrinsicActionBaseDamageText } from '../entity/utils/mek-intrinsic-actions';
import { getVibrobladeProfileFromFlags } from '../rules/vibroblade-rules';
import { VIBROBLADE_ON_MODE } from '../vibroblade-mode.model';
import type { AttackerActionSelection, AttackerActionTarget } from './attacker-targeting-state';
import type { MekMovementModeV2 } from './mek-movement-psr-v2';
import { calculateChargeDamage } from '../rules/charge-damage';
import { underwaterPhysicalDamage } from '../rules/physical-attack-rules';
import {
    mountedEquipmentForComponent,
    type MekRuntimeIndex,
    type MekIndexedLocation,
} from './mek-runtime-index';
import {
    projectMekShieldsV2,
    type MekShieldRuntimeFactsV2,
} from './mek-shield-rules';

export interface MekPhysicalAttackRuntimeFactsV2 extends MekShieldRuntimeFactsV2 {
    readonly currentHeat: number;
    readonly movementMode: MekMovementModeV2 | null;
    readonly movementDistance: number;
    /** Where the water stands on the 'Mek: its legs in Depth 1 standing, all of it when submerged. */
    readonly water: UnitWaterState;
    /** A LAM flying in AirMech mode, which used AirMech MP this turn. */
    readonly airborneAirMek: boolean;
    componentAvailable(componentId: ComponentId): boolean;
    componentMode(componentId: ComponentId): string | undefined;
    criticalSlotDestroyedTurn(
        slotId: import('../entity/entity-identifiers').CriticalSlotId,
    ): number | undefined;
    criticalSlotUnavailable(slotId: import('../entity/entity-identifiers').CriticalSlotId): boolean;
    locationDestroyed(locationId: LocationId): boolean;
    componentAvailableAt(componentId: ComponentId, locationId: LocationId): boolean;
    /** Whether a weapon mounted in the location fired this turn. */
    weaponFiredAt(locationId: LocationId): boolean;
}

export type MekPhysicalAttackEffectV2 =
    | { readonly kind: 'none' }
    | {
        /** Passive Core shield bonus applied to the matching punch. */
        readonly kind: 'modifier';
        readonly modifier: number;
        readonly weakened: boolean;
    }
    | {
        readonly kind: 'damage';
        /** Damage after committed actuator/equipment state and active TSM. */
        readonly damage: number;
        /** Rules-owned comparison maximum (for example active TSM or maximum charge movement). */
        readonly maximumDamage: number;
        /** Current damage before an equipment bonus or active TSM is added. */
        readonly baseDamage: number;
        readonly weakened: boolean;
        readonly boosted: boolean;
        readonly movementDistance?: number;
        /** Rules-owned text shown until Walk or Run movement is selected. */
        readonly displayFormula?: string;
        /** Damage of a meaningful alternate equipment mode, such as an active Vibroblade. */
        readonly alternateDamage?: number;
    };

export interface MekPhysicalAttackProjectionRowV2 {
    readonly target: AttackerActionTarget;
    /** The attack's printed name, as the record sheet lists it. */
    readonly name: string;
    /** The name with the leg a kick uses, as the equipment panel shows it. */
    readonly label: string;
    readonly locationIds: readonly LocationId[];
    readonly locationCodes: readonly string[];
    readonly effect: MekPhysicalAttackEffectV2;
    /** Heat generated each time this physical equipment is used. */
    readonly firingHeat: number;
    /** False for passive Core shield rows that are displayed but cannot attack independently. */
    readonly selectable: boolean;
    /** Sparse runtime targeting overlay; absent means not selected. */
    readonly selection?: AttackerActionSelection;
    /** Current committed action availability when projected for presentation. */
    readonly available?: boolean;
}

export type MekPhysicalAttackProjectionResultV2 =
    | {
        readonly kind: 'supported';
        readonly attacks: readonly MekPhysicalAttackProjectionRowV2[];
    }
    | {
        readonly kind: 'unsupported';
        readonly blockers: readonly string[];
    };

/**
 * Pure physical-effect authority. Construction facts come only from the
 * immutable entity profile and mutable facts only from the committed
 * runtime callbacks. SVG rows and UnitSummary are not representable inputs.
 */
export function projectMekPhysicalAttacksV2(
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
    facts: MekPhysicalAttackRuntimeFactsV2,
): MekPhysicalAttackProjectionResultV2 {
    if (!Number.isFinite(facts.currentHeat)
        || !Number.isFinite(facts.movementDistance)
        || facts.movementDistance < 0) {
        return unsupported('Physical-attack runtime facts are invalid');
    }

    try {
        const standardTsmInstalled = profile.tripleStrengthMyomer.some(group => group.kind === 'standard');
        const functionalTsm = profile.tripleStrengthMyomer.some(group =>
            group.kind === 'standard' && groupAvailable(group, facts));
        const tsmActive = functionalTsm && facts.currentHeat >= 9;
        const attacks: MekPhysicalAttackProjectionRowV2[] = [];
        const shields = projectMekShieldsV2(profile, facts);

        const seenComponents = new Set<ComponentId>();
        for (const group of profile.physicalWeapons) {
            if (seenComponents.has(group.componentId)) continue;
            seenComponents.add(group.componentId);
            const mount = mountedEquipmentForComponent(index, group.componentId);
            const equipment = mount?.equipment;
            if (!mount || !equipment) {
                return unsupported(`Physical weapon ${group.componentId} has no equipment`);
            }
            const mode = facts.componentMode(group.componentId);
            const vibroblade = getVibrobladeProfileFromFlags(equipment.flags);
            const vibrobladeActive = vibroblade !== null && mode === VIBROBLADE_ON_MODE;
            const shield = isShieldEquipment(equipment)
                ? shields.find(candidate => candidate.componentId === group.componentId)
                : undefined;
            const coreShield = shield !== undefined && profile.rulesFlavor === 'core-2026';
            const baseDamage = shield !== undefined
                ? shield.absorption
                : vibroblade === null
                    ? resolvePhysicalWeaponDamageFromFlags(equipment.flags, profile.declaredMassTons)
                : vibrobladeActive
                    ? vibroblade.activeDamage
                    : Math.min(Math.ceil(profile.declaredMassTons / 10) + 1, vibroblade.activeDamage);
            const constructionBase = shield?.maximumAbsorption ?? baseDamage;
            const actuatorEffects = isHandClawFlags(equipment.flags)
                ? (value: number) => halveForUnavailableActuators(
                    profile.rulesFlavor,
                    value,
                    profile.limbs.filter(limb => group.locationIds.includes(limb.locationId)),
                    facts,
                )
                : undefined;
            const ignoreMyomer = shield !== undefined || isFlailFlags(equipment.flags) || vibrobladeActive;
            const effect: MekPhysicalAttackEffectV2 = coreShield
                ? shield.operational
                    ? Object.freeze({
                        kind: 'modifier',
                        modifier: shield.bashBonus,
                        weakened: false,
                    })
                    : Object.freeze({ kind: 'none' })
                : halvedForAirMek(halvedUnderwater(profile.rulesFlavor, damageEffect(
                    baseDamage,
                    constructionBase,
                    standardTsmInstalled && !ignoreMyomer,
                    functionalTsm && !ignoreMyomer,
                    tsmActive && !ignoreMyomer,
                    vibroblade !== null && !vibrobladeActive ? vibroblade.activeDamage : undefined,
                    actuatorEffects,
                ), attacksUnderwater(facts, legsOnly(profile, group.locationIds))), facts.airborneAirMek);
            const locationCodes = group.locationIds.map(locationId =>
                requireLocation(index, locationId).code);
            attacks.push(Object.freeze({
                target: Object.freeze({ kind: 'component' as const, componentId: group.componentId }),
                name: mount.displayName(),
                label: mount.displayName(),
                locationIds: Object.freeze([...group.locationIds]),
                locationCodes: Object.freeze(locationCodes),
                effect,
                firingHeat: isSpotWelderEquipment(equipment)
                    ? physicalEquipmentOperatingHeatFromFlags(equipment.flags)
                    : 0,
                selectable: !coreShield,
            }));
        }

        const kickingLegs = selectMekKickingLegs(profile, index, facts);
        for (const action of index.intrinsicActions) {
            const locationIds = action.locations.map(code => requireLocationId(index, code));
            const kickingLeg = isMekKick(action.kind) ? kickingLegs.get(action.kind) ?? null : null;
            // A mule kick uses both rear legs; only a front kick names its leg.
            const kickingLegCode = action.kind !== 'kick' || kickingLeg === null
                ? undefined : index.locations.get(kickingLeg.locationId)?.code;
            // A death from above starts above the water, so only a submerged 'Mech could make one and it cannot.
            const effect = halvedForAirMek(halvedUnderwater(profile.rulesFlavor, intrinsicEffect(
                action,
                profile,
                index,
                facts,
                standardTsmInstalled,
                functionalTsm,
                tsmActive,
                shields,
                kickingLeg,
            ), action.kind !== 'death-from-above'
                && attacksUnderwater(facts, isMekKick(action.kind) || legsOnly(profile, locationIds))),
            facts.airborneAirMek && (isMekKick(action.kind) || action.kind === 'punch' || action.kind === 'brush-off'));
            attacks.push(Object.freeze({
                target: Object.freeze({ kind: 'intrinsic' as const, actionId: action.id }),
                name: action.name,
                label: kickingLegCode !== undefined
                    ? `${action.name} (${kickingLegCode})`
                    : action.name,
                locationIds: Object.freeze(locationIds),
                locationCodes: Object.freeze([...action.locations]),
                effect,
                firingHeat: 0,
                selectable: true,
            }));
        }

        return Object.freeze({ kind: 'supported', attacks: Object.freeze(attacks) });
    } catch (error) {
        return unsupported(error instanceof Error ? error.message : 'Physical-attack projection failed');
    }
}

function intrinsicEffect(
    action: IntrinsicWeapon,
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
    facts: MekPhysicalAttackRuntimeFactsV2,
    standardTsmInstalled: boolean,
    functionalTsm: boolean,
    tsmActive: boolean,
    shields: readonly import('./mek-shield-rules').MekShieldProjectionV2[],
    kickingLeg: MekLimbProfile | null,
): MekPhysicalAttackEffectV2 {
    if (action.damage.kind === 'none') return Object.freeze({ kind: 'none' });
    if (action.damage.kind === 'per-hex') {
        if (action.kind === 'charge') return chargeEffect(profile, facts);
        const damage = action.damage.coefficient * facts.movementDistance + action.damage.bonus;
        return Object.freeze({
            kind: 'damage',
            damage,
            maximumDamage: damage,
            baseDamage: damage,
            weakened: false,
            boosted: false,
            movementDistance: facts.movementDistance,
            // Until the unit has moved, its damage is the per-hex rate the sheet prints.
            ...(facts.movementDistance > 0 ? {} : { displayFormula: intrinsicActionBaseDamageText(action) }),
        });
    }

    const constructionBase = action.damage.value;
    let baseDamage = currentFixedDamage(action, profile, index, facts, kickingLeg);
    let limbs: readonly MekLimbProfile[] = [];
    let lowerArmActuator = true;
    // A failed brush off deals the punch from that arm to the 'Mech itself; a successful one deals it to the infantry.
    const punch = action.kind === 'punch' || action.kind === 'brush-off';
    if (punch) {
        const location = action.locations[0];
        limbs = profile.limbs.filter(limb => locationCode(index, limb.locationId) === location);
        lowerArmActuator = limbs.some(limb => limb.actuators.some(actuator => actuator.kind === 'lower-arm'));
        // The sheet prints the punch with a missing actuator already halved; play halves it after TSM instead.
        baseDamage = mekPunchBaseDamage(profile.declaredMassTons);
        if (profile.rulesFlavor === 'core-2026') {
            baseDamage += shields.find(shield =>
                shield.locationCode === location && shield.operational)?.bashBonus ?? 0;
        }
    } else if (isMekKick(action.kind)) {
        limbs = kickActuatorLegs(profile, index, action.kind, kickingLeg);
    }
    const supportsTsm = action.damage.boostedValue !== undefined;
    return damageEffect(
        baseDamage,
        constructionBase,
        supportsTsm && standardTsmInstalled,
        supportsTsm && functionalTsm,
        supportsTsm && tsmActive,
        undefined,
        value => halveForUnavailableActuators(
            profile.rulesFlavor, punch ? mekPunchDamage(value, lowerArmActuator) : value, limbs, facts),
    );
}

/**
 * The base damage with intact talons, before TSM and destroyed actuators act on it: what adds to the base comes
 * first, talons then TSM, and actuator damage last (Core p. 88; ruling from the BattleTech game design team, whereas
 * MegaMek KickAttackAction applies the talons after actuators and TSM). A kick counts the talons of the legs it uses;
 * a death from above lands on every leg's.
 */
function currentFixedDamage(
    action: IntrinsicWeapon,
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
    facts: MekPhysicalAttackRuntimeFactsV2,
    kickingLeg: MekLimbProfile | null,
): number {
    if (action.damage.kind !== 'fixed') throw new Error('Expected fixed physical damage');
    if (!isMekKick(action.kind) && action.kind !== 'death-from-above') return action.damage.value;
    const talonLegs = isMekKick(action.kind) ? kickTalonLegs(profile, index, action.kind, kickingLeg) : null;
    if (kickTalonsIntact(profile, index, facts, talonLegs) !== false) return action.damage.value;
    return isMekKick(action.kind)
        ? Math.ceil(profile.declaredMassTons / 5)
        : Math.ceil(profile.declaredMassTons / 10 * 3);
}

function chargeEffect(
    profile: MekMechanicsProfile,
    facts: MekPhysicalAttackRuntimeFactsV2,
): MekPhysicalAttackEffectV2 {
    const hasRamPlate = profile.ramPlates.length > 0;
    const hasWorkingRamPlate = profile.ramPlates.some(group => groupAvailable(group, facts));
    const maximumBonus = profile.spikes.length * 2;
    const currentBonus = profile.spikes.filter(group => groupStructurallyAvailable(group, facts)).length * 2;
    const projection = calculateChargeDamage({
        ruleset: profile.rulesFlavor,
        massTons: profile.declaredMassTons,
        movementMode: facts.movementMode,
        movementDistance: facts.movementDistance,
        maximumDistance: profile.movement.baseRunMp,
        hasRamPlate,
        hasWorkingRamPlate,
        bonusDamage: currentBonus,
        maximumBonusDamage: maximumBonus,
    });
    return Object.freeze({
        kind: 'damage',
        ...projection,
        boosted: false,
        movementDistance: facts.movementDistance,
    });
}

/** Whether an attack happens underwater: legs stand in Depth 1 water, and everything is when the 'Mech is submerged. */
function attacksUnderwater(facts: MekPhysicalAttackRuntimeFactsV2, withLegs: boolean): boolean {
    return facts.water.submerged || (withLegs && facts.water.partiallyUnderwater);
}

function legsOnly(profile: MekMechanicsProfile, locationIds: readonly LocationId[]): boolean {
    return locationIds.length > 0 && locationIds.every(locationId =>
        profile.limbs.some(limb => limb.kind === 'leg' && limb.locationId === locationId));
}

/** A physical attack made underwater deals `underwaterPhysicalDamage`. */
export function halvedUnderwater(
    ruleset: CBTRuleset,
    effect: MekPhysicalAttackEffectV2,
    underwater: boolean,
): MekPhysicalAttackEffectV2 {
    return underwater ? halvedEffect(effect, damage => underwaterPhysicalDamage(ruleset, damage)) : effect;
}

/** A flying AirMech's kicks, punches and melee weapon attacks deal half damage, rounding up (IO:AE p. 106). */
function halvedForAirMek(effect: MekPhysicalAttackEffectV2, airborneAirMek: boolean): MekPhysicalAttackEffectV2 {
    return airborneAirMek ? halvedEffect(effect, value => Math.ceil(value / 2)) : effect;
}

function halvedEffect(effect: MekPhysicalAttackEffectV2, halve: (damage: number) => number): MekPhysicalAttackEffectV2 {
    if (effect.kind !== 'damage' || effect.displayFormula !== undefined) return effect;
    return Object.freeze({
        ...effect,
        damage: halve(effect.damage),
        maximumDamage: halve(effect.maximumDamage),
        baseDamage: halve(effect.baseDamage),
        weakened: true,
        ...(effect.alternateDamage === undefined ? {} : { alternateDamage: halve(effect.alternateDamage) }),
    });
}

/** Spikes remain effective while flooded; only direct/critical/structural loss removes them. */
function groupStructurallyAvailable(
    group: {
        readonly componentId: ComponentId;
        readonly criticalSlotIds: readonly import('../entity/entity-identifiers').CriticalSlotId[];
        readonly locationIds: readonly LocationId[];
    },
    facts: MekPhysicalAttackRuntimeFactsV2,
): boolean {
    return !facts.componentDestroyed(group.componentId)
        && group.criticalSlotIds.every(slotId => facts.criticalSlotDestroyedTurn(slotId) === undefined)
        && group.locationIds.every(locationId => !facts.locationDestroyed(locationId));
}

/**
 * Each destroyed arm or leg actuator halves the damage, rounding down. An arm's attack keeps at least 1 point (TW
 * p. 145; BMM p. 40), as does every attack under Core (p. 88); a Total Warfare kick can fall to 0 (BMM p. 49).
 */
function halveForUnavailableActuators(
    ruleset: CBTRuleset,
    value: number,
    limbs: readonly MekMechanicsProfile['limbs'][number][],
    facts: MekPhysicalAttackRuntimeFactsV2,
): number {
    let damage = value;
    const relevant = limbs.flatMap(limb => limb.actuators.filter(actuator =>
        actuator.kind === 'upper-arm'
        || actuator.kind === 'lower-arm'
        || actuator.kind === 'upper-leg'
        || actuator.kind === 'lower-leg'));
    for (const actuator of relevant) {
        if (groupAvailable(actuator, facts)) continue;
        const minimum = ruleset === 'core-2026' || actuator.kind === 'upper-arm' || actuator.kind === 'lower-arm' ? 1 : 0;
        damage = Math.max(minimum, Math.floor(damage / 2));
    }
    return damage;
}

function damageEffect(
    baseDamage: number,
    constructionBase: number,
    tsmInstalled: boolean,
    tsmFunctional: boolean,
    tsmActive: boolean,
    alternateDamage?: number,
    actuatorEffects: (value: number) => number = value => value,
): MekPhysicalAttackEffectV2 {
    // TSM adds to the base damage, so it doubles before destroyed actuators halve it (Core p. 88).
    const normalDamage = actuatorEffects(baseDamage);
    const maximumDamage = tsmFunctional ? actuatorEffects(baseDamage * 2) : normalDamage;
    const damage = tsmActive ? maximumDamage : normalDamage;
    return Object.freeze({
        kind: 'damage',
        damage,
        maximumDamage,
        baseDamage: normalDamage,
        weakened: normalDamage < constructionBase || (tsmInstalled && !tsmFunctional),
        boosted: tsmActive,
        ...(alternateDamage === undefined ? {} : { alternateDamage }),
    });
}

function requireLocationId(index: MekRuntimeIndex, code: string): LocationId {
    const matches = [...index.locations.values()].filter(location => location.code === code);
    if (matches.length !== 1) throw new Error(`Physical action location ${code} is not unique`);
    return matches[0].id;
}

function requireLocation(
    index: MekRuntimeIndex,
    locationId: LocationId,
): MekIndexedLocation {
    const location = index.locations.get(locationId);
    if (!location) throw new Error(`Unknown physical action location ${locationId}`);
    return location;
}

function locationCode(index: MekRuntimeIndex, locationId: LocationId): string {
    return requireLocation(index, locationId).code;
}

function unsupported(message: string): Extract<MekPhysicalAttackProjectionResultV2, { readonly kind: 'unsupported' }> {
    return Object.freeze({ kind: 'unsupported', blockers: Object.freeze([message]) });
}
