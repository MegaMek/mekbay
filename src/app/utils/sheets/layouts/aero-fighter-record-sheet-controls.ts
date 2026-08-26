// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    type Box,
    addFrame,
    addLine,
    addText,
    formatNumber,
    setAttributes,
    svgElement,
    transparentRect,
} from '../record-sheet-svg-rendering';

/** Critical and pilot controls shared by fighter and small-craft templates. */
export function drawFighterCriticalPanel(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'CRITICAL DAMAGE', box, {
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    const sx = box.width / 220.4;
    const sy = box.height / 93.934;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);
    const rows: readonly {
        readonly label: string;
        readonly x: number;
        readonly y: number;
        readonly ids: readonly string[];
        readonly modifiers: readonly string[];
    }[] = [
        { label: 'Avionics', x: 6, y: 26.465, ids: ['avionics_hit_1', 'avionics_hit_2', 'avionics_hit_3'], modifiers: ['+1', '+2', '+5'] },
        { label: 'FCS', x: 6, y: 43.395, ids: ['fcs_hit_1', 'fcs_hit_2', 'fcs_hit_3'], modifiers: ['+2', '+4', 'D'] },
        { label: 'Sensors', x: 6, y: 60.325, ids: ['sensor_hit_1', 'sensor_hit_2', 'sensor_hit_3'], modifiers: ['+1', '+2', '+5'] },
        { label: 'Engine', x: 112.7, y: 26.465, ids: ['engine_hit_1', 'engine_hit_2', 'engine_hit_3'], modifiers: ['2', '4', 'D'] },
        { label: 'Landing Gear', x: 112.7, y: 43.395, ids: ['landing_gear_hit_1'], modifiers: ['+5'] },
        { label: 'Life Support', x: 112.7, y: 60.325, ids: ['life_support_hit_1'], modifiers: ['+2'] },
    ];
    rows.forEach(row => {
        addText(group, row.label, x(row.x), y(row.y + 9.6), {
            size: font(6.76), maxWidth: x(48),
        });
        row.ids.forEach((id, index) => {
            const controlX = row.x + 53.73 + (row.ids.length === 1 ? 30 : index * 15);
            const control = svgElement('rect');
            control.id = id;
            control.setAttribute('critId', id);
            setAttributes(control, {
                x: x(controlX), y: y(row.y), width: x(12), height: y(12), rx: x(1.315),
                fill: 'none', stroke: '#000', 'stroke-width': 0.96,
                class: 'critLoc criticalPip',
            });
            group.appendChild(control);
            const modifier = addText(group, row.modifiers[index], x(controlX + 6), y(row.y + 7.6), {
                size: font(5.7), anchor: 'middle', maxWidth: x(9),
            });
            modifier.style.pointerEvents = 'none';
        });
    });
}

export function drawFighterPilotPanel(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'PILOT DATA', box, {
        cornerAngleDegrees: { topRight: 0, bottomLeft: 0, bottomRight: 45 },
    });
    const sx = box.width / 142.6;
    const sy = box.height / 93.934;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);

    addText(group, 'Name:', x(3), y(30), { size: font(6.76), weight: 700 });
    const name = addText(group, '', x(25.228), y(30), { size: font(6.76), maxWidth: x(111.372) });
    name.id = 'pilotName0';
    addLine(group, x(25.228), y(31), x(136.6), y(31), '#000', 0.72);
    const nameButton = transparentRect(x(23), y(20), x(115), y(14), 'crewNameButton');
    nameButton.setAttribute('crewId', '0');
    nameButton.setAttribute('textElement', name.id);
    group.appendChild(nameButton);

    addText(group, 'Gunnery Skill:', x(3), y(42), { size: font(6.76), weight: 700, maxWidth: x(39.172) });
    const gunnery = addText(group, '4', x(47.672), y(42), { size: font(6.76), class: 'skillValue' });
    gunnery.id = 'gunnerySkill0';
    addLine(group, x(47.672), y(43), x(65.82), y(43), '#000', 0.72);
    addText(group, 'Piloting Skill:', x(69.8), y(42), { size: font(6.76), weight: 700, maxWidth: x(36.72) });
    const piloting = addText(group, '5', x(114.472), y(42), { size: font(6.76), class: 'skillValue' });
    piloting.id = 'pilotingSkill0';
    addLine(group, x(114.472), y(43), x(136.6), y(43), '#000', 0.72);
    for (const [skill, left, width] of [['gunnery', 44, 24], ['piloting', 111, 27]] as const) {
        const button = transparentRect(x(left), y(33), x(width), y(13), 'crewSkillButton');
        button.setAttribute('crewId', '0');
        button.setAttribute('skill', skill);
        group.appendChild(button);
    }

    const table = svgElement('path');
    table.setAttribute('d', `M${formatNumber(x(48.86))} ${formatNumber(y(51.015))} Q${formatNumber(x(48.86))} ${formatNumber(y(50))} ${formatNumber(x(49.875))} ${formatNumber(y(50))} H${formatNumber(x(135.585))} Q${formatNumber(x(136.6))} ${formatNumber(y(50))} ${formatNumber(x(136.6))} ${formatNumber(y(51.015))} V${formatNumber(y(68.985))} Q${formatNumber(x(136.6))} ${formatNumber(y(70))} ${formatNumber(x(135.585))} ${formatNumber(y(70))} H${formatNumber(x(121.977))} V${formatNumber(y(78.985))} Q${formatNumber(x(121.977))} ${formatNumber(y(80))} ${formatNumber(x(120.962))} ${formatNumber(y(80))} H${formatNumber(x(49.875))} Q${formatNumber(x(48.86))} ${formatNumber(y(80))} ${formatNumber(x(48.86))} ${formatNumber(y(78.985))} Z`);
    setAttributes(table, { fill: 'none', stroke: '#000', 'stroke-width': 1 });
    group.appendChild(table);
    addLine(group, x(48.86), y(60), x(136.6), y(60), '#000', 0.58);
    addLine(group, x(48.86), y(70), x(121.977), y(70), '#000', 0.58);
    const columns = [56.172, 70.795, 85.418, 100.042, 114.665, 129.288];
    columns.slice(1).forEach(column => addLine(group, x(column - 7.312), y(50), x(column - 7.312), y(80), '#000', 0.58));
    const consciousness = ['3', '5', '7', '10', '11', 'Dead'];
    columns.forEach((column, index) => {
        addText(group, String(index + 1), x(column), y(57), { size: font(5.8), weight: 700, anchor: 'middle' });
        addText(group, consciousness[index], x(column), y(67), { size: font(5.8), weight: 700, anchor: 'middle' });
        if (index < 5) addText(group, `+${index + 1}`, x(column), y(77), {
            size: font(5.8), weight: 700, anchor: 'middle',
        });
        const hit = transparentRect(x(column - 7.2), y(50), x(14.4), y(10), 'crewHit');
        hit.id = `crew_damage_0_${index + 1}`;
        hit.setAttribute('crewId', '0');
        hit.setAttribute('hit', String(index + 1));
        group.appendChild(hit);
    });
    addText(group, 'Hits Taken', x(45.86), y(57), { size: font(5.2), weight: 700, anchor: 'end' });
    addText(group, 'Consciousness #', x(45.86), y(67), { size: font(5.2), weight: 700, anchor: 'end' });
    addText(group, 'Modifier', x(45.86), y(77), { size: font(5.2), weight: 700, anchor: 'end' });
    const state = transparentRect(x(2), y(17), x(138), y(70), 'crewStateButton');
    state.setAttribute('crewId', '0');
    group.insertBefore(state, group.children[2] ?? null);
}
