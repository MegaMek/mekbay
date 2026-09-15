// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { formatProtectionCounter } from '../record-sheet-protection-counter';
import { addInventoryText, appendInventoryHitModifier, fitInventoryText, inventoryRowSpan, inventoryCellLines, inventoryRowLineCount } from '../inventory-text-layout';
import { RECORD_SHEET_FONT } from '../record-sheet-typography';

import { projectRecordSheetBays } from '../../../models/entity/bays/record-sheet-bay-projection';
import { type AeroEntity } from '../../../models/entity/entities/aero/aero-entity';
import { FixedWingSupportEntity } from '../../../models/entity/entities/aero/fixed-wing-support-entity';
import { JumpShipEntity } from '../../../models/entity/entities/largecraft/jumpship-entity';
import { type EntityDamageLocation } from '../../../models/entity/types';
import { weaponQuirkLabels } from '../../../models/entity/utils/weapon-quirks';
import { recordSheetHeatEffects } from '../../../models/runtime/heat-effect-presentation';
import {
type PaperdollPipLayout,
PaperdollGenerator,
} from '../paperdoll-generator';
import { CapitalShipPipRenderer } from '../capital-ship-pip-renderer';
import {
type Box,
addFrame,
addLine,
addText,
addWrappedText,
appendLegacyIdentityAnchors,
circle,
decoratePaperdollPips,
formatNumber,
formatRecordSheetTonnage,
formatTechBase,
formatWholeNumber,
makePips,
paperdollPipOptions,
setAttributes,
setInventoryComponentIds,
svgElement,
transparentRect
} from '../record-sheet-svg-rendering';
import { SvgFrameUtil } from '../svg-frame.util';
import { recordSheetPageProfile, type RecordSheetPageProfile } from '../record-sheet-layout';

/** Keep the right-hand diagrams at their authored size; let the left panels absorb the width difference. */
export function aeroPageBox(page: RecordSheetPageProfile, box: Box): Box {
    const reference = recordSheetPageProfile();
    const widthDelta = page.width - reference.width;
    const heightDelta = page.height - reference.height;
    return {
        ...box,
        x: box.x >= 249 ? box.x + widthDelta : box.x,
        width: box.x >= 249 ? box.width : box.width + widthDelta,
        y: box.y >= 456.4 || box.x >= 574 ? box.y + heightDelta : box.y,
    };
}

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
    readonly showQuirks?: boolean;
    readonly featureText?: string;
    readonly cargoInFeatures?: boolean;
}

export interface AeroPaperdollPresentation {
    readonly assetUrl: string;
    readonly capitalFallback: boolean;
    readonly pipLayout: PaperdollPipLayout;
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
    // Keep the authored columns inside the frame's right border and padding.
    const sx = (box.width - 6) / 222.4;
    const sy = box.height / authoredHeight;
    const fontScale = box.width / 222.4;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const engine = entity.mountedEngine();

    addText(group, 'Type:', x(6), y(28), { size: font(9.67), weight: 700, maxWidth: x(23) });
    const type = addText(group, entity.displayName(), x(32.229), y(28), {
        size: font(9.67), weight: 700, maxWidth: x(187),
    });
    type.id = 'type';
    type.setAttribute('data-mekbay-field', 'display-name');

