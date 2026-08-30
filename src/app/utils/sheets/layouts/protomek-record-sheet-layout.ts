// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import { isProtoMekEntity } from '../../../models/entity/utils/entity-type-guards';
import { CompactRecordSheetLayout } from './record-sheet-layout';
import { type BipedArmorValues, BipedPaperdollUtil } from '../biped-paperdoll.util';
import { type ProtoMekEntity } from '../../../models/entity/entities/protomek/protomek-entity';
import {
    RECORD_SHEET_CONTENT_WIDTH,
    type RecordSheetPageProfile,
} from '../record-sheet-layout';
import { SvgFrameUtil } from '../svg-frame.util';
import { intrinsicActionBaseDamageText } from '../../../models/entity/utils/mek-intrinsic-actions';
import { isJumpJetEquipment } from '../../../models/jump-equipment.model';
import { isElectronicInterfaceEquipment } from '../../../models/battle-armor-equipment.model';
import { clusterTableForEntity } from '../../record-sheet-reference-table';
import {
    type Box,
    addFrame,
    addLine,
    addText,
    appendLegacyIdentityAnchors,
    compactArmorDisplayName,
    compactLocationLabel,
    decoratePaperdollPips,
    drawCheckbox,
    drawClusterHitsReference,
    drawDamageLocation,
    drawGeneratedFooter,
    formatNumber,
    paperdollPipOptions,
    readViewBox,
    recordSheetAmmoProfile,
    recordSheetInventoryWeapons,
    scaleCompactBox,
    scalePageBox,
    setAttributes,
    setInventoryComponentIds,
    svgElement,
    transparentRect,
} from '../record-sheet-svg-rendering';
import {
    PROTOMEK_DEFAULT_ART,
    appendEmbeddedRasterUse,
    appendRecordSheetEraIcon,
} from '../record-sheet-embedded-art';
export class ProtoMekRecordSheetLayout extends CompactRecordSheetLayout {
    public constructor() {
        super(
            'protomek',
            'protomek',
            'PROTOMEK RECORD SHEET',
            page => page.format === 'a4'
                ? { height: 149.2, stride: 144.228 }
                : { height: 139.2, stride: 133.929 },
            'PROTOMEK ',
        );
    }

    public matches(entity: BaseEntity): boolean {
        return isProtoMekEntity(entity);
    }

    protected override compactMastheadTitleLines(): readonly string[] {
        return ['PROTOMECH', 'RECORD SHEET'];
    }

    protected override drawCompactMastheadIcon(
        parent: SVGGElement,
        box: Box,
        svg: SVGSVGElement,
    ): void {
        drawProtoMekMastheadIcon(svg, parent, box);
    }

    public override drawCompactPageSupplement(
        page: SVGSVGElement,
        profile: RecordSheetPageProfile,
        blocks: readonly SVGSVGElement[],
        entity?: BaseEntity,
    ): void {
        page.setAttribute('data-mekbay-reference-family', 'protomek');
        if (blocks.length === 1) {
            const racks = entity !== undefined && isProtoMekEntity(entity)
                ? clusterTableForEntity(entity).clusterSizes
                : parseProtoMekClusterRacks(blocks[0]);
            if (racks.length > 0) {
                drawClusterHitsReference(page, scalePageBox(profile, {
                    x: 18.9, y: 218.286, width: 576.15, height: 113.7,
                }), racks, 'full-width');
            }
        }
        drawGeneratedFooter(page, profile, {
            catalystX: 18,
            catalystY: 744.587,
            catalystScale: 1.015,
            footerCenterX: 332.5,
        });
    }

