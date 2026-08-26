// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { RecordSheetPageProfile } from '../record-sheet-layout';
import {
    type Box,
    addFrame,
    addText,
    scalePageBox,
} from '../record-sheet-svg-rendering';
import {
    addExactReferenceText,
    addReferenceShade,
    canonicalReferenceContent,
} from './record-sheet-reference-table-components';

/** Printable rules references shared by ground vehicles and naval vehicles. */
export function drawVehicleReferenceTables(svg: SVGSVGElement, page: RecordSheetPageProfile): void {
    drawVehicleHitLocationReference(svg, scalePageBox(page, { x: 18.966, y: 399, width: 323.79, height: 210.1 }));
    drawVehicleMotiveReference(svg, scalePageBox(page, { x: 350.286, y: 399, width: 241.18, height: 210.1 }));
    drawVehicleCriticalReference(svg, scalePageBox(page, { x: 18.966, y: 615.6, width: 571, height: 136.4 }));
}

export function drawVehicleHitLocationReference(
    svg: SVGSVGElement,
    box: Box,
    title = 'GROUND COMBAT VEHICLE HIT LOCATION TABLE',
): void {
    const group = addFrame(svg, title, box, { fullWidthHeader: true });
    const content = canonicalReferenceContent(group, box, 323.79, 210.1);
    for (const y of [40.5, 54.5, 68.5, 82.5, 96.5]) {
        addReferenceShade(content, 24, y, 256, 7);
    }
    addText(content, 'ATTACK DIRECTION', 176.176, 25, { size: 5.7, weight: 700, anchor: 'middle' });
    const headings = ['2D6 Roll', 'FRONT', 'REAR', 'SIDE§'];
    const columns = [32.032, 96.096, 176.176, 256.256];
    headings.forEach((heading, index) => addText(content, heading, columns[index], 32, {
        size: 5.7, weight: 700, anchor: 'middle',
    }));
    const rows: readonly (readonly string[])[] = [
        ['2*', 'Front (critical)', 'Rear (critical)', 'Side (critical)'],
        ['3', 'Front†', 'Rear†', 'Side†'],
        ['4', 'Front†', 'Rear†', 'Side†'],
        ['5', 'Right Side†', 'Left Side†', 'Front†'],
        ['6', 'Front', 'Rear', 'Side'],
        ['7', 'Front', 'Rear', 'Side'],
        ['8', 'Front', 'Rear', 'Side (critical)*'],
        ['9', 'Left Side†', 'Right Side†', 'Rear†'],
        ['10', 'Turret', 'Turret', 'Turret'],
        ['11', 'Turret', 'Turret', 'Turret'],
        ['12*', 'Turret (critical)', 'Turret (critical)', 'Turret (critical)'],
    ];
    rows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => addText(
        content,
        value,
        columns[columnIndex],
        39 + rowIndex * 7,
        { size: 5.7, weight: columnIndex === 0 ? 700 : undefined, anchor: 'middle' },
    )));
    const notes: readonly [string, number, number?][] = [
        ['* A result of 2 or 12 (or an 8 if the attack strikes the side) may inflict a critical hit on the vehicle. For each result of 2 or', 132.6, 311.32],
        ['12 (or 8 for side attacks), apply damage normally to the armor in that section. The attacking player then automatically rolls', 139.6, 311.32],
        ['once on the Ground Combat Vehicle Critical Hits Table below (see Combat, p. 192, in Total Warfare for more information).', 146.6, 287],
        ['A result of 12 on the Ground Combat Vehicles Hit Location Table may inflict critical hit against the turret; if the vehicle has', 153.6, 311.32],
        ['no turret, a 12 indicates the chance of a critical hit on the side corresponding to the attack direction.', 160.6],
        ['† The vehicle may suffer motive system damage even if its armor remains intact. Apply damage normally to the armor in', 167.6, 311.32],
        ['that section, but the attacking player also rolls once on the Motive System Damage Table at right (see Combat, p. 192, in', 174.6, 311.32],
        ['Total Warfare for more information). Apply damage at the end of the phase in which the damage takes effect.', 181.6, 286],
        ['§ Side hits strike the side as indicated by the attack direction. For example, if an attack hits the right side, all Side results', 188.6, 311.32],
        ['strike the right side armor. If the vehicle has no turret, a turret hit strikes the armor on the side attacked.', 195.6],
    ];
    notes.forEach(([value, y, width]) => addExactReferenceText(content, value, 6, y, 5.7, width));
}

