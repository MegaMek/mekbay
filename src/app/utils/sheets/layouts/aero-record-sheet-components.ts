// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import { type AeroEntity } from '../../../models/entity/entities/aero/aero-entity';
import {
    type BipedArmorValues,
    type BipedPaperdollPipLayout,
    BipedPaperdollUtil,
} from '../biped-paperdoll.util';
import { type EntityDamageLocation } from '../../../models/entity/types';
import { SvgFrameUtil } from '../svg-frame.util';
import { projectRecordSheetBays } from '../../../models/entity/bays/record-sheet-bay-projection';
import {
    type Box,
    XLINK_NS,
    addFrame,
    addLine,
    addText,
    appendLegacyIdentityAnchors,
    circle,
    decoratePaperdollPips,
    drawHeatScale,
    formatNumber,
    formatTechBase,
    formatWholeNumber,
    makePips,
    paperdollPipOptions,
    setAttributes,
    setInventoryComponentIds,
    svgElement,
    transparentRect,
} from '../record-sheet-svg-rendering';

export interface AeroDataInventoryRow {
    readonly id: string;
    readonly kind: 'equipment' | 'bay';
    readonly quantity?: number;
    readonly nameLines: readonly string[];
    readonly location: string;
    readonly heat: string;
    readonly damageByRange: readonly [string, string, string, string];
    readonly componentIds: readonly string[];
}

export interface AeroDataPanelContent {
    readonly panelTitle: string;
    readonly identity: 'fighter' | 'small-craft' | 'large-vessel';
    readonly inventoryRows: readonly AeroDataInventoryRow[];
    readonly flowCargoAfterInventory: boolean;
    readonly showAmmoSummary: boolean;
    readonly stationary: boolean;
}

export interface AeroPaperdollPresentation {
    readonly assetUrl: string;
    readonly capitalFallback: boolean;
    readonly pipLayout?: BipedPaperdollPipLayout;
}