    const stationary = content.stationary;
    if (content.identity === 'large-vessel') {
        addText(group, 'Name:', x(6), y(38), { size: font(RECORD_SHEET_FONT.body), weight: 700 });
        const fluffName = addText(group, '', x(31.315), y(38), { size: font(RECORD_SHEET_FONT.body), maxWidth: x(74) });
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
            ['Engine Type:', stationary ? '—' : entity.isSupportVehicle() ? engine.type() : `${engine.rating} ${engine.type()}`, 65, 'engineType'],
        ]
        : [
            ['Thrust:', stationary ? 'Station Keeping Only' : '', thrustBaseline],
            ['Safe Thrust:', stationary ? '' : String(entity.safeThrust()), safeBaseline, 'mpWalk'],
            ['Maximum Thrust:', stationary ? '' : String(entity.maxThrust()), maximumBaseline, 'mpRun'],
        ];
    leftFacts.forEach(([label, value, baseline, id]) => {
        const labelNode = addText(group, label, x(label === 'Safe Thrust:' || label === 'Maximum Thrust:' ? 9.844 : 6), y(baseline), {
            size: font(RECORD_SHEET_FONT.body), weight: 700,
        });
        if (label === 'Thrust:') labelNode.id = 'movementPointsLabel';
        const node = addText(group, value, x(label === 'Engine Type:' ? 60 : 79.844), y(baseline), {
            size: font(RECORD_SHEET_FONT.body), maxWidth: x(43), anchor: value && label !== 'Engine Type:' ? 'middle' : 'start',
        });
        if (id) node.id = id;
    });
    const weightInKilograms = entity.weightClass() === 'Small Support';
    const rightFacts: readonly [string, string, number, string, string?][] = [
        ['Tonnage:', weightInKilograms ? formatRecordSheetTonnage(entity.tonnage(), true) : formatWholeNumber(entity.tonnage()), 38, 'tonnage', 'tonnage'],
        ['Tech Base:', formatTechBase(entity.techBase(), entity.mixedTech()), 47, 'techBase', 'tech-base'],
        ['Role:', entity.role() || '—', 56, 'role', 'role'],
    ];
    rightFacts.forEach(([label, value, baseline, id, field]) => {
        addText(group, label, x(115.7), y(baseline), { size: font(RECORD_SHEET_FONT.body), weight: 700 });
        const node = addText(group, value, x(160.5), y(baseline), { size: font(RECORD_SHEET_FONT.body), maxWidth: x(55.5) });
        node.id = id;
        if (field) node.setAttribute('data-mekbay-field', field);
        if (id === 'tonnage' && weightInKilograms) node.setAttribute('data-mekbay-weight-unit', 'kg');
    });

