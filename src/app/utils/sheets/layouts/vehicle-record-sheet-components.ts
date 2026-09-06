// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { systemDamageControls,systemDamageLocationControls,systemDamagePresentation } from '../../../models/runtime/system-damage-presentation';

import { isBapEquipment } from '../../../models/bap-equipment.model';
import { artemisKind } from '../../../models/artemis-equipment.model';
import { isNovaC3Equipment } from '../../../models/c3-network.model';
import { isCaseEquipment } from '../../../models/case-equipment.model';
import { isAngelEcmEquipment,isEcmEquipment,isSingleHexEcmEquipment } from '../../../models/ecm-mode.model';
import type { BaseEntity } from '../../../models/entity/base-entity';
import { getBayTransporterType } from '../../../models/entity/bays/bay-definitions';
import { projectRecordSheetBays } from '../../../models/entity/bays/record-sheet-bay-projection';
import { isVehicleEntity } from '../../../models/entity/utils/entity-type-guards';
import { intrinsicActionBaseDamageText } from '../../../models/entity/utils/mek-intrinsic-actions';
import { isEquipmentForPlatform } from '../../../models/equipment-platform.model';
import type { Equipment } from '../../../models/equipment.model';
import { isHeatSinkEquipment } from '../../../models/heat-equipment.model';
import { isJumpJetEquipment,isUmuEquipment } from '../../../models/jump-equipment.model';
import { buildNonMekRuntimeIndex } from '../../../models/runtime/non-mek-runtime-index';
import { sensorEquipmentKind } from '../../../models/sensor-equipment.model';
import { PaperdollGenerator, type PaperdollPipLayout } from '../paperdoll-generator';
import { appendRecordSheetAmmoProfile } from '../record-sheet-ammo-rendering';
import { createBattleTechLogo,createCatalystGameLabsLogo } from '../record-sheet-brand';
import { isRecordSheetInventorySupport, recordSheetInventoryMountName } from '../record-sheet-inventory-equipment';
import {
type Box,
addDiagramHeading,
addFrame,
addLine,
addText,
addWrappedText,
appendLegacyIdentityAnchors,
circle,
constructionMaterialSubtitle,
decoratePaperdollPips,
drawDamagePanelIntoGroup,
formatNumber,
formatRecordSheetTonnage,
formatWholeNumber,
formatTechBase,
paperdollPipOptions,
readViewBox,
recordSheetAmmoProfile,
recordSheetInventoryWeapons,
setAttributes,
setInventoryComponentIds,
svgElement,
transparentRect
} from '../record-sheet-svg-rendering';

export interface CompactVehicleInventoryPresentation {
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
    if (scaleX !== 1 || scaleY !== 1) {
        group.setAttribute('transform', `scale(${formatNumber(scaleX)} ${formatNumber(scaleY)})`);
    }

    const logo = createBattleTechLogo();
    logo.setAttribute('transform', 'scale(0.791)');
    group.appendChild(logo);

