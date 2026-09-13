// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AeroEntity } from '../../../models/entity/entities/aero/aero-entity';
import { systemDamageControls } from '../../../models/runtime/system-damage-presentation';
import {
type Box,
addCrewSkillValue,
drawCrewHitGrid,
addFrame,
addLine,
addText,
setAttributes,
svgElement,
transparentRect,
} from '../record-sheet-svg-rendering';

/** Critical and pilot controls shared by fighter and small-craft templates. */
export function drawFighterCriticalPanel(svg: SVGSVGElement, entity: AeroEntity, box: Box): void {
    const group = addFrame(svg, 'CRITICAL DAMAGE', box, {
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    const sx = box.width / 220.4;
    const sy = box.height / 93.934;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);
    const rows = [
        { label: 'Avionics', x: 6, y: 26.465, ...systemDamageControls(entity, 'avionics') },
        { label: 'FCS', x: 6, y: 43.395, ...systemDamageControls(entity, 'fire-control') },
        { label: 'Sensors', x: 6, y: 60.325, ...systemDamageControls(entity, 'sensors') },
        { label: 'Engine', x: 112.7, y: 26.465, ...systemDamageControls(entity, 'engine') },
        { label: 'Landing Gear', x: 112.7, y: 43.395, ...systemDamageControls(entity, 'landing-gear') },
        { label: 'Life Support', x: 112.7, y: 60.325, ...systemDamageControls(entity, 'life-support') },
    ];
    rows.forEach(row => {
        addText(group, row.label, x(row.x), y(row.y + 9.6), {
            size: font(6.76), maxWidth: x(48),
        });
        row.ids.forEach((id, index) => {
            const cellWidth = Math.min(15, 45 / Math.max(1, row.ids.length));
            const controlWidth = Math.min(12, cellWidth - 1);
            const controlX = row.x + 53.73 + (row.ids.length === 1 ? 30 : index * cellWidth);
            const control = svgElement('rect');
            control.id = id;
            control.setAttribute('critId', id);
            setAttributes(control, {
                x: x(controlX), y: y(row.y), width: x(controlWidth), height: y(12), rx: x(1.315),
                fill: 'none', stroke: '#000', 'stroke-width': 0.96,
                class: 'critLoc criticalPip',
            });
            group.appendChild(control);
            const modifier = addText(group, row.modifiers[index], x(controlX + controlWidth / 2), y(row.y + 7.6), {
                size: font(row.ids.length > 3 ? 4.8 : 5.7), anchor: 'middle', maxWidth: x(controlWidth - 1),
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
    const gunnery = addCrewSkillValue(group, '4', x(47.672), y(42), font(1));
    gunnery.id = 'gunnerySkill0';
    addLine(group, x(47.672), y(43), x(65.82), y(43), '#000', 0.72);
    addText(group, 'Piloting Skill:', x(69.8), y(42), { size: font(6.76), weight: 700, maxWidth: x(36.72) });
    const piloting = addCrewSkillValue(group, '5', x(114.472), y(42), font(1));
    piloting.id = 'pilotingSkill0';
    addLine(group, x(114.472), y(43), x(136.6), y(43), '#000', 0.72);
    for (const [skill, left, width] of [['gunnery', 44, 24], ['piloting', 111, 27]] as const) {
        const button = transparentRect(x(left), y(33), x(width), y(13), 'crewSkillButton');
        button.setAttribute('crewId', '0');
        button.setAttribute('skill', skill);
        group.appendChild(button);
    }

    drawCrewHitGrid(group, 0, {
        x: x(48.86), y: y(50), cellWidth: x(87.74 / 6), cellHeight: y(10),
        labelX: x(3), labelWidth: x(42.86), fontScale: font(1), mode: 'aero-pilot',
    });
    const state = transparentRect(x(2), y(17), x(138), y(70), 'crewStateButton');
    state.setAttribute('crewId', '0');
    group.insertBefore(state, group.children[2] ?? null);
}
