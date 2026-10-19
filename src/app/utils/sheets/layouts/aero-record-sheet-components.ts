// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { VELOCITY_RECORD_FIELDS, VELOCITY_RECORD_LABELS } from '../../../models/aerospace-velocity-record.model';
import { formatProtectionCounter } from '../record-sheet-protection-counter';
import { formatRecordSheetWeaponDamageText } from '../../record-sheet-weapon-info.util';
import { addInventoryText, appendInventoryBadges, appendInventoryRowButtons, fitInventoryText, inventoryRowSpan, inventoryCellLines, inventoryRowLineCount } from '../inventory-text-layout';
import { appendRecordSheetAmmoProfile, markAmmoBefore, markAmmoInventory, measureRecordSheetAmmoProfile } from '../record-sheet-ammo-rendering';
import { recordSheetQuirksText } from '../record-sheet-quirks';
import { RECORD_SHEET_FONT } from '../record-sheet-typography';

import { projectRecordSheetBays } from '../../../models/entity/bays/record-sheet-bay-projection';
import { type AeroEntity } from '../../../models/entity/entities/aero/aero-entity';
import type { CBTRuleset } from '../../../models/cbt-ruleset.model';
import { JumpShipEntity } from '../../../models/entity/entities/largecraft/jumpship-entity';
import { type EntityDamageLocation } from '../../../models/entity/types';
import { recordSheetHeatEffects } from '../../../models/runtime/heat-effect-presentation';
import {
type PaperdollPipLayout,
PaperdollGenerator,
} from '../paperdoll-generator';
import { CapitalShipPipRenderer } from '../capital-ship-pip-renderer';
import {
type Box,
addCrewSkillButton,
addCrewSkillValue,
addDiagramHeading,
addFrame,
addLine,
addTemplateCaption,
addRecordSheetHeatProfile,
addText,
appendDataPanelFacts,
appendDataPanelType,
type DataPanelFact,
addWrappedText,
appendBattleValue,
appendLegacyIdentityAnchors,
crewSkillValueX,
decoratePaperdollPips,
drawAdvancedMovementCompass,
formatNumber,
formatRecordSheetTonnage,
formatTechBase,
formatWholeNumber,
makePips,
paperdollPipOptions,
recordSheetAmmoProfile,
recordSheetNonMekAmmoPrefix,
setAttributes,
setInventoryComponentIds,
svgElement,
appendHeatPanelControls,
appendHeatEffectRows,
appendHeatSinkData,
} from '../record-sheet-svg-rendering';
import { SvgFrameUtil } from '../svg-frame.util';
import { recordSheetPageProfile, type RecordSheetPageProfile } from '../record-sheet-layout';
import { appendDataPanelEraIcon } from '../record-sheet-embedded-art';

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
    readonly showQuirks?: boolean;
    readonly featureText?: string;
    readonly cargoInFeatures?: boolean;
    readonly ruleset: CBTRuleset;
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
        cornerAngleDegrees: { topRight: 0, bottomLeft: 45 },
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
    appendAeroDataPanelHeader(group, entity, { x, y, font }, content.identity);

    // Small craft have no engine row, so their whole inventory block sits higher.
    const inventoryY = (value: number): number => y(value + (content.identity === 'small-craft' ? -7.339 : 0));
    addLine(group, x(3), inventoryY(69), x(219.4), inventoryY(69), '#000', 1.932 * fontScale);
    addTemplateCaption(group, 'Weapons & Equipment Inventory', x(3), inventoryY(79), {
        size: font(RECORD_SHEET_FONT.section), weight: 700,
    });
    addText(group, 'Standard Scale', x(7.328), inventoryY(89.8), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
    const rangeHeadings: readonly [string, number][] = [
        ['(1-6)', 152.316], ['(7-12)', 169.628], ['(13-20)', 186.94], ['(21-25)', 204.252],
    ];
    rangeHeadings.forEach(([label, position]) => addText(group, label, x(position), inventoryY(89.8), {
        size: font(5.8), anchor: 'middle', maxWidth: x(16.312),
    }));
    const headings: readonly [string, number, 'start' | 'middle'][] = [
        ['#', 8.41, 'middle'], ['Type', 13.82, 'start'], ['Loc', 109.036, 'middle'], ['Ht', 132.84, 'middle'],
        ['SRV', 152.316, 'middle'], ['MRV', 169.628, 'middle'], ['LRV', 186.94, 'middle'], ['ERV', 204.252, 'middle'],
    ];
    headings.forEach(([label, position, anchor]) => addText(group, label, x(position), inventoryY(100.6), {
        size: font(RECORD_SHEET_FONT.inventory), weight: 700, anchor,
    }));

    const footerStep = 9.126;
    let rowStep = footerStep;
    const features = svgElement('g');
    features.setAttribute('class', 'aero-features');
    if (content.featureText) addWrappedText(features, `Features ${content.featureText}`, x(8.41), 0, x(204), {
        size: font(RECORD_SHEET_FONT.inventory), lineHeight: y(rowStep), maxLines: Number.POSITIVE_INFINITY,
    });
    const quirks = recordSheetQuirksText(entity, content.showQuirks);
    if (quirks) {
        const quirkGroup = svgElement('g');
        quirkGroup.setAttribute('class', 'unitQuirks');
        // MegaMekLab's footer block prints quirks italic at 90% of the inventory type.
        addWrappedText(quirkGroup, quirks, x(8.41),
            y(features.querySelectorAll('text').length * rowStep), x(204), {
                size: font(RECORD_SHEET_FONT.inventory * 0.9), lineHeight: y(rowStep), maxLines: Number.POSITIVE_INFINITY,
                italic: true,
            });
        features.appendChild(quirkGroup);
    }
    const featureHeight = features.querySelectorAll('text').length * rowStep;
    const cargoLines = content.cargoInFeatures ? [] : aeroCargoLines(entity);
    const ammo = content.showAmmoSummary ? recordSheetAmmoProfile(entity) : [];
    const ammoProfile = {
        width: x(204), fontSize: font(RECORD_SHEET_FONT.inventory), prefix: recordSheetNonMekAmmoPrefix(entity),
    };
    // The footer always holds one ammo row; a longer profile takes its extra rows from the inventory.
    const baseFooterReserve = 46.466 + cargoLines.length * 8.5 + featureHeight;
    const footerReserve = baseFooterReserve
        + Math.max(0, measureRecordSheetAmmoProfile(ammo, ammoProfile).lines.length - 1) * footerStep;
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
    const inventory = svgElement('g');
    group.appendChild(inventory);
    let displayLine = 0;
    rows.forEach((row, rowIndex) => {
        const lineCount = inventoryRowSpan(metrics.content[rowIndex], metrics.lineStep);
        const baseline = inventoryY(110.5 + displayLine * rowStep);
        const entry = svgElement('g');
        entry.setAttribute('class', row.kind === 'bay' ? 'inventoryEntry bay' : 'inventoryEntry');
        entry.id = row.id;
        setInventoryComponentIds(entry, row.componentIds);
        appendInventoryRowButtons(entry, baseline, fontScale, yStep, lineCount, [x(2), x(139.5)],
            [143.5, 160.97, 178.28, 195.94].map((position, rangeIndex) => [
                ['shrButton', 'medButton', 'lngButton', 'extButton'][rangeIndex], x(position),
                x(rangeIndex === 3 ? 16.63 : 17.31),
            ] as const));
        appendInventoryBadges(entry, baseline, fontScale, yStep);
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
        inventory.appendChild(entry);
        displayLine += lineCount;
    });

    let contentBottom = 110.5 + Math.max(0, displayLine - 1) * rowStep;
    let detailY = 110.5 + displayLine * rowStep + 4.563;
    const gravDecks = entity instanceof JumpShipEntity ? entity.gravDecks() : [];
    if (gravDecks.length > 0 && detailY < referenceHeight - footerReserve) {
        addText(inventory, 'Grav Decks:', x(8), inventoryY(detailY), { size: font(6.2), weight: 700 });
        addText(inventory, gravDecks.map((diameter, index) => `#${index + 1}: ${formatWholeNumber(diameter)}m`).join(' · '),
            x(52), inventoryY(detailY), { size: font(5.8), maxWidth: x(160) });
        contentBottom = detailY;
        detailY += 10;
    }
    if (cargoLines.length > 0) {
        if (content.flowCargoAfterInventory) {
            detailY = Math.max(detailY, 110.5 + displayLine * rowStep + rowStep);
            addText(inventory, 'Cargo:', x(7.328), inventoryY(detailY), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
            cargoLines.forEach((line, index) => addText(inventory, line, x(7.328), inventoryY(detailY + (index + 1) * rowStep), {
                size: font(RECORD_SHEET_FONT.inventory), maxWidth: x(205),
            }));
            contentBottom = detailY + cargoLines.length * rowStep;
            detailY += (cargoLines.length + 1) * rowStep + 4.563;
        } else {
            // Authored as if the ammo profile were empty; the profile lifts it by its own height.
            const cargo = svgElement('g');
            markAmmoBefore(cargo);
            group.appendChild(cargo);
            const cargoStart = referenceHeight - 48 - cargoLines.length * 8.5 - featureHeight + footerStep;
            addText(cargo, 'Cargo:', x(8), y(cargoStart - 2), { size: font(6.4), weight: 700 });
            cargoLines.forEach((line, index) => addText(cargo, line, x(8), y(cargoStart + 7 + index * 8.5), {
                size: font(5.8), maxWidth: x(204),
            }));
        }
    }
    if (entity.tracksHeat() && detailY < referenceHeight - footerReserve - 5) {
        addRecordSheetHeatProfile(entity, text => addText(inventory, text,
            x(8.41), inventoryY(detailY), { size: font(RECORD_SHEET_FONT.inventory), maxWidth: x(204) }));
        contentBottom = detailY;
    }
    // With n ammo rows the content must end above `bottom - n * footer row`, the reserve fitted above.
    markAmmoInventory(inventory, {
        top: inventoryY(110.5 - rowStep),
        bottom: inventoryY(referenceHeight - baseFooterReserve) + y(footerStep),
        contentBottom: inventoryY(contentBottom),
    });
    const largeVesselFooterShift = content.identity === 'fighter' ? 0 : 1.5;
    if (content.showAmmoSummary) {
        appendRecordSheetAmmoProfile(group, ammo, {
            ...ammoProfile,
            x: x(8.41),
            y: box.height - y(41.903 + largeVesselFooterShift + featureHeight),
            lineHeight: y(footerStep),
        });
    }
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
    appendBattleValue(group, entity.battleValue(content.ruleset), {
        x: x(13.845), valueX: x(32.79), y: box.height - y(14.214 + largeVesselFooterShift), size: font(9.67),
    });
    appendDataPanelEraIcon(svg, group, entity.year(), { x, y }, referenceHeight - 14.214 - largeVesselFooterShift - 8.893);
    appendLegacyIdentityAnchors(group, entity, box, content.ruleset);
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

/** Notch, as a share of a 220.4-wide panel, that clears the header tab of the panel in AERO_LOWER_PANEL_BOX. */
export const AERO_LOWER_PANEL_TAB_NOTCH = 0.46;

/** MegaMekLab's external stores key, shown until bombs are loaded. */
export const AERO_DEFAULT_BOMB_KEY: readonly string[] = ['HE - High Explosive', 'LG - Laser Guided', 'C - Cluster', 'RL - Rocket Launcher'];

export function drawAeroExternalStores(svg: SVGSVGElement, entity: AeroEntity, box: Box): void {
    // MegaMekLab PrintAero draws one store per bomb hardpoint, external and internal.
    const capacity = entity.bombCapacity();
    const count = Math.min(20, capacity.external + capacity.internal);
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
            'data-store-index': index,
            'data-bomb-section': index < capacity.external ? 'external' : 'internal',
        });
        group.appendChild(rect);
    }
    // The runtime binder labels the carried bombs and marks the hardpoints larger bombs take.
    const slots = svgElement('g');
    setAttributes(slots, { class: 'bombSlots', 'data-label-size': formatNumber(font(6.5)) });
    group.appendChild(slots);
    // MegaMekLab moves the key below the last store row; four rows leave no room for it.
    const rows = Math.ceil(count / columns);
    if (rows < 4) {
        const top = 15.25 + rows * 23.794 + 7;
        addText(group, 'Key:', x(6.408), y(top), { size: font(5.7), weight: 700, class: 'bombKeyTitle' });
        AERO_DEFAULT_BOMB_KEY.forEach((line, index) => {
            const text = addText(group, line, x(6.408), y(top + (index + 1) * 7), { size: font(5.7), class: 'bombKeyLine' });
            text.setAttribute('data-max-width', formatNumber(x(112)));
        });
    }
    svg.appendChild(group);
}