/** Reusable drawing components. Family layouts supply all presentation policy. */
export function drawAeroDataPanel(
    svg: SVGSVGElement,
    entity: AeroEntity,
    box: Box,
    authoredHeight: number,
    content: AeroDataPanelContent,
): SVGGElement {
    const group = addFrame(svg, content.panelTitle, box, {
        bottomLeftNotchWidth: box.width * 0.36,
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45 },
    });
    group.setAttribute('data-mekbay-region', 'aero-data');
    const referenceHeight = authoredHeight;
    const sx = box.width / 222.4;
    const sy = box.height / authoredHeight;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const engine = entity.mountedEngine();

    addText(group, 'Type:', x(6), y(28), { size: font(9.67), weight: 700 });
    const type = addText(group, entity.displayName(), x(32.229), y(28), {
        size: font(9.67), weight: 700, maxWidth: x(187),
    });
    type.id = 'type';
    type.setAttribute('data-mekbay-field', 'display-name');

    const stationary = content.stationary;
    if (content.identity === 'large-vessel') {
        addText(group, 'Name:', x(6), y(38), { size: font(7.7), weight: 700 });
        const fluffName = addText(group, '', x(31.315), y(38), { size: font(7.7), maxWidth: x(74) });
        fluffName.id = 'fluffName';
        addLine(group, x(31.315), y(39), x(105.218), y(39), '#000', 0.72 * fontScale);
    }
    const thrustBaseline = content.identity === 'large-vessel' ? 47 : 38;
    const safeBaseline = content.identity === 'large-vessel' ? 56 : 47;
    const maximumBaseline = content.identity === 'large-vessel' ? 65 : 56;
    const leftFacts: readonly [string, string, number, string?][] = content.identity === 'fighter'
        ? [
            ['Thrust:', stationary ? 'Station Keeping Only' : '', thrustBaseline],
            ['Safe Thrust:', stationary ? '' : String(entity.safeThrust()), safeBaseline, 'mpWalk'],
            ['Maximum Thrust:', stationary ? '' : String(entity.maxThrust()), maximumBaseline, 'mpRun'],
            ['Engine Type:', stationary ? '—' : `${engine.rating} ${engine.type()}`, 65, 'engineType'],
        ]
        : [
            ['Thrust:', stationary ? 'Station Keeping Only' : '', thrustBaseline],
            ['Safe Thrust:', stationary ? '' : String(entity.safeThrust()), safeBaseline, 'mpWalk'],
            ['Maximum Thrust:', stationary ? '' : String(entity.maxThrust()), maximumBaseline, 'mpRun'],
        ];
    leftFacts.forEach(([label, value, baseline, id]) => {
        addText(group, label, x(label === 'Safe Thrust:' || label === 'Maximum Thrust:' ? 9.844 : 6), y(baseline), {
            size: font(7.7), weight: 700,
        });
        const node = addText(group, value, x(label === 'Engine Type:' ? 56 : 79.844), y(baseline), {
            size: font(7.7), maxWidth: x(47), anchor: value && label !== 'Engine Type:' ? 'middle' : 'start',
        });
        if (id) node.id = id;
    });
    const rightFacts: readonly [string, string, number, string, string?][] = [
        ['Tonnage:', formatWholeNumber(entity.tonnage()), 38, 'tonnage', 'tonnage'],
        ['Tech Base:', formatTechBase(entity.techBase(), entity.mixedTech()), 47, 'techBase', 'tech-base'],
        ['Role:', entity.role() || '—', 56, 'role', 'role'],
    ];
    rightFacts.forEach(([label, value, baseline, id, field]) => {
        addText(group, label, x(115.7), y(baseline), { size: font(7.7), weight: 700 });
        const node = addText(group, value, x(158.24), y(baseline), { size: font(7.7), maxWidth: x(58) });
        node.id = id;
        if (field) node.setAttribute('data-mekbay-field', field);
    });

    addLine(group, x(3), y(69), x(219.4), y(69), '#000', 1.932 * fontScale);
    addText(group, 'Weapons & Equipment Inventory', x(3), y(79), {
        size: font(8.6), weight: 700, maxWidth: x(155),
    });
    addText(group, 'Standard Scale', x(7.328), y(89.8), { size: font(6.76), weight: 700 });
    const rangeHeadings: readonly [string, number][] = [
        ['(1-6)', 152.316], ['(7-12)', 169.628], ['(13-20)', 186.94], ['(21-25)', 204.252],
    ];
    rangeHeadings.forEach(([label, position]) => addText(group, label, x(position), y(89.8), {
        size: font(5.8), anchor: 'middle', maxWidth: x(16.312),
    }));
    const headings: readonly [string, number, 'start' | 'middle'][] = [
        ['#', 8.41, 'middle'], ['Type', 13.82, 'start'], ['Loc', 109.036, 'middle'], ['Ht', 132.84, 'middle'],
        ['SRV', 152.316, 'middle'], ['MRV', 169.628, 'middle'], ['LRV', 186.94, 'middle'], ['ERV', 204.252, 'middle'],
    ];
    headings.forEach(([label, position, anchor]) => addText(group, label, x(position), y(100.6), {
        size: font(6.76), weight: 700, anchor,
    }));

    const cargoLines = aeroCargoLines(entity);
    const footerReserve = 46.466 + cargoLines.length * 8.5;
    const rowStep = 9.126;
    const maxRows = Math.max(1, Math.floor((referenceHeight - 105.937 - footerReserve) / rowStep));
    const rows = takeAeroInventoryRows(content.inventoryRows, maxRows);
    let displayLine = 0;
    rows.forEach(row => {
        const lineCount = Math.max(1, row.nameLines.length);
        const baseline = y(110.5 + displayLine * rowStep);
        const entry = svgElement('g');
        entry.setAttribute('class', row.kind === 'bay' ? 'inventoryEntry bay' : 'inventoryEntry');
        entry.id = row.id;
        setInventoryComponentIds(entry, row.componentIds);
        entry.appendChild(transparentRect(x(2), baseline - y(rowStep), x(139.5), y(rowStep * lineCount),
            'inventoryEntryButton mainButton'));
        [143.5, 160.97, 178.28, 195.94].forEach((position, rangeIndex) => entry.appendChild(
            transparentRect(x(position), baseline - y(rowStep), x(rangeIndex === 3 ? 16.63 : 17.31), y(rowStep),
                `inventoryEntryButton ${['shrButton', 'medButton', 'lngButton', 'extButton'][rangeIndex]}`),
        ));
        const badgeY = baseline - y(rowStep) + y(rowStep * 0.08);
        const badgeHeight = y(rowStep * 0.84);
        const hitModRect = svgElement('rect');
        setAttributes(hitModRect, {
            x: x(0.35), y: badgeY, width: x(6.2), height: badgeHeight,
            rx: x(0.6), fill: '#000', class: 'hitMod-rect', display: 'none',
        });
        entry.appendChild(hitModRect);
        const targetTnRect = svgElement('rect');
        setAttributes(targetTnRect, {
            x: x(213), y: badgeY, width: x(6), height: badgeHeight,
            fill: '#fff', stroke: '#000', 'stroke-width': 0.65,
            class: 'targetTn-rect', display: 'none',
        });
        entry.appendChild(targetTnRect);
        if (row.quantity !== undefined) {
            addText(entry, String(row.quantity), x(8.41), baseline, {
                class: 'quantity', size: font(6.76), anchor: 'middle',
            });
        }
        row.nameLines.forEach((name, lineIndex) => addText(
            entry,
            name,
            x(row.kind === 'bay' ? lineIndex === 0 ? 7.328 : 11.656 : 13.82),
            baseline + y(lineIndex * rowStep),
            { class: lineIndex === 0 ? 'name' : 'name continuation', size: font(6.76), maxWidth: x(97) },
        ));
        addText(entry, row.location, x(109.036), baseline, { class: 'location', size: font(6.76), anchor: 'middle', maxWidth: x(21) });
        addText(entry, row.heat, x(132.84), baseline, { class: 'heat', size: font(6.76), anchor: 'middle' });
        row.damageByRange.forEach((value, rangeIndex) => addText(
            entry,
            value,
            x([152.316, 169.628, 186.94, 204.252][rangeIndex]),
            baseline,
            {
                class: ['range_short', 'range_medium', 'range_long', 'range_extreme'][rangeIndex],
                size: font(6.76), anchor: 'middle', maxWidth: x(16.312),
            },
        ));
        const hitMod = addText(entry, '', x(3.45), badgeY + badgeHeight * 0.73, {
            class: 'hitMod-text', size: font(4.2), weight: 700, fill: '#fff', anchor: 'middle',
        });
        hitMod.setAttribute('display', 'none');
        const targetTn = addText(entry, '', x(216), badgeY + badgeHeight * 0.73, {
            class: 'targetTn-text', size: font(4.2), weight: 700, anchor: 'middle',
        });
        targetTn.setAttribute('display', 'none');
        group.appendChild(entry);
        displayLine += lineCount;
    });

    let detailY = 110.5 + displayLine * rowStep + 4.563;
    if (entity.tracksHeat() && detailY < referenceHeight - footerReserve - 5) {
        const heatProfile = addText(group,
            `Maximum Heat (Dissipation): ${Math.max(0, entity.heatGeneration())} (${Math.max(0, entity.heatDissipation())})`,
            x(8.41), y(detailY), { size: font(6.76), maxWidth: x(204) });
        heatProfile.id = 'heatProfile';
        detailY += 10;
    }
    const gravDecks = readEntityNumberArraySignal(entity, 'gravDecks');
    if (gravDecks.length > 0 && detailY < referenceHeight - footerReserve) {
        addText(group, 'Grav Decks:', x(8), y(detailY), { size: font(6.2), weight: 700 });
        addText(group, gravDecks.map((diameter, index) => `#${index + 1}: ${formatWholeNumber(diameter)}m`).join(' · '),
            x(52), y(detailY), { size: font(5.8), maxWidth: x(160) });
        detailY += 10;
    }
    if (cargoLines.length > 0) {
        if (content.flowCargoAfterInventory) {
            detailY = 110.5 + displayLine * rowStep + rowStep;
            addText(group, 'Cargo:', x(7.328), y(detailY), { size: font(6.76), weight: 700 });
            cargoLines.forEach((line, index) => addText(group, line, x(7.328), y(detailY + (index + 1) * rowStep), {
                size: font(6.76), maxWidth: x(205),
            }));
        } else {
            const cargoStart = referenceHeight - 48 - cargoLines.length * 8.5;
            addText(group, 'Cargo:', x(8), y(cargoStart - 2), { size: font(6.4), weight: 700 });
            cargoLines.forEach((line, index) => addText(group, line, x(8), y(cargoStart + 7 + index * 8.5), {
                size: font(5.8), maxWidth: x(204),
            }));
        }
    }
    const ammo = aeroAmmoSummary(entity);
    const largeVesselFooterShift = content.identity === 'fighter' ? 0 : 1.5;
    if (content.showAmmoSummary && ammo) addText(
        group,
        `Ammo: ${ammo}`,
        x(8.41),
        box.height - y(41.903 + largeVesselFooterShift),
        {
        size: font(6.76), maxWidth: x(204),
        },
    );
    addText(group, `Fuel Points: ${formatWholeNumber(entity.fuel())}`, x(8.41),
        box.height - y(32.777 + largeVesselFooterShift), {
        size: font(6.76), maxWidth: x(204),
    });
    addLine(group, x(3), box.height - y(26.214 + largeVesselFooterShift), x(219.4),
        box.height - y(26.214 + largeVesselFooterShift), '#000', 1.932 * fontScale);
    addText(group, 'BV:', x(13.845), box.height - y(14.214 + largeVesselFooterShift), {
        size: font(9.67), weight: 700,
    });
    const bv = addText(group, formatWholeNumber(entity.battleValue()), x(32.79),
        box.height - y(14.214 + largeVesselFooterShift), {
        size: font(9.67),
    });
    bv.id = 'bv';
    appendLegacyIdentityAnchors(group, entity, box);
    return group;
}

