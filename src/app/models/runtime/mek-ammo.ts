// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import {
    AmmoEquipment,
    WeaponEquipment,
    ammoMatchesWeapon,
    findIntrinsicAmmoForWeapon,
} from '../equipment.model';
import type { BaseEntity } from '../entity/base-entity';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { ComponentId } from '../entity/entity-identifiers';
import type { EntityMountedEquipment } from '../entity/types';
import {
    resolveChangedAmmoCapacity,
    type AmmoCapacityFacts,
} from '../rules/ammo-capacity-rules';
import { AmmoValidityUtil } from '../../utils/ammo-validity.util';
import type { MekRuntimeIndex } from './mek-runtime-index';
import {
    createAmmoCompatibilityMatch,
    matchesAmmoCompatibility,
} from '../ammo-compatibility-matcher.model';

export interface AmmoLoadout {
    readonly munitionKey: string;
    readonly capacity: number;
    readonly equipment: AmmoEquipment;
}

export interface MekIntrinsicMagazine {
    readonly ownerComponentId: ComponentId;
    readonly capacity: number;
    readonly defaultMunitionKey: string;
    readonly loadouts: readonly AmmoLoadout[];
}

/** Compatible loadouts for one ordinary Entity ammunition mount. */
export function entityAmmoLoadouts(
    entity: BaseEntity,
    mount: EntityMountedEquipment,
    ruleset: CBTRuleset,
): readonly AmmoLoadout[] {
    const equipment = mount.equipment;
    return equipment instanceof AmmoEquipment
        ? compatibleLoadouts(
            entity,
            equipment,
            mount.getAmmoShots() ?? equipment.shots,
            ruleset,
            false,
        )
        : Object.freeze([]);
}

export function entityAmmoLoadout(
    entity: BaseEntity,
    mount: EntityMountedEquipment,
    ruleset: CBTRuleset,
    munitionOverride?: string,
): AmmoLoadout | null {
    const equipment = mount.equipment;
    if (!(equipment instanceof AmmoEquipment)) return null;
    const key = munitionOverride ?? equipment.internalName;
    return entityAmmoLoadouts(entity, mount, ruleset)
        .find(loadout => loadout.munitionKey === key) ?? null;
}

export function weaponAcceptsAmmo(
    weapon: WeaponEquipment,
    ammo: AmmoEquipment,
    selectedMode: string | undefined,
): boolean {
    return matchesAmmoCompatibility(createAmmoCompatibilityMatch({
        weapon,
        ammo,
        selectedMode,
    })) ?? ammoMatchesWeapon(weapon, ammo);
}

export function mekAmmoLoadouts(
    entity: MekEntity,
    index: MekRuntimeIndex,
    componentId: ComponentId,
    ruleset: CBTRuleset,
): readonly AmmoLoadout[] {
    const component = index.components.get(componentId);
    if (component?.kind !== 'equipment') return [];
    const equipment = component.mount.equipment;
    if (equipment instanceof AmmoEquipment) {
        return compatibleLoadouts(
            entity,
            equipment,
            component.mount.getAmmoShots() ?? equipment.shots,
            ruleset,
            false,
        );
    }
    if (!(equipment instanceof WeaponEquipment) || equipment.oneShotCount === undefined) return [];
    const ammo = findIntrinsicAmmoForWeapon(equipment, entity.getEquipmentRegistry());
    return ammo === null
        ? []
        : compatibleLoadouts(entity, ammo, equipment.oneShotCount, ruleset, true);
}

export function mekAmmoLoadout(
    entity: MekEntity,
    index: MekRuntimeIndex,
    componentId: ComponentId,
    ruleset: CBTRuleset,
    munitionOverride?: string,
): AmmoLoadout | null {
    const loadouts = mekAmmoLoadouts(entity, index, componentId, ruleset);
    const key = munitionOverride ?? mekAmmoDefaultMunitionKey(entity, index, componentId);
    return key === null ? null : loadouts.find(loadout => loadout.munitionKey === key) ?? null;
}

export function mekAmmoCapacity(
    entity: MekEntity,
    index: MekRuntimeIndex,
    componentId: ComponentId,
    ruleset: CBTRuleset,
    munitionOverride?: string,
): number | null {
    return mekAmmoLoadout(entity, index, componentId, ruleset, munitionOverride)?.capacity ?? null;
}

export function mekAmmoDefaultMunitionKey(
    entity: MekEntity,
    index: MekRuntimeIndex,
    componentId: ComponentId,
): string | null {
    const component = index.components.get(componentId);
    if (component?.kind !== 'equipment') return null;
    const equipment = component.mount.equipment;
    if (equipment instanceof AmmoEquipment) return equipment.internalName;
    if (!(equipment instanceof WeaponEquipment) || equipment.oneShotCount === undefined) return null;
    return findIntrinsicAmmoForWeapon(equipment, entity.getEquipmentRegistry())?.internalName ?? null;
}

export function mekIntrinsicMagazine(
    entity: MekEntity,
    index: MekRuntimeIndex,
    componentId: ComponentId,
    ruleset: CBTRuleset,
): MekIntrinsicMagazine | null {
    const component = index.components.get(componentId);
    const weapon = component?.kind === 'equipment' ? component.mount.equipment : undefined;
    if (!(weapon instanceof WeaponEquipment) || weapon.oneShotCount === undefined) return null;
    const defaultMunitionKey = mekAmmoDefaultMunitionKey(entity, index, componentId);
    if (defaultMunitionKey === null) return null;
    return Object.freeze({
        ownerComponentId: componentId,
        capacity: weapon.oneShotCount,
        defaultMunitionKey,
        loadouts: mekAmmoLoadouts(entity, index, componentId, ruleset),
    });
}

function compatibleLoadouts(
    entity: BaseEntity,
    original: AmmoEquipment,
    originalCapacity: number,
    ruleset: CBTRuleset,
    intrinsic: boolean,
): readonly AmmoLoadout[] {
    const registry = entity.getEquipmentRegistry();
    const unit = {
        type: entity.unitType(),
        mixed: entity.mixedTech(),
        techBase: entity.techBase() === 'Clan' ? 'Clan' as const : 'Inner Sphere' as const,
    };
    const originalFacts = ammoCapacityFacts(original, entity);
    const candidates = [original, ...registry.getAmmoForAmmo(original)]
        .filter((candidate, position, all) => all.indexOf(candidate) === position)
        .filter(candidate => AmmoValidityUtil.isAmmoCompatible(original, candidate, unit))
        .sort((left, right) => left.internalName.localeCompare(right.internalName));
    return Object.freeze(candidates.map(equipment => Object.freeze({
        munitionKey: equipment.internalName,
        capacity: intrinsic || equipment === original
            ? originalCapacity
            : resolveChangedAmmoCapacity(
                ruleset,
                originalFacts,
                originalCapacity,
                ammoCapacityFacts(equipment, entity),
            ),
        equipment,
    })));
}

function ammoCapacityFacts(ammo: AmmoEquipment, entity: BaseEntity): AmmoCapacityFacts {
    const baseAmmoShots = entity.getEquipmentRegistry().getBaseAmmo(ammo)?.shots;
    return {
        shots: ammo.shots,
        kgPerShot: ammo.kgPerShot,
        hasCustomKgPerShot: ammo.hasCustomKgPerShot,
        munitionTypes: ammo.munitionType,
        ...(baseAmmoShots === undefined ? {} : { baseAmmoShots }),
    };
}
