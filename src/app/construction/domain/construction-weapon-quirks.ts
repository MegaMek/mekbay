// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { BaseEntity } from '../../models/entity/base-entity';
import { AeroEntity, BattleArmorEntity, InfantryEntity, JumpShipEntity, MekEntity, ProtoMekEntity, VehicleEntity } from '../../models/entity/entities';
import { WeaponEquipment } from '../../models/equipment.model';
import type { EntityMountedEquipment } from '../../models/entity/types/equipment';
import { weaponQuirkAddress, weaponQuirkMount } from '../../models/entity/utils/weapon-quirks';

export function canHaveWeaponQuirks(mount: EntityMountedEquipment): boolean {
    const equipment = mount.equipment;
    return equipment instanceof WeaponEquipment || equipment?.hasFlag('F_CLUB') === true || equipment?.hasFlag('F_SHIELD') === true;
}

export function canAssignWeaponQuirks(entity: BaseEntity, mount: EntityMountedEquipment): boolean {
    return canHaveWeaponQuirks(mount) && mount.allocation.kind !== 'unallocated' && weaponQuirkAddress(entity, mount).slot >= 0;
}

/** MegaMek WeaponQuirks.isQuirkDisallowed, plus the directional mount's placement restriction. */
export function constructionWeaponQuirkApplies(entity: BaseEntity, mount: EntityMountedEquipment, key: string): boolean {
    if (!canHaveWeaponQuirks(mount) || entity instanceof InfantryEntity) return false;
    const equipment = mount.equipment;
    const cooling = ['imp_cooling', 'poor_cooling', 'no_cooling'].includes(key);
    const ammo = ['ammo_feed_problems', 'static_feed', 'fast_reload'].includes(key);
    if (!(equipment instanceof WeaponEquipment)) return !cooling && !ammo && key !== 'em_interference';
    if (ammo && (!equipment.ammoType || equipment.ammoType === 'NA')) return false;
    if (key === 'em_interference' && (!equipment.hasFlag('F_ENERGY') || entity instanceof JumpShipEntity)) return false;
    if (cooling && (equipment.heat === 0 || entity instanceof VehicleEntity || entity instanceof BattleArmorEntity || entity instanceof ProtoMekEntity)) return false;
    if (entity instanceof ProtoMekEntity && ['fast_reload', 'static_feed', 'jettison_capable', 'mod_weapons'].includes(key)) return false;
    if (entity instanceof AeroEntity && ['jettison_capable', 'stable_weapon', 'exposed_linkage'].includes(key)) return false;
    if (entity instanceof JumpShipEntity && key === 'mod_weapons') return false;
    if (key === 'direct_torso_mount' || key === 'direct_torso_mount_quad') {
        if (!(entity instanceof MekEntity) || !['CT', 'LT', 'RT', 'HD'].includes(mount.location)
            || ['GAUSS_HEAVY', 'IGAUSS_HEAVY'].includes(equipment.ammoType ?? '')
            || new Set(mount.placements?.map(p => p.location)).size > 1) return false;
        if (key === 'direct_torso_mount_quad' && !['Quad', 'QuadVee'].includes(entity.chassisConfig)) return false;
    }
    return true;
}

/** Capture the identity before a construction edit changes the native location/slot address. */
export function captureConstructionWeaponQuirks(entity: BaseEntity) {
    return entity.weaponQuirks().map(entry => ({ entry, mountId: weaponQuirkMount(entity, entry)?.mountId }));
}

export function reconcileConstructionWeaponQuirks(entity: BaseEntity, previous: ReturnType<typeof captureConstructionWeaponQuirks>): void {
    entity.weaponQuirks.update(entries => entries.flatMap(entry => {
        const saved = previous.find(saved => saved.entry === entry);
        if (!saved?.mountId) return [entry];
        const mount = entity.equipment().find(mount => mount.mountId === saved.mountId);
        return mount ? [{ name: entry.name, ...weaponQuirkAddress(entity, mount) }] : [];
    }));
}
