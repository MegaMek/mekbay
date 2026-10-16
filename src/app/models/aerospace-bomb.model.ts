// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment } from './equipment.model';
import type { EquipmentRegistry } from './equipment-lookup';

/** Bomb hardpoints by section; MegaMek IBomber.getMaxExtBombPoints/getMaxIntBombPoints. */
export interface BombCapacity {
    readonly external: number;
    readonly internal: number;
}

export type BombSection = keyof BombCapacity;
export const BOMB_SECTIONS: readonly BombSection[] = ['external', 'internal'];
export const NO_BOMB_CAPACITY: BombCapacity = Object.freeze({ external: 0, internal: 0 });

export interface BombTypeDefinition {
    /** Catalog ammo id, MegaMek BombType internal name and MUL `<bomb type>`. */
    readonly id: string;
    /** Hardpoints one bomb occupies (MegaMek BombTypeEnum cost). */
    readonly points: number;
    /** Record-sheet store abbreviation. */
    readonly label: string;
    /** MegaMek's short bomb name (BombTypeEnum display name), for record-sheet stores and keys. */
    readonly name: string;
    /** A TAG pod counts as TAG equipment (MegaMek BombTAG). */
    readonly tag?: true;
}

/**
 * Facts the equipment catalog does not carry; catalog names, BV, cost and tech come from the catalog.
 * Alamo missiles are omitted: MegaMek only allows them with its nuclear-weapons option.
 */
const BOMB_TYPE_DEFINITIONS: readonly BombTypeDefinition[] = [
    { id: 'HEBomb', points: 1, label: 'HE', name: 'HE Bomb' },
    { id: 'ClusterBomb', points: 1, label: 'C', name: 'Cluster Bomb' },
    { id: 'LGBomb', points: 1, label: 'LG', name: 'Laser-guided Bomb' },
    { id: 'RL 10 Ammo (Bomb)', points: 1, label: 'RL', name: 'Rocket' },
    { id: 'TAGBomb', points: 1, label: 'TAG', name: 'TAG', tag: true },
    { id: 'AAAMissile Ammo', points: 5, label: 'AAA', name: 'AAA Missile' },
    { id: 'ASMissile Ammo', points: 6, label: 'AS', name: 'AS Missile' },
    { id: 'ASEWMissile Ammo', points: 6, label: 'ASEW', name: 'ASEW Missile' },
    { id: 'ArrowIVMissile Ammo', points: 5, label: 'AIV', name: 'Arrow IV Missile' },
    { id: 'ArrowIVHomingMissile Ammo', points: 5, label: 'AIVH', name: 'Arrow IV Homing Missile' },
    { id: 'InfernoBomb', points: 1, label: 'INF', name: 'Inferno Bomb' },
    { id: 'LAAMissile Ammo', points: 2, label: 'LAA', name: 'LAA Missile' },
    { id: 'ThunderBomb', points: 1, label: 'THU', name: 'Thunder Bomb' },
    { id: 'TorpedoBomb', points: 1, label: 'TOR', name: 'Torpedo Bomb' },
    { id: 'FABombSmall Ammo', points: 1, label: 'FAE', name: 'Fuel-Air Bomb (small)' },
    { id: 'FABombLarge Ammo', points: 2, label: 'FAEL', name: 'Fuel-Air Bomb (large)' },
    { id: 'RL-P 10 Ammo (Bomb)', points: 1, label: 'RLP', name: 'Prototype Rocket' },
];
export const BOMB_TYPES: readonly BombTypeDefinition[] = Object.freeze(
    BOMB_TYPE_DEFINITIONS.map(definition => Object.freeze(definition)));

const BOMB_TYPES_BY_ID = new Map(BOMB_TYPES.map(definition => [definition.id, definition] as const));

export function bombType(id: string): BombTypeDefinition | undefined {
    return BOMB_TYPES_BY_ID.get(id);
}

export function isTagPodBomb(id: string): boolean {
    return bombType(id)?.tag === true;
}

