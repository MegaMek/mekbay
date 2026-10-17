// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { ComponentId } from '../entity/entity-identifiers';
import { ImmutableIndex } from '../entity/immutable-collections';
import {
    AmmoEquipment,
    WeaponEquipment,
    type AmmoType,
    type Equipment,
} from '../equipment.model';
import { isBombEquipment } from '../aerospace-support-equipment.model';
import { isDirectFireEquipment } from '../entity/utils/targeting-computer';
import { isBombastLaserEquipment } from '../bombast-laser-mode.model';
import type { TnTargetNumberCalculatorState, TnTargetUnitType } from '../target-number-calculator.model';
import {
    resolveTnTargetWaterState,
    stealthDisallowsSecondaryTarget,
} from '../target-number-calculator.model';
import { gameRulesFor, type TargetAttackTraits } from '../rules/game-rules';
import type { WeaponType } from '../weapon-types.model';
import {
    freezeAttackerTargetingState,
    type AttackerAmmoSelection,
    type AttackerLocalTargetState,
    type AttackerTargetingEdit,
    type AttackerTargetingState,
} from './attacker-targeting-state';
import type { EncounterTargetId, TargetRegistrySnapshot } from './encounter-runtime';

export const TARGET_INDIRECT_WEAPON_REASON = 'Requires an indirect-fire weapon';
export const TARGET_INDIRECT_AMMO_REASON = 'Selected ammunition cannot fire indirectly at this target';
export const TARGET_WATER_LAYER_REASON = 'Weapon and target are in different water layers';
export const TARGET_TAG_INFANTRY_REASON = 'TAG cannot designate infantry';
export const TARGET_NARC_INFANTRY_REASON = 'NARC beacons cannot target infantry';
export const TARGET_NARC_BUILDING_REASON = 'NARC beacons cannot be fired into buildings';
export const TARGET_BOMBAST_SECONDARY_REASON = 'Bombast Lasers cannot fire at secondary targets';
export const TARGET_THUNDER_TERRAIN_REASON = 'Thunder missiles can only target terrain';
export const TARGET_STEALTH_SECONDARY_REASON = 'Active stealth armor cannot be attacked as a secondary target';

/**
 * Family-neutral inputs for one attacking weapon. Each runtime family resolves
 * them once, for its panel and its reducer alike.
 */
export interface WeaponTargetSubject {
    readonly weapon: WeaponEquipment;
    readonly selectedAmmo: AmmoEquipment | null;
    /** The weapon fires from below the water surface; false for a unit without a water layer. */
    readonly underwater: boolean;
}

/** One family's subject for a weapon and its ammunition selection; null when the component is no weapon. */
export type WeaponTargetSubjectResolver = (
    componentId: ComponentId,
    ammo: AttackerAmmoSelection | undefined,
) => WeaponTargetSubject | null;

/** Encounter-owned target facts plus this attacker's local facts, which override them. */
export interface WeaponPolicyTarget {
    readonly unitType?: TnTargetUnitType;
    readonly calculator?: TnTargetNumberCalculatorState;
    readonly local?: Pick<AttackerLocalTargetState, 'calculator' | 'manualTnOverride'>;
}

const ARTILLERY_CANNON_AMMO_TYPES = new Set<AmmoType>([
    'SNIPER_CANNON',
    'THUMPER_CANNON',
    'LONG_TOM_CANNON',
]);

/** Target-shape traits owned with the weapon targeting rules, not panel presentation. */
export function weaponTargetAttackTraits(
    equipment: Equipment | undefined,
    selectedAmmo: AmmoEquipment | null,
    effectiveWeaponTypes: readonly WeaponType[],
): TargetAttackTraits {
    const weapon = equipment instanceof WeaponEquipment ? equipment : null;
    const artilleryCannon = weapon !== null && (
        ARTILLERY_CANNON_AMMO_TYPES.has(weapon.ammoType)
        || (weapon.hasFlag('F_ARTILLERY') && isDirectFireEquipment(weapon))
    );
    const artillery = weapon?.hasFlag('F_ARTILLERY') === true
        || selectedAmmo?.category === 'Artillery';
    const bomb = (weapon !== null && isBombEquipment(weapon))
        || (selectedAmmo !== null && isBombEquipment(selectedAmmo));
    const mekMortarAirburst = weapon?.hasFlag('F_MEK_MORTAR') === true
        && selectedAmmo?.hasMunitionType('M_AIRBURST') === true;
    return Object.freeze({
        areaEffect: effectiveWeaponTypes.includes('AE') || artillery || bomb || mekMortarAirburst,
        artillery,
        artilleryCannon,
        bomb,
        mekMortarAirburst,
    });
}

