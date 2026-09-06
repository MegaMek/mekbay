// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import { StaticEmplacementEntity } from '../../../models/entity/entities/misc/static-emplacement-entity';
import { appendRecordSheetAmmoProfile } from '../record-sheet-ammo-rendering';
import {
    fullRecordSheetLayoutProfile,
    type RecordSheetLayoutProfile,
    type RecordSheetPageFormat,
} from '../record-sheet-layout';
import {
    addFrame, addLine, addText, createRoot, drawGeneratedFooter, drawNotesPanel,
    drawPageChrome, formatNumber, formatTechBase, makeDistributedPips,
    recordSheetAmmoProfile, recordSheetInventoryWeapons, scalePageBox,
    setAttributes, setInventoryComponentIds, svgElement, transparentRect, type Box,
} from '../record-sheet-svg-rendering';
import type { RecordSheetLayout, RecordSheetLayoutRequest } from './record-sheet-layout';

// MegaMek IBuilding classes and BuildingType values, displayed without changing
// the parsed construction facts or inventing defaults for older turret files.
const BUILDING_CLASSES: Readonly<Record<number, string>> = {
    0: 'Standard', 1: 'Hangar', 2: 'Fortress', 3: 'Gun Emplacement',
};
const BUILDING_TYPES: Readonly<Record<number, string>> = {
    1: 'Light', 2: 'Medium', 3: 'Heavy', 4: 'Hardened', 5: 'Wall',
};

/** Native static-family design; MegaMekLab does not provide a reference sheet. */
export class StaticEmplacementRecordSheetLayout implements RecordSheetLayout {
    public readonly id = 'static-emplacement';

    public matches(entity: BaseEntity): boolean {
        return entity instanceof StaticEmplacementEntity;
    }

    public profile(_entity: BaseEntity, pageFormat: RecordSheetPageFormat = 'letter'): RecordSheetLayoutProfile {
        return fullRecordSheetLayoutProfile(pageFormat);
    }

    public async generate(entity: BaseEntity, request: RecordSheetLayoutRequest): Promise<SVGSVGElement> {
        if (!(entity instanceof StaticEmplacementEntity)) {
            throw new Error('Static-emplacement layout requires a building or gun emplacement');
        }
        const page = request.page;
        const svg = createRoot(page.width, page.height, entity.entityType.toLowerCase());
        svg.setAttribute('data-mekbay-design-source', 'native');
        const at = (box: Box) => scalePageBox(page, box);
        drawPageChrome(svg, `${entity.unitType().toUpperCase()} RECORD SHEET`, page, true, {
            titleLines: [entity.unitType().toUpperCase(), 'RECORD SHEET'],
        });
        drawStaticData(svg, entity, at({ x: 18, y: 78, width: 252, height: 178 }));
        drawStaticProtection(svg, entity, at({ x: 276, y: 78, width: 318, height: 178 }));
        drawStaticInventory(svg, entity, at({ x: 18, y: 264, width: 576, height: 392 }));
        if (entity.crewSlotCount() > 0) {
            drawStaticCrew(svg, at({ x: 18, y: 664, width: 222, height: 88 }));
            drawNotesPanel(svg, at({ x: 246, y: 664, width: 348, height: 88 }));
        } else {
            drawNotesPanel(svg, at({ x: 18, y: 664, width: 576, height: 88 }));
        }
        drawGeneratedFooter(svg, page);
        return svg;
    }
}

