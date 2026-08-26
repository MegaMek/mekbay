// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import type { BattleArmorEntity } from '../../../models/entity/entities/infantry/battle-armor-entity';
import { isBattleArmorEntity } from '../../../models/entity/utils/entity-type-guards';
import { BattleArmorBVCalculator } from '../../../models/entity/utils/battle-value';
import { hasStealthFlag } from '../../../models/stealth-equipment.model';
import { isJumpJetEquipment, isUmuEquipment } from '../../../models/jump-equipment.model';
import type { RecordSheetPageProfile } from '../record-sheet-layout';
import {
    type Box,
    addFrame,
    addText,
    appendLegacyIdentityAnchors,
    compactArmorDisplayName,
    drawCheckbox,
    drawClusterHitsReference,
    drawGeneratedFooter,
    formatNumber,
    recordSheetAmmoName,
    recordSheetInventoryWeapons,
    scaleCompactBox,
    scalePageBox,
    setAttributes,
    setInventoryComponentIds,
    svgElement,
    transparentRect,
} from '../record-sheet-svg-rendering';
import {
    BATTLE_ARMOR_DEFAULT_ART,
    appendEmbeddedRasterUse,
    appendRecordSheetEraIcon,
} from '../record-sheet-embedded-art';
import { CompactRecordSheetLayout } from './record-sheet-layout';
import {
    addReferenceShade,
    canonicalReferenceContent,
} from './record-sheet-reference-table-components';

