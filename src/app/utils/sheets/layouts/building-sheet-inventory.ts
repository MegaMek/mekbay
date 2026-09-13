// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { StaticEmplacementEntity } from '../../../models/entity/entities/misc/static-emplacement-entity';
import type { EntityMountedEquipment } from '../../../models/entity/types/equipment';
import { BUILDING_CLASSES, BUILDING_TYPES, BUILDING_SIDE_LABELS, buildingLocationName } from '../../../models/entity/types/building';
import { buildingCapitalWeapon, buildingElevatorRange } from '../../../models/entity/utils/building-construction';
import { buildingDoorGroups, buildingLinkedDoorGeometry } from '../../../models/entity/utils/building-doors';
import { getBayRecordSheetName, getBayRecordSheetCapacity } from '../../../models/entity/bays/bay-definitions';
import { appendRecordSheetAmmoProfile, measureRecordSheetAmmoProfile } from '../record-sheet-ammo-rendering';
import { recordSheetInventoryMountName } from '../record-sheet-inventory-equipment';
import { inventoryCellLines, fitInventoryText, MIN_INVENTORY_FONT, MIN_INVENTORY_LINE_RATIO } from '../inventory-text-layout';
import { addText, formatNumber, recordSheetAmmoProfile, recordSheetInventoryWeapons, setAttributes,
    setInventoryComponentIds, svgElement, transparentRect } from '../record-sheet-svg-rendering';

interface InventoryRow {
    readonly key: number;
    readonly cells: readonly string[];
    readonly mounts?: readonly EntityMountedEquipment[];
    readonly note?: boolean;
    readonly mode?: { readonly name: string; readonly displayOnly?: boolean };
}
export interface BuildingInventoryPage {
    readonly rows: readonly InventoryRow[];
    readonly fontSize: number;
    readonly lineStep: number;
}