function takeAeroInventoryRows(
    rows: readonly AeroDataInventoryRow[],
    maxLines: number,
): readonly AeroDataInventoryRow[] {
    const result: AeroDataInventoryRow[] = [];
    let usedLines = 0;
    for (const row of rows) {
        const lineCount = Math.max(1, row.nameLines.length);
        if (usedLines + lineCount > maxLines) break;
        result.push(row);
        usedLines += lineCount;
    }
    return result;
}

function aeroCargoLines(entity: AeroEntity): readonly string[] {
    const lines = projectRecordSheetBays(entity.transporters()).map(group => {
        const members = group.members.map(member => `${member.typeName} (${formatWholeNumber(member.capacity)})`).join(' + ');
        return `Bay ${group.bayNumber}: ${members} (${group.doors} ${group.doors === 1 ? 'Door' : 'Doors'})`;
    });
    const troopSpace = entity.transporters()
        .filter(transporter => transporter.kind === 'troop-space')
        .reduce((sum, transporter) => sum + transporter.totalSpace, 0);
    if (troopSpace > 0) lines.push(`Infantry Compartment: ${formatWholeNumber(troopSpace)} tons`);
    return lines.slice(0, 9);
}

function aeroAmmoSummary(entity: AeroEntity): string {
    const grouped = new Map<string, number>();
    entity.equipment().forEach(mount => {
        const shots = mount.getAmmoShots();
        if (shots === undefined) return;
        const label = mount.displayName()
            .replace(/\s+ammo(?:unition)?\b.*$/iu, '')
            .replace(/\s*\([^)]*shots?\)\s*$/iu, '')
            .trim();
        grouped.set(label, (grouped.get(label) ?? 0) + shots);
    });
    return [...grouped.entries()]
        .map(([label, shots]) => `(${label}) ${formatWholeNumber(shots)}`)
        .join(', ');
}

