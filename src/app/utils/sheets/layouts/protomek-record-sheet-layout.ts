// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { addInventoryText, appendInventoryBadges, appendInventoryRowButtons, INVENTORY_RANGE_VALUE_WIDTH, inventoryRangeButtons, inventoryRangeColumns, inventoryRangeHeadings, fitInventoryText, inventoryRowLineCount, inventoryRowSpan } from '../inventory-text-layout';
import { groupRecordSheetEquipmentRows, recordSheetEquipmentDamage } from '../record-sheet-inventory-equipment';
import { drawRecordSheetInventory, groupRecordSheetWeaponRows, type InventoryWeaponStateKey } from '../record-sheet-weapon-grouping';
import { RECORD_SHEET_FONT } from '../record-sheet-typography';

import type { BaseEntity } from '../../../models/entity/base-entity';
import { type ProtoMekEntity } from '../../../models/entity/entities/protomek/protomek-entity';
import { isProtoMekEntity } from '../../../models/entity/utils/entity-type-guards';
import { intrinsicActionBaseDamageText } from '../../../models/entity/utils/mek-intrinsic-actions';
import { isJumpJetEquipment } from '../../../models/jump-equipment.model';
import { PROTOMEK_GLIDER_WING_CRITICAL_REFERENCE,protoMekCriticalReferences,protoMekTorsoCriticalResults } from '../../../models/rules/protomek-critical-rules';
import { nonMekFliesAtElevation } from '../../../models/runtime/non-mek-airborne-state';
import { systemDamageControls } from '../../../models/runtime/system-damage-presentation';
import { clusterTableForEntity } from '../../record-sheet-reference-table';
import { PaperdollGenerator, type PaperdollPipLayout } from '../paperdoll-generator';
import { appendRecordSheetAmmoProfile, markAmmoBefore, measureRecordSheetAmmoProfile } from '../record-sheet-ammo-rendering';
import { recordSheetQuirksText } from '../record-sheet-quirks';
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
formatGeometryNumber,
crewSkillValueX,
CREW_STATE_MENU_SPACE,
type Box,
addCrewSkillButton,
addCrewSkillValue,
drawCrewHitGrid,
drawElevationTracker,
addFrame,
addLine,
addText,
condenseDataPanelCaption,
fitRecordSheetTextLine,
valueXAfterCaptions,
appendBattleValue,
compactArmorDisplayName,
compactClusterRacks,
compactLocationLabel,
decoratePaperdollPips,
drawCheckbox,
drawClusterHitsReference,
drawDamageLocationGrid,
drawGeneratedFooter,
formatNumber,
paperdollPipOptions,
readViewBox,
recordSheetAmmoProfile,
recordSheetInventoryWeapons,
scaleCompactBox,
scalePageBox,
setCompactClusterRacks,
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
                : compactClusterRacks(blocks[0]);
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
        setCompactClusterRacks(svg, clusterTableForEntity(entity).clusterSizes);
        const at = (box: Box): Box => scaleCompactBox(svg, box, 139.2);
        const outer = addFrame(svg, 'PROTOMEK 1', at({ x: 0, y: 0, width: 576, height: 139.2 }), {
        // The raised notch under the identity column ends before the BV caption (x 99.667).
        bottomLeftNotchWidth: 80.8,
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    outer.setAttribute('class', `${outer.getAttribute('class') ?? ''} compact-protomek-frame`.trim());

    const identity = at({ x: 3, y: 18, width: 91, height: 68 });
    // A glider's Elevation box takes the era icon's place beside its movement points; the icon moves up beside
    // Type, Tons and Role. Both stay clear of the hit-modifier badges on the inventory's border.
    const flies = nonMekFliesAtElevation(entity);
    const eraBlock = { x: 69.5, y: flies ? 21 : 66.191, width: 20, height: 20 };
    const identityGroup = svgElement('g');
    identityGroup.setAttribute('transform', `translate(${formatNumber(identity.x)} ${formatNumber(identity.y)})`);
    identityGroup.setAttribute('data-mekbay-movement-frame-x', formatNumber(-identity.x));
    const identityScale = identity.width / 91;
    identityGroup.setAttribute('data-mekbay-movement-badge-scale', formatNumber(identityScale));
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
    const rows = identityLines.map(([label, value, field, id], index) => {
        const baseline = baselines[index] * identityScale;
        const caption = condenseDataPanelCaption(addText(identityGroup, label, (index < 4 ? 3 : 5) * identityScale, baseline, {
            size: 7.2 * identityScale, weight: 700,
        }));
        if (index === 3) caption.id = 'movementPointsLabel';
        // Every identified row keeps its value node, even empty, for the runtime to fill.
        if (!id) return null;
        const valueNode = addText(identityGroup, value, 0, baseline, { size: 7.2 * identityScale, weight: index === 0 ? 700 : 400 });
        if (field) valueNode.setAttribute('data-mekbay-field', field);
        valueNode.id = id;
        return { caption, value, valueNode, index };
    }).filter(row => row !== null);
    // Type, Tons and Role values follow their own captions; the movement points share a column after theirs.
    const movementValueX = valueXAfterCaptions(rows.filter(row => row.index > 3).map(row => row.caption));
    for (const { caption, value, valueNode, index } of rows) {
        const valueX = index > 3 ? movementValueX : valueXAfterCaptions([caption]);
        // The unit's name stops short of an era icon moved beside it.
        const rightEdge = (index === 0 && flies ? eraBlock.x - 3 - 2 : 91) * identityScale;
        valueNode.setAttribute('x', formatNumber(valueX));
        fitRecordSheetTextLine(valueNode, value, rightEdge - valueX);
    }
    // Inside its frame, whose origin is the block's.
    outer.appendChild(identityGroup);
    // Inner panels cover most of the frame's top border, so the unit controls sit on its free stretch between the
    // title tab and the inventory.
    outer.setAttribute('data-mekbay-controls-end', formatNumber(at({ x: 99, y: 0, width: 1, height: 1 }).x));

    // Inner panels keep a 3-point gutter from the block border and from each other. The
    // pilot tab tucks under the inventory, whose cut corner runs parallel to the tab's slope.
    drawCompactProtoMekInventory(svg, entity, at({ x: 97.667, y: 12.6, width: 190.86, height: PROTOMEK_INVENTORY_HEIGHT }));
    drawCompactProtoMekCriticals(svg, entity, at({ x: 291.53, y: 12.6, width: 182, height: PROTOMEK_CRITICALS_HEIGHT }));
    await drawCompactProtoMekDiagram(svg, entity,
        at({ x: 476.53, y: 12.6, width: PROTOMEK_DIAGRAM_WIDTH, height: PROTOMEK_CRITICALS_HEIGHT }), request.pipLayout);
    drawCompactProtoMekPilot(svg, at({ x: 4, y: 90, width: 284.53, height: 36 }));

    // The footer runs along the block's lower edge, right of the raised notch.
    const footerY = at({ x: 0, y: 133.5, width: 576, height: 1 }).y;
    const footerScale = readViewBox(svg).width / RECORD_SHEET_CONTENT_WIDTH;
    appendBattleValue(svg, entity.battleValue(request.ruleset), {
        x: at({ x: 99.667, y: 0, width: 1, height: 1 }).x,
        valueX: at({ x: 111.806, y: 0, width: 1, height: 1 }).x,
        y: footerY,
        size: 6.2 * footerScale,
    });
    addText(svg, 'Armor:', at({ x: 146, y: 0, width: 1, height: 1 }).x, footerY, { size: 6.2 * footerScale, weight: 700 });
    addText(svg, compactArmorDisplayName(entity.uniformArmor()?.armor.name, 'Standard'), at({ x: 167.804, y: 0, width: 1, height: 1 }).x, footerY, {
        size: 6.2 * footerScale,
        maxWidth: 108 * footerScale,
    });
    const quirks = recordSheetQuirksText(entity, request.showQuirks);
    if (quirks) {
        const group = svgElement('g');
        group.classList.add('unitQuirks');
        // The compact footer has one line, so quirks condense to it; italic like MegaMekLab's quirk block.
        addText(group, quirks, at({ x: 295, y: 0, width: 1, height: 1 }).x, footerY, {
            size: 6.084 * footerScale, maxWidth: 274 * footerScale,
        }).setAttribute('font-style', 'italic');
        svg.appendChild(group);
    }
        await appendRecordSheetEraIcon(svg, outer, entity.year(), at(eraBlock));
        const elevation = at({ x: 64.5, y: 59, width: 26, height: 18 });
        drawElevationTracker(svg, entity, elevation.x + elevation.width / 2, elevation.y,
            { width: elevation.width, height: elevation.height });
    }
}

