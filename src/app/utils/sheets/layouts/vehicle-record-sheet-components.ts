// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { addInventoryText, appendInventoryHitModifier, appendInventoryTargetNumber, fitInventoryText, inventoryRowSpan, inventoryRowLineCount } from '../inventory-text-layout';
import { RECORD_SHEET_FONT } from '../record-sheet-typography';
import { systemDamageControls,systemDamageLocationControls,systemDamagePresentation } from '../../../models/runtime/system-damage-presentation';

import { fireControlFeatureFromFlagLookup } from '../../../models/entity/utils/fire-control';
import type { BaseEntity } from '../../../models/entity/base-entity';
import type { CBTRuleset } from '../../../models/cbt-ruleset.model';
import { vehicleHasChargeAttack } from '../../../models/rules/vehicle-runtime-rules';
import { getBayTransporterType } from '../../../models/entity/bays/bay-definitions';
import { projectRecordSheetBays } from '../../../models/entity/bays/record-sheet-bay-projection';
import { isVehicleEntity } from '../../../models/entity/utils/entity-type-guards';
import { intrinsicActionBaseDamageText } from '../../../models/entity/utils/mek-intrinsic-actions';
import type { Equipment } from '../../../models/equipment.model';
import { isHeatSinkEquipment } from '../../../models/heat-equipment.model';
import { isJumpJetEquipment,isUmuEquipment } from '../../../models/jump-equipment.model';
import { buildNonMekRuntimeIndex } from '../../../models/runtime/non-mek-runtime-index';
import { PaperdollGenerator, type PaperdollPipLayout } from '../paperdoll-generator';
import { SvgFrameUtil } from '../svg-frame.util';
import {
    appendRecordSheetAmmoProfile,
    markAmmoBefore,
    markAmmoInventory,
    measureRecordSheetAmmoProfile,
} from '../record-sheet-ammo-rendering';
import { appendDataPanelEraIcon } from '../record-sheet-embedded-art';
import { recordSheetQuirksText } from '../record-sheet-quirks';
import { createBattleTechLogo,createCatalystGameLabsLogo } from '../record-sheet-brand';
import {
    isRecordSheetInventorySupport,
    recordSheetElectronicWarfareRange,
    recordSheetEquipmentDamage,
    recordSheetInventoryMountName,
} from '../record-sheet-inventory-equipment';
import {
crewSkillValueX,
CREW_STATE_MENU_SPACE,
type Box,
addCrewSkillValue,
addDiagramHeading,
addFrame,
addLine,
addText,
addWrappedText,
appendBattleValue,
appendLegacyIdentityAnchors,
circle,
armorDiagramSubtitle,
decoratePaperdollPips,
addTemplateCaption,
appendDataPanelFacts,
appendDataPanelType,
drawCriticalDamageBox,
drawDamageLocationGrid,
formatNumber,
formatMovementWithMaximum,
formatRecordSheetTonnage,
formatWholeNumber,
formatTechBase,
paperdollPipOptions,
readViewBox,
recordSheetAmmoProfile,
recordSheetInventoryWeapons,
recordSheetNonMekAmmoPrefix,
setAttributes,
setInventoryComponentIds,
svgElement,
transparentRect,
type RecordSheetLinkedEquipment,
} from '../record-sheet-svg-rendering';

export interface CompactVehicleInventoryPresentation {
    readonly ruleset: CBTRuleset;
    readonly showQuirks?: boolean;
    readonly includePhysicalAttacks: boolean;
    readonly lastDetailBaseline: number;
    /** MML's full-height naval template compresses unit-data content vertically. */
    readonly verticalContentScale?: number;
    readonly footerBaselineOffset?: number;
}

export interface CompactVehicleCrewPresentation {
    readonly airborne: boolean;
}

export interface CompactVehicleDiagramPresentation {
    readonly pipLayout: PaperdollPipLayout;
    readonly assetUrl: string;
    readonly motiveArtId?: 'tracks' | 'wheels' | 'hovercraft';
    /** Replaces the source artwork's authored root transform for a template variant. */
    readonly authoredRootTransform?: string;
    readonly catalystY?: number;
}

/** MML's vehicle title uses the support size, motive family and vessel designation. */
export function compactVehicleSheetTitle(entity: BaseEntity, naval = false): string {
    if (!isVehicleEntity(entity)) return 'COMBAT VEHICLE RECORD SHEET';
    const motive = naval ? 'NAVAL' : (entity.getMotiveTypeAsString() || 'Combat').trim().toUpperCase();
    const title: string[] = [];
    if (entity.isSupportVehicle()) title.push(entity.weightClass().replace(/\s.*$/u, '').toUpperCase());
    else if (entity.isSuperHeavy()) title.push('SUPER-HEAVY');
    if (motive !== 'VTOL') title.push(motive);
    if (entity.isSupportVehicle()) title.push('SUPPORT');
    if (motive === 'VTOL') title.push('V.T.O.L.');
    title.push(`${entity.omni() ? 'OMNI' : ''}${naval ? 'VESSEL' : 'VEHICLE'}`, 'RECORD', 'SHEET');
    return title.join(' ');
}

