// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { isCaseIIEquipment, isStandardCaseEquipment } from '../models/case-equipment.model';
import type { MekEntity } from '../models/entity/entities/mek/mek-entity';
import type { CriticalSlotView, EntityMountedEquipment } from '../models/entity/types';
import type { MekSystemType } from '../models/entity/types/mek';
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

/** One occupant of a Mek critical slot, as the critical table names it. */
export type MekCriticalSlotItem =
    | { readonly label: string }
    | { readonly ammo: Readonly<{ name: string; shots: number; custom?: boolean }> };

/**
 * Critical-table lines for one slot. Superheavy slots can hold two occupants: bins of the
 * same ammo share one line with their shots summed, identical heat sinks share one counted
 * line, and anything else (such as two different munitions) gets a line of its own.
 */
export function formatMekCriticalSlotLines(items: readonly MekCriticalSlotItem[]): readonly string[] {
    if (items.length === 0) return ['Roll Again'];
    const lines = new Map<string, { readonly text: string; count: number; shots: number | null }>();
    for (const item of items) {
        const text = 'label' in item ? item.label : `${item.ammo.custom ? '*' : ''}Ammo (${item.ammo.name})`;
        const key = `${'label' in item ? 'equipment' : 'ammo'}:${text}`;
        const line = lines.get(key) ?? { text, count: 0, shots: 'label' in item ? null : 0 };
        line.count++;
        if ('ammo' in item) line.shots! += item.ammo.shots;
        lines.set(key, line);
    }
    return [...lines.values()].map(line => line.shots !== null
        ? `${line.text} ${line.shots}`
        : line.count === 1 ? line.text : `${line.count} ${line.text}s`);
}

/** Critical-table lines for one derived (construction-time) Mek critical slot. */
export function mekCriticalSlotLines(
    slot: CriticalSlotView | undefined,
    entity: MekEntity,
): readonly string[] {
    if (!slot || slot.type === 'empty') return formatMekCriticalSlotLines([]);
    if (slot.type === 'system') return [mekSystemLabel(slot.systemType, entity)];
    return formatMekCriticalSlotLines(slot.mounts.map(mount => {
        const shots = mount.getAmmoShots();
        return shots === undefined
            ? { label: mekCriticalMountName(entity, mount) }
            : { ammo: { name: recordSheetAmmoName(mount.displayName()), shots } };
    }));
}

/** Configured system name shared by loadout and record-sheet presentations. */
export function mekSystemLabel(system: MekSystemType, entity: MekEntity): string {
    if (system === 'Cockpit') {
        return entity.mountedCockpit().fullName.replace(/^Standard /u, '');
    }
    if (system === 'Gyro') {
        return entity.mountedGyro().fullName.replace(/^Standard /u, '');
    }
    if (system !== 'Engine') return system;
    const engine = entity.mountedEngine();
    const engineType = engine.type();
    if (engine.isFusion) {
        return engineType === 'Fusion'
            ? 'Fusion Engine'
            : `${engineType.replace(/ Engine$/u, '')} Fusion Engine`;
    }
    return /Engine$/u.test(engineType) ? engineType : `${engineType} Engine`;
}

export function mekCriticalMountName(entity: MekEntity, mount: EntityMountedEquipment): string {
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
