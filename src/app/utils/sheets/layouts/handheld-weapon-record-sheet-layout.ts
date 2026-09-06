// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

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
        return Object.freeze({ ...profile, height: large ? LARGE_HEIGHT : STANDARD_HEIGHT,
            stride: large ? 149.06 : 74.53 });
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
        drawGeneratedFooter(page, profile, { catalystX: 18, catalystY: 744.587, catalystScale: 1.015 });
    }

    protected async drawCompact(svg: SVGSVGElement, entity: BaseEntity): Promise<void> {
        svg.setAttribute('data-mekbay-cluster-racks', clusterTableForEntity(entity).clusterSizes.join(','));
        await appendEmbeddedSvgDefinition(svg, '/images/record-sheet-art/handheld-weapon.svg', MASTHEAD_ART_ID);
        const large = isLargeHandheldLayout(entity);
        const extra = large ? LARGE_HEIGHT - STANDARD_HEIGHT : 0;
        const group = svgElement('g');
        group.setAttribute('class', 'handheld-weapon-strip');
        group.setAttribute('transform', `scale(${formatNumber(Number(svg.getAttribute('width')) / BLOCK_WIDTH)} 1) translate(-2.110329 0.33320985)`);
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
        addText(group, String(entity.getArmorValue('Gun')), 251.3, 30.51, { size: 8.2, anchor: 'middle' }).id = 'textArmor_GUN';
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
        addText(group, label, xs[index], 33.489, { size: 6.76, weight: 700,
            anchor: index > 1 ? 'middle' : 'start' });
    });
    addText(group, 'Loc', 106.604, 33.489, { size: 6.76, weight: 700, anchor: 'middle' });
    const rows = recordSheetInventoryWeapons(entity);
    const lineCount = rows.reduce((count, row) => count + 1 + row.alternativeModes.length, 0);
    const step = Math.min(8.676, (26 + extra) / Math.max(1, lineCount));
    let index = 0;
    for (const row of rows) {
        const entry = svgElement('g');
        entry.id = `handheld-inventory-${index}`;
        entry.setAttribute('class', 'inventoryEntry');
        setInventoryComponentIds(entry, row.componentIds);
        group.appendChild(entry);
        const draw = (host: SVGGElement, name: string, damage: string, min: string, ranges: readonly string[]) => {
            const y = 43.389 + index++ * step;
            host.appendChild(transparentRect(11.529, y - step + 1, 211.277, step, 'inventoryEntryButton mainButton'));
            addText(host, name, xs[0], y, { class: 'name', size: 6.76, maxWidth: 81 });
            addText(host, entity.componentLocationLabel(row.location), 106.604, y,
                { class: 'location', size: 6.76, anchor: 'middle', maxWidth: 19 });
            addText(host, damage, xs[1], y, { class: 'damage', size: 6.76, maxWidth: 52 });
            [min, ...ranges].forEach((value, column) => {
                addText(host, value, xs[column + 2], y, { class: ['range_min', 'range_short', 'range_medium', 'range_long'][column],
                    size: 6.76, anchor: 'middle', maxWidth: 11 });
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

/** HHW strips have a plain name notch; these four generated contours are their entire frame. */
function drawHandheldFrames(group: SVGGElement, extra: number): void {
    const contour = (points: readonly (readonly [number, number])[], dx: number, dy: number,
        fill: string, stroke?: string, width?: number) => {
        const path = svgElement('path');
        setAttributes(path, { d: points.map(([x, y], index) =>
            `${index === 0 ? 'M' : 'L'}${formatNumber(dx + x * 1.0317376)} ${formatNumber(dy - y * 1.0317376 + (y < 10 ? extra : 0))}`).join(' ') + ' Z',
            fill, stroke, 'stroke-width': width, 'stroke-linejoin': 'miter' });
        group.appendChild(path);
    };
    const outer = [[0, 0], [-5.668, -8.502], [-331.654, -8.502], [-337.323, 0], [-547.087, 0],
        [-552.757, 8.505], [-552.757, 53.861], [-547.087, 62.365], [-342.993, 62.365],
        [-337.324, 53.861], [-7.086, 53.86], [0, 45.356]] as const;
    contour(outer, 577.8292, 69.428561, '#c7c8ca');
    contour(outer, 573.44225, 65.041811, '#fff', '#000', 2.06348);
    contour([[0, -0.166], [-3.322, -5.149], [-195.576, -5.149], [-201.26, 3.376],
        [-201.26, 38.267], [-195.59, 46.771], [-150.59, 46.771], [-144.541, 37.428], [-6.125, 37.428], [0, 29.759]],
        437.44736, 62.114671, 'none', '#000', 1.03174);
    contour([[0, -0.166], [-3.322, -5.149], [-110.999, -5.149], [-116.702, 3.405],
        [-116.702, 38.267], [-111.032, 46.771], [-66.032, 46.771], [-59.983, 37.428], [-6.125, 37.428], [0, 29.759]],
        566.62711, 62.114671, 'none', '#000', 1.03174);
}
