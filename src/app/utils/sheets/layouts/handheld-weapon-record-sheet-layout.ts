// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { formatProtectionCounter } from '../record-sheet-protection-counter';
import { addInventoryText, fitInventoryText, inventoryRowLineCount } from '../inventory-text-layout';
import { RECORD_SHEET_FONT } from '../record-sheet-typography';
import { SvgFrameUtil } from '../svg-frame.util';

import type { BaseEntity } from '../../../models/entity/base-entity';
import { WeaponEquipment } from '../../../models/equipment.model';
import type { NonMekRecordSheetComponent } from '../../../models/runtime/non-mek-record-sheet';
import { recordSheetAmmoName } from '../../record-sheet-ammo.util';
import { clusterTableForEntity } from '../../record-sheet-reference-table';
import { GenericPipRenderer } from '../generic-pip-renderer';
import { appendEmbeddedSvgDefinition } from '../record-sheet-embedded-art';
import {
    type RecordSheetLayoutProfile,
    type RecordSheetPageFormat,
    type RecordSheetPageProfile,
} from '../record-sheet-layout';
import {
    type Box, addText, drawClusterHitsReference, drawGeneratedFooter,
    formatNumber, makeDistributedPips, recordSheetInventoryWeapons, scalePageBox, setAttributes,
    setInventoryComponentIds, svgElement, transparentRect,
} from '../record-sheet-svg-rendering';
import { CompactRecordSheetLayout } from './record-sheet-layout';

const BLOCK_WIDTH = 575.71887;
const STANDARD_HEIGHT = 74.533607;
const LARGE_HEIGHT = 149.06;
const MASTHEAD_ART_ID = 'mekbay-handheld-weapon-masthead-art';

interface HandheldAmmoGroup {
    readonly name: string;
    readonly componentIds: string[];
    count: number;
}

/** Handheld weapons are short inventory/armor/ammo strips, without crew or a paperdoll. */
export class HandheldWeaponRecordSheetLayout extends CompactRecordSheetLayout {
    public constructor() {
        super('handheld-weapon', 'handheld-weapon', 'HANDHELD WEAPONS',
            () => ({ height: STANDARD_HEIGHT, stride: 74.53 }));
    }

    public matches(entity: BaseEntity): boolean {
        return entity.entityType === 'HandheldWeapon';
    }

    public override profile(
        entity: BaseEntity,
        pageFormat: RecordSheetPageFormat = 'letter',
    ): RecordSheetLayoutProfile {
        const profile = super.profile(entity, pageFormat);
        const large = isLargeHandheldLayout(entity);
        const height = (large ? LARGE_HEIGHT : STANDARD_HEIGHT) * Math.min(1, profile.width / BLOCK_WIDTH);
        return Object.freeze({ ...profile, height, stride: height });
    }

    protected override compactMastheadTitleLines(): readonly string[] {
        return ['HANDHELD WEAPONS'];
    }

    protected override drawPrintablePageChrome(page: SVGSVGElement, profile: RecordSheetPageProfile,
        blocks: readonly SVGSVGElement[], entity?: BaseEntity): void {
        super.drawPrintablePageChrome(page, profile, blocks, entity);
        const title = page.querySelector('.record-sheet-unit-title-frame > text');
        title?.setAttribute('x', formatNumber(115.432 * profile.horizontalScale));
        title?.setAttribute('y', formatNumber(26.541 * profile.verticalScale));
    }

    protected override drawCompactMastheadIcon(parent: SVGGElement, box: Box): void {
        const use = svgElement('use');
        setAttributes(use, { href: `#${MASTHEAD_ART_ID}`, class: 'handheld-weapon-masthead-icon',
            width: 56.7 * box.width / 31.018, height: 45.357 * box.height / 41.357 });
        parent.appendChild(use);
    }

    public override drawCompactPageSupplement(
        page: SVGSVGElement,
        profile: RecordSheetPageProfile,
        blocks: readonly SVGSVGElement[],
    ): void {
        const racks = (blocks[0]?.getAttribute('data-mekbay-cluster-racks') ?? '')
            .split(',').map(Number).filter(value => value > 0);
        if (blocks.length === 1 && racks.length > 0) {
            const height = Number(blocks[0].getAttribute('height'));
            drawClusterHitsReference(page, scalePageBox(profile, {
                x: 18.9, y: profile.compactContentY + height + 8,
                width: 576.149, height: 148.504,
            }), racks);
        }
        drawGeneratedFooter(page, profile, {
            catalystX: profile.margin,
            catalystY: profile.height - profile.margin - 20,
            catalystScale: 0.9,
            footerCenterX: (profile.margin + 60 + profile.width - profile.margin) / 2,
        });
    }