/** Unit-local branding from MML's 576x375 vehicle template. */
export function drawCompactVehicleChrome(
    svg: SVGSVGElement,
    title: string,
    canonicalHeight = 375,
): void {
    const group = svgElement('g');
    group.setAttribute('class', 'compact-vehicle-unit-chrome');
    const viewBox = readViewBox(svg);
    const scaleX = viewBox.width / 576;
    const scaleY = viewBox.height / canonicalHeight;
    const scale = Math.min(scaleX, scaleY);
    const logo = createBattleTechLogo();
    logo.setAttribute('transform', `scale(${formatNumber(0.791 * scale)})`);
    group.appendChild(logo);
    // The same title column as drawPageChrome's full-page masthead.
    addText(group, title, 192 * scaleX, 63.357 * scaleY, {
        class: 'compact-vehicle-title', size: 11.59 * scale, weight: 700, anchor: 'middle', maxWidth: 260 * scaleX,
    });

    svg.appendChild(group);
}

export function drawCompactVehicleDataPanel(
    svg: SVGSVGElement,
    entity: BaseEntity,
    box: Box,
    presentation: CompactVehicleInventoryPresentation,
): SVGGElement {
    const group = addFrame(svg, 'VEHICLE DATA', box, {
        bottomLeftNotchWidth: box.width * 0.48,
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45 },
    });
    const content = svgElement('g');
    content.setAttribute('class', 'compact-vehicle-data-content');
    const verticalContentScale = presentation.verticalContentScale ?? 1;
    group.appendChild(content);
    // Keep the authored columns inside the frame's right border and padding.
    const sx = (box.width - 6) / 220.4;
    const sy = box.height / 283;
    const fontScale = box.width / 220.4;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy * verticalContentScale;
    const font = (value: number): number => value * fontScale;
    appendDataPanelType(content, entity, { x, y, font }, 3);
    addText(content, 'Movement Points:', x(6), y(38), { size: font(RECORD_SHEET_FONT.body), weight: 700 }).id = 'movementPointsLabel';
    appendDataPanelFacts(content, [
        { label: 'Cruising:', value: String(entity.walkMP()), baseline: 47, id: 'mpWalk', field: 'walk',
            labelX: 6, valueX: 56, anchor: 'middle' },
        { label: 'Flanking:', value: formatMovementWithMaximum(entity.runMP(), entity.maxRunMP()), baseline: 56,
            id: 'mpRun', field: 'run', labelX: 6, valueX: 56, anchor: 'middle' },
    ], { x, y, font });
    if (entity.jumpMP() > 0) {
        addText(content, 'Jumping:', x(74), y(56), { size: font(7), weight: 700, maxWidth: x(29) });
        const jump = addText(content, String(entity.jumpMP()), x(108), y(56), { size: font(RECORD_SHEET_FONT.body), anchor: 'middle' });
        jump.id = 'mpJump';
        jump.setAttribute('data-mekbay-field', 'jump');
    }
    const engine = entity.mountedEngine();
    const weightInKilograms = entity.weightClass() === 'Small Support';
    appendDataPanelFacts(content, [
        { label: 'Tonnage:', value: formatRecordSheetTonnage(entity.tonnage(), weightInKilograms), baseline: 38,
            id: 'tonnage', field: 'tonnage', ...(weightInKilograms ? { weightUnit: 'kg' as const } : {}) },
        { label: 'Tech Base:', value: formatTechBase(entity.techBase(), entity.mixedTech()), baseline: 47, id: 'techBase', field: 'tech-base' },
        { label: 'Role:', value: entity.role() || '—', baseline: 56, id: 'role', field: 'role' },
        { label: 'Engine Type:', value: entity.isSupportVehicle() ? engine.type() : `${engine.rating} ${engine.type()}`,
            baseline: 65, id: 'engineType' },
        { label: 'Movement Type:', value: entity.getMotiveTypeAsString() ?? entity.entityType, baseline: 65,
            id: 'movementType', labelX: 6, valueX: 64.129, maxWidth: 47 },
    ], { x, y, font });
    addLine(content, x(3), y(71.462), box.width - x(3), y(71.462), '#111', 0.8 * fontScale);
    addTemplateCaption(content, 'Weapons & Equipment Inventory', x(3), y(80.462), { size: font(RECORD_SHEET_FONT.section), weight: 700 });
    addText(content, '(hexes)', x(171.132), y(80.462), { size: font(RECORD_SHEET_FONT.inventory) });
    const headings: readonly [string, number, 'start' | 'middle'][] = [
        ['Type', 8.41, 'start'], ['Loc', 100.38, 'middle'], ['Dmg', 111.2, 'start'],
        ['Min', 172.874, 'middle'], ['Sht', 185.425, 'middle'],
        ['Med', 198.842, 'middle'], ['Lng', 212.908, 'middle'],
    ];
    headings.forEach(([label, position, anchor]) => addText(content, label, x(position), y(91.262), {
        size: font(RECORD_SHEET_FONT.inventory), weight: 700, anchor, maxWidth: anchor === 'middle' ? x(11) : undefined,
    }));
    appendCompactVehicleInventory(content, entity, { x, y, font }, box, presentation);
    const footerOffset = presentation.footerBaselineOffset ?? 0;
    addLine(content, x(3), y(257.643 + footerOffset), box.width - x(3), y(257.643 + footerOffset), '#111', 0.8 * fontScale);
    appendBattleValue(content, entity.battleValue(presentation.ruleset), {
        x: x(13.845), valueX: x(28.927), y: y(268.143 + footerOffset), size: font(RECORD_SHEET_FONT.body),
    });
    appendDataPanelEraIcon(svg, content, entity.year(), { x, y }, 260 + footerOffset);
    appendLegacyIdentityAnchors(content, entity, box, presentation.ruleset);
    return group;
}

