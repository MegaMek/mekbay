// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { ComponentId } from '../entity/entity-identifiers';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { AmmoEquipment, WeaponEquipment } from '../equipment.model';
import {
    isUnitWaterDepth,
    resolveUnitWaterState,
    type UnitCover,
    type UnitHeight,
    type UnitWaterState,
} from '../unit-cover.model';
import type { AttackerAmmoSelection } from './attacker-targeting-state';
import { mekAmmoLoadouts, mekIntrinsicMagazine, weaponAcceptsAmmo } from './mek-ammo';
import type { MekRuntimeIndex } from './mek-runtime-index';
import { equipmentForComponent } from './mek-runtime-index';
import type { MekUnitQueryPort } from './unit-instance';
import type { WeaponTargetSubject } from './weapon-target-policy';

/** Target-policy inputs for one Mek weapon, shared by the equipment panel and the reducer. */
export function mekWeaponTargetSubject(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    query: MekUnitQueryPort,
    weaponId: ComponentId,
    selection?: AttackerAmmoSelection,
): WeaponTargetSubject | null {
    const weapon = equipmentForComponent(index, weaponId);
    if (!(weapon instanceof WeaponEquipment)) return null;
    return Object.freeze({
        weapon,
        selectedAmmo: resolveMekTargetingAmmo(entity, index, ruleset, query, weaponId, selection),
        underwater: isMekWeaponUnderwater(entity, index, query, weaponId),
    });
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
        if (loadout && weaponAcceptsAmmo(weapon, loadout.equipment, query.componentMode(weaponId))) {
            return loadout.equipment;
        }
    }
    return null;
}

function isMekWeaponUnderwater(
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
