// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import type { InfantryEntity } from '../../../models/entity/entities/infantry/infantry-entity';
import { isInfantryEntity } from '../../../models/entity/utils/entity-type-guards';
import { infantryDamageDivisor } from '../../../models/entity/utils/battle-value/infantry-rules';
import { adjustEntityBattleValueForSkills, effectiveEntityPilotingSkill } from '../../../models/entity/utils/battle-value/skill-facts';
import { AmmoEquipment, WeaponEquipment } from '../../../models/equipment.model';
import { PILOT_ABILITIES } from '../../../models/pilot-abilities.model';
import { conventionalInfantryRangeWeapon, projectConventionalInfantryCombat } from '../../../models/rules/conventional-infantry-combat-rules';
import { measureSvgTextCanvas } from '../../svg-text.util';
import { createInfantryStrengthDisplay,INFANTRY_STRENGTH_DISPLAY_ID } from '../infantry-strength-display';
import { INFANTRY_STRENGTH_CELL_COUNT } from '../infantry-strength-projection';
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
import { appendEmbeddedSvgDefinition } from '../record-sheet-embedded-art';
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

    protected override drawCompactMastheadIcon(parent: SVGGElement, box: Box, svg: SVGSVGElement): void {
        const use = svgElement('use');
        setAttributes(use, { href: '#mekbay-infantry-masthead-art', class: 'infantry-masthead-icon',
            width: 56.7 * box.width / 31.018, height: 45.357 * box.height / 41.357 });
        parent.appendChild(use);
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
                : INFANTRY_STRENGTH_CELL_COUNT;
            drawClusterHitsReference(page, scalePageBox(profile, {
                x: 18.9, y: 255.768, width: 576.149, height: 148.504,
            }), Array.from({ length: Math.max(0, strength - 1) }, (_, index) => index + 2));
        }
        if (blocks.length <= 3) drawInfantryReferenceTables(page, profile);
        drawGeneratedFooter(page, profile, {
            catalystX: 533.966,
            catalystY: 719.587,
            catalystScale: 1.015,
        });
    }

    protected async drawCompact(svg: SVGSVGElement, entity: BaseEntity): Promise<void> {
        if (!isInfantryEntity(entity)) throw new Error('Infantry layout requires a conventional Infantry entity');
        await appendEmbeddedSvgDefinition(svg, '/images/record-sheet-art/infantry.svg', 'mekbay-infantry-masthead-art');
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
    addText(group, infantryDamageDivisor(entity).toFixed(1) + (entity.effectiveEncumberingArmor() ? 'E' : ''),
        x(543.987), y(18), { size: font(8.6), maxWidth: x(26) });

    const facts: readonly [string, string, number, string?][] = [
        ['Commander:', '', 29.777, undefined],
        ['Gunnery Skill:', '4', 41.555, 'gunnerySkill0'],
        ["Anti-'Mech Skill:", entity.canMakeAntiMekAttacks() ? String(effectiveEntityPilotingSkill(entity, 5)) : '—', 53.332, 'pilotingSkill0'],
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
    drawInfantryNotes(group, infantryNotes(entity), { x: x(3.46), y: y(100.441),
        width: x(108), height: y(64) }, fontScale, sy);

    drawCompactInfantryTrack(svg, group, entity, { x, y, font });
    addText(group, 'BV:', x(116.6), y(154.786), { size: font(7.2), weight: 700 });
    const bv = addText(group, formatNumber(adjustEntityBattleValueForSkills(entity, entity.battleValue(), 4, 5)),
        x(130.701), y(154.786), { size: font(7.2) });
    bv.id = 'bv';
    addText(group, 'Transport Wt:', x(173.4), y(154.786), { size: font(7.2), weight: 700 });
    addText(group, `${entity.tonnage().toFixed(1)} tons`, x(221.502), y(154.786), { size: font(7.2) });
    addText(group, 'Movement MP:', x(315.4), y(154.786), { size: font(7.2), weight: 700 });
    infantryMovementRows(entity).forEach((movement, index) => {
        const baseline = 154.786 + index * 11.777;
        if (index > 0) addText(group, 'Movement MP:', x(315.4), y(baseline), { size: font(7.2), weight: 700 });
        const mp = addText(group, String(movement.value), x(366.183), y(baseline), { size: font(7.2) });
        mp.id = movement.id;
        addText(group, 'Type:', x(429), y(baseline), { size: font(7.2), weight: 700 });
        addText(group, movement.label, x(448.523), y(baseline), { size: font(7.2), maxWidth: x(120) });
    });
        appendLegacyIdentityAnchors(group, entity, frameBox);
    }
}