    protected async drawCompact(svg: SVGSVGElement, entity: BaseEntity): Promise<void> {
        if (!isProtoMekEntity(entity)) throw new Error('ProtoMek layout requires a ProtoMek entity');
        svg.setAttribute(
            'data-mekbay-cluster-racks',
            clusterTableForEntity(entity).clusterSizes.join(','),
        );
        const at = (box: Box): Box => scaleCompactBox(svg, box, 139.2);
        const outer = addFrame(svg, 'PROTOMEK 1', at({ x: 0, y: 0, width: 576, height: 139.2 }), {
        bottomLeftNotchWidth: 92,
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    outer.setAttribute('class', `${outer.getAttribute('class') ?? ''} compact-protomek-frame`.trim());

    const identity = at({ x: 3, y: 18, width: 91, height: 68 });
    const identityGroup = svgElement('g');
    identityGroup.setAttribute('transform', `translate(${formatNumber(identity.x)} ${formatNumber(identity.y)})`);
    const identityScale = identity.width / 91;
    const jumpLabel = entity.umuMP() > 0 ? 'Underwater:' : 'Jump:';
    const jumpValue = entity.umuMP() > 0 ? entity.umuMP() : entity.jumpMP();
    const movementLines: readonly [string, string, string, string][] = entity.isGlider()
        ? [
            ['Ground:', '1', 'walk', 'mpGround'],
            ['Cruise:', String(entity.walkMP()), 'run', 'mpWalk'],
            ['Flank:', String(entity.runMP()), 'jump', 'mpRun'],
        ]
        : [
            ['Walk:', String(entity.walkMP()), 'walk', 'mpWalk'],
            ['Run:', String(entity.runMP()), 'run', 'mpRun'],
            [jumpLabel, String(jumpValue), 'jump', 'mpJump'],
        ];
    const identityLines: readonly [string, string, string?, string?][] = [
        ['Type:', entity.displayName(), 'display-name', 'type'],
        ['Tons:', formatNumber(entity.tonnage()), 'tonnage', 'tonnage'],
        ['Role:', entity.role() || '—', 'role', 'role'],
        ['Movement Points:', '', undefined, undefined],
        ...movementLines,
    ];
    const baselines = [8.774, 17.548, 26.322, 35.095, 43.869, 51.869, 59.869] as const;
    identityLines.forEach(([label, value, field, id], index) => {
        const baseline = baselines[index] * identityScale;
        addText(identityGroup, label, (index < 4 ? 3 : 5) * identityScale, baseline, {
            size: 7.2 * identityScale, weight: 700,
        });
        if (value) {
            const valueX = index === 0 ? 22.523 : index === 1 ? 23.004 : index === 2 ? 21.702 : 55;
            const valueNode = addText(identityGroup, value, valueX * identityScale, baseline, {
                size: 7.2 * identityScale,
                weight: index === 0 ? 700 : 400,
                maxWidth: identity.width - valueX * identityScale,
            });
            if (field) valueNode.setAttribute('data-mekbay-field', field);
            if (id) valueNode.id = id;
        }
    });
    svg.appendChild(identityGroup);

    drawCompactProtoMekInventory(svg, entity, at({ x: 97.667, y: 11.786, width: 194.833, height: 77.405 }));
    drawCompactProtoMekCriticals(svg, entity, at({ x: 292.5, y: 11.786, width: 183.833, height: 113.414 }));
    await drawCompactProtoMekDiagram(svg, entity, at({ x: 476.333, y: 11.786, width: 99.667, height: 113.414 }));
    drawCompactProtoMekPilot(svg, at({ x: 5, y: 88.191, width: 287.5, height: 36.009 }));

    const footerY = at({ x: 0, y: 130.2, width: 576, height: 1 }).y;
    const footerScale = readViewBox(svg).width / RECORD_SHEET_CONTENT_WIDTH;
    addText(svg, 'BV:', at({ x: 99.667, y: 0, width: 1, height: 1 }).x, footerY, { size: 6.2 * footerScale, weight: 700 });
    const bv = addText(svg, formatNumber(entity.battleValue()), at({ x: 111.806, y: 0, width: 1, height: 1 }).x, footerY, {
        size: 6.2 * footerScale,
    });
    bv.id = 'bv';
    addText(svg, 'Armor:', at({ x: 146, y: 0, width: 1, height: 1 }).x, footerY, { size: 6.2 * footerScale, weight: 700 });
    addText(svg, compactArmorDisplayName(entity.uniformArmor()?.armor.name, 'Standard'), at({ x: 167.804, y: 0, width: 1, height: 1 }).x, footerY, {
        size: 6.2 * footerScale,
        maxWidth: 108 * footerScale,
    });
        const eraBox = at({ x: 75.667, y: 66.191, width: 20, height: 20 });
        await appendRecordSheetEraIcon(svg, outer, entity.year(), eraBox);
        appendLegacyIdentityAnchors(outer, entity, at({ x: 0, y: 0, width: 576, height: 139.2 }));
    }
}

function parseProtoMekClusterRacks(block: SVGSVGElement | undefined): readonly number[] {
    return (block?.getAttribute('data-mekbay-cluster-racks') ?? '')
        .split(',')
        .map(Number)
        .filter(value => Number.isInteger(value) && value > 0);
}

function drawCompactProtoMekInventory(
    svg: SVGSVGElement,
    entity: ProtoMekEntity,
    box: Box,
): void {
    const group = addFrame(svg, 'WEAPONS INVENTORY', box, {
        fullWidthHeader: true,
        headerFontSize: 8.6,
        cornerAngleDegrees: { topLeft: 45, topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    const sx = box.width / 194.833;
    const sy = box.height / 77.405;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const headings: readonly [string, number, 'start' | 'middle'][] = [
        ['#', 6.725, 'middle'], ['Type', 11.45, 'start'], ['Loc', 87.05, 'middle'], ['Dmg', 96.5, 'start'],
        ['Min', 150.365, 'middle'], ['Sht', 161.327, 'middle'], ['Med', 173.045, 'middle'], ['Lng', 185.33, 'middle'],
    ];
    headings.forEach(([label, position, anchor]) => addText(group, label, x(position), y(25.05), {
        size: font(6.76), weight: 700, anchor,
    }));

    const weapons = recordSheetInventoryWeapons(entity, true);
    const weaponComponentIds = new Set(weapons.flatMap(row => row.componentIds));
    const miscRows = new Map<string, {
        name: string;
        location: string;
        damage: string;
        componentIds: string[];
        quantity: number;
    }>();
    entity.equipment().forEach(mount => {
        const equipment = mount.equipment;
        if (!equipment) return;
        if (weaponComponentIds.has(mount.mountId)
            || mount.getAmmoShots() !== undefined
            || isJumpJetEquipment(equipment)
            || equipment.type === 'armor'
            || equipment.hasFlag('INTERNAL_REPRESENTATION')) return;
        const location = compactLocationLabel(mount.getOccupiedLocations().join('/') || mount.location || '—');
        const damage = isElectronicInterfaceEquipment(equipment) ? '[E]' : '—';
        const key = `${mount.displayName()}\u0000${location}\u0000${damage}`;
        const existing = miscRows.get(key);
        if (existing) {
            existing.quantity++;
            existing.componentIds.push(mount.mountId);
        } else {
            miscRows.set(key, {
                name: mount.displayName(), location, damage,
                componentIds: [mount.mountId], quantity: 1,
            });
        }
    });
    const regularRows = [
        ...weapons.map(row => ({ ...row, location: compactLocationLabel(row.location) })),
        ...[...miscRows.values()].map(row => ({
            ...row,
            heat: '—',
            minimumRange: '—',
            ranges: Object.freeze(['—', '—', '—']),
            alternativeModes: Object.freeze([]),
        })),
    ];
    const rangePositions = [150.365, 161.327, 173.045, 185.33] as const;
    const rangeClasses = ['range_min', 'range_short', 'range_medium', 'range_long'] as const;
    const rangeButtons = ['shrButton', 'medButton', 'lngButton'] as const;
    const lineStep = 9.126;

    const appendRow = (
        data: typeof regularRows[number] | Readonly<{
            name: string;
            location: string;
            damage: string;
            minimumRange: string;
            ranges: readonly string[];
            componentIds: readonly string[];
            quantity: number;
        }>,
        baselineValue: number,
        index: string,
        showQuantity = true,
    ): number => {
        const nameLines = compactProtoMekNameLines(data.name);
        const entry = svgElement('g');
        entry.setAttribute('class', 'inventoryEntry');
        entry.setAttribute('id', `generated-protomek-inventory-row@${index}`);
        setInventoryComponentIds(entry, data.componentIds);
        entry.appendChild(transparentRect(x(3), y(baselineValue - lineStep * 0.82), box.width - x(6),
            y(lineStep * nameLines.length),
            'inventoryEntryButton mainButton'));
        rangeButtons.forEach((className, rangeIndex) => entry.appendChild(
            transparentRect(x(rangePositions[rangeIndex + 1] - 5.5), y(baselineValue - lineStep * 0.82),
                x(11), y(lineStep), `inventoryEntryButton ${className}`),
        ));
        const baseline = y(baselineValue);
        addText(entry, showQuantity ? String(data.quantity) : '', x(6.725), baseline, {
            class: 'quantity', size: font(6.76), anchor: 'middle',
        });
        const nameGroup = svgElement('g');
        nameGroup.setAttribute('class', 'name');
        nameLines.forEach((line, lineIndex) => addText(nameGroup, line, x(11.45),
            y(baselineValue + lineIndex * lineStep), { size: font(6.76), maxWidth: x(72) }));
        entry.appendChild(nameGroup);
        addText(entry, data.location, x(87.05), baseline, {
            class: 'location', size: font(6.76), anchor: 'middle', maxWidth: x(18),
        });
        const damage = svgElement('g');
        damage.setAttribute('class', 'damage');
        addText(damage, data.damage, x(96.5), baseline, { size: font(6.76), maxWidth: x(50) });
        entry.appendChild(damage);
        const values = [data.minimumRange, ...data.ranges];
        values.forEach((value, rangeIndex) => addText(entry, value, x(rangePositions[rangeIndex]), baseline, {
            class: rangeClasses[rangeIndex], size: font(6.76), anchor: 'middle', maxWidth: x(11),
        }));
        group.appendChild(entry);
        return nameLines.length;
    };

    let displayLine = 0;
    regularRows.forEach((row, index) => {
        if (34.95 + displayLine * lineStep > 58) return;
        displayLine += appendRow(row, 34.95 + displayLine * lineStep, String(index));
    });

    const ammo = recordSheetAmmoProfile(entity);
    const physical = entity.intrinsicWeapons();
    const physicalBaseline = ammo.length > 0 ? 63.9 : 70.493;
    physical.forEach((attack, index) => appendRow({
        name: attack.name,
        location: '—',
        damage: intrinsicActionBaseDamageText(attack),
        minimumRange: '—',
        ranges: Object.freeze(['—', '—', '—']),
        componentIds: Object.freeze([]),
        quantity: 0,
    }, physicalBaseline - (physical.length - index - 1) * lineStep, `physical-${index}`, false));
    if (ammo.length === 0) return;
    const ammoProfile = svgElement('g');
    ammoProfile.id = 'ammoProfile';
    addText(ammoProfile, `Ammo: ${ammo.join(', ')}`, x(6.725), y(75.191), {
        size: font(6.76), maxWidth: box.width - x(13.45),
    });
    group.appendChild(ammoProfile);
}

function compactProtoMekNameLines(value: string): readonly string[] {
    if (value.length <= 22) return Object.freeze([value]);
    const breakAt = value.lastIndexOf(' ', 22);
    if (breakAt <= 0) return Object.freeze([value]);
    return Object.freeze([value.slice(0, breakAt), value.slice(breakAt + 1)]);
}

function drawCompactProtoMekCriticals(
    svg: SVGSVGElement,
    entity: ProtoMekEntity,
    box: Box,
): void {
    const group = addFrame(svg, 'HIT LOCATIONS AND CRITICAL HITS', box, {
        fullWidthHeader: true,
        headerFontSize: 8.6,
        cornerAngleDegrees: { topLeft: 45, topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    const sx = box.width / 183.833;
    const sy = box.height / 113.414;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const headings: readonly [string, number, 'start' | 'middle'][] = [
        ['2D6', 13.88, 'middle'], ['LOCATION', 24.76, 'start'], ['1st HIT', 57.4, 'start'],
        ['2nd HIT', 102.733, 'start'], ['3rd HIT', 148.067, 'start'],
    ];
    headings.forEach(([label, position, anchor]) => addText(group, label, x(position), y(22.65), {
        size: font(6.2), weight: 700, anchor,
    }));

    type CriticalEffect = Readonly<{
        id: string;
        text: string;
        secondLine?: string;
        fill?: string;
    }>;
    type CriticalRow = Readonly<{
        rolls: readonly string[];
        location: string;
        baseline: number;
        effects: readonly CriticalEffect[];
    }>;
    const mainGun: CriticalRow = {
        rolls: ['2'], location: 'Main Gun', baseline: entity.isQuad() ? 34.113 : 32.029,
        effects: [{ id: 'gun_hit_1', text: 'Main Gun Destroyed' }],
    };
    const legs: CriticalRow = {
        rolls: entity.isQuad() ? ['4,5', '9,10'] : ['5,9'],
        location: 'Legs', baseline: entity.isQuad() ? 45.575 : 50.786,
        effects: [
            { id: 'legs_hit_1', text: '-1 Walk MP' },
            { id: 'legs_hit_2', text: '1/2 Walk MP' },
            { id: 'legs_hit_3', text: 'No Move', fill: '#c7c7c7' },
        ],
    };
    const torso: CriticalRow = {
        rolls: ['6,7,8'], location: 'Torso', baseline: entity.isQuad() ? 57.038 : 60.164,
        effects: [
            { id: 'torso_hit_1', text: '-1 Jump MP*', fill: '#c7c7c7' },
            { id: 'torso_hit_2', text: '1/2 Jump MP*', fill: '#c7c7c7' },
            { id: 'torso_hit_3', text: 'Proto', secondLine: 'Destroyed', fill: '#000' },
        ],
    };
    const head: CriticalRow = {
        rolls: ['12'], location: 'Head', baseline: entity.isQuad() ? 68.501 : 78.921,
        effects: [
            { id: 'head_hit_1', text: '+1 to Hit' },
            { id: 'head_hit_2', text: '+2 to Hit', secondLine: 'No Long Range Shots', fill: '#c7c7c7' },
        ],
    };
    const rows: readonly CriticalRow[] = entity.isQuad()
        ? [mainGun, legs, torso, head]
        : [
            mainGun,
            {
                rolls: ['4'], location: 'Right Arm', baseline: 41.407,
                effects: [
                    { id: 'ra_hit_1', text: '+1 to Hit' },
                    { id: 'ra_hit_2', text: 'Right Arm Destroyed', fill: '#c7c7c7' },
                ],
            },
            legs,
            torso,
            {
                rolls: ['10'], location: 'Left Arm', baseline: 69.543,
                effects: [
                    { id: 'la_hit_1', text: '+1 to Hit' },
                    { id: 'la_hit_2', text: 'Left Arm Destroyed', fill: '#c7c7c7' },
                ],
            },
            head,
        ];
    const controlXs = [57.4, 102.733, 148.067] as const;
    const textXs = [65.8, 111.133, 156.467] as const;
    rows.forEach(row => {
        row.rolls.forEach((roll, rollIndex) => addText(group, roll, x(13.88),
            y(row.baseline + rollIndex * 7), { size: font(5.7), weight: 700, anchor: 'middle' }));
        addText(group, row.location, x(24.76), y(row.baseline), {
            size: font(5.7), weight: 700, maxWidth: x(31),
        });
        row.effects.forEach((effect, effectIndex) => {
            const control = drawCheckbox(group, x(controlXs[effectIndex]), y(row.baseline - 5.6),
                x(7), false, 'criticalPip critLoc');
            control.id = effect.id;
            control.setAttribute('critId', effect.id);
            if (effect.fill) control.setAttribute('fill', effect.fill);
            addText(group, effect.text, x(textXs[effectIndex]), y(row.baseline), {
                size: font(5.7), weight: 700,
                maxWidth: x(effectIndex === 2 ? 27 : 38),
            });
            if (effect.secondLine) addText(group, effect.secondLine, x(textXs[effectIndex]),
                y(row.baseline + 7), {
                    size: font(5.7), weight: 700,
                    maxWidth: x(effectIndex === 2 ? 27 : 38),
                });
        });
    });

    const noteY = entity.isQuad() ? 96.414 : 103.414;
    addText(group, '*Torso Weapon Destroyed, Roll 1D6:', x(3), y(noteY), {
        size: font(5.7), weight: 700, maxWidth: box.width - x(6),
    });
    compactProtoMekTorsoCriticalResults(entity).forEach((result, index) => {
        const column = index % 3;
        const resultRow = Math.floor(index / 3);
        addText(group, result, x([6, 65.84, 125.68][column]), y(noteY + 7 + resultRow * 7), {
            size: font(5.7), weight: 700, maxWidth: x(56),
        }).id = `torsoWeapon_${index}`;
    });
}

function compactProtoMekTorsoCriticalResults(entity: ProtoMekEntity): readonly string[] {
    const weapons = entity.equipment()
        .filter(mount => mount.getOccupiedLocations().includes('Torso')
            && mount.getAmmoShots() === undefined
            && !isJumpJetEquipment(mount.equipment))
        .map(mount => mount.displayName());
    if (weapons.length === 0) return Object.freeze(['No Torso Weapons']);
    const facesPerWeapon = entity.isQuad() ? 1 : 2;
    const results: string[] = [];
    let roll = 1;
    for (const weapon of weapons) {
        if (roll > 6) break;
        const end = Math.min(6, roll + facesPerWeapon - 1);
        results.push(`${roll}${end > roll ? `-${end}` : ''}: ${weapon}`);
        roll = end + 1;
    }
    if (roll <= 6) results.push(`${roll}${roll < 6 ? '-6' : ''}: No Effect`);
    return Object.freeze(results);
}

async function drawCompactProtoMekDiagram(
    svg: SVGSVGElement,
    entity: ProtoMekEntity,
    box: Box,
): Promise<void> {
    const group = svgElement('g');
    group.setAttribute('class', 'protomek-paperdoll');
    group.setAttribute('transform', `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`);
    const heading = SvgFrameUtil.createSVGFrameHeader('ARMOR DIAGRAM', box.width, {
        headerWidth: box.width,
        headerFontSize: Math.max(6.4, box.width * 0.086),
        cornerAngleDegrees: 45,
    });
    heading.setAttribute('class', 'diagram-heading');
    group.appendChild(heading);
    const armorValues: Record<string, number> = {};
    for (const location of entity.damageLocations()) {
        armorValues[location.sheetCode ?? entity.componentLocationLabel(location.code)] = location.armor.front;
    }
    const asset = entity.isQuad()
        ? '/images/paperdolls/protomek-quad.svg'
        : entity.isGlider()
            ? '/images/paperdolls/protomek-glider.svg'
            : '/images/paperdolls/protomek-biped.svg';
    try {
        const paperdoll = await BipedPaperdollUtil.createDamagePaperdoll(
            asset,
            100,
            112,
            armorValues as BipedArmorValues,
            {},
            {
                className: 'protomek-paperdoll-layer',
                scale: false,
                pipLayout: 'classic',
                pipOptions: {
                    ...paperdollPipOptions('classic', 3, 0.62),
                    strokeWidth: 0.5,
                },
            },
        );
        decoratePaperdollPips(paperdoll);
        group.appendChild(paperdoll);
    } catch {
        drawCompactProtoMekDiagramFallback(group, entity, box.width, box.height - 18);
    }
    svg.appendChild(group);
}

function drawCompactProtoMekDiagramFallback(
    group: SVGGElement,
    entity: ProtoMekEntity,
    width: number,
    height: number,
): void {
    const locations = entity.damageLocations();
    const columns = 2;
    const cellWidth = (width - 8) / columns;
    const cellHeight = Math.max(14, (height - 22) / Math.ceil(locations.length / columns));
    locations.forEach((location, index) => {
        drawDamageLocation(
            group,
            location,
            4 + index % columns * cellWidth,
            20 + Math.floor(index / columns) * cellHeight,
            cellWidth - 2,
            cellHeight - 2,
        );
    });
}

function drawCompactProtoMekPilot(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'PILOT DATA', box, {
        headerWidth: 92.667 * (box.width / 287.5),
        headerFontSize: 8.6,
        cornerAngleDegrees: { topLeft: 45, topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    const sx = box.width / 287.5;
    const sy = box.height / 36.009;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const nameButton = transparentRect(x(7), y(13), x(131), y(10), 'crewNameButton');
    nameButton.setAttribute('crewId', '0');
    nameButton.setAttribute('textElement', 'crewName0');
    group.appendChild(nameButton);
    const skillButton = transparentRect(x(7), y(22.5), x(83), y(10), 'crewSkillButton');
    skillButton.setAttribute('crewId', '0');
    group.appendChild(skillButton);
    addText(group, 'Name:', x(9.845), y(21.668), { size: font(6.76), weight: 700 });
    const name = addText(group, '', x(32.073), y(21.668), { size: font(6.76), maxWidth: x(103.355) });
    name.id = 'crewName0';
    addLine(group, x(32.073), y(22.668), x(135.428), y(22.668), '#111', 0.72 * fontScale);
    addText(group, 'Gunnery Skill:', x(9.845), y(30.941), { size: font(6.76), weight: 700 });
    const skill = addText(group, '4', x(52.392), y(30.941), { size: font(6.76) });
    skill.id = 'gunnerySkill0';
    addText(group, 'Hits Taken', x(180.47), y(18.723), {
        size: font(5.2), weight: 700, anchor: 'end',
    });
    addText(group, 'Consciousness #', x(180.47), y(27.723), {
        size: font(5.2), weight: 700, anchor: 'end',
    });
    const consciousness = ['3', '5', '7', '10', '11', 'Dead'] as const;
    const gridX = 182.47;
    const cellWidth = 14.508333;
    for (let hit = 1; hit <= 6; hit++) {
        const cellX = gridX + (hit - 1) * cellWidth;
        const cx = cellX + cellWidth / 2;
        const cell = svgElement('rect');
        setAttributes(cell, {
            x: x(cellX), y: y(11.723), width: x(cellWidth), height: y(9),
            class: 'crewHit', fill: '#fff', stroke: 'none',
        });
        cell.id = `crew_damage_0_${hit}`;
        cell.setAttribute('crewId', '0');
        cell.setAttribute('hit', String(hit));
        group.appendChild(cell);
        addText(group, String(hit), x(cx), y(18.723), {
            class: 'crewHitLabel', size: font(5.8), weight: 700, anchor: 'middle',
        });
        addText(group, consciousness[hit - 1], x(cx), y(27.723), {
            size: font(5.8), weight: 700, anchor: 'middle',
        });
    }
    const grid = svgElement('rect');
    setAttributes(grid, {
        x: x(gridX), y: y(11.723), width: x(87.05), height: y(18), rx: x(1.015),
        fill: 'none', stroke: '#111', 'stroke-width': 0.8 * fontScale,
    });
    group.appendChild(grid);
    addLine(group, x(gridX), y(20.723), x(gridX + 87.05), y(20.723), '#111', 0.8 * fontScale);
    for (let divider = 1; divider < 6; divider++) {
        const dividerX = gridX + divider * cellWidth;
        addLine(group, x(dividerX), y(11.723), x(dividerX), y(29.723), '#111', 0.8 * fontScale);
    }
}

function drawProtoMekMastheadIcon(
    svg: SVGSVGElement,
    parent: SVGGElement,
    box: Box,
): void {
    const sx = box.width / 31.018;
    const sy = box.height / 41.357;
    appendEmbeddedRasterUse(
        svg,
        parent,
        PROTOMEK_DEFAULT_ART,
        { x: 9.45 * sx, y: 2 * sy, width: 37.8 * sx, height: 41.357 * sy },
        'protomek-masthead-icon',
    );
}
