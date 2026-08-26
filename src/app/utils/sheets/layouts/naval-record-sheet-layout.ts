// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import { isVehicleEntity } from '../../../models/entity/utils/entity-type-guards';
import type { RecordSheetPageProfile } from '../record-sheet-layout';
import {
    type Box,
    addFrame,
    addText,
    drawClusterHitsReference,
    drawGeneratedFooter,
    scaleCompactBox,
    setAttributes,
    svgElement,
} from '../record-sheet-svg-rendering';
import { CompactRecordSheetLayout } from './record-sheet-layout';
import { clusterTableForEntity } from '../../record-sheet-reference-table';
import {
    drawCompactVehicleChrome,
    drawCompactVehicleCrewPanel,
    drawCompactVehicleDataPanel,
    drawCompactVehicleDiagram,
    appendHiddenVehicleDamageTracks,
} from './vehicle-record-sheet-components';
import {
    addExactReferenceText,
    addReferenceShade,
    canonicalReferenceContent,
} from './record-sheet-reference-table-components';
import { appendRecordSheetEraIcon } from '../record-sheet-embedded-art';

const NAVAL_MOTIVE_TYPES = new Set(['hydrofoil', 'naval', 'submarine']);

/**
 * MegaMek's parser can represent a naval-motive combat vehicle as a Tank.
 * The record-sheet family therefore belongs to the motive type, not only the
 * runtime entity discriminator.
 */
export function isNavalRecordSheetEntity(entity: BaseEntity): boolean {
    return entity.entityType === 'Naval'
        || entity.entityType === 'SupportNaval'
        || (isVehicleEntity(entity)
            && NAVAL_MOTIVE_TYPES.has(entity.motiveType().trim().toLowerCase()));
}

/** Naval and support-naval sheets have their own family layout. */
export class NavalRecordSheetLayout extends CompactRecordSheetLayout {
    public constructor() {
        super(
            'naval',
            'vehicle',
            'NAVAL VESSEL RECORD SHEET',
            page => ({ height: page.contentHeight, stride: page.contentHeight }),
        );
    }

    public matches(entity: BaseEntity): boolean {
        return isNavalRecordSheetEntity(entity);
    }

    protected override drawPrintablePageChrome(): void {
        // Naval compact blocks contain the MegaMekLab-style page masthead.
    }

    protected override printablePageContentY(profile: RecordSheetPageProfile): number {
        return profile.margin;
    }

    public override drawCompactPageSupplement(
        page: SVGSVGElement,
        profile: RecordSheetPageProfile,
        _blocks: readonly SVGSVGElement[],
    ): void {
        drawGeneratedFooter(page, profile);
    }

    protected async drawCompact(svg: SVGSVGElement, entity: BaseEntity): Promise<void> {
        if (!this.matches(entity)) throw new Error('Naval layout received a non-naval entity');
        const at = (box: Box): Box => scaleCompactBox(svg, box, 756);
        drawCompactVehicleChrome(svg, 'NAVAL VESSEL RECORD SHEET', 756);
        const dataBox = at({ x: 0.966, y: 69.857, width: 220.4, height: 283 });
        const dataGroup = drawCompactVehicleDataPanel(
            svg,
            entity,
            dataBox,
            {
                includePhysicalAttacks: true,
                lastDetailBaseline: 254.58,
                verticalContentScale: 0.992,
                footerBaselineOffset: 3,
            },
        );
        drawCompactVehicleCrewPanel(
            svg,
            at({ x: 231.366, y: 69.857, width: 145.6, height: 91 }),
            { airborne: false },
        );
        drawNavalCriticalPanel(svg, entity, at({ x: 231.366, y: 165.905, width: 150.1, height: 88.548 }));
        const clusterRacks = clusterTableForEntity(entity).clusterSizes;
        drawClusterHitsReference(
            svg,
            at({ x: 230.4, y: 261.952, width: 154.6, height: 96.048 }),
            clusterRacks.length > 0 ? clusterRacks : [2],
        );
        drawNavalHitLocationReference(
            svg,
            at({ x: 0.965, y: 360.988, width: 222.46, height: 214.6 }),
        );
        drawNavalMotiveReference(
            svg,
            at({ x: 231.365, y: 360.983, width: 148.72, height: 214.6 }),
        );
        drawNavalCriticalReference(
            svg,
            at({ x: 0.965, y: 583.593, width: 378.94, height: 141.9 }),
        );
        const dataContent = dataGroup.querySelector<SVGGElement>('.compact-vehicle-data-content') ?? dataGroup;
        await appendRecordSheetEraIcon(svg, dataContent, entity.year(), {
            x: 158.563 * dataBox.width / 220.4,
            y: 263 * dataBox.height / 283,
            width: 20 * dataBox.width / 220.4,
            height: 20 * dataBox.height / 283,
        });
        const diagramBox = at({ x: 387, y: 3, width: 189, height: 731 });
        const submarine = this.isSubmarine(entity);
        const diagram = await drawCompactVehicleDiagram(
            svg,
            entity,
            diagramBox,
            {
                assetUrl: this.paperdollAsset(entity),
                ...(submarine ? {
                    authoredRootTransform: 'matrix(0.95 0 0 0.95 9 35)',
                    catalystY: 610.907,
                } : {}),
            },
        );
        this.drawDiagramLabels(diagram, entity, diagramBox, submarine);
        if (submarine) {
            drawSubmarineDepthTrack(svg, at({ x: 390.9, y: 643.32, width: 180.5, height: 80.68 }));
        }
    }

