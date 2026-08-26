// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import type { InfantryEntity } from '../../../models/entity/entities/infantry/infantry-entity';
import { isInfantryEntity } from '../../../models/entity/utils/entity-type-guards';
import type { RecordSheetPageProfile } from '../record-sheet-layout';
import {
    type Box,
    addFrame,
    addLine,
    addText,
    appendLegacyIdentityAnchors,
    drawClusterHitsReference,
    drawGeneratedFooter,
    formatNumber,
    scaleCompactBox,
    scalePageBox,
    setAttributes,
    svgElement,
} from '../record-sheet-svg-rendering';
import {
    INFANTRY_TROOPER_ART,
    appendEmbeddedRasterUse,
} from '../record-sheet-embedded-art';
import { CompactRecordSheetLayout } from './record-sheet-layout';
import {
    addExactReferenceText,
    addReferenceShade,
    canonicalReferenceContent,
} from './record-sheet-reference-table-components';

export class ConventionalInfantryRecordSheetLayout extends CompactRecordSheetLayout {
    public constructor() {
        super(
            'conventional-infantry',
            'infantry',
            'CONVENTIONAL INFANTRY RECORD SHEET',
            page => page.format === 'a4'
                ? { height: 186.5, stride: 180.285 }
                : { height: 174, stride: 167.411 },
        );
    }

    public matches(entity: BaseEntity): boolean {
        return isInfantryEntity(entity);
    }

    protected override compactMastheadTitleLines(): readonly string[] {
        return ['CONVENTIONAL', 'INFANTRY RECORD', 'SHEET'];
    }

    public override drawCompactPageSupplement(
        page: SVGSVGElement,
        profile: RecordSheetPageProfile,
        blocks: readonly SVGSVGElement[],
        entity?: BaseEntity,
    ): void {
        page.setAttribute('data-mekbay-reference-family', 'infantry');
        if (blocks.length === 1) {
            const strength = entity !== undefined && isInfantryEntity(entity)
                ? infantryShootingStrength(entity)
                : Number(blocks[0]?.getAttribute('data-mekbay-shooting-strength')) || 28;
            drawClusterHitsReference(page, scalePageBox(profile, {
                x: 18.9, y: 255.768, width: 576.149, height: 148.504,
            }), Array.from({ length: Math.max(0, strength - 1) }, (_, index) => index + 2));
        }
        if (blocks.length <= 3) drawInfantryReferenceTables(page, profile);
        drawGeneratedFooter(page, profile, {
            catalystX: 535,
            catalystY: 704,
            catalystScale: 0.898,
        });
    }