function appendCompactVehicleInventory(
    group: SVGGElement,
    entity: BaseEntity,
    scale: {
        readonly x: (value: number) => number;
        readonly y: (value: number) => number;
        readonly font: (value: number) => number;
    },
    box: Box,
    presentation: CompactVehicleInventoryPresentation,
): void {
    const { x, y, font } = scale;
    const weapons = compactVehicleInventoryRows(entity);
    const physical = (presentation.includePhysicalAttacks && isVehicleEntity(entity)
        && vehicleHasChargeAttack(entity) ? entity.intrinsicWeapons() : []).map(attack => ({
        name: attack.name,
        location: attack.locations.join('/') || '—',
        heat: '—',
        damage: attack.kind === 'charge' && presentation.ruleset !== 'total-warfare'
            ? `${formatNumber(entity.tonnage() / 5)}×(TMM+1)`
            : intrinsicActionBaseDamageText(attack),
        minimumRange: '—',
        ranges: ['—', '—', '—'] as const,
        componentIds: [] as readonly string[],
    }));
    const ammo = recordSheetAmmoProfile(entity);
    const quirks = recordSheetQuirksText(entity, presentation.showQuirks);
    const features = compactVehicleFeatureText(entity);
    const detailRows = [
        ...(features ? [{
            text: `Features ${features}`,
            size: RECORD_SHEET_FONT.inventory,
            maxLines: 1,
            italic: false,
        }] : []),
        ...(quirks ? [{
            text: quirks,
            size: 6.084,
            class: 'unitQuirks',
            maxLines: 2,
            italic: true,
        }] : []),
    ];
    const renderedDetails = detailRows.map(row => {
        const owner = svgElement('g');
        if ('class' in row && row.class) owner.setAttribute('class', row.class);
        addWrappedText(owner, row.text, x(8.41), 0, box.width - x(17), {
            size: font(row.size), lineHeight: y(8.213), maxLines: row.maxLines, italic: row.italic,
        });
        return { owner, lines: owner.querySelectorAll('text').length };
    });
    const detailLineCount = renderedDetails.reduce((sum, row) => sum + row.lines, 0);
    const lastDetailBaseline = presentation.lastDetailBaseline;
    const firstDetailBaseline = lastDetailBaseline - Math.max(0, detailLineCount - 1) * 9.126;
    const cargoBays = projectRecordSheetBays(entity.transporters());
    const cargoLabels = cargoBays.map(bay => {
        const names = bay.members.map(member => member.typeName).join('/');
        const capacities = bay.members.map(member => formatWholeNumber(member.capacity)).join('/');
        return `Bay ${bay.bayNumber}: ${names} (${capacities}) (${bay.doors} ${bay.doors === 1 ? 'Door' : 'Doors'})`;
    });
    const rowLines = (row: { name: string; location?: string; damage: string; minimumRange: string; ranges: readonly string[] }, size: number, nameX = 8.41) =>
        inventoryRowLineCount([[row.name, x(100.38 - 9 - 3 - nameX)], [row.location ?? '', x(18)],
            [row.damage, x(54)], [row.minimumRange, x(12)], ...row.ranges.map(value => [value, x(12)] as const)], font(size));
    const ammoPrefix = recordSheetNonMekAmmoPrefix(entity);
    // Like the Mek footer, half a row separates the physical attacks from the ammo profile under them.
    const ammoGap = ammo.length > 0 && physical.length > 0 ? 0.5 : 0;
    const metrics = fitInventoryText(y(firstDetailBaseline - (detailRows.length ? 13.689 : 0) - 101.162)
        / (box.width / 220.4), fontSize => {
        const rows = weapons.map(row => [rowLines(row, fontSize),
            ...(row.linkedEquipment ? [rowLines(vehicleLinkedEquipmentFields(row.linkedEquipment), fontSize, 12.738)] : []),
            ...row.alternativeModes.map(mode => rowLines(mode, fontSize, 12.738))]);
        const physicalRows = physical.map(row => rowLines(row, fontSize));
        const cargoRows = cargoLabels.map(label => inventoryRowLineCount([[label, box.width - x(15)]], font(fontSize)));
        // The ammo profile prints at the fitted row size and lifts the physical rows by its lines.
        const ammoLines = ammo.length === 0 ? 0 : measureRecordSheetAmmoProfile(ammo, {
            width: box.width - x(17), fontSize: font(fontSize), prefix: ammoPrefix,
        }).lines.length;
        return { lineCount: rows.flat().reduce((a, b) => a + b, 0) + physicalRows.reduce((a, b) => a + b, 0)
            + cargoRows.reduce((a, b) => a + b, cargoRows.length ? 1 : 0) + ammoLines + ammoGap,
            badgeRows: rows.flat(), content: { rows, physicalRows, cargoRows } };
    });
    const rowSpans = metrics.content.rows.map(rows => rows.map(lines => inventoryRowSpan(lines, metrics.lineStep)));
    const weaponStep = metrics.lineStep * box.width / 220.4;
    const inventoryFont = (size: number) => font(size * metrics.fontSize / RECORD_SHEET_FONT.inventory);
    const physicalStart = y(firstDetailBaseline - (detailRows.length ? 13.689 : 0))
        - (Math.max(0, metrics.content.physicalRows.reduce((a, b) => a + b, 0) - 1) + ammoGap) * weaponStep;
    const inventory = svgElement('g');
    group.appendChild(inventory);
    let displayLine = 0;
    weapons.forEach((row, index) => {
        const baseline = y(101.162) + displayLine * weaponStep;
        const entry = svgElement('g');
        entry.setAttribute('class', 'inventoryEntry');
        entry.setAttribute('id', `generated-vehicle-inventory-row@${index}`);
        setInventoryComponentIds(entry, row.componentIds);
        entry.appendChild(transparentRect(x(6), baseline - weaponStep, x(160), weaponStep * rowSpans[index][0],
            'inventoryEntryButton mainButton'));
        const rangeButtons: readonly [string, number][] = [
            ['shrButton', 179], ['medButton', 192.4], ['lngButton', 206.2],
        ];
        rangeButtons.forEach(([className, position]) => entry.appendChild(
            transparentRect(x(position), baseline - weaponStep, x(13.4), weaponStep,
                `inventoryEntryButton ${className}`),
        ));
        appendInventoryHitModifier(entry, baseline, box.width / 220.4, weaponStep);
        drawCompactVehicleInventoryFields(entry, row, baseline, x, inventoryFont, 8.41, weaponStep);
        appendInventoryTargetNumber(entry, x(164.5), baseline, box.width / 220.4, weaponStep);
        if (row.linkedEquipment) {
            const linked = svgElement('g');
            setAttributes(linked, { class: 'inventoryEntry linked', id: `generated-vehicle-linked-row@${index}` });
            setInventoryComponentIds(linked, [row.linkedEquipment.componentId]);
            const linkedBaseline = baseline + rowSpans[index][0] * weaponStep;
            linked.appendChild(transparentRect(x(6), linkedBaseline - weaponStep, x(160), weaponStep,
                'inventoryEntryButton mainButton'));
            drawCompactVehicleInventoryFields(linked, vehicleLinkedEquipmentFields(row.linkedEquipment), linkedBaseline,
                x, inventoryFont, 12.738, weaponStep);
            entry.appendChild(linked);
        }
        row.alternativeModes.forEach((mode, modeIndex) => {
            const modeBaseline = baseline + rowSpans[index].slice(0, modeIndex + 1 + (row.linkedEquipment ? 1 : 0)).reduce((a, b) => a + b, 0) * weaponStep;
            const alternative = svgElement('g');
            alternative.setAttribute('class', 'alternativeMode');
            alternative.setAttribute('data-mekbay-mode', mode.name);
            alternative.appendChild(transparentRect(x(6), modeBaseline - weaponStep, x(160), weaponStep,
                'inventoryEntryButton alternativeModeButton'));
            rangeButtons.forEach(([className, position]) => alternative.appendChild(
                transparentRect(x(position), modeBaseline - weaponStep, x(13.4), weaponStep,
                    `inventoryEntryButton ${className}`),
            ));
            drawCompactVehicleInventoryFields(alternative, {
                name: mode.name,
                location: '',
                damage: mode.damage,
                minimumRange: mode.minimumRange,
                ranges: mode.ranges,
            }, modeBaseline, x, inventoryFont, 12.738, weaponStep);
            entry.appendChild(alternative);
        });
        inventory.appendChild(entry);
        displayLine += rowSpans[index].reduce((a, b) => a + b, 0);
    });
    if (cargoBays.length > 0) {
        const cargo = svgElement('g');
        cargo.setAttribute('class', 'vehicle-cargo');
        addText(cargo, 'Cargo:', x(7.328), y(101.162) + displayLine++ * weaponStep,
            { size: inventoryFont(RECORD_SHEET_FONT.inventory), weight: 700 });
        cargoLabels.forEach((label, index) => {
            addInventoryText(cargo, label, x(7.328), y(101.162) + displayLine * weaponStep,
                { size: inventoryFont(RECORD_SHEET_FONT.inventory), maxWidth: box.width - x(15), lineHeight: weaponStep });
            displayLine += metrics.content.cargoRows[index];
        });
        inventory.appendChild(cargo);
    }
    markAmmoInventory(inventory, {
        top: y(101.162) - weaponStep * 0.82,
        bottom: physical.length > 0 ? physicalStart - weaponStep : y(firstDetailBaseline - (detailRows.length > 0 ? 9.126 : 0)),
        contentBottom: y(101.162) + Math.max(0, displayLine - 1) * weaponStep,
    });
    const physicalRows = svgElement('g');
    markAmmoBefore(physicalRows);
    group.appendChild(physicalRows);
    physical.forEach((row, index) => {
        const baseline = physicalStart + metrics.content.physicalRows.slice(0, index).reduce((a, b) => a + b, 0) * weaponStep;
        const entry = svgElement('g');
        entry.setAttribute('class', 'inventoryEntry');
        entry.setAttribute('id', `generated-vehicle-physical-row@${index}`);
        setInventoryComponentIds(entry, row.componentIds);
        entry.appendChild(transparentRect(x(6), baseline - weaponStep, x(160), weaponStep,
            'inventoryEntryButton mainButton'));
        drawCompactVehicleInventoryFields(entry, row, baseline, x, inventoryFont, 8.41, weaponStep);
        physicalRows.appendChild(entry);
    });
    let detailLine = 0;
    renderedDetails.forEach(({ owner, lines }) => {
        owner.setAttribute('transform', `translate(0 ${formatNumber(y(firstDetailBaseline + detailLine * 9.126))})`);
        group.appendChild(owner);
        detailLine += lines;
    });
    appendRecordSheetAmmoProfile(group, ammo, {
        x: x(8.41),
        y: y(firstDetailBaseline - (detailLineCount > 0 ? 9.126 : 0)),
        width: box.width - x(17),
        fontSize: inventoryFont(RECORD_SHEET_FONT.inventory),
        lineHeight: weaponStep,
        prefix: ammoPrefix,
    });
}