/** The one target policy: the reason this weapon may not attack the target, or null. */
export function weaponTargetDisabledReason(
    subject: WeaponTargetSubject,
    ruleset: CBTRuleset,
    target: WeaponPolicyTarget,
): string | null {
    const { weapon, selectedAmmo, underwater } = subject;
    const rules = gameRulesFor(ruleset);
    const merged: TnTargetNumberCalculatorState = { ...target.calculator, ...target.local?.calculator };
    const facts = Object.keys(merged).length === 0 ? undefined : merged;
    if (selectedAmmo?.hasMunitionType('M_THUNDER') === true && target.unitType !== 'terrain') {
        return TARGET_THUNDER_TERRAIN_REASON;
    }
    if (weapon.hasFlag('F_TAG') && !rules.allowsTagDesignation(target.unitType)) {
        return TARGET_TAG_INFANTRY_REASON;
    }
    if (weapon.hasFlag('F_NARC')) {
        const restriction = rules.getNarcBeaconAttackRestriction({
            targetInsideBuilding: facts?.buildingCover !== undefined,
            targetIsInfantry: target.unitType === 'infantry' || target.unitType === 'battle-armor',
        });
        if (restriction === 'infantry') return TARGET_NARC_INFANTRY_REASON;
        if (restriction === 'building') return TARGET_NARC_BUILDING_REASON;
    }
    if (isBombastLaserEquipment(weapon)
        && ruleset === 'total-warfare'
        && (facts?.secondaryTarget === true || facts?.secondaryTargetSideBack === true)) {
        return TARGET_BOMBAST_SECONDARY_REASON;
    }

    const calculator = target.local?.manualTnOverride === undefined ? facts : undefined;
    if (!calculator) return null;
    if (stealthDisallowsSecondaryTarget(calculator.stealth)
        && (calculator.secondaryTarget === true || calculator.secondaryTargetSideBack === true)) {
        return TARGET_STEALTH_SECONDARY_REASON;
    }
    if (calculator.indirectFire && !weapon.hasFlag('F_INDIRECT_FIRE')) {
        return TARGET_INDIRECT_WEAPON_REASON;
    }
    const targetWater = resolveTnTargetWaterState({ ...calculator, unitType: target.unitType });
    if ((targetWater.submerged && !underwater)
        || (underwater && !targetWater.partiallyUnderwater && !targetWater.submerged)) {
        return TARGET_WATER_LAYER_REASON;
    }
    if (calculator.indirectFire && !rules.canFireIndirectly(weapon, selectedAmmo, {
        weaponUnderwater: underwater,
        targetHasUnderwaterLayer: calculator.waterDepth !== undefined,
    })) {
        return TARGET_INDIRECT_AMMO_REASON;
    }
    return null;
}

/** Reasons keyed by target, for the panel that shows the policy the reducers enforce. */
export function weaponTargetDisabledReasons(
    subject: WeaponTargetSubject,
    ruleset: CBTRuleset,
    targets: readonly (WeaponPolicyTarget & { readonly targetId: EncounterTargetId })[],
): Readonly<Record<string, string>> {
    return Object.freeze(Object.fromEntries(targets.flatMap(target => {
        const reason = weaponTargetDisabledReason(subject, ruleset, target);
        return reason === null ? [] : [[target.targetId, reason] as const];
    })) as Record<string, string>);
}

/**
 * Applies the policy to a planned targeting edit. Aiming a weapon at a target
 * it may not attack rejects the edit (null); any other target selection the
 * edit invalidated, such as by toggling indirect fire, is cleared.
 */
export function applyWeaponTargetPolicies(
    planned: AttackerTargetingState,
    edit: AttackerTargetingEdit,
    registry: TargetRegistrySnapshot,
    ruleset: CBTRuleset,
    subjects: WeaponTargetSubjectResolver,
): AttackerTargetingState | null {
    const aimed = edit.kind === 'set-component-selection' && edit.selection?.kind === 'target'
        ? [edit.componentId]
        : edit.kind === 'set-component-selections' && edit.selection?.kind === 'target'
            ? edit.componentIds
            : [];
    if (aimed.some(componentId =>
        !weaponTargetSelectionAllowed(planned, registry, ruleset, componentId, subjects))) {
        return null;
    }
    return reconcileWeaponTargetPolicies(planned, registry, ruleset, subjects);
}

/** Clears target selections the policy forbids, keeping their ammunition preference. */
export function reconcileWeaponTargetPolicies(
    targeting: AttackerTargetingState,
    registry: TargetRegistrySnapshot,
    ruleset: CBTRuleset,
    subjects: WeaponTargetSubjectResolver,
): AttackerTargetingState {
    const components = new Map(targeting.components);
    let changed = false;
    for (const [componentId, component] of components) {
        if (weaponTargetSelectionAllowed(targeting, registry, ruleset, componentId, subjects)) continue;
        changed = true;
        if (component.ammo === undefined) components.delete(componentId);
        else components.set(componentId, Object.freeze({ ammo: component.ammo }));
    }
    return changed
        ? freezeAttackerTargetingState({ ...targeting, components: new ImmutableIndex(components) })
        : targeting;
}

function weaponTargetSelectionAllowed(
    targeting: AttackerTargetingState,
    registry: TargetRegistrySnapshot,
    ruleset: CBTRuleset,
    componentId: ComponentId,
    subjects: WeaponTargetSubjectResolver,
): boolean {
    const component = targeting.components.get(componentId);
    if (component?.selection?.kind !== 'target') return true;
    const targetId = component.selection.targetId;
    const target = registry.targets.find(candidate => candidate.id === targetId);
    const subject = subjects(componentId, component.ammo);
    if (subject === null || target === undefined) return false;
    return weaponTargetDisabledReason(subject, ruleset, {
        unitType: target.unitType,
        calculator: target.tnCalculator,
        local: targeting.targets.get(targetId),
    }) === null;
}