    protected async drawCompact(svg: SVGSVGElement, entity: BaseEntity): Promise<void> {
        svg.setAttribute('data-mekbay-cluster-racks', clusterTableForEntity(entity).clusterSizes.join(','));
        await appendEmbeddedSvgDefinition(svg, '/images/record-sheet-art/handheld-weapon.svg', MASTHEAD_ART_ID);
        const large = isLargeHandheldLayout(entity);
        const extra = large ? LARGE_HEIGHT - STANDARD_HEIGHT : 0;
        const group = svgElement('g');
        group.setAttribute('class', 'handheld-weapon-strip');
        group.setAttribute('transform', `scale(${formatNumber(Math.min(1, Number(svg.getAttribute('width')) / BLOCK_WIDTH))})`);
        svg.appendChild(group);
        drawHandheldFrames(group, extra);

        const title = addText(group, `${entity.displayName()} (${formatNumber(entity.tonnage())} ${entity.tonnage() === 1 ? 'ton' : 'tons'})`,
            10.852, 11.471, { size: 10.6667, weight: 700, maxWidth: 208 });
        const name = svgElement('tspan');
        name.id = 'type';
        name.setAttribute('data-mekbay-field', 'display-name');
        name.textContent = entity.displayName();
        const weight = svgElement('tspan');
        weight.textContent = ` (${formatNumber(entity.tonnage())} ${entity.tonnage() === 1 ? 'ton' : 'tons'})`;
        title.replaceChildren(name, weight);
        addText(group, 'Weapons & Equipment Inventory', 11.54, 22.668, { size: 10.6667, weight: 700, maxWidth: 159 });
        addText(group, '(hexes)', 176.938, 23.087, { size: 8.2, weight: 700 });
        addText(group, 'Armor:', 251.537, 21.208, { size: 8.2, weight: 700, anchor: 'middle' });
        addText(group, formatProtectionCounter(entity.getArmorValue('Gun')), 251.3, 30.51, { size: 8.2, anchor: 'middle' }).id = 'textArmor_GUN';
        addText(group, entity.uniformArmor()?.armor.shortName ?? 'Standard', 251.3, 38.968,
            { size: 8.2, anchor: 'middle', maxWidth: 41 }).id = 'armorType';
        addText(group, 'BV:', 530.06, 19.491, { size: 8.2, weight: 700 });
        addText(group, String(entity.battleValue()), 545.836, 19.491, { size: 8.2 }).id = 'bv';

        // This strip has no authored rails; every non-canonical mode uses its rectangular fill.
        const armor = makeDistributedPips(entity.getArmorValue('Gun'), 160, 34.94 + extra, 'armor', 'GUN');
        if (armor) {
            armor.setAttribute('transform', 'translate(274 28.563)');
            armor.querySelectorAll<SVGElement>('circle, polygon, path, rect:not([data-pip-shadow])').forEach(pip => {
                pip.classList.add('pip', 'armor');
                pip.setAttribute('data-loc', 'GUN');
            });
            group.appendChild(armor);
        }
        drawHandheldInventory(group, entity, extra);
        drawHandheldAmmo(group, handheldAmmoGroups(entity), extra);
    }
}

function handheldAmmoGroups(entity: BaseEntity): HandheldAmmoGroup[] {
    const groups = new Map<string, HandheldAmmoGroup>();
    for (const mount of entity.equipment()) {
        const shots = mount.getAmmoShots();
        const count = shots ?? (mount.equipment instanceof WeaponEquipment ? mount.equipment.oneShotCount : undefined);
        if (count === undefined) continue;
        const name = recordSheetAmmoName(mount.displayName());
        const group = groups.get(name);
        if (group) { group.count += count; group.componentIds.push(mount.mountId); }
        else groups.set(name, { name, count, componentIds: [mount.mountId] });
    }
    return [...groups.values()];
}

