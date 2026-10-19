// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { addInventoryText, appendInventoryBadges, appendInventoryRowButtons, INVENTORY_RANGE_VALUE_WIDTH, inventoryRangeButtons, inventoryRangeColumns, inventoryRangeHeadings, fitInventoryText, inventoryRowLineCount, inventoryRowSpan } from '../inventory-text-layout';
import { groupRecordSheetEquipmentRows } from '../record-sheet-inventory-equipment';
import { RECORD_SHEET_FONT } from '../record-sheet-typography';

import type { BaseEntity } from '../../../models/entity/base-entity';
import type { BattleArmorEntity } from '../../../models/entity/entities/infantry/battle-armor-entity';
import { isBattleArmorEntity } from '../../../models/entity/utils/entity-type-guards';
import { BattleArmorBVCalculator } from '../../../models/entity/utils/battle-value';
import { adjustEntityBattleValueForSkills, effectiveEntityPilotingSkill } from '../../../models/entity/utils/battle-value/skill-facts';
import { isAntiPersonnelMountEquipment } from '../../../models/battle-armor-equipment.model';
import { hasStealthFlag } from '../../../models/stealth-equipment.model';
import { isJumpJetEquipment, isUmuEquipment } from '../../../models/jump-equipment.model';
import { appendRecordSheetAmmoProfile, markAmmoInventory } from '../record-sheet-ammo-rendering';
import type { RecordSheetPageProfile } from '../record-sheet-layout';
import {
    crewSkillValueX,
    type Box,
    addCrewSkillValue,
    addFrame,
    addReferenceShade,
    addText,
    appendBattleValue,
    appendLegacyIdentityAnchors,
    compactArmorDisplayName,
    compactClusterRacks,
    drawCheckbox,
    drawClusterHitsReference,
    drawGeneratedFooter,
    formatNumber,
    formatWholeNumber,
    recordSheetAmmoProfile,
    recordSheetInventoryWeapons,
    scaleCompactBox,
    scalePageBox,
    setAttributes,
    setCompactClusterRacks,
    setInventoryComponentIds,
    svgElement,
} from '../record-sheet-svg-rendering';
import {
    BATTLE_ARMOR_DEFAULT_ART,
    appendEmbeddedSvgDefinition,
    appendMastheadArt,
    appendEmbeddedRasterUse,
    appendRecordSheetEraIcon,
} from '../record-sheet-embedded-art';
import { CompactRecordSheetLayout, type RecordSheetLayoutRequest } from './record-sheet-layout';
import {
    canonicalReferenceContent,
} from './record-sheet-reference-table-components';

const MASTHEAD_ART_ID = 'mekbay-battle-armor-masthead-art';
/** Inventory names start where the Mek and vehicle names do (only bays print a quantity) and keep their right edge. */
const BA_NAME_RIGHT = 91.1;

export class BattleArmorRecordSheetLayout extends CompactRecordSheetLayout {
    public constructor() {
        super(
            'battle-armor',
            'battle-armor',
            'BATTLE ARMOR RECORD SHEET',
            page => page.format === 'a4'
                ? { height: 146.2, stride: 147.428 }
                : { height: 136.2, stride: 137.129 },
        );
    }

    public matches(entity: BaseEntity): boolean {
        return isBattleArmorEntity(entity);
    }

    protected override compactMastheadTitleLines(): readonly string[] {
        return ['BATTLE ARMOR', 'RECORD SHEET'];
    }

    protected override drawCompactMastheadIcon(
        parent: SVGGElement,
        box: Box,
    ): void {
        appendMastheadArt(parent, box, MASTHEAD_ART_ID, 'battle-armor-masthead-icon');
    }

