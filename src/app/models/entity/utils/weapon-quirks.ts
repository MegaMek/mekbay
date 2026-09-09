// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { BaseEntity } from '../base-entity';
import type { EntityWeaponQuirk } from '../types/common';
import type { EntityMountedEquipment } from '../types/equipment';
import type { Quirk } from '../../quirks.model';
import { MekEntity } from '../entities/mek/mek-entity';
import { blkEquipmentOrder } from './blk-equipment-order';

/** MegaMek WeaponQuirks / OptionsConstants; separate from the design-quirk catalog. */
export const WEAPON_QUIRKS: readonly Quirk[] = [
    { key: 'accurate', name: 'Accurate Weapon', type: 'positive', description: '−1 to hit.' },
    { key: 'inaccurate', name: 'Inaccurate Weapon', type: 'negative', description: '+1 to hit.' },
    { key: 'stable_weapon', name: 'Stabilized Weapon', type: 'positive', description: '−1 to hit when attacking while running.' },
    { key: 'imp_cooling', name: 'Improved Cooling Jacket', type: 'positive', description: '−1 heat generated.' },
    { key: 'poor_cooling', name: 'Poor Cooling Jacket', type: 'negative', description: '+1 heat generated.' },
    { key: 'no_cooling', name: 'No Cooling Jacket', type: 'negative', description: '+2 heat generated.' },
    { key: 'exposed_linkage', name: 'Exposed Weapon Linkage', type: 'negative', description: 'A hit to its location can damage the weapon linkage.' },
    { key: 'ammo_feed_problems', name: 'Ammo Feed Problems', type: 'negative', description: 'Prone to jamming and ammunition explosions.' },
    { key: 'static_feed', name: 'Static Ammo Feed', type: 'negative', description: 'Cannot switch ammunition types.' },
    { key: 'em_interference', name: 'EM Interference', type: 'negative', description: 'Firing causes electromagnetic interference for one turn.' },
    { key: 'fast_reload', name: 'Fast Reload', type: 'positive', description: 'The weapon can be reloaded more quickly.' },
    { key: 'direct_torso_mount', name: 'Directional Torso Mount', type: 'positive', description: 'The weapon can be set to the front or rear arc; the selected arc persists until changed.' },
    { key: 'direct_torso_mount_quad', name: 'Directional Torso Mount (360)', type: 'positive', description: 'A quad Mek weapon mount with a full 360-degree firing arc.' },
    { key: 'mod_weapons', name: 'Modular Weapon', type: 'positive', description: 'The weapon is designed for easy replacement.' },
    { key: 'jettison_capable', name: 'Jettison-Capable Weapon', type: 'positive', description: 'Can be jettisoned and later recovered.' },
    { key: 'non_functional', name: 'Non-Functional', type: 'negative', description: 'The weapon does not function.' },
    { key: 'misrepaired_weapon', name: 'Misrepaired Weapon', type: 'negative', description: '+1 to hit.' },
    { key: 'misreplaced_weapon', name: 'Misreplaced Weapon', type: 'negative', description: '+1 to hit.' },
];

export function weaponQuirkDefinition(name: string): Quirk | undefined {
    return WEAPON_QUIRKS.find(quirk => quirk.key === name);
}

/** Native MTF uses a physical critical slot; BLK families use their equipment order in the location. */
export function weaponQuirkAddress(entity: BaseEntity, mount: EntityMountedEquipment): Omit<EntityWeaponQuirk, 'name'> {
    const ordered = blkEquipmentOrder(entity).filter(candidate => candidate.location === mount.location);
    const index = ordered.findIndex(candidate => candidate.mountId === mount.mountId);
    // Java adds a bay's own critical slot immediately after its first weapon.
    const bayStarts = new Set(entity.equipmentBays().filter(bay => bay.kind === 'weapon-bay').map(bay => bay.weapons[0]?.mountId));
    const slot = entity instanceof MekEntity && mount.location !== 'Unallocated'
        ? mount.placements?.filter(p => p.location === mount.location).reduce((first, p) => Math.min(first, p.slotIndex), Infinity)
        : index < 0 ? -1 : index + ordered.slice(0, index).filter(candidate => bayStarts.has(candidate.mountId)).length;
    const location = entity.entityType === 'BattleArmor' && entity.techBase() === 'Clan' && mount.location === 'Squad'
        ? 'Point' : entity.componentLocationLabel(mount.location);
    return { weaponName: mount.equipmentId, location, slot: slot == null || !Number.isFinite(slot) ? -1 : slot };
}

export function weaponQuirkMount(entity: BaseEntity, entry: EntityWeaponQuirk): EntityMountedEquipment | undefined {
    return entity.equipment().find(mount => {
        const address = weaponQuirkAddress(entity, mount);
        return address.location === entry.location && address.slot === entry.slot
            && [mount.equipmentId, mount.equipment?.name, ...mount.equipment?.aliases ?? []].includes(entry.weaponName);
    });
}

export function weaponQuirkLabels(entity: BaseEntity): string[] {
    return entity.weaponQuirks().map(entry => {
        const mount = weaponQuirkMount(entity, entry);
        return `${mount?.displayName() ?? entry.weaponName} (${entry.location}${entry.slot >= 0 ? ` ${entry.slot + 1}` : ''}): ${weaponQuirkDefinition(entry.name)?.name ?? entry.name}`;
    });
}