    const inventoryStart = group.childElementCount;
    addLine(group, x(3), y(69), x(219.4), y(69), '#000', 1.932 * fontScale);
    addText(group, 'Weapons & Equipment Inventory', x(3), y(79), {
        size: font(RECORD_SHEET_FONT.section), weight: 700, maxWidth: x(155),
    });
    addText(group, 'Standard Scale', x(7.328), y(89.8), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
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
        size: font(RECORD_SHEET_FONT.inventory), weight: 700, anchor,
    }));

    let rowStep = 9.126;
    const features = svgElement('g');
    features.setAttribute('class', 'aero-features');
    if (content.featureText) addWrappedText(features, `Features ${content.featureText}`, x(8.41), 0, x(204), {
        size: font(RECORD_SHEET_FONT.inventory), lineHeight: y(rowStep), maxLines: Number.POSITIVE_INFINITY,
    });
    const quirks = content.showQuirks === false ? []
        : entity.applicableQuirks().map(entry => entry.quirk.name).concat(weaponQuirkLabels(entity));
    if (quirks.length > 0) {
        const quirkGroup = svgElement('g');
        quirkGroup.setAttribute('class', 'unitQuirks');
        addWrappedText(quirkGroup, `Quirks: ${quirks.join(', ')}`, x(8.41),
            y(features.querySelectorAll('text').length * rowStep), x(204), {
                size: font(RECORD_SHEET_FONT.inventory), lineHeight: y(rowStep), maxLines: Number.POSITIVE_INFINITY,
            });
        features.appendChild(quirkGroup);
    }
    const featureHeight = features.querySelectorAll('text').length * rowStep;
    const cargoLines = content.cargoInFeatures ? [] : aeroCargoLines(entity);
    const footerReserve = 46.466 + cargoLines.length * 8.5 + featureHeight;
    const metrics = fitInventoryText(referenceHeight - 110.5 - footerReserve, fontSize => {
        const lineCounts = content.inventoryRows.map(row => Math.max(
            row.nameLines.flatMap(name => inventoryCellLines(name, x(82), font(fontSize))).length, inventoryRowLineCount([
            [row.location, x(21)], [row.heat, x(12)],
            ...row.damageByRange.map(value => [value, x(16.312)] as const)], font(fontSize))));
        return { lineCount: lineCounts.reduce((a, b) => a + b, 0), badgeRows: lineCounts, content: lineCounts };
    });
    rowStep = metrics.lineStep;
    const inventoryFont = (size: number) => font(size * metrics.fontSize / RECORD_SHEET_FONT.inventory);
    const rows = content.inventoryRows;
    const addCell = (parent: SVGElement, value: string, x: number, y: number, options: Parameters<typeof addText>[4] = {}) =>
        addInventoryText(parent, value, x, y, { ...options, lineHeight: yStep });
    const yStep = y(rowStep);
    let displayLine = 0;
    rows.forEach((row, rowIndex) => {
        const lineCount = inventoryRowSpan(metrics.content[rowIndex], metrics.lineStep);
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
        appendInventoryHitModifier(entry, baseline, fontScale, yStep);
        const targetTnRect = svgElement('rect');
        setAttributes(targetTnRect, {
            x: x(213), y: badgeY, width: x(6), height: badgeHeight,
            fill: '#fff', stroke: '#000', 'stroke-width': 0.65,
            class: 'targetTn-rect', display: 'none',
        });
        entry.appendChild(targetTnRect);
        if (row.quantity !== undefined) {
            addCell(entry, String(row.quantity), x(8.41), baseline, {
                class: 'quantity', size: inventoryFont(RECORD_SHEET_FONT.inventory), anchor: 'middle',
            });
        }
        let nameLineOffset = 0;
        row.nameLines.forEach((name, lineIndex) => {
            addCell(entry, name, x(row.kind === 'bay' ? lineIndex === 0 ? 7.328 : 11.656 : 13.82),
                baseline + y(nameLineOffset * rowStep),
                { class: lineIndex === 0 ? 'name' : 'name continuation', size: inventoryFont(RECORD_SHEET_FONT.inventory), maxWidth: x(82) });
            nameLineOffset += inventoryCellLines(name, x(82), inventoryFont(RECORD_SHEET_FONT.inventory)).length;
        });
        addCell(entry, row.location, x(109.036), baseline, { class: 'location', size: inventoryFont(RECORD_SHEET_FONT.inventory), anchor: 'middle', maxWidth: x(21) });
        addCell(entry, row.heat, x(132.84), baseline, { class: 'heat', size: inventoryFont(RECORD_SHEET_FONT.inventory), anchor: 'middle' });
        row.damageByRange.forEach((value, rangeIndex) => addCell(
            entry,
            value,
            x([152.316, 169.628, 186.94, 204.252][rangeIndex]),
            baseline,
            {
                class: ['range_short', 'range_medium', 'range_long', 'range_extreme'][rangeIndex],
                size: inventoryFont(RECORD_SHEET_FONT.inventory), anchor: 'middle', maxWidth: x(16.312),
            },
        ));
        const targetTn = addCell(entry, '', x(216), badgeY + badgeHeight * 0.73, {
            class: 'targetTn-text', size: font(4.2), weight: 700, anchor: 'middle',
        });
        targetTn.setAttribute('display', 'none');
        group.appendChild(entry);
        displayLine += lineCount;
    });

    let detailY = 110.5 + displayLine * rowStep + 4.563;
    const gravDecks = entity instanceof JumpShipEntity ? entity.gravDecks() : [];
    if (gravDecks.length > 0 && detailY < referenceHeight - footerReserve) {
        addText(group, 'Grav Decks:', x(8), y(detailY), { size: font(6.2), weight: 700 });
        addText(group, gravDecks.map((diameter, index) => `#${index + 1}: ${formatWholeNumber(diameter)}m`).join(' · '),
            x(52), y(detailY), { size: font(5.8), maxWidth: x(160) });
        detailY += 10;
    }
    if (cargoLines.length > 0) {
        if (content.flowCargoAfterInventory) {
            detailY = Math.max(detailY, 110.5 + displayLine * rowStep + rowStep);
            addText(group, 'Cargo:', x(7.328), y(detailY), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
            cargoLines.forEach((line, index) => addText(group, line, x(7.328), y(detailY + (index + 1) * rowStep), {
                size: font(RECORD_SHEET_FONT.inventory), maxWidth: x(205),
            }));
            detailY += (cargoLines.length + 1) * rowStep + 4.563;
        } else {
            const cargoStart = referenceHeight - 48 - cargoLines.length * 8.5;
            addText(group, 'Cargo:', x(8), y(cargoStart - 2), { size: font(6.4), weight: 700 });
            cargoLines.forEach((line, index) => addText(group, line, x(8), y(cargoStart + 7 + index * 8.5), {
                size: font(5.8), maxWidth: x(204),
            }));
        }
    }
    if (entity.tracksHeat() && detailY < referenceHeight - footerReserve - 5) {
        const heatProfile = addText(group,
            `Maximum Heat (Dissipation): ${Math.max(0, entity.heatGeneration())} (${Math.max(0, entity.heatDissipation())})`,
            x(8.41), y(detailY), { size: font(RECORD_SHEET_FONT.inventory), maxWidth: x(204) });
        heatProfile.id = 'heatProfile';
    }
    if (content.identity === 'small-craft') {
        const inventory = svgElement('g');
        inventory.setAttribute('transform', `translate(0 ${formatNumber(y(-7.339))})`);
        [...group.children].slice(inventoryStart).forEach(child => inventory.appendChild(child));
        group.appendChild(inventory);
    }
    const ammo = aeroAmmoSummary(entity);
    const largeVesselFooterShift = content.identity === 'fighter' ? 0 : 1.5;
    if (content.showAmmoSummary && ammo) addText(
        group,
        `Ammo: ${ammo}`,
        x(8.41),
        box.height - y(41.903 + largeVesselFooterShift + featureHeight),
        {
        size: font(RECORD_SHEET_FONT.inventory), maxWidth: x(204),
        },
    );
    addText(group, `Fuel Points: ${formatWholeNumber(entity.fuel())}`, x(8.41),
        box.height - y(32.777 + largeVesselFooterShift + featureHeight), {
        size: font(RECORD_SHEET_FONT.inventory), maxWidth: x(204),
    });
    if (featureHeight > 0) {
        features.setAttribute('transform', `translate(0 ${formatNumber(box.height - y(32.777 + largeVesselFooterShift + featureHeight - rowStep))})`);
        group.appendChild(features);
    }
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
    const pipLayout = presentation.pipLayout;
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
        const paperdoll = await PaperdollGenerator.createPaperdoll(
            presentation.assetUrl,
            box.width,
            box.height,
            { armor: armorValues, structure: structureValues },
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
        const scale = Math.min(1, box.width / 344, box.height / authoredHeight);
        paperdoll.setAttribute(
            'transform',
            `translate(${formatNumber(box.x + box.width - 344 * scale)} ${formatNumber(box.y)}) `
            + `scale(${formatNumber(scale)})`,
        );
        paperdoll.setAttribute('data-mekbay-aero-asset', presentation.assetUrl);
        // Keep the control above the art, clear of headings and external stores on the right.
        paperdoll.setAttribute('data-random-hit-transform', 'translate(4 1) scale(0.75)');
        decoratePaperdollPips(paperdoll);
        updateAeroPaperdollLabels(paperdoll, entity, locations);
        svg.appendChild(paperdoll);
    } catch {
        drawAeroDamagePanel(svg, entity, box, presentation.capitalFallback);
    }
}