/** Vehicle inventories have no heat column; a linked enhancement prints its name and damage profile. */
function vehicleLinkedEquipmentFields(linked: RecordSheetLinkedEquipment) {
    return { name: linked.name, location: '', damage: linked.damage, minimumRange: '', ranges: ['', '', ''] } as const;
}

function drawCompactVehicleInventoryFields(
    group: SVGGElement,
    row: {
        readonly name: string;
        readonly location: string;
        readonly damage: string;
        readonly minimumRange: string;
        readonly ranges: readonly string[];
    },
    baseline: number,
    x: (value: number) => number,
    font: (value: number) => number,
    nameX: number,
    lineHeight: number,
): void {
    const addCell = (parent: SVGElement, value: string, x: number, y: number, options: Parameters<typeof addText>[4] = {}) =>
        addInventoryText(parent, value, x, y, { ...options, lineHeight });
    addCell(group, row.name, x(nameX), baseline, {
        class: 'name', size: font(RECORD_SHEET_FONT.inventory), maxWidth: x(100.38 - 9 - 3 - nameX),
    });
    addCell(group, row.location, x(100.38), baseline, {
        class: 'location', size: font(RECORD_SHEET_FONT.inventory), anchor: 'middle', maxWidth: x(18),
    });
    const damage = svgElement('g');
    damage.setAttribute('class', 'damage');
    addCell(damage, row.damage, x(111.2), baseline, { size: font(RECORD_SHEET_FONT.inventory), maxWidth: x(54) });
    group.appendChild(damage);
    const values = [row.minimumRange, ...row.ranges];
    const positions = [172.874, 185.425, 198.842, 212.908];
    const classes = ['range_min', 'range_short', 'range_medium', 'range_long'];
    values.forEach((value, rangeIndex) => addCell(group, value, x(positions[rangeIndex]), baseline, {
        class: classes[rangeIndex], size: font(RECORD_SHEET_FONT.inventory), anchor: 'middle', maxWidth: x(12),
    }));
}