export async function drawAeroPaperdoll(
    svg: SVGSVGElement,
    entity: AeroEntity,
    box: Box,
    authoredHeight: number,
    presentation: AeroPaperdollPresentation,
): Promise<void> {
    const pipLayout = presentation.pipLayout ?? 'classic';
    const armorValues: Record<string, number> = {};
    const structureValues: Record<string, number> = {};
    const locations = entity.damageLocations();
    for (const location of locations) {
        const code = location.sheetCode ?? location.code;
        const armor = location.armor.front + location.armor.rear;
        if (armor > 0) armorValues[code] = armor;
        if (location.internalPoints > 0) structureValues[code] = location.internalPoints;
    }
    try {
        const paperdoll = await BipedPaperdollUtil.createDamagePaperdoll(
            presentation.assetUrl,
            box.width,
            box.height,
            armorValues as BipedArmorValues,
            structureValues,
            {
                className: 'aero-paperdoll-layer',
                centeredHorizontally: false,
                centeredVertically: false,
                preserveAuthoredCoordinates: true,
                scale: false,
                pipLayout,
                pipOptions: {
                    ...paperdollPipOptions(pipLayout, 3, 0.58),
                    strokeWidth: 0.5,
                },
            },
        );
        paperdoll.setAttribute(
            'transform',
            `translate(${formatNumber(box.x)} ${formatNumber(box.y)}) `
            + `scale(${formatNumber(box.width / 344)} ${formatNumber(box.height / authoredHeight)})`,
        );
        paperdoll.setAttribute('data-mekbay-aero-asset', presentation.assetUrl);
        decoratePaperdollPips(paperdoll);
        updateAeroPaperdollLabels(paperdoll, locations);
        svg.appendChild(paperdoll);
    } catch {
        drawAeroDamagePanel(svg, entity, box, presentation.capitalFallback);
    }
}

function updateAeroPaperdollLabels(layer: SVGGElement, locations: readonly EntityDamageLocation[]): void {
    const values = new Map(locations.map(location => [location.sheetCode ?? location.code, location]));
    values.forEach((location, code) => {
        const total = location.armor.front + location.armor.rear;
        if (total > 0) setAeroPaperdollText(layer, `textArmor_${code}`, `${Math.ceil(total / 10)} ( ${total} )`);
    });
    const structural = (code: string): number => values.get(code)?.internalPoints ?? 0;
    if (!setAeroPaperdollText(layer, 'textSI', String(structural('SI')))) {
        setAeroLabeledValue(layer, 'Structural', structural('SI'));
    }
    if (!setAeroPaperdollText(layer, 'textKFIntegrity', String(structural('KF')))) {
        setAeroLabeledValue(layer, 'K-F Drive', structural('KF'));
    }
    if (!setAeroPaperdollText(layer, 'textSailIntegrity', String(structural('SAIL')))) {
        setAeroLabeledValue(layer, 'Sail Integrity:', structural('SAIL'));
    }
    if (!setAeroPaperdollText(layer, 'textDockingCollars', String(structural('DC')))) {
        setAeroLabeledValue(layer, 'Docking Collars:', structural('DC'));
    }
}

