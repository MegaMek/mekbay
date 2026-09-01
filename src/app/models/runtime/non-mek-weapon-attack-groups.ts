// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import { asComponentId, type ComponentId } from '../entity/entity-identifiers';
import type { EntityMountedWeapon, EquipmentBay } from '../entity/types';
import { WeaponEquipment } from '../equipment.model';
import { weaponBayEquipmentId } from '../entity/utils/implicit-equipment';
import { inferWeaponBayWeaponGroups } from '../entity/utils/weapon-bay-grouping';
import { isOnlyAirborne } from './non-mek-airborne-state';
import type { NonMekRuntimeIndex } from './non-mek-runtime-index';

export type NonMekWeaponAttackMode = 'individual-weapons' | 'weapon-bays';

export interface NonMekWeaponAttackGroup {
    readonly kind: 'individual-weapon' | 'weapon-bay';
    readonly source: 'individual' | 'authored-bay' | 'synthetic-bay';
    readonly componentId: ComponentId;
    readonly memberIds: readonly ComponentId[];
    readonly label: string;
}

type NonMekWeaponAttackState = Readonly<{
    readonly turn: Readonly<{ readonly airborne: boolean | null }>;
}>;

/**
 * Combat projection policy only. It never mutates or replaces installed
 * equipment. Space-only craft always use bays; DropShips use individual
 * weapons only when explicitly grounded.
 */
export function nonMekWeaponAttackMode(
    entity: BaseEntity,
    state: NonMekWeaponAttackState,
): NonMekWeaponAttackMode {
    if (isOnlyAirborne(entity)) return 'weapon-bays';
    if (entity.entityType === 'DropShip') {
        return state.turn.airborne === false ? 'individual-weapons' : 'weapon-bays';
    }
    return 'individual-weapons';
}

/**
 * Projects the attacks exposed to combat UI. Authored bay relationships are
 * authoritative; any unclaimed weapons in a bay-mode unit are grouped by arc
 * and bay class without mutating the entity.
 */
export function nonMekWeaponAttackGroups(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekWeaponAttackState,
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

    for (const group of syntheticWeaponBayGroups(
        weapons.filter(weapon => !claimed.has(weapon.id)),
    )) {
        group.memberIds.forEach(componentId => claimed.add(componentId));
        byFirstMember.set(group.componentId, group);
    }

    const result: NonMekWeaponAttackGroup[] = [];
    for (const { id, mount } of weapons) {
        const group = byFirstMember.get(id);
        if (group) result.push(group);
        else if (!claimed.has(id)) {
            throw new Error(`Bay-mode weapon ${mount.mountId} was not projected into a weapon bay`);
        }
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

function syntheticWeaponBayGroups(
    weapons: readonly Readonly<{ readonly id: ComponentId; readonly mount: EntityMountedWeapon }>[],
): readonly NonMekWeaponAttackGroup[] {
    const ids = new Map(weapons.map(weapon => [weapon.mount.mountId, weapon.id]));
    const componentId = (mount: EntityMountedWeapon): ComponentId => {
        const id = ids.get(mount.mountId);
        if (id === undefined) throw new Error(`Missing runtime component for weapon ${mount.mountId}`);
        return id;
    };
    return Object.freeze(inferWeaponBayWeaponGroups(weapons.map(weapon => weapon.mount))
        .map(group => Object.freeze({
            kind: 'weapon-bay' as const,
            source: 'synthetic-bay' as const,
            componentId: componentId(group[0]),
            memberIds: Object.freeze(group.map(componentId)),
            label: weaponBayEquipmentId(group[0].equipment),
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