function compactVehicleFeatureText(entity: BaseEntity): string {
    const features: string[] = [];
    const fireControl = fireControlFeatureFromFlagLookup(flag =>
        entity.equipment().some(mount => mount.equipment?.hasFlag(flag)));
    if (fireControl) features.push(fireControl);
    for (const seatType of ['standard-seats', 'pillion-seats', 'ejection-seats'] as const) {
        const seats = entity.transporters().reduce((sum, transporter) => sum + (transporter.kind === 'bay'
            && transporter.configuration.type === seatType ? Math.trunc(transporter.capacity) : 0), 0);
        if (seats === 0) continue;
        const name = getBayTransporterType({ type: seatType });
        features.push(`${formatWholeNumber(seats)} ${seats === 1 ? name.replace('Seats', 'Seat') : name}`);
    }
    const troopSpace = entity.transporters()
        .filter(transporter => transporter.kind === 'troop-space')
        .reduce((sum, transporter) => sum + transporter.totalSpace, 0);
    if (troopSpace > 0) {
        features.push(`Infantry Compartment (${formatNumber(troopSpace)} ${troopSpace === 1 ? 'ton' : 'tons'})`);
    }
    for (const feature of entity.entityFeatures()) {
        if (feature === 'Infantry Compartment' || feature.startsWith('Bay: ')) continue;
        features.push(feature.startsWith('Chassis Mod: ')
            ? `${feature.slice('Chassis Mod: '.length)} Chassis Mod`
            : feature);
    }
    return [...new Set(features)].join(', ');
}

/** MML prints usable misc equipment in the same interactive inventory as weapons. */
function compactVehicleInventoryRows(entity: BaseEntity) {
    const mountsById = new Map(entity.equipment().map(mount => [String(mount.mountId), mount]));
    const weaponRows = recordSheetInventoryWeapons(entity).map(row => {
        const mount = mountsById.get(row.componentIds[0]);
        return Object.freeze({
            ...row,
            name: compactVehicleWeaponName(mount ? recordSheetInventoryMountName(entity, mount) : row.name),
            location: compactVehicleLocation(row.location),
        });
    });
    const weaponMountIds = new Set(entity.rangedWeapons().map(mount => mount.mountId));
    const miscRows = entity.equipment().flatMap(mount => {
            const equipment = mount.equipment;
            if (weaponMountIds.has(mount.mountId)
                || equipment === undefined
                || equipment.type !== 'misc'
                || ['Engine', 'None', 'Unallocated'].includes(mount.location)
                || isRecordSheetInventorySupport(equipment)
                || isHeatSinkEquipment(equipment)
                || isJumpJetEquipment(equipment)
                || isUmuEquipment(equipment)) return [];
            const range = recordSheetElectronicWarfareRange(equipment);
            return Object.freeze({
                name: compactVehicleWeaponName(recordSheetInventoryMountName(entity, mount)),
                location: compactVehicleLocation(mount.getOccupiedLocations().join('/')),
                heat: '—',
                damage: recordSheetEquipmentDamage(mount),
                minimumRange: '—',
                ranges: Object.freeze(['—', '—', range === undefined ? '—' : String(range)]),
                componentIds: Object.freeze([mount.mountId]),
                quantity: 1,
                alternativeModes: Object.freeze([]),
                linkedEquipment: null,
            });
        });
    return Object.freeze([...weaponRows, ...miscRows]);
}