    protected drawCompact(svg: SVGSVGElement, entity: BaseEntity): void {
        if (!isInfantryEntity(entity)) throw new Error('Infantry layout requires a conventional Infantry entity');
        svg.setAttribute('data-mekbay-shooting-strength', String(infantryShootingStrength(entity)));
        const at = (box: Box): Box => scaleCompactBox(svg, box, 174);
        const frameBox = at({ x: 0, y: 0, width: 576, height: 174 });
        const group = addFrame(svg, entity.displayName(), frameBox, {
        bottomLeftNotchWidth: 296,
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    group.setAttribute('class', `${group.getAttribute('class') ?? ''} compact-infantry-frame`.trim());
    const sx = frameBox.width / 576;
    const sy = frameBox.height / 174;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;

    const armorName = entity.armorKit()?.name ?? entity.uniformArmor()?.armor.name ?? 'Standard Infantry Kit';
    addText(group, 'Armor Type:', x(287), y(18), { size: font(8.6), weight: 700 });
    addText(group, armorName, x(336.657), y(18), { size: font(8.6), maxWidth: x(139) });
    addText(group, 'Damage Divisor:', x(479), y(18), { size: font(8.6), weight: 700 });
    addText(group, entity.armorDivisor().toFixed(1), x(543.987), y(18), { size: font(8.6), maxWidth: x(26) });

    const facts: readonly [string, string, number, string?][] = [
        ['Commander:', '', 29.777, undefined],
        ['Gunnery Skill:', '4', 41.555, 'gunnerySkill0'],
        ["Anti-'Mech Skill:", entity.canAntiMech() ? '5' : '—', 53.332, 'pilotingSkill0'],
        ['Role:', entity.role() || '—', 65.109, undefined],
        ['Max Weapon Damage*', '', 76.887, undefined],
        ['Notes:', '', 88.664, undefined],
    ];
    facts.forEach(([label, value, baseline, id]) => {
        addText(group, label, x(3), y(baseline), { size: font(7.2), weight: 700 });
        if (value) {
            const node = addText(group, value, x(label === 'Role:' ? 21.702 : 55.8), y(baseline), {
                size: font(7.2), maxWidth: x(58),
            });
            if (id) node.id = id;
        }
    });
    const commander = addText(group, '', x(46.03), y(29.777), { size: font(7.2), maxWidth: x(68.047) });
    commander.id = 'pilotName0';
    addLine(group, x(46.03), y(30.777), x(114.077), y(30.777), '#111', 0.735 * fontScale);
    addText(group, infantrySpecializationSummary(entity), x(3.46), y(100.441), {
        size: font(7.2), maxWidth: x(108),
    });

    drawCompactInfantryTrack(svg, group, entity, { x, y, font });
    addText(group, 'BV:', x(116.6), y(154.786), { size: font(7.2), weight: 700 });
    const bv = addText(group, formatNumber(entity.battleValue()), x(130.701), y(154.786), { size: font(7.2) });
    bv.id = 'bv';
    addText(group, 'Transport Wt:', x(173.4), y(154.786), { size: font(7.2), weight: 700 });
    addText(group, `${entity.tonnage().toFixed(1)} tons`, x(221.502), y(154.786), { size: font(7.2) });
    addText(group, 'Movement MP:', x(315.4), y(154.786), { size: font(7.2), weight: 700 });
    const walk = addText(group, String(entity.walkMP()), x(366.183), y(154.786), { size: font(7.2) });
    walk.id = 'mpWalk';
    addText(group, 'Type:', x(429), y(154.786), { size: font(7.2), weight: 700 });
    addText(group, infantryMovementLabel(entity), x(448.523), y(154.786), { size: font(7.2), maxWidth: x(120) });
    if (entity.jumpMP() > 0 || entity.umuMP() > 0) {
        const secondaryLabel = entity.jumpMP() > 0 ? 'Jumping MP:' : 'Underwater MP:';
        const secondaryValue = entity.jumpMP() > 0 ? entity.jumpMP() : entity.umuMP();
        addText(group, secondaryLabel, x(315.4), y(164.2), { size: font(7.7), weight: 700, maxWidth: x(50) });
        const jump = addText(group, String(secondaryValue), x(366.2), y(164.2), { size: font(7.7) });
        jump.id = 'mpJump';
        addText(group, 'Type:', x(429), y(164.2), { size: font(7.7), weight: 700 });
        addText(group, entity.jumpMP() > 0 ? 'Jump' : 'Underwater', x(448.5), y(164.2), {
            size: font(7.7), maxWidth: x(120),
        });
    }
        appendLegacyIdentityAnchors(group, entity, frameBox);
    }
}

function infantryShootingStrength(entity: InfantryEntity): number {
    return Math.max(
        1,
        entity.damageLocations().find(location => location.soldierPips)?.internalPoints
            ?? entity.squadSize() * entity.squadCount(),
    );
}

function drawInfantryReferenceTables(page: SVGSVGElement, profile: RecordSheetPageProfile): void {
    drawInfantryBurstFireReference(page, scalePageBox(profile, {
        x: 18.966, y: 585, width: 283, height: 170,
    }));
    drawInfantryNonInfantryWeaponReference(page, scalePageBox(profile, {
        x: 309.966, y: 593.214, width: 280, height: 162.572,
    }));
}

function drawInfantryBurstFireReference(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'BURST-FIRE WEAPON DAMAGE VS. CONVENTIONAL INFANTRY', box, {
        fullWidthHeader: true,
    });
    setExactInfantryFrameTitle(group, 138.654, 11.25, 237.694);
    const content = canonicalReferenceContent(group, box, 283, 170);
    for (const y of [43.5, 55.5, 67.5]) addReferenceShade(content, 7, y, 268, 6);
    for (const y of [104, 116.5, 128.5, 140.5, 153]) addReferenceShade(content, 7, y, 268, 6);
    addInfantryReferenceText(content, "'MECHS, PROTOMECHS AND VEHICLES", 11.2, 24.08, true, 'start');
    drawInfantryWeaponTable(content, 36.24, [
        ['AP Gauss Rifle', '2D6'],
        ['Light Machine Gun', '1D6'],
        ['Machine Gun', '2D6'],
        ['Heavy Machine Gun', '3D6'],
        ['Small/Micro Pulse Laser', '2D6'],
        ['Flamer', '4D6'],
    ]);
    addInfantryReferenceText(content, 'BATTLE ARMOR', 11.2, 84.88, true, 'start');
    drawInfantryWeaponTable(content, 97.04, [
        ['Light Machine Gun', '1D6/2 (round up)'],
        ['Machine Gun', '1D6'],
        ['Heavy Machine Gun', '2D6'],
        ['Flamer', '3D6'],
        ['Light Recoilless Rifle', '1D6'],
        ['Medium Recoilless Rifle', '2D6'],
        ['Heavy Recoilless Rifle', '2D6'],
        ['Light Mortar', '1D6'],
        ['Heavy Mortar', '1D6'],
        ['Automatic Grenade Launcher', '1D6/2 (round up)'],
        ['Heavy Grenade Launcher', '1D6'],
    ]);
}

function drawInfantryWeaponTable(
    content: SVGGElement,
    headerY: number,
    rows: readonly (readonly [string, string])[],
): void {
    addInfantryReferenceText(content, 'WEAPON', 11.2, headerY, true, 'start');
    addInfantryReferenceText(content, 'DAMAGE VS. CONVENTIONAL INFANTRY', 210, headerY, true);
    rows.forEach(([weapon, damage], index) => {
        const y = headerY + (index + 1) * 6.08;
        addInfantryReferenceText(content, weapon, 11.2, y, true, 'start');
        addInfantryReferenceText(content, damage, 210, y);
    });
}

function drawInfantryNonInfantryWeaponReference(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'NON-INFANTRY WEAPON AGAINST INFANTRY', box, {
        fullWidthHeader: true,
    });
    setExactInfantryFrameTitle(group, 137.154, 11.25, 218.082);
    const content = canonicalReferenceContent(group, box, 280, 162.572);
    for (const y of [40.5, 54.5, 68]) addReferenceShade(content, 6, y, 268, 6);
    addInfantryReferenceText(content, 'NUMBER OF CONVENTIONAL', 207.75, 24.847, true);
    addInfantryReferenceText(content, 'WEAPON TYPE*', 11.08, 31.694, true, 'start');
    addInfantryReferenceText(content, 'TROOPERS HIT†', 207.75, 31.694, true);
    const rows: readonly (readonly [string, string])[] = [
        ['Direct Fire (Energy or Ballistic)', 'Damage Value / 10'],
        ['Cluster (Ballistic)', 'Damage Value / 10 + 1'],
        ['Pulse**', 'Damage Value / 10 + 2'],
        ['Cluster (Missile)', 'Damage Value / 5'],
        ['Area Effect (AE)', 'Damage Value / 5'],
        ['Burst-Fire', 'See Burst-Fire Weapons Table'],
        ['Heat Effect Weapons', 'See Heat-Effect Weapons‡'],
    ];
    rows.forEach(([weapon, effect], index) => {
        const y = 38.541 + index * 6.847;
        addInfantryReferenceText(content, weapon, 11.08, y, true, 'start');
        addInfantryReferenceText(content, effect, 207.75, y);
    });
    addExactReferenceText(content, '*See Combat, p. 113 in Total Warfare, for weapon terminology.', 6, 93.47, 5.7, 153.054);
    addInfantryReferenceText(content, '**Except for Small and Micro Pulse Lasers, which are treated as Burst-Fire Weapons.', 6, 100.47, false, 'start');
    addExactReferenceText(content, '†This equals the number of conventional infantry troopers hit and eliminated, regardless of armor protection.', 6, 107.47, 5.7, 268);
    addExactReferenceText(content, 'Attacks by non-infantry weapons against mechanized infantry double the number of troopers eliminated;', 6, 114.47, 5.7, 268);
    addInfantryReferenceText(content, 'round fractions up.', 6, 121.47, false, 'start');
    addExactReferenceText(content, '‡Each Heat-Effect Weapon has specific damage against conventional infantry,', 6, 128.47, 5.7, 198.75);
    addExactReferenceText(content, 'as noted on either the appropriate Weapon and Equipment Tables or in Other', 6, 135.47, 5.7, 203.795);
    addExactReferenceText(content, 'Combat Weapons and Equipment (see p. 129 in Total Warfare).', 6, 142.47, 5.7, 159.619);
}