function setAeroPaperdollText(layer: SVGGElement, id: string, value: string): boolean {
    const node = layer.querySelector<SVGElement>(`#${id}`);
    if (!node) return false;
    const span = node.tagName.toLowerCase() === 'text'
        ? node.querySelector<SVGTSpanElement>('tspan')
        : null;
    (span ?? node).textContent = value;
    return true;
}

function setAeroLabeledValue(layer: SVGGElement, label: string, value: number): void {
    for (const text of Array.from(layer.querySelectorAll<SVGTextElement>('text'))) {
        const spans = Array.from(text.querySelectorAll<SVGTSpanElement>('tspan'));
        const labelIndex = spans.findIndex(span => span.textContent?.trim() === label);
        if (labelIndex < 0) continue;
        for (let index = labelIndex + 1; index < spans.length; index++) {
            const content = spans[index].textContent?.trim() ?? '';
            if (/^-?\d+(?:\.\d+)?$/u.test(content)) {
                spans[index].textContent = String(value);
                return;
            }
        }
    }
}

export function drawAeroExternalStores(svg: SVGSVGElement, entity: AeroEntity, box: Box): void {
    const group = svgElement('g');
    group.setAttribute('class', 'aero-external-stores');
    group.setAttribute('transform', `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`);
    const sx = box.width / 124.466;
    const sy = box.height / 127;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);
    const heading = SvgFrameUtil.createSVGFrameHeader('EXTERNAL STORES/BOMBS', box.width, {
        headerWidth: box.width,
        headerFontSize: font(8.6),
        cornerAngleDegrees: 45,
    });
    heading.setAttribute('transform', 'translate(1 -1.372)');
    group.appendChild(heading);
    const count = Math.max(1, Math.min(20, Math.floor(entity.tonnage() / 5)));
    const columns = 5;
    for (let index = 0; index < count; index++) {
        const row = Math.floor(index / columns);
        const rowCount = Math.min(columns, count - row * columns);
        const column = index % columns;
        const centeredColumn = column + (columns - rowCount) / 2;
        const rect = svgElement('rect');
        setAttributes(rect, {
            x: x(6.408 + centeredColumn * 23.7935),
            y: y(15.25 + row * 23.794),
            width: x(21.793),
            height: y(21.794),
            rx: x(4.3),
            fill: 'none',
            stroke: '#000',
            'stroke-width': font(0.966),
            class: 'externalStore bombButton bombBox',
        });
        rect.setAttribute('data-store-index', String(index));
        group.appendChild(rect);
    }
    addText(group, 'Key:', x(59.484), y(93.631), { size: font(5.7), weight: 700 });
    addText(group, 'HE - High Explosive', x(59.484), y(100.631), { size: font(5.7) });
    addText(group, 'LG - Laser Guided', x(59.484), y(107.631), { size: font(5.7) });
    addText(group, 'C - Cluster', x(59.484), y(114.631), { size: font(5.7) });
    addText(group, 'RL - Rocket Launcher', x(59.484), y(121.631), { size: font(5.7) });
    svg.appendChild(group);
}

export function drawAeroMovementCompass(svg: SVGSVGElement, box: Box): void {
    const group = svgElement('g');
    group.setAttribute('class', 'aero-movement-compass');
    group.setAttribute('transform', `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`);
    const sx = box.width / 90;
    const sy = box.height / 50;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);
    addText(group, 'Advanced', x(22.5), y(15.5), {
        size: font(9.35), weight: 700, anchor: 'middle',
    });
    addText(group, 'Movement', x(22.5), y(25.5), {
        size: font(9.35), weight: 700, anchor: 'middle',
    });
    addText(group, 'Compass', x(22.5), y(35.5), {
        size: font(9.35), weight: 700, anchor: 'middle',
    });
    const points = [
        [58.84, 10], [50.179, 25], [58.84, 40],
        [76.16, 40], [84.821, 25], [76.16, 10],
    ].map(([px, py]) => `${formatNumber(x(px))},${formatNumber(y(py))}`).join(' ');
    const hex = svgElement('polygon');
    setAttributes(hex, {
        points,
        fill: 'none',
        stroke: '#000',
        'stroke-width': font(2.9),
    });
    group.appendChild(hex);
    const labels: readonly [string, number, number][] = [
        ['A', 67.5, 7], ['B', 85.321, 17], ['C', 85.321, 38],
        ['D', 67.5, 49], ['E', 49.679, 38], ['F', 49.679, 17],
    ];
    labels.forEach(([label, px, py]) => {
        addText(group, label, x(px), y(py), {
            size: font(9.35), weight: 700, anchor: 'middle',
        });
    });
    svg.appendChild(group);
}