    public override drawCompactPageSupplement(
        page: SVGSVGElement,
        profile: RecordSheetPageProfile,
        blocks: readonly SVGSVGElement[],
        entity?: BaseEntity,
    ): void {
        page.setAttribute('data-mekbay-reference-family', 'battle-armor');
        if (blocks.length === 1) {
            const recorded = compactClusterRacks(blocks[0]);
            const racks = entity !== undefined && isBattleArmorEntity(entity)
                ? battleArmorClusterRacks(entity)
                : recorded.length > 0 ? recorded : [2, 3, 4, 5];
            drawClusterHitsReference(page, scalePageBox(profile, {
                x: 18.9, y: 221.486, width: 382.1, height: 180,
            }), racks);
        }
        drawBattleArmorReferenceTables(page, profile);
        const catalyst = scalePageBox(profile, { x: 541.535, y: 698.166, width: 0, height: 0 });
        drawGeneratedFooter(page, profile, {
            catalystX: catalyst.x,
            catalystY: catalyst.y,
            catalystScale: 0.898 * profile.horizontalScale,
        });
    }

    protected async drawCompact(svg: SVGSVGElement, entity: BaseEntity, request: RecordSheetLayoutRequest): Promise<void> {
        if (!isBattleArmorEntity(entity)) throw new Error('Battle Armor layout requires a Battle Armor entity');
        await appendEmbeddedSvgDefinition(svg, '/images/record-sheet-art/battle-armor.svg', MASTHEAD_ART_ID);
        setCompactClusterRacks(svg, battleArmorClusterRacks(entity));
        const at = (box: Box): Box => scaleCompactBox(svg, box, 136.2);
        const frameBox = at({ x: 0, y: 0, width: 384, height: 136.2 });
        const formation = ({ 1: 'SUIT', 3: 'UN', 5: 'POINT', 6: 'LEVEL I' } as Record<number, string>)[entity.trooperCount()] ?? 'SQUAD';
        svg.setAttribute('data-mekbay-numbered-title-prefix', `BATTLE ARMOR: ${formation} `);
        const group = addFrame(svg, `BATTLE ARMOR: ${formation} 1`, frameBox, {
        bottomLeftNotchWidth: 145,
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45 },
    });
    group.setAttribute('class', `${group.getAttribute('class') ?? ''} compact-battle-armor-frame`.trim());
    const sx = frameBox.width / 384;
    const sy = frameBox.height / 136.2;
    const fontScale = frameBox.width / 384;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;