    private paperdollAsset(entity: BaseEntity): string {
        const dualTurret = isVehicleEntity(entity) && entity.hasDualTurret();
        const turret = dualTurret || isVehicleEntity(entity) && entity.hasTurret();
        const turretKind = dualTurret ? 'dualturret' : turret ? 'turret' : 'noturret';
        const superheavy = isVehicleEntity(entity) && entity.isSuperHeavy();
        return `/images/paperdolls/naval-${superheavy ? 'superheavy-' : ''}${turretKind}.svg`;
    }

    private isSubmarine(entity: BaseEntity): boolean {
        return isVehicleEntity(entity) && entity.motiveType().trim().toLowerCase() === 'submarine';
    }

    private drawDiagramLabels(
        group: SVGGElement,
        entity: BaseEntity,
        box: Box,
        submarine: boolean,
    ): void {
        const labels = svgElement('g');
        labels.setAttribute('class', 'naval-diagram-labels');
        const values = new Map(entity.damageLocations()
            .map(location => [location.sheetCode ?? location.code, location.armor.front] as const));
        const armor = (...codes: readonly string[]): number => {
            for (const code of codes) {
                const value = values.get(code);
                if (value !== undefined) return value;
            }
            return 0;
        };
        const twoLine = (label: string, value: number, x: number, y: number, gap = 9.525): void => {
            addText(labels, label, x, y, { size: 7.74, weight: 700, anchor: 'middle' });
            addText(labels, `( ${value} )`, x, y + gap, { size: 7.74, weight: 700, anchor: 'middle' });
        };
        const vertical = (label: string, value: number, x: number, y: number, angle: number): void => {
            const text = addText(labels, `${label}( ${value} )`, x, y, {
                size: 7.74,
                weight: 700,
                anchor: 'middle',
            });
            text.setAttribute('transform', `rotate(${angle} ${x} ${y})`);
        };
        const points = submarine ? {
            centerX: 94.111,
            frontY: 40.68,
            leftX: 13.951,
            leftY: 317.165,
            rightX: 178.821,
            rightY: 326.601,
            turretY: 367.338,
            turretGap: 7.71,
            rearY: 620.356,
        } : {
            centerX: 92.009,
            frontY: 56.604,
            leftX: 5.353,
            leftY: 355.5,
            rightX: 183.585,
            rightY: 365.7,
            turretY: 409.739,
            turretGap: 8.335,
            rearY: 683.264,
        };
        twoLine('Front Armor', armor('FR', 'F'), points.centerX, points.frontY,
            submarine ? 8.811 : 9.525);
        vertical('Left Side Armor', armor('LS', 'L'), points.leftX, points.leftY, -90);
        vertical('Right Side Armor', armor('RS', 'R'), points.rightX, points.rightY, 90);
        if (armor('TU', 'T1', 'T') > 0) {
            twoLine('Turret Armor', armor('TU', 'T1', 'T'), points.centerX, points.turretY, points.turretGap);
        }
        twoLine('Rear Armor', armor('RR', 'R'), points.centerX, points.rearY,
            submarine ? 8.811 : 9.525);
        group.appendChild(labels);
    }
}