export function drawAeroArtworkRegion(svg: SVGSVGElement, entity: AeroEntity, box: Box): void {
    const group = svgElement('g');
    group.setAttribute('class', 'referenceTable aero-artwork-region');
    group.setAttribute('data-mekbay-region', 'center-panel');
    group.setAttribute('transform', `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`);
    const bounds = svgElement('rect');
    setAttributes(bounds, { x: 0, y: 0, width: box.width, height: box.height, fill: 'transparent', stroke: 'none' });
    group.appendChild(bounds);
    const encoded = entity.fluffImageEncoded().trim();
    if (encoded) {
        const image = svgElement('image');
        setAttributes(image, { x: 0, y: 0, width: box.width, height: box.height, preserveAspectRatio: 'xMidYMid meet' });
        image.setAttributeNS(XLINK_NS, 'href', encoded.startsWith('data:') ? encoded : `data:image/png;base64,${encoded}`);
        image.id = 'fluff-image';
        group.appendChild(image);
    }
    svg.appendChild(group);
}

export function drawAeroVelocityPanel(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'VELOCITY RECORD', box, {
        fullWidthHeader: true,
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    group.setAttribute('data-mekbay-region', 'velocity-record');
    // MegaMekLab authors this panel in a 377.7 x 151.88 coordinate space.
    // Keep those proportions explicit: the short rows and wide label column are
    // visually distinctive and also leave enough room for "Effective Velocity".
    const sx = box.width / 377.7;
    const sy = box.height / 151.88;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);
    const left = 4.5;
    const width = 370;
    const labelBoundary = 78.5;
    const turnWidth = 29.15;
    const tableHeight = 40.164;
    const rowHeight = 8.033;
    const labels = ['Turn #', 'Thrust', 'Velocity', 'Effective Velocity', 'Altitude'];
    [31.388, 91.634].forEach((top, tableIndex) => {
        const border = svgElement('rect');
        setAttributes(border, {
            x: x(left),
            y: y(top),
            width: x(width),
            height: y(tableHeight),
            rx: x(1.315),
            fill: 'none',
            stroke: '#000',
            'stroke-width': 1,
        });
        group.appendChild(border);
        for (let row = 1; row < labels.length; row++) {
            addLine(
                group,
                x(left),
                y(top + row * rowHeight),
                x(left + width),
                y(top + row * rowHeight),
                '#000',
                0.58,
            );
        }
        for (let column = 0; column < 10; column++) {
            const boundary = labelBoundary + column * turnWidth;
            addLine(
                group,
                x(boundary),
                y(top),
                x(boundary),
                y(top + tableHeight),
                '#000',
                0.58,
            );
        }
        labels.forEach((label, rowIndex) => {
            addText(group, label, x(7.5), y(top + 7.049 + rowIndex * rowHeight), {
                size: font(6.76),
                weight: 700,
            });
        });
        for (let column = 0; column < 10; column++) {
            addText(
                group,
                String(tableIndex * 10 + column + 1),
                x(93.075 + column * turnWidth),
                y(top + 7.049),
                { size: font(6.76), weight: 700 },
            );
        }
    });
}

