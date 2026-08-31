// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { heatLevels } from '../../models/common.model';
import type { BaseEntity } from '../../models/entity/base-entity';
import { formatEquipmentLocationCodes } from '../equipment-location-display.util';
import type { EntityDamageLocation, EntityTechBase } from '../../models/entity/types';
import {
    ATM_AMMO_PROFILES,
    MML_AMMO_PROFILES,
    type AmmoWeaponProfile,
} from '../../models/ammo-weapon-profile.model';
import type { WeaponEquipment } from '../../models/equipment.model';
import { buildNonMekRuntimeIndex } from '../../models/runtime/non-mek-runtime-index';
import { clusterHits } from '../cluster-hit-table';
import { recordSheetAmmoName } from '../record-sheet-ammo.util';
import { defaultRecordSheetWeaponDamageText } from '../record-sheet-weapon-info.util';
import type { BipedPaperdollPipLayout } from './biped-paperdoll.util';
import { DistributedPipRenderer } from './distributed-pip-renderer';
import { GenericPipRenderer } from './generic-pip-renderer';
import { PipShapeProfile } from './pip-shape-profile';
import {
    RECORD_SHEET_CONTENT_HEIGHT,
    RECORD_SHEET_CONTENT_WIDTH,
    type CompactRecordSheetKind,
    type RecordSheetPageFormat,
    type RecordSheetPageProfile,
} from './record-sheet-layout';
import { createBattleTechLogo, createCatalystGameLabsLogo } from './record-sheet-brand';
import { SvgFrameUtil } from './svg-frame.util';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

export interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface CompactMastheadOptions {
    readonly titleLines: readonly string[];
    readonly drawIcon?: (parent: SVGGElement, box: Box, svg: SVGSVGElement) => void;
}

