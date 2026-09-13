// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { formatProtectionCounter } from '../record-sheet-protection-counter';

import type { BaseEntity } from '../../../models/entity/base-entity';
import { StaticEmplacementEntity } from '../../../models/entity/entities/misc/static-emplacement-entity';
import { BUILDING_SIDE_LABELS, buildingLocationName, buildingSheetGrid } from '../../../models/entity/types/building';
import {
    fullRecordSheetLayoutProfile,
    type RecordSheetLayoutProfile,
    type RecordSheetPageFormat,
} from '../record-sheet-layout';
import {
    addFrame, addLine, addText, createRoot, drawGeneratedFooter,
    drawPageChrome, formatNumber,
    scalePageBox,
    setAttributes, svgElement, transparentRect, type Box,
} from '../record-sheet-svg-rendering';
import { buildingInventoryPages, drawBuildingInventory, type BuildingInventoryPage } from './building-sheet-inventory';
import { buildingTemplatePages } from './building-template';
import { BUILDING_MAP_KEY as MAP_KEY, buildingMapFeatures, buildingMapDoors, buildingMapFill, buildingDoorPoints, type BuildingMapSymbol as MapSymbol } from '../../building-map-presentation';
import { SvgFrameUtil } from '../svg-frame.util';
import type { RecordSheetLayout, RecordSheetLayoutRequest } from './record-sheet-layout';


/** Building sheets show construction, inventory and a structure map. */
export class StaticEmplacementRecordSheetLayout implements RecordSheetLayout {
    public readonly id = 'static-emplacement';

    public matches(entity: BaseEntity): boolean {
        return entity instanceof StaticEmplacementEntity;
    }

    public profile(_entity: BaseEntity, pageFormat: RecordSheetPageFormat = 'letter'): RecordSheetLayoutProfile {
        return fullRecordSheetLayoutProfile(pageFormat);
    }

    public async generate(entity: BaseEntity, request: RecordSheetLayoutRequest): Promise<SVGSVGElement> {
        return (await this.generatePages(entity, request))[0];
    }

    public async generatePages(entity: BaseEntity, request: RecordSheetLayoutRequest): Promise<readonly SVGSVGElement[]> {
        if (!(entity instanceof StaticEmplacementEntity)) {
            throw new Error('Static-emplacement layout requires a building');
        }
        const page = request.page;
        const data = scalePageBox(page, { x: 18, y: 94, width: 224, height: 347 });
        const inventory = buildingInventoryPages(entity, data.width, data.height - 103);
        const protections = entity.coordinates().reduce((sum, hex) => sum + entity.segmentsInHex(hex), 0);
        const count = Math.max(1, Math.ceil(entity.mapLevels().length / 6), inventory.length, Math.ceil(protections / 36));
        const sheets = Array.from({ length: count }, (_, index) => {
            const svg = createRoot(page.width, page.height, entity.entityType.toLowerCase());
            svg.setAttribute('data-mekbay-design-source', 'native');
            drawBuildingSheet(svg, entity, request, index, inventory[index]);
            addText(svg, `Page ${index + 1} / ${count}`, page.width - 18, page.height - 38,
                { size: 6, anchor: 'end' }).id = 'pageNumber';
            return svg;
        });
        return [...sheets, ...buildingTemplatePages(entity, page)];
    }
}

function drawBuildingSheet(svg: SVGSVGElement, entity: StaticEmplacementEntity, request: RecordSheetLayoutRequest, pageIndex: number, inventoryPage: BuildingInventoryPage | undefined): void {
    const page = request.page;
    const at = (box: Box) => scalePageBox(page, box);
    const grid = buildingSheetGrid(entity.coordinates());
    const floors = entity.height() ?? 1;
    const locations = new Map(grid.hexes.flatMap(cell => Array.from({ length: floors }, (_, floor) =>
        [buildingLocationName(cell.hex, floor), entity.displayLocation(buildingLocationName(cell.hex, floor), true)] as const)));
    drawPageChrome(svg, 'STRUCTURE RECORD SHEET', page, false);
    drawBuildingData(svg, entity, at({ x: 18, y: 94, width: 224, height: 347 }), inventoryPage);
    drawBuildingProtection(svg, entity, at({ x: 18, y: 449, width: 224, height: 266 }), locations, pageIndex);
    const crew = addFrame(svg, 'CREW DATA', at({ x: 18, y: 723, width: 224, height: 33 }), {
        cornerAngleDegrees: { topRight: 45, bottomLeft: 0, bottomRight: 0 },
    });
    addText(crew, 'Crew:', 9, 26, { size: 7, weight: 700 });
    addText(crew, String(entity.crew()), 34, 26, { size: 7 });
    addText(crew, 'Gunnery Skill:', 112, 26, { size: 7, weight: 700 });

    drawBuildingMap(svg, entity, grid, entity.mapLevels().slice(pageIndex * 6, pageIndex * 6 + 6), at({ x: 250, y: 94, width: 344, height: 662 }));
    drawGeneratedFooter(svg, page, { catalystX: page.width - page.margin - 55 * page.horizontalScale,
        catalystY: page.margin + 7 * page.verticalScale, catalystScale: page.horizontalScale });
}