function updateAeroPaperdollLabels(layer: SVGGElement, entity: AeroEntity, locations: readonly EntityDamageLocation[]): void {
    const values = new Map(locations.map(location => [location.sheetCode ?? location.code, location]));
    values.forEach((location, code) => {
        const total = location.armor.front + location.armor.rear;
        const threshold = String(entity.armorDamageThreshold(location.code));
        const counter = layer.querySelector(`[id="textArmor_${code}"]`);
        counter?.setAttribute('data-mekbay-counter-prefix', threshold);
        setAeroPaperdollText(layer, `textArmor_${code}`, `${threshold} ${formatProtectionCounter(total)}`);
    });
    const structural = (code: string): number => values.get(code)?.internalPoints ?? 0;
    if (!setAeroPaperdollText(layer, 'textSI', formatProtectionCounter(structural('SI')))) {
        setAeroLabeledValue(layer, 'Structural', structural('SI'), 'textSI');
    }
    if (!setAeroPaperdollText(layer, 'textKFIntegrity', formatProtectionCounter(structural('KF')))) {
        setAeroLabeledValue(layer, 'K-F Drive', structural('KF'), 'textKFIntegrity');
    }
    if (!values.has('SAIL')) {
        layer.querySelector('#textSailIntegrity')?.remove();
        setAeroLabeledValue(layer, 'Sail Integrity:', null, 'textSailIntegrity');
    } else if (!setAeroPaperdollText(layer, 'textSailIntegrity', formatProtectionCounter(structural('SAIL')))) {
        setAeroLabeledValue(layer, 'Sail Integrity:', structural('SAIL'), 'textSailIntegrity');
    }
    if (!setAeroPaperdollText(layer, 'textDockingCollars', formatProtectionCounter(structural('DC')))) {
        setAeroLabeledValue(layer, 'Docking Collars:', structural('DC'), 'textDockingCollars');
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

function setAeroLabeledValue(layer: SVGGElement, label: string, value: number | null, id: string): void {
    for (const text of Array.from(layer.querySelectorAll<SVGTextElement>('text'))) {
        const spans = Array.from(text.querySelectorAll<SVGTSpanElement>('tspan'));
        const labelIndex = spans.findIndex(span => span.textContent?.trim() === label);
        if (labelIndex < 0) continue;
        if (value === null) spans[labelIndex].remove();
        for (let index = labelIndex + 1; index < spans.length; index++) {
            const content = spans[index].textContent?.trim() ?? '';
            if (/^-?\d+(?:\.\d+)?$/u.test(content)) {
                if (value === null) spans[index].remove();
                else { spans[index].id = id; spans[index].textContent = formatProtectionCounter(value); }
                return;
            }
        }
    }
}

export function drawAeroExternalStores(svg: SVGSVGElement, entity: AeroEntity, box: Box): void {
    const count = entity instanceof FixedWingSupportEntity ? entity.maxBombPoints()
        : Math.min(20, Math.floor(entity.tonnage() / 5));
    if (count <= 0) return;
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
        headerFontSize: font(RECORD_SHEET_FONT.section),
        cornerAngleDegrees: 45,
    });
    heading.setAttribute('transform', 'translate(1 -1.372)');
    group.appendChild(heading);
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

export function drawAeroArtworkRegion(svg: SVGSVGElement, box: Box): void {
    const group = svgElement('g');
    setAttributes(group, {
        class: 'aero-artwork-region',
        'data-mekbay-fluff-art': '1',
        'data-image-x': 0,
        'data-image-y': 0,
        'data-image-width': formatNumber(box.width),
        'data-image-height': formatNumber(box.height),
        transform: `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`,
    });
    svg.appendChild(group);
}

export function drawAeroVelocityPanel(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'VELOCITY RECORD', box, {
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
                size: font(RECORD_SHEET_FONT.inventory),
                weight: 700,
            });
        });
        for (let column = 0; column < 10; column++) {
            addText(
                group,
                String(tableIndex * 10 + column + 1),
                x(93.075 + column * turnWidth),
                y(top + 7.049),
                { size: font(RECORD_SHEET_FONT.inventory), weight: 700 },
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
    const baselines = [48.218, 58.291, 68.364, 78.436, 88.509, 108.655, 118.727, 128.8, 138.873,
        148.945, 159.018, 169.091, 179.164, 189.236, 199.309, 209.382, 219.455, 229.527, 239.6];
    const effects = recordSheetHeatEffects('aero', 0).map((effect, index) => ({
        ...effect, baseline: baselines[index],
        lines: index === 4 ? effect.label.split(', ').map((line, part) => part === 0 ? `${line},` : line) : [effect.label],
    }));
    addText(group, 'Heat', detailedX(15), detailedY(28.073), {
        size: detailedFont(RECORD_SHEET_FONT.inventory), anchor: 'middle',
    });
    addText(group, 'Level*', detailedX(15), detailedY(38.145), {
        size: detailedFont(RECORD_SHEET_FONT.inventory), anchor: 'middle',
    });
    addText(group, 'Effects', detailedX(55.5), detailedY(38.145), {
        size: detailedFont(RECORD_SHEET_FONT.inventory), anchor: 'middle',
    });
    effects.forEach(effect => {
        const row = svgElement('g');
        row.setAttribute('class', 'heatEffect');
        row.setAttribute('heat', String(effect.heat));
        addText(row, String(effect.heat), detailedX(15), detailedY(effect.baseline), {
            size: detailedFont(RECORD_SHEET_FONT.inventory), anchor: 'middle',
        });
        effect.lines.forEach((line, index) => addText(
            row,
            line,
            detailedX(index === 0 ? 27 : 30),
            detailedY(effect.baseline + index * 10.073),
            { size: detailedFont(RECORD_SHEET_FONT.inventory) },
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
        pip.setAttribute('data-loc', 'hs');
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
        capital,
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
        }, 'structure', capital);
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
    capital: boolean,
): void {
    if (!box) return;
    const code = location.sheetCode ?? location.code;
    const value = kind === 'armor'
        ? location.armor.front + location.armor.rear
        : location.internalPoints;
    const region = svgElement('g');
    region.setAttribute('class', `aero-damage-region unitLocation ${kind}`);
    region.setAttribute('data-loc', code);
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
    const pips = capital
        ? CapitalShipPipRenderer.createPips(value, box.width - 8, box.height - 17, kind, code)
        : makePips(value, box.width - 8, box.height - 17, kind, code);
    if (pips) {
        pips.setAttribute('transform', `translate(${formatNumber(box.x + 4)} ${formatNumber(box.y + 13)})`);
        region.appendChild(pips);
    }
    group.appendChild(region);
}