    addText(group, title, 192, 63.357, {
        class: 'compact-vehicle-title', size: 11.59, weight: 700, anchor: 'middle',
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
    if (verticalContentScale !== 1) {
        content.setAttribute('transform', `scale(1 ${formatNumber(verticalContentScale)})`);
    }
    group.appendChild(content);
    const sx = box.width / 220.4;
    const sy = box.height / 283;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const typeLabel = addText(content, 'Type:', x(3), y(28), { size: font(9.67), weight: 700 });
    typeLabel.setAttribute('textLength', formatNumber(x(21.401)));
    typeLabel.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    const type = addText(content, entity.displayName(), x(29.229), y(28), {
        size: font(9.67), weight: 700, maxWidth: x(187),
    });
    type.id = 'type';
    type.setAttribute('data-mekbay-field', 'display-name');
    addText(content, 'Movement Points:', x(6), y(38), { size: font(7.7), weight: 700 });
    const movementRows: readonly [string, string, string, string][] = [
        ['Cruising:', String(entity.walkMP()), 'mpWalk', 'walk'],
        ['Flanking:', String(entity.runMP()), 'mpRun', 'run'],
    ];
    movementRows.forEach(([label, value, id, field], index) => {
        const baseline = y(47 + index * 9);
        addText(content, label, x(6), baseline, { size: font(7.7), weight: 700 });
        const node = addText(content, value, x(56), baseline, { size: font(7.7), anchor: 'middle' });
        node.id = id;
        node.setAttribute('data-mekbay-field', field);
    });
    const engine = entity.mountedEngine();
    const weightInKilograms = entity.weightClass() === 'Small Support';
    const facts: readonly [string, string, number, string?, string?][] = [
        ['Tonnage:', formatRecordSheetTonnage(entity.tonnage(), weightInKilograms), 38, 'tonnage', 'tonnage'],
        ['Tech Base:', formatTechBase(entity.techBase(), entity.mixedTech()), 47, 'techBase', 'tech-base'],
        ['Role:', entity.role() || '—', 56, 'role', 'role'],
        ['Engine Type:', entity.isSupportVehicle() ? engine.type() : `${engine.rating} ${engine.type()}`, 65, 'engineType', undefined],
    ];
    facts.forEach(([label, value, baseline, id, field]) => {
        addText(content, label, x(115.7), y(baseline), { size: font(7.7), weight: 700, maxWidth: x(40.5) });
        const node = addText(content, value, x(158.24), y(baseline), { size: font(7.7), maxWidth: x(58) });
        if (id) node.id = id;
        if (field) node.setAttribute('data-mekbay-field', field);
        if (id === 'tonnage' && weightInKilograms) node.setAttribute('data-mekbay-weight-unit', 'kg');
    });
    addText(content, 'Movement Type:', x(6), y(65), { size: font(7.7), weight: 700, maxWidth: x(56) });
    const motive = addText(content, entity.getMotiveTypeAsString() ?? entity.entityType, x(64.129), y(65), {
        size: font(7.7), maxWidth: x(47),
    });
    motive.id = 'movementType';
    addLine(content, x(3), y(71.462), box.width - x(3), y(71.462), '#111', 0.8 * fontScale);
    addText(content, 'Weapons & Equipment Inventory', x(3), y(80.462), { size: font(8.6), weight: 700, maxWidth: x(150) });
    addText(content, '(hexes)', x(171.132), y(80.462), { size: font(6.76) });
    const headings: readonly [string, number, 'start' | 'middle'][] = [
        ['Type', 8.41, 'start'], ['Loc', 100.38, 'middle'], ['Dmg', 111.2, 'start'],
        ['Min', 172.874, 'middle'], ['Sht', 185.425, 'middle'],
        ['Med', 198.842, 'middle'], ['Lng', 212.908, 'middle'],
    ];
    headings.forEach(([label, position, anchor]) => addText(content, label, x(position), y(91.262), {
        size: font(6.76), weight: 700, anchor,
    }));
    appendCompactVehicleInventory(content, entity, { x, y, font }, box, presentation);
    const footerOffset = presentation.footerBaselineOffset ?? 0;
    addLine(content, x(3), y(257.643 + footerOffset), box.width - x(3), y(257.643 + footerOffset), '#111', 0.8 * fontScale);
    addText(content, 'BV:', x(13.845), y(268.143 + footerOffset), { size: font(7.7), weight: 700 });
    const bv = addText(content, formatNumber(entity.battleValue()), x(28.927), y(268.143 + footerOffset), { size: font(7.7) });
    bv.id = 'bv';
    appendLegacyIdentityAnchors(content, entity, box);
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
    const physical = (presentation.includePhysicalAttacks ? entity.intrinsicWeapons() : []).map(attack => ({
        name: attack.name,
        location: attack.locations.join('/') || '—',
        heat: '—',
        damage: attack.kind === 'charge'
            ? `${formatNumber(entity.tonnage() / 5)}×(TMM+1)`
            : intrinsicActionBaseDamageText(attack),
        minimumRange: '—',
        ranges: ['—', '—', '—'] as const,
        componentIds: [] as readonly string[],
    }));
    const weaponStep = y(9.126);
    const ammo = recordSheetAmmoProfile(entity);
    const quirks = orderedVehicleQuirkNames(entity).join(', ');
    const features = compactVehicleFeatureText(entity);
    const caseProtected = entity.equipment().some(mount => isCaseEquipment(mount.equipment));
    const detailRows = [
        ...(features ? [{
            text: `Features ${features}`,
            size: 6.76,
            maxLines: 1,
            italic: false,
        }] : []),
        ...(quirks ? [{
            text: `Quirks: ${quirks}`,
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
    const physicalStart = y(firstDetailBaseline
        - (detailRows.length > 0 ? 13.689 : 0)
        - Math.max(0, physical.length - 1) * 9.126);
    const inventory = svgElement('g');
    setAttributes(inventory, {
        'data-ammo-inventory': '',
        'data-top': y(101.162) - weaponStep * 0.82,
        'data-bottom': physical.length > 0 ? physicalStart - weaponStep
            : y(firstDetailBaseline - (detailRows.length > 0 ? 9.126 : 0)),
    });
    group.appendChild(inventory);
    let displayLine = 0;
    weapons.forEach((row, index) => {
        const baseline = y(101.162) + displayLine * weaponStep;
        const entry = svgElement('g');
        entry.setAttribute('class', 'inventoryEntry');
        entry.setAttribute('id', `generated-vehicle-inventory-row@${index}`);
        setInventoryComponentIds(entry, row.componentIds);
        entry.appendChild(transparentRect(x(6), baseline - weaponStep, x(160), weaponStep,
            'inventoryEntryButton mainButton'));
        const rangeButtons: readonly [string, number][] = [
            ['shrButton', 179], ['medButton', 192.4], ['lngButton', 206.2],
        ];
        rangeButtons.forEach(([className, position]) => entry.appendChild(
            transparentRect(x(position), baseline - weaponStep, x(13.4), weaponStep,
                `inventoryEntryButton ${className}`),
        ));
        const badgeY = baseline - weaponStep + weaponStep * 0.08;
        const badgeHeight = weaponStep * 0.84;
        const hitModRect = svgElement('rect');
        setAttributes(hitModRect, {
            x: x(0.35), y: badgeY, width: x(7.3), height: badgeHeight,
            fill: '#000', class: 'hitMod-rect', display: 'none',
        });
        entry.appendChild(hitModRect);
        const targetTnRect = svgElement('rect');
        setAttributes(targetTnRect, {
            x: x(158.5), y: badgeY, width: x(12), height: badgeHeight,
            fill: '#fff', stroke: '#000', 'stroke-width': 0.8,
            class: 'targetTn-rect', display: 'none',
        });
        entry.appendChild(targetTnRect);
        drawCompactVehicleInventoryFields(entry, row, baseline, x, font, 8.41);
        const hitMod = addText(entry, '', x(4), badgeY + badgeHeight * 0.73, {
            class: 'hitMod-text', size: font(4.6), weight: 700, fill: '#fff', anchor: 'middle',
        });
        hitMod.setAttribute('display', 'none');
        const targetTn = addText(entry, '', x(164.5), badgeY + badgeHeight * 0.73, {
            class: 'targetTn-text', size: font(5), weight: 700, anchor: 'middle',
        });
        targetTn.setAttribute('display', 'none');
        if (row.linkedEquipment) {
            const linked = svgElement('g');
            setAttributes(linked, { class: 'inventoryEntry linked', id: `generated-vehicle-linked-row@${index}` });
            setInventoryComponentIds(linked, [row.linkedEquipment.componentId]);
            const linkedBaseline = baseline + weaponStep;
            linked.appendChild(transparentRect(x(6), linkedBaseline - weaponStep, x(160), weaponStep,
                'inventoryEntryButton mainButton'));
            addText(linked, row.linkedEquipment.name, x(12.738), linkedBaseline,
                { class: 'name', size: font(6.76), maxWidth: x(150) });
            entry.appendChild(linked);
        }
        row.alternativeModes.forEach((mode, modeIndex) => {
            const modeBaseline = baseline + (modeIndex + 1 + (row.linkedEquipment ? 1 : 0)) * weaponStep;
            const alternative = svgElement('g');
            alternative.setAttribute('class', mode.displayOnly ? 'equipmentProfile' : 'alternativeMode');
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
            }, modeBaseline, x, font, 12.738);
            entry.appendChild(alternative);
        });
        inventory.appendChild(entry);
        displayLine += 1 + row.alternativeModes.length + (row.linkedEquipment ? 1 : 0);
    });
    const cargoBays = projectRecordSheetBays(entity.transporters());
    if (cargoBays.length > 0) {
        const cargo = svgElement('g');
        cargo.setAttribute('class', 'vehicle-cargo');
        const cargoBaseline = () => y(101.162) + displayLine++ * weaponStep;
        addText(cargo, 'Cargo:', x(7.328), cargoBaseline(), { size: font(6.76), weight: 700 });
        for (const bay of cargoBays) {
            const names = bay.members.map(member => member.typeName).join('/');
            const capacities = bay.members.map(member => formatWholeNumber(member.capacity)).join('/');
            addText(cargo, `Bay ${bay.bayNumber}: ${names} (${capacities}) (${bay.doors} ${bay.doors === 1 ? 'Door' : 'Doors'})`,
                x(7.328), cargoBaseline(), { size: font(6.76), maxWidth: box.width - x(15) });
        }
        inventory.appendChild(cargo);
    }
    inventory.setAttribute('data-content-bottom', String(y(101.162) + Math.max(0, displayLine - 1) * weaponStep));
    const physicalRows = svgElement('g');
    physicalRows.setAttribute('data-ammo-before', '');
    group.appendChild(physicalRows);
    physical.forEach((row, index) => {
        const baseline = physicalStart + index * weaponStep;
        const entry = svgElement('g');
        entry.setAttribute('class', 'inventoryEntry');
        entry.setAttribute('id', `generated-vehicle-physical-row@${index}`);
        setInventoryComponentIds(entry, row.componentIds);
        entry.appendChild(transparentRect(x(6), baseline - weaponStep, x(160), weaponStep,
            'inventoryEntryButton mainButton'));
        drawCompactVehicleInventoryFields(entry, row, baseline, x, font, 8.41);
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
        fontSize: font(6.76),
        lineHeight: weaponStep,
        prefix: `Ammo${caseProtected ? ' (CASE)' : ''}:`,
    });
}

/**
 * MegaMek renders positive quirks before negative quirks and keeps Oversized,
 * which was added later to its option catalog, at the end of the negative list.
 * Preserve source order for every other quirk so custom catalogs remain stable.
 */
function orderedVehicleQuirkNames(entity: BaseEntity): readonly string[] {
    return entity.quirks()
        .map((entry, sourceIndex) => ({ entry, sourceIndex }))
        .sort((left, right) => {
            const leftPositive = left.entry.quirk.type === 'positive';
            const rightPositive = right.entry.quirk.type === 'positive';
            if (leftPositive !== rightPositive) return leftPositive ? -1 : 1;
            const leftOversized = left.entry.quirk.key === 'oversized';
            const rightOversized = right.entry.quirk.key === 'oversized';
            if (leftOversized !== rightOversized) return leftOversized ? 1 : -1;
            return left.sourceIndex - right.sourceIndex;
        })
        .map(({ entry }) => entry.quirk.name);
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
): void {
    addText(group, row.name, x(nameX), baseline, { class: 'name', size: font(6.76), maxWidth: x(88) });
    addText(group, row.location, x(100.38), baseline, {
        class: 'location', size: font(6.76), anchor: 'middle', maxWidth: x(18),
    });
    const damage = svgElement('g');
    damage.setAttribute('class', 'damage');
    addText(damage, row.damage, x(111.2), baseline, { size: font(6.76), maxWidth: x(56) });
    group.appendChild(damage);
    const values = [row.minimumRange, ...row.ranges];
    const positions = [172.874, 185.425, 198.842, 212.908];
    const classes = ['range_min', 'range_short', 'range_medium', 'range_long'];
    values.forEach((value, rangeIndex) => addText(group, value, x(positions[rangeIndex]), baseline, {
        class: classes[rangeIndex], size: font(6.76), anchor: 'middle', maxWidth: x(12),
    }));
}

function compactVehicleFeatureText(entity: BaseEntity): string {
    const features: string[] = [];
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
        const linkingMount = mount && entity.getLinkingMount(mount);
        const artemis = artemisKind(linkingMount?.equipment);
        return Object.freeze({
            ...row,
            name: compactVehicleWeaponName(mount ? recordSheetInventoryMountName(entity, mount) : row.name),
            location: compactVehicleLocation(row.location),
            linkedEquipment: linkingMount && artemis ? {
                componentId: linkingMount.mountId,
                name: artemis === 'v' ? 'w/Artemis V' : artemis === 'iv' ? 'w/Artemis IV' : 'w/Prototype Artemis IV',
            } : null,
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
            const range = compactElectronicWarfareRange(equipment);
            return Object.freeze({
                name: compactVehicleWeaponName(recordSheetInventoryMountName(entity, mount)),
                location: compactVehicleLocation(mount.getOccupiedLocations().join('/')),
                heat: '—',
                damage: equipment.hasFlag('F_AP_POD') ? '[PB,OS,AI]' : String(mount.getPhysicalWeaponDamage()?.value ?? '[E]'),
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

function compactElectronicWarfareRange(equipment: Equipment): number | undefined {
    const sensorKind = sensorEquipmentKind(equipment);
    if (!isEcmEquipment(equipment) && !isBapEquipment(equipment)) return undefined;
    if (isAngelEcmEquipment(equipment) && isEquipmentForPlatform(equipment, 'battle-armor')) return 2;
    if (sensorKind === 'electronic-warfare'
        || sensorKind === 'watchdog'
        || isNovaC3Equipment(equipment)) return 3;
    if (isSingleHexEcmEquipment(equipment)) return 0;
    if (isEcmEquipment(equipment)) return 6;
    if (sensorKind === 'bloodhound') return 8;
    if (/light active probe/iu.test(equipment.id)) return 3;
    if (/improved active probe/iu.test(equipment.id)) return 2;
    return equipment.techBase === 'Clan' ? 5 : 4;
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
        cornerAngleDegrees: { topRight: 0, bottomLeft: 0, bottomRight: 45 },
    });
    const state = transparentRect(2, 17, box.width - 4, box.height - 20, 'crewStateButton');
    state.setAttribute('crewId', '0');
    group.insertBefore(state, group.children[2] ?? null);

    addText(group, 'Crew:', 3, 30, { size: 6.76, weight: 700 });
    const name = addText(group, '', 23.036, 30, { size: 6.76, maxWidth: box.width - 26 });
    name.id = 'pilotName0';
    const nameButton = transparentRect(21, 20, box.width - 23, 12, 'crewNameButton');
    nameButton.setAttribute('crewId', '0');
    nameButton.setAttribute('textElement', name.id);
    group.appendChild(nameButton);
    addLine(group, 23.036, 31, box.width - 3, 31, '#111', 0.72);

    addText(group, 'Gunnery Skill:', 3, 42, { size: 6.76, weight: 700, maxWidth: 39.172 });
    const gunnery = addText(group, '4', 49.592, 42, { size: 6.76, class: 'skillValue' });
    gunnery.id = 'gunnerySkill0';
    const gunButton = transparentRect(46, 33, 24, 12, 'crewSkillButton');
    gunButton.setAttribute('crewId', '0');
    gunButton.setAttribute('skill', 'gunnery');
    group.appendChild(gunButton);

    addText(group, 'Driving Skill:', 72.8, 42, { size: 6.76, weight: 700, maxWidth: 35.365 });
    const piloting = addText(group, '5', 119.392, 42, { size: 6.76, class: 'skillValue' });
    piloting.id = 'pilotingSkill0';
    const pilotButton = transparentRect(116, 33, 27, 12, 'crewSkillButton');
    pilotButton.setAttribute('crewId', '0');
    pilotButton.setAttribute('skill', 'piloting');
    group.appendChild(pilotButton);

    const isVtol = presentation.airborne;
    drawVehicleDamageCheckbox(group, isVtol ? 'copilot_hit' : 'commander_hit', 57.52, 58, '+1');
    addText(group, isVtol ? 'Co-Pilot Hit' : 'Commander Hit', 3, 64.4, {
        size: 6.76,
        maxWidth: isVtol ? 30.632 : 44.689,
    });
    drawVehicleDamageCheckbox(group, isVtol ? 'pilot_hit' : 'driver_hit', 130.32, 58, '+2');
    addText(group, isVtol ? 'Pilot Hit' : 'Driver Hit', 75.8, 64.4, {
        size: 6.76,
        maxWidth: isVtol ? 21.789 : 26.819,
    });
    addText(group, isVtol ? 'Modifier to all to-hit rolls' : 'Modifier to all skill rolls', 3, 72.4, {
        size: 4.83,
        maxWidth: 45.035,
    });
    addText(group, 'Modifier to Driving skill rolls', 75.8, 72.4, { size: 4.83, maxWidth: 54.512 });

}

export function drawCompactVehicleCriticalPanel(
    svg: SVGSVGElement,
    entity: BaseEntity,
    box: Box,
    airborne: boolean,
): void {
    const group = addFrame(svg, 'CRITICAL DAMAGE', box, {
        cornerAngleDegrees: { topRight: 0, bottomLeft: 0, bottomRight: 45 },
    });

    const isVtol = airborne;
    const hasTurret = isVehicleEntity(entity) && (entity.hasTurret() || entity.hasDualTurret());
    const firstRowY = isVtol && !hasTurret ? 23.754 : 22.932;
    if (isVtol || hasTurret) {
        addText(group, isVtol ? 'Flight Stabilizer*' : 'Turret Locked', 6, firstRowY + 6.4, {
            size: 6.76,
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
        addText(group, 'Engine Hit', 90.36, firstRowY + 6.4, { size: 6.76, maxWidth: 28.081 });
        drawVehicleDamageCheckbox(group, 'engine_hit_1', 130.32, firstRowY);
    } else {
        addText(group, 'Engine Hit', 6, firstRowY + 6.4, { size: 6.76, maxWidth: 28.081 });
        drawVehicleDamageCheckbox(group, 'engine_hit_1', 45.96, firstRowY);
    }

    if (isVtol && hasTurret) {
        addText(group, 'Turret Locked', 6, 39.196, { size: 6.76, maxWidth: 39.254 });
        for (const control of systemDamageLocationControls(entity, 'turret-lock')) {
            drawVehicleDamageCheckbox(group, control.id, 75.08, 32.796);
        }
    }
    const sensorRowY = isVtol ? hasTurret ? 42.66 : 35.262 : 32.796;
    addText(group, 'Sensor Hits', 6, sensorRowY + 6.4, { size: 6.76, maxWidth: 32.801 });
    drawVehicleDamageTrackRow(group, 'sensor_hit_', 97.32, sensorRowY, systemDamageControls(entity, 'sensors').modifiers);
    if (!isVtol) {
        addText(group, 'Motive System Hits', 6, 49.06, { size: 6.76, maxWidth: 54.079 });
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
    addText(group, 'Stabilizers', 75.8, stabilizerTitleY, { size: 6.76, weight: 700, anchor: 'middle' });
    if (isVtol) addText(group, '*Move at Cruising speed only', 6, 84.294, { size: 4.83, maxWidth: 58.681 });

    appendHiddenVehicleDamageTracks(svg, entity);
}

function drawVehicleLabeledDamageCheckbox(
    group: SVGGElement,
    label: string,
    sheetId: string,
    x: number,
    y: number,
    columnWidth: number,
): void {
    const checkboxOffset = Math.min(31.224, columnWidth - 12);
    addText(group, label, x, y + 6.4, { size: 6.76, maxWidth: Math.min(20, checkboxOffset - 2) });
    drawVehicleDamageCheckbox(group, sheetId, x + checkboxOffset, y);
}

function drawVehicleDamageTrackRow(
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

function drawVehicleDamageCheckbox(
    group: SVGGElement,
    sheetId: string,
    x: number,
    y: number,
    modifier?: string,
): void {
    const control = svgElement('rect');
    control.id = sheetId;
    setAttributes(control, {
        x,
        y,
        width: 8,
        height: 8,
        rx: 1.315,
        fill: 'none',
        stroke: '#000',
        'stroke-width': 0.96,
        class: 'critLoc criticalPip',
    });
    control.setAttribute('critId', sheetId);
    group.appendChild(control);
    if (modifier) addText(group, modifier, x + 4, y + 6, {
        size: 5.7,
        anchor: 'middle',
        maxWidth: 6.5,
    }).style.pointerEvents = 'none';
}

export function appendHiddenVehicleDamageTracks(svg: SVGSVGElement, entity: BaseEntity): void {
    let hidden = svg.querySelector<SVGGElement>('.generated-hidden-vehicle-damage-tracks');
    if (!hidden) {
        hidden = svgElement('g');
        hidden.setAttribute('class', 'generated-hidden-vehicle-damage-tracks');
        hidden.setAttribute('display', 'none');
        svg.appendChild(hidden);
    }
    for (const definition of buildNonMekRuntimeIndex(entity).damageTracks.values()) {
        const track = systemDamagePresentation(definition);
        if (!svg.getElementById(track.sheetId)) {
            const control = svgElement('rect');
            control.id = track.sheetId;
            control.setAttribute('class', 'critLoc');
            control.setAttribute('critId', track.sheetId);
            hidden.appendChild(control);
        }
        if (track.visibleHitPips === undefined || svg.getElementById(`${track.sheetId}_pips`)) continue;
        const pips = svgElement('g');
        pips.id = `${track.sheetId}_pips`;
        pips.setAttribute('class', 'motiveHitPips');
        for (let index = 0; index < track.visibleHitPips; index++) {
            pips.appendChild(circle(index * 3, 0, 1, 'motiveHitPip pip hidden'));
        }
        hidden.appendChild(pips);
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
    const armor = entity.uniformArmor()?.armor;
    const armorName = entity.isSupportVehicle() && armor?.armorType.startsWith('SV_BAR_')
        ? `BAR: ${armor.bar}` : armor?.name;
    addDiagramHeading(
        group,
        'ARMOR DIAGRAM',
        constructionMaterialSubtitle(armorName, 'Armor', 'Patchwork Armor'),
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
        // The heading's right margin stays clear of the ribbon and every vehicle silhouette.
        paperdoll.setAttribute('data-random-hit-transform', `translate(${formatNumber(box.width - 28)} 1) scale(0.9)`);
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
    drawDamagePanelIntoGroup(fallback, entity, box.width, box.height - 27);
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