function drawBuildingData(svg: SVGSVGElement, entity: StaticEmplacementEntity, box: Box,
    inventoryPage: BuildingInventoryPage | undefined): void {
    const group = addFrame(svg, 'STRUCTURE DATA', box, { headerWidth: 112, headerHeight: 12, headerFontSize: 10,
        bottomLeftNotchWidth: box.width * .45, cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 } });
    const right = box.width * .64;
    const field = (label: string, value: string, x: number, y: number, offset: number, width: number, id?: string) => {
        addText(group, label, x, y, { size: 6.8, weight: 700 });
        const text = addText(group, value, x + offset, y, { size: 6.8, maxWidth: width });
        if (id) text.id = id;
        return text;
    };
    field('Description:', entity.displayName(), 9, 31, 45, right - 60, 'type').setAttribute('data-mekbay-field', 'display-name');
    field('Levels:', entity.isBridge() ? entity.mapLevels().map(level => entity.levelLabel(level)).join(',') : String(entity.height() ?? 1),
        right, 31, 27, box.width - right - 34);
    field('MP:', entity.isMobile() ? formatNumber(entity.originalWalkMP()) : '0', 9, 43, 18, 30);
    field('Movement Type:', entity.isMobile() ? entity.motiveType() : 'Static', 9, 55, 62, right - 76);
    field('Powerplant Type:', entity.powerSupply().label, 9, 67, 69, right - 84);
    addText(group, 'Tech Base:', right, 43, { size: 6.8, weight: 700 });
    for (const [label, y, checked] of [['Clan', 55, entity.techBase() === 'Clan' || entity.mixedTech()],
        ['Inner Sphere', 67, entity.techBase() !== 'Clan' || entity.mixedTech()]] as const) {
        addText(group, label, right + 3, y, { size: 6.8 });
        const checkbox = svgElement('rect');
        setAttributes(checkbox, { x: box.width - 15, y: y - 6, width: 6, height: 6, rx: 1, fill: 'none', stroke: '#000', 'stroke-width': .8 });
        group.appendChild(checkbox);
        if (checked) {
            const tick = svgElement('path');
            setAttributes(tick, { d: `M${box.width - 14},${y - 3} l1.5,2 l3.5,-5`, fill: 'none', stroke: '#000', 'stroke-width': 1 });
            group.appendChild(tick);
        }
    }
    addLine(group, 7, 74, box.width - 9, 74, '#000', 1.3);
    const inventory = svgElement('g');
    inventory.setAttribute('transform', 'translate(0 75)');
    group.appendChild(inventory);
    drawBuildingInventory(inventory, entity, box.width, box.height - 103, inventoryPage);
    addLine(group, 7, box.height - 24, box.width - 9, box.height - 24, '#000', 1.3);
    addText(group, 'Cost:', 10, box.height - 12, { size: 7, weight: 700 });
    let cost = '—';
    try { cost = entity.cost().toLocaleString('en-US'); } catch { /* An unresolved design still has a printable inventory. */ }
    addText(group, cost, 32, box.height - 12, { size: 7, maxWidth: 80 }).id = 'cost';
    addText(group, 'BV:', 123, box.height - 12, { size: 7, weight: 700 });
    addText(group, formatNumber(entity.battleValue()), 140, box.height - 12, { size: 7, maxWidth: box.width - 151 }).id = 'bv';
}