function drawSubmarineDepthTrack(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'DEPTH TRACK', box);
    group.setAttribute('class', 'submarine-depth-track');
    const sx = box.width / 180.5;
    const sy = box.height / 80.68;
    const scale = Math.min(sx, sy);
    const row = (top: number, firstTurn: number): void => {
        const border = svgElement('rect');
        setAttributes(border, {
            x: 4.5 * sx,
            y: top * sy,
            width: 172 * sx,
            height: 18.804 * sy,
            rx: 1.315 * scale,
            fill: 'none',
            stroke: '#000',
            'stroke-width': scale,
        });
        group.appendChild(border);

        const divider = svgElement('line');
        setAttributes(divider, {
            x1: 4.5 * sx,
            y1: (top + 9.402) * sy,
            x2: 176.5 * sx,
            y2: (top + 9.402) * sy,
            stroke: '#000',
            'stroke-width': 0.58 * scale,
        });
        group.appendChild(divider);
        for (let column = 0; column <= 10; column++) {
            const x = (38.9 + column * 13.31) * sx;
            const line = svgElement('line');
            setAttributes(line, {
                x1: x,
                y1: top * sy,
                x2: x,
                y2: (top + 18.804) * sy,
                stroke: '#000',
                'stroke-width': 0.58 * scale,
            });
            group.appendChild(line);
        }
        addText(group, 'Turn', 7.5 * sx, (top + 7.701) * sy, {
            size: 6.76 * scale,
            weight: 700,
        });
        addText(group, 'Depth', 7.5 * sx, (top + 17.103) * sy, {
            size: 6.76 * scale,
            weight: 700,
        });
        for (let column = 0; column < 10; column++) {
            addText(group, String(firstTurn + column), (45.555 + column * 13.31) * sx,
                (top + 7.701) * sy, {
                    class: 'submarine-depth-turn',
                    size: 6.76 * scale,
                    weight: 700,
                    anchor: 'middle',
                });
        }
    };
    row(24.268, 1);
    row(52.474, 11);
}

/** Naval vessels expose separate fore/aft turret tracks; this is not a ground-vehicle façade. */
function drawNavalCriticalPanel(svg: SVGSVGElement, entity: BaseEntity, box: Box): void {
    const group = addFrame(svg, 'CRITICAL DAMAGE', box, {
        cornerAngleDegrees: { topRight: 0, bottomLeft: 0, bottomRight: 45 },
    });
    addText(group, 'Turret Locked', 6, 29.403, { size: 6.76, maxWidth: 39.254 });
    drawNavalDamageCheckbox(group, 'turret_locked_f', 64.08, 23.003, 'F');
    drawNavalDamageCheckbox(group, 'turret_locked_r', 75.08, 23.003, 'R');
    addText(group, 'Engine Hit', 90.36, 29.403, { size: 6.76, maxWidth: 28.081 });
    drawNavalDamageCheckbox(group, 'engine_hit_1', 130.32, 23.003);

    addText(group, 'Sensor Hits', 6, 39.41, { size: 6.76, maxWidth: 32.801 });
    drawNavalDamageTrack(group, 'sensor_hit_', 97.32, 33.01, ['+1', '+2', '+3', 'D']);
    addText(group, 'Motive System Hits', 6, 49.417, { size: 6.76, maxWidth: 54.079 });
    drawNavalDamageTrack(group, 'motive_system_hit_', 97.32, 43.017, ['+1', '+2', '+3', 'I']);

    addText(group, 'Stabilizers', 75.8, 58.027, { size: 6.76, weight: 700, anchor: 'middle' });
    drawNavalLabeledDamage(group, 'Front', 'stabilizer_hit_front', 6, 63.031);
    drawNavalLabeledDamage(group, 'Left', 'stabilizer_hit_left', 51.048, 63.031);
    drawNavalLabeledDamage(group, 'Right', 'stabilizer_hit_right', 97.946, 63.031);
    drawNavalLabeledDamage(group, 'Rear', 'stabilizer_hit_rear', 6, 73.037);
    drawNavalLabeledDamage(group, 'F Turret', 'stabilizer_hit_turret_f', 51.048, 73.037);
    drawNavalLabeledDamage(group, 'R Turret', 'stabilizer_hit_turret_r', 97.946, 73.037);
    appendHiddenVehicleDamageTracks(svg, entity);
}

function drawNavalDamageTrack(
    group: SVGGElement,
    prefix: string,
    x: number,
    y: number,
    labels: readonly string[],
): void {
    labels.forEach((label, index) => drawNavalDamageCheckbox(group, `${prefix}${index + 1}`, x + index * 11, y, label));
}

function drawNavalLabeledDamage(
    group: SVGGElement,
    label: string,
    sheetId: string,
    x: number,
    y: number,
): void {
    addText(group, label, x, y + 6.4, { size: 6.76, maxWidth: 24 });
    drawNavalDamageCheckbox(group, sheetId, x + 31.224, y);
}

