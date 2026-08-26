// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { RecordSheetPageProfile } from '../record-sheet-layout';
import {
    type Box,
    addFrame,
    addText,
    scalePageBox,
    setAttributes,
    svgElement,
} from '../record-sheet-svg-rendering';
import {
    addExactReferenceText,
    addReferenceShade,
    canonicalReferenceContent,
} from './record-sheet-reference-table-components';

/** VTOL-only rules references. These deliberately live with the vehicle family,
 * rather than behind entity-type branches in the application-level generator. */
export function drawVtolReferenceTables(svg: SVGSVGElement, page: RecordSheetPageProfile): void {
    drawVtolHitLocationReference(svg, scalePageBox(page, {
        x: 18.966, y: 399, width: 323.79, height: 210.1,
    }));
    drawVtolElevationTrack(svg, scalePageBox(page, {
        x: 350.286, y: 399, width: 241.18, height: 121.66,
    }));
    drawVtolPhysicalAttacksReference(svg, scalePageBox(page, {
        x: 350.286, y: 524.16, width: 241.18, height: 81.94,
    }));
    drawVtolCriticalReference(svg, scalePageBox(page, {
        x: 18.966, y: 615.6, width: 571, height: 136.4,
    }));
}

function drawVtolHitLocationReference(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'VTOL COMBAT VEHICLE HIT LOCATION TABLE', box, { fullWidthHeader: true });
    const content = canonicalReferenceContent(group, box, 323.79, 210.1);
    for (const y of [40.5, 54.5, 68.5, 82.5, 96.5]) {
        addReferenceShade(content, 24, y, 256, 7);
    }
    addText(content, 'ATTACK DIRECTION', 176.176, 25, {
        size: 5.7, weight: 700, anchor: 'middle',
    });
    const columns = [32.032, 96.096, 176.176, 256.256];
    ['2D6 Roll', 'FRONT', 'REAR', 'SIDE'].forEach((heading, index) => addText(
        content, heading, columns[index], 32,
        { size: 5.7, weight: 700, anchor: 'middle' },
    ));
    const rows: readonly (readonly string[])[] = [
        ['2*', 'Front (critical)', 'Rear (critical)', 'Side (critical)'],
        ['3', 'Rotors†', 'Rotors†', 'Rotors†'],
        ['4', 'Turret‡', 'Turret‡', 'Turret‡'],
        ['5', 'Right Side', 'Left Side', 'Front'],
        ['6', 'Front', 'Rear', 'Side'],
        ['7', 'Front', 'Rear', 'Side'],
        ['8', 'Front', 'Rear', 'Side (critical)*'],
        ['9', 'Left Side', 'Right Side', 'Rear'],
        ['10', 'Rotors†', 'Rotors†', 'Rotors†'],
        ['11', 'Rotors†', 'Rotors†', 'Rotors†'],
        ['12*', 'Rotors (critical)†', 'Rotors (critical)†', 'Rotors (critical)†'],
    ];
    rows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => addText(
        content,
        value,
        columns[columnIndex],
        39 + rowIndex * 7,
        { size: 5.7, weight: columnIndex === 0 ? 700 : undefined, anchor: 'middle' },
    )));
    const notes: readonly [string, number, number?][] = [
        ['* A result of 2 or 12 (or an 8 if the attack strikes the side) may inflict a critical hit on the VTOL. For each such attack, apply', 132.6, 311.32],
        ['damage normally to the armor in that section. The attacking player then immediately rolls once on the VTOL Combat Vehicle', 139.6, 311.32],
        ['Critical Hits Table, below.', 146.6],
        ['† Damage Value / 10 (round up); see Rotor Hits, p. 197, Total Warfare. Additionally, damage to rotors slows down the', 153.6, 311.32],
        ['VTOL. Each hit reduces the VTOL’s Cruising MP by 1, meaning that the controlling player must also recalculate Flank MP;', 160.6, 311.32],
        ['multiply the new Cruising MP by 1.5 and round up. As with all damage, such movement penalties do not apply until the end', 167.6, 311.32],
        ['of the phase in which the damage occurred.', 174.6],
        ['‡ If the VTOL has no turret, a turret strike hits Rotors†', 181.6],
    ];
    notes.forEach(([value, y, width]) => addExactReferenceText(content, value, 6, y, 5.7, width));
}

function drawVtolElevationTrack(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'VTOL ELEVATION TRACK', box, { fullWidthHeader: true });
    const content = canonicalReferenceContent(group, box, 241.18, 121.66);
    drawElevationGrid(content, 28.216, 58.864);
    drawElevationGrid(content, 74.188, 104.836);
    drawElevationRow(content, 1, 38.54, 53.864);
    drawElevationRow(content, 16, 84.512, 99.836);
}

