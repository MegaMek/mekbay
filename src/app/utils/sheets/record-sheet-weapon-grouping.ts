// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EntityMountedEquipment } from '../../models/entity/types/equipment';

/**
 * A weapon's live state as a key: weapons share a counted row only while their keys are equal, and the rows of one
 * design print in key order. A generated sheet has no live state, so every key is empty.
 */
export type InventoryWeaponStateKey = (componentId: string) => string;

/** How a weapon is mounted, beyond what its row prints; weapons share a counted row only on equal keys. */
export function recordSheetWeaponMountKey(mount: EntityMountedEquipment): string {
    return JSON.stringify([
        mount.equipmentId, mount.getOccupiedLocations(), mount.rearMounted, mount.turretMounted, mount.turretType,
        mount.facing, mount.size, mount.baMountLocation, mount.isDWP, mount.isSSWM, mount.isAPM, mount.armored,
    ]);
}

interface GroupableInventoryRow {
    readonly componentIds: readonly string[];
    /** Present on weapons only: a row without it keeps its place, uncounted. */
    readonly mountKey?: string;
    readonly linkedEquipment?: { readonly componentIds: readonly string[] } | null;
}

/**
 * Counts identical weapons on one row: same mount, same printed cells and same live state, including their linked
 * enhancements. A design's rows stay where its first weapon is listed, ordered by state.
 */
export function groupRecordSheetWeaponRows<T extends GroupableInventoryRow>(
    rows: readonly T[],
    stateKey: InventoryWeaponStateKey,
): (T & { readonly quantity?: number })[] {
    type Group = { quantity: number; componentIds: string[]; linkedEquipment?: { componentIds: string[] } | null };
    const designs = new Map<string, Map<string, Group>>();
    const listed: (T | Map<string, Group>)[] = [];
    for (const row of rows) {
        if (row.mountKey === undefined) {
            listed.push(row);
            continue;
        }
        const linked = row.linkedEquipment;
        const design = JSON.stringify({ ...row, componentIds: null, linkedEquipment: linked && { ...linked, componentIds: null } });
        let states = designs.get(design);
        if (!states) {
            states = new Map();
            designs.set(design, states);
            listed.push(states);
        }
        const state = [...row.componentIds, ...(linked?.componentIds ?? [])].map(stateKey).join('\u0001');
        const group = states.get(state);
        if (group) {
            group.quantity += row.componentIds.length;
            group.componentIds.push(...row.componentIds);
            group.linkedEquipment?.componentIds.push(...(linked?.componentIds ?? []));
        } else {
            states.set(state, {
                ...row,
                quantity: row.componentIds.length,
                componentIds: [...row.componentIds],
                linkedEquipment: linked && { ...linked, componentIds: [...linked.componentIds] },
            });
        }
    }
    return listed.flatMap(entry => entry instanceof Map
        ? [...entry].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, group]) => group as unknown as T & { quantity: number })
        : [entry]);
}

type InventoryDraw = (parent: SVGGElement, stateKey: InventoryWeaponStateKey | null) => void;

const INVENTORY_BLOCK_SELECTOR = '[data-mekbay-inventory-block]';
/** Each grouped inventory's own drawing and the weapon states it was last drawn for. */
const inventoryBlocks = new WeakMap<Element, { readonly draw: InventoryDraw; states: ReadonlyMap<string, string> }>();

/**
 * Draws an inventory into `parent`, one row per weapon. With `groupWeapons` it counts identical weapons per row and
 * draws into a block of its own, which `regroupRecordSheetInventory` draws again as the weapons' states regroup them;
 * `draw` must then add nothing outside the parent it is given.
 */
export function drawRecordSheetInventory(parent: SVGGElement, groupWeapons: boolean | undefined, draw: InventoryDraw): void {
    if (!groupWeapons) {
        draw(parent, null);
        return;
    }
    const block = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    block.setAttribute('data-mekbay-inventory-block', '');
    parent.appendChild(block);
    inventoryBlocks.set(block, { draw, states: drawInventoryBlock(block, draw, () => '') });
}

function drawInventoryBlock(block: SVGGElement, draw: InventoryDraw, stateKey: InventoryWeaponStateKey): ReadonlyMap<string, string> {
    const states = new Map<string, string>();
    block.replaceChildren();
    draw(block, componentId => {
        const key = stateKey(componentId);
        states.set(componentId, key);
        return key;
    });
    return states;
}

/** Draws the sheet's grouped inventories again when their weapons' live states changed; true when any was drawn. */
export function regroupRecordSheetInventory(svg: SVGSVGElement, stateKey: InventoryWeaponStateKey): boolean {
    let regrouped = false;
    svg.querySelectorAll<SVGGElement>(INVENTORY_BLOCK_SELECTOR).forEach(block => {
        const inventory = inventoryBlocks.get(block);
        if (!inventory || [...inventory.states].every(([componentId, key]) => stateKey(componentId) === key)) return;
        inventory.states = drawInventoryBlock(block, inventory.draw, stateKey);
        regrouped = true;
    });
    return regrouped;
}

/** A copy of sheet content regroups its inventories like the content it was copied from. */
export function adoptRecordSheetInventoryBlocks(source: Element, copy: Element): void {
    const blocksIn = (root: Element): Element[] =>
        [...(root.matches(INVENTORY_BLOCK_SELECTOR) ? [root] : []), ...root.querySelectorAll(INVENTORY_BLOCK_SELECTOR)];
    const copies = blocksIn(copy);
    blocksIn(source).forEach((block, index) => {
        const inventory = inventoryBlocks.get(block);
        if (inventory && copies[index]) inventoryBlocks.set(copies[index], { ...inventory });
    });
}

/** Whether a row belongs to an inventory that regroups, so a part of its weapons can take a state of their own. */
export function isRegroupingInventoryRow(row: Element): boolean {
    const block = row.closest(INVENTORY_BLOCK_SELECTOR);
    return block !== null && inventoryBlocks.has(block);
}