export function drawAeroHeatDataPanel(svg: SVGSVGElement, entity: AeroEntity, box: Box, detailed: boolean): void {
    const group = addFrame(svg, 'HEAT DATA', box, {
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    group.id = 'heatDataPanel';
    const heatSinkCount = Math.max(0, entity.heatSinkCount());
    const detailedSx = box.width / 161;
    const detailedSy = box.height / 246.6;
    const detailedX = (value: number): number => value * detailedSx;
    const detailedY = (value: number): number => value * detailedSy;
    const detailedFont = (value: number): number => value * Math.min(detailedSx, detailedSy);
    const hsType = addText(group, 'Heat Sinks:', detailed ? detailedX(149) : box.width - 12, detailed ? detailedY(22) : 26, {
        size: detailed ? detailedFont(8.44) : 5.8, anchor: 'end',
    });
    hsType.id = 'hsType';
    const count = addText(group, String(heatSinkCount), detailed ? detailedX(149) : 35, detailed ? detailedY(31) : 44, {
        size: detailed ? detailedFont(8.44) : 15, weight: detailed ? 400 : 700, anchor: 'end',
    });
    count.id = 'hsCount';
    if (!detailed) {
        addText(group, 'Heat Generation Per Arc:', 74, 29, { size: 5.9, weight: 700, maxWidth: box.width - 80 });
        const heatByArc = new Map<string, number>();
        entity.rangedWeapons().forEach(mount => {
            const location = mount.getOccupiedLocations().map(value => entity.componentLocationLabel(value)).join('/') || '—';
            heatByArc.set(location, (heatByArc.get(location) ?? 0) + mount.equipment.heat);
        });
        [...heatByArc.entries()].slice(0, 7).forEach(([arc, heat], index) => {
            addText(group, `${arc}:`, 74, 41 + index * 8, { size: 5.3, weight: 700, maxWidth: box.width * 0.52 });
            addText(group, String(heat), box.width - 12, 41 + index * 8, { size: 5.3, anchor: 'end' });
        });
        return;
    }
    const effects: readonly {
        readonly heat: number;
        readonly baseline: number;
        readonly lines: readonly string[];
    }[] = [
        { heat: 30, baseline: 48.218, lines: ['Shutdown'] },
        { heat: 28, baseline: 58.291, lines: ['Ammo Exp avoid on 8+'] },
        { heat: 27, baseline: 68.364, lines: ['Pilot damage, avoid on 9+'] },
        { heat: 26, baseline: 78.436, lines: ['Shutdown, avoid on 10+'] },
        { heat: 25, baseline: 88.509, lines: ['Random Movement,', 'avoid on 10+'] },
        { heat: 24, baseline: 108.655, lines: ['+4 Modifier to Fire'] },
        { heat: 23, baseline: 118.727, lines: ['Ammo Exp avoid on 6+'] },
        { heat: 22, baseline: 128.8, lines: ['Shutdown, avoid on 8+'] },
        { heat: 21, baseline: 138.873, lines: ['Pilot damage, avoid on 6+'] },
        { heat: 20, baseline: 148.945, lines: ['Random Movement, avoid on 8+'] },
        { heat: 19, baseline: 159.018, lines: ['Ammo Exp avoid on 4+'] },
        { heat: 18, baseline: 169.091, lines: ['Shutdown, avoid on 6+'] },
        { heat: 17, baseline: 179.164, lines: ['+3 Modifier to Fire'] },
        { heat: 15, baseline: 189.236, lines: ['Random Movement, avoid on 7+'] },
        { heat: 14, baseline: 199.309, lines: ['Shutdown, avoid on 4+'] },
        { heat: 13, baseline: 209.382, lines: ['+2 Modifier to Fire'] },
        { heat: 10, baseline: 219.455, lines: ['Random Movement, avoid on 6+'] },
        { heat: 8, baseline: 229.527, lines: ['+1 Modifier to Fire'] },
        { heat: 5, baseline: 239.6, lines: ['Random Movement, avoid on 5+'] },
    ];
    addText(group, 'Heat', detailedX(15), detailedY(28.073), {
        size: detailedFont(6.76), anchor: 'middle',
    });
    addText(group, 'Level*', detailedX(15), detailedY(38.145), {
        size: detailedFont(6.76), anchor: 'middle',
    });
    addText(group, 'Effects', detailedX(55.5), detailedY(38.145), {
        size: detailedFont(6.76), anchor: 'middle',
    });
    effects.forEach(effect => {
        const row = svgElement('g');
        row.setAttribute('class', 'heatEffect');
        row.setAttribute('heat', String(effect.heat));
        addText(row, String(effect.heat), detailedX(15), detailedY(effect.baseline), {
            size: detailedFont(6.76), anchor: 'middle',
        });
        effect.lines.forEach((line, index) => addText(
            row,
            line,
            detailedX(index === 0 ? 27 : 30),
            detailedY(effect.baseline + index * 10.073),
            { size: detailedFont(6.76) },
        ));
        group.appendChild(row);
    });
    const pips = svgElement('g');
    pips.setAttribute('class', 'hsPips');
    for (let index = 0; index < 30; index++) {
        const column = Math.floor(index / 10);
        const row = index % 10;
        const pip = circle(
            detailedX(128.478 + column * 9.66),
            detailedY(45.478 + row * 9.66),
            detailedFont(3.478),
            'pip hsPip',
        );
        pip.setAttribute('stroke-width', formatNumber(detailedFont(0.9)));
        pip.setAttribute('loc', 'hs');
        if (index >= heatSinkCount) pip.style.display = 'none';
        pips.appendChild(pip);
    }
    group.appendChild(pips);
    const apply = transparentRect(
        detailedX(122),
        detailedY(39),
        detailedX(29),
        detailedY(100),
        'heatApplyButton',
    );
    apply.id = 'applyHeatButton';
    group.appendChild(apply);
}

function readEntityNumberArraySignal(entity: BaseEntity, key: string): readonly number[] {
    const value = (entity as unknown as Record<string, unknown>)[key];
    if (typeof value !== 'function') return [];
    const resolved = (value as () => unknown)();
    return Array.isArray(resolved) ? resolved.filter(item => typeof item === 'number' && Number.isFinite(item)) : [];
}

function drawAeroDamagePanel(
    svg: SVGSVGElement,
    entity: AeroEntity,
    box: Box,
    capital: boolean,
): void {
    const group = addFrame(svg, 'ARMOR DIAGRAM', box);
    const width = box.width;
    const height = box.height;
    const outline = svgElement('path');
    outline.setAttribute('class', 'aero-silhouette');
    outline.setAttribute('d', capital
        ? `M${formatNumber(width / 2)} 28 L${formatNumber(width * 0.69)} 96 L${formatNumber(width * 0.78)} ${formatNumber(height * 0.42)} L${formatNumber(width * 0.68)} ${formatNumber(height - 42)} L${formatNumber(width * 0.32)} ${formatNumber(height - 42)} L${formatNumber(width * 0.22)} ${formatNumber(height * 0.42)} L${formatNumber(width * 0.31)} 96 Z`
        : `M${formatNumber(width / 2)} 27 L${formatNumber(width * 0.59)} 116 L${formatNumber(width - 20)} ${formatNumber(height * 0.48)} L${formatNumber(width * 0.68)} ${formatNumber(height * 0.56)} L${formatNumber(width * 0.61)} ${formatNumber(height - 35)} L${formatNumber(width * 0.39)} ${formatNumber(height - 35)} L${formatNumber(width * 0.32)} ${formatNumber(height * 0.56)} L20 ${formatNumber(height * 0.48)} L${formatNumber(width * 0.41)} 116 Z`);
    outline.setAttribute('fill', '#f8f8f8');
    outline.setAttribute('stroke', '#111');
    outline.setAttribute('stroke-width', '1.3');
    outline.setAttribute('stroke-linejoin', 'round');
    group.appendChild(outline);

    const locations = entity.damageLocations();
    const armorLocations = locations.filter(location => location.armor.front + location.armor.rear > 0);
    const systemLocations = locations.filter(location => location.internalPoints > 0);
    const armorBoxes = capital
        ? capitalAeroArmorBoxes(width, height, armorLocations.length)
        : fighterArmorBoxes(width, height, armorLocations.length);
    armorLocations.forEach((location, index) => drawAeroDamageRegion(
        group,
        location,
        armorBoxes[index] ?? armorBoxes[armorBoxes.length - 1],
        'armor',
    ));

    const systemY = capital ? height - 102 : height - 92;
    const systemWidth = Math.min(66, (width - 18) / Math.max(1, systemLocations.length));
    systemLocations.forEach((location, index) => {
        const totalWidth = systemWidth * systemLocations.length;
        drawAeroDamageRegion(group, location, {
            x: (width - totalWidth) / 2 + index * systemWidth + 2,
            y: systemY,
            width: systemWidth - 4,
            height: 56,
        }, 'structure');
    });
    addText(group, entity.uniformArmor()?.armor.name ?? 'PATCHWORK ARMOR', width / 2, 19, {
        size: 6, weight: 700, anchor: 'middle', maxWidth: width - 30,
    });
}

function fighterArmorBoxes(width: number, height: number, count: number): readonly Box[] {
    const boxes: Box[] = [
        { x: width / 2 - 42, y: 38, width: 84, height: 104 },
        { x: 18, y: height * 0.34, width: 112, height: 104 },
        { x: width - 130, y: height * 0.34, width: 112, height: 104 },
        { x: width / 2 - 48, y: height * 0.54, width: 96, height: 106 },
    ];
    for (let index = boxes.length; index < count; index++) {
        const column = index % 2;
        const row = Math.floor((index - boxes.length) / 2);
        boxes.push({ x: column ? width - 118 : 18, y: 46 + row * 68, width: 100, height: 60 });
    }
    return boxes;
}

function capitalAeroArmorBoxes(width: number, height: number, count: number): readonly Box[] {
    const columns = count <= 4 ? 2 : 3;
    const rows = Math.max(1, Math.ceil(count / columns));
    const cellWidth = (width - 38) / columns;
    const cellHeight = Math.min(94, (height - 150) / rows);
    return Array.from({ length: count }, (_, index) => ({
        x: 19 + index % columns * cellWidth,
        y: 42 + Math.floor(index / columns) * cellHeight,
        width: cellWidth - 5,
        height: cellHeight - 5,
    }));
}

function drawAeroDamageRegion(
    group: SVGGElement,
    location: EntityDamageLocation,
    box: Box | undefined,
    kind: 'armor' | 'structure',
): void {
    if (!box) return;
    const code = location.sheetCode ?? location.code;
    const value = kind === 'armor'
        ? location.armor.front + location.armor.rear
        : location.internalPoints;
    const region = svgElement('g');
    region.setAttribute('class', `aero-damage-region unitLocation ${kind}`);
    region.setAttribute('loc', code);
    const backing = svgElement('rect');
    setAttributes(backing, {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        rx: 4,
        fill: '#fff',
        'fill-opacity': 0.88,
        stroke: '#777',
        'stroke-width': 0.45,
    });
    region.appendChild(backing);
    addText(region, code.toUpperCase(), box.x + box.width / 2, box.y + 9, {
        size: 5.5, weight: 700, anchor: 'middle', maxWidth: box.width - 6,
    });
    const pips = makePips(value, box.width - 8, box.height - 17, kind, code);
    if (pips) {
        pips.setAttribute('transform', `translate(${formatNumber(box.x + 4)} ${formatNumber(box.y + 13)})`);
        region.appendChild(pips);
    }
    group.appendChild(region);
}