function drawStaticData(svg: SVGSVGElement, entity: StaticEmplacementEntity, box: Box): void {
    const group = addFrame(svg, entity.staticKind === 'BuildingEntity' ? 'BUILDING DATA' : 'EMPLACEMENT DATA', box);
    const name = addText(group, entity.displayName(), 9, 31, { size: 10, weight: 700, maxWidth: box.width - 18 });
    name.id = 'type';
    name.setAttribute('data-mekbay-field', 'display-name');
    const classValue = entity.buildingClass();
    const typeValue = entity.buildingType();
    const rows: readonly [string, string, string?][] = [
        ['Year', String(entity.year()), 'year'],
        ['Tech base', formatTechBase(entity.techBase(), entity.mixedTech()), 'techBase'],
        ['Building class', classValue === undefined ? '—' : BUILDING_CLASSES[classValue] ?? String(classValue)],
        ['Construction', typeValue === undefined ? '—' : BUILDING_TYPES[typeValue] ?? String(typeValue)],
        ['Height', entity.height() === undefined ? '—' : `${entity.height()} ${entity.height() === 1 ? 'level' : 'levels'}`],
        ['Coordinates', entity.coordinates().join(' / ') || '—'],
        ['Turret', entity.turret() ? 'Yes' : 'No'],
        ['Battle Value', formatNumber(entity.battleValue()), 'bv'],
    ];
    const step = (box.height - 53) / rows.length;
    rows.forEach(([label, value, id], index) => {
        const y = 47 + index * step;
        addText(group, label, 9, y, { size: 7, weight: 700, maxWidth: 90 });
        const text = addText(group, value, box.width - 9, y, { size: 7.5, anchor: 'end', maxWidth: box.width - 108 });
        if (id) text.id = id;
        if (index < rows.length - 1) addLine(group, 9, y + 4, box.width - 9, y + 4, '#ddd', 0.45);
    });
}

function drawStaticProtection(svg: SVGSVGElement, entity: StaticEmplacementEntity, box: Box): void {
    const group = addFrame(svg, 'ARMOR & CONSTRUCTION FACTOR', box);
    const locations = entity.damageLocations();
    if (entity.armorValues().size === 0 && entity.constructionFactor() === undefined) {
        addText(group, 'Armor and construction factor are not specified.', 10, 41,
            { size: 8, maxWidth: box.width - 20 });
        return;
    }
    const step = (box.height - 25) / locations.length;
    const columnWidth = (box.width - 24) / 2;
    locations.forEach((location, index) => {
        const code = location.sheetCode ?? location.code;
        const y = 27 + index * step;
        addText(group, code, 10, y, { size: 7, weight: 700, maxWidth: box.width - 20 });
        const tracks = [
            ['armor', 'Armor', location.armor.front, entity.armorValues().has(location.code)],
            ['structure', 'CF', location.internalPoints, entity.constructionFactor() !== undefined],
        ] as const;
        tracks.forEach(([kind, label, count, specified], column) => {
            const x = 10 + column * (columnWidth + 4);
            addText(group, label, x, y + 13, { size: 7, weight: 700 });
            const value = addText(group, specified ? String(count) : '—', x + columnWidth, y + 13,
                { size: 7, anchor: 'end' });
            value.id = `${kind === 'armor' ? 'textArmor' : 'textIS'}_${code}`;
            const height = Math.max(1, step - 37);
            // Static panels have no authored rail areas, so all modes use the
            // distributed fallback just like paperdoll areas without rails.
            const pips = makeDistributedPips(count, columnWidth, height, kind, code);
            if (!pips) return;
            pips.setAttribute('transform', `translate(${formatNumber(x)} ${formatNumber(y + 19)})`);
            group.appendChild(pips);
            const hit = transparentRect(x, y + 17, columnWidth, height + 2, `unitLocation ${kind}`);
            hit.setAttribute('data-loc', code);
            group.appendChild(hit);
        });
    });
}