/** Catalog ammo for a bomb type; the catalog owns names, BV, munitions and tech. */
export function bombAmmo(id: string, registry: EquipmentRegistry): AmmoEquipment | null {
    const equipment = registry.equipment[id];
    return equipment instanceof AmmoEquipment ? equipment : null;
}

/** One carried bomb type in a section; spent bombs have been dropped, fired or jettisoned. */
export interface BombLoad {
    readonly section: BombSection;
    readonly bombId: string;
    readonly count: number;
    readonly spent: number;
}

export type BombLoadChoice = Omit<BombLoad, 'spent'>;

export function carriedBombs(load: BombLoad): number {
    return load.count - load.spent;
}

/** Hardpoints the chosen bombs occupy in one section. */
export function bombLoadPoints(loads: readonly BombLoadChoice[], section: BombSection): number {
    return loads.reduce((total, load) =>
        total + (load.section === section ? (bombType(load.bombId)?.points ?? 0) * load.count : 0), 0);
}

/** Hardpoints the bombs still carried occupy in one section. */
export function carriedBombPoints(loads: readonly BombLoad[], section: BombSection): number {
    return bombLoadPoints(loads.map(load => ({ ...load, count: carriedBombs(load) })), section);
}

/** One carried bomb on the record sheet, labelling one store. */
export interface BombSlot {
    readonly bomb: BombTypeDefinition;
    readonly spent: boolean;
    readonly store: number;
}

/**
 * Lays the carried bombs onto each section's record-sheet stores: one labelled store per bomb from the front, in
 * table order, and every further hardpoint a larger bomb takes marked from the back. The space used therefore always
 * matches the hardpoints, whatever the bomb sizes. Bombs beyond the drawn stores are left out.
 */
export function layoutBombStores(
    loads: readonly BombLoad[],
    stores: Readonly<Record<BombSection, readonly number[]>>,
): Readonly<{ slots: readonly BombSlot[]; taken: readonly number[] }> {
    const slots: BombSlot[] = [];
    const taken: number[] = [];
    for (const section of BOMB_SECTIONS) {
        const free = [...stores[section]].sort((left, right) => left - right);
        const bombs = loads.filter(load => load.section === section).sort(compareBombLoads).flatMap(load => {
            const bomb = bombType(load.bombId);
            return bomb ? Array.from({ length: load.count }, (_, index) => ({ bomb, spent: index < load.spent })) : [];
        }).slice(0, free.length);
        bombs.forEach((carried, index) => slots.push(Object.freeze({ ...carried, store: free[index]! })));
        const extra = Math.min(free.length - bombs.length,
            bombs.reduce((total, { bomb }) => total + bomb.points - 1, 0));
        taken.push(...free.slice(free.length - extra));
    }
    return Object.freeze({ slots: Object.freeze(slots), taken: Object.freeze(taken) });
}

/** Canonical order: external before internal, then bomb table order. */
export function compareBombLoads(left: BombLoadChoice, right: BombLoadChoice): number {
    return BOMB_SECTIONS.indexOf(left.section) - BOMB_SECTIONS.indexOf(right.section)
        || BOMB_TYPES.indexOf(bombType(left.bombId)!) - BOMB_TYPES.indexOf(bombType(right.bombId)!);
}

/** Why a loadout cannot be carried, or null when it fits the unit's hardpoints. */
export function bombLoadoutIssue(loads: readonly BombLoadChoice[], capacity: BombCapacity): string | null {
    const seen = new Set<string>();
    for (const load of loads) {
        if (!BOMB_SECTIONS.includes(load.section)) return 'Unknown bomb section.';
        if (!bombType(load.bombId)) return `Unknown bomb type ${load.bombId}.`;
        if (!Number.isSafeInteger(load.count) || load.count <= 0) return 'Bomb counts must be positive whole numbers.';
        const key = `${load.section}:${load.bombId}`;
        if (seen.has(key)) return `Duplicate bomb entry ${load.bombId}.`;
        seen.add(key);
    }
    for (const section of BOMB_SECTIONS) {
        const used = bombLoadPoints(loads, section);
        if (used > capacity[section]) return `The ${section} bombs need ${used} hardpoints; ${capacity[section]} are available.`;
    }
    return null;
}