    addText(group, 'Type:', x(3.97), y(27.8), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
    const type = addText(group, entity.displayName(), x(22.3), y(27.8), {
        size: font(RECORD_SHEET_FONT.inventory), weight: 700, maxWidth: x(162),
    });
    type.id = 'type';
    type.setAttribute('data-mekbay-field', 'display-name');
    const gunneryLabel = addText(group, 'Gunnery Skill:', x(6.966), y(37.966), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
    const gunnery = addCrewSkillValue(group, '4', crewSkillValueX(gunneryLabel, fontScale), gunneryLabel, fontScale);
    gunnery.id = 'gunnerySkill0';
    const antiMekLabel = addText(group, "Anti-'Mech Skill:", x(99.466), y(37.966), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
    const piloting = addCrewSkillValue(group, String(effectiveEntityPilotingSkill(entity, 5)), crewSkillValueX(antiMekLabel, fontScale), antiMekLabel, fontScale);
    piloting.id = 'pilotingSkill0';
    addText(group, 'Ground MP:', x(6.966), y(45.966), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
    const walk = addText(group, String(entity.walkMP()), x(45.03), y(45.966), { size: font(RECORD_SHEET_FONT.inventory) });
    walk.id = 'mpWalk';
    const secondaryMovement = compactBattleArmorSecondaryMovement(entity);
    // The runtime "Stationary" mode follows the movement columns, clear of their modifier badges.
    addText(group, '', x(150), y(45.966), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 }).id = 'movementPointsLabel';
    if (secondaryMovement !== undefined) {
        addText(group, secondaryMovement.label, x(99.466), y(45.966), {
            size: font(RECORD_SHEET_FONT.inventory), weight: 700,
        });
        const jump = addText(group, String(secondaryMovement.value), x(132.313), y(45.966), {
            size: font(RECORD_SHEET_FONT.inventory),
        });
        jump.id = 'mpJump';
    }

    drawCompactBattleArmorInventory(group, entity, { x, y, font });
    drawCompactBattleArmorTroopers(svg, group, entity, { x, y, font }, frameBox);

    const flags: readonly [string, boolean, number, number][] = [
        ['Mechanized:', entity.mechanizedCapable(), 6.966, 46.563],
        ['Swarm:', entity.swarmAttackCapable(), 71.716, 97.239],
        ['Leg:', entity.legAttackCapable(), 123.516, 138.694],
        ['AP:', entity.equipment().some(mount => isAntiPersonnelMountEquipment(mount.equipment)), 162.366, 175.586],
    ];
    flags.forEach(([label, checked, labelX, checkboxX]) => {
        addText(group, label, x(labelX), y(115.952), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
        const capability = svgElement('g');
        capability.setAttribute('class', 'battle-armor-capability');
        capability.setAttribute('data-capability', label.slice(0, -1).toLowerCase());
        drawCheckbox(capability, x(checkboxX), y(109.552), x(8), checked);
        group.appendChild(capability);
    });
    addText(group, 'Armor:', x(158.966), y(129.166), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
    addText(group, compactArmorDisplayName(entity.uniformArmor()?.armor.name, 'Standard'), x(182.752), y(129.166), {
        size: font(RECORD_SHEET_FONT.inventory), maxWidth: x(68),
    });
    addText(group, 'Role:', x(255), y(129.166), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
    addText(group, entity.role() || '—', x(272.5), y(129.166), { size: font(RECORD_SHEET_FONT.inventory), maxWidth: x(55) });
    appendBattleValue(group, adjustEntityBattleValueForSkills(entity, entity.battleValue(request.ruleset), 4, 5), {
        x: x(332.966), valueX: x(346.209), y: y(129.166), size: font(RECORD_SHEET_FONT.inventory), maxWidth: x(31),
    }, `/${formatWholeNumber(new BattleArmorBVCalculator(entity).singleTrooperBattleValue())}`);
        await appendRecordSheetEraIcon(svg, group, entity.year(), {
            x: x(165.966), y: y(11.752), width: x(20), height: y(20),
        });
        appendLegacyIdentityAnchors(group, entity, frameBox, request.ruleset);
    }
}

function compactBattleArmorSecondaryMovement(
    entity: BattleArmorEntity,
): Readonly<{ label: string; value: number }> | undefined {
    switch (entity.motiveType()) {
        case 'Jump': return { label: 'Jump MP:', value: entity.jumpMP() };
        case 'VTOL': return { label: 'VTOL MP:', value: entity.jumpMP() };
        case 'UMU': return { label: 'UW MP:', value: entity.umuMP() };
        default: return undefined;
    }
}

function battleArmorClusterRacks(entity: BattleArmorEntity): readonly number[] {
    const troopers = Math.max(1, entity.trooperCount());
    const racks = new Set<number>();
    for (let count = 2; count <= troopers; count++) racks.add(count);
    for (const mount of entity.rangedWeapons()) {
        const rackSize = Math.max(0, mount.equipment.rackSize);
        if (rackSize < 2) continue;
        for (let count = 1; count <= troopers; count++) {
            racks.add(Math.min(40, rackSize * count));
        }
    }
    return [...racks].sort((left, right) => left - right);
}

function drawBattleArmorReferenceTables(page: SVGSVGElement, profile: RecordSheetPageProfile): void {
    drawBattleArmorLegAttacks(page, scalePageBox(profile, {
        x: 405, y: 74.357, width: 184, height: 81.524,
    }));
    drawBattleArmorSwarmAttacks(page, scalePageBox(profile, {
        x: 405, y: 163.881, width: 184, height: 67.751,
    }));
    drawBattleArmorSwarmModifiers(page, scalePageBox(profile, {
        x: 405, y: 239.631, width: 184, height: 198.593,
    }));
    drawBattleArmorHitLocations(page, scalePageBox(profile, {
        x: 405, y: 446.224, width: 184, height: 143.501,
    }));
    drawBattleArmorTransportPositions(page, scalePageBox(profile, {
        x: 405, y: 597.726, width: 184, height: 157.274,
    }));
}

function drawBattleArmorLegAttacks(svg: SVGSVGElement, box: Box): void {
    const content = battleArmorReferenceContent(svg, 'LEG ATTACKS TABLE', box, 81.524);
    addReferenceShade(content, 4, 38.5, 175, 9);
    addReferenceShade(content, 4, 56.5, 175, 9);
    addBaText(content, 'BATTLE ARMOR', 54.3, 27.075, true);
    addBaText(content, 'BASE TO-HIT', 135.75, 27.075, true);
    addBaText(content, 'TROOPERS ACTIVE', 54.3, 36.15, true);
    addBaText(content, 'MODIFIER', 135.75, 36.15, true);
    const rows: readonly [string, string][] = [['4-6', '0'], ['3', '+2'], ['2', '+5'], ['1', '+7']];
    rows.forEach(([troopers, modifier], index) => {
        const y = 45.225 + index * 9.075;
        addBaText(content, troopers, 54.3, y, true);
        addBaText(content, modifier, 135.75, y);
    });
}

function drawBattleArmorSwarmAttacks(svg: SVGSVGElement, box: Box): void {
    const content = battleArmorReferenceContent(svg, 'SWARM ATTACKS TABLE', box, 67.751);
    addBaText(content, 'BATTLE ARMOR', 54.3, 27.95, true);
    addBaText(content, 'BASE TO-HIT', 135.75, 27.95, true);
    addBaText(content, 'TROOPERS ACTIVE', 54.3, 37.9, true);
    addBaText(content, 'MODIFIER', 135.75, 37.9, true);
    [['4-6', '+2'], ['1-3', '+5']].forEach(([troopers, modifier], index) => {
        const y = 47.85 + index * 9.95;
        addBaText(content, troopers, 54.3, y, true);
        addBaText(content, modifier, 135.75, y);
    });
}

function drawBattleArmorSwarmModifiers(svg: SVGSVGElement, box: Box): void {
    const content = battleArmorReferenceContent(svg, 'SWARM ATTACK MODIFIERS TABLE', box, 198.593);
    for (const y of [58.5, 77.5, 96.5]) addReferenceShade(content, 4, y, 175, 9.5);
    addBaText(content, 'ATTACKING ENEMY', 36.2, 27.505, true);
    addBaText(content, 'FRIENDLY MECHANIZED BATTLE', 124.89, 27.505, true);
    addBaText(content, 'BATTLE ARMOR', 36.2, 37.01, true);
    addBaText(content, 'ARMOR TROOPERS ACTIVE', 124.89, 37.01, true);
    addBaText(content, 'TROOPERS ACTIVE', 36.2, 46.515, true);
    const columnXs = [79.64, 97.74, 115.84, 133.94, 152.04, 170.14];
    columnXs.forEach((x, index) => addBaText(content, String(index + 1), x, 46.515, true));
    const values: readonly (readonly string[])[] = [
        ['+0', '+0', '+0', '+0', '+1', '+2'],
        ['+0', '+0', '+0', '+1', '+2', '+3'],
        ['+0', '+0', '+1', '+2', '+3', '+4'],
        ['+0', '+1', '+2', '+3', '+4', '+5'],
        ['+1', '+2', '+3', '+4', '+5', '+6'],
        ['+2', '+3', '+4', '+5', '+6', '+7'],
    ];
    values.forEach((row, rowIndex) => {
        const y = 56.02 + rowIndex * 9.505;
        addBaText(content, String(6 - rowIndex), 36.2, y, true);
        row.forEach((value, columnIndex) => addBaText(content, value, columnXs[columnIndex], y));
    });
    addBaText(content, 'BATTLE ARMOR EQUIPMENT', 7.24, 122.554, true, 'start');
    addBaText(content, 'Claws with magnets', 7.24, 132.059, false, 'start');
    addBaText(content, '-1', 133.94, 132.059);
    addBaText(content, 'SITUATION*', 7.24, 151.068, true, 'start');
    const situations: readonly [string, string][] = [
        ["'Mech prone", '-2'],
        ["'Mech or vehicle immobile", '-4'],
        ['Vehicle', '-2'],
    ];
    situations.forEach(([label, modifier], index) => {
        const y = 160.573 + index * 9.505;
        addBaText(content, label, 7.24, y, true, 'start');
        addBaText(content, modifier, 133.94, y);
    });
    addBaText(content, '*Modifiers are cumulative', 7.24, 189.088, false, 'start');
}

function drawBattleArmorHitLocations(svg: SVGSVGElement, box: Box): void {
    const content = battleArmorReferenceContent(svg, 'SWARM ATTACKS HIT LOCATION TABLE', box, 143.501);
    for (const y of [47, 65, 83, 101, 119]) addReferenceShade(content, 4, y, 175, 9);
    addBaText(content, '2D6', 14.48, 26.964, true);
    addBaText(content, 'BIPEDAL/TRIPOD', 72.4, 26.964, true);
    addBaText(content, 'QUAD', 144.8, 26.964, true);
    addBaText(content, 'ROLL', 14.48, 35.929, true);
    addBaText(content, 'LOCATION', 72.4, 35.929, true);
    addBaText(content, 'LOCATION', 144.8, 35.929, true);
    const rows: readonly [string, string, string][] = [
        ['2', 'Head', 'Head'],
        ['3', 'Rear Center Torso', 'Front Right Torso'],
        ['4', 'Rear Right Torso', 'Rear Center Torso'],
        ['5', 'Front Right Torso', 'Rear Right Torso'],
        ['6', 'Right Arm', 'Front Right Torso'],
        ['7', 'Front Center Torso', 'Front Center Torso'],
        ['8', 'Left Arm', 'Front Left Torso'],
        ['9', 'Front Left Torso', 'Rear Left Torso'],
        ['10', 'Rear Left Torso', 'Rear Center Torso'],
        ['11', 'Rear Center Torso', 'Front Left Torso'],
        ['12', 'Head', 'Head'],
    ];
    rows.forEach(([roll, biped, quad], index) => {
        const y = 44.893 + index * 8.964;
        addBaText(content, roll, 14.48, y, true);
        addBaText(content, biped, 72.4, y);
        addBaText(content, quad, 144.8, y);
    });
}

function drawBattleArmorTransportPositions(svg: SVGSVGElement, box: Box): void {
    const content = battleArmorReferenceContent(svg, 'TRANSPORT POSITIONS TABLE', box, 157.274);
    for (const y of [40.274, 54.274, 68.274]) addReferenceShade(content, 4, y, 175, 7);
    for (const y of [102.774, 116.774, 130.774]) addReferenceShade(content, 4, y, 120, 7);
    addBaText(content, 'TROOPER', 21.72, 24.964, true);
    addBaText(content, "'MECH", 81.45, 24.964, true);
    addBaText(content, 'VEHICLE', 155.66, 24.964, true);
    addBaText(content, 'NUMBER', 21.72, 31.927, true);
    addBaText(content, 'LOCATION', 81.45, 31.927, true);
    addBaText(content, 'LOCATION', 155.66, 31.927, true);
    const mekLocations: readonly [string, string][] = [
        ['Right Torso', 'Right Side'], ['Left Torso', 'Right Side'],
        ['Right Torso (rear)', 'Left Side'], ['Left Torso (rear)', 'Left Side'],
        ['Center Torso (rear)', 'Rear'], ['Center Torso', 'Rear'],
    ];
    mekLocations.forEach(([mek, vehicle], index) => {
        const y = 38.891 + index * 6.964;
        addBaText(content, String(index + 1), 21.72, y, true);
        addBaText(content, mek, 81.45, y);
        addBaText(content, vehicle, 155.66, y);
    });
    addBaText(content, 'TROOPER', 21.72, 87.637, true);
    addBaText(content, 'LARGE SUPPORT', 81.45, 87.637, true);
    addBaText(content, 'NUMBER', 21.72, 94.601, true);
    addBaText(content, 'VEHICLE LOCATION*', 81.45, 94.601, true);
    const supportLocations = [
        'Right Side (Unit 1/Unit 2)', 'Right Side (Unit 1/Unit 2)',
        'Left Side (Unit 1/Unit 2)', 'Left Side (Unit 1/Unit 2)',
        'Rear (Unit 1/Unit 2)', 'Rear (Unit 1/Unit 2)',
    ];
    supportLocations.forEach((location, index) => {
        const y = 101.565 + index * 6.964;
        addBaText(content, String(index + 1), 21.72, y, true);
        addBaText(content, location, 81.45, y);
    });
    addBaText(content, '*Unit 1 and Unit 2 represent two battle armor units.', 7.24, 150.311, false, 'start');
}

function battleArmorReferenceContent(
    svg: SVGSVGElement,
    title: string,
    box: Box,
    canonicalHeight: number,
): SVGGElement {
    const group = addFrame(svg, title, box, { fullWidthHeader: true });
    return canonicalReferenceContent(group, box, 184, canonicalHeight);
}

function addBaText(
    parent: SVGGElement,
    value: string,
    x: number,
    y: number,
    weight = false,
    anchor: 'start' | 'middle' = 'middle',
): void {
    addText(parent, value, x, y, { size: 6.2, weight: weight ? 700 : undefined, anchor });
}

function drawCompactBattleArmorInventory(
    group: SVGGElement,
    entity: BattleArmorEntity,
    scale: {
        readonly x: (value: number) => number;
        readonly y: (value: number) => number;
        readonly font: (value: number) => number;
    },
): void {
    const { x, y, font } = scale;
    const rawWeapons = recordSheetInventoryWeapons(entity);
    const weaponComponentIds = new Set(rawWeapons.flatMap(row => row.componentIds));
    const antiPersonnelWeaponIds = new Set<string>(entity.equipment()
        .filter(mount => mount.isAPM)
        .map(mount => mount.mountId));
    const weapons = rawWeapons.filter(row => row.componentIds.every(id => !antiPersonnelWeaponIds.has(id)));
    const armorName = (entity.uniformArmor()?.armor.name ?? '').toLowerCase();
    const miscRows: { name: string; componentIds: readonly string[] }[] = [];
    entity.equipment().forEach(mount => {
        if (weaponComponentIds.has(mount.mountId) || mount.getAmmoShots() !== undefined) return;
        const name = mount.displayName();
        const normalized = name.toLowerCase();
        if ((armorName && normalized.includes(armorName))
            || mount.equipment?.type === 'armor'
            || hasStealthFlag(mount.equipment)
            || isJumpJetEquipment(mount.equipment)
            || isUmuEquipment(mount.equipment)
            || mount.isAPM
            || normalized.includes('anti-personnel weapon mount')) return;
        miscRows.push({ name, componentIds: [mount.mountId] });
    });

    const rows = [
        ...weapons.map(row => ({ ...row, quantity: 1 })),
        ...groupRecordSheetEquipmentRows(miscRows, row => row.name).map(row => ({
            ...row,
            location: '',
            heat: '',
            damage: '',
            minimumRange: '—',
            ranges: Object.freeze(['—', '—', '—']),
            alternativeModes: Object.freeze([]),
        })),
    ];
    // The quantity column appears only when equipment is grouped; names otherwise start where the Mek and vehicle names do.
    const showQuantity = rows.some(row => row.quantity > 1);
    const nameX = showQuantity ? 12.1 : 8.41;
    const nameWidth = BA_NAME_RIGHT - nameX;
    const ammo = recordSheetAmmoProfile(entity);
    const rowLines = (row: { name: string; damage: string; minimumRange: string; ranges: readonly string[] }, size: number) =>
        inventoryRowLineCount([[row.name, x(nameWidth)], [row.damage, x(31)], [row.minimumRange, x(INVENTORY_RANGE_VALUE_WIDTH)],
            ...row.ranges.map(value => [value, x(INVENTORY_RANGE_VALUE_WIDTH)] as const)], font(size));
    const firstBaseline = 66.666;
    const metrics = fitInventoryText(105.2 - firstBaseline, fontSize => ({
        lineCount: rows.reduce((sum, row) => sum + rowLines(row, fontSize)
            + row.alternativeModes.reduce((count, mode) => count + rowLines(mode, fontSize), 0), 0),
        badgeRows: rows.map(row => rowLines(row, fontSize)), content: undefined }));
    const lineStep = metrics.lineStep;
    const rowFont = metrics.fontSize;
    const addCell = (parent: SVGElement, value: string, x: number, yPos: number, options: Parameters<typeof addText>[4] = {}) =>
        addInventoryText(parent, value, x, yPos, { ...options, lineHeight: y(lineStep) });

    if (showQuantity) {
        addText(group, '#', x(7.55), y(56.766), { size: font(RECORD_SHEET_FONT.inventory), weight: 700, anchor: 'middle' });
    }
    addText(group, 'Type', x(nameX), y(56.766), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
    addText(group, 'Dmg', x(94), y(56.766), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
    const columns = inventoryRangeColumns(3.966, 186.54);
    const rangePositions = columns.ranges;
    inventoryRangeHeadings(columns).forEach(([label, position]) => addText(group, label, x(position), y(56.766), {
        size: font(RECORD_SHEET_FONT.inventory), weight: 700, anchor: 'middle',
    }));

    const inventory = svgElement('g');
    group.appendChild(inventory);
    let displayLine = 0;
    rows.forEach((row, index) => {
        const baselineValue = firstBaseline + displayLine * lineStep;
        const damageLines = [row.damage];
        const lineCount = rowLines(row, rowFont);
        const entry = svgElement('g');
        entry.setAttribute('class', 'inventoryEntry');
        entry.setAttribute('id', `generated-ba-inventory-row@${index}`);
        setInventoryComponentIds(entry, row.componentIds);
        const baseline = y(baselineValue);
        // Compact blocks compress vertically; badges take the smaller scale so they fit their rows.
        const badgeScale = Math.min(font(1), y(1));
        const buttons = inventoryRangeButtons(columns, x);
        appendInventoryRowButtons(entry, baseline, badgeScale, y(lineStep), lineCount, buttons.band, buttons.ranges);
        appendInventoryBadges(entry, baseline, badgeScale, y(lineStep));
        if (showQuantity) {
            addCell(entry, String(row.quantity), x(7.55), baseline, {
                class: 'quantity', size: font(rowFont), anchor: 'middle',
            });
        }
        addCell(entry, row.name, x(nameX), baseline, {
            class: 'name', size: font(rowFont), maxWidth: x(nameWidth),
        });
        const damage = svgElement('g');
        damage.setAttribute('class', 'damage');
        damageLines.forEach((value, damageIndex) => addCell(damage, value, x(94),
            y(baselineValue + damageIndex * lineStep), {
            size: font(rowFont), maxWidth: x(31),
        }));
        entry.appendChild(damage);
        const rangeValues = [row.minimumRange, ...row.ranges.slice(0, 3)];
        const rangeTextClasses = ['range_min', 'range_short', 'range_medium', 'range_long'];
        rangeValues.forEach((value, rangeIndex) => addCell(entry, value, x(rangePositions[rangeIndex]), baseline, {
            class: rangeTextClasses[rangeIndex], size: font(rowFont), anchor: 'middle', maxWidth: x(INVENTORY_RANGE_VALUE_WIDTH),
        }));

        let modeLine = displayLine + inventoryRowSpan(lineCount, lineStep);
        row.alternativeModes.forEach(mode => {
            const modeDamageLines = [mode.damage];
            const modeLineCount = rowLines(mode, rowFont);
            const modeBaselineValue = firstBaseline + modeLine * lineStep;
            const alternative = svgElement('g');
            alternative.setAttribute('class', 'alternativeMode');
            alternative.setAttribute('data-mekbay-mode', mode.name);
            appendInventoryRowButtons(alternative, y(modeBaselineValue), badgeScale, y(lineStep), modeLineCount,
                buttons.band, buttons.ranges, 'alternativeModeButton');
            addCell(alternative, mode.name, x(12.1), y(modeBaselineValue), {
                class: 'name', size: font(rowFont), maxWidth: x(79),
            });
            modeDamageLines.forEach((value, damageIndex) => addCell(alternative, value, x(94),
                y(modeBaselineValue + damageIndex * lineStep), { size: font(rowFont), maxWidth: x(31) }));
            [mode.minimumRange, ...mode.ranges].forEach((value, rangeIndex) => addCell(alternative, value,
                x(rangePositions[rangeIndex]), y(modeBaselineValue), {
                    class: rangeTextClasses[rangeIndex], size: font(rowFont), anchor: 'middle',
                    maxWidth: x(INVENTORY_RANGE_VALUE_WIDTH),
                }));
            entry.appendChild(alternative);
            modeLine += modeLineCount;
        });
        inventory.appendChild(entry);
        displayLine = modeLine;
    });
    markAmmoInventory(inventory, {
        top: y(firstBaseline - lineStep * 0.82),
        bottom: y(105.2),
        contentBottom: y(firstBaseline + Math.max(0, displayLine - 1) * lineStep),
    });
    appendRecordSheetAmmoProfile(group, ammo, {
        x: x(7.55), y: y(104.783), width: x(178), fontSize: font(RECORD_SHEET_FONT.inventory), lineHeight: y(lineStep),
    });
}

function drawCompactBattleArmorTroopers(
    svg: SVGSVGElement,
    group: SVGGElement,
    entity: BattleArmorEntity,
    scale: {
        readonly x: (value: number) => number;
        readonly y: (value: number) => number;
        readonly font: (value: number) => number;
    },
    _box: Box,
): void {
    const { x, y } = scale;
    const sx = x(1);
    const sy = y(1);
    entity.damageLocations().forEach((location, index) => {
        const rowY = 13.752 + index * 18.367;
        const row = svgElement('g');
        row.setAttribute('class', 'battle-armor-trooper');
        row.setAttribute(
            'transform',
            `translate(${formatNumber(x(188.966))} ${formatNumber(y(rowY))}) scale(${formatNumber(Math.min(sx, sy))})`,
        );
        const locationCode = location.sheetCode ?? location.code;
        // This trooper-specific outline has a taller badge around the number and
        // suit artwork, with shoulders above and below the narrower armor track.
        const outline = svgElement('path');
        setAttributes(outline, {
            d: 'M 0 2.4 l 2.25 -2.4 h 20 l 2.25 2.4 h 161.25 l 2.25 2.4 v 6.767 l -2.25 2.4 h -161.25 l -2.25 2.4 h -20 l -2.25 -2.4 Z',
            fill: '#fff', stroke: '#000', 'stroke-width': 0.966,
            class: 'unitLocation armor',
        });
        outline.setAttribute('data-loc', locationCode);
        row.appendChild(outline);
        addText(row, String(index + 1), 9, 11.457, {
            size: 10.6, weight: 700, anchor: 'end',
        });
        appendEmbeddedRasterUse(
            svg,
            row,
            BATTLE_ARMOR_DEFAULT_ART,
            { x: 10, y: 1, width: 12, height: 14.367 },
            'battle-armor-suit-glyph',
        );

        // PrintBattleArmor reserves nineteen cells: one grey trooper-status pip
        // followed by up to eighteen armor pips.
        const pipCount = Math.max(0, Math.floor(location.armor.front)) + 1;
        const cellSize = 161 / 19;
        const radius = cellSize * 0.36;
        for (let pipIndex = 0; pipIndex < pipCount; pipIndex++) {
            const pip = svgElement('circle');
            setAttributes(pip, {
                cx: 24 + cellSize * pipIndex + radius,
                cy: 8,
                r: radius,
                fill: pipIndex === 0 ? '#3f3f3f' : '#fff',
                stroke: '#000',
                'stroke-width': 0.9,
                class: pipIndex === 0 ? 'pip armor trooperStatusPip' : 'pip armor',
            });
            pip.setAttribute('data-loc', locationCode);
            row.appendChild(pip);
        }
        group.appendChild(row);
    });
}
