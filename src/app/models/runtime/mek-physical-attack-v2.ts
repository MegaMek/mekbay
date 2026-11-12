// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId, LocationId } from '../entity/entity-identifiers';
import { groupAvailable, type MekLimbProfile, type MekMechanicsProfile } from './mek-mechanics-profile';
import {
    kickActuatorLegs,
    kickTalonLegs,
    kickTalonsIntact,
    selectMekKickingLeg,
    type MekKickKind,
} from './mek-kicking-leg';
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
            let baseDamage = shield !== undefined
                ? shield.absorption
                : vibroblade === null
                    ? resolvePhysicalWeaponDamageFromFlags(equipment.flags, profile.declaredMassTons)
                : vibrobladeActive
                    ? vibroblade.activeDamage
                    : Math.min(Math.ceil(profile.declaredMassTons / 10) + 1, vibroblade.activeDamage);
            const constructionBase = shield?.maximumAbsorption ?? baseDamage;
            if (isHandClawFlags(equipment.flags)) {
                baseDamage = halveForUnavailableActuators(
                    baseDamage,
                    profile.limbs.filter(limb => group.locationIds.includes(limb.locationId)),
                    facts,
                );
            }
            const ignoreMyomer = shield !== undefined || isFlailFlags(equipment.flags) || vibrobladeActive;
            const effect: MekPhysicalAttackEffectV2 = coreShield
                ? shield.operational
                    ? Object.freeze({
                        kind: 'modifier',
                        modifier: shield.bashBonus,
                        weakened: false,
                    })
                    : Object.freeze({ kind: 'none' })
                : damageEffect(
                    baseDamage,
                    constructionBase,
                    standardTsmInstalled && !ignoreMyomer,
                    functionalTsm && !ignoreMyomer,
                    tsmActive && !ignoreMyomer,
                    vibroblade !== null && !vibrobladeActive ? vibroblade.activeDamage : undefined,
                );
            const locationCodes = group.locationIds.map(locationId =>
                requireLocation(index, locationId).code);
            attacks.push(Object.freeze({
                target: Object.freeze({ kind: 'component' as const, componentId: group.componentId }),
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

        const kickingLegs = new Map((['kick', 'mule-kick'] as const).map(kind =>
            [kind, selectMekKickingLeg(profile, index, facts, kind)]));
        for (const action of index.intrinsicActions) {
            const locationIds = action.locations.map(code => requireLocationId(index, code));
            const kickingLeg = isKick(action.kind) ? kickingLegs.get(action.kind) ?? null : null;
            // A mule kick uses both rear legs; only a front kick names its leg.
            const kickingLegCode = action.kind !== 'kick' || kickingLeg === null
                ? undefined : index.locations.get(kickingLeg.locationId)?.code;
            const effect = intrinsicEffect(
                action,
                profile,
                index,
                facts,
                standardTsmInstalled,
                functionalTsm,
                tsmActive,
                shields,
                kickingLeg,
            );
            attacks.push(Object.freeze({
                target: Object.freeze({ kind: 'intrinsic' as const, actionId: action.id }),
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
    let baseDamage = currentFixedDamage(action, profile, index, facts);
    let talons = false;
    if (action.kind === 'punch') {
        const location = action.locations[0];
        if (profile.rulesFlavor === 'core-2026') {
            baseDamage += shields.find(shield =>
                shield.locationCode === location && shield.operational)?.bashBonus ?? 0;
        }
        baseDamage = halveForUnavailableActuators(
            baseDamage,
            profile.limbs.filter(limb => locationCode(index, limb.locationId) === location),
            facts,
        );
    } else if (isKick(action.kind)) {
        baseDamage = halveForUnavailableActuators(
            baseDamage,
            kickActuatorLegs(profile, index, action.kind, kickingLeg),
            facts,
        );
        talons = kickTalonsIntact(profile, index, facts, kickTalonLegs(profile, index, action.kind, kickingLeg)) === true;
    }
    const supportsTsm = action.damage.boostedValue !== undefined;
    return damageEffect(
        baseDamage,
        constructionBase,
        supportsTsm && standardTsmInstalled,
        supportsTsm && functionalTsm,
        supportsTsm && tsmActive,
        undefined,
        talons,
    );
}

/**
 * The damage before actuator and myomer effects. A kick starts from 1 point per 5 tons, its talons applied last
 * (Core p. 81; MegaMek KickAttackAction); a death from above lands on every leg's talons.
 */
function currentFixedDamage(
    action: IntrinsicWeapon,
    profile: MekMechanicsProfile,
    index: MekRuntimeIndex,
    facts: MekPhysicalAttackRuntimeFactsV2,
): number {
    if (action.damage.kind !== 'fixed') throw new Error('Expected fixed physical damage');
    if (isKick(action.kind)) return Math.ceil(profile.declaredMassTons / 5);
    if (action.kind !== 'death-from-above' || kickTalonsIntact(profile, index, facts, null) !== false) {
        return action.damage.value;
    }
    return Math.ceil(profile.declaredMassTons / 10 * 3);
}

function isKick(kind: IntrinsicWeapon['kind']): kind is MekKickKind {
    return kind === 'kick' || kind === 'mule-kick';
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

function halveForUnavailableActuators(
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
        damage = Math.max(1, Math.floor(damage / 2));
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
    talons = false,
): MekPhysicalAttackEffectV2 {
    // Talons multiply a kick after its actuators and myomer, rounding normally (Core p. 81; BMM p. 109).
    const talon = (value: number) => talons ? Math.round(value * 1.5) : value;
    const maximumDamage = talon(tsmFunctional ? baseDamage * 2 : baseDamage);
    const damage = tsmActive ? maximumDamage : talon(baseDamage);
    const base = talon(baseDamage);
    return Object.freeze({
        kind: 'damage',
        damage,
        maximumDamage,
        baseDamage: base,
        weakened: base < constructionBase || (tsmInstalled && !tsmFunctional),
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
