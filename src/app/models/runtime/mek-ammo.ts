// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import {
    AmmoEquipment,
    WeaponEquipment,
    ammoMatchesWeapon,
    findIntrinsicAmmoForWeapon,
    formatEquipmentName,
} from '../equipment.model';
import type { BaseEntity } from '../entity/base-entity';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { ComponentId } from '../entity/entity-identifiers';
import type { EntityMountedEquipment } from '../entity/types';
import type { EquipmentTechBase } from '../entity/types/tech';
import {
    resolveChangedAmmoCapacity,
    type AmmoCapacityFacts,
} from '../rules/ammo-capacity-rules';
import { AmmoValidityUtil } from '../../utils/ammo-validity.util';
import type { MekRuntimeIndex } from './mek-runtime-index';
import type { CBTUnitQueryPort, CBTUnitRuntimeIndex } from './cbt-unit-runtime';
import {
    createAmmoCompatibilityMatch,
    matchesAmmoCompatibility,
} from '../ammo-compatibility-matcher.model';

export interface AmmoLoadout {
    readonly munitionKey: string;
    readonly capacity: number;
    readonly equipment: AmmoEquipment;
}

/** TO: Advanced Rules, Missiles. Compatibility ignores the current firing mode. */
export function hotLoadedAmmoForWeapon(
    index: CBTUnitRuntimeIndex,
    query: Pick<CBTUnitQueryPort, 'ammoHotLoaded' | 'ammoEquipment' | 'remainingAmmo' | 'componentStatus'>,
    weaponId: ComponentId,
    perspective: 'committed' | 'preview' = 'committed',
): readonly AmmoEquipment[] {
    const weapon = index.components.get(weaponId)?.mount?.equipment;
    if (!(weapon instanceof WeaponEquipment)) return [];
    const result: AmmoEquipment[] = [];
    for (const [sourceId, source] of index.components) {
        if (!(source.mount?.equipment instanceof AmmoEquipment) && sourceId !== weaponId) continue;
        if (!query.ammoHotLoaded(sourceId) || query.remainingAmmo(sourceId) <= 0
            || query.componentStatus(sourceId, perspective) === 'destroyed') continue;
        const ammo = query.ammoEquipment(sourceId);
        if (ammo && ammoMatchesWeapon(weapon, ammo)) result.push(ammo);
    }
    return result;
}

/** Shared label and changed-loadout marker for runtime ammo displays. */
export function ammoLoadoutDisplay(originalMunitionKey: string, equipment: AmmoEquipment, shots?: number) {
    return {
        name: formatEquipmentName(equipment, shots),
        custom: equipment.internalName !== originalMunitionKey,
    };
}

export interface MekIntrinsicMagazine {
    readonly ownerComponentId: ComponentId;
    readonly capacity: number;
    readonly defaultMunitionKey: string;
    readonly loadouts: readonly AmmoLoadout[];
}

/** Effective tech bases of installed weapons that consume this ammo family. */
export function entityWeaponTechBasesForAmmo(
    entity: BaseEntity,
    ammo: AmmoEquipment,
): readonly EquipmentTechBase[] {
    return Object.freeze([...new Set(entity.equipment().flatMap(mount => {
        const weapon = mount.equipment;
        if (!(weapon instanceof WeaponEquipment) || !ammoMatchesWeapon(weapon, ammo)) return [];
        if (weapon.techBase !== 'All' || entity.mixedTech()) return [weapon.techBase];
        return [entity.techBase()];
    }))]);
}

/** Compatible loadouts for one ordinary Entity ammunition mount. */
export function entityAmmoLoadouts(
    entity: BaseEntity,
    mount: EntityMountedEquipment,
    ruleset: CBTRuleset,
): readonly AmmoLoadout[] {
    const source = mount.equipment instanceof AmmoEquipment ? ammoLoadoutSource(entity, mount) : null;
    return source === null ? Object.freeze([]) : compatibleLoadouts(entity, source, ruleset);
}

