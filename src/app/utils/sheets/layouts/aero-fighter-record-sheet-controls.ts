// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AeroEntity } from '../../../models/entity/entities/aero/aero-entity';
import { systemDamageControls } from '../../../models/runtime/system-damage-presentation';
import {
type Box,
drawCrewHitGrid,
addFrame,
addLine,
addText,
drawCriticalDamageBox,
transparentRect,
} from '../record-sheet-svg-rendering';
import { AERO_LOWER_PANEL_TAB_NOTCH, appendAeroSkillRows } from './aero-record-sheet-components';

/** Critical and pilot controls shared by fighter and small-craft templates. */
export function drawFighterCriticalPanel(svg: SVGSVGElement, entity: AeroEntity, box: Box): void {
    const group = addFrame(svg, 'CRITICAL DAMAGE', box, {
        bottomLeftNotchWidth: box.width * AERO_LOWER_PANEL_TAB_NOTCH,
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
            drawCriticalDamageBox(group, id, { x: x(controlX), y: y(row.y), width: x(controlWidth), height: y(12) },
                { text: row.modifiers[index], size: font(row.ids.length > 3 ? 4.8 : 5.7) }, sx);
        });
    });
}

export function drawFighterPilotPanel(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'PILOT DATA', box, {
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
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

    appendAeroSkillRows(group, { x, y, font }, 42);

    drawCrewHitGrid(group, 0, {
        x: x(48.86), y: y(50), cellWidth: x(87.74 / 6), cellHeight: y(10),
        labelX: x(3), labelWidth: x(42.86), fontScale: font(1), mode: 'aero-pilot',
    });
}