export function drawVehicleMotiveReference(
    svg: SVGSVGElement,
    box: Box,
    title = 'MOTIVE SYSTEM DAMAGE TABLE',
): void {
    const group = addFrame(svg, title, box, { fullWidthHeader: true });
    const content = canonicalReferenceContent(group, box, 241.18, 210.1);
    for (const [y, height] of [[34.5, 7], [48.5, 14], [69.5, 14]] as const) {
        addReferenceShade(content, 23, y, 194, height);
    }
    addText(content, '2D6 ROLL', 35.502, 25, { size: 5.7, weight: 700, anchor: 'middle' });
    addText(content, 'EFFECT*', 63.904, 25, { size: 5.7, weight: 700 });
    const rolls: readonly [string, number][] = [['2-5', 32], ['6-7', 39], ['8-9', 46], ['10-11', 60], ['12', 74]];
    rolls.forEach(([value, y]) => addText(content, value, 35.502, y, { size: 5.7, weight: 700, anchor: 'middle' }));
    const effects: readonly [string, number][] = [
        ['No Effect', 32],
        ['Minor damage; +1 modifier to all Driving Skill Rolls', 39],
        ['Moderate damage; -1 Cruising MP, +2 modifier to all', 46],
        ['Driving Skill Rolls', 53],
        ['Heavy damage; only half Cruising MP (round fractions up),', 60],
        ['+3 modifier to all Driving Skill Rolls', 67],
        ['Major damage; no movement for the rest of the game', 74],
        ['Vehicle is immobile.', 81],
    ];
    effects.forEach(([value, y]) => addText(content, value, 63.904, y, { size: 5.7 }));

    addText(content, 'Attack Direction Modifier:', 11.834, 95, { size: 5.7, weight: 700 });
    addText(content, 'Hit from rear', 11.834, 102, { size: 5.7 });
    addText(content, '+1', 88.755, 102, { size: 5.7 });
    addText(content, 'Hit from the sides', 11.834, 109, { size: 5.7 });
    addText(content, '+2', 88.755, 109, { size: 5.7 });
    addText(content, 'Vehicle Type Modifier:', 130.174, 95, { size: 5.7, weight: 700 });
    const vehicleModifiers: readonly [string, string, number][] = [
        ['Tracked, Naval', '+0', 102],
        ['Wheeled', '+2', 109],
        ['Hovercraft, Hydrofoil', '+3', 116],
        ['WiGE', '+4', 123],
    ];
    vehicleModifiers.forEach(([label, modifier, y]) => {
        addText(content, label, 130.174, y, { size: 5.7 });
        addText(content, modifier, 207.095, y, { size: 5.7 });
    });
    const notes: readonly string[] = [
        '*All movement and Driving Skill Roll penalties are cumulative. However, each Driving Skill Roll',
        'modifier can only be applied once. For example, if a roll of 6-7 is made for a vehicle, inflicting',
        'a +1 modifier, that is the only time that particular +1 can be applied; a subsequent roll of 6-7',
        'has no additional effect. This means the maximum Driving Skill Roll modifier that can be',
        'inflicted from the Motive System Damage Table is +6. If a unit’s Cruising MP is reduced',
        'to 0, it cannot move for the rest of the game, but is not considered an immobile target. In',
        'addition, all motive system damage takes effect at the end of the phase in which the damage',
        'occurred. For example, if two units are attacking the same Combat Vehicle during the',
        'Weapon Attack Phase and the first unit inflicts motive system damage and rolls a 12, the -4',
        'immobile target modifier would not apply for the second unit. However, the -4 modifier would',
        'take effect during the Physical Attack Phase. If a hover vehicle is rendered immobile while',
        'over a Depth 1 or deeper water hex, it sinks and is destroyed.',
    ];
    notes.forEach((value, index) => addExactReferenceText(content, value, 6, 131.5 + index * 5, 4.8,
        index < notes.length - 1 ? 227.68 : undefined));
}

export function drawVehicleCriticalReference(
    svg: SVGSVGElement,
    box: Box,
    title = 'GROUND COMBAT VEHICLE CRITICAL HITS TABLE',
): void {
    const group = addFrame(svg, title, box, { fullWidthHeader: true });
    const content = canonicalReferenceContent(group, box, 571, 136.4);
    for (const y of [43.5, 59.5, 75.5, 91.5]) addReferenceShade(content, 77, y, 418, 8);
    addText(content, 'LOCATION HIT', 306.72, 26, { size: 7.2, weight: 700, anchor: 'middle' });
    const rows: readonly (readonly string[])[] = [
        ['2–5', 'No Critical Hit', 'No Critical Hit', 'No Critical Hit', 'No Critical Hit'],
        ['6', 'Driver Hit', 'Cargo/Infantry Hit', 'Weapon Malfunction', 'Stabilizer'],
        ['7', 'Weapon Malfunction', 'Weapon Malfunction', 'Cargo/Infantry Hit', 'Turret Jam'],
        ['8', 'Stabilizer', 'Crew Stunned', 'Stabilizer', 'Weapon Malfunction'],
        ['9', 'Sensors', 'Stabilizer', 'Weapon Destroyed', 'Turret Locks'],
        ['10', 'Commander Hit', 'Weapon Destroyed', 'Engine Hit', 'Weapon Destroyed'],
        ['11', 'Weapon Destroyed', 'Engine Hit', 'Ammunition', 'Ammunition'],
        ['12', 'Crew Killed', 'Fuel Tank', 'Fuel Tank', 'Turret Blown Off'],
    ];
    const columns = [85.2, 153.36, 255.6, 357.84, 460.08];
    ['2D6 Roll', 'FRONT', 'SIDE', 'REAR', 'TURRET'].forEach((heading, index) => addText(
        content, heading, columns[index], 34, { size: 7.2, weight: 700, anchor: 'middle' },
    ));
    rows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
        const suffix = (rowIndex === 6 && columnIndex >= 3) ? '**'
            : (rowIndex === 7 && (columnIndex === 2 || columnIndex === 3)) ? '*'
                : '';
        addText(content, `${value}${suffix}`, columns[columnIndex], 42 + rowIndex * 8, {
            size: 7.2,
            weight: columnIndex === 0 ? 700 : undefined,
            anchor: 'middle',
        });
    }));
    addText(content, '*If Combat Vehicle has ICE engine only. If Combat Vehicle has a fusion engine, treat this result as Engine Hit.', 56.8, 113, {
        size: 5.7,
    });
    addText(content, '** If Combat Vehicle carries no ammunition, treat this result as Weapon Destroyed.', 56.8, 120, {
        size: 5.7,
    });
}
