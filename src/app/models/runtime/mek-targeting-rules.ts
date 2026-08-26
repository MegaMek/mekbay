// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { ComponentId } from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
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
    isUnitWaterDepth,
    resolveUnitWaterState,
    type UnitCover,
    type UnitHeight,
    type UnitWaterState,
} from '../unit-cover.model';
import type { AttackerAmmoSelection } from './attacker-targeting-state';
import { mekAmmoLoadouts, mekIntrinsicMagazine } from './mek-ammo';
import type { MekRuntimeIndex } from './mek-runtime-index';
import { equipmentForComponent } from './mek-runtime-index';
import { mekWeaponAmmoMatches } from './mek-weapon-fire-v2';
import type { MekUnitQueryPort } from './unit-instance';

export const TARGET_INDIRECT_WEAPON_REASON = 'Requires an indirect-fire weapon';
export const TARGET_INDIRECT_AMMO_REASON = 'Selected ammunition cannot fire indirectly at this target';
export const TARGET_WATER_LAYER_REASON = 'Weapon and target are in different water layers';
export const TARGET_TAG_INFANTRY_REASON = 'TAG cannot designate infantry';
export const TARGET_NARC_INFANTRY_REASON = 'NARC beacons cannot target infantry';
export const TARGET_NARC_BUILDING_REASON = 'NARC beacons cannot be fired into buildings';
export const TARGET_BOMBAST_SECONDARY_REASON = 'Bombast Lasers cannot fire at secondary targets';
export const TARGET_THUNDER_TERRAIN_REASON = 'Thunder missiles can only target terrain';
export const TARGET_STEALTH_SECONDARY_REASON = 'Active stealth armor cannot be attacked as a secondary target';

export interface WeaponTargetFacts {
    readonly unitType?: TnTargetUnitType;
    readonly calculator?: TnTargetNumberCalculatorState;
    readonly manualTnOverride?: boolean;
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
        || (weapon.hasWeaponTrait('artillery') && isDirectFireEquipment(weapon))
    );
    const artillery = weapon?.hasWeaponTrait('artillery') === true
        || selectedAmmo?.category === 'Artillery';
    const bomb = (weapon !== null && isBombEquipment(weapon))
        || (selectedAmmo !== null && isBombEquipment(selectedAmmo));
    const mekMortarAirburst = weapon?.hasWeaponTrait('mek-mortar') === true
        && selectedAmmo?.hasMunitionType('M_AIRBURST') === true;
    return Object.freeze({
        areaEffect: effectiveWeaponTypes.includes('AE') || artillery || bomb || mekMortarAirburst,
        artillery,
        artilleryCannon,
        bomb,
        mekMortarAirburst,
    });
}

/** Production target policy evaluated from catalog subjects and detached V2 facts. */
export function weaponTargetDisabledReason(
    weapon: WeaponEquipment,
    selectedAmmo: AmmoEquipment | null,
    ruleset: CBTRuleset,
    target: WeaponTargetFacts,
    weaponUnderwater: boolean,
): string | null {
    const rules = gameRulesFor(ruleset);
    if (selectedAmmo?.hasMunitionType('M_THUNDER') === true && target.unitType !== 'terrain') {
        return TARGET_THUNDER_TERRAIN_REASON;
    }
    if (weapon.hasWeaponTrait('tag') && !rules.allowsTagDesignation(target.unitType)) {
        return TARGET_TAG_INFANTRY_REASON;
    }
    if (weapon.hasWeaponTrait('narc')) {
        const restriction = rules.getNarcBeaconAttackRestriction({
            targetInsideBuilding: target.calculator?.buildingCover !== undefined,
            targetIsInfantry: target.unitType === 'infantry' || target.unitType === 'battle-armor',
        });
        if (restriction === 'infantry') return TARGET_NARC_INFANTRY_REASON;
        if (restriction === 'building') return TARGET_NARC_BUILDING_REASON;
    }
    if (isBombastLaserEquipment(weapon)
        && ruleset === 'total-warfare'
        && (target.calculator?.secondaryTarget === true
            || target.calculator?.secondaryTargetSideBack === true)) {
        return TARGET_BOMBAST_SECONDARY_REASON;
    }

    const calculator = target.manualTnOverride ? undefined : target.calculator;
    if (!calculator) return null;
    if (stealthDisallowsSecondaryTarget(calculator.stealth)
        && (calculator.secondaryTarget === true || calculator.secondaryTargetSideBack === true)) {
        return TARGET_STEALTH_SECONDARY_REASON;
    }
    if (calculator.indirectFire && !weapon.hasWeaponTrait('indirect-fire')) {
        return TARGET_INDIRECT_WEAPON_REASON;
    }
    const targetWater = resolveTnTargetWaterState({ ...calculator, unitType: target.unitType });
    if ((targetWater.submerged && !weaponUnderwater)
        || (weaponUnderwater && !targetWater.partiallyUnderwater && !targetWater.submerged)) {
        return TARGET_WATER_LAYER_REASON;
    }
    if (calculator.indirectFire && !rules.canFireIndirectly(weapon, selectedAmmo, {
        weaponUnderwater,
        targetHasUnderwaterLayer: calculator.waterDepth !== undefined,
    })) {
        return TARGET_INDIRECT_AMMO_REASON;
    }
    return null;
}