function isLargeHandheldLayout(entity: BaseEntity): boolean {
    const ammo = handheldAmmoGroups(entity);
    const rounds = ammo.reduce((total, group) => total + group.count, 0);
    return entity.getArmorValue('Gun') > 65
        || new Set(entity.rangedWeapons().map(mount => mount.equipment.shortName || mount.equipment.name)).size > 2
        || ammo.length > 2 || rounds > 200 || ammo.length > 1 && rounds > 125;
}

function drawHandheldInventory(group: SVGGElement, entity: BaseEntity, extra: number): void {
    const xs = [16.811, 117.168, 177.382, 189.636, 202.735, 216.468];
    ['Type', 'Dmg', 'Min', 'Sht', 'Med', 'Lng'].forEach((label, index) => {
        addText(group, label, xs[index], 33.489, { size: RECORD_SHEET_FONT.inventory, weight: 700,
            anchor: index > 1 ? 'middle' : 'start' });
    });
    addText(group, 'Loc', 106.604, 33.489, { size: RECORD_SHEET_FONT.inventory, weight: 700, anchor: 'middle' });
    const rows = recordSheetInventoryWeapons(entity);
    const rowLines = (name: string, location: string, damage: string, minimum: string, ranges: readonly string[], fontSize: number) =>
        inventoryRowLineCount([[name, 77], [location, 19], [damage, 52], [minimum, 11],
            ...ranges.map(value => [value, 11] as const)], fontSize);
    const metrics = fitInventoryText(26 + extra, fontSize => ({ lineCount: rows.reduce((sum, row) => sum
        + rowLines(row.name, entity.componentLocationLabel(row.location), row.damage, row.minimumRange, row.ranges, fontSize)
        + row.alternativeModes.reduce((n, mode) => n + rowLines(mode.name, entity.componentLocationLabel(row.location),
            mode.damage, mode.minimumRange, mode.ranges, fontSize), 0), 0), content: undefined }));
    const step = metrics.lineStep;
    const addCell = (parent: SVGElement, value: string, x: number, y: number, options: Parameters<typeof addText>[4] = {}) =>
        addInventoryText(parent, value, x, y, { ...options, size: metrics.fontSize, lineHeight: step });
    let index = 0;
    for (const row of rows) {
        const entry = svgElement('g');
        entry.id = `handheld-inventory-${index}`;
        entry.setAttribute('class', 'inventoryEntry');
        setInventoryComponentIds(entry, row.componentIds);
        group.appendChild(entry);
        const draw = (host: SVGGElement, name: string, damage: string, min: string, ranges: readonly string[]) => {
            const y = 43.389 + index * step;
            const lineCount = rowLines(name, entity.componentLocationLabel(row.location), damage, min, ranges, metrics.fontSize);
            index += lineCount;
            host.appendChild(transparentRect(11.529, y - step + 1, 211.277, lineCount * step, 'inventoryEntryButton mainButton'));
            addCell(host, name, xs[0], y, { class: 'name', size: RECORD_SHEET_FONT.inventory, maxWidth: 77 });
            addCell(host, entity.componentLocationLabel(row.location), 106.604, y,
                { class: 'location', size: RECORD_SHEET_FONT.inventory, anchor: 'middle', maxWidth: 19 });
            addCell(host, damage, xs[1], y, { class: 'damage', size: RECORD_SHEET_FONT.inventory, maxWidth: 52 });
            [min, ...ranges].forEach((value, column) => {
                addCell(host, value, xs[column + 2], y, { class: ['range_min', 'range_short', 'range_medium', 'range_long'][column],
                    size: RECORD_SHEET_FONT.inventory, anchor: 'middle', maxWidth: 11 });
                if (column > 0) host.appendChild(transparentRect(xs[column + 2] - 6, y - step + 1, 12, step,
                    `inventoryEntryButton ${['', 'shrButton', 'medButton', 'lngButton'][column]}`));
            });
        };
        draw(entry, row.name, row.damage, row.minimumRange, row.ranges);
        row.alternativeModes.forEach(mode => {
            const alternative = svgElement('g');
            setAttributes(alternative, { class: mode.displayOnly ? 'equipmentProfile' : 'alternativeMode', 'data-mekbay-mode': mode.name });
            entry.appendChild(alternative);
            draw(alternative, mode.name, mode.damage, mode.minimumRange, mode.ranges);
        });
    }
}