/** Panel heights in block points; the panels share a top edge and a column-heading baseline. */
const PROTOMEK_INVENTORY_HEIGHT = 82.4;
const PROTOMEK_CRITICALS_HEIGHT = 113.4;
const PROTOMEK_DIAGRAM_WIDTH = 94;
const PROTOMEK_HEADINGS_BASELINE = 22.65;
/** The inventory's Lng box ends half its former gutter from the frame, as on the full-width sheets. */
const PROTOMEK_INVENTORY_COLUMNS = inventoryRangeColumns(3, 193.2);
const PROTOMEK_NAME_RIGHT = 75.45;

/** Every panel inside the ProtoMek block shares one compact title tab, 11 high with the frame's padding. */
const PROTOMEK_PANEL_TAB = Object.freeze({ headerFontSize: RECORD_SHEET_FONT.body, headerHeight: 6 });

function drawCompactProtoMekInventory(
    svg: SVGSVGElement,
    entity: ProtoMekEntity,
    box: Box,
): void {
    // Panels inside the unit block are nested: a thin border without its own shadow.
    const group = addFrame(svg, 'WEAPONS INVENTORY', box, {
        variant: 'nested',
        fullWidthHeader: true,
        ...PROTOMEK_PANEL_TAB,
        cornerAngleDegrees: { topLeft: 45, topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    // The small ProtoMek inventory always counts identical weapons, as MegaMekLab does; states still split them
    drawRecordSheetInventory(group, true, (parent, stateKey) =>
        drawCompactProtoMekInventoryRows(parent, entity, box, stateKey));
}

function drawCompactProtoMekInventoryRows(
    group: SVGGElement,
    entity: ProtoMekEntity,
    box: Box,
    stateKey: InventoryWeaponStateKey | null,
): void {
    // Keep the authored columns inside the frame's right border and padding.
    const sx = (box.width - 6) / 191.95;
    const sy = box.height / PROTOMEK_INVENTORY_HEIGHT;
    const fontScale = box.width / 191.95;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;

    const weapons = recordSheetInventoryWeapons(entity);
    const weaponComponentIds = new Set(weapons.flatMap(row => row.componentIds));
    const miscRows: { name: string; location: string; damage: string; componentIds: readonly string[] }[] = [];
    entity.equipment().forEach(mount => {
        const equipment = mount.equipment;
        if (!equipment) return;
        if (weaponComponentIds.has(mount.mountId)
            || mount.getAmmoShots() !== undefined
            || isJumpJetEquipment(equipment)
            || equipment.type === 'armor'
            || equipment.hasFlag('INTERNAL_REPRESENTATION')) return;
        const location = compactLocationLabel(mount.getOccupiedLocations().join('/') || mount.location || '—');
        const damage = recordSheetEquipmentDamage(mount);
        miscRows.push({ name: mount.displayName(), location, damage, componentIds: [mount.mountId] });
    });
    const weaponRows = weapons.map(row => ({ ...row, location: compactLocationLabel(row.location), quantity: 1 }));
    const regularRows = [
        ...(stateKey === null ? weaponRows : groupRecordSheetWeaponRows(weaponRows, stateKey)),
        ...groupRecordSheetEquipmentRows(miscRows, row => `${row.name}\u0000${row.location}\u0000${row.damage}`).map(row => ({
            ...row,
            // Beside counted weapons, equipment prints its count only when it stands for several.
            quantity: stateKey !== null && row.quantity === 1 ? undefined : row.quantity,
            heat: '—',
            minimumRange: '—',
            ranges: Object.freeze(['—', '—', '—']),
            linkedEquipment: Object.freeze([]),
            alternativeModes: Object.freeze([]),
        })),
    ];
    // The quantity column appears only when weapons or equipment are grouped; names otherwise start where the Mek and vehicle names do.
    const showQuantity = stateKey !== null || regularRows.some(row => (row.quantity ?? 1) > 1);
    const nameX = showQuantity ? 11.45 : 8.41;
    const nameWidth = PROTOMEK_NAME_RIGHT - nameX;
    const headings: readonly (readonly [string, number, 'start' | 'middle'])[] = [
        ...(showQuantity ? [['#', 6.725, 'middle'] as const] : []),
        ['Type', nameX, 'start'], ['Loc', 87.05, 'middle'], ['Dmg', 96.5, 'start'],
        ...inventoryRangeHeadings(PROTOMEK_INVENTORY_COLUMNS),
    ];
    // Headings keep their natural width; a fitted width would stretch the short ones.
    headings.forEach(([label, position, anchor]) => addText(group, label, x(position), y(PROTOMEK_HEADINGS_BASELINE), {
        size: font(RECORD_SHEET_FONT.inventory), weight: 700, anchor,
    }));
    const rangePositions = PROTOMEK_INVENTORY_COLUMNS.ranges;
    const rangeClasses = ['range_min', 'range_short', 'range_medium', 'range_long'] as const;
    const damageWidth = PROTOMEK_INVENTORY_COLUMNS.bandRight - 96.5;
    // A row's lines, its name measured at the width it is drawn in
    const rowLines = (row: { name: string; location: string; damage: string; minimumRange: string; ranges: readonly string[] },
        size: number, width: number) =>
        inventoryRowLineCount([[row.name, x(width)], [row.location, x(16)], [row.damage, x(damageWidth)],
            [row.minimumRange, x(INVENTORY_RANGE_VALUE_WIDTH)],
            ...row.ranges.map(value => [value, x(INVENTORY_RANGE_VALUE_WIDTH)] as const)], font(size));
    // Weapon rows fill from one line under the headings down to the intrinsic attacks and the ammunition, which sit
    // along the panel bottom; all print at the fitted row size, so the ammunition's lines count in the fit. The
    // intrinsic attacks are authored as if there were no ammunition and rise above its lines as it prints.
    const physical = entity.intrinsicWeapons();
    const ammo = recordSheetAmmoProfile(entity);
    const ammoWidth = box.width - x(13.45);
    const ammoBaseline = PROTOMEK_INVENTORY_HEIGHT - 5.428;
    // A weapon's enhancement lines, then its ammo lines (Fusillade, ATM), each under the weapon as on the other sheets
    const subRowsOf = (row: typeof regularRows[number]) => [
        ...row.linkedEquipment.map(linked => ({
            kind: 'linked' as const, name: linked.name, location: '', damage: linked.damage, minimumRange: '',
            ranges: Object.freeze(['', '', '']), componentIds: linked.componentIds,
        })),
        ...row.alternativeModes.map(mode => ({
            kind: 'mode' as const, name: mode.name, location: '', damage: mode.damage, minimumRange: mode.minimumRange,
            ranges: mode.ranges, componentIds: Object.freeze([]) as readonly string[],
        })),
    ];
    const subRowX = nameX + 4.328;
    const subNameWidth = nameWidth - (subRowX - nameX);
    const metrics = fitInventoryText(ammoBaseline - PROTOMEK_HEADINGS_BASELINE - 1, fontSize => {
        // Each drawn row, sub-rows included, takes at least a badge's height, as appendRow spaces them.
        const lines = regularRows.flatMap(row => [rowLines(row, fontSize, nameWidth),
            ...subRowsOf(row).map(sub => rowLines(sub, fontSize, subNameWidth))]);
        const ammoLines = measureRecordSheetAmmoProfile(ammo, { width: ammoWidth, fontSize: font(fontSize) }).lines.length;
        return {
            lineCount: lines.reduce((sum, count) => sum + count, 0) + physical.length + ammoLines,
            badgeRows: lines,
            content: undefined,
        };
    });
    const lineStep = metrics.lineStep;
    const firstRowBaseline = PROTOMEK_HEADINGS_BASELINE + 1 + lineStep;
    const physicalBaseline = ammoBaseline;
    const inventoryFont = font(metrics.fontSize);
    const addCell = (parent: SVGElement, value: string, x: number, yPos: number, options: Parameters<typeof addText>[4] = {}) =>
        addInventoryText(parent, value, x, yPos, { ...options, size: inventoryFont, lineHeight: y(lineStep) });
    const inventory = svgElement('g');
    group.appendChild(inventory);
    const physicalRows = svgElement('g');
    markAmmoBefore(physicalRows);
    group.appendChild(physicalRows);

    const appendRow = (
        data: typeof regularRows[number] | Readonly<{
            name: string;
            location: string;
            damage: string;
            minimumRange: string;
            ranges: readonly string[];
            componentIds: readonly string[];
            quantity?: number;
        }>,
        baselineValue: number,
        index: string,
        parent = inventory,
    ): number => {
        const lineCount = rowLines(data, metrics.fontSize, nameWidth);
        const entry = svgElement('g');
        entry.setAttribute('class', 'inventoryEntry');
        entry.setAttribute('id', `generated-protomek-inventory-row@${index}`);
        setInventoryComponentIds(entry, data.componentIds);
        const baseline = y(baselineValue);
        // Compact blocks compress vertically; badges take the smaller scale so they fit their rows.
        const badgeScale = Math.min(fontScale, sy);
        const buttons = inventoryRangeButtons(PROTOMEK_INVENTORY_COLUMNS, x);
        appendInventoryRowButtons(entry, baseline, badgeScale, y(lineStep), lineCount, buttons.band, buttons.ranges);
        appendInventoryBadges(entry, baseline, badgeScale, y(lineStep));
        if (showQuantity && data.quantity !== undefined) {
            addCell(entry, String(data.quantity), x(6.725), baseline, {
                class: 'quantity', size: font(RECORD_SHEET_FONT.inventory), anchor: 'middle',
            });
        }
        addCell(entry, data.name, x(nameX), baseline, { class: 'name', maxWidth: x(nameWidth) });
        addCell(entry, data.location, x(87.05), baseline, {
            class: 'location', size: font(RECORD_SHEET_FONT.inventory), anchor: 'middle', maxWidth: x(16),
        });
        const damage = svgElement('g');
        damage.setAttribute('class', 'damage');
        addCell(damage, data.damage, x(96.5), baseline, { size: font(RECORD_SHEET_FONT.inventory), maxWidth: x(damageWidth) });
        entry.appendChild(damage);
        const values = [data.minimumRange, ...data.ranges];
        values.forEach((value, rangeIndex) => addCell(entry, value, x(rangePositions[rangeIndex]), baseline, {
            class: rangeClasses[rangeIndex], size: font(RECORD_SHEET_FONT.inventory), anchor: 'middle',
            maxWidth: x(INVENTORY_RANGE_VALUE_WIDTH),
        }));
        let span = inventoryRowSpan(lineCount, lineStep, metrics.badgeHeight);
        for (const sub of 'linkedEquipment' in data ? subRowsOf(data) : []) {
            const subBaseline = y(baselineValue + span * lineStep);
            const subLines = rowLines(sub, metrics.fontSize, subNameWidth);
            const line = svgElement('g');
            if (sub.kind === 'linked') {
                line.setAttribute('class', 'inventoryEntry linked');
                setInventoryComponentIds(line, sub.componentIds);
                appendInventoryRowButtons(line, subBaseline, badgeScale, y(lineStep), subLines, buttons.band);
            } else {
                line.setAttribute('class', 'alternativeMode');
                line.setAttribute('data-mekbay-mode', sub.name);
                appendInventoryRowButtons(line, subBaseline, badgeScale, y(lineStep), subLines, buttons.band, buttons.ranges,
                    'alternativeModeButton');
            }
            addCell(line, sub.name, x(subRowX), subBaseline, { class: 'name', maxWidth: x(subNameWidth) });
            const subDamage = svgElement('g');
            subDamage.setAttribute('class', 'damage');
            addCell(subDamage, sub.damage, x(96.5), subBaseline, { size: font(RECORD_SHEET_FONT.inventory), maxWidth: x(damageWidth) });
            line.appendChild(subDamage);
            [sub.minimumRange, ...sub.ranges].forEach((value, rangeIndex) => addCell(line, value,
                x(rangePositions[rangeIndex]), subBaseline, {
                    class: rangeClasses[rangeIndex], size: font(RECORD_SHEET_FONT.inventory), anchor: 'middle',
                    maxWidth: x(INVENTORY_RANGE_VALUE_WIDTH),
                }));
            entry.appendChild(line);
            span += inventoryRowSpan(subLines, lineStep, metrics.badgeHeight);
        }
        parent.appendChild(entry);
        return span;
    };

    let displayLine = 0;
    regularRows.forEach((row, index) => {
        displayLine += appendRow(row, firstRowBaseline + displayLine * lineStep, String(index));
    });
    physical.forEach((attack, index) => appendRow({
        name: attack.name,
        location: '—',
        damage: intrinsicActionBaseDamageText(attack),
        minimumRange: '—',
        ranges: Object.freeze(['—', '—', '—']),
        componentIds: Object.freeze([]),
    }, physicalBaseline - (physical.length - index - 1) * lineStep, `physical-${index}`, physicalRows));
    appendRecordSheetAmmoProfile(group, ammo, {
        x: x(6.725), y: y(ammoBaseline), width: ammoWidth, fontSize: inventoryFont, lineHeight: y(lineStep),
    });
}

function drawCompactProtoMekCriticals(
    svg: SVGSVGElement,
    entity: ProtoMekEntity,
    box: Box,
): void {
    const group = addFrame(svg, 'HIT LOCATIONS AND CRITICAL HITS', box, {
        variant: 'nested',
        fullWidthHeader: true,
        ...PROTOMEK_PANEL_TAB,
        cornerAngleDegrees: { topLeft: 45, topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    const sx = box.width / 183.833;
    const sy = box.height / PROTOMEK_CRITICALS_HEIGHT;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const headings: readonly [string, number, 'start' | 'middle'][] = [
        ['2D6', 13.88, 'middle'], ['LOCATION', 24.76, 'start'], ['1st HIT', 57.4, 'start'],
        ['2nd HIT', 102.733, 'start'], ['3rd HIT', 148.067, 'start'],
    ];
    headings.forEach(([label, position, anchor]) => addText(group, label, x(position), y(PROTOMEK_HEADINGS_BASELINE), {
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
    // A roll list too long for one line takes a second line, pushing the following rows down.
    let rollShift = 0;
    const rows = protoMekCriticalReferences(entity).map(row => {
        const rolls = row.rolls.length > 3
            ? [row.rolls.slice(0, 2).join(','), row.rolls.slice(2).join(',')]
            : [row.rolls.join(',')];
        const baseline = baselines[row.system as keyof typeof baselines]! + rollShift;
        rollShift += (rolls.length - 1) * 7;
        return { ...row, rolls, baseline };
    }).map(row => ({
        ...row,
        effects: row.effects.map((effect, index) => {
            // "Proto Destroyed" sits raised and tight, clear of the left arm row's effect running beneath it.
            const protoDestroyed = row.system === 'torso' && index === 2;
            return {
                id: systemDamageControls(entity, row.system).ids[index],
                text: effect.text,
                baseline: row.baseline - (protoDestroyed ? 1.6 : 0),
                secondLine: effect.detail,
                secondLineBaseline: row.baseline + (protoDestroyed ? 3.4 : 7),
                fill: row.system === 'torso' ? index === 2 ? '#000' : '#c7c7c7'
                    : index === row.effects.length - 1 && index > 0 ? '#c7c7c7' : undefined,
            };
        }),
    }));
    const controlXs = [57.4, 102.733, 148.067] as const;
    const textXs = [65.8, 111.133, 156.467] as const;
    // Each effect ends before the row's next box; the row's last one runs over empty columns to the inner border.
    const effectWidth = (effectIndex: number, effectCount: number): number => effectIndex < effectCount - 1
        ? x(controlXs[effectIndex + 1]) - x(textXs[effectIndex]) - 1.5
        : box.width - 3 - x(textXs[effectIndex]);
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
            const maxWidth = effectWidth(effectIndex, row.effects.length);
            addText(group, effect.text, x(textXs[effectIndex]), y(effect.baseline), {
                size: font(5.7), weight: 700, maxWidth,
            });
            if (effect.secondLine) addText(group, effect.secondLine, x(textXs[effectIndex]), y(effect.secondLineBaseline), {
                size: font(5.7), weight: 700, maxWidth,
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
    const headingWidth = 83.991;
    const heading = SvgFrameUtil.createSVGFrameHeader('ARMOR DIAGRAM', headingWidth, {
        headerWidth: headingWidth,
        ...PROTOMEK_PANEL_TAB,
        cornerAngleDegrees: 45,
    });
    heading.setAttribute('class', 'diagram-heading');
    heading.setAttribute('transform', `translate(${formatNumber((box.width - headingWidth) / 2)} 0)`);
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
                // The assets are authored in the reference diagram's coordinates, below its heading.
                preserveAuthoredCoordinates: true,
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
        decoratePaperdollPips(paperdoll);
        // Fit the authored artwork into the panel below its tab, centred.
        const art = {
            x: Number(paperdoll.dataset['artX']), y: Number(paperdoll.dataset['artY']),
            width: Number(paperdoll.dataset['artWidth']), height: Number(paperdoll.dataset['artHeight']),
        };
        // Two points below the tab, which the frame pads by 2.5 above and below.
        const top = PROTOMEK_PANEL_TAB.headerHeight + 5 + 2;
        // Authored panel size, so the art keeps its physical size on every page format.
        const scale = Math.min(1, (PROTOMEK_CRITICALS_HEIGHT - top) / art.height, PROTOMEK_DIAGRAM_WIDTH / art.width);
        paperdoll.setAttribute('transform', `translate(${formatNumber(box.width / 2 - scale * (art.x + art.width / 2))} `
            + `${formatNumber(top - scale * art.y)}) scale(${formatGeometryNumber(scale)})`);
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
    drawDamageLocationGrid(group, entity.damageLocations(), { x: 4, y: 20, width: width - 8, height: height - 22 }, 2, 14);
}

function drawCompactProtoMekPilot(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'PILOT DATA', box, {
        variant: 'nested',
        ...PROTOMEK_PANEL_TAB,
        cornerAngleDegrees: { topLeft: 45, topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    const sx = box.width / 287.5;
    const sy = box.height / 36.009;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    // The name line leaves the crew-state menu room before the hit track.
    const nameEnd = x(135.428) - CREW_STATE_MENU_SPACE;
    const nameButton = transparentRect(x(7), y(13), nameEnd - x(7), y(10), 'crewNameButton');
    nameButton.setAttribute('crewId', '0');
    nameButton.setAttribute('textElement', 'crewName0');
    group.appendChild(nameButton);
    addText(group, 'Name:', x(9.845), y(21.668), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
    const name = addText(group, '', x(32.073), y(21.668), { size: font(RECORD_SHEET_FONT.inventory), maxWidth: nameEnd - x(32.073) });
    name.id = 'crewName0';
    addLine(group, x(32.073), y(22.668), nameEnd, y(22.668), '#111', 0.72 * fontScale);
    const gunneryLabel = addText(group, 'Gunnery Skill:', x(9.845), y(30.941), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
    const skill = addCrewSkillValue(group, '4', crewSkillValueX(gunneryLabel, fontScale), gunneryLabel, fontScale);
    skill.id = 'gunnerySkill0';
    addCrewSkillButton(group, skill, 0, 'gunnery');
    // The wound track sits near the right border, centred between the top border and the bottom.
    const cellWidth = x(87.05 / 6);
    const cellHeight = y(9);
    const gridX = box.width - 9 - 6 * cellWidth;
    drawCrewHitGrid(group, 0, {
        x: gridX, y: (Number(group.dataset['mekbayFrameTop']) + box.height) / 2 - cellHeight, cellWidth, cellHeight,
        labelX: gridX - x(42.47), labelWidth: x(40.47), fontScale,
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