/** Exact selected catalog ammo, or the first current compatible loadout when selection is sparse. */
export function resolveMekTargetingAmmo(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    query: MekUnitQueryPort,
    weaponId: ComponentId,
    selection?: AttackerAmmoSelection,
): AmmoEquipment | null {
    const weapon = equipmentForComponent(index, weaponId);
    if (!(weapon instanceof WeaponEquipment) || weapon.ammoType === 'NA') return null;
    const sourceIds = [...index.components.keys()].sort();
    if (selection?.preferredSourceId !== undefined) {
        const indexOfPreferred = sourceIds.indexOf(selection.preferredSourceId);
        if (indexOfPreferred >= 0) sourceIds.unshift(...sourceIds.splice(indexOfPreferred, 1));
    }
    for (const sourceId of sourceIds) {
        if (selection?.preferredSourceId !== undefined && sourceId !== selection.preferredSourceId) continue;
        const sourceEquipment = equipmentForComponent(index, sourceId);
        const intrinsic = mekIntrinsicMagazine(entity, index, sourceId, ruleset);
        if (!(sourceEquipment instanceof AmmoEquipment) && intrinsic?.ownerComponentId !== weaponId) continue;
        let currentMunition: string;
        try {
            currentMunition = query.ammoLoadout(sourceId).munitionKey;
        } catch {
            continue;
        }
        const munitionKey = selection?.munitionKey ?? currentMunition;
        if (selection !== undefined && currentMunition !== munitionKey) continue;
        const loadout = mekAmmoLoadouts(entity, index, sourceId, ruleset)
            .find(candidate => candidate.munitionKey === munitionKey);
        if (loadout && mekWeaponAmmoMatches(weapon, loadout.equipment, query.componentMode(weaponId))) {
            return loadout.equipment;
        }
    }
    return null;
}

export function isMekWeaponUnderwater(
    entity: MekEntity,
    index: MekRuntimeIndex,
    query: MekUnitQueryPort,
    weaponId: ComponentId,
): boolean {
    const water = mekUnitWaterState(entity, query);
    if (water.submerged) return true;
    if (!water.partiallyUnderwater) return false;
    const component = index.components.get(weaponId);
    if (component?.kind !== 'equipment') return false;
    const occupied = new Set(component.mount.getOccupiedLocations());
    const firstLocation = entity.locationOrder.find(location => occupied.has(location));
    return firstLocation !== undefined && entity.locationIsLeg(firstLocation);
}

export function mekUnitWaterState(
    entity: MekEntity,
    query: Pick<MekUnitQueryPort, 'turnState' | 'hasCondition'>,
): UnitWaterState {
    return resolveMekUnitWaterState(
        entity,
        query.turnState().cover,
        query.hasCondition('prone'),
    );
}

export function resolveMekUnitWaterState(
    entity: MekEntity,
    cover: UnitCover | null,
    prone: boolean,
): UnitWaterState {
    return isUnitWaterDepth(cover)
        ? resolveUnitWaterState(cover, mekUnitHeight(entity, prone))
        : Object.freeze({ partiallyUnderwater: false, submerged: false });
}

export function mekUnitHeight(entity: MekEntity, prone: boolean): UnitHeight {
    return Math.max(1, (entity.tonnage() > 100 ? 3 : 2) - (prone ? 1 : 0)) as UnitHeight;
}