function drawHandheldAmmo(group: SVGGElement, ammo: readonly HandheldAmmoGroup[], extra: number): void {
    const heading = addText(group, ammo.length === 1 ? `Ammo (${ammo[0].count}):` : 'Ammo:', 475, 21.208,
        { size: 8.2, weight: 700, anchor: 'middle' });
    heading.id = 'ammoLabel';
    const area = svgElement('g');
    area.id = 'ammoProfile';
    area.setAttribute('class', 'handheld-ammo-pips');
    group.appendChild(area);
    const height = (36.5 + extra) / Math.max(1, ammo.length);
    ammo.forEach((item, index) => {
        const row = svgElement('g');
        row.setAttribute('data-mekbay-ammo-component-ids', item.componentIds.join(' '));
        row.setAttribute('data-ammo-name', item.name);
        row.setAttribute('transform', `translate(450 ${27 + index * height})`);
        area.appendChild(row);
        const labelHeight = ammo.length > 1 ? 8 : 0;
        if (labelHeight) addText(row, `${item.name} (${item.count}):`, 0, 5,
            { class: 'handheld-ammo-label', size: 6.6667, weight: 700, maxWidth: 112 });
        const pips = GenericPipRenderer.createPips(item.count, 112, Math.max(1, height - labelHeight),
            { pipRadius: 3.6, minPipRadius: 1.1, strokeWidth: 0.9, pipGap: 0.3 }, 'ammo', 'GUN');
        if (pips) {
            pips.setAttribute('transform', `translate(0 ${labelHeight})`);
            pips.querySelectorAll<SVGElement>('circle, polygon, path, rect:not([data-pip-shadow])')
                .forEach(pip => pip.classList.add('pip', 'ammo'));
            row.appendChild(pips);
        }
    });
}

/** Preserves the authored strip geometry while ammunition is spent or its munition changes. */
export function renderHandheldWeaponAmmoPips(
    svg: SVGSVGElement,
    components: readonly NonMekRecordSheetComponent[],
): boolean {
    const area = svg.querySelector<SVGGElement>('.handheld-ammo-pips');
    if (!area) return false;
    const byId = new Map(components.map(component => [String(component.componentId), component]));
    const rows = [...area.querySelectorAll<SVGGElement>('[data-mekbay-ammo-component-ids]')];
    rows.forEach(row => {
        const ids = row.getAttribute('data-mekbay-ammo-component-ids')!.split(' ');
        const ammo = ids.map(id => byId.get(id)?.ammo);
        if (ammo.every(value => value === undefined)) return;
        const remaining = ammo.reduce((total, value) => total + (value?.remaining ?? 0), 0);
        const pips = [...row.querySelectorAll<SVGElement>('.ammo.pip')];
        pips.forEach((pip, index) => pip.classList.toggle('damaged', index >= remaining));
        const name = recordSheetAmmoName(ammo.find(value => value !== undefined)!.displayName);
        const label = row.querySelector('.handheld-ammo-label');
        if (label) label.textContent = `${name} (${remaining}):`;
        if (rows.length === 1) svg.querySelector('#ammoLabel')!.textContent = `Ammo (${remaining}):`;
    });
    return true;
}

/** Preserve the reference's raised label lips and stepped inventory bottom. */
function drawHandheldFrames(group: SVGGElement, extra: number): void {
    const gap = 6;
    const inventoryWidth = 216;
    const armorWidth = 210;
    const armorX = inventoryWidth + gap * 2;
    const ammoX = armorX + armorWidth + gap;
    const panelTop = gap * 2;
    const height = STANDARD_HEIGHT + extra;
    group.appendChild(SvgFrameUtil.createSVGFrame('', BLOCK_WIDTH, height, {
        headerStyle: 'outline',
        headerWidth: inventoryWidth,
        bottomLeftNotchWidth: inventoryWidth,
    }));
    for (const [x, width] of [[armorX, armorWidth], [ammoX, BLOCK_WIDTH - ammoX - gap]]) {
        const panel = SvgFrameUtil.createSVGFrame('', width, height - panelTop - gap, {
            headerStyle: 'outline',
            headerWidth: 54,
            variant: 'nested',
        });
        panel.setAttribute('transform', `translate(${formatNumber(x)} ${panelTop})`);
        group.appendChild(panel);
    }
}