function drawElevationGrid(content: SVGGElement, top: number, bottom: number): void {
    const outline = svgElement('rect');
    setAttributes(outline, {
        x: 4.5, y: top, width: 230.68, height: bottom - top,
        rx: 1.315, fill: 'none', stroke: '#000', 'stroke-width': 1,
    });
    content.appendChild(outline);
    const horizontal = svgElement('line');
    setAttributes(horizontal, {
        x1: 4.5, y1: top + 15.324, x2: 235.18, y2: top + 15.324,
        stroke: '#000', 'stroke-width': 0.58,
    });
    content.appendChild(horizontal);
    for (let index = 0; index <= 15; index++) {
        const vertical = svgElement('line');
        const x = 50.636 + index * 12.003;
        setAttributes(vertical, { x1: x, y1: top, x2: x, y2: bottom, stroke: '#000', 'stroke-width': 0.58 });
        content.appendChild(vertical);
    }
}

function drawElevationRow(
    content: SVGGElement,
    firstTurn: number,
    turnY: number,
    elevationY: number,
): void {
    addText(content, 'Turn', 7.5, turnY, { size: 6.76, weight: 700 });
    addText(content, 'Elevation', 7.5, elevationY, { size: 6.76, weight: 700 });
    for (let index = 0; index < 15; index++) {
        addText(content, String(firstTurn + index), 56.637 + index * 12.003, turnY, {
            size: 6.76, weight: 700, anchor: 'middle', maxWidth: 10.8,
        });
    }
}

function drawVtolPhysicalAttacksReference(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'PHYSICAL ATTACKS AGAINST VTOLS TABLE', box, { fullWidthHeader: true });
    const content = canonicalReferenceContent(group, box, 241.18, 81.94);
    const columns = [40.236, 165.676];
    addText(content, 'DIFFERENCE IN LEVELS', columns[0], 31.72, {
        size: 5.7, weight: 700, anchor: 'middle',
    });
    addText(content, 'TYPES OF PHYSICAL ATTACKS ALLOWED', columns[1], 31.72, {
        size: 5.7, weight: 700, anchor: 'middle',
    });
    const rows: readonly [string, string][] = [
        ['-1 or lower', 'None'],
        ['0', 'All except Punch'],
        ['1-2', 'All except Kick'],
        ['3', 'Club and Physical Weapons Only'],
        ['4+', 'None'],
    ];
    rows.forEach(([difference, attack], index) => {
        const y = 38.72 + index * 7;
        addText(content, difference, columns[0], y, { size: 5.7, weight: 700, anchor: 'middle' });
        addText(content, attack, columns[1], y, { size: 5.7, anchor: 'middle' });
    });
}

function drawVtolCriticalReference(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'VTOL COMBAT VEHICLE CRITICAL HITS TABLE', box, { fullWidthHeader: true });
    const content = canonicalReferenceContent(group, box, 571, 136.4);
    for (const y of [43.5, 59.5, 75.5, 91.5]) addReferenceShade(content, 47, y, 470, 8);
    addText(content, 'LOCATION HIT', 306.72, 26, { size: 7.2, weight: 700, anchor: 'middle' });
    const columns = [56.8, 119.28, 198.8, 301.04, 403.28, 482.8];
    ['2D6 Roll', 'FRONT', 'SIDE', 'REAR', 'ROTORS', 'TURRET'].forEach((heading, index) => addText(
        content, heading, columns[index], 34, { size: 7.2, weight: 700, anchor: 'middle' },
    ));
    const rows: readonly (readonly string[])[] = [
        ['2-5', 'No Critical Hit', 'No Critical Hit', 'No Critical Hit', 'No Critical Hit', 'No Critical Hit'],
        ['6', 'Co-Pilot Hit', 'Weapon Malfunction', 'Cargo/Infantry Hit', 'Rotor Damage', 'Stabilizer'],
        ['7', 'Weapon Malfunction', 'Cargo/Infantry Hit', 'Weapon Malfunction', 'Rotor Damage', 'Turret Jam'],
        ['8', 'Stabilizer', 'Stabilizer', 'Stabilizer', 'Rotor Damage', 'Weapon Malfunction'],
        ['9', 'Sensors', 'Weapon Destroyed', 'Weapon Destroyed', 'Flight Stabilizer Hit', 'Turret Locks'],
        ['10', 'Pilot Hit', 'Engine Hit', 'Sensors', 'Flight Stabilizer Hit', 'Weapon Destroyed'],
        ['11', 'Weapon Destroyed', 'Ammunition**', 'Engine Hit', 'Rotors Destroyed', 'Ammunition**'],
        ['12', 'Crew Killed', 'Fuel Tank*', 'Fuel Tank*', 'Rotors Destroyed', 'Turret Blown Off'],
    ];
    rows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => addText(
        content,
        value,
        columns[columnIndex],
        42 + rowIndex * 8,
        { size: 7.2, weight: columnIndex === 0 ? 700 : undefined, anchor: 'middle' },
    )));
    addText(content, '*Only if the VTOL has an ICE engine. For VTOLs with fusion engines, treat this result as Engine Hit.', 56.8, 113, {
        size: 5.7,
    });
    addText(content, '** If the VTOL carries no ammunition, treat this result as Weapon Destroyed.', 56.8, 120, {
        size: 5.7,
    });
}