export function createRoot(width: number, height: number, kind: string): SVGSVGElement {
    const svg = svgElement('svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('xmlns:xlink', XLINK_NS);
    svg.setAttribute('width', formatNumber(width));
    svg.setAttribute('height', formatNumber(height));
    svg.setAttribute('viewBox', `0 0 ${formatNumber(width)} ${formatNumber(height)}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'img');
    svg.setAttribute('class', 'mekbay-sheet');
    svg.setAttribute('data-mekbay-generated', '1');
    svg.setAttribute('data-mekbay-generator-version', '2');
    svg.setAttribute('data-mekbay-sheet-kind', kind);
    const defs = svgElement('defs');
    const nightFilter = svgElement('filter');
    nightFilter.id = 'mekbay-night-image-invert';
    nightFilter.setAttribute('color-interpolation-filters', 'sRGB');
    const componentTransfer = svgElement('feComponentTransfer');
    for (const channel of ['R', 'G', 'B'] as const) {
        const fn = svgElement(`feFunc${channel}`);
        fn.setAttribute('type', 'table');
        fn.setAttribute('tableValues', '1 0');
        componentTransfer.appendChild(fn);
    }
    nightFilter.appendChild(componentTransfer);
    defs.appendChild(nightFilter);
    svg.appendChild(defs);

    const background = svgElement('rect');
    setAttributes(background, { x: 0, y: 0, width, height, fill: 'none', class: 'record-sheet-background' });
    svg.appendChild(background);
    const style = svgElement('style');
    style.id = 'mekbay-svg-style';
    style.textContent = `svg:not(:root) { overflow: visible; }\n${RECORD_SHEET_STYLE}`;
    svg.appendChild(style);
    return svg;
}

export function drawPageChrome(
    svg: SVGSVGElement,
    title: string,
    page: RecordSheetPageProfile,
    compact: boolean,
    compactOptions?: CompactMastheadOptions,
): void {
    const brand = svgElement('g');
    brand.setAttribute('class', 'record-sheet-masthead');
    const logoScale = 0.791 * page.horizontalScale;
    const logoY = page.margin;
    const logo = createBattleTechLogo();
    logo.setAttribute(
        'transform',
        `translate(${formatNumber(page.margin)} ${formatNumber(logoY)}) scale(${formatNumber(logoScale)})`,
    );
    brand.appendChild(logo);

    if (compact) {
        const calloutWidth = 184 * page.horizontalScale;
        const calloutHeight = 45.357 * page.verticalScale;
        const callout = SvgFrameUtil.createSVGFrame('', calloutWidth, calloutHeight, {
            showHeader: false,
            cornerAngleDegrees: 45,
        });
        callout.setAttribute('class', 'record-sheet-unit-title-frame');
        callout.setAttribute(
            'transform',
            `translate(${formatNumber(page.margin + 387 * page.horizontalScale)} `
            + `${formatNumber(page.margin + 3 * page.verticalScale)})`,
        );
        const lines = compactOptions?.titleLines ?? [title];
        const titleX = 103.95 * page.horizontalScale;
        const firstY = (27.578 - (lines.length - 1) * 6.5) * page.verticalScale;
        lines.forEach((line, index) => addText(callout, line, titleX, firstY + index * 13 * page.verticalScale, {
            size: 11.59 * Math.min(page.horizontalScale, page.verticalScale),
            weight: 700,
            anchor: 'middle',
            maxWidth: 124 * page.horizontalScale,
        }));
        compactOptions?.drawIcon?.(callout, {
            x: 12.841 * page.horizontalScale,
            y: 2 * page.verticalScale,
            width: 31.018 * page.horizontalScale,
            height: 41.357 * page.verticalScale,
        }, svg);
        brand.appendChild(callout);
    } else {
        addText(
            brand,
            title,
            page.margin + 192 * page.horizontalScale,
            page.margin + 63.357 * page.horizontalScale,
            {
                size: 11.59 * page.horizontalScale,
                weight: 700,
                anchor: 'middle',
                maxWidth: 260 * page.horizontalScale,
            },
        );
    }
    svg.appendChild(brand);
}

export function compactPageTitle(blocks: readonly SVGSVGElement[]): string {
    const titles = new Set(blocks
        .map(block => block.getAttribute('data-mekbay-page-title'))
        .filter((title): title is string => title !== null && title.length > 0));
    return titles.size === 1 ? [...titles][0] : 'CLASSIC BATTLETECH RECORD SHEET';
}

export function renumberCompactBlock(
    group: SVGGElement,
    expectedPrefix: string | null,
    number: number,
): void {
    if (expectedPrefix === null || expectedPrefix.length === 0) return;
    const title = Array.from(group.querySelectorAll<SVGTextElement>('.svg-frame-title'))
        .find(node => node.textContent?.startsWith(expectedPrefix));
    if (title) title.textContent = `${expectedPrefix}${number}`;
}

export function compactLocationLabel(value: string): string {
    return value.split('/').map(location => ({
        'Main Gun': 'MG', 'Right Arm': 'RA', 'Left Arm': 'LA', Torso: 'T', Legs: 'L', Head: 'HD', Body: 'BD',
    })[location] ?? location).join('/');
}

export function compactArmorDisplayName(value: string | undefined, fallback: string): string {
    const compact = (value ?? '')
        .replace(/\b(?:Battle Armor|BA|ProtoMech|ProtoMek)\b/giu, '')
        .replace(/\bArmor\b/giu, '')
        .replace(/\s+/gu, ' ')
        .trim();
    return compact || fallback;
}

export function makeHorizontalPips(
    count: number,
    startX: number,
    centerY: number,
    width: number,
    preferredRadius: number,
    type: 'armor' | 'structure',
    location: string,
): SVGGElement {
    const group = svgElement('g');
    group.setAttribute('class', 'pip-group');
    const safeCount = Math.max(0, Math.floor(count));
    const radius = safeCount <= 1
        ? preferredRadius
        : Math.min(preferredRadius, width / (safeCount * 2.35));
    const step = safeCount <= 1 ? 0 : Math.max(radius * 2.15, (width - radius * 2) / (safeCount - 1));
    for (let index = 0; index < safeCount; index++) {
        const pip = circle(startX + radius + index * step, centerY, radius, `pip ${type}`);
        pip.setAttribute('loc', location);
        group.appendChild(pip);
    }
    return group;
}

export function drawCheckbox(
    parent: SVGElement,
    x: number,
    y: number,
    size: number,
    checked: boolean,
    className = 'record-sheet-checkbox',
): SVGRectElement {
    const box = svgElement('rect');
    setAttributes(box, {
        x, y, width: size, height: size, rx: Math.max(0.5, size * 0.12),
        fill: '#fff', stroke: '#111', 'stroke-width': Math.max(0.45, size * 0.08), class: className,
    });
    parent.appendChild(box);
    if (checked) {
        const check = svgElement('path');
        check.setAttribute('d', `M${formatNumber(x + size * 0.18)} ${formatNumber(y + size * 0.52)} l${formatNumber(size * 0.22)} ${formatNumber(size * 0.24)} l${formatNumber(size * 0.46)} -${formatNumber(size * 0.58)}`);
        check.setAttribute('fill', 'none');
        check.setAttribute('stroke', '#111');
        check.setAttribute('stroke-width', formatNumber(Math.max(0.65, size * 0.12)));
        check.setAttribute('stroke-linecap', 'round');
        check.setAttribute('stroke-linejoin', 'round');
        parent.appendChild(check);
    }
    return box;
}

export function recordSheetInventoryWeapons(entity: BaseEntity, mergeIdentical = false): readonly {
    readonly name: string;
    readonly location: string;
    readonly heat: string;
    readonly damage: string;
    readonly minimumRange: string;
    readonly ranges: readonly string[];
    readonly componentIds: readonly string[];
    readonly quantity: number;
    readonly alternativeModes: readonly RecordSheetInventoryAlternativeMode[];
}[] {
    const sortedMounts = [...entity.rangedWeapons()].sort((left, right) => {
        if (left.equipment.id === right.equipment.id) {
            if (left.rearMounted !== right.rearMounted) return left.rearMounted ? 1 : -1;
            return 0;
        }
        const leftRanges = recordSheetSortRanges(left.equipment);
        const rightRanges = recordSheetSortRanges(right.equipment);
        const rangeCount = Math.max(leftRanges.length, rightRanges.length);
        for (let index = 0; index < rangeCount; index++) {
            const delta = (rightRanges[index] ?? 0) - (leftRanges[index] ?? 0);
            if (delta !== 0) return delta;
        }
        return right.equipment.heat - left.equipment.heat;
    });
    const unmerged = sortedMounts.map(mount => {
        const alternativeModes = recordSheetAlternativeModes(mount.equipment);
        const semanticDamage = defaultRecordSheetWeaponDamageText(mount.equipment, entity.getEquipmentRegistry());
        return {
            name: mount.displayName(),
            location: formatEquipmentLocationCodes(mount.getOccupiedLocations()),
            heat: String(mount.equipment.heat),
            damage: alternativeModes.length > 0
                ? semanticDamage.match(/\[[^\]]+\]\s*$/u)?.[0] ?? ''
                : semanticDamage,
            minimumRange: alternativeModes.length > 0
                ? ''
                : mount.equipment.minimumRange > 0 ? String(mount.equipment.minimumRange) : '—',
            ranges: alternativeModes.length > 0
                ? Object.freeze(['', '', ''])
                : Object.freeze(recordSheetWeaponRanges(mount.equipment)
                    .slice(0, 3)
                    .map(value => value > 0 ? String(value) : '—')),
            componentIds: Object.freeze([mount.mountId]),
            quantity: 1,
            alternativeModes,
        };
    });
    if (!mergeIdentical) return Object.freeze(unmerged.map(row => Object.freeze(row)));

    const rows = new Map<string, {
        name: string;
        location: string;
        heat: string;
        damage: string;
        minimumRange: string;
        ranges: readonly string[];
        componentIds: string[];
        quantity: number;
        alternativeModes: readonly RecordSheetInventoryAlternativeMode[];
    }>();
    unmerged.forEach(row => {
        const key = JSON.stringify({ ...row, componentIds: undefined });
        const existing = rows.get(key);
        if (existing) {
            existing.componentIds.push(...row.componentIds);
            existing.quantity += row.quantity;
        } else {
            rows.set(key, { ...row, componentIds: [...row.componentIds] });
        }
    });
    return Object.freeze([...rows.values()].map(row => Object.freeze({
        ...row,
        componentIds: Object.freeze([...row.componentIds]),
    })));
}

export interface RecordSheetInventoryAlternativeMode {
    readonly name: string;
    readonly damage: string;
    readonly minimumRange: string;
    readonly ranges: readonly [string, string, string];
}

function recordSheetSortRanges(weapon: WeaponEquipment): readonly number[] {
    const profiles = recordSheetAmmoProfiles(weapon);
    return profiles.length === 0
        ? weapon.ranges
        : profiles.reduce<readonly number[]>((best, profile) => profile.ranges[2] > (best[2] ?? 0)
            ? profile.ranges
            : best, weapon.ranges);
}

/** Matches MegaMekLab's StandardInventoryEntry range choice for torpedo launchers. */
function recordSheetWeaponRanges(weapon: WeaponEquipment): readonly number[] {
    return weapon.ammoType.includes('TORPEDO') ? weapon.weapon.wRanges : weapon.ranges;
}

function recordSheetAlternativeModes(weapon: WeaponEquipment): readonly RecordSheetInventoryAlternativeMode[] {
    return Object.freeze(recordSheetAmmoProfiles(weapon).map(profile => Object.freeze({
        name: profile.displayName,
        damage: recordSheetModeDamage(profile),
        minimumRange: profile.minimumRange > 0 ? String(profile.minimumRange) : '—',
        ranges: Object.freeze(profile.ranges.slice(0, 3).map(range => String(range))) as readonly [string, string, string],
    })));
}

function recordSheetAmmoProfiles(weapon: WeaponEquipment): readonly AmmoWeaponProfile[] {
    if (weapon.ammoType === 'MML') return MML_AMMO_PROFILES;
    if (weapon.ammoType === 'ATM' || weapon.ammoType === 'IATM') return ATM_AMMO_PROFILES;
    return [];
}

function recordSheetModeDamage(profile: AmmoWeaponProfile): string {
    switch (profile.id) {
        case 'mml-lrm':
        case 'atm-extended-range': return '1/Msl';
        case 'mml-srm':
        case 'atm-standard': return '2/Msl';
        case 'atm-high-explosive': return '3/Msl';
    }
}

export function recordSheetAmmoProfile(entity: BaseEntity): readonly string[] {
    const totals = new Map<string, number>();
    entity.equipment().forEach(mount => {
        const shots = mount.getAmmoShots();
        if (shots === undefined) return;
        const name = recordSheetAmmoName(mount.displayName());
        totals.set(name, (totals.get(name) ?? 0) + shots);
    });
    return Object.freeze([...totals.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, shots]) => `(${name}) ${shots}`));
}

export function formatDamageValue(value: string | number | readonly number[]): string {
    return Array.isArray(value) ? value.join('/') : String(value);
}

export function drawIdentityPanel(svg: SVGSVGElement, entity: BaseEntity, box: Box): void {
    const group = addFrame(svg, entity.entityType.toUpperCase(), box);
    const content = innerBox(box, 8, 22);
    const lines: readonly [string, string, string?][] = [
        ['UNIT', entity.displayName(), 'display-name'],
        ['TONS', formatNumber(entity.tonnage()), 'tonnage'],
        ['YEAR', String(entity.year()), 'year'],
        ['TECH', formatTechBase(entity.techBase(), entity.mixedTech()), 'tech-base'],
        ['ROLE', entity.role() || '—', 'role'],
        ['MOTIVE', entity.getMotiveTypeAsString() ?? entity.entityType, undefined],
        ['MOVEMENT', `${entity.walkMP()} / ${entity.runMP()} / ${entity.jumpMP()}`, undefined],
        ['BATTLE VALUE', formatNumber(entity.battleValue()), 'bv'],
    ];
    const available = Math.max(1, content.height);
    const rowHeight = Math.min(14, available / lines.length);
    lines.forEach(([label, value, field], index) => {
        const y = content.y - box.y + 8 + index * rowHeight;
        addText(group, label, content.x - box.x, y, { size: 6.4, weight: 700, fill: '#555' });
        const valueText = addText(group, value, content.x - box.x + 46, y, {
            size: index === 0 ? 8.7 : 7.6,
            weight: index === 0 ? 700 : 500,
            maxWidth: Math.max(10, content.width - 46),
        });
        if (field) valueText.setAttribute('data-mekbay-field', field);
        if (index < lines.length - 1) addLine(group, content.x - box.x, y + 3, content.x - box.x + content.width, y + 3, '#ddd', 0.5);
    });
    appendLegacyIdentityAnchors(group, entity, box);
}

export function appendLegacyIdentityAnchors(group: SVGGElement, entity: BaseEntity, box: Box): void {
    const values: Readonly<Record<string, string>> = {
        type: entity.displayName(),
        unitName: entity.displayName(),
        tonnage: formatNumber(entity.tonnage()),
        year: String(entity.year()),
        techBase: formatTechBase(entity.techBase(), entity.mixedTech()),
        role: entity.role(),
        movementType: entity.getMotiveTypeAsString() ?? entity.entityType,
        mpWalk: String(entity.walkMP()),
        mpRun: String(entity.runMP()),
        mpJump: String(entity.jumpMP()),
        bv: formatNumber(entity.battleValue()),
    };
    Object.entries(values).forEach(([id, value]) => {
        if (group.ownerSVGElement?.getElementById(id)) return;
        const anchor = addText(group, value, box.width - 3, box.height - 3, { size: 0.1, fill: '#fff' });
        anchor.id = id;
        anchor.setAttribute('aria-hidden', 'true');
    });
}

export function drawInventoryPanel(
    svg: SVGSVGElement,
    entity: BaseEntity,
    box: Box,
    requestedRows: number,
    mekLayout: boolean,
): void {
    const group = addFrame(svg, 'WEAPONS & EQUIPMENT', box);
    appendInventoryRows(group, entity, box.width, 22, box.height - 27, requestedRows, mekLayout);
}

function appendInventoryRows(
    group: SVGGElement,
    entity: BaseEntity,
    width: number,
    startY: number,
    availableHeight: number,
    requestedRows: number,
    mekLayout: boolean,
): void {
    const count = mekLayout ? requestedRows : Math.max(requestedRows, entity.equipment().length);
    const rowHeight = Math.max(4.8, Math.min(10.5, availableHeight / Math.max(1, count)));
    const fontSize = Math.max(3.6, Math.min(6.2, rowHeight - 1.4));
    for (let index = 0; index < count; index++) {
        const mount = entity.equipment()[index];
        const row = svgElement('g');
        row.setAttribute('class', 'inventoryEntry');
        row.setAttribute('id', mekLayout ? `r${index}` : `${mount?.equipmentId ?? 'unused'}@${index}`);
        row.setAttribute('transform', `translate(7 ${formatNumber(startY + index * rowHeight)})`);
        if ((index + 1) * rowHeight > availableHeight + 0.001) row.setAttribute('display', 'none');
        const button = svgElement('rect');
        setAttributes(button, {
            x: 0,
            y: 0,
            width: width - 14,
            height: rowHeight,
            fill: index % 2 === 0 ? '#f5f5f5' : '#fff',
            class: 'inventoryEntryButton mainButton',
        });
        row.appendChild(button);
        addText(row, mount?.displayName() ?? '', 3, rowHeight - 1.5, {
            class: 'name', size: fontSize, maxWidth: Math.max(25, width - (mekLayout ? 116 : 60)),
        });
        const location = mount
            ? formatEquipmentLocationCodes(
                mount.getOccupiedLocations().map(value => entity.componentLocationLabel(value)),
                '/',
                '',
            )
            : '';
        addText(row, location, width - (mekLayout ? 65 : 7), rowHeight - 1.5, {
            class: 'location', size: Math.max(3.4, fontSize - 0.5), maxWidth: 48, anchor: 'end',
        });
        if (mekLayout) {
            addText(row, '', width - 60, rowHeight - 1.5, {
                class: 'mekbay-inventory-summary',
                size: Math.max(3.2, fontSize - 0.8),
                maxWidth: 55,
            });
        }
        group.appendChild(row);
    }
}

export function drawGenericCrewPanel(svg: SVGSVGElement, entity: BaseEntity, box: Box): void {
    const group = addFrame(svg, 'CREW', box, {
        cornerAngleDegrees: { topRight: 0, bottomLeft: 0, bottomRight: 45 },
    });
    const count = Math.max(1, entity.crewSlotCount());
    const rowHeight = Math.max(25, Math.min(43, (box.height - 22) / count));
    for (let occurrence = 0; occurrence < count; occurrence++) {
        const y = 27 + occurrence * rowHeight;
        const name = addText(group, '', 9, y, { size: 7.2, weight: 700, maxWidth: box.width - 18 });
        name.id = `crewName${occurrence}`;
        const nameButton = transparentRect(6, y - 10, box.width - 12, 13, 'crewNameButton');
        nameButton.setAttribute('crewId', String(occurrence));
        nameButton.setAttribute('textElement', name.id);
        group.appendChild(nameButton);
        addText(group, 'GUNNERY', 9, y + 11, { size: 5.7, weight: 700 });
        const gunnery = addText(group, '4', 47, y + 11, { size: 7.2, class: 'skillValue' });
        gunnery.id = `gunnerySkill${occurrence}`;
        const gunButton = transparentRect(39, y + 2, 17, 13, 'crewSkillButton');
        gunButton.setAttribute('crewId', String(occurrence));
        gunButton.setAttribute('skill', 'gunnery');
        group.appendChild(gunButton);
        addText(group, 'PILOTING', 60, y + 11, { size: 5.7, weight: 700 });
        const piloting = addText(group, '5', 96, y + 11, { size: 7.2, class: 'skillValue' });
        piloting.id = `pilotingSkill${occurrence}`;
        const pilotButton = transparentRect(90, y + 2, 17, 13, 'crewSkillButton');
        pilotButton.setAttribute('crewId', String(occurrence));
        pilotButton.setAttribute('skill', 'piloting');
        group.appendChild(pilotButton);
        const hitStart = Math.max(113, box.width - 50);
        for (let hit = 1; hit <= 6; hit++) {
            const pip = circle(hitStart + (hit - 1) * 7, y + 8, 2.4, 'crewHit pip');
            pip.setAttribute('crewId', String(occurrence));
            pip.setAttribute('hit', String(hit));
            group.appendChild(pip);
        }
        const state = transparentRect(6, y - 11, box.width - 12, rowHeight - 1, 'crewStateButton');
        state.setAttribute('crewId', String(occurrence));
        group.appendChild(state);
        const banner = svgElement('g');
        banner.id = `crewState${occurrence}`;
        banner.setAttribute('class', 'crewStateBanner');
        banner.setAttribute('display', 'none');
        group.appendChild(banner);
    }
}

export function drawCrewHitGrid(
    group: SVGGElement,
    crewId: number,
    options: {
        readonly x: number;
        readonly y: number;
        readonly cellWidth: number;
        readonly cellHeight: number;
        readonly labelX: number;
        readonly labelWidth: number;
        readonly fontScale: number;
    },
): void {
    const { x, y, cellWidth, cellHeight, labelX, labelWidth, fontScale } = options;
    addText(group, 'Hits Taken', labelX + labelWidth, y + cellHeight * 0.72, {
        size: 5.2 * fontScale, weight: 700, anchor: 'end', maxWidth: labelWidth,
    });
    addText(group, 'Consciousness #', labelX + labelWidth, y + cellHeight * 1.72, {
        size: 4.6 * fontScale, weight: 700, anchor: 'end', maxWidth: labelWidth,
    });
    const consciousness = ['3', '5', '7', '10', '11', 'Dead'];
    for (let index = 0; index < 6; index++) {
        const cellX = x + index * cellWidth;
        const hit = svgElement('rect');
        setAttributes(hit, {
            x: cellX, y, width: cellWidth, height: cellHeight,
            class: 'crewHit pip',
        });
        hit.setAttribute('crewId', String(crewId));
        hit.setAttribute('hit', String(index + 1));
        group.appendChild(hit);
        addText(group, String(index + 1), cellX + cellWidth / 2, y + cellHeight * 0.72, {
            size: 4.4 * fontScale, anchor: 'middle', class: 'crew-hit-label',
        }).style.pointerEvents = 'none';
        const lower = svgElement('rect');
        setAttributes(lower, {
            x: cellX, y: y + cellHeight, width: cellWidth, height: cellHeight,
            fill: '#fff', stroke: '#111', 'stroke-width': 0.45,
            class: 'crew-consciousness-cell',
        });
        group.appendChild(lower);
        addText(group, consciousness[index], cellX + cellWidth / 2, y + cellHeight * 1.72, {
            size: (index === 5 ? 3.7 : 4.2) * fontScale,
            anchor: 'middle', maxWidth: cellWidth - 1,
        }).style.pointerEvents = 'none';
    }
}

export function drawDamagePanel(svg: SVGSVGElement, entity: BaseEntity, box: Box): void {
    const group = addFrame(svg, 'ARMOR DIAGRAM', box);
    const locations = entity.damageLocations();
    const columns = locations.length <= 4 ? 2 : locations.length <= 9 ? 3 : 4;
    const rows = Math.max(1, Math.ceil(locations.length / columns));
    const cellWidth = (box.width - 12) / columns;
    const cellHeight = (box.height - 28) / rows;
    locations.forEach((location, index) => {
        const x = 6 + index % columns * cellWidth;
        const y = 23 + Math.floor(index / columns) * cellHeight;
        drawDamageLocation(group, location, x, y, cellWidth - 2, cellHeight - 2);
    });
}

export function drawDamageLocation(
    group: SVGGElement,
    location: EntityDamageLocation,
    x: number,
    y: number,
    width: number,
    height: number,
): void {
    const code = location.sheetCode ?? location.code;
    const border = svgElement('rect');
    setAttributes(border, { x, y, width, height, rx: 2, fill: '#fafafa', stroke: '#bbb', 'stroke-width': 0.55 });
    group.appendChild(border);
    addText(group, code, x + width / 2, y + 8, { size: 5.8, weight: 700, anchor: 'middle', maxWidth: width - 4 });

    if (location.soldierPips) {
        const pipWidth = Math.max(1, width - 8);
        const pips = GenericPipRenderer.createPips(location.internalPoints, pipWidth, Math.max(1, height - 15), {
            pipRadius: 3.3,
            minPipRadius: 1.5,
        });
        if (pips) {
            pips.setAttribute('transform', `translate(${x + 4} ${y + 12})`);
            decoratePips(pips, 'structure', code);
            group.appendChild(pips);
        }
        return;
    }

    const front = Math.max(0, location.armor.front);
    if (location.combinedPips) {
        const pips = makePips(location.internalPoints + front, width - 8, height - 18, 'armor', code);
        if (pips) {
            pips.setAttribute('transform', `translate(${x + 4} ${y + 14})`);
            group.appendChild(pips);
        }
        const hit = transparentRect(x + 2, y + 10, width - 4, height - 12, 'unitLocation armor');
        hit.setAttribute('loc', code);
        group.appendChild(hit);
        return;
    }

    const internalHeight = Math.max(8, (height - 18) * 0.36);
    const armorHeight = Math.max(8, height - 18 - internalHeight);
    const structure = makePips(location.internalPoints, width - 8, internalHeight - 2, 'structure', code);
    if (structure) {
        structure.setAttribute('transform', `translate(${x + 4} ${y + 14})`);
        group.appendChild(structure);
    }
    const armor = makePips(front, width - 8, armorHeight - 2, 'armor', code);
    if (armor) {
        armor.setAttribute('transform', `translate(${x + 4} ${y + 14 + internalHeight})`);
        group.appendChild(armor);
    }
    if (location.armor.rear > 0) {
        const rear = makePips(location.armor.rear, Math.max(8, width * 0.35), armorHeight - 2, 'armor', code, true);
        if (rear) {
            rear.setAttribute('transform', `translate(${x + width * 0.62} ${y + 14 + internalHeight})`);
            group.appendChild(rear);
        }
    }
    const structureTarget = transparentRect(x + 2, y + 11, width - 4, internalHeight + 3, 'unitLocation structure');
    structureTarget.setAttribute('loc', code);
    group.appendChild(structureTarget);
    const armorTarget = transparentRect(x + 2, y + 13 + internalHeight, width - 4, armorHeight, 'unitLocation armor');
    armorTarget.setAttribute('loc', code);
    group.appendChild(armorTarget);
}

export function paperdollPipOptions(
    pipLayout: BipedPaperdollPipLayout,
    pipRadius: number,
    minPipRadius: number,
) {
    return {
        pipRadius,
        minPipRadius,
        useCanonPipRadius: pipLayout === 'canon',
    };
}

export function constructionMaterialSubtitle(
    value: string | undefined,
    suffix: 'Armor' | 'Structure',
    fallback: string,
): string {
    const materialName = value?.trim();
    if (!materialName) {
        return fallback;
    }

    // MegaMekLab's templates spell out the standard construction types, while
    // every specialist material is printed using its catalog name verbatim.
    return materialName === 'Standard' ? `${materialName} ${suffix}` : materialName;
}

interface DiagramHeadingOptions {
    readonly titleWidth?: number;
    readonly titleX?: number;
    readonly titleY?: number;
    readonly titleTextLength?: number;
    readonly ribbonWidth?: number;
    readonly ribbonX?: number;
    readonly ribbonY?: number;
    readonly ribbonCut?: number;
    readonly subtitleX?: number;
    readonly subtitleY?: number;
    readonly subtitleFontSize?: number;
    readonly subtitleId?: string;
    readonly subtitleHorizontalScale?: number;
}

export function addDiagramHeading(
    group: SVGGElement,
    title: string,
    subtitle: string,
    width: number,
    y: number,
    options: DiagramHeadingOptions = {},
): void {
    const titleWidth = options.titleWidth ?? Math.min(84, width * 0.49);
    const titleFrame = SvgFrameUtil.createSVGFrameHeader(title, titleWidth, {
        headerWidth: titleWidth,
        // The utility adds 2.5pt top/bottom padding; 6.25 yields MML's 11.25pt tab.
        headerHeight: 6.25,
        headerFontSize: 8.6,
        cornerAngleDegrees: 56.31,
    });
    titleFrame.setAttribute(
        'transform',
        `translate(${formatNumber(options.titleX ?? (width - titleWidth) / 2)} ${formatNumber(options.titleY ?? y)})`,
    );
    const titleText = titleFrame.querySelector('text');
    if (titleText && options.titleTextLength !== undefined) {
        titleText.setAttribute('textLength', formatNumber(options.titleTextLength));
        titleText.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
    group.appendChild(titleFrame);

    const ribbonWidth = options.ribbonWidth ?? Math.min(124, width * 0.72);
    const ribbonX = options.ribbonX ?? (width - ribbonWidth) / 2;
    const ribbonY = options.ribbonY ?? y;
    const ribbonCut = options.ribbonCut ?? 5.625;
    const ribbon = svgElement('polygon');
    ribbon.setAttribute(
        'points',
        `${formatNumber(ribbonX)},${formatNumber(ribbonY + 13)} `
        + `${formatNumber(ribbonX + ribbonWidth - ribbonCut)},${formatNumber(ribbonY + 13)} `
        + `${formatNumber(ribbonX + ribbonWidth)},${formatNumber(ribbonY + 18.625)} `
        + `${formatNumber(ribbonX + ribbonWidth - ribbonCut)},${formatNumber(ribbonY + 24.25)} `
        + `${formatNumber(ribbonX)},${formatNumber(ribbonY + 24.25)} `
        + `${formatNumber(ribbonX - ribbonCut)},${formatNumber(ribbonY + 18.625)}`,
    );
    ribbon.setAttribute('fill', '#c7c7c7');
    group.appendChild(ribbon);
    const subtitleText = addText(group, subtitle, options.subtitleX ?? width / 2, options.subtitleY ?? y + 21.5, {
        size: options.subtitleFontSize ?? 8.6,
        weight: 700,
        anchor: 'middle',
        maxWidth: ribbonWidth - 10,
    });
    if (options.subtitleHorizontalScale !== undefined) {
        const anchorX = options.subtitleX ?? width / 2;
        subtitleText.setAttribute(
            'transform',
            `translate(${formatNumber(anchorX)} 0) scale(${formatNumber(options.subtitleHorizontalScale)} 1) translate(${formatNumber(-anchorX)} 0)`,
        );
    }
    if (options.subtitleId) subtitleText.id = options.subtitleId;
}

export function formatWholeNumber(value: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
}

export function drawDamagePanelIntoGroup(group: SVGGElement, entity: BaseEntity, width: number, height: number): void {
    const locations = entity.damageLocations();
    const columns = 3;
    const rows = Math.ceil(locations.length / columns);
    const cellWidth = (width - 12) / columns;
    const cellHeight = (height - 28) / Math.max(1, rows);
    locations.forEach((location, index) => drawDamageLocation(
        group,
        location,
        6 + index % columns * cellWidth,
        23 + Math.floor(index / columns) * cellHeight,
        cellWidth - 2,
        cellHeight - 2,
    ));
}

export function decoratePaperdollPips(layer: SVGGElement, forceRear = false): void {
    layer.querySelectorAll<SVGGElement>('[data-pip-type][data-pip-location]').forEach(pipGroup => {
        const typeValue = pipGroup.dataset['pipType'] ?? 'armor';
        const rawLocation = pipGroup.dataset['pipLocation'] ?? '';
        const rear = forceRear || rawLocation.endsWith('_R');
        const location = rawLocation.replace(/_R$/u, '');
        decoratePips(pipGroup, typeValue === 'structure' ? 'structure' : 'armor', location, rear);
    });
}

export function drawCriticalPanel(svg: SVGSVGElement, entity: BaseEntity, box: Box, title = 'CRITICAL HITS'): void {
    const group = addFrame(svg, title, box);
    const criticals = [...buildNonMekRuntimeIndex(entity).damageTracks.values()];
    const visible = criticals.slice(0, Math.max(1, Math.floor((box.height - 25) / 11)));
    visible.forEach((critical, index) => {
        const y = 29 + index * 11;
        const control = svgElement('g');
        control.id = critical.sheetId;
        control.setAttribute('class', 'critLoc');
        control.setAttribute('critId', critical.sheetId);
        control.setAttribute('transform', `translate(7 ${y - 8})`);
        const background = svgElement('rect');
        setAttributes(background, { x: 0, y: 0, width: box.width - 14, height: 10, fill: index % 2 ? '#fff' : '#f3f3f3' });
        control.appendChild(background);
        addText(control, critical.label, 3, 7.2, { size: 5.9, maxWidth: box.width - 47 });
        if (critical.visibleHitPips !== undefined) {
            const pips = svgElement('g');
            pips.id = `${critical.sheetId}_pips`;
            for (let pipIndex = 0; pipIndex < critical.visibleHitPips; pipIndex++) {
                pips.appendChild(circle(box.width - 50 + pipIndex * 4.2, 5, 1.45, 'motiveHitPip pip hidden'));
            }
            control.appendChild(pips);
        } else {
            control.appendChild(circle(box.width - 22, 5, 2.4, 'criticalPip pip'));
        }
        if (critical.sheetId === 'rotor') {
            const counter = addText(control, '0', box.width - 30, 7, { size: 6, anchor: 'end' });
            counter.id = 'rotor_hits_counter';
        }
        group.appendChild(control);
    });
}

export function drawHeatScale(svg: SVGSVGElement, box: Box): void {
    const group = svgElement('g');
    group.id = 'heatScale';
    group.setAttribute('transform', `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`);
    const sx = box.width / 19.454;
    const sy = box.height / 366;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const heatTitle = addText(group, 'Heat', x(8.396), y(8), {
        size: font(6.76), weight: 700, anchor: 'middle',
    });
    heatTitle.setAttribute('textLength', formatNumber(x(14.126)));
    heatTitle.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    const scaleTitle = addText(group, 'Scale', x(8.396), y(16), {
        size: font(6.76), weight: 700, anchor: 'middle',
    });
    scaleTitle.setAttribute('textLength', formatNumber(x(15.791)));
    scaleTitle.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    const overflow = svgElement('path');
    overflow.setAttribute('d', [
        `m ${formatNumber(x(-1.938))} ${formatNumber(y(26.85))}`,
        `c 0 ${formatNumber(y(-2.4))} ${formatNumber(x(1.95))} ${formatNumber(y(-4.35))} ${formatNumber(x(4.35))} ${formatNumber(y(-4.35))}`,
        `h ${formatNumber(x(11.967))}`,
        `c ${formatNumber(x(2.4))} 0 ${formatNumber(x(4.35))} ${formatNumber(y(1.95))} ${formatNumber(x(4.35))} ${formatNumber(y(4.35))}`,
        `v ${formatNumber(y(11.967))}`,
        `c 0 ${formatNumber(y(2.4))} ${formatNumber(x(-1.95))} ${formatNumber(y(4.35))} ${formatNumber(x(-4.35))} ${formatNumber(y(4.35))}`,
        `H ${formatNumber(x(2.412))}`,
        `c ${formatNumber(x(-2.4))} 0 ${formatNumber(x(-4.35))} ${formatNumber(y(-1.95))} ${formatNumber(x(-4.35))} ${formatNumber(y(-4.35))} z`,
    ].join(' '));
    setAttributes(overflow, {
        fill: '#fff', stroke: '#000', 'stroke-width': 1.45 * fontScale,
        'stroke-linejoin': 'round', class: 'overflowFrame',
    });
    const overflowButton = transparentRect(
        x(-1.938),
        y(22.5),
        x(21.117),
        y(20.317),
        'overflowButton screen-only no-autocolor',
    );
    group.appendChild(overflowButton);
    group.appendChild(overflow);
    const overflowText = addText(group, 'Overflow', x(8.396), y(28.5), {
        size: font(4.7), anchor: 'middle', class: 'overflowText',
    });
    overflowText.setAttribute('textLength', formatNumber(x(15.5)));
    overflowText.setAttribute('lengthAdjust', 'spacingAndGlyphs');

    const cellTop = 47.667;
    const cellHeight = 10.3333333333;
    const effectLevels = new Set([30, 28, 26, 25, 24, 23, 22, 20, 19, 18, 17, 15, 14, 13, 10, 8, 5]);
    for (let index = 0; index <= 30; index++) {
        const heat = 30 - index;
        const cellY = cellTop + index * cellHeight;
        const heatLevel = heatLevels.find(level => heat >= level.min && heat <= level.max);
        const rect = svgElement('rect');
        rect.setAttribute('class', ['heat', heatLevel?.class, heatLevel ? 'no-autocolor' : undefined]
            .filter((value): value is string => value !== undefined)
            .join(' '));
        rect.setAttribute('heat', String(heat));
        setAttributes(rect, {
            x: 0, y: y(cellY), width: x(16.792), height: y(cellHeight),
            fill: '#fff', stroke: '#000', 'stroke-width': 1.45 * fontScale,
        });
        group.appendChild(rect);
        addText(group, String(heat), x(8.396), y(cellY + 7.401), {
            size: font(6.76), weight: 700, anchor: 'middle',
        });
        if (effectLevels.has(heat)) {
            const marker = svgElement('polygon');
            const cy = y(cellY + 5.035);
            marker.setAttribute('points', `${x(16.792)},${cy - y(3.617)} ${x(12.659)},${cy} ${x(16.792)},${cy + y(3.616)}`);
            marker.setAttribute('class', 'heat-effect-marker');
            marker.setAttribute('pointer-events', 'none');
            group.appendChild(marker);
        }
    }
    svg.appendChild(group);
}

export function drawClusterHitsReference(
    svg: SVGSVGElement,
    box: Box,
    rackColumns: readonly number[],
    presentation: 'auto' | 'full-width' = 'auto',
): void {
    const profile = clusterHitsReferenceProfile(box, rackColumns.length, presentation);
    const group = svgElement('g');
    group.setAttribute('class', 'referenceTable');
    group.setAttribute(
        'transform',
        `translate(${formatNumber(box.x)} ${formatNumber(box.y)}) `
        + `scale(${formatNumber(box.width / profile.width)} ${formatNumber(box.height / profile.height)})`,
    );
    group.setAttribute('data-mekbay-reference', 'cluster-hits');
    const shadow = svgElement('path');
    setAttributes(shadow, {
        d: clusterHitsFramePath(profile.width, profile.height, true),
        fill: '#c7c7c7',
        stroke: '#c7c7c7',
        'stroke-width': 1.6,
    });
    group.appendChild(shadow);
    const outline = svgElement('path');
    setAttributes(outline, {
        d: clusterHitsFramePath(profile.width, profile.height, false),
        fill: '#fff',
        stroke: '#000',
        'stroke-width': 1.6,
    });
    group.appendChild(outline);

    const header = svgElement('g');
    header.setAttribute('transform', 'translate(2.5 3)');
    const ribbon = svgElement('path');
    ribbon.setAttribute(
        'd',
        `M 0 5.625 l 3.749 -5.625 h ${formatNumber(profile.width - 14.95)} `
        + 'l 3.749 5.625 l -3.749 5.625 h '
        + `${formatNumber(-(profile.width - 14.95))} Z`,
    );
    header.appendChild(ribbon);
    addText(header, 'CLUSTER HITS TABLE', (profile.width - 7.452) / 2, 8.438, {
        size: 6.76,
        weight: 700,
        anchor: 'middle',
        fill: '#fff',
    });
    group.appendChild(header);

    const table = svgElement('g');
    table.setAttribute('transform', 'translate(3 22.5)');
    const safeRackCount = Math.max(1, rackColumns.length);
    const columnWidth = (profile.width - profile.rollColumnX * 2 - 6) / safeRackCount;
    addText(table, '2D6', profile.rollColumnX, 0, {
        size: profile.fontSize,
        weight: 700,
        anchor: 'middle',
    });
    rackColumns.forEach((rack, index) => addText(
        table,
        String(rack),
        profile.rollColumnX + (index + 1) * columnWidth,
        0,
        {
            size: profile.fontSize,
            weight: 700,
            anchor: 'middle',
            maxWidth: columnWidth - 1,
        },
    ));
    for (let roll = 2; roll <= 12; roll++) {
        const rowIndex = roll - 2;
        const baseline = (rowIndex + 1) * profile.rowHeight;
        if (rowIndex % 2 === 0) {
            const shade = svgElement('rect');
            setAttributes(shade, {
                x: 1,
                y: profile.firstShadeY + rowIndex * profile.rowHeight,
                width: profile.width - 11,
                height: profile.rowHeight,
                fill: '#bbb',
                class: 'tableshading',
            });
            table.appendChild(shade);
        }
        addText(table, String(roll), profile.rollColumnX, baseline, {
            size: profile.fontSize,
            anchor: 'middle',
        });
        rackColumns.forEach((rack, index) => {
            const result = addText(table, String(clusterHits(roll, rack)),
                profile.rollColumnX + (index + 1) * columnWidth, baseline, {
                size: profile.fontSize, anchor: 'middle', maxWidth: columnWidth - 1,
                });
            result.setAttribute('data-cluster-rack', String(rack));
            result.setAttribute('data-cluster-roll', String(roll));
        });
    }
    group.appendChild(table);
    svg.appendChild(group);
}

interface ClusterHitsReferenceProfile {
    readonly width: number;
    readonly height: number;
    readonly rollColumnX: number;
    readonly rowHeight: number;
    readonly firstShadeY: number;
    readonly fontSize: number;
}

/** MML uses three responsive geometries for its cluster table. Keeping the
 * canonical coordinates here makes the component reusable without carrying
 * over the template SVG's authoring structure. */
function clusterHitsReferenceProfile(
    box: Box,
    rackCount: number,
    presentation: 'auto' | 'full-width',
): ClusterHitsReferenceProfile {
    if (presentation === 'full-width') {
        return {
            width: 576.15,
            height: 113.7,
            rollColumnX: 157.19,
            rowHeight: 7.193,
            firstShadeY: 1.796,
            fontSize: 5.4,
        };
    }
    if (rackCount >= 15) {
        return {
            width: 576.149,
            height: 148.504,
            rollColumnX: 37.671,
            rowHeight: 9.679,
            firstShadeY: 2.906,
            fontSize: 5.8,
        };
    }
    if (box.width > 250) {
        return {
            width: 382.1,
            height: 110.7,
            rollColumnX: 39.961,
            rowHeight: 6.979,
            firstShadeY: 1.856,
            fontSize: 4.9,
        };
    }
    return {
        width: 154.6,
        height: 96.048,
        rollColumnX: 40.865,
        rowHeight: 5.932,
        firstShadeY: 1.333,
        fontSize: 4.9,
    };
}

function clusterHitsFramePath(width: number, height: number, shadow: boolean): string {
    const x = shadow ? 2 : 0;
    const top = shadow ? 10.214 : 8.214;
    const horizontal = width - (shadow ? 12.95 : 13.95);
    const vertical = height - (shadow ? 18.428 : 19.428);
    return `M ${formatNumber(x)} ${formatNumber(top)} l 5.475 -8.214 `
        + `h ${formatNumber(horizontal)} l 5.475 8.214 v ${formatNumber(vertical)} `
        + `l -5.475 8.214 h ${formatNumber(-horizontal)} l -5.475 -8.214 Z`;
}

export function drawCompactReferenceTable(
    svg: SVGSVGElement,
    title: string,
    box: Box,
    headings: readonly string[],
    rows: readonly (readonly string[])[],
    note?: string,
): void {
    const group = addFrame(svg, title, box, {
        fullWidthHeader: true,
        headerFontSize: Math.max(6.3, Math.min(10.6, box.width / Math.max(18, title.length * 0.78))),
        cornerAngleDegrees: { topLeft: 45, topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    const left = 6;
    const width = box.width - left * 2;
    const columnWidth = width / headings.length;
    headings.forEach((heading, index) => addText(group, heading, left + (index + 0.5) * columnWidth, 25, {
        size: Math.max(4.2, Math.min(5.8, columnWidth / Math.max(5, heading.length * 0.5))),
        weight: 700,
        anchor: 'middle',
        maxWidth: columnWidth - 3,
    }));
    const noteHeight = note ? Math.min(34, box.height * 0.23) : 7;
    const tableHeight = Math.max(10, box.height - 32 - noteHeight);
    const rowHeight = tableHeight / Math.max(1, rows.length);
    rows.forEach((row, rowIndex) => {
        const top = 29 + rowIndex * rowHeight;
        if (rowIndex % 2 === 0) {
            const shade = svgElement('rect');
            setAttributes(shade, { x: left, y: top, width, height: rowHeight, fill: '#c7c7c7' });
            group.appendChild(shade);
        }
        row.forEach((value, columnIndex) => addText(group, value, left + (columnIndex + 0.5) * columnWidth,
            top + rowHeight * 0.72, {
                size: Math.max(3.4, Math.min(5.4, rowHeight - 1)), anchor: 'middle', maxWidth: columnWidth - 3,
            }));
    });
    if (note) addText(group, note, left, box.height - noteHeight + 7, {
        size: Math.max(3.8, Math.min(5.1, box.width / 75)), maxWidth: width,
    });
}

export function drawGeneratedFooter(
    svg: SVGSVGElement,
    page: RecordSheetPageProfile,
    placement?: {
        readonly catalystX: number;
        readonly catalystY: number;
        readonly catalystScale?: number;
        readonly footerCenterX?: number;
    },
): void {
    const scale = page.horizontalScale;
    if (placement !== undefined) {
        const mark = svgElement('g');
        mark.setAttribute('class', 'record-sheet-catalyst-mark');
        mark.id = 'cglLogoBW';
        const point = scalePageBox(page, {
            x: placement.catalystX,
            y: placement.catalystY,
            width: 0,
            height: 0,
        });
        const markScale = (placement.catalystScale ?? 1) * scale;
        mark.setAttribute(
            'transform',
            `translate(${formatNumber(point.x)} ${formatNumber(point.y)}) scale(${formatNumber(markScale)})`,
        );
        const logo = createCatalystGameLabsLogo();
        logo.removeAttribute('id');
        mark.appendChild(logo);
        svg.appendChild(mark);
    }
    const footerCenterX = placement?.footerCenterX === undefined
        ? page.width / 2
        : scalePageBox(page, {
            x: placement.footerCenterX,
            y: 18,
            width: 0,
            height: 0,
        }).x;
    const footer = svgElement('text');
    footer.id = 'footer';
    setAttributes(footer, {
        'font-size': 5.7 * scale,
        transform: `translate(${formatNumber(footerCenterX)} ${formatNumber(page.height - page.margin)})`,
        'text-anchor': 'middle',
        'font-family': 'Roboto',
        'font-weight': 700,
    });
    const lines: readonly [string, number, number][] = [
        ["© 2026 The Topps Company, Inc. Classic BattleTech, BattleTech, 'Mech and BattleMech are trademarks of The Topps Company, Inc. All rights reserved.", -7 * page.verticalScale, 547.2 * scale],
        ['Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of InMediaRes Production, LLC. Permission to photocopy for personal use.', 0, 518.4 * scale],
    ];
    lines.forEach(([value, y, textLength]) => {
        const line = svgElement('tspan');
        line.textContent = value;
        setAttributes(line, {
            x: 0,
            y,
            textLength,
            lengthAdjust: 'spacingAndGlyphs',
        });
        footer.appendChild(line);
    });
    svg.appendChild(footer);
}

export function drawReferencePanel(svg: SVGSVGElement, box: Box, title = 'REFERENCE TABLES'): void {
    const group = addFrame(svg, title, box, { fullWidthHeader: true });
    group.setAttribute('class', 'referenceTable');
    group.setAttribute('data-mekbay-region', 'center-panel');
    const rows: readonly (readonly [string, string])[] = title.includes('HIT LOCATION')
        ? [
            ['2D6', 'LEFT · FRONT · RIGHT · REAR'],
            ['2', 'LT · CT · RT · CT (critical)'],
            ['3', 'LL · RA · RL · LA'],
            ['4', 'LA · RA · RA · LA'],
            ['5', 'LA · RL · RA · LL'],
            ['6', 'LL · RT · RL · LT'],
            ['7', 'LT · CT · RT · CT'],
            ['8', 'CT · LT · CT · RT'],
            ['9', 'RT · LL · LT · RL'],
            ['10', 'RA · LA · LA · RA'],
            ['11', 'RL · LA · LL · RA'],
            ['12', 'HD · HD · HD · HD'],
        ]
        : title.includes('PUNCH/KICK')
            ? [
                ['D6', 'PUNCH L/R · KICK L/R'],
                ['1', 'LA / RA · LL / RL'],
                ['2', 'LT / RT · LL / RL'],
                ['3', 'CT / CT · LL / RL'],
                ['4', 'LT / RT · LL / RL'],
                ['5', 'RA / LA · LL / RL'],
                ['6', 'HD / HD · LL / RL'],
            ]
            : [
                ['MODIFIER', 'EFFECT'],
                ['Light woods', '+1'],
                ['Heavy woods', '+2'],
                ['Partial cover', '+1'],
                ['Minimum range', '+1/hex'],
                ['Attacker moved', 'varies'],
                ['Target moved', 'varies'],
            ];
    const rowStep = Math.min(17, (box.height - 27) / rows.length);
    const fontSize = Math.max(3.8, Math.min(5.8, rowStep - 1.4));
    rows.forEach(([label, value], index) => {
        const y = 25 + index * rowStep;
        addText(group, label, 8, y, {
            size: index === 0 ? Math.max(4.2, fontSize) : fontSize,
            weight: index === 0 ? 700 : 400,
            maxWidth: Math.max(18, box.width * 0.22),
        });
        addText(group, value, box.width - 8, y, {
            size: fontSize,
            weight: index === 0 ? 700 : 400,
            anchor: 'end',
            maxWidth: box.width * 0.73,
        });
        if (index > 0) addLine(group, 7, y + 3, box.width - 7, y + 3, '#ddd', 0.4);
    });
}

export function drawNotesPanel(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'NOTES', box);
    for (let y = 35; y < box.height - 8; y += 17) addLine(group, 9, y, box.width - 9, y, '#bbb', 0.45);
}

interface RecordSheetHeaderProfile {
    readonly width: number;
    readonly textLength: number;
}

const RECORD_SHEET_HEADER_PROFILES: Readonly<Record<string, RecordSheetHeaderProfile>> = Object.freeze({
    "'MECH DATA": Object.freeze({ width: 75.854, textLength: 59.869 }),
    'WARRIOR DATA': Object.freeze({ width: 93.635, textLength: 76.034 }),
    'CRITICAL TABLE': Object.freeze({ width: 93.055, textLength: 75.506 }),
    'HEAT DATA': Object.freeze({ width: 69.498, textLength: 54.091 }),
});

export function addFrame(
    svg: SVGSVGElement,
    title: string,
    box: Box,
    options: Parameters<typeof SvgFrameUtil.createSVGFrame>[3] = {},
): SVGGElement {
    const defaults = Object.keys(options).length > 0
        ? options
        : { cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 } };
    const headerProfile = RECORD_SHEET_HEADER_PROFILES[title];
    const resolvedOptions = headerProfile
        ? {
            ...defaults,
            headerWidth: headerProfile.width,
            headerHeight: 10,
            headerFontSize: 10.6,
            headerAngleDegrees: 56.31,
        }
        : defaults;
    const frame = SvgFrameUtil.createSVGFrame(title, box.width, box.height, resolvedOptions);
    frame.setAttribute('data-mekbay-frame-width', formatNumber(box.width));
    frame.setAttribute('data-mekbay-frame-height', formatNumber(box.height));
    if (headerProfile) {
        const header = Array.from(frame.children)
            .find((child): child is SVGGElement => child.tagName.toLowerCase() === 'g');
        const headerText = header?.querySelector('text');
        if (header) header.setAttribute('transform', 'translate(2.5 3)');
        if (headerText) {
            headerText.setAttribute('x', formatNumber(headerProfile.width / 2));
            headerText.setAttribute('y', '11.25');
            headerText.setAttribute('textLength', formatNumber(headerProfile.textLength));
            headerText.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
    }
    frame.setAttribute('transform', `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`);
    svg.appendChild(frame);
    return frame;
}

export function makePips(
    count: number,
    width: number,
    height: number,
    type: 'armor' | 'structure',
    location: string,
    rear = false,
): SVGGElement | null {
    const pips = GenericPipRenderer.createPips(count, width, height, {
        pipRadius: 2.8,
        minPipRadius: 0.85,
        pipGap: 0.3,
    }, type, location);
    if (pips) decoratePips(pips, type, location, rear);
    return pips;
}

export function makeDistributedPips(
    count: number,
    width: number,
    height: number,
    type: 'armor' | 'structure',
    location: string,
    rear = false,
): SVGGElement | null {
    const profile = PipShapeProfile.rectangle(0, 0, width, height);
    if (!profile) return null;
    const pips = DistributedPipRenderer.createPips(profile, count, {
        pipRadius: 2.45,
        minPipRadius: 0.72,
        pipGap: 0.25,
        inset: 0.4,
    }, type, location);
    if (pips) decoratePips(pips, type, location, rear);
    return pips;
}

function decoratePips(
    group: SVGGElement,
    type: 'armor' | 'structure',
    location: string,
    rear = false,
): void {
    group.querySelectorAll<SVGElement>('circle, polygon, rect:not([data-pip-shadow])').forEach(pip => {
        pip.classList.add('pip', type);
        pip.setAttribute('loc', location);
        if (rear) pip.setAttribute('rear', '');
    });
}

export function addText(
    parent: SVGElement,
    value: string,
    x: number,
    y: number,
    options: {
        readonly size?: number;
        readonly weight?: number;
        readonly fill?: string;
        readonly anchor?: 'start' | 'middle' | 'end';
        readonly class?: string;
        readonly maxWidth?: number;
    } = {},
): SVGTextElement {
    const text = svgElement('text');
    setAttributes(text, {
        x,
        y,
        'font-size': options.size ?? 7,
        fill: options.fill && options.fill !== '#111' ? options.fill : undefined,
        'font-weight': options.weight && options.weight !== 400 ? options.weight : undefined,
        'text-anchor': options.anchor && options.anchor !== 'start' ? options.anchor : undefined,
        class: options.class,
    });
    text.textContent = value;
    if (options.maxWidth && value.length * (options.size ?? 7) * 0.54 > options.maxWidth) {
        text.setAttribute('textLength', formatNumber(options.maxWidth));
        text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
    parent.appendChild(text);
    return text;
}

export function addWrappedText(
    parent: SVGElement,
    value: string,
    x: number,
    y: number,
    maxWidth: number,
    options: {
        readonly size: number;
        readonly lineHeight: number;
        readonly maxLines: number;
        readonly italic?: boolean;
    },
): void {
    // Roboto's record-sheet prose averages notably narrower than the inventory
    // numerals; this keeps MML's quirk line breaks without measuring the DOM.
    const maxCharacters = Math.max(1, Math.floor(maxWidth / (options.size * 0.43)));
    const lines: string[] = [];
    for (const word of value.split(/\s+/u)) {
        const current = lines.at(-1);
        if (current === undefined || (current.length + 1 + word.length > maxCharacters
            && lines.length < options.maxLines)) {
            lines.push(word);
        } else {
            lines[lines.length - 1] = `${current} ${word}`;
        }
    }
    lines.slice(0, options.maxLines).forEach((line, index) => {
        const text = addText(parent, line, x, y + index * options.lineHeight, {
            size: options.size,
            maxWidth,
        });
        if (options.italic) text.setAttribute('font-style', 'italic');
    });
}

export function addLine(parent: SVGElement, x1: number, y1: number, x2: number, y2: number, stroke: string, width: number): SVGLineElement {
    const line = svgElement('line');
    setAttributes(line, { x1, y1, x2, y2, stroke, 'stroke-width': width });
    parent.appendChild(line);
    return line;
}

export function circle(cx: number, cy: number, radius: number, className: string): SVGCircleElement {
    const element = svgElement('circle');
    setAttributes(element, { cx, cy, r: radius, class: className });
    return element;
}

export function transparentRect(x: number, y: number, width: number, height: number, className: string): SVGRectElement {
    const rect = svgElement('rect');
    setAttributes(rect, { x, y, width, height, class: className, fill: 'transparent', 'pointer-events': 'all' });
    return rect;
}

export function setInventoryComponentIds(row: SVGGElement, componentIds: readonly string[]): void {
    if (componentIds.length > 0) {
        row.setAttribute('data-mekbay-component-ids', componentIds.join(' '));
    }
}

function innerBox(box: Box, horizontal: number, top: number): Box {
    return {
        x: box.x + horizontal,
        y: box.y + top,
        width: Math.max(0, box.width - horizontal * 2),
        height: Math.max(0, box.height - top - 5),
    };
}

/** Maps a canonical Letter-space panel into the selected physical page. */
export function scalePageBox(page: RecordSheetPageProfile, box: Box): Box {
    return {
        x: page.margin + (box.x - 18) * page.horizontalScale,
        y: page.margin + (box.y - 18) * page.verticalScale,
        width: box.width * page.horizontalScale,
        height: box.height * page.verticalScale,
    };
}

/** Maps a compact reference layout into the block's actual generated bounds. */
export function scaleCompactBox(svg: SVGSVGElement, box: Box, referenceHeight: number): Box {
    const viewBox = readViewBox(svg);
    const horizontalScale = viewBox.width / RECORD_SHEET_CONTENT_WIDTH;
    const verticalScale = viewBox.height / referenceHeight;
    return {
        x: box.x * horizontalScale,
        y: box.y * verticalScale,
        width: box.width * horizontalScale,
        height: box.height * verticalScale,
    };
}

export function readViewBox(svg: SVGSVGElement): { x: number; y: number; width: number; height: number } {
    const values = (svg.getAttribute('viewBox') ?? '').trim().split(/\s+/u).map(Number);
    if (values.length === 4 && values.every(Number.isFinite)) {
        return { x: values[0], y: values[1], width: values[2], height: values[3] };
    }
    return {
        x: 0,
        y: 0,
        width: Number(svg.getAttribute('width')) || RECORD_SHEET_CONTENT_WIDTH,
        height: Number(svg.getAttribute('height')) || RECORD_SHEET_CONTENT_HEIGHT,
    };
}

export function appendSheetContent(
    target: SVGElement,
    source: SVGSVGElement,
    options: {
        readonly omitVehicleChrome?: boolean;
        readonly definitionsTarget?: SVGSVGElement;
    } = {},
): void {
    for (const child of Array.from(source.childNodes)) {
        if (child instanceof Element && child.tagName.toLowerCase() === 'style') continue;
        if (child instanceof SVGElement && child.classList.contains('record-sheet-background')) continue;
        if (child instanceof Element
            && child.tagName.toLowerCase() === 'defs'
            && options.definitionsTarget !== undefined) {
            mergeSheetDefinitions(options.definitionsTarget, child);
            continue;
        }
        if (options.omitVehicleChrome
            && child instanceof SVGElement
            && child.classList.contains('compact-vehicle-unit-chrome')) continue;
        target.appendChild(document.importNode(child, true));
    }
}

function mergeSheetDefinitions(target: SVGSVGElement, source: Element): void {
    let defs = Array.from(target.children)
        .find((child): child is SVGDefsElement => child.tagName.toLowerCase() === 'defs');
    if (!defs) {
        defs = svgElement('defs');
        target.insertBefore(defs, target.firstChild);
    }
    for (const definition of Array.from(source.children)) {
        if (definition.id && target.getElementById(definition.id)) continue;
        defs.appendChild(document.importNode(definition, true));
    }
}

export function formatTechBase(value: EntityTechBase, mixedTech = false): string {
    if (mixedTech) return 'Mixed';
    return value === 'IS' ? 'Inner Sphere' : value;
}

export function formatNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

export function formatGeometryNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 1_000_000) / 1_000_000);
}

export function setAttributes(element: Element, attributes: Readonly<Record<string, string | number | undefined>>): void {
    Object.entries(attributes).forEach(([name, value]) => {
        if (value !== undefined) element.setAttribute(name, String(value));
    });
}

export function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
    return document.createElementNS(SVG_NS, name);
}

export function optimizeGeneratedSvg(svg: SVGSVGElement): SVGSVGElement {
    svg.querySelectorAll<SVGElement>('.pip').forEach(pip => {
        pip.removeAttribute('fill');
        pip.removeAttribute('stroke');
        pip.removeAttribute('stroke-width');
    });
    svg.querySelectorAll<SVGElement>('[data-pip-type], [data-pip-location], [data-pip-value], [data-pip-layout]')
        .forEach(group => {
            group.removeAttribute('data-pip-type');
            group.removeAttribute('data-pip-location');
            group.removeAttribute('data-pip-value');
            group.removeAttribute('data-pip-layout');
        });
    // This is an authoring hook on each imported paperdoll root. A sheet may
    // contain several paperdolls, so retaining it would create duplicate IDs.
    svg.querySelectorAll<SVGElement>('[id^="paperdoll-art-"]')
        .forEach(element => element.removeAttribute('id'));
    svg.querySelectorAll<SVGPathElement>('path').forEach(path => {
        if (/^(?:path|polygon)/u.test(path.id)) path.removeAttribute('id');
        normalizePaperdollPathStyle(path);
    });
    return svg;
}

function normalizePaperdollPathStyle(path: SVGPathElement): void {
    const style = path.getAttribute('style');
    if (!style || style.includes('transform-')) return;
    const declarations = style.split(';').map(value => value.trim()).filter(Boolean);
    const supported = new Set(['fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linejoin']);
    const entries = declarations.map(declaration => {
        const separator = declaration.indexOf(':');
        return separator < 0
            ? ['', ''] as const
            : [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()] as const;
    });
    if (entries.some(([name]) => !supported.has(name))) return;
    path.removeAttribute('style');
    entries.forEach(([name, rawValue]) => {
        if (name === 'fill-rule' && rawValue === 'nonzero') return;
        const value = rawValue
            .replace(/^rgb\(199,\s*199,\s*199\)$/u, '#c7c7c7')
            .replace(/^white$/u, '#fff')
            .replace(/^black$/u, '#000')
            .replace(/px$/u, '');
        path.setAttribute(name, value);
    });
}

const RECORD_SHEET_STYLE = `
text { font-family: Roboto, Arial, sans-serif; }
.pip { fill: #fff; stroke: #000; stroke-width: .5; vector-effect: non-scaling-stroke; }
.systemHitPip { fill: none; stroke: #000; stroke-width: 1.72; }
.structuralIntegrityPip { fill: none; stroke: #000; stroke-width: 1.72; }
.hsPip { fill: #fff; stroke: #000; stroke-width: .9; }
.pip.damaged, .crewHit.damaged, .criticalPip.damaged, .motiveHitPip.damaged { fill: #111; }
.crewHit.damaged + .crewHitLabel { fill: #fff; }
.pip.disabled, .inventoryEntry.disabled { opacity: .38; }
.inventoryEntry > text, .inventoryEntry > g:not(.alternativeMode) text,
.hitMod-rect, .hitMod-text, .targetTn-rect, .targetTn-text { pointer-events: none; }
.inventoryEntryButton { pointer-events: all; }
.hidden { display: none; }
.inventoryEntry.damaged text, .critSlot.damaged text { text-decoration: line-through; }
.interactive, .selectable, .unitLocation, .crewHit, .crewStateButton, .crewNameButton, .crewSkillButton { cursor: pointer; }
.crewStateBanner, .unitConditionBanner { pointer-events: none; }
.read-only .interactive, .read-only .selectable { cursor: default; }
@media print { .screen-only { display: none !important; } .print-show { display: initial !important; } }
`;
