// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import { asComponentId, type ComponentId } from '../entity/entity-identifiers';
import type { EntityMountedWeapon, EquipmentBay } from '../entity/types';
import { WeaponEquipment } from '../equipment.model';
import { weaponBayEquipmentId } from '../entity/utils/implicit-equipment';
import type { NonMekRuntimeIndex } from './non-mek-runtime-index';
import type { NonMekUnitRuntimeState } from './non-mek-unit-instance';

export type NonMekWeaponAttackMode = 'individual-weapons' | 'weapon-bays';

export interface NonMekWeaponAttackGroup {
    readonly kind: 'individual-weapon' | 'weapon-bay';
    readonly source: 'individual' | 'authored-bay' | 'synthetic-satellite-bay';
    readonly componentId: ComponentId;
    readonly memberIds: readonly ComponentId[];
    readonly label: string;
}

/** Satellites are Fixed-Wing Support Vehicles with station-keeping motive systems. */
export function isSatelliteEntity(entity: BaseEntity): boolean {
    return entity.entityType === 'FixedWingSupport'
        && entity.motiveType() === 'Station Keeping';
}

/**
 * Combat projection policy only. It never mutates or replaces installed
 * equipment. Space-only craft always use bays; DropShips use individual
 * weapons only when explicitly grounded.
 */
export function nonMekWeaponAttackMode(
    entity: BaseEntity,
    state: Pick<NonMekUnitRuntimeState, 'turn'>,
): NonMekWeaponAttackMode {
    if (entity.entityType === 'JumpShip'
        || entity.entityType === 'WarShip'
        || entity.entityType === 'SpaceStation'
        || isSatelliteEntity(entity)) return 'weapon-bays';
    if (entity.entityType === 'DropShip') {
        return state.turn.airborne === false ? 'individual-weapons' : 'weapon-bays';
    }
    return 'individual-weapons';
}

/**
 * Projects the attacks exposed to combat UI. Authored bay relationships are
 * authoritative. Satellites have no MegaMek bay topology, so their bays are
 * derived by firing arc and bay weapon class without changing the entity.
 */
export function nonMekWeaponAttackGroups(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    state: Pick<NonMekUnitRuntimeState, 'turn'>,
): readonly NonMekWeaponAttackGroup[] {
    const weapons = [...index.components.values()].flatMap(component => {
        const equipment = component.mount.equipment;
        return equipment instanceof WeaponEquipment && !component.mount.isPhysicalWeapon()
            ? [{ id: component.id, mount: component.mount as EntityMountedWeapon }]
            : [];
    });
    if (nonMekWeaponAttackMode(entity, state) === 'individual-weapons') {
        return Object.freeze(weapons.map(({ id, mount }) => individualGroup(id, mount)));
    }

    const weaponIds = new Set(weapons.map(weapon => weapon.id));
    const claimed = new Set<ComponentId>();
    const byFirstMember = new Map<ComponentId, NonMekWeaponAttackGroup>();
    for (const bay of entity.equipmentBays()) {
        const group = authoredBayGroup(bay, weaponIds);
        if (!group || group.memberIds.some(componentId => claimed.has(componentId))) continue;
        group.memberIds.forEach(componentId => claimed.add(componentId));
        byFirstMember.set(group.componentId, group);
    }

    if (isSatelliteEntity(entity)) {
        for (const group of syntheticSatelliteGroups(
            weapons.filter(weapon => !claimed.has(weapon.id)),
        )) {
            group.memberIds.forEach(componentId => claimed.add(componentId));
            byFirstMember.set(group.componentId, group);
        }
    }

    const result: NonMekWeaponAttackGroup[] = [];
    for (const { id, mount } of weapons) {
        const group = byFirstMember.get(id);
        if (group) result.push(group);
        else if (!claimed.has(id)) result.push(individualGroup(id, mount));
    }
    return Object.freeze(result);
}

function authoredBayGroup(
    bay: EquipmentBay,
    weaponIds: ReadonlySet<ComponentId>,
): NonMekWeaponAttackGroup | null {
    if (bay.kind !== 'weapon-bay') return null;
    const members = bay.weapons
        .map(mount => asComponentId(mount.mountId))
        .filter(componentId => weaponIds.has(componentId));
    if (members.length === 0) return null;
    const firstWeapon = bay.weapons.find(mount => asComponentId(mount.mountId) === members[0]);
    return Object.freeze({
        kind: 'weapon-bay',
        source: 'authored-bay',
        componentId: members[0],
        memberIds: Object.freeze(members),
        label: firstWeapon === undefined ? 'Weapon Bay' : weaponBayEquipmentId(firstWeapon.equipment),
    });
}

function syntheticSatelliteGroups(
    weapons: readonly Readonly<{ readonly id: ComponentId; readonly mount: EntityMountedWeapon }>[],
): readonly NonMekWeaponAttackGroup[] {
    const groups = new Map<string, Array<Readonly<{
        readonly id: ComponentId;
        readonly mount: EntityMountedWeapon;
    }>>>();
    for (const weapon of weapons) {
        const mount = weapon.mount;
        const key = JSON.stringify({
            locations: [...mount.getOccupiedLocations()].sort(),
            rearMounted: mount.rearMounted,
            turretMounted: mount.turretMounted,
            turretType: mount.turretType ?? null,
            facing: mount.facing ?? null,
            bayType: weaponBayEquipmentId(mount.equipment),
        });
        const existing = groups.get(key);
        if (existing) existing.push(weapon);
        else groups.set(key, [weapon]);
    }
    return Object.freeze([...groups.values()].map(group => Object.freeze({
        kind: 'weapon-bay' as const,
        source: 'synthetic-satellite-bay' as const,
        componentId: group[0].id,
        memberIds: Object.freeze(group.map(weapon => weapon.id)),
        label: weaponBayEquipmentId(group[0].mount.equipment),
    })));
}

function individualGroup(
    componentId: ComponentId,
    mount: EntityMountedWeapon,
): NonMekWeaponAttackGroup {
    return Object.freeze({
        kind: 'individual-weapon',
        source: 'individual',
        componentId,
        memberIds: Object.freeze([componentId]),
        label: mount.displayName(),
    });
}