function inventoryRows(entity: StaticEmplacementEntity): InventoryRow[] {
    const rows: InventoryRow[] = [];
    let key = 0;
    const note = (name: string) => rows.push({ key: key++, cells: ['', name, '', '', '', '', '', ''], note: true });
    const weapons = new Map(recordSheetInventoryWeapons(entity).map(row => [row.componentIds[0], row]));
    const groups = new Map<string, EntityMountedEquipment[]>();
    for (const mount of entity.equipment()) {
        if (mount.allocation.kind !== 'location') continue;
        const id = JSON.stringify([mount.equipmentId, mount.location,
            mount.equipment?.hasFlag('F_POWER_GENERATOR') ? mount.size : null]);
        const group = groups.get(id);
        if (group) group.push(mount); else groups.set(id, [mount]);
    }
    for (const mounts of groups.values()) {
        const mount = mounts[0], weapon = weapons.get(mount.mountId), rowKey = key++;
        const shots = mount.getAmmoShots() === undefined ? undefined : mounts.reduce((sum, item) => sum + item.getAmmoShots()!, 0);
        const sizes = new Map<number, number>();
        for (const item of mounts) if (item.size !== undefined) sizes.set(item.size, (sizes.get(item.size) ?? 0) + 1);
        const mountName = sizes.size > 1 ? mount.displayName() : recordSheetInventoryMountName(entity, mount);
        const name = shots === undefined ? mountName
            : `${mount.displayName()} (${shots}${mounts.length > 1 ? ' total' : ''} rounds)`;
        const location = entity.displayLocation(mount.location, true);
        rows.push({ key: rowKey, mounts, cells: [String(mounts.length), name, location,
            weapon?.damage ?? '', weapon?.minimumRange ?? '', ...weapon?.ranges ?? ['', '', '']] });
        if (sizes.size > 1) note('Sizes: ' + [...sizes].map(([size, count]) => `${count} × ${formatNumber(size)}`).join('; '));
        const modes = new Map(mounts.flatMap(item => weapons.get(item.mountId)?.alternativeModes ?? []).map(mode => [JSON.stringify(mode), mode]));
        for (const mode of modes.values()) rows.push({ key: rowKey, mounts, mode,
            cells: ['', mode.name, location, mode.damage, mode.minimumRange, ...mode.ranges] });
        const facings = new Map<string, number>();
        for (const item of mounts) {
            if (!weapons.has(item.mountId)) continue;
            const facing = buildingCapitalWeapon(item.equipment) ? 'Upward (capital)' : item.turretType === 'sponson' ? 'Roof turret (T)'
                : item.facing !== undefined && item.facing >= 0 ? BUILDING_SIDE_LABELS[item.facing] + (item.turretType === 'pintle' ? ' (P)' : ' fixed') : '';
            const description = facing + (entity.equipmentDesign().get(item.mountId)?.automated ? '; auto, Gunnery 5' : '');
            if (description) facings.set(description, (facings.get(description) ?? 0) + 1);
        }
        if (facings.size) note([...facings].map(([name, count]) => `${count} × ${name}`).join('; '));
        for (const item of mounts) {
            const design = entity.equipmentDesign().get(item.mountId);
            if (design?.positions.length) note(`Mass shares (${formatNumber((item.getTonnage(entity) ?? 0) / design.positions.length)} t each): `
                + design.positions.map(position => entity.displayLocation(buildingLocationName(position.hex, position.floor), true)).join(', '));
            if (design?.pcmtSource) note(`PCMT transmitter: ${formatNumber(design.pcmtSource)} t`);
        }
    }
    for (const bay of entity.transporters()) {
        const name = bay.kind === 'bay' ? `${getBayRecordSheetName(bay.configuration)} (${formatNumber(getBayRecordSheetCapacity(bay))})`
            : bay.kind === 'troop-space' ? `Troop space (${formatNumber(bay.totalSpace)} t)` : undefined;
        if (!name) continue;
        rows.push({ key: key++, cells: ['1', name, '—', '', '', '', '', ''] });
        if (bay.kind === 'bay' && entity.baySpace().has(bay.id)) note('Space: ' + entity.baySpaces(bay).map(space =>
            `${entity.displayLocation(buildingLocationName(space.position.hex, space.position.floor), true)} ${formatNumber(space.tons)} t`).join(', '));
    }
    note(([5, 7].includes(entity.buildingClass() ?? 0) ? '' : `${BUILDING_TYPES[entity.buildingType() ?? 0] ?? '—'} / `)
        + (BUILDING_CLASSES[entity.buildingClass() ?? 0] ?? '—'));
    if (entity.isCastleBrian()) note('CF and armor: capital points (×10 standard)');
    if (entity.hasEnvironmentalSealing()) note('Environmental sealing');
    const options = entity.buildingOptions();
    if (entity.isMobile()) {
        const systems = entity.mobileSystems();
        note('Mobile Structure; maximum ' + formatNumber(entity.originalWalkMP()) + ' MP (no flank rating)');
        note(`Power ${formatNumber(systems.powerPerHex)} t + motive ${formatNumber(systems.motivePerHex)} t per hex`);
        if (systems.fuel) {
            note(`Operating range: ${formatNumber(entity.operatingRange())} km`);
            for (const hex of entity.coordinates()) if (entity.fuelInHex(hex))
                rows.push({ key: key++, cells: ['1', `Fuel (${formatNumber(entity.fuelInHex(hex))} t)`, entity.displayHex(hex), '', '', '', '', ''] });
        }
    }
    if (options.openSpace) note('Open-space: 600 t total, lowest floor equipment only');
    if (options.heavyMetal) note('Heavy-metal superstructure');
    if (options.tunnel) note('Tunnel construction');
    if (options.ceiling !== 'STANDARD') note(options.ceiling + ' ceilings');
    if (options.site !== 'SURFACE') note(options.site + ': ' + options.depth + ' levels of cover');
    if (entity.usesHexsides()) note('CF / armor / capacity apply per hexside');
    if (entity.isBridge()) note('Decks only; both ends must meet map terrain');
    const doors = entity.doors(), geometry = buildingLinkedDoorGeometry(doors);
    const openings = new Map(buildingDoorGroups(doors).flatMap(group => group.map(door => [door, group] as const)));
    const printed = new Set<typeof doors[number]>();
    const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (const door of doors) {
        if (printed.has(door)) continue;
        const opening = openings.get(door) ?? [door];
        opening.forEach(segment => printed.add(segment));
        const hexes = [...new Set(opening.map(segment => entity.displayHex(segment.position.hex)))].sort();
        const directions = [...new Set(opening.map(segment => {
            const shape = geometry.get(segment);
            if (!shape) return BUILDING_SIDE_LABELS[segment.facing];
            const [tip, a, b] = shape.arrow;
            // Use the unprojected arrow normal, including E/W for a straightened linked opening.
            return compass[(Math.round(Math.atan2(tip[0] - (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - tip[1]) / (Math.PI / 4)) + 8) % 8];
        }))].sort((a, b) => compass.indexOf(a) - compass.indexOf(b)).join('/');
        note(`${hexes.join('-')}/${entity.levelLabel(door.position.floor, true)}: `
            + `Door ${directions}: ${door.height} level${door.height === 1 ? '' : 's'} high`);
    }
    for (const lift of entity.elevators()) {
        const level = (value: number) => entity.roofLevelLabel(value, true, lift.hex);
        const [lower, upper] = buildingElevatorRange(lift), hex = entity.displayHex(lift.hex);
        note(`${hex}: Elevator ${formatNumber(lift.capacity)} t, ${level(lower)}–${level(upper)}`);
        note('Lift access: ' + [...lift.exits].sort(([a], [b]) => a - b).map(([floor, mask]) =>
            `${level(floor)} (${BUILDING_SIDE_LABELS.filter((_, side) => mask & (1 << side)).join(',')})`).join('; '));
        note(`${hex}: Current elevator level: ____`);
    }
    return rows;
}

function wrapRows(rows: readonly InventoryRow[], fontSize: number, width: number): InventoryRow[] {
    return rows.flatMap(row => {
        const cells = row.cells.map((value, column) => inventoryCellLines(value,
            (column === 1 ? row.note ? 187 : 77 : column === 2 ? 30 : column === 3 ? 20 : 12) * width / 224, fontSize));
        return Array.from({ length: Math.max(1, ...cells.map(lines => lines.length)) }, (_, index) => ({
            ...row, cells: cells.map(lines => lines[index] ?? '') }));
    });
}

export function buildingInventoryPages(entity: StaticEmplacementEntity, width: number, height: number): BuildingInventoryPage[] {
    const ammo = recordSheetAmmoProfile(entity);
    const measure = (rows: readonly InventoryRow[], fontSize: number) => {
        const content = wrapRows(rows, fontSize, width);
        const ammoLines = measureRecordSheetAmmoProfile(ammo, { width: width - 20, fontSize }).lines.length;
        return { lineCount: content.length + (ammoLines ? ammoLines + 1 : 0), content: { rows: content, ammoLines } };
    };
    const available = height - 42; // Include descenders and the final row's hit area above the footer.
    const pages: BuildingInventoryPage[] = [];
    let remaining = inventoryRows(entity);
    while (remaining.length || !pages.length) {
        let fit = fitInventoryText(available, font => measure(remaining, font));
        let used = remaining.length;
        if (!fit.fits) {
            const capacity = Math.floor(available / (MIN_INVENTORY_FONT * MIN_INVENTORY_LINE_RATIO));
            let count = measure([], MIN_INVENTORY_FONT).lineCount;
            used = 0;
            for (const row of remaining) {
                const lines = wrapRows([row], MIN_INVENTORY_FONT, width).length;
                if (count + lines > capacity) break;
                count += lines;
                used++;
            }
            if (!used) {
                // An unusually long single annotation can itself span pages without dropping text.
                remaining = [...wrapRows(remaining.slice(0, 1), MIN_INVENTORY_FONT, width), ...remaining.slice(1)];
                used = Math.max(1, capacity - count);
            }
            fit = fitInventoryText(available, font => measure(remaining.slice(0, used), font));
        }
        pages.push({ rows: fit.content.rows, fontSize: fit.fontSize, lineStep: fit.lineStep });
        remaining = remaining.slice(used);
    }
    return pages;
}

export function drawBuildingInventory(group: SVGGElement, entity: StaticEmplacementEntity, width: number, height: number,
    page: BuildingInventoryPage | undefined): void {
    const scale = width / 224;
    const xs = [12, 24, 119, 147, 166, 182, 198, 213].map(x => x * scale);
    addText(group, 'Weapons & Equipment Inventory', 9, 14, { size: 8.6, weight: 700, maxWidth: width - 42 });
    addText(group, '(hexes)', width - 9, 14, { size: 6, anchor: 'end' });
    ['Qty', 'Type', 'Hex/Loc', 'Dmg', 'Min', 'Sht', 'Med', 'Lng'].forEach((label, index) =>
        addText(group, label, xs[index], 27, { size: 6, weight: 700, anchor: index === 1 ? 'start' : 'middle' }));
    if (!page) return;
    const { fontSize, lineStep } = page;
    const rows = svgElement('g');
    setAttributes(rows, { 'data-ammo-inventory': '', 'data-top': 32, 'data-bottom': height - 8,
        'data-content-bottom': 32 + page.rows.length * lineStep });
    group.appendChild(rows);
    const groups = new Map<number, SVGGElement>();
    page.rows.forEach((row, index) => {
        let entry = groups.get(row.key);
        if (!entry) {
            entry = svgElement('g');
            entry.id = `static-inventory-${row.key}`;
            entry.setAttribute('class', row.mounts ? 'inventoryEntry' : row.note ? 'building-construction-note' : 'building-transport');
            if (row.mounts) setInventoryComponentIds(entry, row.mounts.map(mount => mount.mountId));
            groups.set(row.key, entry);
            rows.appendChild(entry);
        }
        let parent = entry;
        if (row.mode) {
            parent = svgElement('g');
            setAttributes(parent, { class: row.mode.displayOnly ? 'equipmentProfile' : 'alternativeMode', 'data-mekbay-mode': row.mode.name });
            entry.appendChild(parent);
        }
        const y = 32 + fontSize + index * lineStep;
        if (row.mounts) parent.appendChild(transparentRect(7, y - fontSize, width - 14, lineStep, 'inventoryEntryButton mainButton'));
        row.cells.forEach((value, column) => {
            if (!value) return;
            const classes = ['qty', 'name', 'location', 'damage', 'range_min', 'range_short', 'range_medium', 'range_long'];
            addText(parent, value, xs[column], y, { class: classes[column], size: fontSize,
                anchor: column === 1 ? 'start' : 'middle' });
            if (row.mounts && column > 4) parent.appendChild(transparentRect(xs[column] - 7 * scale, y - fontSize,
                14 * scale, lineStep, `inventoryEntryButton ${['shrButton', 'medButton', 'lngButton'][column - 5]}`));
        });
    });
    appendRecordSheetAmmoProfile(group, recordSheetAmmoProfile(entity), {
        x: 10, y: height - 8, width: width - 20, fontSize, lineHeight: lineStep,
    });
}
