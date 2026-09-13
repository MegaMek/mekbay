// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { addInventoryText, fitInventoryText, inventoryRowLineCount } from '../inventory-text-layout';
import { RECORD_SHEET_FONT } from '../record-sheet-typography';

import { isElectronicInterfaceEquipment } from '../../../models/battle-armor-equipment.model';
import type { BaseEntity } from '../../../models/entity/base-entity';
import { type ProtoMekEntity } from '../../../models/entity/entities/protomek/protomek-entity';
import { isProtoMekEntity } from '../../../models/entity/utils/entity-type-guards';
import { intrinsicActionBaseDamageText } from '../../../models/entity/utils/mek-intrinsic-actions';
import { weaponQuirkLabels } from '../../../models/entity/utils/weapon-quirks';
import { isJumpJetEquipment } from '../../../models/jump-equipment.model';
import { PROTOMEK_GLIDER_WING_CRITICAL_REFERENCE,protoMekCriticalReferences,protoMekTorsoCriticalResults } from '../../../models/rules/protomek-critical-rules';
import { systemDamageControls } from '../../../models/runtime/system-damage-presentation';
import { clusterTableForEntity } from '../../record-sheet-reference-table';
import { PaperdollGenerator, type PaperdollPipLayout } from '../paperdoll-generator';
import { appendRecordSheetAmmoProfile } from '../record-sheet-ammo-rendering';
import {
PROTOMEK_DEFAULT_ART,
appendEmbeddedRasterUse,
appendRecordSheetEraIcon,
} from '../record-sheet-embedded-art';
import {
RECORD_SHEET_CONTENT_WIDTH,
type RecordSheetPageProfile,
} from '../record-sheet-layout';
import {
type Box,
addCrewSkillValue,
drawCrewHitGrid,
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
import { SvgFrameUtil } from '../svg-frame.util';
import { CompactRecordSheetLayout, type RecordSheetLayoutRequest } from './record-sheet-layout';
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
            catalystX: profile.margin,
            catalystY: profile.height - profile.margin - 24,
            catalystScale: 0.9,
            footerCenterX: (profile.margin + 60 + profile.width - profile.margin) / 2,
        });
    }

    protected async drawCompact(svg: SVGSVGElement, entity: BaseEntity, request: RecordSheetLayoutRequest): Promise<void> {
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
    identityGroup.setAttribute('data-mekbay-movement-frame-x', formatNumber(-identity.x));
    const identityScale = identity.width / 91;
    const jumpLabel = entity.umuMP() > 0 ? 'Underwater:' : 'Jump:';
    const jumpValue = entity.umuMP() > 0 ? entity.umuMP() : entity.jumpMP();
    const movementLines: readonly [string, string, string, string][] = entity.isGlider()
        ? [
            ['Ground:', '1', '', 'mpGround'],
            ['Cruise:', String(entity.walkMP()), 'walk', 'mpWalk'],
            ['Flank:', String(entity.runMP()), 'run', 'mpRun'],
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
        const labelNode = addText(identityGroup, label, (index < 4 ? 3 : 5) * identityScale, baseline, {
            size: 7.2 * identityScale, weight: 700,
        });
        if (index === 3) labelNode.id = 'movementPointsLabel';
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
    await drawCompactProtoMekDiagram(svg, entity, at({ x: 476.333, y: 11.786, width: 99.667, height: 113.414 }), request.pipLayout);
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
    if (request.showQuirks !== false) {
        const quirks = entity.quirks().map(entry => entry.quirk.name).sort().concat(weaponQuirkLabels(entity));
        if (quirks.length > 0) {
            const group = svgElement('g');
            group.classList.add('unitQuirks');
            addText(group, `Quirks: ${quirks.join(', ')}`, at({ x: 295, y: 0, width: 1, height: 1 }).x, footerY, {
                size: 6.084 * footerScale, maxWidth: 274 * footerScale,
            });
            svg.appendChild(group);
        }
    }
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
    // Keep the authored columns inside the frame's right border and padding.
    const sx = (box.width - 6) / 194.833;
    const sy = box.height / 77.405;
    const fontScale = box.width / 194.833;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const headings: readonly [string, number, 'start' | 'middle'][] = [
        ['#', 6.725, 'middle'], ['Type', 11.45, 'start'], ['Loc', 87.05, 'middle'], ['Dmg', 96.5, 'start'],
        ['Min', 150.365, 'middle'], ['Sht', 161.327, 'middle'], ['Med', 173.045, 'middle'], ['Lng', 185.33, 'middle'],
    ];
    headings.forEach(([label, position, anchor]) => addText(group, label, x(position), y(25.05), {
        size: font(RECORD_SHEET_FONT.inventory), weight: 700, anchor, maxWidth: anchor === 'middle' ? x(9.5) : undefined,
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
    const rowLines = (row: { name: string; location: string; damage: string; minimumRange: string; ranges: readonly string[] }, size: number) =>
        inventoryRowLineCount([[row.name, x(64)], [row.location, x(16)], [row.damage, x(46)],
            [row.minimumRange, x(11)], ...row.ranges.map(value => [value, x(11)] as const)], font(size));
    const metrics = fitInventoryText(70.493 - 34.95 - entity.intrinsicWeapons().length * 9.126, fontSize => ({
        lineCount: regularRows.reduce((sum, row) => sum + rowLines(row, fontSize), 0), content: undefined }));
    const lineStep = metrics.lineStep;
    const inventoryFont = font(metrics.fontSize);
    const addCell = (parent: SVGElement, value: string, x: number, yPos: number, options: Parameters<typeof addText>[4] = {}) =>
        addInventoryText(parent, value, x, yPos, { ...options, size: inventoryFont, lineHeight: y(lineStep) });
    const physical = entity.intrinsicWeapons();
    const physicalBaseline = 70.493;
    const inventory = svgElement('g');
    setAttributes(inventory, {
        'data-ammo-inventory': '',
        'data-top': y(34.95 - lineStep * 0.82),
        'data-bottom': y(physical.length > 0 ? physicalBaseline - physical.length * lineStep : 70.493),
    });
    group.appendChild(inventory);
    const physicalRows = svgElement('g');
    physicalRows.setAttribute('data-ammo-before', '');
    group.appendChild(physicalRows);

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
        parent = inventory,
    ): number => {
        const lineCount = rowLines(data, metrics.fontSize);
        const entry = svgElement('g');
        entry.setAttribute('class', 'inventoryEntry');
        entry.setAttribute('id', `generated-protomek-inventory-row@${index}`);
        setInventoryComponentIds(entry, data.componentIds);
        entry.appendChild(transparentRect(x(3), y(baselineValue - lineStep * 0.82), box.width - x(6),
            y(lineStep * lineCount),
            'inventoryEntryButton mainButton'));
        rangeButtons.forEach((className, rangeIndex) => entry.appendChild(
            transparentRect(x(rangePositions[rangeIndex + 1] - 5.5), y(baselineValue - lineStep * 0.82),
                x(11), y(lineStep), `inventoryEntryButton ${className}`),
        ));
        const baseline = y(baselineValue);
        addCell(entry, showQuantity ? String(data.quantity) : '', x(6.725), baseline, {
            class: 'quantity', size: font(RECORD_SHEET_FONT.inventory), anchor: 'middle',
        });
        addCell(entry, data.name, x(11.45), baseline, { class: 'name', maxWidth: x(64) });
        addCell(entry, data.location, x(87.05), baseline, {
            class: 'location', size: font(RECORD_SHEET_FONT.inventory), anchor: 'middle', maxWidth: x(16),
        });
        const damage = svgElement('g');
        damage.setAttribute('class', 'damage');
        addCell(damage, data.damage, x(96.5), baseline, { size: font(RECORD_SHEET_FONT.inventory), maxWidth: x(46) });
        entry.appendChild(damage);
        const values = [data.minimumRange, ...data.ranges];
        values.forEach((value, rangeIndex) => addCell(entry, value, x(rangePositions[rangeIndex]), baseline, {
            class: rangeClasses[rangeIndex], size: font(RECORD_SHEET_FONT.inventory), anchor: 'middle', maxWidth: x(11),
        }));
        parent.appendChild(entry);
        return lineCount;
    };

    let displayLine = 0;
    regularRows.forEach((row, index) => {
        displayLine += appendRow(row, 34.95 + displayLine * lineStep, String(index));
    });
    inventory.setAttribute('data-content-bottom', String(y(34.95 + Math.max(0, displayLine - 1) * lineStep)));

    const ammo = recordSheetAmmoProfile(entity);
    physical.forEach((attack, index) => appendRow({
        name: attack.name,
        location: '—',
        damage: intrinsicActionBaseDamageText(attack),
        minimumRange: '—',
        ranges: Object.freeze(['—', '—', '—']),
        componentIds: Object.freeze([]),
        quantity: 0,
    }, physicalBaseline - (physical.length - index - 1) * lineStep, `physical-${index}`, false, physicalRows));
    appendRecordSheetAmmoProfile(group, ammo, {
        x: x(6.725), y: y(75.191), width: box.width - x(13.45),
        fontSize: font(RECORD_SHEET_FONT.inventory), lineHeight: y(lineStep),
    });
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

    const baselines = entity.isQuad()
        ? { 'main-gun': 34.113, legs: 45.575, torso: 57.038, head: 68.501 }
        : entity.isGlider()
            ? { 'main-gun': 31.247, 'right-arm': 48.441, legs: 57.038, torso: 65.635, 'left-arm': 74.232, head: 82.829 }
            : { 'main-gun': 32.029, 'right-arm': 41.407, legs: 50.786, torso: 60.164, 'left-arm': 69.543, head: 78.921 };
    if (entity.isGlider()) {
        const wings = PROTOMEK_GLIDER_WING_CRITICAL_REFERENCE;
        addText(group, wings.rolls.join(','), x(13.88), y(39.844), {
            size: font(5.7), weight: 700, anchor: 'middle',
        });
        addText(group, wings.location, x(24.76), y(39.844), {
            size: font(5.7), weight: 700,
        }).id = 'wings_hit_label';
        addText(group, wings.effect, x(57.4), y(39.844), {
            size: font(5.7), weight: 700,
        }).id = 'wings_hit_text';
    }
    const rows = protoMekCriticalReferences(entity).map(row => ({
        ...row,
        rolls: row.rolls.length > 3 ? [row.rolls.slice(0, 2).join(','), row.rolls.slice(2).join(',')] : [row.rolls.join(',')],
        baseline: baselines[row.system as keyof typeof baselines]!,
        effects: row.effects.map((effect, index) => ({
            id: systemDamageControls(entity, row.system).ids[index],
            text: effect.text,
            secondLine: effect.detail,
            fill: row.system === 'torso' ? index === 2 ? '#000' : '#c7c7c7'
                : index === row.effects.length - 1 && index > 0 ? '#c7c7c7' : undefined,
        })),
    }));
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
        const columnX = x([6, 65.84, 125.68][column]);
        // The last baseline sits beside the frame's clipped bottom-right corner.
        const width = Math.min(x(56), box.width - columnX - x(10));
        addText(group, result, columnX, y(noteY + 7 + resultRow * 7), {
            size: font(5.7), weight: 700, maxWidth: width,
        }).id = `torsoWeapon_${index}`;
    });
}

function compactProtoMekTorsoCriticalResults(entity: ProtoMekEntity): readonly string[] {
    const results = protoMekTorsoCriticalResults(entity);
    if (results.length === 1 && results[0].weapon === undefined) return ['No Torso Weapons'];
    return results.map(result => `${result.firstRoll}${result.lastRoll > result.firstRoll ? `-${result.lastRoll}` : ''}: ${result.weapon ?? 'No Effect'}`);
}

async function drawCompactProtoMekDiagram(
    svg: SVGSVGElement,
    entity: ProtoMekEntity,
    box: Box,
    pipLayout: PaperdollPipLayout,
): Promise<void> {
    const group = svgElement('g');
    group.setAttribute('class', 'protomek-paperdoll');
    group.setAttribute('transform', `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`);
    const heading = SvgFrameUtil.createSVGFrameHeader('ARMOR DIAGRAM', 83.991, {
        headerWidth: 83.991,
        headerHeight: 6.25,
        headerFontSize: 8.6,
        cornerAngleDegrees: 45,
    });
    heading.setAttribute('class', 'diagram-heading');
    heading.setAttribute('transform', 'translate(5.338 0)');
    group.appendChild(heading);
    const armorValues: Record<string, number> = {};
    const structureValues: Record<string, number> = {};
    for (const location of entity.damageLocations()) {
        const code = location.sheetCode ?? entity.componentLocationLabel(location.code);
        armorValues[code] = location.armor.front;
        structureValues[code] = location.internalPoints;
    }
    const asset = entity.isQuad()
        ? '/images/paperdolls/protomek-quad.svg'
        : entity.isGlider()
            ? '/images/paperdolls/protomek-glider.svg'
            : '/images/paperdolls/protomek-biped.svg';
    try {
        const paperdoll = await PaperdollGenerator.createPaperdoll(
            asset,
            100,
            112,
            { armor: armorValues, structure: structureValues },
            {
                className: 'protomek-paperdoll-layer',
                scale: false,
                pipLayout,
                pipOptions: {
                    ...paperdollPipOptions(pipLayout, 3, 0.62),
                    strokeWidth: 0.5,
                },
                structurePipOptions: { pipRadius: 1, minPipRadius: 1, fill: '#c7c7c7' },
            },
        );
        if (!entity.hasMainGun()) {
            paperdoll.querySelectorAll('[data-protomek-main-gun]').forEach(element => element.remove());
            paperdoll.querySelectorAll('[data-protomek-main-gun-clip]').forEach(element => element.removeAttribute('clip-path'));
        }
        // Use the narrow clear margin below the heading, beside the right shoulder.
        paperdoll.setAttribute('data-random-hit-transform', 'translate(83 13) scale(0.5)');
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
    skillButton.setAttribute('skill', 'gunnery');
    group.appendChild(skillButton);
    addText(group, 'Name:', x(9.845), y(21.668), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
    const name = addText(group, '', x(32.073), y(21.668), { size: font(RECORD_SHEET_FONT.inventory), maxWidth: x(103.355) });
    name.id = 'crewName0';
    addLine(group, x(32.073), y(22.668), x(135.428), y(22.668), '#111', 0.72 * fontScale);
    addText(group, 'Gunnery Skill:', x(9.845), y(30.941), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
    const skill = addCrewSkillValue(group, '4', x(52.392), y(30.941), fontScale);
    skill.id = 'gunnerySkill0';
    drawCrewHitGrid(group, 0, {
        x: x(182.47), y: y(11.723), cellWidth: x(87.05 / 6), cellHeight: y(9),
        labelX: x(140), labelWidth: x(40.47), fontScale,
    });
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
