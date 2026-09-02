// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { isCaseIIEquipment, isStandardCaseEquipment } from '../models/case-equipment.model';
import type { MekEntity } from '../models/entity/entities/mek/mek-entity';
import type { CriticalSlotView, EntityMountedEquipment } from '../models/entity/types';
import { recordSheetAmmoName } from './record-sheet-ammo.util';

export type MekCriticalCaseLabel = 'CASE' | 'CASE II';

/** CASE annotation shared by Mek critical-slot presentations. */
export function mekCriticalCaseLabel(
    entity: MekEntity,
    location: string,
): MekCriticalCaseLabel | null {
    const mounts = entity.equipment().filter(mount => mount.getOccupiedLocations().includes(location));
    if (mounts.some(mount => isCaseIIEquipment(mount.equipment))) return 'CASE II';
    if (mounts.some(mount => isStandardCaseEquipment(mount.equipment))) return 'CASE';
    return entity.automaticClanCaseLocations().has(location) ? 'CASE' : null;
}

/** Canonical user-facing label for one derived Mek critical slot. */
export function mekCriticalSlotLabel(
    slot: CriticalSlotView | undefined,
    entity: MekEntity,
): string {
    if (!slot || slot.type === 'empty') return 'Roll Again';
    if (slot.type === 'system') {
        if (slot.systemType === 'Cockpit') {
            return entity.mountedCockpit().fullName.replace(/^Standard /u, '');
        }
        if (slot.systemType === 'Gyro') {
            return entity.mountedGyro().fullName.replace(/^Standard /u, '');
        }
        if (slot.systemType !== 'Engine') return slot.systemType;
        const engine = entity.mountedEngine();
        const engineType = engine.type();
        if (engine.isFusion) {
            return engineType === 'Fusion'
                ? 'Fusion Engine'
                : `${engineType.replace(/ Engine$/u, '')} Fusion Engine`;
        }
        return /Engine$/u.test(engineType) ? engineType : `${engineType} Engine`;
    }

    const labels = new Map<string, { readonly name: string; shots: number | null }>();
    slot.mounts.forEach(mount => {
        const shots = mount.getAmmoShots();
        const name = shots === undefined
            ? mekCriticalMountName(entity, mount)
            : recordSheetAmmoName(mount.displayName());
        const key = `${shots === undefined ? 'equipment' : 'ammo'}:${name}`;
        const existing = labels.get(key);
        labels.set(key, {
            name,
            shots: shots === undefined ? null : (existing?.shots ?? 0) + shots,
        });
    });
    return [...labels.values()].map(item => item.shots === null
        ? item.name
        : `Ammo (${item.name}) ${item.shots}`).join(' / ');
}

function mekCriticalMountName(entity: MekEntity, mount: EntityMountedEquipment): string {
    const equipment = mount.equipment;
    let name = mount.displayName();
    if (!equipment) return name;
    if (!entity.mixedTech()) {
        return name.replace(/\s*(?:\[Clan\]|\(Clan\))/gu, '').trim();
    }
    const suffix = entity.techBase() === 'Clan' && equipment.techBase === 'IS'
        ? '[IS]'
        : entity.techBase() === 'IS' && equipment.techBase === 'Clan'
            ? '[Clan]'
            : null;
    if (!suffix || name.includes(suffix)) return name;
    return insertEquipmentTechSuffix(name, suffix);
}

function insertEquipmentTechSuffix(name: string, suffix: string): string {
    const modifierIndex = name.indexOf(' (');
    return modifierIndex < 0
        ? `${name} ${suffix}`
        : `${name.slice(0, modifierIndex)} ${suffix}${name.slice(modifierIndex)}`;
}