function compactVehicleWeaponName(value: string): string {
    return value.replace(/\s+\((?:T|F|L|R|RR|TU)\)$/u, '').trim();
}

function compactVehicleLocation(value: string): string {
    const locations: Readonly<Record<string, string>> = {
        Front: 'FR', Rear: 'RR', Left: 'LS', Right: 'RS',
        'Left Side': 'LS', 'Right Side': 'RS', Turret: 'TU', Rotor: 'RO', Body: 'BD',
        'Front Turret': 'FT', 'Rear Turret': 'RT',
        'Front Left': 'FRLS', 'Front Right': 'FRRS', 'Rear Left': 'RRLS', 'Rear Right': 'RRRS',
    };
    return value.split('/').map(location => locations[location] ?? location).join('/');
}

export function drawCompactVehicleCrewPanel(
    svg: SVGSVGElement,
    box: Box,
    presentation: CompactVehicleCrewPresentation,
): void {
    const group = addFrame(svg, 'CREW DATA', box, {
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    const state = transparentRect(2, 17, box.width - 4, box.height - 20, 'crewStateButton');
    state.setAttribute('crewId', '0');
    group.insertBefore(state, group.children[2] ?? null);

    addText(group, 'Crew:', 3, 30, { size: RECORD_SHEET_FONT.inventory, weight: 700 });
    // The name line leaves the crew-state menu room before the right gutter.
    const nameEnd = SvgFrameUtil.innerRight(box.width) - 2 - CREW_STATE_MENU_SPACE;
    const name = addText(group, '', 23.036, 30, { size: RECORD_SHEET_FONT.inventory, maxWidth: nameEnd - 23.036 });
    name.id = 'pilotName0';
    const nameButton = transparentRect(21, 20, nameEnd - 21, 12, 'crewNameButton');
    nameButton.setAttribute('crewId', '0');
    nameButton.setAttribute('textElement', name.id);
    group.appendChild(nameButton);
    addLine(group, 23.036, 31, nameEnd, 31, '#111', 0.72);

    const gunneryLabel = addText(group, 'Gunnery Skill:', 3, 42, { size: RECORD_SHEET_FONT.inventory, weight: 700 });
    const gunnery = addCrewSkillValue(group, '4', crewSkillValueX(gunneryLabel, 49.592), 42);
    gunnery.id = 'gunnerySkill0';
    const gunButton = transparentRect(46, 33, 24, 12, 'crewSkillButton');
    gunButton.setAttribute('crewId', '0');
    gunButton.setAttribute('skill', 'gunnery');
    group.appendChild(gunButton);

    const drivingLabel = addText(group, 'Driving Skill:', 72.8, 42, { size: RECORD_SHEET_FONT.inventory, weight: 700 });
    const piloting = addCrewSkillValue(group, '5', crewSkillValueX(drivingLabel, 119.392), 42);
    piloting.id = 'pilotingSkill0';
    const pilotButton = transparentRect(116, 33, 27, 12, 'crewSkillButton');
    pilotButton.setAttribute('crewId', '0');
    pilotButton.setAttribute('skill', 'piloting');
    group.appendChild(pilotButton);

    const isVtol = presentation.airborne;
    drawVehicleDamageCheckbox(group, isVtol ? 'copilot_hit' : 'commander_hit', 57.52, 58, '+1');
    // Captions keep their natural spacing; each fits before the next column.
    addText(group, isVtol ? 'Co-Pilot Hit' : 'Commander Hit', 3, 64.4, { size: RECORD_SHEET_FONT.inventory });
    drawVehicleDamageCheckbox(group, isVtol ? 'pilot_hit' : 'driver_hit', 130.32, 58, '+2');
    addText(group, isVtol ? 'Pilot Hit' : 'Driver Hit', 75.8, 64.4, { size: RECORD_SHEET_FONT.inventory });
    addText(group, isVtol ? 'Modifier to all to-hit rolls' : 'Modifier to all skill rolls', 3, 72.4, { size: 4.83 });
    addText(group, 'Modifier to Driving skill rolls', 75.8, 72.4, { size: 4.83 });

}

export function drawCompactVehicleCriticalPanel(
    svg: SVGSVGElement,
    entity: BaseEntity,
    box: Box,
    airborne: boolean,
): void {
    const group = addFrame(svg, 'CRITICAL DAMAGE', box, {
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });

    const isVtol = airborne;
    const hasTurret = isVehicleEntity(entity) && (entity.hasTurret() || entity.hasDualTurret());
    const firstRowY = isVtol && !hasTurret ? 23.754 : 22.932;
    if (isVtol || hasTurret) {
        addText(group, isVtol ? 'Flight Stabilizer*' : 'Turret Locked', 6, firstRowY + 6.4, {
            size: RECORD_SHEET_FONT.inventory,
            maxWidth: isVtol ? 46.265 : 39.254,
        });
        if (isVtol) drawVehicleDamageCheckbox(group, 'flight_stabilizer_hit', 75.08, firstRowY,
            systemDamageControls(entity, 'flight-stabilizer').modifiers[0]);
        else {
            const turrets = systemDamageLocationControls(entity, 'turret-lock');
            turrets.forEach((control, index) => drawVehicleDamageCheckbox(group, control.id,
                75.08 - (turrets.length - 1 - index) * 11, firstRowY,
                turrets.length > 1 ? control.label[0] : undefined));
        }
        addText(group, 'Engine Hit', 90.36, firstRowY + 6.4, { size: RECORD_SHEET_FONT.inventory, maxWidth: 28.081 });
        drawVehicleDamageCheckbox(group, 'engine_hit_1', 130.32, firstRowY);
    } else {
        addText(group, 'Engine Hit', 6, firstRowY + 6.4, { size: RECORD_SHEET_FONT.inventory, maxWidth: 28.081 });
        drawVehicleDamageCheckbox(group, 'engine_hit_1', 45.96, firstRowY);
    }

    if (isVtol && hasTurret) {
        addText(group, 'Turret Locked', 6, 39.196, { size: RECORD_SHEET_FONT.inventory, maxWidth: 39.254 });
        for (const control of systemDamageLocationControls(entity, 'turret-lock')) {
            drawVehicleDamageCheckbox(group, control.id, 75.08, 32.796);
        }
    }
    const sensorRowY = isVtol ? hasTurret ? 42.66 : 35.262 : 32.796;
    addText(group, 'Sensor Hits', 6, sensorRowY + 6.4, { size: RECORD_SHEET_FONT.inventory, maxWidth: 32.801 });
    drawVehicleDamageTrackRow(group, 'sensor_hit_', 97.32, sensorRowY, systemDamageControls(entity, 'sensors').modifiers);
    if (!isVtol) {
        addText(group, 'Motive System Hits', 6, 49.06, { size: RECORD_SHEET_FONT.inventory, maxWidth: 54.079 });
        drawVehicleDamageTrackRow(group, 'motive_system_hit_', 97.32, 42.66, systemDamageControls(entity, 'motive').modifiers);
    }

    const stabilizerTitleY = isVtol && !hasTurret ? 52.524 : 57.456;
    const stabilizerFirstRowY = isVtol && !hasTurret ? 58.278 : 62.388;
    const stabilizerSecondRowY = isVtol && !hasTurret ? 69.786 : 72.252;
    const stabilizers = systemDamageLocationControls(entity, 'stabilizer');
    const stabilizerColumns = Math.max(3, Math.ceil(stabilizers.length / 2));
    stabilizers.forEach((control, index) => drawVehicleLabeledDamageCheckbox(group,
        control.label, control.id, 6 + (index % stabilizerColumns) * 138 / stabilizerColumns,
        index < stabilizerColumns ? stabilizerFirstRowY : stabilizerSecondRowY,
        138 / stabilizerColumns));
    addText(group, 'Stabilizers', 75.8, stabilizerTitleY, { size: RECORD_SHEET_FONT.inventory, weight: 700, anchor: 'middle' });
    if (isVtol) addText(group, '*Move at Cruising speed only', 6, 84.294, { size: 4.83, maxWidth: 58.681 });

    appendVehicleDamageTrackBindings(svg, entity);
}

/** Front armor by sheet location code; the first code a hull uses wins, absent locations read 0. */
export function vehicleArmorReader(entity: BaseEntity): (...codes: readonly string[]) => number {
    const values = new Map(entity.damageLocations()
        .map(location => [location.sheetCode ?? location.code, location.armor.front] as const));
    return (...codes) => codes.map(code => values.get(code)).find(value => value !== undefined) ?? 0;
}

export function drawVehicleLabeledDamageCheckbox(
    group: SVGGElement,
    label: string,
    sheetId: string,
    x: number,
    y: number,
    columnWidth: number,
): void {
    const checkboxOffset = Math.min(31.224, columnWidth - 12);
    addText(group, label, x, y + 6.4, { size: RECORD_SHEET_FONT.inventory, maxWidth: Math.min(20, checkboxOffset - 2) });
    drawVehicleDamageCheckbox(group, sheetId, x + checkboxOffset, y);
}

export function drawVehicleDamageTrackRow(
    group: SVGGElement,
    prefix: string,
    startX: number,
    y: number,
    labels: readonly string[],
): void {
    labels.forEach((label, index) => {
        drawVehicleDamageCheckbox(group, `${prefix}${index + 1}`, startX + index * 11, y, label);
    });
}

/** Ground and naval vehicle templates use 8-point boxes. */
export function drawVehicleDamageCheckbox(
    group: SVGGElement,
    sheetId: string,
    x: number,
    y: number,
    modifier?: string,
): void {
    drawCriticalDamageBox(group, sheetId, { x, y, width: 8, height: 8 }, { text: modifier, size: 5.7 });
}

export function appendVehicleDamageTrackBindings(svg: SVGSVGElement, entity: BaseEntity): void {
    let hidden = svg.querySelector<SVGGElement>('.generated-hidden-vehicle-damage-tracks');
    if (!hidden) {
        hidden = svgElement('g');
        hidden.setAttribute('class', 'generated-hidden-vehicle-damage-tracks');
        hidden.setAttribute('display', 'none');
        svg.appendChild(hidden);
    }
    for (const definition of buildNonMekRuntimeIndex(entity).damageTracks.values()) {
        const track = systemDamagePresentation(definition);
        let control = svg.getElementById(track.sheetId);
        if (!control) {
            control = svgElement('rect');
            control.id = track.sheetId;
            setAttributes(control, { x: 0, y: 0, width: 8, height: 8, class: 'critLoc', critId: track.sheetId });
            hidden.appendChild(control);
        }
        if (track.visibleHitPips === undefined || svg.getElementById(`${track.sheetId}_pips`)) continue;
        const pips = svgElement('g');
        pips.id = `${track.sheetId}_pips`;
        setAttributes(pips, { class: 'motiveHitPips screen-only', critId: track.sheetId });
        const x = Number(control.getAttribute('x'));
        const y = Number(control.getAttribute('y'));
        const width = Number(control.getAttribute('width'));
        const height = Number(control.getAttribute('height'));
        const cellWidth = width / 3;
        const cellHeight = height / 3;
        const radius = Math.min(cellWidth, cellHeight) * 0.4;
        for (let index = 0; index < track.visibleHitPips; index++) {
            pips.appendChild(circle(
                x + cellWidth * (index % 3 + 0.5),
                y + height + 1 + cellHeight * (Math.floor(index / 3) + 0.5),
                radius,
                'motiveHitPip hidden',
            ));
        }
        control.parentElement!.appendChild(pips);
    }
}

/** Large support vehicles retain six hull facings even when their motive class is not superheavy. */
export function usesSixSideVehicleHull(entity: BaseEntity): boolean {
    return isVehicleEntity(entity) && (entity.entityType === 'LargeSupportTank' || entity.isSuperHeavy());
}

export async function drawCompactVehicleDiagram(
    svg: SVGSVGElement,
    entity: BaseEntity,
    box: Box,
    presentation: CompactVehicleDiagramPresentation,
): Promise<SVGGElement> {
    const group = svgElement('g');
    group.setAttribute('class', 'vehicle-paperdoll');
    group.setAttribute('transform', `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`);
    addDiagramHeading(
        group,
        'ARMOR DIAGRAM',
        armorDiagramSubtitle(entity),
        box.width,
        0,
        { subtitleId: 'armorType' },
    );
    const armorValues: Record<string, number> = {};
    const structureValues: Record<string, number> = {};
    for (const location of entity.damageLocations()) {
        const code = location.sheetCode ?? location.code;
        armorValues[code] = location.armor.front;
        structureValues[code] = location.internalPoints;
    }
    try {
        const paperdoll = await PaperdollGenerator.createPaperdoll(
            presentation.assetUrl,
            box.width,
            box.height - 27,
            { armor: armorValues, structure: structureValues },
            {
                className: 'vehicle-paperdoll-layer',
                centeredHorizontally: false,
                centeredVertically: false,
                preserveAuthoredCoordinates: true,
                scale: false,
                pipLayout: presentation.pipLayout,
                pipOptions: {
                    ...paperdollPipOptions(presentation.pipLayout, 4, 0.72),
                    strokeWidth: 0.5,
                },
            },
        );
        if (presentation.authoredRootTransform !== undefined) {
            const root = paperdoll.querySelector<SVGGElement>('.naval-paperdoll-root');
            if (root) {
                const previousInverse = (root.transform.baseVal.consolidate()?.matrix ?? new DOMMatrix()).inverse();
                root.setAttribute('transform', presentation.authoredRootTransform);
                // Keep controls and hit-result anchors aligned with the submarine's transformed art.
                const change = (root.transform.baseVal.consolidate()?.matrix ?? new DOMMatrix()).multiply(previousInverse);
                const x = Number(paperdoll.dataset['artX']);
                const y = Number(paperdoll.dataset['artY']);
                const width = Number(paperdoll.dataset['artWidth']);
                const height = Number(paperdoll.dataset['artHeight']);
                const corners = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]
                    .map(([px, py]) => new DOMPoint(px, py).matrixTransform(change));
                const left = Math.min(...corners.map(point => point.x));
                const top = Math.min(...corners.map(point => point.y));
                setAttributes(paperdoll, {
                    'data-art-x': left,
                    'data-art-y': top,
                    'data-art-width': Math.max(...corners.map(point => point.x)) - left,
                    'data-art-height': Math.max(...corners.map(point => point.y)) - top,
                });
            }
        }
        decoratePaperdollPips(paperdoll);
        revealVehicleMotiveArt(paperdoll, presentation.motiveArtId);
        group.appendChild(paperdoll);
        appendVehicleDiagramCatalyst(group, box, presentation.catalystY);
        svg.appendChild(group);
        return group;
    } catch {
        // Fall through to the generated damage grid.
    }
    const fallback = svgElement('g');
    fallback.setAttribute('transform', 'translate(0 27)');
    drawDamageLocationGrid(fallback, entity.damageLocations(), { x: 6, y: 23, width: box.width - 12, height: box.height - 55 }, 3);
    group.appendChild(fallback);
    appendVehicleDiagramCatalyst(group, box, presentation.catalystY);
    svg.appendChild(group);
    return group;
}

function revealVehicleMotiveArt(
    paperdoll: SVGGElement,
    motiveArtId: CompactVehicleDiagramPresentation['motiveArtId'],
): void {
    if (motiveArtId !== undefined) {
        paperdoll.querySelector<SVGElement>(`#${motiveArtId}`)?.setAttribute('visibility', 'visible');
    }
}

function appendVehicleDiagramCatalyst(group: SVGGElement, box: Box, y = box.height - 24.413): void {
    const catalyst = svgElement('g');
    catalyst.setAttribute('class', 'compact-vehicle-catalyst');
    catalyst.setAttribute('transform', `translate(139 ${formatNumber(y)}) scale(1.015)`);
    catalyst.appendChild(createCatalystGameLabsLogo());
    group.appendChild(catalyst);
}