export class BattleArmorRecordSheetLayout extends CompactRecordSheetLayout {
    public constructor() {
        super(
            'battle-armor',
            'battle-armor',
            'BATTLE ARMOR RECORD SHEET',
            page => page.format === 'a4'
                ? { height: 146.2, stride: 147.428 }
                : { height: 136.2, stride: 137.129 },
            'BATTLE ARMOR: SQUAD ',
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
        svg: SVGSVGElement,
    ): void {
        drawBattleArmorMastheadIcon(svg, parent, box);
    }

    public override drawCompactPageSupplement(
        page: SVGSVGElement,
        profile: RecordSheetPageProfile,
        blocks: readonly SVGSVGElement[],
        entity?: BaseEntity,
    ): void {
        page.setAttribute('data-mekbay-reference-family', 'battle-armor');
        if (blocks.length === 1) {
            const racks = entity !== undefined && isBattleArmorEntity(entity)
                ? battleArmorClusterRacks(entity)
                : parseClusterRacks(blocks[0]);
            drawClusterHitsReference(page, scalePageBox(profile, {
                x: 18.9, y: 221.486, width: 382.1, height: 110.7,
            }), racks);
        }
        drawBattleArmorReferenceTables(page, profile);
        drawGeneratedFooter(page, profile, {
            catalystX: 541.535,
            catalystY: 698.166,
            catalystScale: 0.898,
        });
    }

    protected async drawCompact(svg: SVGSVGElement, entity: BaseEntity): Promise<void> {
        if (!isBattleArmorEntity(entity)) throw new Error('Battle Armor layout requires a Battle Armor entity');
        svg.setAttribute('data-mekbay-cluster-racks', battleArmorClusterRacks(entity).join(','));
        const at = (box: Box): Box => scaleCompactBox(svg, box, 136.2);
        const frameBox = at({ x: 0, y: 0, width: 384, height: 136.2 });
        const formation = entity.techBase().toLowerCase().includes('clan') ? 'POINT' : 'SQUAD';
        const group = addFrame(svg, `BATTLE ARMOR: ${formation} 1`, frameBox, {
        bottomLeftNotchWidth: 145,
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    group.setAttribute('class', `${group.getAttribute('class') ?? ''} compact-battle-armor-frame`.trim());
    const sx = frameBox.width / 384;
    const sy = frameBox.height / 136.2;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;

    addText(group, 'Type:', x(3.97), y(27.8), { size: font(6.76), weight: 700 });
    const type = addText(group, entity.displayName(), x(22.3), y(27.8), {
        size: font(6.76), weight: 700, maxWidth: x(162),
    });
    type.id = 'type';
    type.setAttribute('data-mekbay-field', 'display-name');
    addText(group, 'Gunnery Skill:', x(6.966), y(37.966), { size: font(6.76), weight: 700 });
    const gunnery = addText(group, '4', x(49.513), y(37.966), { size: font(6.76) });
    gunnery.id = 'gunnerySkill0';
    addText(group, "Anti-'Mech Skill:", x(99.466), y(37.966), { size: font(6.76), weight: 700 });
    const piloting = addText(group, '5', x(148.855), y(37.966), { size: font(6.76) });
    piloting.id = 'pilotingSkill0';
    addText(group, 'Ground MP:', x(6.966), y(45.966), { size: font(6.76), weight: 700 });
    const walk = addText(group, String(entity.walkMP()), x(45.03), y(45.966), { size: font(6.76) });
    walk.id = 'mpWalk';
    const secondaryMovement = compactBattleArmorSecondaryMovement(entity);
    if (secondaryMovement !== undefined) {
        addText(group, secondaryMovement.label, x(99.466), y(45.966), {
            size: font(6.76), weight: 700,
        });
        const jump = addText(group, String(secondaryMovement.value), x(132.313), y(45.966), {
            size: font(6.76),
        });
        jump.id = 'mpJump';
    }

    drawCompactBattleArmorInventory(group, entity, { x, y, font });
    drawCompactBattleArmorTroopers(svg, group, entity, { x, y, font }, frameBox);

    const flags: readonly [string, boolean, number, number][] = [
        ['Mechanized:', entity.mechanizedCapable(), 6.966, 46.563],
        ['Swarm:', entity.swarmAttackCapable(), 71.716, 97.239],
        ['Leg:', entity.legAttackCapable(), 123.516, 138.694],
        ['AP:', entity.apMounts() > 0, 162.366, 175.586],
    ];
    flags.forEach(([label, checked, labelX, checkboxX]) => {
        addText(group, label, x(labelX), y(115.952), { size: font(6.76), weight: 700 });
        drawCheckbox(group, x(checkboxX), y(109.552), x(8), checked);
    });
    addText(group, 'Armor:', x(158.966), y(129.166), { size: font(6.76), weight: 700 });
    addText(group, compactArmorDisplayName(entity.uniformArmor()?.armor.name, 'Standard'), x(182.752), y(129.166), {
        size: font(6.76), maxWidth: x(68),
    });
    addText(group, 'Role:', x(255), y(129.166), { size: font(6.76), weight: 700 });
    addText(group, entity.role() || '—', x(272.5), y(129.166), { size: font(6.76), maxWidth: x(55) });
    addText(group, 'BV:', x(332.966), y(129.166), { size: font(6.76), weight: 700 });
    const singleTrooperBv = new BattleArmorBVCalculator(entity).singleTrooperBattleValue();
    const bv = addText(group, `${formatNumber(entity.battleValue())}/${formatNumber(singleTrooperBv)}`,
        x(346.209), y(129.166), { size: font(6.76), maxWidth: x(31) });
    bv.id = 'bv';
    bv.setAttribute('data-mekbay-bv-suffix', `/${formatNumber(singleTrooperBv)}`);
        await appendRecordSheetEraIcon(svg, group, entity.year(), {
            x: x(165.966), y: y(11.752), width: x(20), height: y(20),
        });
        appendLegacyIdentityAnchors(group, entity, frameBox);
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

function parseClusterRacks(block: SVGSVGElement | undefined): readonly number[] {
    const values = (block?.getAttribute('data-mekbay-cluster-racks') ?? '')
        .split(',')
        .map(Number)
        .filter(value => Number.isInteger(value) && value > 0);
    return values.length > 0 ? values : [2, 3, 4, 5];
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
    const rawWeapons = recordSheetInventoryWeapons(entity, true);
    const weaponComponentIds = new Set(rawWeapons.flatMap(row => row.componentIds));
    const antiPersonnelWeaponIds = new Set<string>(entity.equipment()
        .filter(mount => mount.isAPM)
        .map(mount => mount.mountId));
    const weapons = rawWeapons.flatMap(row => {
        const componentIds = row.componentIds.filter(id => !antiPersonnelWeaponIds.has(id));
        return componentIds.length === 0 ? [] : [{
            ...row,
            componentIds: Object.freeze(componentIds),
            quantity: componentIds.length,
        }];
    });
    const armorName = (entity.uniformArmor()?.armor.name ?? '').toLowerCase();
    const miscRows = new Map<string, {
        quantity: number;
        name: string;
        componentIds: string[];
    }>();
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
        const key = name;
        const existing = miscRows.get(key);
        if (existing) {
            existing.quantity++;
            existing.componentIds.push(mount.mountId);
        } else {
            miscRows.set(key, { quantity: 1, name, componentIds: [mount.mountId] });
        }
    });

    const rows = [
        ...weapons,
        ...[...miscRows.values()].map(row => ({
            ...row,
            location: '',
            heat: '',
            damage: '',
            minimumRange: '—',
            ranges: Object.freeze(['—', '—', '—']),
            alternativeModes: Object.freeze([]),
        })),
    ];
    const ammo = battleArmorAmmoProfile(entity);
    const splitDamage = (value: string): readonly string[] => {
        const match = value.match(/^(.*?)\s+(\[[^\]]+\])$/u);
        return match?.[1] && value.length > 10
            ? Object.freeze([match[1], match[2]])
            : Object.freeze([value]);
    };
    const lineCount = rows.reduce((sum, row) => sum
        + splitDamage(row.damage).length
        + row.alternativeModes.reduce((modeSum, mode) => modeSum + splitDamage(mode.damage).length, 0), 0);
    const firstBaseline = 66.666;
    const maxBaseline = ammo.length > 0 ? 96.377 : 105.2;
    const lineStep = Math.min(8.406, lineCount > 1 ? (maxBaseline - firstBaseline) / (lineCount - 1) : 8.406);
    const rowFont = Math.min(6.76, Math.max(4.4, lineStep * (6.76 / 8.406)));

    addText(group, '#', x(7.55), y(56.766), { size: font(6.76), weight: 700, anchor: 'middle' });
    addText(group, 'Type', x(12.1), y(56.766), { size: font(6.76), weight: 700 });
    addText(group, 'Dmg', x(94), y(56.766), { size: font(6.76), weight: 700 });
    const rangePositions = [134.04, 149.146, 164.07, 179.54] as const;
    [['Min', rangePositions[0]], ['Sht', rangePositions[1]], ['Med', rangePositions[2]], ['Lng', rangePositions[3]]]
        .forEach(([label, position]) => {
        addText(group, String(label), x(Number(position)), y(56.766), {
            size: font(6.76), weight: 700, anchor: 'middle',
        });
    });

    const rangeClasses = ['', 'shrButton', 'medButton', 'lngButton'] as const;
    let displayLine = 0;
    rows.forEach((row, index) => {
        const baselineValue = firstBaseline + displayLine * lineStep;
        const damageLines = splitDamage(row.damage);
        const entry = svgElement('g');
        entry.setAttribute('class', 'inventoryEntry');
        entry.setAttribute('id', `generated-ba-inventory-row@${index}`);
        setInventoryComponentIds(entry, row.componentIds);
        entry.appendChild(transparentRect(x(3.966), y(baselineValue - lineStep), x(182), y(lineStep * damageLines.length),
            'inventoryEntryButton mainButton'));
        rangeClasses.slice(1).forEach((className, rangeIndex) => entry.appendChild(
            transparentRect(x(rangePositions[rangeIndex + 1] - 7), y(baselineValue - lineStep), x(14), y(lineStep),
                `inventoryEntryButton ${className}`),
        ));
        const baseline = y(baselineValue);
        addText(entry, String(row.quantity), x(7.55), baseline, {
            class: 'quantity', size: font(rowFont), anchor: 'middle',
        });
        addText(entry, row.name, x(12.1), baseline, {
            class: 'name', size: font(rowFont), maxWidth: x(79),
        });
        const damage = svgElement('g');
        damage.setAttribute('class', 'damage');
        damageLines.forEach((value, damageIndex) => addText(damage, value, x(94),
            y(baselineValue + damageIndex * lineStep), {
            size: font(rowFont), maxWidth: x(36),
        }));
        entry.appendChild(damage);
        const rangeValues = [row.minimumRange, ...row.ranges.slice(0, 3)];
        const rangeTextClasses = ['range_min', 'range_short', 'range_medium', 'range_long'];
        rangeValues.forEach((value, rangeIndex) => addText(entry, value, x(rangePositions[rangeIndex]), baseline, {
            class: rangeTextClasses[rangeIndex], size: font(rowFont), anchor: 'middle', maxWidth: x(13),
        }));

        let modeLine = displayLine + damageLines.length;
        row.alternativeModes.forEach(mode => {
            const modeDamageLines = splitDamage(mode.damage);
            const modeBaselineValue = firstBaseline + modeLine * lineStep;
            const alternative = svgElement('g');
            alternative.setAttribute('class', 'alternativeMode');
            alternative.setAttribute('data-mekbay-mode', mode.name);
            alternative.appendChild(transparentRect(x(3.966), y(modeBaselineValue - lineStep), x(182),
                y(lineStep * modeDamageLines.length), 'inventoryEntryButton alternativeModeButton'));
            rangeClasses.slice(1).forEach((className, rangeIndex) => alternative.appendChild(
                transparentRect(x(rangePositions[rangeIndex + 1] - 7), y(modeBaselineValue - lineStep), x(14), y(lineStep),
                    `inventoryEntryButton ${className}`),
            ));
            addText(alternative, mode.name, x(12.1), y(modeBaselineValue), {
                class: 'name', size: font(rowFont), maxWidth: x(79),
            });
            modeDamageLines.forEach((value, damageIndex) => addText(alternative, value, x(94),
                y(modeBaselineValue + damageIndex * lineStep), { size: font(rowFont), maxWidth: x(36) }));
            [mode.minimumRange, ...mode.ranges].forEach((value, rangeIndex) => addText(alternative, value,
                x(rangePositions[rangeIndex]), y(modeBaselineValue), {
                    class: rangeTextClasses[rangeIndex], size: font(rowFont), anchor: 'middle', maxWidth: x(13),
                }));
            entry.appendChild(alternative);
            modeLine += modeDamageLines.length;
        });
        group.appendChild(entry);
        displayLine = modeLine;
    });

    if (ammo.length > 0) {
        const ammoProfile = svgElement('g');
        ammoProfile.id = 'ammoProfile';
        addText(ammoProfile, `Ammo: ${ammo.join(', ')}`, x(7.55), y(104.783), {
            size: font(6.76), maxWidth: x(178),
        });
        group.appendChild(ammoProfile);
    }
}

function battleArmorAmmoProfile(entity: BattleArmorEntity): readonly string[] {
    const totals = new Map<string, number>();
    entity.equipment().forEach(mount => {
        const shots = mount.getAmmoShots();
        if (shots === undefined) return;
        let name = recordSheetAmmoName(mount.displayName());
        for (const location of mount.getOccupiedLocations()) {
            const locationSuffix = ` (${location})`;
            if (name.endsWith(locationSuffix)) {
                name = name.slice(0, -locationSuffix.length);
                break;
            }
        }
        name = name.replace(/\s+\((?:Body|Squad|LA|RA|Left Arm|Right Arm)\)$/u, '');
        totals.set(name, (totals.get(name) ?? 0) + shots);
    });
    return Object.freeze([...totals.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, shots]) => `(${name}) ${shots}`));
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
            `translate(${formatNumber(x(188.966))} ${formatNumber(y(rowY))}) scale(${formatNumber(sx)} ${formatNumber(sy)})`,
        );
        const locationCode = location.sheetCode ?? location.code;
        const outline = svgElement('path');
        setAttributes(outline, {
            d: 'M 0 2.4 l 2.25 -2.4 h 20 l 2.25 2.4 h 161.25 l 2.25 2.4 v 6.767 l -2.25 2.4 h -161.25 l -2.25 2.4 h -20 l -2.25 -2.4 Z',
            fill: '#fff', stroke: '#000', 'stroke-width': 0.966,
            class: 'unitLocation armor',
        });
        outline.setAttribute('loc', locationCode);
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
                fill: pipIndex === 0 ? '#c7c7c7' : '#fff',
                stroke: '#000',
                'stroke-width': 0.9,
                class: 'pip armor',
            });
            pip.setAttribute('loc', locationCode);
            row.appendChild(pip);
        }
        group.appendChild(row);
    });
}

function drawBattleArmorMastheadIcon(
    svg: SVGSVGElement,
    parent: SVGGElement,
    box: Box,
): void {
    const sx = box.width / 31.018;
    const sy = box.height / 41.357;
    appendEmbeddedRasterUse(
        svg,
        parent,
        BATTLE_ARMOR_DEFAULT_ART,
        { x: 9.45 * sx, y: 2 * sy, width: 37.8 * sx, height: 41.357 * sy },
        'battle-armor-masthead-icon',
    );
}