/**
 * The data-panel header every aerospace template shares, at MegaMekLab geometry: type, the vessel
 * name line, thrust (or station keeping), the fighter engine, then tonnage, tech base and role.
 */
export function appendAeroDataPanelHeader(
    group: SVGGElement,
    entity: AeroEntity,
    scale: { readonly x: (value: number) => number; readonly y: (value: number) => number; readonly font: (value: number) => number },
    identity: AeroDataPanelContent['identity'],
    stationary = false,
): void {
    const { x, y, font } = scale;
    const size = font(RECORD_SHEET_FONT.body);
    appendDataPanelType(group, entity, scale, 6);
    const vessel = identity === 'large-vessel';
    if (vessel) {
        addTemplateCaption(group, 'Name:', x(6), y(38), { size, weight: 700 });
        addText(group, '', x(31.315), y(38), { size, maxWidth: x(74) }).id = 'fluffName';
        addLine(group, x(31.315), y(39), x(105.218), y(39), '#000', font(0.72));
    }
    const thrustBaseline = vessel ? 47 : 38;
    addText(group, 'Thrust:', x(6), y(thrustBaseline), { size, weight: 700 }).id = 'movementPointsLabel';
    if (stationary) addText(group, 'Station Keeping Only', x(9.844), y(thrustBaseline + 9), { size, maxWidth: x(96) });
    const thrust = (label: string, value: number, baseline: number, id: string): DataPanelFact => ({
        label, value: String(value), baseline, id, labelX: 9.844, valueX: 79.844, maxWidth: 43, anchor: 'middle',
    });
    const engine = entity.mountedEngine();
    const kilograms = entity.weightClass() === 'Small Support';
    appendDataPanelFacts(group, [
        ...(stationary ? [] : [
            thrust('Safe Thrust:', entity.safeThrust(), thrustBaseline + 9, 'mpWalk'),
            thrust('Maximum Thrust:', entity.maxThrust(), thrustBaseline + 18, 'mpRun'),
        ]),
        ...(identity === 'fighter' ? [{
            label: 'Engine Type:', value: entity.isSupportVehicle() ? engine.type() : `${engine.rating} ${engine.type()}`,
            baseline: 65, id: 'engineType', labelX: 6, valueX: 56, maxWidth: 55,
        }] : []),
        { label: 'Tonnage:', value: formatRecordSheetTonnage(entity.tonnage(), kilograms), baseline: 38,
            id: 'tonnage', field: 'tonnage', ...(kilograms ? { weightUnit: 'kg' as const } : {}) },
        { label: 'Tech Base:', value: formatTechBase(entity.techBase(), entity.mixedTech()), baseline: 47, id: 'techBase', field: 'tech-base' },
        { label: 'Role:', value: entity.role() || '—', baseline: 56, id: 'role', field: 'role' },
    ], scale);
}