function infantryShootingStrength(entity: InfantryEntity): number {
    return Math.max(
        1,
        entity.damageLocations().find(location => location.code === 'Infantry')?.internalPoints
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

function drawInfantryNotes(parent: SVGGElement, value: string, box: Box, fontScale: number, verticalScale: number): void {
    const group = svgElement('g');
    group.setAttribute('class', 'infantry-notes');
    parent.appendChild(group);
    const probe = svgElement('text');
    const words = value.split(/\s+/u);
    let size = 7.2;
    let lines: string[];
    do {
        probe.setAttribute('font-size', formatNumber(size * fontScale));
        lines = [];
        for (const word of words) {
            const previous = lines.at(-1);
            if (previous === undefined || measureSvgTextCanvas(probe, `${previous} ${word}`) > box.width) {
                lines.push(word);
            } else {
                lines[lines.length - 1] = `${previous} ${word}`;
            }
        }
        if (lines.length * (size + 1) * verticalScale <= box.height || size <= 5) break;
        size = Math.max(5, size - 1);
    } while (true);
    lines.forEach((line, index) => addText(group, line, box.x, box.y + index * (size + 1) * verticalScale,
        { size: size * fontScale }));
}

// MegaMek PilotOptions display names for infantry augmentations missing from PILOT_ABILITIES.
const INFANTRY_AUGMENTATION_NAMES: Readonly<Record<string, string>> = {
    artificial_pain_shunt: 'Artificial Pain Shunt',
    comm_implant: 'Cybernetic Comm Implant',
    boost_comm_implant: 'Boosted Cybernetic Comm Implant',
    cyber_imp_audio: 'Sensory Implants (Enhanced Audio)',
    cyber_imp_visual: 'Sensory Implants (IR/EM Optical)',
    cyber_imp_laser: 'Sensory Implants (Laser-sight Optical)',
    cyber_imp_tele: 'Sensory Implants (Telescopic Optical)',
    mm_implants: 'Multi-Modal Sensory Implant',
    enh_mm_implants: 'Enhanced Multi-Modal Sensory Implants',
    filtration_implants: 'Filtration Implants',
    gas_effuser_pheromone: 'Cybernetic Gas Effuser (Pheromone)',
    gas_effuser_toxin: 'Cybernetic Gas Effuser (Toxin)',
    dermal_armor: 'Myomer Implants (Dermal Armor)',
    dermal_camo_armor: 'Myomer Implants (Dermal Armor Camouflage)',
    tsm_implant: 'Myomer Implants (Triple Strength)',
    triple_core_processor: 'Triple-Core Processor',
    vdni: 'VDNI',
    bvdni: 'Buffered VDNI',
    proto_dni: 'Prototype Direct Neural Interface',
    suicide_implants: 'Explosive Suicide Implants',
    pl_masc: 'Prosthetic leg MASC',
    pl_enhanced: 'Prosthetic Limbs, Enhanced',
    pl_ienhanced: 'Prosthetic Limbs, Improved Enhanced',
    pl_extra_limbs: 'Prosthetic Limbs, Extraneous (Enhanced)',
    pl_tail: 'Prosthetic Tail, Enhanced',
    pl_glider: 'Prosthetic Wings, Glider',
    pl_flight: 'Prosthetic Wings, Powered Flight',
};

function infantryNotes(entity: InfantryEntity): string {
    const notes: string[] = [];
    const primary = entity.primaryWeapon();
    const secondary = entity.secondaryWeapon();
    const rangeWeapon = conventionalInfantryRangeWeapon(entity);
    const mount = entity.mount();
    if (entity.effectiveSpaceSuit()) notes.push('Can operate in vacuum.');
    if (mount && mount.uwEndurance > 0) notes.push(`Must surface every ${mount.uwEndurance} turns.`);
    const burst = (rangeWeapon?.hasFlag('F_INF_BURST') || (primary?.infantry.damage ?? 0) > 0.6 ? 1 : 0)
        + (mount?.burstDamage ?? 0);
    if (burst > 0) notes.push(`+${burst}D6 damage vs. conventional infantry.`);
    if (mount && mount.vehicleDamage > 0) notes.push(`+${mount.vehicleDamage} damage vs. vehicles and 'Meks`);
    if (mount?.size === 'Very Large') notes.push('-1 attacker to-hit');
    if (mount?.size === 'Monstrous') notes.push('-2 attacker to-hit');
    if (rangeWeapon?.hasFlag('F_INF_NONPENETRATING')) notes.push('Can only damage conventional infantry units.');
    if ([primary, secondary].some(weapon => (['F_PLASMA', 'F_INCENDIARY_NEEDLES', 'F_INFERNO', 'F_FLAMER'] as const)
        .some(flag => weapon?.hasFlag(flag)))) notes.push('Flame-based weapon.');
    if ([primary, secondary].some(weapon => weapon?.hasFlag('F_INF_AA'))) {
        notes.push('May attack airborne targets that attack their hex.');
    }
    const specializationNotes = {
        'bridge-engineers': 'Bridge-building equipment',
        'demo-engineers': 'Equipped with demolition gear.',
        'fire-engineers': 'Firefighting equipment.',
        'mine-engineers': 'Minesweeper equipment',
        'trench-engineers': 'Trench/Fieldwork equipment',
        'marines': 'No penalties for vacuum or zero-G',
        'mountain-troops': 'Mountain climbing equipment. Unit can traverse 3 levels per hex. Unit is immune to the effects of Thin Atmosphere.',
        'paramedics': 'Paramedic equipment.',
        'paratroops': 'May use Atmospheric Drops rules.',
        'sensor-engineers': 'Surveillance and communication equipment',
        'tag-troops': 'Equipped with TAG (Range 3/6/9)',
        'xct': 'Xenoplanetary Condition-Trained',
        'scuba': '',
    };
    for (const specialization of entity.specializations()) {
        const note = specializationNotes[specialization];
        if (note) notes.push(note);
    }
    if (entity.effectiveSneakECM()) notes.push('Invisible to standard/light active probes.');
    const augmentations = entity.augmentations().map(id =>
        PILOT_ABILITIES.find(ability => ability.id === id)?.name ?? INFANTRY_AUGMENTATION_NAMES[id] ?? id);
    if (augmentations.length > 0) notes.push(`Cybernetically enhanced: ${augmentations.join(', ')}`);
    return notes.join(' ') || 'None';
}

function infantryMovementRows(entity: InfantryEntity): readonly { id: string; value: number; label: string }[] {
    const mount = entity.mount();
    const motive = mount?.movementMode ?? entity.motiveType();
    const ground = { id: 'mpWalk', value: entity.walkMP(), label: 'Ground' };
    let rows: { id: string; value: number; label: string }[];
    if (motive === 'Jump') rows = [{ id: 'mpJump', value: entity.jumpMP(), label: 'Jump' }, ground];
    else if (motive === 'VTOL') rows = [{ id: 'mpJump', value: entity.jumpMP(),
        label: entity.isMicrolite() ? 'VTOL (Microlite)' : 'VTOL (Micro-copter)' }];
    else if (motive === 'UMU' || motive === 'Submarine') {
        rows = [{ id: 'mpJump', value: entity.umuMP(), label: motive === 'Submarine' ? 'Mechanized SCUBA'
            : entity.isMotorizedScuba() ? 'SCUBA (Motorized)' : 'SCUBA' }];
        if (motive === 'Submarine' && entity.originalWalkMP() > 0) rows.push(ground);
    } else rows = [{ ...ground, label: ['Tracked', 'Wheeled', 'Hover'].includes(motive)
        ? `Mechanized ${motive}` : motive === 'Motorized' ? 'Motorized' : 'Ground' }];
    if (mount) rows[0].label += ` [beast: ${mount.name}]`;
    return rows;
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
    const combat = projectConventionalInfantryCombat(entity);
    const columns = INFANTRY_STRENGTH_CELL_COUNT;
    const left = 116.6;
    const top = 25.139;
    const width = 451.4;
    const cellWidth = width / columns;
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
    addText(track, '*Damage is always applied in 2-point Damage Value groupings', 3, 64.254, {
        size: 5.7, maxWidth: 220,
    });
    addText(track, 'RANGE IN HEXES (TO-HIT MODIFIER)', 225.7, 64.254, {
        size: 6.2, weight: 700, maxWidth: 220,
    });
    addText(track, 'Range:', 3, 71.393, { size: 6.2, weight: 700 });
    addText(track, 'Range Modifier:', 3, 78.532, { size: 6.2, weight: 700 });
    for (let range = 0; range <= 21; range++) {
        const columnX = 65.356 + range * 17.816;
        addText(track, String(range), columnX, 71.393, { size: 6.2, weight: 700, anchor: 'middle' });
    }
    const displayHost = svgElement('g');
    displayHost.id = INFANTRY_STRENGTH_DISPLAY_ID;
    track.appendChild(displayHost);
    createInfantryStrengthDisplay(svg, displayHost).render(combat, {
        maximum: combat.maximumStrength,
        committedRemaining: combat.maximumStrength,
        previewRemaining: combat.maximumStrength,
    }, false);
    drawInfantryFieldGuns(track, entity);
    group.appendChild(track);
}

function drawInfantryFieldGuns(track: SVGGElement, entity: InfantryEntity): void {
    const mounts = entity.equipment().filter(mount => mount.location === 'Field Guns');
    const guns = mounts.filter(mount => mount.equipment instanceof WeaponEquipment);
    const gun = guns[0];
    if (!gun || !(gun.equipment instanceof WeaponEquipment)) return;
    const weapon = gun.equipment;
    const ammo = mounts.reduce((sum, mount) => sum + (mount.equipment instanceof AmmoEquipment ? mount.equipment.shots : 0), 0);
    const group = svgElement('g');
    group.id = 'field_gun_columns';
    // Field guns omit Gauss explosion labels and have their own switchable-ammo notation.
    let damage = `${weapon.damage} [DB]`;
    let damageNotes = '';
    if (weapon.hasFlag('F_ARTILLERY')) {
        damage = `${weapon.rackSize} ${weapon.ammoType.endsWith('_CANNON') ? '[DB,AE]' : '[AE,S,F]'}`;
    } else if (['AC_ULTRA', 'AC_ULTRA_THB', 'AC_ROTARY'].includes(weapon.ammoType)) {
        damage = `${weapon.damage}/Sht, R${weapon.ammoType === 'AC_ROTARY' ? 6 : 2}`;
        damageNotes = '[DB,R/S/C]';
    } else if (['AC', 'AC_PRIMITIVE', 'LAC', 'AC_LBX', 'AC_LBX_THB'].includes(weapon.ammoType)) {
        damage = String(weapon.damage);
        damageNotes = ['AC_LBX', 'AC_LBX_THB'].includes(weapon.ammoType) ? '[DB,C/F]' : '[DB,C/S/F]';
    }
    const columns: readonly [string, string, string, number, number][] = [
        ['qty', 'Qty', String(guns.length), 6, 12],
        ['type', 'Field Gun Type', weapon.name, 20.816, 64],
        ['dmg', 'Dmg', damage, 87.626, 33],
        ['min_range', 'Min', weapon.minimumRange > 0 ? String(weapon.minimumRange) : '—', 123.258, 12],
        ['short', 'S', String(weapon.ranges[0]), 136.62, 12],
        ['med', 'M', String(weapon.ranges[1]), 149.982, 12],
        ['long', 'L', String(weapon.ranges[2]), 163.344, 12],
        ['ammo', 'Ammo', String(ammo), 181.16, 20],
        ['crew', 'Crew', String(Math.ceil(gun.getTonnage(entity) ?? 0)), 203.43, 20],
    ];
    for (const [id, label, value, x, width] of columns) {
        addText(group, label, x, 92.811, { size: 6.2, weight: 700, maxWidth: width });
        const text = addText(group, value, x, 99.95, { size: 6.2, maxWidth: width });
        text.id = `field_gun_${id}`;
    }
    if (damageNotes) {
        const notes = addText(group, damageNotes, 87.626, 107.09, { size: 6.2, maxWidth: 33 });
        notes.id = 'field_gun_dmg_2';
    }
    track.appendChild(group);
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