export function entityAmmoLoadout(
    entity: BaseEntity,
    mount: EntityMountedEquipment,
    ruleset: CBTRuleset,
    munitionOverride?: string,
): AmmoLoadout | null {
    const source = mount.equipment instanceof AmmoEquipment ? ammoLoadoutSource(entity, mount) : null;
    return source === null ? null : selectAmmoLoadout(entity, source, ruleset, munitionOverride);
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
    const source = component?.kind === 'equipment' ? ammoLoadoutSource(entity, component.mount) : null;
    return source === null ? [] : compatibleLoadouts(entity, source, ruleset);
}

interface AmmoLoadoutSource {
    readonly equipment: AmmoEquipment;
    readonly capacity: number;
    readonly intrinsic: boolean;
}

function ammoLoadoutSource(
    entity: BaseEntity,
    mount: EntityMountedEquipment,
): AmmoLoadoutSource | null {
    const equipment = mount.equipment;
    if (equipment instanceof AmmoEquipment) {
        return { equipment, capacity: mount.getAmmoShots() ?? equipment.shots, intrinsic: false };
    }
    if (!(equipment instanceof WeaponEquipment) || equipment.oneShotCount === undefined) return null;
    const ammo = findIntrinsicAmmoForWeapon(equipment, entity.getEquipmentRegistry());
    return ammo === null ? null : { equipment: ammo, capacity: equipment.oneShotCount, intrinsic: true };
}

export function mekAmmoLoadout(
    entity: MekEntity,
    index: MekRuntimeIndex,
    componentId: ComponentId,
    ruleset: CBTRuleset,
    munitionOverride?: string,
): AmmoLoadout | null {
    const component = index.components.get(componentId);
    const source = component?.kind === 'equipment' ? ammoLoadoutSource(entity, component.mount) : null;
    if (source === null) return null;
    return selectAmmoLoadout(entity, source, ruleset, munitionOverride);
}

function selectAmmoLoadout(
    entity: BaseEntity,
    source: AmmoLoadoutSource,
    ruleset: CBTRuleset,
    munitionOverride?: string,
): AmmoLoadout | null {
    // Runtime queries need one loadout, not the menu of every compatible munition.
    const equipment = munitionOverride === undefined || munitionOverride === source.equipment.internalName
        ? source.equipment
        : entity.getEquipmentRegistry().getAmmoForAmmo(source.equipment)
            .find(candidate => candidate.internalName === munitionOverride);
    return equipment === undefined ? null : compatibleLoadout(entity, source, equipment, ruleset);
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
    return component?.kind === 'equipment'
        ? ammoLoadoutSource(entity, component.mount)?.equipment.internalName ?? null
        : null;
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
    source: AmmoLoadoutSource,
    ruleset: CBTRuleset,
): readonly AmmoLoadout[] {
    const candidates = [source.equipment, ...entity.getEquipmentRegistry().getAmmoForAmmo(source.equipment)]
        .filter((candidate, position, all) => all.indexOf(candidate) === position)
        .sort((left, right) => left.internalName.localeCompare(right.internalName));
    return Object.freeze(candidates.flatMap(equipment => {
        const loadout = compatibleLoadout(entity, source, equipment, ruleset);
        return loadout === null ? [] : [loadout];
    }));
}

function compatibleLoadout(
    entity: BaseEntity,
    source: AmmoLoadoutSource,
    equipment: AmmoEquipment,
    ruleset: CBTRuleset,
): AmmoLoadout | null {
    const unit = {
        type: entity.unitType(),
        mixed: entity.mixedTech(),
        techBase: entity.techBase() === 'Clan' ? 'Clan' as const : 'Inner Sphere' as const,
    };
    if (!AmmoValidityUtil.isAmmoCompatible(source.equipment, equipment, unit)) return null;
    return Object.freeze({
        munitionKey: equipment.internalName,
        capacity: source.intrinsic || equipment === source.equipment
            ? source.capacity
            : resolveChangedAmmoCapacity(
                ruleset,
                ammoCapacityFacts(source.equipment, entity),
                source.capacity,
                ammoCapacityFacts(equipment, entity),
            ),
        equipment,
    });
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