/** The "ARMOR DIAGRAM" heading over the aerospace diagram; fighters name their armor, vessels their scale. */
export function drawAeroDiagramHeader(
    svg: SVGSVGElement,
    page: RecordSheetPageProfile,
    variant: 'fighter' | 'vessel',
    subtitle: string,
): void {
    const fighter = variant === 'fighter';
    const origin = aeroPageBox(page, { x: fighter ? 276.4 : 510.009, y: fighter ? 82.857 : 18, width: 83.991, height: 24.25 });
    const group = svgElement('g');
    group.setAttribute('class', `aero-diagram-header ${fighter ? 'fighter' : 'large-aero'}-diagram-header`);
    group.setAttribute('transform', `translate(${formatNumber(origin.x)} ${formatNumber(origin.y)})`);
    addDiagramHeading(group, 'ARMOR DIAGRAM', subtitle, 83.991, 0, {
        ...(fighter ? { subtitleId: 'armorType' } : { showSubtitleRibbon: false, subtitleFontSize: 6.2 }),
        titleWidth: 83.991,
        titleX: 0,
        titleY: 0,
        ribbonX: -18,
        ribbonY: 0,
        ribbonWidth: 123.749,
        ribbonCut: 3.749,
        subtitleX: 41.996,
        subtitleY: fighter ? 21.5 : 18.25,
    });
    svg.appendChild(group);
}