function drawBuildingProtection(svg: SVGSVGElement, entity: StaticEmplacementEntity, box: Box,
    locations: ReadonlyMap<string, string>, pageIndex: number): void {
    const group = addFrame(svg, 'CF & ARMOR', box, { headerWidth: 86, headerHeight: 12, headerFontSize: 10,
        bottomLeftNotchWidth: box.width * .45, cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 } });
    // CF and armor belong to the hex, not each floor (TO:AR pp. 127–128).
    const groundLocations = new Set(entity.coordinates().map(hex => buildingLocationName(hex, 0)));
    const entries = [...entity.damageLocations()].filter(location => groundLocations.has(location.code)).sort((left, right) =>
        locations.get(left.code)!.localeCompare(locations.get(right.code)!,
            'en', { numeric: true })).flatMap(location => {
                const hex = entity.coordinates().find(hex => buildingLocationName(hex, 0) === location.code)!;
                return entity.usesHexsides() ? BUILDING_SIDE_LABELS.flatMap((label, side) => entity.hasSide(hex, side)
                    ? [{ location, label: entity.displayHex(hex) + '/' + label, side }] : [])
                    : [{ location, label: entity.displayHex(hex), side: -1 }];
            }).slice(pageIndex * 36, pageIndex * 36 + 36);
    const rowCount = Math.max(1, Math.ceil(entries.length / 2));
    const step = Math.min(12, (box.height - 49) / rowCount);
    const width = (box.width - 25) / 2;
    for (let column = 0; column < 2; column++) {
        const x = 9 + column * (width + 7);
        [entity.usesHexsides() ? 'Hex/Side' : 'Hex', entity.isCastleBrian() ? 'CF*' : 'CF', 'Armor'].forEach((label, index) => addText(group, label, x + [17, 52, 83][index], 30,
            { size: 6.5, weight: 700, anchor: 'middle' }));
        for (let row = 0; row < rowCount; row++) {
            const y = 36 + (row + 1) * step;
            const entry = entries[column * rowCount + row];
            if (!entry) continue;
            const location = entry.location;
            const code = (location.sheetCode ?? location.code) + (entry.side < 0 ? '' : '-side-' + entry.side);
            const size = Math.min(7, step * 0.73);
            addText(group, entry.label, x + 17, y, { size, anchor: 'middle', maxWidth: 34 });
            const tracks = [
                ['structure', location.internalPoints, entity.constructionFactor() !== undefined, 52],
                ['armor', location.armor.front, entity.armorValues().has(location.code), 83],
            ] as const;
            for (const [kind, count, specified, offset] of tracks) {
                const value = addText(group, specified ? formatProtectionCounter(count) : '—', x + offset, y, { size, anchor: 'middle', maxWidth: 28 });
                value.id = `${kind === 'armor' ? 'textArmor' : 'textIS'}_${code}`;
                if (specified) setAttributes(value, { 'data-mekbay-protection-value': kind, 'data-loc': code });
                if (count > 0) {
                    const hit = transparentRect(x + offset - 14, y - step + 2, 28, step, `unitLocation ${kind}`);
                    hit.setAttribute('data-loc', code);
                    group.appendChild(hit);
                }
            }
        }
    }
}

function mapKeySymbol(parent: SVGGElement, symbol: MapSymbol, x: number, y: number): void {
    if (symbol === 'large-door') {
        const opening = svgElement('g');
        opening.setAttribute('data-building-symbol', symbol);
        parent.appendChild(opening);
        addLine(opening, x, y, x + 12, y, '#000', 2);
        mapKeySymbol(opening, 'door', x, y);
        mapKeySymbol(opening, 'door', x + 12, y);
        return;
    }
    const marker = svgElement('polygon');
    const points = !MAP_KEY[symbol].glyph ? [[0, -4], [3.5, 3], [-3.5, 3]]
        : [[-6, 0], [-3, -4], [3, -4], [6, 0], [3, 4], [-3, 4]];
    setAttributes(marker, { fill: MAP_KEY[symbol].color, stroke: '#000', 'stroke-width': .8,
        points: points.map(([dx, dy]) => `${x + dx},${y + dy}`).join(' ') });
    parent.appendChild(marker);
    if (!MAP_KEY[symbol].glyph) marker.setAttribute('data-building-symbol', symbol);
    else addText(parent, MAP_KEY[symbol].glyph, x, y + 2, { size: 6, anchor: 'middle', weight: 700 })
        .setAttribute('data-building-symbol', symbol);
}