function drawNavalDamageCheckbox(
    group: SVGGElement,
    sheetId: string,
    x: number,
    y: number,
    modifier?: string,
): void {
    const control = svgElement('rect');
    control.id = sheetId;
    setAttributes(control, {
        x, y, width: 8, height: 8, rx: 1.315,
        fill: 'none', stroke: '#000', 'stroke-width': 0.96,
        class: 'critLoc criticalPip',
    });
    control.setAttribute('critId', sheetId);
    group.appendChild(control);
    if (modifier) addText(group, modifier, x + 4, y + 6, {
        size: 5.7, anchor: 'middle', maxWidth: 6.5,
    }).style.pointerEvents = 'none';
}

function drawNavalHitLocationReference(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'NAVAL COMBAT VEHICLE HIT LOCATION TABLE', box, {
        fullWidthHeader: true,
    });
    const content = canonicalReferenceContent(group, box, 225.4, 214.6);
    for (const y of [40.5, 54.5, 68.5, 82.5, 96.5]) {
        addReferenceShade(content, 7.5, y, 210, 7);
    }
    addText(content, 'ATTACK DIRECTION', 122.32, 25, {
        size: 5.7,
        weight: 700,
        anchor: 'middle',
    });
    const columns = [22.24, 66.72, 122.32, 177.92];
    ['2D6 Roll', 'FRONT', 'REAR', 'SIDE§'].forEach((heading, index) => addText(
        content,
        heading,
        columns[index],
        32,
        { size: 5.7, weight: 700, anchor: 'middle' },
    ));
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
        {
            size: 5.7,
            weight: columnIndex === 0 ? 700 : undefined,
            anchor: 'middle',
        },
    )));
    const notes: readonly (readonly [string, number?])[] = [
        ['* A result of 2 or 12 (or an 8 if the attack strikes the side) may inflict a critical hit on', 213.4],
        ['the vehicle. For each result of 2 or 12 (or 8 for side attacks), apply damage normally to', 213.4],
        ['the armor in that section. The attacking player then automatically rolls once on the', 213.4],
        ['Naval Combat Vehicle Critical Hits Table below (see Combat, p. 192, in Total Warfare', 180.661],
        ['for more information).'],
        ['A result of 12 on the Naval Combat Vehicles Hit Location Table may a inflict critical hit', 213.4],
        ['against the turret; if the vehicle has no turret, a 12 indicates the chance of a critical hit', 213.4],
        ['on the side corresponding to the attack direction.'],
        ['† The vehicle may suffer motive system damage even if its armor remains intact. Apply', 213.4],
        ['damage normally to the armor in that section, but the attacking player also rolls once', 213.4],
        ['on the Motive System Damage Table at right (see Combat, p. 192, in Total Warfare', 180.686],
        ['for more information). Apply damage at the end of the phase in which the damage takes effect.'],
        ['§ Side hits strike the side as indicated by the attack direction. For example, if an attack', 213.4],
        ['hits the right side, all Side results strike the right side armor. If the vehicle has no', 213.4],
        ['turret, a turret hit strikes the armor on the side attacked.'],
    ];
    notes.forEach(([value, width], index) => addExactReferenceText(
        content,
        value,
        6,
        131.6 + index * 5,
        4.8,
        width,
    ));
}