/** A weapon's inventory name followed by its damage notation, unless the name already carries it. */
export function aeroWeaponSheetName(displayName: string, weapon: Parameters<typeof formatRecordSheetWeaponDamageText>[0]): string {
    const notation = formatRecordSheetWeaponDamageText(weapon, '').trim();
    return notation && !displayName.includes(notation) ? `${displayName} ${notation}` : displayName;
}

/** Gunnery and piloting rows of the 142.6-point aerospace pilot panels; only the baseline moves. */
export function appendAeroSkillRows(
    group: SVGGElement,
    { x, y, font }: { readonly x: (value: number) => number; readonly y: (value: number) => number; readonly font: (value: number) => number },
    baseline: number,
): void {
    // Write-in blanks start where the values do, shown only when pilot data is left off the print (as on 'Mek sheets).
    for (const [skill, caption, left, blankEnd, value] of [
        ['gunnery', 'Gunnery Skill:', 3, 65.82, '4'],
        ['piloting', 'Piloting Skill:', 69.8, 136.6, '5'],
    ] as const) {
        const label = addText(group, caption, x(left), y(baseline), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
        const valueX = crewSkillValueX(label, font(1));
        const skillValue = addCrewSkillValue(group, value, valueX, label, font(1));
        skillValue.id = `${skill}Skill0`;
        addLine(group, valueX, y(baseline + 1), x(blankEnd), y(baseline + 1), '#000', 0.72).setAttribute('class', 'skillBlank hidden');
        addCrewSkillButton(group, skillValue, 0, skill);
    }
}

export function drawAeroMovementCompass(svg: SVGSVGElement, box: Box): void {
    drawAdvancedMovementCompass(svg, box, 'aero-movement-compass',
        { width: 90, height: 50, captionX: 22.5, centerX: 67.5, centerY: 25, halfHeight: 15 });
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

/**
 * The aerospace page's lower-left panel slot (MegaMekLab's), under the pilot and critical damage panels. The panel
 * above its header tab notches its bottom-left corner around the tab (AERO_LOWER_PANEL_TAB_NOTCH).
 */
export const AERO_LOWER_PANEL_BOX: Box = Object.freeze({ x: 18.966, y: 603.12, width: 377.7, height: 151.88 });

export function drawAeroVelocityPanel(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'VELOCITY RECORD', box, {
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    group.setAttribute('data-mekbay-region', 'velocity-record');
    // MegaMekLab's 377.7 x 151.88 panel. The wide label column leaves room for "Effective Velocity"; the data rows
    // are taller than the printed turn row so the player's values can be written large.
    const sx = box.width / 377.7;
    const sy = box.height / 151.88;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);
    // The frame border runs from 0 to 376.2 across and from the header tab (18.6) to 150.38 down: the tables keep
    // equal margins to both sides and equal gaps above, between and below them.
    const margin = 5;
    const left = margin;
    const width = 376.2 - 2 * margin;
    const labelWidth = 74;
    const labelBoundary = left + labelWidth;
    const turnWidth = (width - labelWidth) / 10;
    const turnRowHeight = 10.5;
    const turnSize = RECORD_SHEET_FONT.body;
    const rowHeight = 11.4;
    const valueSize = 11.5;
    const tableHeight = turnRowHeight + VELOCITY_RECORD_FIELDS.length * rowHeight;
    const gap = (150.38 - 18.6 - 2 * tableHeight) / 3;
    // A baseline that centres digits and capitals of this size on a row's middle.
    const centred = (middle: number, size: number): number => middle + size * 0.36;
    [18.6 + gap, 18.6 + 2 * gap + tableHeight].forEach((top, tableIndex) => {
        const rowTop = (fieldIndex: number): number => top + turnRowHeight + fieldIndex * rowHeight;
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
        VELOCITY_RECORD_FIELDS.forEach((_, fieldIndex) => {
            addLine(group, x(left), y(rowTop(fieldIndex)), x(left + width), y(rowTop(fieldIndex)), '#000', 0.58);
        });
        for (let column = 0; column < 10; column++) {
            const boundary = labelBoundary + column * turnWidth;
            addLine(group, x(boundary), y(top), x(boundary), y(top + tableHeight), '#000', 0.58);
        }
        const caption = { size: font(RECORD_SHEET_FONT.inventory), weight: 700 } as const;
        const turnCaption = { size: font(turnSize), weight: 700 } as const;
        const turnBaseline = y(centred(top + turnRowHeight / 2, turnSize));
        addText(group, 'Turn #', x(left + 3), turnBaseline, turnCaption);
        VELOCITY_RECORD_FIELDS.forEach((field, fieldIndex) => {
            addText(group, VELOCITY_RECORD_LABELS[field], x(left + 3),
                y(centred(rowTop(fieldIndex) + rowHeight / 2, RECORD_SHEET_FONT.inventory)), caption);
        });
        for (let column = 0; column < 10; column++) {
            const turn = tableIndex * 10 + column + 1;
            const middle = labelBoundary + (column + 0.5) * turnWidth;
            addText(group, String(turn), x(middle), turnBaseline, { ...turnCaption, anchor: 'middle' });
            // The runtime binder writes the player's values here, as large as the crew skills allow.
            VELOCITY_RECORD_FIELDS.forEach((field, fieldIndex) => {
                const cell = svgElement('rect');
                setAttributes(cell, {
                    x: x(labelBoundary + column * turnWidth),
                    y: y(rowTop(fieldIndex)),
                    width: x(turnWidth),
                    height: y(rowHeight),
                    fill: 'transparent',
                    class: 'velocityCell',
                    'data-turn': turn,
                    'data-field': field,
                });
                group.appendChild(cell);
                const value = addText(group, '', x(middle), y(centred(rowTop(fieldIndex) + rowHeight / 2, valueSize)), {
                    size: font(valueSize), weight: 700, anchor: 'middle', class: 'velocityValue',
                });
                setAttributes(value, { 'data-turn': turn, 'data-field': field });
            });
        }
    });
}

export function drawAeroHeatDataPanel(svg: SVGSVGElement, entity: AeroEntity, box: Box): void {
    const group = addFrame(svg, 'HEAT DATA', box, {
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    group.id = 'heatDataPanel';
    const sx = box.width / 161;
    const sy = box.height / 246.6;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);
    const baselines = [48.218, 58.291, 68.364, 78.436, 88.509, 108.655, 118.727, 128.8, 138.873,
        148.945, 159.018, 169.091, 179.164, 189.236, 199.309, 209.382, 219.455, 229.527, 239.6];
    // The template gives its fifth row (25: Random Movement, avoid on 10+) two lines.
    appendHeatEffectRows(group, recordSheetHeatEffects('aero', 0).map((effect, index) => ({
        heat: effect.heat,
        lines: index === 4 ? effect.label.split(', ').map((line, part) => part === 0 ? `${line},` : line) : [effect.label],
        baseline: baselines[index],
    })), { x, y, font }, { headingBaselines: [28.073, 38.145], effectsX: 55.5, lineHeight: 10.073, labelMaxWidth: 88 });
    appendHeatSinkData(group, { count: entity.heatSinkCount(), type: entity.heatSinkType() }, { x, y, font },
        { rightX: 149, pipsX: 128.478 });
    appendHeatPanelControls(group, { x: x(122), y: y(39), width: x(29), height: y(100) });
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