function addInfantryReferenceText(
    parent: SVGGElement,
    value: string,
    x: number,
    y: number,
    weight = false,
    anchor: 'start' | 'middle' = 'middle',
): void {
    addText(parent, value, x, y, { size: 5.7, weight: weight ? 700 : undefined, anchor });
}

function infantrySpecializationSummary(entity: InfantryEntity): string {
    const specializations = [...entity.specializations()];
    if (specializations.length === 0) return 'None';
    return specializations.map(value => value.split('-')
        .map(word => word === 'xct' ? 'XCT' : `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
        .join(' ')).join(', ');
}

function infantryMovementLabel(entity: InfantryEntity): string {
    const motive = entity.getMotiveTypeAsString() ?? 'Ground';
    return motive === 'Leg' ? 'Ground' : motive;
}

function drawCompactInfantryTrack(
    svg: SVGSVGElement,
    group: SVGGElement,
    entity: InfantryEntity,
    scale: {
        readonly x: (value: number) => number;
        readonly y: (value: number) => number;
        readonly font: (value: number) => number;
    },
): void {
    const { x, y, font } = scale;
    const count = Math.max(1, entity.damageLocations()[0]?.internalPoints ?? 1);
    const columns = 30;
    const left = 116.6;
    const top = 25.139;
    const width = 451.4;
    const cellWidth = width / columns;
    const primaryDamage = entity.primaryWeapon()?.infantry.damage ?? 0;
    const secondaryDamage = entity.secondaryWeapon()?.infantry.damage ?? primaryDamage;
    const squadSize = Math.max(1, entity.squadSize());
    const secondaryCount = Math.min(entity.secondaryCount(), squadSize);
    const damagePerTrooper = ((squadSize - secondaryCount) * primaryDamage + secondaryCount * secondaryDamage) / squadSize;
    const track = svgElement('g');
    track.setAttribute('class', 'infantry-strength-track');
    track.setAttribute(
        'transform',
        `translate(${formatNumber(x(left))} ${formatNumber(y(top))}) `
        + `scale(${formatNumber(x(1))} ${formatNumber(y(1))})`,
    );
    const outline = svgElement('path');
    setAttributes(outline, {
        d: 'M 0 0 H 451.4 V 106.629 L 443.555 114.229 H 7.845 L 0 106.629 Z',
        fill: '#fff', stroke: '#000', 'stroke-width': 0.966, 'stroke-linejoin': 'round',
    });
    track.appendChild(outline);
    addLine(track, 0, 39.98, width, 39.98, '#000', 0.966);
    addLine(track, 0, 57.114, width, 57.114, '#000', 0.966);
    for (let index = 0; index <= columns; index++) {
        addLine(track, index * cellWidth, 0, index * cellWidth, 57.114, '#000', 0.966);
    }
    for (let index = 0; index < columns; index++) {
        const number = columns - index;
        const cellX = index * cellWidth;
        const available = number <= count;
        addText(track, String(number), cellX + 3, 8.4, { size: 6.2 });
        const soldier = svgElement('g');
        soldier.setAttribute('class', 'soldierPip pip');
        soldier.id = `soldier_${number}`;
        soldier.setAttribute('loc', 'Infantry');
        const glyphWidth = 13.047;
        const glyphHeight = 29.58;
        soldier.setAttribute('transform', `translate(${formatNumber(cellX + 1)} 9.4)`);
        soldier.setAttribute('opacity', available ? '1' : '0.18');
        appendEmbeddedRasterUse(
            svg,
            soldier,
            INFANTRY_TROOPER_ART,
            { x: 0, y: 0, width: glyphWidth, height: glyphHeight },
            'record-sheet-infantry-trooper',
        );
        track.appendChild(soldier);
        const damage = Math.max(0, Math.ceil(number * damagePerTrooper));
        const damageText = addText(track, available ? String(damage) : '—', cellX + 7.523, 51.747, {
            size: 7.2, anchor: 'middle',
        });
        damageText.id = `damage_${number}`;
    }
    addText(track, '*Damage is always applied in 2-point Damage Value groupings', 3, 64.254, {
        size: 5.7, maxWidth: 220,
    });
    addText(track, 'RANGE IN HEXES (TO-HIT MODIFIER)', 225.7, 64.254, {
        size: 6.2, weight: 700, maxWidth: 220,
    });
    addText(track, 'Range:', 3, 71.393, { size: 6.2, weight: 700 });
    addText(track, 'Range Modifier:', 3, 78.532, { size: 6.2, weight: 700 });
    const weaponRange = Math.max(1, entity.rangeWeapon()?.infantry.range ?? 1);
    for (let range = 0; range <= 21; range++) {
        const columnX = 65.356 + range * 17.816;
        addText(track, String(range), columnX, 71.393, { size: 6.2, weight: 700, anchor: 'middle' });
        const modifier = range === 0 ? '-2'
            : range <= weaponRange ? '0'
                : range <= weaponRange * 2 ? '+2'
                    : range <= weaponRange * 3 ? '+4' : '—';
        addText(track, modifier, columnX, 78.532, { size: 6.2, anchor: 'middle' });
    }
    group.appendChild(track);
}

function setExactInfantryFrameTitle(
    group: SVGGElement,
    x: number,
    y: number,
    textLength: number,
): void {
    const title = group.querySelector<SVGTextElement>('.svg-frame-title');
    if (!title) return;
    setAttributes(title, { x, y, textLength, lengthAdjust: 'spacingAndGlyphs' });
}