function drawStaticInventory(svg: SVGSVGElement, entity: StaticEmplacementEntity, box: Box): void {
    const group = addFrame(svg, 'WEAPONS & EQUIPMENT', box);
    const scale = box.width / 576;
    const xs = [10, 232, 355, 384, 430, 464, 498, 532].map(x => x * scale);
    ['Equipment', 'Location', 'Heat', 'Damage', 'Min', 'Sht', 'Med', 'Lng'].forEach((label, index) => {
        addText(group, label, xs[index], 29, { size: 7.2, weight: 700, anchor: index > 1 ? 'middle' : 'start' });
    });
    const weapons = new Map(recordSheetInventoryWeapons(entity).map(row => [row.componentIds[0], row]));
    const mounts = entity.equipment();
    const lineCount = mounts.reduce((count, mount) => count + 1 + (weapons.get(mount.mountId)?.alternativeModes.length ?? 0), 0);
    const step = Math.min(11, (box.height - 61) / Math.max(1, lineCount));
    const fontSize = Math.min(7, step * 0.73);
    const rows = svgElement('g');
    setAttributes(rows, { 'data-ammo-inventory': '', 'data-top': 34, 'data-bottom': box.height - 15,
        'data-content-bottom': 34 + lineCount * step });
    group.appendChild(rows);
    let line = 0;
    mounts.forEach((mount, index) => {
        const weapon = weapons.get(mount.mountId);
        const entry = svgElement('g');
        entry.id = `static-inventory-${index}`;
        entry.setAttribute('class', 'inventoryEntry');
        setInventoryComponentIds(entry, [mount.mountId]);
        rows.appendChild(entry);
        const drawRow = (parent: SVGGElement, name: string, damage: string, minimumRange: string, ranges: readonly string[]) => {
            const y = 34 + ++line * step;
            parent.appendChild(transparentRect(7, y - step + 1, box.width - 14, step, 'inventoryEntryButton mainButton'));
            addText(parent, name, xs[0], y, { class: 'name', size: fontSize, maxWidth: 216 * scale });
            addText(parent, mount.getOccupiedLocations().join(' / '), xs[1], y,
                { class: 'location', size: fontSize, maxWidth: 108 * scale });
            addText(parent, weapon?.heat ?? '', xs[2], y,
                { class: 'heat', size: fontSize, anchor: 'middle', maxWidth: 23 * scale });
            addText(parent, damage, xs[3], y,
                { class: 'damage', size: fontSize, anchor: 'middle', maxWidth: 42 * scale });
            [minimumRange, ...ranges].forEach((value, column) => {
                addText(parent, value, xs[column + 4], y, {
                    class: ['range_min', 'range_short', 'range_medium', 'range_long'][column],
                    size: fontSize, anchor: 'middle', maxWidth: 26 * scale,
                });
                if (column > 0 && weapon) parent.appendChild(transparentRect(xs[column + 4] - 14 * scale,
                    y - step + 1, 28 * scale, step, `inventoryEntryButton ${['', 'shrButton', 'medButton', 'lngButton'][column]}`));
            });
        };
        const shots = mount.getAmmoShots();
        const name = shots === undefined ? mount.displayName() : `${mount.displayName()} (${shots} rounds)`;
        drawRow(entry, name, weapon?.damage ?? '', weapon?.minimumRange ?? '', weapon?.ranges ?? []);
        weapon?.alternativeModes.forEach(mode => {
            const alternative = svgElement('g');
            setAttributes(alternative, { class: mode.displayOnly ? 'equipmentProfile' : 'alternativeMode', 'data-mekbay-mode': mode.name });
            entry.appendChild(alternative);
            drawRow(alternative, mode.name, mode.damage, mode.minimumRange, mode.ranges);
        });
    });
    if (mounts.length === 0) addText(rows, 'No installed equipment.', 10, 47, { size: 8 });
    appendRecordSheetAmmoProfile(group, recordSheetAmmoProfile(entity), {
        x: 10, y: box.height - 12, width: box.width - 20, fontSize: 7, lineHeight: 9,
    });
}

function drawStaticCrew(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'CREW', box);
    addText(group, 'Name:', 9, 33, { size: 8, weight: 700 });
    addText(group, '', 44, 33, { size: 8, maxWidth: box.width - 55 }).id = 'crewName0';
    const name = transparentRect(7, 21, box.width - 14, 17, 'crewNameButton');
    setAttributes(name, { crewId: 0, textElement: 'crewName0' });
    group.appendChild(name);
    addLine(group, 44, 36, box.width - 11, 36, '#aaa', 0.5);
    addText(group, 'Gunnery:', 9, 54, { size: 8, weight: 700 });
    addText(group, '4', 63, 54, { size: 8 }).id = 'gunnerySkill0';
    const skill = transparentRect(56, 42, 26, 18, 'crewSkillButton');
    setAttributes(skill, { crewId: 0, skill: 'gunnery' });
    group.appendChild(skill);
}