function drawBuildingMap(svg: SVGSVGElement, entity: StaticEmplacementEntity, grid: ReturnType<typeof buildingSheetGrid>, levels: readonly number[], box: Box): void {
    const header = SvgFrameUtil.createSVGFrameHeader('STRUCTURE MAP', 139);
    header.setAttribute('transform', `translate(${formatNumber(box.x + (box.width - 139) / 2)} ${formatNumber(box.y - 24)})`);
    svg.appendChild(header);
    const floors = levels.length;
    if (!floors) return;
    // A flattened, sheared flat-top grid matches the printed structure-map perspective.
    const left = -20 - 6 * (grid.rows - 1);
    const top = -6;
    const width = 30 * (grid.columns - 1) + 40 + 6 * (grid.rows - 1);
    const height = 12 * (grid.rows + 0.5);
    const features = new Map(grid.hexes.flatMap(cell => levels.map(level =>
        [buildingLocationName(cell.hex, level), buildingMapFeatures(entity, cell.hex, level)] as const)));
    const symbols = [...new Set([...features.values()].flat())];
    const keyColumns = Math.max(1, Math.floor(box.width / 110));
    const keyHeight = symbols.length ? Math.ceil(symbols.length / keyColumns) * 16 + 12 : 0;
    const scale = Math.min((box.width - 8) / width, (box.height - keyHeight - floors * 18) / (floors * height));
    const layerHeight = height * scale + 18;
    const headerGap = Math.min(24, Math.max(0, box.height - keyHeight - floors * layerHeight));
    // Placement is independent of the 0101 labels. An odd column shift also moves odd rows
    // so the footprint remains a cube translation on the staggered wireframe.
    let columnPadding = Math.floor((grid.columns - Math.max(...grid.hexes.map(cell => cell.column)) - 1) / 2);
    const shiftedRow = (cell: typeof grid.hexes[number]) => cell.row + (columnPadding % 2) * (cell.column % 2);
    let minRow = Math.min(...grid.hexes.map(shiftedRow));
    let maxRow = Math.max(...grid.hexes.map(shiftedRow));
    if (maxRow - minRow + 1 > grid.rows) {
        // A full-height footprint may only fit with its original column parity.
        columnPadding--;
        minRow = Math.min(...grid.hexes.map(shiftedRow));
        maxRow = Math.max(...grid.hexes.map(shiftedRow));
    }
    const rowPadding = Math.floor((grid.rows - (maxRow - minRow + 1)) / 2) - minRow;
    const occupied = new Map(grid.hexes.map(cell =>
        [`${cell.column + columnPadding},${shiftedRow(cell) + rowPadding}`, cell]));
    const center = (column: number, row: number) => {
        const staggeredRow = row + column % 2 / 2;
        return { x: (column * 30 - staggeredRow * 6 - left) * scale, y: (staggeredRow * 12 - top) * scale };
    };
    const corners = [[-20, 0], [-7, -6], [13, -6], [20, 0], [7, 6], [-13, 6]];
    for (const [index, floor] of levels.entries()) {
        const layer = svgElement('g');
        setAttributes(layer, { class: 'building-map-layer', 'data-building-floor': floor,
            transform: `translate(${formatNumber(box.x + (box.width - width * scale) / 2)} ${formatNumber(box.y + headerGap + index * layerHeight)})` });
        svg.appendChild(layer);
        const outlines = svgElement('g');
        const footprint = svgElement('g');
        const annotations = svgElement('g');
        layer.append(outlines, footprint, annotations);
        for (let column = 0; column < grid.columns; column++) for (let row = 0; row < grid.rows; row++) {
            const candidate = occupied.get(`${column},${row}`);
            const cell = candidate && entity.occupiesMapLevel(candidate.hex, floor) && entity.segmentsInHex(candidate.hex) > 0 ? candidate : undefined;
            const cellFeatures = cell ? features.get(buildingLocationName(cell.hex, floor)) ?? [] : [];
            const { x, y } = center(column, row);
            const polygon = svgElement('polygon');
            setAttributes(polygon, { class: cell ? 'building-hex occupied' : 'building-hex',
                points: corners
                    .map(([dx, dy]) => `${formatNumber(x + dx * scale)},${formatNumber(y + dy * scale)}`).join(' '),
                fill: buildingMapFill(cellFeatures) ?? 'none',
                stroke: cell && !entity.usesHexsides() ? '#000' : '#bbb', 'stroke-width': cell && !entity.usesHexsides() ? 1.5 : 0.35,
                'stroke-linejoin': 'round' });
            (cell ? footprint : outlines).appendChild(polygon);
            if (cell) {
                if (entity.usesHexsides()) for (let side = 0; side < 6; side++) {
                    if (!entity.hasSide(cell.hex, side)) continue;
                    const a = corners[(side + 1) % 6], b = corners[(side + 2) % 6];
                    const line = addLine(annotations, x + a[0] * scale, y + a[1] * scale, x + b[0] * scale, y + b[1] * scale, '#000', 1.8);
                    setAttributes(line, { 'data-building-side': side, 'data-building-hex': cell.label });
                }
                polygon.setAttribute('data-loc', buildingLocationName(cell.hex, floor));
                polygon.setAttribute('data-building-hex', cell.label);
                polygon.setAttribute('data-building-features', cellFeatures.join(' '));
                const glyphs = cellFeatures.filter(symbol => MAP_KEY[symbol].glyph);
                for (const door of buildingMapDoors(entity, cell.hex, floor)) {
                    const a = corners[(door.facing + 1) % 6], b = corners[(door.facing + 2) % 6];
                    const marker = svgElement('polygon');
                    const project = ([px, py]: readonly number[]) => [20 * px - Math.sqrt(12) * py, Math.sqrt(48) * py] as const;
                    const points = door.geometry ? door.geometry.arrow.map(project) : buildingDoorPoints(a, b);
                    if (door.geometry) {
                        const opening = svgElement('polyline');
                        setAttributes(opening, { class: 'linked-door-opening', fill: 'none', stroke: '#000', 'stroke-width': 2.5,
                            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
                            points: door.geometry.line.map(project).map(([px, py]) => `${x + px * scale},${y + py * scale}`).join(' ') });
                        annotations.appendChild(opening);
                    }
                    setAttributes(marker, { 'data-building-symbol': door.symbol, 'data-building-facing': door.facing,
                        points: points.map(([px, py]) => `${x + px * scale},${y + py * scale}`).join(' '),
                        fill: MAP_KEY[door.symbol].color, stroke: '#000', 'stroke-width': .8, 'stroke-linejoin': 'miter' });
                    annotations.appendChild(marker);
                }
                const label = addText(annotations, glyphs.length ? '' : cell.label, x, y + 2.3 * scale,
                    { size: 6.5 * scale, anchor: 'middle' });
                if (glyphs.length) {
                    // A single anchored text run centers the symbols, gap and coordinate as one unit.
                    glyphs.forEach((symbol, index) => {
                        const glyph = svgElement('tspan');
                        setAttributes(glyph, { 'data-building-symbol': symbol, 'font-size': 5.5 * scale, 'font-weight': 700, dx: index ? scale : 0 });
                        glyph.textContent = MAP_KEY[symbol].glyph;
                        label.appendChild(glyph);
                    });
                    const coordinate = svgElement('tspan');
                    coordinate.setAttribute('dx', String(1.5 * scale));
                    coordinate.textContent = cell.label;
                    label.appendChild(coordinate);
                }
            }
        }
        addText(layer, `Level: ${entity.levelLabel(floor, true)}`, width * scale, height * scale + 10,
            { size: 7, weight: 700, anchor: 'end' });
    }
    if (symbols.length) {
        const key = svgElement('g');
        setAttributes(key, { class: 'building-map-key', transform: `translate(${box.x + 8} ${box.y + headerGap + floors * layerHeight + 6})` });
        svg.appendChild(key);
        symbols.forEach((symbol, index) => {
            const x = index % keyColumns * ((box.width - 16) / keyColumns), y = Math.floor(index / keyColumns) * 16;
            mapKeySymbol(key, symbol, x + 6, y + 4);
            addText(key, MAP_KEY[symbol].label, x + (symbol === 'large-door' ? 29 : 17), y + 6, { size: 6.5 });
        });
    }
}