function drawNavalMotiveReference(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'MOTIVE SYSTEM DMG TABLE', box, { fullWidthHeader: true });
    const content = canonicalReferenceContent(group, box, 151.6, 214.6);
    addText(content, '2D6 ROLL', 22.29, 25, { size: 5.7, weight: 700, anchor: 'middle' });
    addText(content, 'EFFECT*', 40.122, 25, { size: 5.7, weight: 700 });
    const rolls: readonly (readonly [string, number])[] = [
        ['2-5', 32], ['6-7', 39], ['8-9', 53], ['10-11', 74], ['12', 95],
    ];
    rolls.forEach(([value, y]) => addText(content, value, 22.29, y, {
        size: 5.7,
        weight: 700,
        anchor: 'middle',
    }));
    const effects: readonly (readonly [string, number])[] = [
        ['No Effect', 32],
        ['Minor damage; +1 modifier to all', 39],
        ['Driving Skill Rolls', 46],
        ['Moderate damage; -1 Cruising', 53],
        ['MP, +2 modifier to all Driving Skill', 60],
        ['Rolls', 67],
        ['Heavy damage; only half Cruising', 74],
        ['MP (round fractions up), +3', 81],
        ['modifier to all Driving Skill Rolls', 88],
        ['Major damage; no movement for', 95],
        ['the rest of the game Vehicle is', 102],
        ['immobile.', 109],
    ];
    effects.forEach(([value, y]) => addText(content, value, 40.122, y, { size: 5.7 }));

    addText(content, 'Attack Direction Modifier:', 7.43, 119.5, { size: 5.7, weight: 700 });
    addText(content, 'Hit from rear', 7.43, 126.5, { size: 5.7 });
    addText(content, '+1', 55.725, 126.5, { size: 5.7 });
    addText(content, 'Hit from the sides', 7.43, 133.5, { size: 5.7 });
    addText(content, '+2', 55.725, 133.5, { size: 5.7 });
    addText(content, 'Vehicle Type Modifier:', 7.43, 140.5, { size: 5.7, weight: 700 });
    addText(content, 'Naval', 7.43, 147.5, { size: 5.7 });
    addText(content, '+0', 55.725, 147.5, { size: 5.7 });
    addText(content, 'Hydrofoil', 7.43, 154.5, { size: 5.7 });
    addText(content, '+3', 55.725, 154.5, { size: 5.7 });
    const notes: readonly string[] = [
        '*All movement and Driving Skill Roll penalties are cumulative. However,',
        'each Driving Skill Roll modifier can only be applied once. For example,',
        'if a roll of 6-7 is made for a vehicle, inflicting a +1 modifier, that is the',
        'only time that particular +1 can be applied; a subsequent roll of 6-7',
        'has no additional effect. This means the maximum Driving Skill Roll',
        'modifier that can be inflicted from the Motive System Damage Table is',
        '+6. If a unit’s Cruising MP is reduced to 0, it cannot move for the rest',
        'of the game, but is not considered an immobile target. In addition, all',
        'motive system damage takes effect at the end of the phase in which',
        'the damage occurred.',
    ];
    notes.forEach((value, index) => addExactReferenceText(
        content,
        value,
        6,
        162 + index * 4,
        3.8,
        index < notes.length - 1 ? 139.6 : undefined,
    ));
}

function drawNavalCriticalReference(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'NAVAL COMBAT VEHICLE CRITICAL HITS TABLE', box, {
        fullWidthHeader: true,
    });
    const content = canonicalReferenceContent(group, box, 382, 141.9);
    for (const y of [43.5, 59.5, 75.5, 91.5]) addReferenceShade(content, 12, y, 360, 8);
    addText(content, 'LOCATION HIT', 204.66, 26, { size: 7.2, weight: 700, anchor: 'middle' });
    const columns = [56.85, 102.33, 170.55, 238.77, 306.99];
    ['2D6 Roll', 'FRONT', 'SIDE', 'REAR', 'TURRET'].forEach((heading, index) => addText(
        content,
        heading,
        columns[index],
        34,
        { size: 7.2, weight: 700, anchor: 'middle' },
    ));
    const rows: readonly (readonly string[])[] = [
        ['2-5', 'No Critical Hit', 'No Critical Hit', 'No Critical Hit', 'No Critical Hit'],
        ['6', 'Driver Hit', 'Cargo/Infantry Hit', 'Weapon Malfunction', 'Stabilizer'],
        ['7', 'Weapon Malfunction', 'Weapon Malfunction', 'Cargo/Infantry Hit', 'Turret Jam'],
        ['8', 'Stabilizer', 'Crew Stunned', 'Stabilizer', 'Weapon Malfunction'],
        ['9', 'Sensors', 'Stabilizer', 'Weapon Destroyed', 'Turret Locks'],
        ['10', 'Commander Hit', 'Weapon Destroyed', 'Engine Hit', 'Weapon Destroyed'],
        ['11', 'Weapon Destroyed', 'Engine Hit', 'Ammunition**', 'Ammunition**'],
        ['12', 'Crew Killed', 'Fuel Tank*', 'Fuel Tank*', 'Turret Blown Off'],
    ];
    rows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => addText(
        content,
        value,
        columns[columnIndex],
        42 + rowIndex * 8,
        {
            size: 7.2,
            weight: columnIndex === 0 ? 700 : undefined,
            anchor: 'middle',
        },
    )));
    addText(content, '*If Combat Vehicle has ICE engine only. If Combat Vehicle has a fusion engine, treat this result as Engine Hit.', 37.9, 113, {
        size: 5.7,
    });
    addText(content, '** If Combat Vehicle carries no ammunition, treat this result as Weapon Destroyed.', 37.9, 120, {
        size: 5.7,
    });
}
