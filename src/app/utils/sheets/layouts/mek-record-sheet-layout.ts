// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import { isMekEntity } from '../../../models/entity/utils/entity-type-guards';
import type {
    RecordSheetLayout,
    RecordSheetLayoutRequest,
} from './record-sheet-layout';
import { type BipedArmorValues, type BipedPaperdollPipLayout, BipedPaperdollUtil, type BipedStructureTonnage } from '../biped-paperdoll.util';
import { CanonPipRenderer } from '../canon-pip-renderer';
import {
    type EntityMountedEquipment,
    type IntrinsicWeapon,
} from '../../../models/entity/types';
import { getMekLocationLabel } from '../../../models/entity/types/mek';
import { type MekEntity } from '../../../models/entity/entities/mek/mek-entity';
import { isHeatSinkEquipment } from '../../../models/heat-equipment.model';
import { isJumpJetEquipment } from '../../../models/jump-equipment.model';
import { isTargetingComputerEquipment } from '../../../models/entity/utils/targeting-computer';
import { isMekRecordSheetInventorySupport } from '../record-sheet-inventory-equipment';
import { formatEquipmentLocationCodes } from '../../equipment-location-display.util';
import {
    fullRecordSheetLayoutProfile,
    type RecordSheetLayoutProfile,
    type RecordSheetPageFormat,
    type RecordSheetPageProfile,
} from '../record-sheet-layout';
import { clusterTableForMekEntity, clusterTableRows, hitLocationRows, recordSheetPhysicalLocationRows, referenceTableNotes } from '../../record-sheet-reference-table';
import { intrinsicActionBaseDamageText } from '../../../models/entity/utils/mek-intrinsic-actions';
import { mekCriticalCaseLabel, mekCriticalSlotLabel } from '../../mek-critical-display.util';
import { mekCriticalLocationCells, mekCriticalTableRowCount } from '../../mek-location-layout.util';
import {
    type Box,
    addDiagramHeading,
    addFrame,
    addLine,
    addText,
    appendLegacyIdentityAnchors,
    circle,
    constructionMaterialSubtitle,
    createRoot,
    decoratePaperdollPips,
    drawCrewHitGrid,
    drawDamagePanelIntoGroup,
    drawGeneratedFooter,
    drawHeatScale,
    drawPageChrome,
    formatGeometryNumber,
    formatNumber,
    formatTechBase,
    formatWholeNumber,
    makeDistributedPips,
    paperdollPipOptions,
    type RecordSheetInventoryAlternativeMode,
    recordSheetAmmoProfile,
    recordSheetInventoryWeapons,
    scalePageBox,
    setAttributes,
    setInventoryComponentIds,
    svgElement,
    transparentRect,
} from '../record-sheet-svg-rendering';
import { appendRecordSheetEraIcon } from '../record-sheet-embedded-art';
import { appendGeneratedMekCriticalHeadingControls } from '../generated-record-sheet-controls';
/** Biped, tripod, quad, QuadVee, and LAM sheets share one composition. */
export class MekRecordSheetLayout implements RecordSheetLayout {
    public readonly id = 'mek';

    public matches(entity: BaseEntity): boolean {
        return isMekEntity(entity);
    }

    public profile(
        entity: BaseEntity,
        pageFormat: RecordSheetPageFormat = 'letter',
    ): RecordSheetLayoutProfile {
        if (!this.matches(entity)) throw new Error('Mek layout requires a Mek entity');
        return fullRecordSheetLayoutProfile(pageFormat);
    }

    public async generate(
        entity: BaseEntity,
        request: RecordSheetLayoutRequest,
    ): Promise<SVGSVGElement> {
        if (!isMekEntity(entity)) throw new Error('Mek layout requires a Mek entity');
        const page = request.page;
        const svg = createRoot(page.width, page.height, 'mek');
        const at = (box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }) =>
            scalePageBox(page, box);
        drawPageChrome(svg, mekRecordSheetTitle(entity), page, false);

        await drawMekDataPanel(svg, entity, at({ x: 18.966, y: 87.857, width: 220.4, height: 301.5 }));
        const crewCount = Math.max(1, entity.crewSlotCount());
        const lamLayout = entity.chassisConfig === 'LAM';
        const crewHeight = lamLayout ? 107 : 31 + crewCount * 52;
        drawMekCrewPanel(svg, entity, at({ x: 249.366, y: 87.857, width: 145.6, height: crewHeight }));
        if (lamLayout) {
            drawMekHitLocationAndClusterPanel(
                svg,
                entity,
                at({ x: 249.366, y: 202.857, width: 145.6, height: 114 }),
                page,
            );
            drawLamAdvancedMovementCompass(
                svg,
                at({ x: 249.366, y: 319, width: 145.6, height: 70 }),
            );
        } else if (crewCount === 1) {
            drawMekHitLocationAndClusterPanel(
                svg,
                entity,
                at({ x: 249.366, y: 178.857, width: 145.6, height: 123 }),
                page,
            );
            drawMekPunchKickPanel(
                svg,
                entity,
                at({ x: 249.366, y: 309.312, width: 145.6, height: 80 }),
                page,
            );
        } else {
            const referenceY = 95.857 + crewHeight;
            drawMekHitLocationAndClusterPanel(
                svg,
                entity,
                at({
                    x: 249.366,
                    y: referenceY,
                    width: 145.6,
                    height: 389.312 - referenceY,
                }),
                page,
            );
        }
        await drawMekPaperdolls(svg, entity, at({ x: 402.966, y: 18, width: 173, height: 543 }));
        await drawMekCriticalPanel(svg, entity, at({ x: 18.966, y: 389, width: 377.7, height: 363 }));
        drawHeatPanel(svg, entity, at({ x: 402.966, y: 571.5, width: 159.5, height: 180.5 }));
        drawHeatScale(svg, at({ x: 574.546, y: 386, width: 19.454, height: 366 }));
        const catalyst = entity.chassisConfig === 'Tripod'
            ? { catalystX: 140.64, catalystY: 646.025, catalystScale: 0.968 }
            : entity.chassisConfig === 'LAM'
                ? { catalystX: 140.363, catalystY: 694.565, catalystScale: 1.08 }
                : { catalystX: 140.363, catalystY: 674.365, catalystScale: 1.08 };
        drawGeneratedFooter(svg, page, catalyst);
        return svg;
    }
}

function drawLamAdvancedMovementCompass(svg: SVGSVGElement, box: Box): void {
    const group = svgElement('g');
    group.setAttribute('class', 'lam-advanced-movement-compass');
    group.setAttribute('transform', `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`);
    const sx = box.width / 145.6;
    const sy = box.height / 70;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;

    const hex = svgElement('path');
    hex.setAttribute(
        'd',
        `M ${formatNumber(x(96.266))} ${formatNumber(y(10))} `
        + `L ${formatNumber(x(81.832))} ${formatNumber(y(35))} `
        + `L ${formatNumber(x(96.266))} ${formatNumber(y(60))} `
        + `H ${formatNumber(x(125.134))} `
        + `L ${formatNumber(x(139.568))} ${formatNumber(y(35))} `
        + `L ${formatNumber(x(125.134))} ${formatNumber(y(10))} Z`,
    );
    setAttributes(hex, { fill: 'none', stroke: '#000', 'stroke-width': 2.9 * fontScale });
    group.appendChild(hex);

    const directions: readonly [string, number, number][] = [
        ['A', 110.7, 7], ['B', 140.068, 22], ['C', 140.068, 53],
        ['D', 110.7, 69], ['E', 81.332, 53], ['F', 81.332, 22],
    ];
    directions.forEach(([label, left, baseline]) => addText(group, label, x(left), y(baseline), {
        size: 9.35 * fontScale, weight: 700, anchor: 'middle',
    }));
    ['Advanced', 'Movement', 'Compass'].forEach((label, index) => addText(
        group,
        label,
        x(36.9),
        y(25.5 + index * 10),
        { size: 9.35 * fontScale, weight: 700, anchor: 'middle' },
    ));
    svg.appendChild(group);
}

function mekRecordSheetTitle(entity: MekEntity): string {
    if (entity.chassisConfig === 'LAM') return "LAND-AIR 'MECH RECORD SHEET";
    if (entity.chassisConfig === 'QuadVee') {
        return `${entity.omni() ? 'OMNI' : ''}QUADVEE RECORD SHEET`;
    }
    const weight = entity.isSuperHeavy() ? 'SUPERHEAVY ' : '';
    const configuration = entity.chassisConfig === 'Quad'
        ? 'FOUR-LEGGED '
        : entity.chassisConfig === 'Tripod'
            ? 'THREE-LEGGED '
            : '';
    return `${weight}${configuration}${entity.omni() ? 'OMNIMECH' : 'BATTLEMECH'} RECORD SHEET`;
}

function drawMekCrewPanel(svg: SVGSVGElement, entity: MekEntity, box: Box): void {
    const group = addFrame(svg, 'WARRIOR DATA', box, {
        id: 'warriorDataSingle',
        cornerAngleDegrees: { topRight: 0, bottomLeft: 0, bottomRight: 45 },
    });
    drawMekCrewPanelContents(group, entity, box);
    appendMekLifeSupportWarning(group, box.width);
}

function appendMekLifeSupportWarning(group: SVGGElement, panelWidth: number): void {
    const warningWidth = 42;
    const warningHeight = 15;
    const warning = svgElement('g');
    warning.id = 'lifeSupportPilotDamageWarning';
    warning.setAttribute('class', 'screen-only no-autocolor');
    warning.setAttribute('pointer-events', 'none');
    warning.setAttribute('display', 'none');
    warning.setAttribute('transform', `translate(${formatNumber(panelWidth - warningWidth - 6)} -2)`);
    warning.setAttribute('data-width', String(warningWidth));
    warning.setAttribute('data-height', String(warningHeight));

    const defs = svgElement('defs');
    const heat = svgElement('symbol');
    heat.id = 'lifeSupportHeatDamageIcon';
    heat.setAttribute('viewBox', '0 0 24 24');
    const flame = svgElement('path');
    flame.setAttribute('d', 'M13.6 2.1c.6 3.2-1.7 4.5-2.7 6.7-.8 1.8.3 3.2 1.8 3.2 2.2 0 3.5-2.4 2.7-5.1 3.2 2.2 5.1 5.2 4.6 8.3-.6 4-3.9 6.8-8 6.8s-7.5-2.9-8-7c-.5-3.6 1.6-7.1 5-9.1-.5 3.1.8 5.2 2.5 4.8 2.1-.5.5-4.1 2.1-8.6z');
    flame.setAttribute('fill', '#f4511e');
    flame.setAttribute('stroke', '#000');
    flame.setAttribute('stroke-width', '1.8');
    heat.appendChild(flame);

    const oxygen = svgElement('symbol');
    oxygen.id = 'lifeSupportOxygenDamageIcon';
    oxygen.setAttribute('viewBox', '0 0 24 24');
    const tank = svgElement('path');
    tank.setAttribute('d', 'M6 4h7v2h1.5v2H14v13H5V8h1V6h0zM8 1h3v3H8z');
    tank.setAttribute('fill', '#2196f3');
    tank.setAttribute('stroke', '#000');
    tank.setAttribute('stroke-width', '1.4');
    const o2 = svgElement('path');
    o2.setAttribute('d', 'M16 9c0-2 1.2-3 3-3s3 1 3 3v3c0 2-1.2 3-3 3s-3-1-3-3zm2 0v3c0 .7.3 1 1 1s1-.3 1-1V9c0-.7-.3-1-1-1s-1 .3-1 1zm-2 12v-1l3-2.4c.6-.5.8-.8.8-1.2 0-.5-.3-.7-.9-.7-.7 0-1.2.3-1.8.9l-1.1-1.1c.8-.9 1.7-1.4 3.1-1.4 1.7 0 2.8.9 2.8 2.2 0 1.1-.6 1.8-1.8 2.7l-1.5 1.1H22V21z');
    o2.setAttribute('fill', '#2196f3');
    oxygen.append(tank, o2);
    defs.append(heat, oxygen);
    warning.appendChild(defs);
    group.appendChild(warning);
}

export async function drawMekDataPanel(
    svg: SVGSVGElement,
    entity: MekEntity,
    box: Box,
): Promise<void> {
    const group = addFrame(svg, "'MECH DATA", box, {
        bottomLeftNotchWidth: box.width * 0.48,
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45 },
    });
    group.id = 'unitDataPanel';
    const sx = box.width / 220.4;
    const sy = box.height / 301.5;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const engine = entity.mountedEngine();
    const typeLabel = addText(group, 'Type:', x(3), y(28), { size: font(9.67), weight: 700 });
    typeLabel.setAttribute('textLength', formatNumber(x(21.401)));
    typeLabel.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    const type = addText(group, entity.displayName(), x(29.229), y(28), {
        size: font(9.67), weight: 700, maxWidth: x(187),
    });
    type.id = 'type';
    type.setAttribute('data-mekbay-field', 'display-name');
    const lamLayout = entity.chassisConfig === 'LAM';
    const quadVeeLayout = entity.chassisConfig === 'QuadVee';
    if (lamLayout) {
        drawLamMekDataHeader(group, entity, { x, y, font, fontScale });
    } else if (quadVeeLayout) {
        drawQuadVeeMekDataHeader(group, entity, { x, y, font });
    } else {
        addText(group, 'Movement Points:', x(6), y(38), { size: font(7.7), weight: 700 });
        const leftRows: readonly [string, string, string, string][] = [
            ['Walking:', String(entity.walkMP()), 'mpWalk', 'walk'],
            ['Running:', String(entity.runMP()), 'mpRun', 'run'],
            ['Jumping:', String(entity.jumpMP()), 'mpJump', 'jump'],
        ];
        leftRows.forEach(([label, value, id, field], index) => {
            const baseline = y(47 + index * 9);
            addText(group, label, x(6), baseline, { size: font(7.7), weight: 700 });
            const node = addText(group, value, x(56), baseline, {
                size: font(7.7), anchor: 'middle',
            });
            node.id = id;
            node.setAttribute('data-mekbay-field', field);
        });
        const rightRows: readonly [string, string, string?, string?][] = [
            ['Tonnage:', formatNumber(entity.tonnage()), 'tonnage', 'tonnage'],
            ['Tech Base:', formatTechBase(entity.techBase(), entity.mixedTech()), 'techBase', 'tech-base'],
            ['Role:', entity.role() || '—', 'role', 'role'],
            ['Engine Type:', `${engine.rating} ${engine.type()}`, 'engineType', undefined],
        ];
        const labelLengths: Readonly<Record<string, number>> = {
            'Tonnage:': 29.785,
            'Tech Base:': 35.949,
            'Role:': 16.16,
            'Engine Type:': 40.915,
        };
        rightRows.forEach(([label, value, id, field], index) => {
            const baseline = y(38 + index * 9);
            const labelNode = addText(group, label, x(115.7), baseline, { size: font(7.7), weight: 700 });
            labelNode.setAttribute('textLength', formatNumber(x(labelLengths[label])));
            labelNode.setAttribute('lengthAdjust', 'spacingAndGlyphs');
            const node = addText(group, value, x(158.24), baseline, {
                size: font(7.7), maxWidth: x(58),
            });
            if (id) node.id = id;
            if (field) node.setAttribute('data-mekbay-field', field);
        });
    }
    const inventoryTitleY = lamLayout ? 105.5 : quadVeeLayout ? 87.5 : 80.462;
    const inventoryHeadingY = lamLayout ? 116.3 : quadVeeLayout ? 98.3 : 91.262;
    addLine(group, x(3), y(inventoryTitleY - 10.5), box.width - x(3), y(inventoryTitleY - 10.5), '#111', 0.8 * fontScale);
    const inventoryTitle = addText(group, 'Weapons & Equipment Inventory', x(3), y(inventoryTitleY), {
        size: font(8.6),
        weight: 700,
        maxWidth: x(150),
    });
    // MegaMekLab fixes this heading to a known width.  Preserve that geometry
    // instead of leaving it to browser/font-platform metrics.
    inventoryTitle.setAttribute('textLength', formatNumber(x(121.508)));
    inventoryTitle.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    addText(group, '(hexes)', x(171.132), y(inventoryTitleY), { size: font(6.76) });
    const headings: readonly [string, number, 'start' | 'middle'][] = [
        ['Type', 8.41, 'start'], ['Loc', 89.56, 'middle'], ['Ht', 103.626, 'middle'],
        ['Dmg', 111.2, 'start'], ['Min', 172.874, 'middle'], ['Sht', 185.425, 'middle'],
        ['Med', 198.842, 'middle'], ['Lng', 212.908, 'middle'],
    ];
    headings.forEach(([label, position, anchor]) => addText(group, label, x(position), y(inventoryHeadingY), {
        size: font(6.76), weight: 700, anchor,
    }));
    appendMekInventoryRows(group, entity, box, { sx, sy, fontScale }, {
        firstBaselineReference: lamLayout ? 126.2 : quadVeeLayout ? 108.2 : 101.162,
        heatProfileReference: quadVeeLayout ? 167.519 : undefined,
    });

    addLine(group, x(3), y(275.143), box.width - x(3), y(275.143), '#111', 1.932 * fontScale);
    const bvLabel = addText(group, 'BV:', x(13.845), y(287.143), { size: font(9.67), weight: 700 });
    bvLabel.setAttribute('textLength', formatNumber(x(14.117)));
    bvLabel.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    const bv = addText(group, formatWholeNumber(entity.battleValue()), x(32.79), y(287.143), {
        size: font(9.67),
    });
    bv.id = 'bv';
    appendLegacyIdentityAnchors(group, entity, box);
    await appendRecordSheetEraIcon(svg, group, entity.year(), {
        x: x(158.563), y: y(278.25), width: x(20), height: y(20),
    });
}

function drawLamMekDataHeader(
    group: SVGGElement,
    entity: MekEntity,
    scale: {
        readonly x: (value: number) => number;
        readonly y: (value: number) => number;
        readonly font: (value: number) => number;
        readonly fontScale: number;
    },
): void {
    const { x, y, font } = scale;
    const engine = entity.mountedEngine();
    const facts: readonly [string, string, number, number, number, string?, string?][] = [
        ['Tonnage:', formatNumber(entity.tonnage()), 6, 39.629, 38, 'tonnage', 'tonnage'],
        ['Tech Base:', formatTechBase(entity.techBase(), entity.mixedTech()), 115.7, 158.24, 38, 'techBase', 'tech-base'],
        ['Engine Type:', `${engine.rating} ${engine.type()}`, 6, 52.222, 47, 'engineType', undefined],
        ['Role:', entity.role() || '—', 115.7, 158.24, 47, 'role', 'role'],
    ];
    facts.forEach(([label, value, labelX, valueX, baseline, id, field]) => {
        addText(group, label, x(labelX), y(baseline), { size: font(7.7), weight: 700 });
        const node = addText(group, value, x(valueX), y(baseline), {
            size: font(7.7),
            maxWidth: x(labelX < 100 ? 60 : 58),
        });
        if (id) node.id = id;
        if (field) node.setAttribute('data-mekbay-field', field);
    });
    addText(group, 'Movement Points:', x(6), y(56), { size: font(7.7), weight: 700 });
    addText(group, 'BattleMech', x(6), y(65), { size: font(7.7), weight: 700 });
    addText(group, 'AirMech', x(105.312), y(65), { size: font(7.7), weight: 700, anchor: 'middle' });
    addText(group, 'Fighter', x(163.968), y(65), { size: font(7.7), weight: 700 });
    const airWalk = Math.ceil(entity.walkMP() * 0.33);
    const airRun = Math.ceil(airWalk * 1.5);
    const fighterCruise = entity.jumpMP() * 3;
    const fighterFlank = Math.ceil(fighterCruise * 1.5);
    const movementRows: readonly [string, string, string, string, string, string, string][] = [
        ['Walking:', String(entity.walkMP()), 'Walking:', String(airWalk), 'Cruising:', String(fighterCruise), 'Safe Thrust:'],
        ['Running:', String(entity.runMP()), 'Running:', String(airRun), 'Flanking:', String(fighterFlank), 'Max Thrust:'],
        ['Jumping:', String(entity.jumpMP()), '', '', '', '', ''],
    ];
    movementRows.forEach(([label, battleMek, airLabel, airMek, fighterLabel, fighterValue, thrustLabel], index) => {
        const baseline = y(index === 2 ? 91.966 : 74 + index * 9);
        addText(group, label, x(6), baseline, { size: font(7.7), weight: 700 });
        const battle = addText(group, battleMek, x(44), baseline, { size: font(7.7), anchor: 'middle' });
        if (index === 0) { battle.id = 'mpWalk'; battle.setAttribute('data-mekbay-field', 'walk'); }
        if (index === 1) { battle.id = 'mpRun'; battle.setAttribute('data-mekbay-field', 'run'); }
        if (index === 2) { battle.id = 'mpJump'; battle.setAttribute('data-mekbay-field', 'jump'); }
        if (airLabel) addText(group, airLabel, x(58.656), baseline, { size: font(7.7), weight: 700 });
        if (airMek) {
            const air = addText(group, airMek, x(96.656), baseline, { size: font(7.7), anchor: 'middle' });
            air.id = index === 0 ? 'mpAirMekWalk' : 'mpAirMekRun';
        }
        if (fighterLabel) addText(group, fighterLabel, x(111.312), baseline, { size: font(7.7), weight: 700 });
        if (fighterValue) {
            const fighter = addText(group, fighterValue, x(149.312), baseline, { size: font(7.7), anchor: 'middle' });
            fighter.id = index === 0 ? 'mpAirMekCruise' : 'mpAirMekFlank';
        }
        if (thrustLabel) {
            const thrust = index === 0 ? entity.jumpMP() : Math.ceil(entity.jumpMP() * 1.5);
            addText(group, thrustLabel, x(163.968), baseline, { size: font(7.7), weight: 700 });
            const thrustNode = addText(group, String(thrust), x(210.968), baseline, { size: font(7.7), anchor: 'middle' });
            thrustNode.id = index === 0 ? 'mpSafeThrust' : 'mpMaxThrust';
        }
    });
}

function drawQuadVeeMekDataHeader(
    group: SVGGElement,
    entity: MekEntity,
    scale: {
        readonly x: (value: number) => number;
        readonly y: (value: number) => number;
        readonly font: (value: number) => number;
    },
): void {
    const { x, y, font } = scale;
    const engine = entity.mountedEngine();
    addText(group, 'Movement Points:', x(6), y(38), { size: font(7.7), weight: 700 });
    addText(group, 'BattleMech', x(6.023), y(47), { size: font(7.7), weight: 700 });
    addText(group, 'Vehicle', x(60.85), y(47), { size: font(7.7), weight: 700 });

    const battleRun = formatMovementWithMaximum(entity.runMP(), entity.maxRunMP());
    const cruise = entity.originalWalkMP() + (entity.motiveType() === 'Wheel' ? 1 : 0);
    const flank = Math.ceil(cruise * 1.5);
    const maximumFlank = entity.maxRunMP() > entity.runMP() ? cruise * 2 : flank;
    const movementRows: readonly [string, string, string, string, string, string, string][] = [
        ['Walking:', String(entity.walkMP()), 'mpWalk', 'Cruising:', String(cruise), 'mpCruise', 'walk'],
        ['Running:', battleRun, 'mpRun', 'Flanking:', formatMovementWithMaximum(flank, maximumFlank), 'mpFlank', 'run'],
        ['Jumping:', String(entity.jumpMP()), 'mpJump', '', '', '', 'jump'],
    ];
    movementRows.forEach(([battleLabel, battleValue, battleId, vehicleLabel, vehicleValue, vehicleId, field], index) => {
        const baseline = y(56 + index * 9);
        addText(group, battleLabel, x(6), baseline, { size: font(7.7), weight: 700 });
        const battle = addText(group, battleValue, x(48), baseline, { size: font(7.7), anchor: 'middle' });
        battle.id = battleId;
        battle.setAttribute('data-mekbay-field', field);
        if (vehicleLabel) addText(group, vehicleLabel, x(60.85), baseline, { size: font(7.7), weight: 700 });
        if (vehicleValue) {
            const vehicle = addText(group, vehicleValue, x(102.85), baseline, { size: font(7.7), anchor: 'middle' });
            vehicle.id = vehicleId;
        }
    });

    const facts: readonly [string, string, number, string?, string?][] = [
        ['Tonnage:', formatNumber(entity.tonnage()), 38, 'tonnage', 'tonnage'],
        ['Tech Base:', formatTechBase(entity.techBase(), entity.mixedTech()), 47, 'techBase', 'tech-base'],
        ['Role:', entity.role() || '—', 56, 'role', 'role'],
        ['Engine Type:', `${engine.rating} ${engine.type()}`, 65, 'engineType', undefined],
    ];
    facts.forEach(([label, value, baseline, id, field]) => {
        addText(group, label, x(115.7), y(baseline), { size: font(7.7), weight: 700 });
        const node = addText(group, value, x(158.24), y(baseline), { size: font(7.7), maxWidth: x(58) });
        if (id) node.id = id;
        if (field) node.setAttribute('data-mekbay-field', field);
    });
}

function formatMovementWithMaximum(base: number, maximum: number): string {
    return maximum > base ? `${base} [${maximum}]` : String(base);
}

interface MekInventoryGeometry {
    readonly firstBaselineReference: number;
    readonly heatProfileReference?: number;
}

function appendMekInventoryRows(
    group: SVGGElement,
    entity: MekEntity,
    box: Box,
    scale: { readonly sx: number; readonly sy: number; readonly fontScale: number },
    geometry: MekInventoryGeometry = { firstBaselineReference: 103.2 },
): void {
    const { sx, sy, fontScale } = scale;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const equipmentRows = mekRecordSheetInventoryRows(entity);
    const physicalAttacks = mekPhysicalInventoryRows(entity);
    const equipmentLineOffsets: number[] = [];
    let equipmentDisplayLines = 0;
    equipmentRows.forEach(row => {
        equipmentLineOffsets.push(equipmentDisplayLines);
        equipmentDisplayLines += 1 + row.alternativeModes.length;
    });
    const ammo = recordSheetAmmoProfile(entity);
    const quirks = entity.quirks()
        .map(entry => entry.quirk.name)
        .sort((left, right) => left.localeCompare(right));
    const metrics = mekInventoryMetrics(
        equipmentDisplayLines,
        physicalAttacks.length,
        ammo.length > 0 ? `Ammo: ${ammo.join(', ')}` : '',
        quirks.length > 0 ? `Quirks: ${quirks.join(', ')}` : '',
    );
    const firstBaseline = y(geometry.firstBaselineReference);
    const rowStep = y(metrics.lineStep);
    const rowFont = font(metrics.fontSize);
    const rowFontScale = metrics.fontSize / 6.76;
    const heatProfileY = geometry.heatProfileReference === undefined
        ? firstBaseline + equipmentDisplayLines * rowStep + rowStep * 0.5
        : y(geometry.heatProfileReference);
    const footerFlowLines = physicalAttacks.length
        + (physicalAttacks.length > 0 ? 0.5 : 0)
        + metrics.ammoLines.length
        + metrics.quirkLines.length;
    const footerOrigin = y(273.143)
        - Math.max(0, footerFlowLines - 1) * rowStep
        - rowStep * 0.5;
    const heatProfile = addText(
        group,
        `Maximum Heat (Dissipation): ${Math.max(0, entity.heatGeneration())} (${Math.max(0, entity.heatDissipation())})`,
        x(8.41),
        heatProfileY,
        { size: font(6.76), maxWidth: box.width - x(17) },
    );
    heatProfile.id = 'heatProfile';

    const rowCount = equipmentRows.length + physicalAttacks.length;
    for (let index = 0; index < rowCount; index++) {
        const isEquipment = index < equipmentRows.length;
        const rowData = isEquipment
            ? equipmentRows[index]
            : index < equipmentRows.length + physicalAttacks.length
                ? physicalAttacks[index - equipmentRows.length]
                : undefined;
        const alternativeModes = isEquipment ? equipmentRows[index]?.alternativeModes ?? [] : [];
        const baseline = isEquipment
            ? firstBaseline + equipmentLineOffsets[index] * rowStep
            : footerOrigin + (index - equipmentRows.length) * rowStep;
        const row = svgElement('g');
        row.setAttribute('class', 'inventoryEntry');
        row.setAttribute('id', `generated-inventory-row@${index}`);
        setInventoryComponentIds(row, rowData?.componentIds ?? []);
        row.setAttribute('transform', `translate(0 ${formatNumber(baseline - rowStep + y(1.4))})`);
        if (!rowData || index >= equipmentRows.length + physicalAttacks.length) {
            row.setAttribute('display', 'none');
        }

        const localBaseline = rowStep - y(1.4);
        const controlY = localBaseline - y(6.5) * rowFontScale;
        const controlHeight = y(8) * rowFontScale;
        row.appendChild(transparentRect(
            x(2), controlY, x(177.104), controlHeight, 'inventoryEntryButton mainButton',
        ));
        const buttons: readonly [string, number, number][] = [
            ['shrButton', 180.304, 10.448],
            ['medButton', 192.154, 13.569],
            ['lngButton', 207.252, 11.447],
        ];
        buttons.forEach(([className, position, width]) => row.appendChild(
            transparentRect(x(position), controlY, x(width), controlHeight, `inventoryEntryButton ${className}`),
        ));

        const badgeY = localBaseline - y(7) * rowFontScale;
        const badgeHeight = y(9) * rowFontScale;
        const badgeFont = rowFont * 1.1;
        const hitModRect = svgElement('rect');
        setAttributes(hitModRect, {
            x: x(-5), y: badgeY, width: x(10), height: badgeHeight,
            fill: '#000', class: 'hitMod-rect', display: 'none',
        });
        row.appendChild(hitModRect);
        const targetTnRect = svgElement('rect');
        setAttributes(targetTnRect, {
            x: x(-5), y: badgeY, width: x(10), height: badgeHeight,
            fill: '#fff', stroke: '#000', 'stroke-width': 0.8,
            class: 'targetTn-rect', display: 'none',
        });
        row.appendChild(targetTnRect);

        const name = addText(row, rowData?.name ?? '', x(8.41), localBaseline, {
            class: 'name', size: rowFont, maxWidth: x(70.4),
        });
        name.setAttribute('data-mekbay-field', 'inventory-name');
        addText(row, rowData?.location ?? '', x(89.56), localBaseline, {
            class: 'location', size: rowFont, anchor: 'middle', maxWidth: x(22),
        });
        addText(row, rowData?.heat ?? '', x(103.626), localBaseline, {
            class: 'heat', size: rowFont, anchor: 'middle', maxWidth: x(12),
        });
        const damage = svgElement('g');
        damage.setAttribute('class', 'damage');
        addText(damage, rowData?.damage ?? '', x(111.2), localBaseline, {
            size: rowFont, maxWidth: x(56),
        });
        row.appendChild(damage);
        const ranges = rowData?.ranges ?? [];
        const rangeColumns: readonly [string, number, string][] = [
            ['range_min', 172.874, rowData?.minimumRange ?? ''],
            ['range_short', 185.425, ranges[0] ?? ''],
            ['range_medium', 198.842, ranges[1] ?? ''],
            ['range_long', 212.908, ranges[2] ?? ''],
        ];
        rangeColumns.forEach(([className, position, value]) => addText(row, String(value), x(position), localBaseline, {
            class: className, size: rowFont, anchor: 'middle', maxWidth: x(12),
        }));
        if (rowData) {
            alternativeModes.forEach((mode, modeIndex) => {
                const alternative = svgElement('g');
                alternative.setAttribute('class', 'alternativeMode');
                alternative.setAttribute('data-mekbay-mode', mode.name);
                alternative.setAttribute('data-mekbay-static-mode-profile', '1');
                alternative.setAttribute('data-mekbay-mode-label-only', '1');
                const alternativeY = (modeIndex + 1) * rowStep;
                alternative.appendChild(transparentRect(
                    x(2), controlY + alternativeY, x(177.104), controlHeight,
                    'inventoryEntryButton alternativeModeButton',
                ));
                buttons.forEach(([className, position, width]) => alternative.appendChild(
                    transparentRect(x(position), controlY + alternativeY, x(width), controlHeight,
                        `inventoryEntryButton ${className}`),
                ));
                const modeBaseline = localBaseline + alternativeY;
                const modeName = addText(alternative, mode.name, x(12.738), modeBaseline, {
                    class: 'name', size: rowFont, maxWidth: x(66),
                });
                modeName.setAttribute('data-mekbay-field', 'inventory-name');
                addText(alternative, '', x(89.56), modeBaseline, {
                    class: 'location', size: rowFont, anchor: 'middle', maxWidth: x(22),
                });
                addText(alternative, '', x(103.626), modeBaseline, {
                    class: 'heat', size: rowFont, anchor: 'middle', maxWidth: x(12),
                });
                const modeDamage = svgElement('g');
                modeDamage.setAttribute('class', 'damage');
                addText(modeDamage, mode.damage, x(111.2), modeBaseline, {
                    size: rowFont, maxWidth: x(56),
                });
                alternative.appendChild(modeDamage);
                const modeValues = [mode.minimumRange, ...mode.ranges];
                rangeColumns.forEach(([className, position], rangeIndex) => addText(
                    alternative,
                    modeValues[rangeIndex] ?? '',
                    x(position),
                    modeBaseline,
                    { class: className, size: rowFont, anchor: 'middle', maxWidth: x(12) },
                ));
                row.appendChild(alternative);
            });
        }
        addText(row, '', x(-4), localBaseline, { class: 'quantity', size: font(6.1) * rowFontScale });
        addText(row, '', x(106), localBaseline, { class: 'mekbay-inventory-summary', size: 0.1, fill: '#fff' });

        const badgeTextY = badgeY + badgeHeight / 2 + badgeFont / 3;
        const hitMod = addText(row, '', x(0), badgeTextY, {
            class: 'hitMod-text', size: badgeFont, weight: 700, fill: '#fff', anchor: 'middle',
        });
        hitMod.setAttribute('font-family', 'monospace');
        hitMod.setAttribute('display', 'none');
        const targetTn = addText(row, '', x(0), badgeTextY, {
            class: 'targetTn-text', size: badgeFont, weight: 700, anchor: 'middle',
        });
        targetTn.setAttribute('font-family', 'monospace');
        targetTn.setAttribute('display', 'none');
        group.appendChild(row);
    }

    let footerCursor = footerOrigin + physicalAttacks.length * rowStep;
    if (physicalAttacks.length > 0) footerCursor += rowStep * 0.5;
    if (metrics.ammoLines.length > 0) {
        const ammoProfile = svgElement('g');
        ammoProfile.id = 'ammoProfile';
        metrics.ammoLines.forEach((line, index) => addText(
            ammoProfile,
            line,
            x(8.41),
            footerCursor + index * rowStep,
            { size: rowFont, maxWidth: x(209.38) },
        ));
        group.appendChild(ammoProfile);
        footerCursor += metrics.ammoLines.length * rowStep;
    }
    metrics.quirkLines.forEach((line, index) => {
        const text = addText(group, line, x(8.41), footerCursor + index * rowStep * 0.9, {
            size: rowFont * 0.9,
            maxWidth: x(209.38),
        });
        text.setAttribute('font-style', 'italic');
        text.setAttribute('class', 'unitQuirks');
    });
}

interface MekRecordSheetInventoryRow {
    readonly name: string;
    readonly location: string;
    readonly heat: string;
    readonly damage: string;
    readonly minimumRange: string;
    readonly ranges: readonly string[];
    readonly componentIds: readonly string[];
    readonly quantity: number;
    readonly alternativeModes: readonly RecordSheetInventoryAlternativeMode[];
}

interface MekInventoryMetrics {
    readonly fontSize: number;
    readonly lineStep: number;
    readonly ammoLines: readonly string[];
    readonly quirkLines: readonly string[];
}

function mekRecordSheetInventoryRows(entity: MekEntity): readonly MekRecordSheetInventoryRow[] {
    const mountsById = new Map(entity.equipment().map(mount => [String(mount.mountId), mount] as const));
    const weaponRows: MekRecordSheetInventoryRow[] = recordSheetInventoryWeapons(entity).map(row => {
        const firstId = row.componentIds[0];
        const mount = firstId === undefined ? undefined : mountsById.get(firstId);
        return Object.freeze({
            ...row,
            name: mount ? mekInventoryMountName(entity, mount) : row.name,
        });
    });
    const rangedMounts = new Set<EntityMountedEquipment>(entity.rangedWeapons());
    const equipmentRows: MekRecordSheetInventoryRow[] = entity.equipment()
        .filter(mount => !rangedMounts.has(mount) && isPrintableMekInventoryMount(mount))
        .sort((left, right) => {
            const name = left.displayName().localeCompare(right.displayName());
            return name !== 0 ? name : left.location.localeCompare(right.location);
        })
        .map(mount => Object.freeze({
            name: mekInventoryMountName(entity, mount),
            location: formatEquipmentLocationCodes(mount.getOccupiedLocations()),
            heat: '—',
            damage: mekMiscInventoryDamage(mount),
            minimumRange: '—',
            ranges: Object.freeze(['—', '—', '—']),
            componentIds: Object.freeze([String(mount.mountId)]),
            quantity: 1,
            alternativeModes: Object.freeze([]),
        }));
    return Object.freeze([...weaponRows, ...equipmentRows]);
}

function isPrintableMekInventoryMount(mount: EntityMountedEquipment): boolean {
    const equipment = mount.equipment;
    if (!equipment || equipment.type !== 'misc' || !equipment.hittable) return false;
    if (mount.location === 'Engine' || mount.location === 'Unallocated') return false;
    if (isHeatSinkEquipment(equipment) || isJumpJetEquipment(equipment)) return false;
    return !isMekRecordSheetInventorySupport(equipment);
}

function mekInventoryMountName(entity: MekEntity, mount: EntityMountedEquipment): string {
    const equipment = mount.equipment;
    if (!equipment || !entity.mixedTech() || equipment.techBase === 'All') return mount.displayName();
    const ambiguous = Object.values(entity.getEquipmentRegistry().equipment).some(candidate =>
        candidate !== equipment
        && candidate.name === equipment.name
        && candidate.techBase !== equipment.techBase);
    if (!ambiguous) return mount.displayName();
    return insertEquipmentTechSuffix(
        mount.displayName(),
        equipment.techBase === 'Clan' ? '(C)' : '(IS)',
    );
}

function insertEquipmentTechSuffix(name: string, suffix: string): string {
    const modifierIndex = name.indexOf(' (');
    return modifierIndex < 0
        ? `${name} ${suffix}`
        : `${name.slice(0, modifierIndex)} ${suffix}${name.slice(modifierIndex)}`;
}

function mekMiscInventoryDamage(mount: EntityMountedEquipment): string {
    const equipment = mount.equipment;
    if (!equipment) return '—';
    if (equipment.hasFlag('F_AP_POD')) return '[PB,OS,AI]';
    if (isTargetingComputerEquipment(equipment)) return '[E]';
    const physicalDamage = mount.getPhysicalWeaponDamage();
    return physicalDamage === undefined ? '—' : String(physicalDamage.value);
}

function mekInventoryMetrics(
    equipmentLines: number,
    physicalLines: number,
    ammoText: string,
    quirksText: string,
): MekInventoryMetrics {
    const availableHeight = 171.981;
    let fontSize = 6.76;
    while (true) {
        const ammoLines = wrapMekInventoryFooter(ammoText, fontSize);
        const quirkLines = wrapMekInventoryFooter(quirksText, fontSize * 0.9);
        const hasFooter = physicalLines + ammoLines.length + quirkLines.length > 0;
        const lineCount = equipmentLines
            + physicalLines
            + ammoLines.length
            + quirkLines.length
            + 1
            + (hasFooter ? 1 : 0);
        const minimumStep = fontSize * 0.93;
        if (minimumStep * lineCount <= availableHeight || fontSize <= 4.5) {
            const maximumStep = fontSize * 1.35;
            const availableStep = availableHeight / Math.max(1, lineCount);
            const lineStep = availableStep - minimumStep < fontSize * 0.012
                ? minimumStep
                : Math.min(maximumStep, Math.max(minimumStep, availableStep));
            return Object.freeze({ fontSize, lineStep, ammoLines, quirkLines });
        }
        fontSize = Math.max(4.5, Number((fontSize - 0.05).toFixed(2)));
    }
}

function wrapMekInventoryFooter(value: string, fontSize: number): readonly string[] {
    if (!value) return Object.freeze([]);
    const maxCharacters = Math.max(1, Math.floor(209.38 / (fontSize * 0.43)));
    const lines: string[] = [];
    value.split(/\s+/u).forEach(word => {
        const current = lines.at(-1);
        if (current === undefined || current.length + 1 + word.length > maxCharacters) {
            lines.push(word);
        } else {
            lines[lines.length - 1] = `${current} ${word}`;
        }
    });
    return Object.freeze(lines);
}

function mekPhysicalInventoryRows(entity: MekEntity): readonly {
    readonly name: string;
    readonly location: string;
    readonly heat: string;
    readonly damage: string;
    readonly minimumRange: string;
    readonly ranges: readonly string[];
    readonly componentIds: readonly string[];
}[] {
    return Object.freeze(entity.intrinsicWeapons().map(attack => Object.freeze({
        name: attack.name === 'Club (Club/Improvised)' ? 'Club' : attack.name,
        location: attack.locations.join('/'),
        heat: '—',
        damage: mekPhysicalDamageText(attack),
        minimumRange: '—',
        ranges: Object.freeze(['—', '—', '—']),
        componentIds: Object.freeze([]),
    })));
}

function mekPhysicalDamageText(attack: IntrinsicWeapon): string {
    if (attack.kind !== 'charge' || attack.damage.kind !== 'per-hex') {
        return intrinsicActionBaseDamageText(attack);
    }
    const coefficient = formatNumber(attack.damage.coefficient * 2);
    return `${coefficient}×(TMM+1)${attack.damage.bonus === 0 ? '' : `+${attack.damage.bonus}`}`;
}

function drawMekCrewPanelContents(group: SVGGElement, entity: BaseEntity, box: Box): void {
    const crewCount = Math.max(1, entity.crewSlotCount());
    if (isMekEntity(entity) && entity.chassisConfig === 'LAM') {
        drawLamMekCrewPanelContents(group, box);
        return;
    }
    if (crewCount > 1 && isMekEntity(entity)) {
        drawMultiCrewMekPanelContents(group, entity, box, crewCount);
        return;
    }
    const sx = box.width / 145.6;
    const sy = box.height / 83;
    const content = svgElement('g');
    content.setAttribute('class', 'frame mek-single-crew-data');
    content.setAttribute(
        'transform',
        `translate(${formatNumber(3 * sx)} ${formatNumber(18 * sy)}) scale(${formatNumber(sx)} ${formatNumber(sy)})`,
    );
    appendMmlMekCrewOccurrence(content, 0, 'Name');
    group.appendChild(content);
}

function drawLamMekCrewPanelContents(group: SVGGElement, box: Box): void {
    const sx = box.width / 145.6;
    const sy = box.height / 110;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    addText(group, 'Name:', x(3), y(27), { size: font(7.2), weight: 700 });
    const name = addText(group, '', x(29), y(27), { size: font(7.2), weight: 700, maxWidth: x(111) });
    name.id = 'crewName0';
    const nameButton = transparentRect(x(27), y(17), x(114), y(13), 'crewNameButton');
    nameButton.setAttribute('crewId', '0');
    nameButton.setAttribute('textElement', name.id);
    group.appendChild(nameButton);
    addLine(group, x(3), y(33), box.width - x(3), y(33), '#111', 0.65 * fontScale);
    addText(group, 'BattleMech', x(3), y(44), { size: font(6.4), weight: 700 });
    drawLamSkillRow(group, x, y, font, 54, 0, 'gunnerySkill0', 'pilotingSkill0');
    addText(group, 'Aerospace', x(3), y(66), { size: font(6.4), weight: 700 });
    drawLamSkillRow(group, x, y, font, 76, 0, 'aeroGunnerySkill0', 'aeroPilotingSkill0');
    drawCrewHitGrid(group, 0, {
        x: x(61), y: y(82), cellWidth: x(13.2), cellHeight: y(10.5),
        labelX: x(3), labelWidth: x(56), fontScale,
    });
    const banner = svgElement('g');
    banner.id = 'crewState0';
    banner.setAttribute('crewId', '0');
    banner.setAttribute('class', 'crewStateBanner');
    banner.setAttribute('display', 'none');
    group.appendChild(banner);
}

function drawLamSkillRow(
    group: SVGGElement,
    x: (value: number) => number,
    y: (value: number) => number,
    font: (value: number) => number,
    baseline: number,
    crewId: number,
    gunneryId: string,
    pilotingId: string,
): void {
    addText(group, 'Gunnery Skill:', x(3), y(baseline), { size: font(5.7), weight: 700 });
    const gunnery = addText(group, '4', x(49), y(baseline), { size: font(6.4), anchor: 'middle', class: 'skillValue' });
    gunnery.id = gunneryId;
    const gunButton = transparentRect(x(43), y(baseline - 9), x(13), y(12) - y(0), 'crewSkillButton');
    gunButton.setAttribute('crewId', String(crewId));
    gunButton.setAttribute('skill', gunneryId.startsWith('aero') ? 'aero-gunnery' : 'gunnery');
    group.appendChild(gunButton);
    addText(group, 'Piloting Skill:', x(72), y(baseline), { size: font(5.7), weight: 700 });
    const piloting = addText(group, '5', x(132), y(baseline), { size: font(6.4), anchor: 'middle', class: 'skillValue' });
    piloting.id = pilotingId;
    const pilotButton = transparentRect(x(124), y(baseline - 9), x(16), y(12) - y(0), 'crewSkillButton');
    pilotButton.setAttribute('crewId', String(crewId));
    pilotButton.setAttribute('skill', pilotingId.startsWith('aero') ? 'aero-piloting' : 'piloting');
    group.appendChild(pilotButton);
}

function drawMultiCrewMekPanelContents(
    group: SVGGElement,
    entity: MekEntity,
    box: Box,
    crewCount: number,
): void {
    const sx = box.width / 145.6;
    const sy = box.height / (31 + crewCount * 52);
    const content = svgElement('g');
    content.setAttribute('class', 'frame mek-multi-crew-data');
    content.setAttribute(
        'transform',
        `translate(${formatNumber(3 * sx)} ${formatNumber(18 * sy)}) scale(${formatNumber(sx)} ${formatNumber(sy)})`,
    );
    const roles = mekCrewRoleLabels(entity, crewCount);
    for (let occurrence = 0; occurrence < crewCount; occurrence++) {
        appendMmlMekCrewOccurrence(content, occurrence, roles[occurrence] ?? `Crew ${occurrence + 1}`);
    }
    group.appendChild(content);
}

function appendMmlMekCrewOccurrence(
    content: SVGGElement,
    occurrence: number,
    role: string,
): void {
    const block = svgElement('g');
    block.setAttribute('class', 'mek-crew-position');
    if (occurrence > 0) block.setAttribute('transform', `translate(0 ${occurrence * 52})`);

    const roleLabel = addText(block, `${role}:`, 3, 12, { size: 6.76, weight: 700 });
    roleLabel.id = `crewName${occurrence}`;
    const nameStart: Readonly<Record<string, number>> = {
        Name: 25.228,
        Pilot: 20.051,
        Gunner: 28.473,
        'Tech Officer': 45.059,
    };
    const pilotName = addText(block, '', nameStart[role] ?? 25.228, 12, {
        size: 6.76,
        maxWidth: 114.372,
    });
    pilotName.id = `pilotName${occurrence}`;
    const blankName = svgElement('path');
    setAttributes(blankName, {
        id: `blankCrewName${occurrence}`,
        d: 'M 25.228 13 H 139.6',
        stroke: '#000',
        'stroke-width': 0.72,
        'stroke-linejoin': 'round',
        fill: 'none',
    });
    block.appendChild(blankName);
    const nameButton = transparentRect(3.228, 1, 124.372, 12, 'crewNameButton');
    nameButton.id = `crewNameButton${occurrence}`;
    nameButton.setAttribute('crewId', String(occurrence));
    nameButton.setAttribute('textElement', pilotName.id);
    nameButton.setAttribute('blankElement', blankName.id);
    block.appendChild(nameButton);

    const gunneryLabel = addText(block, 'Gunnery Skill:', 3, 24, { size: 6.76, weight: 700 });
    gunneryLabel.id = `gunnerySkillText${occurrence}`;
    gunneryLabel.setAttribute('textLength', '39.172');
    gunneryLabel.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    const gunnery = addText(block, '4', 48.632, 24, { size: 6.76, class: 'skillValue' });
    gunnery.id = `gunnerySkill${occurrence}`;
    const blankGunnery = svgElement('path');
    setAttributes(blankGunnery, {
        id: `blankGunnerySkill${occurrence}`,
        d: 'M 48.632 25 H 67.17',
        stroke: '#000', 'stroke-width': 0.72, 'stroke-linejoin': 'round', fill: 'none',
    });
    block.appendChild(blankGunnery);

    const pilotingLabel = addText(block, 'Piloting Skill:', 71.3, 24, { size: 6.76, weight: 700 });
    pilotingLabel.id = `pilotingSkillText${occurrence}`;
    pilotingLabel.setAttribute('textLength', '36.72');
    pilotingLabel.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    const piloting = addText(block, '5', 116.932, 24, { size: 6.76, class: 'skillValue' });
    piloting.id = `pilotingSkill${occurrence}`;
    const blankPiloting = svgElement('path');
    setAttributes(blankPiloting, {
        id: `blankPilotingSkill${occurrence}`,
        d: 'M 116.932 25 H 139.6',
        stroke: '#000', 'stroke-width': 0.72, 'stroke-linejoin': 'round', fill: 'none',
    });
    block.appendChild(blankPiloting);

    const damage = svgElement('g');
    damage.id = `crewDamage${occurrence}`;
    const damageOutline = svgElement('path');
    setAttributes(damageOutline, {
        d: 'M 49.91 33.015 C 49.91 32.455 50.365 32 50.925 32 h 87.66 c .56 0 1.015 .455 1.015 1.015 v 17.97 c 0 .56 -.455 1.015 -1.015 1.015 h -87.66 c -.56 0 -1.015 -.455 -1.015 -1.015 z',
        fill: 'none', stroke: '#000', 'stroke-linejoin': 'round',
    });
    damage.appendChild(damageOutline);
    const damageGrid = svgElement('path');
    setAttributes(damageGrid, {
        d: 'M 49.91 42 H 139.6 M 64.858 32 V 52 M 79.807 32 V 52 M 94.755 32 v 20 m 14.948 -20 v 20 m 14.949 -20 v 20',
        fill: 'none', stroke: '#000', 'stroke-width': 0.58, 'stroke-linecap': 'round',
    });
    damage.appendChild(damageGrid);
    const hitX = [57.384, 72.333, 87.281, 102.229, 117.178, 132.126] as const;
    const consciousness = ['3', '5', '7', '10', '11', 'Dead'] as const;
    hitX.forEach((center, index) => {
        const hitNumber = addText(damage, String(index + 1), center, 39, {
            size: 5.8, weight: 700, anchor: 'middle',
        });
        hitNumber.id = `crew_damage_${occurrence}_${index + 1}`;
        const hitControl = svgElement('g');
        hitControl.setAttribute('class', 'crewHit');
        hitControl.setAttribute('crewId', String(occurrence));
        hitControl.setAttribute('hit', String(index + 1));
        const firstCross = addLine(hitControl, center - 5, 33.2, center + 5, 41.2, 'red', 1.5);
        firstCross.setAttribute('class', 'crew-x');
        firstCross.setAttribute('opacity', '0');
        const secondCross = addLine(hitControl, center + 5, 33.2, center - 5, 41.2, 'red', 1.5);
        secondCross.setAttribute('class', 'crew-x');
        secondCross.setAttribute('opacity', '0');
        hitControl.appendChild(transparentRect(center - 7, 32.2, 14, 10, 'crew-hit-target'));
        damage.appendChild(hitControl);
        const lower = addText(damage, consciousness[index], center, 49, {
            size: 5.8, weight: 700, anchor: 'middle',
        });
        if (index === 5) {
            lower.setAttribute('textLength', '10.948');
            lower.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
    });
    addText(damage, 'Hits Taken', 46.91, 39, { size: 5.2, weight: 700, anchor: 'end' });
    addText(damage, 'Consciousness #', 46.91, 49, { size: 5.2, weight: 700, anchor: 'end' });
    block.appendChild(damage);

    const gunButton = transparentRect(38.632, 15.3, 30, 12, 'crewSkillButton');
    gunButton.id = `crewSkillButton_${occurrence}_gunnery`;
    gunButton.setAttribute('crewId', String(occurrence));
    gunButton.setAttribute('skill', 'gunnery');
    gunButton.setAttribute('textElement', gunnery.id);
    block.appendChild(gunButton);
    const pilotButton = transparentRect(106.932, 15.3, 30, 12, 'crewSkillButton');
    pilotButton.id = `crewSkillButton_${occurrence}_piloting`;
    pilotButton.setAttribute('crewId', String(occurrence));
    pilotButton.setAttribute('skill', 'piloting');
    pilotButton.setAttribute('textElement', piloting.id);
    block.appendChild(pilotButton);
    const banner = svgElement('g');
    banner.id = `crewState${occurrence}`;
    banner.setAttribute('crewId', String(occurrence));
    banner.setAttribute('class', 'crewStateBanner');
    banner.setAttribute('display', 'none');
    block.appendChild(banner);
    content.appendChild(block);
}

function mekCrewRoleLabels(entity: MekEntity, count: number): readonly string[] {
    if (entity.chassisConfig === 'Tripod') {
        return ['Pilot', 'Gunner', 'Tech Officer'].slice(0, count);
    }
    if (entity.chassisConfig === 'QuadVee') {
        return ['Pilot', 'Gunner'].slice(0, count);
    }
    return Array.from({ length: count }, (_, index) => index === 0 ? 'Pilot' : `Crew ${index + 1}`);
}

function bipedStructureTonnage(entity: MekEntity): Exclude<BipedStructureTonnage, number> {
    const tonnages = entity.structureTonnages();
    const fallback = entity.tonnage();
    return {
        HD: tonnages.get('HD') ?? fallback,
        CT: tonnages.get('CT') ?? fallback,
        LT: tonnages.get('LT') ?? fallback,
        RT: tonnages.get('RT') ?? fallback,
        LA: tonnages.get('LA') ?? fallback,
        RA: tonnages.get('RA') ?? fallback,
        LL: tonnages.get('LL') ?? fallback,
        RL: tonnages.get('RL') ?? fallback,
    };
}

async function drawMekDamagePanel(svg: SVGSVGElement, entity: MekEntity, box: Box): Promise<void> {
    const group = addFrame(svg, 'ARMOR / INTERNAL', box);
    const pipLayout = mekPaperdollPipLayout(entity);
    group.setAttribute('data-mekbay-pip-layout', pipLayout);
    if (entity.chassisConfig !== 'Biped') {
        drawDamagePanelIntoGroup(group, entity, box.width, box.height);
        return;
    }
    const armor: Record<string, number> = {};
    for (const location of entity.damageLocations()) {
        armor[location.code] = location.armor.front;
        if (location.armor.rear > 0) armor[`${location.code}_R`] = location.armor.rear;
    }
    const structureTonnage = bipedStructureTonnage(entity);
    try {
        const front = await BipedPaperdollUtil.createArmorPaperdoll(126, 278, armor as BipedArmorValues, {
            centeredHorizontally: true,
            centeredVertically: true,
            pipLayout,
            fallbackPipLayout: 'generic',
            pipOptions: paperdollPipOptions(pipLayout, 2.1, 0.9),
        });
        front.setAttribute('transform', 'translate(5 29)');
        decoratePaperdollPips(front);
        group.appendChild(front);
        const structure = await BipedPaperdollUtil.createStructurePaperdoll(71, 132, structureTonnage, {
            centeredHorizontally: true,
            centeredVertically: true,
            pipLayout,
            fallbackPipLayout: 'generic',
            pipOptions: paperdollPipOptions(pipLayout, 1.55, 0.75),
        });
        structure.setAttribute('transform', 'translate(130 29)');
        decoratePaperdollPips(structure);
        group.appendChild(structure);
        const rear = await BipedPaperdollUtil.createArmorRearPaperdoll(71, 132, armor as BipedArmorValues, {
            centeredHorizontally: true,
            centeredVertically: true,
            pipLayout,
            fallbackPipLayout: 'generic',
            pipOptions: paperdollPipOptions(pipLayout, 1.55, 0.75),
        });
        rear.setAttribute('transform', 'translate(130 166)');
        decoratePaperdollPips(rear, true);
        group.appendChild(rear);
    } catch {
        drawDamagePanelIntoGroup(group, entity, box.width, box.height);
    }
}

export async function drawMekPaperdolls(svg: SVGSVGElement, entity: MekEntity, box: Box): Promise<void> {
    if (entity.chassisConfig !== 'Biped' && entity.chassisConfig !== 'LAM') {
        await drawProfiledMekPaperdolls(svg, entity, box);
        return;
    }

    const group = svgElement('g');
    group.setAttribute('class', 'mek-paperdolls');
    group.setAttribute('transform', `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`);
    const paperdollScaleX = box.width / 173;
    const paperdollScaleY = box.height / 543;
    const pipLayout = mekPaperdollPipLayout(entity);
    group.setAttribute('data-mekbay-pip-layout', pipLayout);
    const armor: Record<string, number> = {};
    for (const location of entity.damageLocations()) {
        armor[location.code] = location.armor.front;
        if (location.armor.rear > 0) armor[`${location.code}_R`] = location.armor.rear;
    }
    const structureTonnage = bipedStructureTonnage(entity);

    addDiagramHeading(
        group,
        'ARMOR DIAGRAM',
        constructionMaterialSubtitle(entity.uniformArmor()?.armor.name, 'Armor', 'Patchwork Armor'),
        box.width,
        0,
        {
            titleWidth: 84,
            titleX: 54.004,
            titleY: -0.197,
            titleTextLength: 69.539,
            ribbonX: 36.004,
            ribbonY: 0,
            ribbonWidth: 123.749,
            ribbonCut: 3.749,
            subtitleX: 96,
            subtitleY: 21.5,
            subtitleId: 'armorType',
        },
    );
    // The classic Biped asset contains both the front and rear armor diagrams,
    // matching the MegaMekLab record-sheet drawing.  It is shared with the LAM
    // sheet, but is not LAM-specific artwork.
    const front = await BipedPaperdollUtil.createArmorPaperdoll(box.width, box.height * 0.62, armor as BipedArmorValues, {
        assetUrl: '/images/paperdolls/lam-armor.svg',
        centeredHorizontally: false,
        centeredVertically: false,
        scale: false,
        pipLayout,
        fallbackPipLayout: 'generic',
        pipOptions: paperdollPipOptions(pipLayout, 2.15, 0.9),
    });
    // The lightweight asset retains its authored viewBox translation.  This
    // outer transform reproduces MML's .97/10/29 Biped and .97/9/30 LAM
    // matrices exactly, while the page factors keep the drawing reusable on A4.
    const armorOffset = entity.chassisConfig === 'LAM'
        ? { x: 5, y: 30 }
        : { x: 6, y: 29 };
    front.setAttribute(
        'transform',
        `translate(${formatGeometryNumber(armorOffset.x * paperdollScaleX)} `
        + `${formatGeometryNumber(armorOffset.y * paperdollScaleY)}) `
        + `scale(${formatGeometryNumber(paperdollScaleX)} ${formatGeometryNumber(paperdollScaleY)})`,
    );
    decoratePaperdollPips(front);
    if (entity.chassisConfig === 'LAM') {
        front.querySelectorAll('.pip.armor').forEach(pip => pip.remove());
    }
    group.appendChild(front);
    if (entity.chassisConfig === 'LAM') {
        drawLamDistributedArmorPips(group, entity, box);
    } else {
        relocateCanonicalBipedPips(front, group, BIPED_CANON_ARMOR_PIP_PLACEMENTS, box);
    }

    const structureHeadingY = box.height * (370 / 543);
    addDiagramHeading(
        group,
        'INTERNAL STRUCTURE DIAGRAM',
        constructionMaterialSubtitle(entity.uniformStructureMaterial()?.structure.name, 'Structure', 'Hybrid Structure'),
        box.width,
        structureHeadingY,
        {
            titleWidth: 142.791,
            titleX: 13.745,
            titleY: 352.888,
            titleTextLength: 126.662,
            ribbonX: 25.723,
            ribbonY: 354.03,
            ribbonWidth: 122.512,
            ribbonCut: 3.712,
            subtitleX: 86.034,
            subtitleY: 375.445,
            subtitleId: 'structureType',
            subtitleHorizontalScale: 0.990245,
        },
    );
    const structureWidth = box.width * 0.74;
    const structure = await BipedPaperdollUtil.createStructurePaperdoll(
        structureWidth,
        box.height * 0.3,
        structureTonnage,
        {
            assetUrl: '/images/paperdolls/lam-structure.svg',
            centeredHorizontally: false,
            centeredVertically: false,
            scale: false,
            pipLayout,
            fallbackPipLayout: 'generic',
            pipOptions: paperdollPipOptions(pipLayout, 1.55, 0.7),
        },
    );
    if (pipLayout === 'canon' && !structure.querySelector('[data-pip-location="HD"]')) {
        const headTonnage = entity.structureTonnages().get('HD') ?? entity.tonnage();
        const headPips = CanonPipRenderer.createStructurePips(
            headTonnage,
            'HD',
            1,
            0.939,
            paperdollPipOptions('canon', 1.55, 0.7),
        );
        if (headPips) structure.appendChild(headPips);
    }
    const structurePlacement = entity.chassisConfig === 'LAM'
        ? { x: 25, y: 376, scale: 1 }
        : { x: 22.080155, y: 375.782156, scale: 1.015255102 };
    structure.setAttribute(
        'transform',
        `translate(${formatGeometryNumber(structurePlacement.x * paperdollScaleX)} `
        + `${formatGeometryNumber(structurePlacement.y * paperdollScaleY)}) `
        + `scale(${formatGeometryNumber(structurePlacement.scale * paperdollScaleX)} `
        + `${formatGeometryNumber(structurePlacement.scale * paperdollScaleY)})`,
    );
    decoratePaperdollPips(structure);
    if (entity.chassisConfig === 'LAM') {
        structure.querySelectorAll('.pip.structure').forEach(pip => pip.remove());
    }
    group.appendChild(structure);
    if (entity.chassisConfig === 'LAM') {
        drawLamDistributedStructurePips(group, entity, box);
    } else {
        relocateCanonicalBipedPips(structure, group, BIPED_CANON_STRUCTURE_PIP_PLACEMENTS, box);
    }
    if (group.querySelector('[data-mekbay-paperdoll-overlay]')) {
        initializeMekDiagramCounters(group, entity);
    } else {
        drawBipedDiagramValues(group, entity, box);
    }
    svg.appendChild(group);
}

interface LamPipPoint {
    readonly x: number;
    readonly y: number;
}

const LAM_ARMOR_PIP_RAILS: Readonly<Record<string, readonly LamPipPoint[]>> = Object.freeze({
    HD: Object.freeze([
        { x: 94.908, y: 58.432 }, { x: 91.863, y: 62.582 }, { x: 97.915, y: 62.618 },
        { x: 89.352, y: 66.881 }, { x: 94.908, y: 66.844 }, { x: 100.464, y: 66.881 },
        { x: 89.352, y: 72.132 }, { x: 94.908, y: 72.095 }, { x: 100.464, y: 72.132 },
    ]),
    CT: Object.freeze([
        { x: 84.705, y: 94.36 }, { x: 94.906, y: 94.362 }, { x: 105.108, y: 94.362 },
        { x: 84.67, y: 113.773 }, { x: 94.871, y: 113.774 }, { x: 105.072, y: 113.774 },
        { x: 84.67, y: 133.22 }, { x: 94.871, y: 133.222 }, { x: 105.072, y: 133.222 },
        { x: 84.67, y: 152.701 }, { x: 94.871, y: 152.703 }, { x: 105.072, y: 152.703 },
    ]),
    RT: Object.freeze([
        { x: 122.637, y: 73.153 }, { x: 132.838, y: 73.153 }, { x: 127.738, y: 85.188 },
        { x: 122.637, y: 97.219 }, { x: 132.838, y: 97.219 }, { x: 122.637, y: 109.253 },
        { x: 120.669, y: 121.284 }, { x: 115.853, y: 133.283 }, { x: 128.711, y: 145.317 },
    ]),
    LT: Object.freeze([
        { x: 57.194, y: 73.153 }, { x: 67.395, y: 73.154 }, { x: 62.295, y: 85.188 },
        { x: 57.194, y: 97.219 }, { x: 67.395, y: 97.22 }, { x: 67.395, y: 109.253 },
        { x: 69.363, y: 121.284 }, { x: 74.179, y: 133.283 }, { x: 61.32, y: 145.316 },
    ]),
    RA: Object.freeze([
        { x: 157.281, y: 60.554 }, { x: 165.192, y: 89.466 }, { x: 154.507, y: 90.4 },
        { x: 162.42, y: 119.311 }, { x: 170.33, y: 148.221 }, { x: 159.647, y: 149.158 },
    ]),
    LA: Object.freeze([
        { x: 33.028, y: 60.554 }, { x: 25.117, y: 89.466 }, { x: 35.801, y: 90.4 },
        { x: 27.889, y: 119.309 }, { x: 19.977, y: 148.222 }, { x: 30.662, y: 149.158 },
    ]),
    RL: Object.freeze([
        { x: 121.349, y: 163.904 }, { x: 130.708, y: 179.824 }, { x: 119.915, y: 182.313 },
        { x: 129.272, y: 198.226 }, { x: 138.63, y: 214.148 }, { x: 127.838, y: 216.635 },
        { x: 137.194, y: 232.549 }, { x: 146.558, y: 248.466 }, { x: 135.763, y: 250.957 },
        { x: 145.117, y: 266.87 },
    ]),
    LL: Object.freeze([
        { x: 68.337, y: 163.904 }, { x: 58.979, y: 179.824 }, { x: 69.772, y: 182.313 },
        { x: 60.414, y: 198.226 }, { x: 51.057, y: 214.148 }, { x: 61.849, y: 216.635 },
        { x: 52.492, y: 232.549 }, { x: 43.129, y: 248.466 }, { x: 53.924, y: 250.957 },
        { x: 44.569, y: 266.87 },
    ]),
    CT_R: Object.freeze([
        { x: 94.714, y: 288.108 }, { x: 94.714, y: 309.259 }, { x: 94.714, y: 330.408 },
    ]),
    RT_R: Object.freeze([
        { x: 125.294, y: 295.003 }, { x: 125.294, y: 305.193 }, { x: 125.295, y: 315.382 },
    ]),
    LT_R: Object.freeze([
        { x: 64.975, y: 295.003 }, { x: 64.975, y: 305.193 }, { x: 64.975, y: 315.383 },
    ]),
});

const LAM_ARMOR_PIP_RADIUS: Readonly<Record<string, number>> = Object.freeze({
    HD: 2.17,
    CT: 2.283,
    RT: 2.283,
    LT: 2.283,
    RA: 2.924,
    LA: 2.924,
    RL: 2.805,
    LL: 2.805,
    CT_R: 1.919,
    RT_R: 1.919,
    LT_R: 1.919,
});

const LAM_STRUCTURE_PIP_RAILS: Readonly<Record<string, readonly LamPipPoint[]>> = Object.freeze({
    HD: Object.freeze([
        { x: 85.8, y: 393.009 }, { x: 81.817, y: 400.455 }, { x: 89.977, y: 400.455 },
    ]),
    CT: Object.freeze([
        { x: 81.541, y: 415.028 }, { x: 90.387, y: 415.028 },
        { x: 81.541, y: 425.26 }, { x: 90.387, y: 425.26 },
        { x: 81.541, y: 435.492 }, { x: 90.387, y: 435.492 },
        { x: 81.541, y: 445.725 }, { x: 90.387, y: 445.725 },
        { x: 81.541, y: 455.956 }, { x: 90.387, y: 455.956 },
    ]),
    RT: Object.freeze([
        { x: 108.279, y: 405.461 }, { x: 102.605, y: 415.026 }, { x: 113.778, y: 415.027 },
        { x: 102.605, y: 425.258 }, { x: 101.071, y: 435.491 }, { x: 99.219, y: 445.723 },
        { x: 107.587, y: 455.956 },
    ]),
    LT: Object.freeze([
        { x: 63.514, y: 405.46 }, { x: 58.016, y: 415.026 }, { x: 69.188, y: 415.027 },
        { x: 69.188, y: 425.259 }, { x: 70.724, y: 435.49 }, { x: 72.578, y: 445.723 },
        { x: 63.823, y: 455.956 },
    ]),
    RA: Object.freeze([
        { x: 131.677, y: 411.303 }, { x: 132.861, y: 424.856 }, { x: 134.048, y: 438.411 },
        { x: 135.233, y: 451.964 }, { x: 136.419, y: 465.519 },
    ]),
    LA: Object.freeze([
        { x: 40.25, y: 411.304 }, { x: 39.065, y: 424.856 }, { x: 37.879, y: 438.411 },
        { x: 36.692, y: 451.964 }, { x: 35.508, y: 465.517 },
    ]),
    RL: Object.freeze([
        { x: 103.795, y: 465.011 }, { x: 106.378, y: 478.295 }, { x: 108.96, y: 491.582 },
        { x: 111.543, y: 504.864 }, { x: 114.125, y: 518.148 }, { x: 116.707, y: 531.434 },
        { x: 119.29, y: 544.718 },
    ]),
    LL: Object.freeze([
        { x: 66.994, y: 465.011 }, { x: 64.412, y: 478.295 }, { x: 61.829, y: 491.582 },
        { x: 59.246, y: 504.864 }, { x: 56.664, y: 518.149 }, { x: 54.081, y: 531.433 },
        { x: 51.499, y: 544.717 },
    ]),
});

function drawLamDistributedArmorPips(group: SVGGElement, entity: MekEntity, box: Box): void {
    const sx = box.width / 173;
    const sy = box.height / 543;
    const fontScale = Math.min(sx, sy);
    const locations = new Map(entity.damageLocations().map(location => [location.code, location] as const));
    const pips = svgElement('g');
    pips.setAttribute('class', 'lam-distributed-armor-pips');
    pips.setAttribute('data-pip-layout', 'distributed');
    for (const [location, rail] of Object.entries(LAM_ARMOR_PIP_RAILS)) {
        const rear = location.endsWith('_R');
        const baseLocation = rear ? location.slice(0, -2) : location;
        const damageLocation = locations.get(baseLocation);
        const count = Math.max(0, rear ? damageLocation?.armor.rear ?? 0 : damageLocation?.armor.front ?? 0);
        const gridColumns = location === 'CT' || location === 'HD' ? 3 : undefined;
        const points = lamDistributedPipPoints(rail, count, gridColumns);
        points.forEach((point, index) => {
            const pip = circle(
                point.x * sx,
                point.y * sy,
                (LAM_ARMOR_PIP_RADIUS[location] ?? 2.414) * fontScale,
                'pip armor',
            );
            setAttributes(pip, {
                fill: '#fff', stroke: '#000', 'stroke-width': 0.5 * fontScale,
                loc: baseLocation, rear: rear ? 1 : undefined,
            });
            pip.id = `armor_pip_${location.toLowerCase()}_${index + 1}`;
            pips.appendChild(pip);
        });
    }
    group.appendChild(pips);
}

function drawLamDistributedStructurePips(group: SVGGElement, entity: MekEntity, box: Box): void {
    const sx = box.width / 173;
    const sy = box.height / 543;
    const fontScale = Math.min(sx, sy);
    const locations = new Map(entity.damageLocations().map(location => [location.code, location] as const));
    const pips = svgElement('g');
    pips.setAttribute('class', 'lam-distributed-structure-pips');
    pips.setAttribute('data-pip-layout', 'distributed');
    for (const [location, rail] of Object.entries(LAM_STRUCTURE_PIP_RAILS)) {
        const count = Math.max(0, locations.get(location)?.internalPoints ?? 0);
        const points = lamDistributedPipPoints(rail, count, location === 'CT' ? 2 : undefined);
        points.forEach((point, index) => {
            const pip = circle(point.x * sx, point.y * sy, 2.034 * fontScale, 'pip structure');
            setAttributes(pip, { fill: '#fff', stroke: '#000', 'stroke-width': 0.5 * fontScale, loc: location });
            pip.id = `is_pip_${location.toLowerCase()}_${index + 1}`;
            pips.appendChild(pip);
        });
    }
    group.appendChild(pips);
}

function lamDistributedPipPoints(
    rail: readonly LamPipPoint[],
    count: number,
    gridColumns?: number,
): readonly LamPipPoint[] {
    if (count <= 0) return [];
    if (count === rail.length) return rail;
    if (gridColumns !== undefined) {
        const minX = Math.min(...rail.map(point => point.x));
        const maxX = Math.max(...rail.map(point => point.x));
        const minY = Math.min(...rail.map(point => point.y));
        const maxY = Math.max(...rail.map(point => point.y));
        const rows = Math.ceil(count / gridColumns);
        const step = rows <= 1 ? 0 : (maxY - minY) / (rows - 1);
        return Array.from({ length: count }, (_, index) => {
            const row = Math.floor(index / gridColumns);
            const column = index % gridColumns;
            const rowCount = Math.min(gridColumns, count - row * gridColumns);
            const rowWidth = maxX - minX;
            const rowMinX = rowCount === gridColumns
                ? minX
                : minX + rowWidth * (gridColumns - rowCount) / (2 * Math.max(1, gridColumns - 1));
            return {
                x: rowCount <= 1 ? (minX + maxX) / 2 : rowMinX + column * rowWidth / (gridColumns - 1),
                y: minY + row * step,
            };
        });
    }
    if (count === 1) return [rail[Math.floor(rail.length / 2)]!];
    const distances = [0];
    for (let index = 1; index < rail.length; index++) {
        distances.push(distances[index - 1]!
            + Math.hypot(rail[index]!.x - rail[index - 1]!.x, rail[index]!.y - rail[index - 1]!.y));
    }
    const total = distances[distances.length - 1] ?? 0;
    return Array.from({ length: count }, (_, index) => {
        const target = total * index / (count - 1);
        const upperIndex = Math.max(1, distances.findIndex(distance => distance >= target));
        const lowerIndex = upperIndex - 1;
        const lower = rail[lowerIndex]!;
        const upper = rail[upperIndex] ?? lower;
        const segment = (distances[upperIndex] ?? target) - (distances[lowerIndex] ?? 0);
        const ratio = segment <= 0 ? 0 : (target - (distances[lowerIndex] ?? 0)) / segment;
        return {
            x: lower.x + (upper.x - lower.x) * ratio,
            y: lower.y + (upper.y - lower.y) * ratio,
        };
    });
}

interface CanonicalBipedPipPlacement {
    readonly x: number;
    readonly y: number;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly radiusScale: number;
}

// Canon data is normalized per location.  These transforms place that data in
// the classic MegaMekLab biped drawing while leaving the silhouette asset and
// its interaction polygons independent from the pip geometry.
const BIPED_CANON_ARMOR_PIP_PLACEMENTS: Readonly<Record<string, CanonicalBipedPipPlacement>> = Object.freeze({
    HD: Object.freeze({ x: 88.180915, y: 55.269784, scaleX: 18.067359, scaleY: 18.019118, radiusScale: 1.01045 }),
    CT: Object.freeze({ x: 83.394165, y: 84.458806, scaleX: 83.615432, scaleY: 83.595253, radiusScale: 1.011392 }),
    RT: Object.freeze({ x: 114.404288, y: 68.396258, scaleX: 80.94084, scaleY: 80.902082, radiusScale: 1.00761 }),
    LT: Object.freeze({ x: 50.652055, y: 68.396365, scaleX: 80.995667, scaleY: 80.90129, radiusScale: 1.007276 }),
    RA: Object.freeze({ x: 145.481976, y: 61.20449, scaleX: 89.811656, scaleY: 89.732955, radiusScale: 0.958066 }),
    LA: Object.freeze({ x: 18.410256, y: 61.20449, scaleX: 89.681315, scaleY: 89.732955, radiusScale: 0.958763 }),
    RL: Object.freeze({ x: 113.956952, y: 159.495109, scaleX: 114.548812, scaleY: 114.538225, radiusScale: 0.906701 }),
    LL: Object.freeze({ x: 38.00339, y: 159.495109, scaleX: 114.503351, scaleY: 114.538225, radiusScale: 0.906885 }),
    CT_R: Object.freeze({ x: 85.632712, y: 272.857929, scaleX: 62.813954, scaleY: 62.634925, radiusScale: 0.98687 }),
    RT_R: Object.freeze({ x: 117.685628, y: 292.088476, scaleX: 24.19548, scaleY: 24.209937, radiusScale: 1.003624 }),
    LT_R: Object.freeze({ x: 54.685624, y: 292.088476, scaleX: 24.195553, scaleY: 24.209937, radiusScale: 1.003612 }),
});

const BIPED_CANON_STRUCTURE_PIP_PLACEMENTS: Readonly<Record<string, CanonicalBipedPipPlacement>> = Object.freeze({
    HD: Object.freeze({ x: 79.252421, y: 392.999878, scaleX: 11.571335, scaleY: 11.592865, radiusScale: 1.150995 }),
    CT: Object.freeze({ x: 77.783636, y: 412.837486, scaleX: 56.905862, scaleY: 56.804438, radiusScale: 1.142637 }),
    RT: Object.freeze({ x: 96.472978, y: 404.829187, scaleX: 54.986021, scaleY: 54.900922, radiusScale: 1.145443 }),
    LT: Object.freeze({ x: 55.679217, y: 404.816455, scaleX: 54.990826, scaleY: 54.98456, radiusScale: 1.144509 }),
    RA: Object.freeze({ x: 125.496637, y: 403.238208, scaleX: 70.020204, scaleY: 69.94912, radiusScale: 1.106789 }),
    LA: Object.freeze({ x: 32.045121, y: 403.23449, scaleX: 69.837709, scaleY: 69.965596, radiusScale: 1.108096 }),
    RL: Object.freeze({ x: 99.567068, y: 463.570193, scaleX: 84.397965, scaleY: 84.379242, radiusScale: 1.037103 }),
    LL: Object.freeze({ x: 46.431812, y: 463.570193, scaleX: 84.465538, scaleY: 84.379242, radiusScale: 1.036684 }),
});

function relocateCanonicalBipedPips(
    layer: SVGGElement,
    destination: SVGGElement,
    placements: Readonly<Record<string, CanonicalBipedPipPlacement>>,
    box: Box,
): void {
    const sx = box.width / 173;
    const sy = box.height / 543;
    Array.from(layer.querySelectorAll<SVGGElement>('[data-pip-layout="canon"]')).forEach(pips => {
        const location = pips.dataset['pipLocation'] ?? '';
        const placement = placements[location];
        if (!placement) return;
        pips.querySelectorAll<SVGCircleElement>('circle').forEach(pip => {
            const radius = Number(pip.getAttribute('r'));
            if (Number.isFinite(radius)) {
                pip.setAttribute('r', formatGeometryNumber(radius * placement.radiusScale));
            }
        });
        pips.setAttribute(
            'transform',
            `translate(${formatGeometryNumber(placement.x * sx)} ${formatGeometryNumber(placement.y * sy)}) `
            + `scale(${formatGeometryNumber(placement.scaleX * sx)} ${formatGeometryNumber(placement.scaleY * sy)})`,
        );
        pips.classList.add('canonical-biped-pips');
        destination.appendChild(pips);
    });
}

const BIPED_ARMOR_VALUE_LABELS: Readonly<Record<string, readonly [number, number]>> = {
    HD: [103.641, 33.943], CT: [96.262, 199.066], CT_R: [96.262, 255.918],
    RT: [129.423, 47.029], RT_R: [163.697, 338.426],
    LT: [62.367, 47.029], LT_R: [28.712, 338.426],
    RA: [167.601, 197.146], LA: [26.156, 197.146],
    RL: [173.581, 247.954], LL: [18.454, 247.954],
};

const BIPED_STRUCTURE_VALUE_LABELS: Readonly<Record<string, readonly [number, number]>> = {
    CT: [85.34, 502.594], RT: [151.054, 397.11], LT: [51.28, 397.11],
    RA: [152.88, 473.393], LA: [15.72, 473.393],
    RL: [142.308, 531.189], LL: [28.186, 531.189],
};

function drawBipedDiagramValues(group: SVGGElement, entity: MekEntity, box: Box): void {
    const sx = box.width / 173;
    const sy = box.height / 543;
    const fontScale = Math.min(sx, sy);
    const locations = new Map(entity.damageLocations().map(location => [location.code, location] as const));
    const addValue = (
        id: string,
        value: number,
        position: readonly [number, number],
        horizontalScale: number,
        xCorrection: number,
    ): void => {
        const anchorX = (position[0] - xCorrection) * sx;
        const label = addText(group, `( ${Math.max(0, value)} )`, anchorX, (position[1] - 0.85) * sy, {
            size: 5.7955 * fontScale,
            weight: 700,
            anchor: 'middle',
            class: 'diagram-value',
        });
        label.setAttribute(
            'transform',
            `translate(${formatNumber(anchorX)} 0) scale(${formatNumber(horizontalScale)} 1) translate(${formatNumber(-anchorX)} 0)`,
        );
        label.id = id;
        label.style.pointerEvents = 'none';
    };

    Object.entries(BIPED_ARMOR_VALUE_LABELS).forEach(([code, position]) => {
        const rear = code.endsWith('_R');
        const location = locations.get(rear ? code.slice(0, -2) : code);
        if (!location) return;
        addValue(
            `textArmor_${rear ? `${location.code}R` : location.code}`,
            rear ? location.armor.rear : location.armor.front,
            position,
            0.971555,
            0.1034,
        );
    });
    Object.entries(BIPED_STRUCTURE_VALUE_LABELS).forEach(([code, position]) => {
        const location = locations.get(code);
        if (location) addValue(`textIS_${code}`, location.internalPoints, position, 0.99483, 0.0877);
    });
}

interface MekSchematicRegion {
    readonly code: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

interface NonBipedPaperdollAssets {
    readonly armor: string;
    readonly structure: string;
}

interface ProfiledMekDiagramHeading {
    readonly titleWidth: number;
    readonly titleX: number;
    readonly titleY: number;
    readonly titleTextLength: number;
    readonly ribbonX: number;
    readonly ribbonY: number;
    readonly ribbonWidth: number;
    readonly ribbonCut: number;
    readonly subtitleX: number;
    readonly subtitleY: number;
}

interface ProfiledMekArtPlacement {
    /** Position of the original MML diagram group inside the 173 x 543 page area. */
    readonly x: number;
    readonly y: number;
    /** The lightweight asset's authored viewBox origin, cancelled at composition time. */
    readonly viewBoxMinX: number;
    readonly viewBoxMinY: number;
}

interface ProfiledMekPaperdollProfile {
    readonly armor: ProfiledMekArtPlacement;
    readonly structure: ProfiledMekArtPlacement;
    readonly armorHeading: ProfiledMekDiagramHeading;
    readonly structureHeading: ProfiledMekDiagramHeading;
}

const NON_BIPED_PAPERDOLL_ASSETS: Readonly<Record<'Quad' | 'Tripod' | 'QuadVee' | 'LAM', NonBipedPaperdollAssets>> = {
    Quad: {
        armor: '/images/paperdolls/quad-armor.svg',
        structure: '/images/paperdolls/quad-structure.svg',
    },
    Tripod: {
        armor: '/images/paperdolls/tripod-armor.svg',
        structure: '/images/paperdolls/tripod-structure.svg',
    },
    QuadVee: {
        armor: '/images/paperdolls/quadvee-armor.svg',
        structure: '/images/paperdolls/quadvee-structure.svg',
    },
    LAM: {
        armor: '/images/paperdolls/lam-armor.svg',
        structure: '/images/paperdolls/lam-structure.svg',
    },
};

const STANDARD_PROFILED_ARMOR_HEADING: ProfiledMekDiagramHeading = Object.freeze({
    titleWidth: 83.991,
    titleX: 54.004,
    titleY: 0,
    titleTextLength: 69.539,
    ribbonX: 36.004,
    ribbonY: 0,
    ribbonWidth: 123.749,
    ribbonCut: 3.749,
    subtitleX: 96,
    subtitleY: 21.5,
});

const STANDARD_PROFILED_STRUCTURE_HEADING: ProfiledMekDiagramHeading = Object.freeze({
    titleWidth: 148.233,
    titleX: 11.883062,
    titleY: 353,
    titleTextLength: 127.941,
    ribbonX: 25.983062,
    ribbonY: 354,
    ribbonWidth: 123.749,
    ribbonCut: 3.749,
    subtitleX: 86.879062,
    subtitleY: 375.5,
});

const PROFILED_MEK_PAPERDOLLS: Readonly<Record<'Quad' | 'Tripod' | 'QuadVee' | 'LAM', ProfiledMekPaperdollProfile>> = Object.freeze({
    Quad: Object.freeze({
        armor: Object.freeze({ x: 0, y: 0, viewBoxMinX: 5, viewBoxMinY: 20 }),
        structure: Object.freeze({ x: 0, y: 368, viewBoxMinX: -2, viewBoxMinY: 8 }),
        armorHeading: STANDARD_PROFILED_ARMOR_HEADING,
        structureHeading: STANDARD_PROFILED_STRUCTURE_HEADING,
    }),
    QuadVee: Object.freeze({
        armor: Object.freeze({ x: 0, y: 0, viewBoxMinX: 5, viewBoxMinY: 20 }),
        structure: Object.freeze({ x: 0, y: 368, viewBoxMinX: -2, viewBoxMinY: 8 }),
        armorHeading: STANDARD_PROFILED_ARMOR_HEADING,
        structureHeading: STANDARD_PROFILED_STRUCTURE_HEADING,
    }),
    LAM: Object.freeze({
        armor: Object.freeze({ x: 0, y: 0, viewBoxMinX: 5, viewBoxMinY: 30 }),
        structure: Object.freeze({ x: 0, y: 368, viewBoxMinX: 25, viewBoxMinY: 8 }),
        armorHeading: STANDARD_PROFILED_ARMOR_HEADING,
        structureHeading: STANDARD_PROFILED_STRUCTURE_HEADING,
    }),
    Tripod: Object.freeze({
        armor: Object.freeze({ x: -0.88073, y: 2.473206, viewBoxMinX: 5, viewBoxMinY: 25 }),
        structure: Object.freeze({ x: 0, y: 372, viewBoxMinX: 5, viewBoxMinY: 5 }),
        armorHeading: Object.freeze({
            titleWidth: 83.991,
            titleX: 53.123571,
            titleY: 2.473206,
            titleTextLength: 69.539,
            ribbonX: 35.123571,
            ribbonY: 2.473206,
            ribbonWidth: 123.749,
            ribbonCut: 3.749,
            subtitleX: 95.11927,
            subtitleY: 23.973206,
        }),
        structureHeading: Object.freeze({
            titleWidth: 148.233,
            titleX: 11.883062,
            titleY: 355,
            titleTextLength: 127.941,
            ribbonX: 25.983062,
            ribbonY: 356,
            ribbonWidth: 123.749,
            ribbonCut: 3.749,
            subtitleX: 86.879062,
            subtitleY: 377.5,
        }),
    }),
});

async function drawProfiledMekPaperdolls(svg: SVGSVGElement, entity: MekEntity, box: Box): Promise<void> {
    const group = svgElement('g');
    group.setAttribute('class', 'mek-paperdolls mek-paperdolls-schematic');
    group.setAttribute('transform', `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`);
    group.setAttribute('data-mekbay-pip-layout', mekPaperdollPipLayout(entity));
    const chassis = entity.chassisConfig as keyof typeof NON_BIPED_PAPERDOLL_ASSETS;
    const assets = NON_BIPED_PAPERDOLL_ASSETS[chassis];
    const profile = PROFILED_MEK_PAPERDOLLS[chassis];
    const content = svgElement('g');
    content.setAttribute(
        'transform',
        `scale(${formatGeometryNumber(box.width / 173)} ${formatGeometryNumber(box.height / 543)})`,
    );
    group.appendChild(content);

    addDiagramHeading(
        content,
        'ARMOR DIAGRAM',
        constructionMaterialSubtitle(entity.uniformArmor()?.armor.name, 'Armor', 'Patchwork Armor'),
        173,
        0,
        profile.armorHeading,
    );
    const armorArea = {
        x: 0,
        y: 29,
        width: 173,
        height: 337,
    };

    addDiagramHeading(
        content,
        'INTERNAL STRUCTURE DIAGRAM',
        constructionMaterialSubtitle(entity.uniformStructureMaterial()?.structure.name, 'Structure', 'Hybrid Structure'),
        173,
        profile.structureHeading.titleY,
        profile.structureHeading,
    );
    const structureArea = {
        x: 0,
        y: 382,
        width: 173,
        height: 161,
    };
    const armorValues: Record<string, number> = {};
    const structurePipCounts: Record<string, number> = {};
    for (const location of entity.damageLocations()) {
        armorValues[location.code] = location.armor.front;
        structurePipCounts[location.code] = location.internalPoints;
        if (location.armor.rear > 0) armorValues[`${location.code}_R`] = location.armor.rear;
    }
    let exactArtRendered = false;
    try {
        const exactLayers = svgElement('g');
        exactLayers.setAttribute('class', 'mek-paperdoll-exact-layers');
        const armorArt = await BipedPaperdollUtil.createArmorPaperdoll(
            armorArea.width,
            armorArea.height,
            armorValues as BipedArmorValues,
            {
                assetUrl: assets.armor,
                className: 'mek-paperdoll-art mek-paperdoll-art-armor',
                centeredHorizontally: false,
                centeredVertically: false,
                scale: false,
                pipLayout: 'distributed',
                pipOptions: paperdollPipOptions('distributed', 2.45, 0.72),
            },
        );
        armorArt.setAttribute(
            'transform',
            `translate(${formatGeometryNumber(profile.armor.x + profile.armor.viewBoxMinX)} `
            + `${formatGeometryNumber(profile.armor.y + profile.armor.viewBoxMinY)})`,
        );
        decoratePaperdollPips(armorArt);
        exactLayers.appendChild(armorArt);
        const structureArt = await BipedPaperdollUtil.createStructurePaperdoll(
            structureArea.width,
            structureArea.height,
            0,
            {
                assetUrl: assets.structure,
                className: 'mek-paperdoll-art mek-paperdoll-art-structure',
                centeredHorizontally: false,
                centeredVertically: false,
                scale: false,
                pipLayout: 'distributed',
                pipOptions: paperdollPipOptions('distributed', 2.45, 0.72),
                structurePipCounts,
            },
        );
        structureArt.setAttribute(
            'transform',
            `translate(${formatGeometryNumber(profile.structure.x + profile.structure.viewBoxMinX)} `
            + `${formatGeometryNumber(profile.structure.y + profile.structure.viewBoxMinY)})`,
        );
        decoratePaperdollPips(structureArt);
        exactLayers.appendChild(structureArt);
        content.appendChild(exactLayers);
        exactArtRendered = true;
    } catch {
        // Keep the sheet usable if a packaged silhouette fails to load.
    }
    if (!exactArtRendered) {
        const front = { x: 0, y: 29, width: 173, height: 261 };
        drawMekSchematic(content, entity, front, 'armor', nonBipedFrontRegions(entity.chassisConfig));
        const rear = {
            x: 31,
            y: 280,
            width: 111,
            height: 76,
        };
        drawMekSchematic(content, entity, rear, 'rear', REAR_TORSO_REGIONS);
        drawMekSchematic(content, entity, structureArea, 'structure', nonBipedFrontRegions(entity.chassisConfig));
    }
    if (content.querySelector('[data-mekbay-paperdoll-overlay]')) {
        initializeMekDiagramCounters(content, entity);
    }
    svg.appendChild(group);
}

function initializeMekDiagramCounters(group: SVGGElement, entity: MekEntity): void {
    const writeCounter = (id: string, value: number): void => {
        const counter = group.querySelector<SVGElement>(`#${id}`);
        if (counter) counter.textContent = `(${Math.max(0, value)})`;
    };
    for (const location of entity.damageLocations()) {
        writeCounter(`textArmor_${location.code}`, location.armor.front);
        if (location.armor.rear > 0) writeCounter(`textArmor_${location.code}R`, location.armor.rear);
        writeCounter(`textIS_${location.code}`, location.internalPoints);
    }
}

const TRIPOD_SCHEMATIC_REGIONS: readonly MekSchematicRegion[] = Object.freeze([
    { code: 'HD', x: 0.43, y: 0, width: 0.14, height: 0.14 },
    { code: 'LA', x: 0.02, y: 0.12, width: 0.20, height: 0.44 },
    { code: 'LT', x: 0.22, y: 0.13, width: 0.21, height: 0.36 },
    { code: 'CT', x: 0.43, y: 0.10, width: 0.14, height: 0.43 },
    { code: 'RT', x: 0.57, y: 0.13, width: 0.21, height: 0.36 },
    { code: 'RA', x: 0.78, y: 0.12, width: 0.20, height: 0.44 },
    { code: 'LL', x: 0.22, y: 0.48, width: 0.22, height: 0.50 },
    { code: 'CL', x: 0.42, y: 0.48, width: 0.16, height: 0.51 },
    { code: 'RL', x: 0.56, y: 0.48, width: 0.22, height: 0.50 },
]);

const QUAD_SCHEMATIC_REGIONS: readonly MekSchematicRegion[] = Object.freeze([
    { code: 'HD', x: 0.43, y: 0, width: 0.14, height: 0.14 },
    { code: 'LT', x: 0.08, y: 0.12, width: 0.30, height: 0.34 },
    { code: 'CT', x: 0.38, y: 0.10, width: 0.24, height: 0.42 },
    { code: 'RT', x: 0.62, y: 0.12, width: 0.30, height: 0.34 },
    { code: 'FLL', x: 0.07, y: 0.44, width: 0.21, height: 0.54 },
    { code: 'RLL', x: 0.28, y: 0.47, width: 0.20, height: 0.50 },
    { code: 'RRL', x: 0.52, y: 0.47, width: 0.20, height: 0.50 },
    { code: 'FRL', x: 0.72, y: 0.44, width: 0.21, height: 0.54 },
]);

const BIPED_SCHEMATIC_REGIONS: readonly MekSchematicRegion[] = Object.freeze([
    { code: 'HD', x: 0.43, y: 0, width: 0.14, height: 0.14 },
    { code: 'LA', x: 0.02, y: 0.12, width: 0.20, height: 0.44 },
    { code: 'LT', x: 0.22, y: 0.13, width: 0.21, height: 0.36 },
    { code: 'CT', x: 0.43, y: 0.10, width: 0.14, height: 0.43 },
    { code: 'RT', x: 0.57, y: 0.13, width: 0.21, height: 0.36 },
    { code: 'RA', x: 0.78, y: 0.12, width: 0.20, height: 0.44 },
    { code: 'LL', x: 0.24, y: 0.48, width: 0.23, height: 0.50 },
    { code: 'RL', x: 0.53, y: 0.48, width: 0.23, height: 0.50 },
]);

const REAR_TORSO_REGIONS: readonly MekSchematicRegion[] = Object.freeze([
    { code: 'LT', x: 0, y: 0.14, width: 0.34, height: 0.72 },
    { code: 'CT', x: 0.33, y: 0, width: 0.34, height: 1 },
    { code: 'RT', x: 0.66, y: 0.14, width: 0.34, height: 0.72 },
]);

function nonBipedFrontRegions(config: MekEntity['chassisConfig']): readonly MekSchematicRegion[] {
    if (config === 'Tripod') return TRIPOD_SCHEMATIC_REGIONS;
    if (config === 'LAM') return BIPED_SCHEMATIC_REGIONS;
    return QUAD_SCHEMATIC_REGIONS;
}

function drawMekSchematic(
    group: SVGGElement,
    entity: MekEntity,
    box: Box,
    kind: 'armor' | 'rear' | 'structure',
    regions: readonly MekSchematicRegion[],
    outline = true,
): void {
    const locations = new Map(entity.damageLocations().map(location => [location.code, location] as const));
    regions.forEach(region => {
        const location = locations.get(region.code);
        if (!location) return;
        const value = kind === 'structure'
            ? location.internalPoints
            : kind === 'rear'
                ? location.armor.rear
                : location.armor.front;
        if (kind === 'rear' && value <= 0) return;
        const regionBox = {
            x: box.x + region.x * box.width,
            y: box.y + region.y * box.height,
            width: region.width * box.width,
            height: region.height * box.height,
        };
        drawMekSchematicRegion(group, regionBox, region.code, value, kind, outline);
    });
}

function drawMekSchematicRegion(
    group: SVGGElement,
    box: Box,
    location: string,
    value: number,
    kind: 'armor' | 'rear' | 'structure',
    showOutline: boolean,
): void {
    if (showOutline) {
        const cut = Math.min(5, box.width * 0.16, box.height * 0.12);
        const outline = svgElement('polygon');
        outline.setAttribute('points', [
            `${formatNumber(box.x + cut)},${formatNumber(box.y)}`,
            `${formatNumber(box.x + box.width - cut)},${formatNumber(box.y)}`,
            `${formatNumber(box.x + box.width)},${formatNumber(box.y + cut)}`,
            `${formatNumber(box.x + box.width)},${formatNumber(box.y + box.height - cut)}`,
            `${formatNumber(box.x + box.width - cut)},${formatNumber(box.y + box.height)}`,
            `${formatNumber(box.x + cut)},${formatNumber(box.y + box.height)}`,
            `${formatNumber(box.x)},${formatNumber(box.y + box.height - cut)}`,
            `${formatNumber(box.x)},${formatNumber(box.y + cut)}`,
        ].join(' '));
        outline.setAttribute('fill', '#fff');
        outline.setAttribute('stroke', '#111');
        outline.setAttribute('stroke-width', '1.2');
        group.appendChild(outline);
    }

    const inset = Math.min(4, box.width * 0.12, box.height * 0.08);
    const pipWidth = Math.max(1, box.width - inset * 2);
    const pipHeight = Math.max(1, box.height - inset * 2);
    const pips = makeDistributedPips(
        value,
        pipWidth,
        pipHeight,
        kind === 'structure' ? 'structure' : 'armor',
        location,
        kind === 'rear',
    );
    if (pips) {
        pips.setAttribute('transform', `translate(${formatNumber(box.x + inset)} ${formatNumber(box.y + inset)})`);
        group.appendChild(pips);
    }
    const target = transparentRect(box.x, box.y, box.width, box.height, `unitLocation ${kind === 'structure' ? 'structure' : 'armor'}`);
    target.setAttribute('loc', location);
    if (kind === 'rear') target.setAttribute('rear', '');
    group.appendChild(target);
}

function mekPaperdollPipLayout(entity: MekEntity): BipedPaperdollPipLayout {
    return entity.chassisConfig === 'Biped' && !entity.isSuperHeavy()
        ? 'canon'
        : 'distributed';
}

export async function drawMekCriticalPanel(svg: SVGSVGElement, entity: MekEntity, box: Box): Promise<void> {
    const group = addFrame(svg, 'CRITICAL TABLE', box, {
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    await drawCanonicalMekCriticalContents(group, entity, box);
}

interface CanonicalCriticalLocationLayout {
    readonly headingX: number;
    readonly headingY: number;
    readonly numberX: number;
    readonly textX: number;
    readonly firstBaseline: number;
    readonly step: number;
    readonly rightEdge: number;
}

const CANONICAL_BIPED_CRITICAL_LAYOUT: Readonly<Record<string, CanonicalCriticalLocationLayout>> = {
    LA: { headingX: 31.05, headingY: 34, numberX: 24, textX: 34.34, firstBaseline: 43.154, step: 8.154, rightEdge: 121.397 },
    HD: { headingX: 146.05, headingY: 23, numberX: 139, textX: 149.34, firstBaseline: 32.333, step: 8.333, rightEdge: 236.795 },
    RA: { headingX: 261.05, headingY: 34, numberX: 254, textX: 264.34, firstBaseline: 43.154, step: 8.154, rightEdge: 371.7 },
    LT: { headingX: 31.05, headingY: 167, numberX: 24, textX: 34.34, firstBaseline: 176.154, step: 8.154, rightEdge: 121.397 },
    CT: { headingX: 146.05, headingY: 98, numberX: 139, textX: 149.34, firstBaseline: 107.154, step: 8.154, rightEdge: 236.795 },
    RT: { headingX: 261.05, headingY: 167, numberX: 254, textX: 264.34, firstBaseline: 176.154, step: 8.154, rightEdge: 371.7 },
    LL: { headingX: 31.05, headingY: 301, numberX: 24, textX: 34.34, firstBaseline: 310.333, step: 8.334, rightEdge: 121.397 },
    RL: { headingX: 261.05, headingY: 301, numberX: 254, textX: 264.34, firstBaseline: 310.333, step: 8.334, rightEdge: 371.7 },
};

const CANONICAL_QUAD_CRITICAL_LAYOUT: Readonly<Record<string, CanonicalCriticalLocationLayout>> = {
    FLL: { headingX: 31.05, headingY: 64, numberX: 24, textX: 34.34, firstBaseline: 73.333, step: 8.333, rightEdge: 121.397 },
    HD: CANONICAL_BIPED_CRITICAL_LAYOUT['HD'],
    FRL: { headingX: 261.05, headingY: 64, numberX: 254, textX: 264.34, firstBaseline: 73.333, step: 8.333, rightEdge: 371.7 },
    LT: CANONICAL_BIPED_CRITICAL_LAYOUT['LT'],
    CT: CANONICAL_BIPED_CRITICAL_LAYOUT['CT'],
    RT: CANONICAL_BIPED_CRITICAL_LAYOUT['RT'],
    RLL: { headingX: 31.05, headingY: 301, numberX: 24, textX: 34.34, firstBaseline: 310.333, step: 8.334, rightEdge: 121.397 },
    RRL: { headingX: 261.05, headingY: 301, numberX: 254, textX: 264.34, firstBaseline: 310.333, step: 8.334, rightEdge: 371.7 },
};

const CANONICAL_TRIPOD_CRITICAL_LAYOUT: Readonly<Record<string, CanonicalCriticalLocationLayout>> = {
    ...CANONICAL_BIPED_CRITICAL_LAYOUT,
    CL: { headingX: 146.05, headingY: 301, numberX: 139, textX: 149.34, firstBaseline: 310.333, step: 8.334, rightEdge: 236.795 },
};

const CANONICAL_BIPED_ROLL_LABELS: readonly {
    readonly value: '1-3' | '4-6';
    readonly x: number;
    readonly y: number;
}[] = [
    { value: '1-3', x: 6, y: 64.875 }, { value: '4-6', x: 6, y: 119.125 },
    { value: '1-3', x: 236.795, y: 64.875 }, { value: '4-6', x: 236.795, y: 119.125 },
    { value: '1-3', x: 6, y: 198.39 }, { value: '4-6', x: 6, y: 252.64 },
    { value: '1-3', x: 236.795, y: 198.39 }, { value: '4-6', x: 236.795, y: 252.64 },
    { value: '1-3', x: 121.397, y: 128.7 }, { value: '4-6', x: 121.397, y: 182.95 },
];

const CANONICAL_QUAD_ROLL_LABELS = CANONICAL_BIPED_ROLL_LABELS.slice(4);

const MEK_CRITICAL_CASE_HEADING_OFFSETS: Readonly<Record<string, number>> = Object.freeze({
    HD: 23.639,
    LA: 37.633,
    RA: 42.757,
    LT: 44.5,
    CT: 55.41,
    RT: 49.624,
    LL: 35.552,
    RL: 40.676,
    FLL: 59.537,
    FRL: 64.661,
});

async function drawCanonicalMekCriticalContents(
    group: SVGGElement,
    entity: MekEntity,
    box: Box,
): Promise<void> {
    const sx = box.width / 377.7;
    const sy = box.height / 363;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const grid = entity.criticalSlotGrid();
    const layout = entity.chassisConfig === 'Quad' || entity.chassisConfig === 'QuadVee'
        ? CANONICAL_QUAD_CRITICAL_LAYOUT
        : entity.chassisConfig === 'Tripod'
            ? CANONICAL_TRIPOD_CRITICAL_LAYOUT
            : CANONICAL_BIPED_CRITICAL_LAYOUT;
    const rollLabels = entity.chassisConfig === 'Quad' || entity.chassisConfig === 'QuadVee'
        ? CANONICAL_QUAD_ROLL_LABELS
        : CANONICAL_BIPED_ROLL_LABELS;

    rollLabels.forEach(label => addText(group, label.value, x(label.x), y(label.y), {
        size: font(9.65),
        weight: 700,
        class: 'critical-roll-range',
    }));

    mekCriticalLocationCells(entity.chassisConfig).forEach(location => {
        if (location === null) return;
        const locationLayout = layout[location];
        if (!locationLayout) return;
        const criticalGroup = svgElement('g');
        criticalGroup.setAttribute('class', 'critGroup');
        criticalGroup.setAttribute('loc', location);
        const heading = addText(
            criticalGroup,
            getMekLocationLabel(location) ?? entity.componentLocationLabel(location),
            x(locationLayout.headingX),
            y(locationLayout.headingY),
            {
                size: font(8.75),
                weight: 700,
                class: 'critical-location-heading',
                maxWidth: x(locationLayout.rightEdge - locationLayout.headingX - 4),
            },
        );
        const headingControl = appendGeneratedMekCriticalHeadingControls(
            criticalGroup,
            heading,
            location,
            {
                x: x(locationLayout.headingX - 2),
                y: y(locationLayout.headingY - 11),
                width: x(Math.max(30, locationLayout.rightEdge - locationLayout.headingX - 2)),
                height: y(14),
            },
        );
        const caseLabel = mekCriticalCaseLabel(entity, location);
        if (caseLabel) {
            const caseX = locationLayout.headingX
                + (MEK_CRITICAL_CASE_HEADING_OFFSETS[location] ?? 2);
            addText(
                headingControl,
                `(${caseLabel})`,
                x(caseX),
                y(locationLayout.headingY - 0.875),
                {
                    size: font(7),
                    class: 'critical-case-label',
                    maxWidth: x(locationLayout.rightEdge - caseX - 2),
                },
            );
        }
        const slots = grid.get(location) ?? [];
        const slotCount = mekCriticalTableRowCount(location);
        for (let slotIndex = 0; slotIndex < slotCount; slotIndex++) {
            const slot = slots[slotIndex];
            const secondBlockOffset = slotCount === 12 && slotIndex >= 6 ? 5.15 : 0;
            const baseline = locationLayout.firstBaseline + slotIndex * locationLayout.step + secondBlockOffset;
            const number = slotCount === 12 ? slotIndex % 6 + 1 : slotIndex + 1;
            addText(criticalGroup, `${number}.`, x(locationLayout.numberX), y(baseline), {
                size: font(7),
                weight: 700,
                maxWidth: x(10),
            });

            const slotTop = baseline - locationLayout.step;
            const slotGroup = svgElement('g');
            slotGroup.setAttribute('class', 'critSlot');
            slotGroup.setAttribute('loc', location);
            slotGroup.setAttribute('slot', String(slotIndex));
            if (!slot || slot.type === 'empty') slotGroup.setAttribute('data-mekbay-empty-slot', '1');
            setInventoryComponentIds(
                slotGroup,
                slot?.type === 'equipment' ? slot.mounts.map(mount => String(mount.mountId)) : [],
            );
            slotGroup.setAttribute(
                'transform',
                `translate(${formatNumber(x(locationLayout.textX))} ${formatNumber(y(slotTop))})`,
            );
            const hittable = slot?.type === 'system'
                || slot?.type === 'equipment' && slot.mounts.some(mount => mount.equipment?.hittable === true);
            if (hittable) {
                slotGroup.setAttribute('hittable', '1');
                slotGroup.appendChild(transparentRect(
                    x(locationLayout.numberX - locationLayout.textX - 2),
                    1,
                    x(locationLayout.rightEdge - locationLayout.numberX - 4),
                    y(locationLayout.step),
                    'critSlot-bg-rect',
                ));
            }
            addText(slotGroup, mekCriticalSlotLabel(slot, entity), 0, y(locationLayout.step), {
                size: font(7),
                weight: hittable ? 700 : undefined,
                fill: hittable ? undefined : '#3f3f3f',
                maxWidth: x(locationLayout.rightEdge - locationLayout.textX - 5),
            });
            if (slot?.armored) {
                slotGroup.appendChild(circle(
                    x(locationLayout.rightEdge - locationLayout.textX - 8),
                    y(locationLayout.step / 2),
                    font(1.7),
                    'armoredLocPip pip',
                ));
            }
            const extraHitPip = circle(
                x(locationLayout.rightEdge - locationLayout.textX - 3.5),
                y(locationLayout.step / 2),
                font(1.7),
                'extraHitPip pip',
            );
            extraHitPip.setAttribute('display', 'none');
            slotGroup.appendChild(extraHitPip);
            criticalGroup.appendChild(slotGroup);
        }
        group.appendChild(criticalGroup);
    });

    drawCanonicalMekSystemDamage(group, entity, { sx, sy, fontScale });
    if (entity.chassisConfig === 'Biped' || entity.chassisConfig === 'LAM') {
        await drawCanonicalDamageTransferDiagram(group, entity, { sx, sy, fontScale });
    } else {
        await drawVariantDamageTransferDiagram(group, entity, { sx, sy, fontScale });
    }
}

function drawCanonicalMekSystemDamage(
    group: SVGGElement,
    entity: MekEntity,
    scale: { readonly sx: number; readonly sy: number; readonly fontScale: number },
): void {
    if (entity.chassisConfig === 'LAM') {
        drawCanonicalLamSystemDamage(group, entity, scale);
        return;
    }
    const { sx, sy, fontScale } = scale;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const systemGroup = svgElement('g');
    systemGroup.setAttribute('class', 'mek-system-damage');
    systemGroup.setAttribute('transform', `translate(${formatNumber(x(134.631))} ${formatNumber(y(206.025))})`);
    const backing = svgElement('rect');
    setAttributes(backing, {
        x: x(6), y: y(3), width: x(85.93), height: y(42), rx: x(6.78),
        fill: '#fff', stroke: '#000', 'stroke-width': font(0.92),
    });
    systemGroup.appendChild(backing);
    const systems: readonly [string, string, number, number][] = [
        ['Engine Hits', 'engine_hit_', 3, 41.995],
        ['Gyro Hits', 'gyro_hit_', 2, 34.811],
        ['Sensor Hits', 'sensor_hit_', 2, 43.825],
        ['Life Support', 'life_support_hit_', 1, 45.633],
    ];
    systems.forEach(([label, prefix, count, textLength], rowIndex) => {
        const baseline = 12 + rowIndex * 9;
        const labelText = addText(systemGroup, label, x(55.93), y(baseline), {
            size: font(8.6),
            weight: 700,
            anchor: 'end',
        });
        labelText.setAttribute('textLength', formatNumber(x(textLength)));
        labelText.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        for (let index = 0; index < count; index++) {
            const pip = circle(
                x(61.53 + index * 9.2),
                y(9.2 + rowIndex * 9),
                font(2.8),
                'pip systemHitPip',
            );
            pip.id = `${prefix}${index + 1}`;
            systemGroup.appendChild(pip);
        }
    });
    group.appendChild(systemGroup);
}

function drawCanonicalLamSystemDamage(
    group: SVGGElement,
    entity: MekEntity,
    scale: { readonly sx: number; readonly sy: number; readonly fontScale: number },
): void {
    const { sx, sy, fontScale } = scale;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const systemGroup = svgElement('g');
    systemGroup.setAttribute('class', 'mek-system-damage lam-system-damage');
    systemGroup.setAttribute('transform', `translate(${formatNumber(x(132.929))} ${formatNumber(y(206.025))})`);
    const backing = svgElement('rect');
    setAttributes(backing, {
        x: x(6), y: y(3), width: x(89.333), height: y(90.4), rx: x(6.78),
        fill: '#fff', stroke: '#000', 'stroke-width': font(0.92),
    });
    systemGroup.appendChild(backing);
    const systems: readonly [string, string, number, number][] = [
        ['Avionics Hits', 'avionics_hit_', 3, 47.966],
        ['Engine Hits', 'engine_hit_', 3, 41.995],
        ['Gyro Hits', 'gyro_hit_', 2, 34.811],
        ['Sensor Hits', 'sensor_hit_', 2, 43.825],
        ['Landing Gear', 'landing_gear_hit_', 1, 49.036],
        ['Life Support', 'life_support_hit_', 1, 45.633],
    ];
    systems.forEach(([label, prefix, count, textLength], rowIndex) => {
        const baseline = 12 + rowIndex * 9;
        const labelText = addText(systemGroup, label, x(59.333), y(baseline), {
            size: font(8.6), weight: 700, anchor: 'end',
        });
        labelText.setAttribute('textLength', formatNumber(x(textLength)));
        labelText.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        for (let index = 0; index < count; index++) {
            const pip = circle(
                x(64.933 + index * 9.2),
                y(9.2 + rowIndex * 9),
                font(2.8),
                'pip systemHitPip',
            );
            setAttributes(pip, { fill: '#fff', stroke: '#000', 'stroke-width': font(1.72) });
            pip.id = `${prefix}${index + 1}`;
            systemGroup.appendChild(pip);
        }
    });

    addText(systemGroup, 'Structural Integrity', x(56.199), y(66), {
        size: font(8.6), weight: 700, anchor: 'middle',
    });
    const structuralIntegrity = Math.max(
        0,
        entity.damageLocations().find(location => location.code === 'CT')?.internalPoints ?? 0,
    );
    const firstRowCount = Math.min(9, structuralIntegrity);
    for (let index = 0; index < structuralIntegrity; index++) {
        const secondRowIndex = index - firstRowCount;
        const secondRowCount = structuralIntegrity - firstRowCount;
        const centerOffset = secondRowCount > 0 ? (secondRowCount - 1) * 4.6 : 0;
        const pip = circle(
            x(index < firstRowCount ? 19.2 + index * 9.2 : 56 - centerOffset + secondRowIndex * 9.2),
            y(index < firstRowCount ? 73.4 : 82.4),
            font(2.8),
            'pip structure structuralIntegrityPip',
        );
        setAttributes(pip, {
            fill: '#fff', stroke: '#000', 'stroke-width': font(1.72), loc: 'SI',
        });
        pip.id = `si_pip_${index + 1}`;
        systemGroup.appendChild(pip);
    }
    group.appendChild(systemGroup);
}

async function drawCanonicalDamageTransferDiagram(
    group: SVGGElement,
    entity: MekEntity,
    scale: { readonly sx: number; readonly sy: number; readonly fontScale: number },
): Promise<void> {
    const { sx, sy, fontScale } = scale;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const lamLayout = entity.chassisConfig === 'LAM';
    const artScale = lamLayout ? 0.569 : 0.933;
    const artX = lamLayout ? 188.552 : 177.596;
    const artY = lamLayout ? 305.425 : 258.024;
    const centerX = x(lamLayout ? 149.497 : 205.695);
    const diagram = await BipedPaperdollUtil.createArmorPaperdoll(
        x(60 * artScale),
        y(83 * artScale),
        {},
        {
            assetUrl: '/images/paperdolls/biped-damage-transfer.svg',
            className: 'damage-transfer-diagram',
        },
    );
    diagram.setAttribute(
        'transform',
        `translate(${formatNumber(x(artX))} ${formatNumber(y(artY))})`,
    );
    group.appendChild(diagram);
    addText(group, 'Damage Transfer', centerX, y(345), {
        size: 6.76 * fontScale,
        weight: 700,
        anchor: 'middle',
        maxWidth: x(70),
    });
    addText(group, 'Diagram', centerX, y(353), {
        size: 6.76 * fontScale,
        weight: 700,
        anchor: 'middle',
        maxWidth: x(70),
    });
}

async function drawVariantDamageTransferDiagram(
    group: SVGGElement,
    entity: MekEntity,
    scale: { readonly sx: number; readonly sy: number; readonly fontScale: number },
): Promise<void> {
    const { sx, sy, fontScale } = scale;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const profiles = {
        Tripod: {
            assetUrl: '/images/paperdolls/tripod-damage-transfer.svg',
            artScale: 0.673,
            x: 203.075,
            y: 257.025,
        },
        Quad: {
            assetUrl: '/images/paperdolls/quad-damage-transfer.svg',
            artScale: 0.975,
            x: 177.596,
            y: 259.046,
        },
        QuadVee: {
            assetUrl: '/images/paperdolls/quadvee-damage-transfer.svg',
            artScale: 1,
            x: 177.596,
            y: 257.175,
        },
    } as const;
    const profile = profiles[entity.chassisConfig === 'Tripod'
        ? 'Tripod'
        : entity.chassisConfig === 'QuadVee' ? 'QuadVee' : 'Quad'];
    const diagram = await BipedPaperdollUtil.createArmorPaperdoll(
        x(60 * profile.artScale),
        y(83 * profile.artScale),
        {},
        {
            assetUrl: profile.assetUrl,
            className: `damage-transfer-diagram damage-transfer-${entity.chassisConfig.toLowerCase()}`,
        },
    );
    diagram.setAttribute(
        'transform',
        `translate(${formatNumber(x(profile.x))} ${formatNumber(y(profile.y))})`,
    );
    group.appendChild(diagram);

    if (entity.chassisConfig === 'Tripod') {
        ['Damage', 'Transfer', 'Diagram'].forEach((label, index) => addText(
            group,
            label,
            x(186.216),
            y(267.05 + index * 8),
            { size: 6.76 * fontScale, weight: 700, anchor: 'middle', maxWidth: x(38) },
        ));
    } else {
        addText(group, 'Damage Transfer', x(205.695), y(345), {
            size: 6.76 * fontScale,
            weight: 700,
            anchor: 'middle',
            maxWidth: x(70),
        });
        addText(group, 'Diagram', x(205.695), y(353), {
            size: 6.76 * fontScale,
            weight: 700,
            anchor: 'middle',
            maxWidth: x(70),
        });
    }
}

function drawHeatPanel(svg: SVGSVGElement, entity: MekEntity, box: Box): void {
    const group = addFrame(svg, 'HEAT DATA', box, {
        id: 'heatDataPanel',
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    if (entity.chassisConfig === 'LAM') {
        drawLamHeatDataContents(group, entity, box);
    } else {
        drawMekHeatDataContents(group, entity, box);
    }
    appendMekHeatControls(group, box);
}

function appendMekHeatControls(group: SVGGElement, box: Box): void {
    const header = Array.from(group.children)
        .find((child): child is SVGGElement => child.tagName.toLowerCase() === 'g');
    if (header) {
        const apply = header.cloneNode(true) as SVGGElement;
        apply.id = 'applyHeatButton';
        apply.setAttribute('class', 'screen-only no-autocolor');
        const label = apply.querySelector('text');
        if (label) label.textContent = 'APPLY HEAT';
        group.appendChild(apply);
    }

    const framePaths = Array.from(group.children)
        .filter((child): child is SVGPathElement => child.tagName.toLowerCase() === 'path');
    const frame = framePaths[1];
    if (frame) frame.classList.add('applyHeatButtonFrame');
    const damagedEngineHeat = addText(group, '', box.width - 6, box.height - 4, {
        size: 8,
        weight: 700,
        fill: '#f00',
        anchor: 'end',
        class: 'damagedEngineHeatText',
    });
    damagedEngineHeat.id = 'damagedEngineHeatText';
    damagedEngineHeat.setAttribute('display', 'none');
    damagedEngineHeat.setAttribute('dominant-baseline', 'text-after-edge');

    const heatSinks = group.querySelector<SVGGElement>('g.hsPips');
    if (heatSinks) {
        heatSinks.insertBefore(
            transparentRect(
                Math.max(0, box.width - 42),
                35,
                38,
                Math.max(12, box.height - 72),
                'changeActiveHeatsinksCountButton screen-only',
            ),
            heatSinks.firstChild,
        );
    }
}

interface MekHeatEffectRow {
    readonly heat: number;
    readonly label: string;
    readonly baseline: number;
    readonly effectAttribute: 'h-shut' | 'h-ammo' | 'h-fire' | 'h-move';
    readonly effectValue: number;
    readonly secondaryLabel?: string;
    readonly secondaryBaseline?: number;
}

const STANDARD_MEK_HEAT_EFFECTS: readonly MekHeatEffectRow[] = [
    { heat: 30, label: 'Shutdown', baseline: 42.711, effectAttribute: 'h-shut', effectValue: 99 },
    { heat: 28, label: 'Ammo Exp, avoid on 8+', baseline: 50.947, effectAttribute: 'h-ammo', effectValue: 8 },
    { heat: 26, label: 'Shutdown, avoid on 10+', baseline: 59.184, effectAttribute: 'h-shut', effectValue: 10 },
    { heat: 25, label: '-5 Movement Points', baseline: 67.421, effectAttribute: 'h-move', effectValue: -5 },
    { heat: 24, label: '+4 Modifier to Fire', baseline: 75.658, effectAttribute: 'h-fire', effectValue: 4 },
    { heat: 23, label: 'Ammo Exp, avoid on 6+', baseline: 83.895, effectAttribute: 'h-ammo', effectValue: 6 },
    { heat: 22, label: 'Shutdown, avoid on 8+', baseline: 92.132, effectAttribute: 'h-shut', effectValue: 8 },
    { heat: 20, label: '-4 Movement Points', baseline: 100.368, effectAttribute: 'h-move', effectValue: -4 },
    { heat: 19, label: 'Ammo Exp, avoid on 4+', baseline: 108.605, effectAttribute: 'h-ammo', effectValue: 4 },
    { heat: 18, label: 'Shutdown, avoid on 6+', baseline: 116.842, effectAttribute: 'h-shut', effectValue: 6 },
    { heat: 17, label: '+3 Modifier to Fire', baseline: 125.079, effectAttribute: 'h-fire', effectValue: 3 },
    { heat: 15, label: '-3 Movement Points', baseline: 133.316, effectAttribute: 'h-move', effectValue: -3 },
    { heat: 14, label: 'Shutdown, avoid on 4+', baseline: 141.553, effectAttribute: 'h-shut', effectValue: 4 },
    { heat: 13, label: '+2 Modifier to Fire', baseline: 149.789, effectAttribute: 'h-fire', effectValue: 2 },
    { heat: 10, label: '-2 Movement Points', baseline: 158.026, effectAttribute: 'h-move', effectValue: -2 },
    { heat: 8, label: '+1 Modifier to Fire', baseline: 166.263, effectAttribute: 'h-fire', effectValue: 1 },
    { heat: 5, label: '-1 Movement Points', baseline: 174.5, effectAttribute: 'h-move', effectValue: -1 },
];

const LAM_HEAT_EFFECTS: readonly MekHeatEffectRow[] = [
    { heat: 30, label: 'Shutdown', baseline: 37.563, effectAttribute: 'h-shut', effectValue: 99 },
    { heat: 28, label: 'Ammo Exp, avoid on 8+', baseline: 44.083, effectAttribute: 'h-ammo', effectValue: 8 },
    { heat: 26, label: 'Shutdown, avoid on 10+', baseline: 50.604, effectAttribute: 'h-shut', effectValue: 10 },
    { heat: 25, label: '-5 Movement Points', baseline: 57.125, effectAttribute: 'h-move', effectValue: -5, secondaryLabel: '/Rand. Movement 10+', secondaryBaseline: 63.646 },
    { heat: 24, label: '+4 Modifier to Fire', baseline: 70.167, effectAttribute: 'h-fire', effectValue: 4 },
    { heat: 23, label: 'Ammo Exp, avoid on 6+', baseline: 76.688, effectAttribute: 'h-ammo', effectValue: 6 },
    { heat: 22, label: 'Shutdown, avoid on 8+', baseline: 83.208, effectAttribute: 'h-shut', effectValue: 8 },
    { heat: 20, label: '-4 Movement Points', baseline: 89.729, effectAttribute: 'h-move', effectValue: -4, secondaryLabel: '/Rand. Movement 8+', secondaryBaseline: 96.25 },
    { heat: 19, label: 'Ammo Exp, avoid on 4+', baseline: 102.771, effectAttribute: 'h-ammo', effectValue: 4 },
    { heat: 18, label: 'Shutdown, avoid on 6+', baseline: 109.292, effectAttribute: 'h-shut', effectValue: 6 },
    { heat: 17, label: '+3 Modifier to Fire', baseline: 115.812, effectAttribute: 'h-fire', effectValue: 3 },
    { heat: 15, label: '-3 Movement Points', baseline: 122.333, effectAttribute: 'h-move', effectValue: -3, secondaryLabel: '/Rand. Movement 7+', secondaryBaseline: 128.854 },
    { heat: 14, label: 'Shutdown, avoid on 4+', baseline: 135.375, effectAttribute: 'h-shut', effectValue: 4 },
    { heat: 13, label: '+2 Modifier to Fire', baseline: 141.896, effectAttribute: 'h-fire', effectValue: 2 },
    { heat: 10, label: '-2 Movement Points', baseline: 148.417, effectAttribute: 'h-move', effectValue: -2, secondaryLabel: '/Rand. Movement 6+', secondaryBaseline: 154.938 },
    { heat: 8, label: '+1 Modifier to Fire', baseline: 161.458, effectAttribute: 'h-fire', effectValue: 1 },
    { heat: 5, label: '-1 Movement Points', baseline: 167.979, effectAttribute: 'h-move', effectValue: -1, secondaryLabel: '/Rand. Movement 5+', secondaryBaseline: 174.5 },
];

function drawMekHeatDataContents(group: SVGGElement, entity: MekEntity, box: Box): void {
    const sx = box.width / 159.5;
    const sy = box.height / 180.5;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const heatHeading = addText(group, 'Heat', x(15), y(26.237), { size: font(6.76), anchor: 'middle' });
    heatHeading.setAttribute('textLength', formatNumber(x(13.53)));
    heatHeading.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    const levelHeading = addText(group, 'Level*', x(15), y(34.474), { size: font(6.76), anchor: 'middle' });
    levelHeading.setAttribute('textLength', formatNumber(x(18.187)));
    levelHeading.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    const effectsHeading = addText(group, 'Effects', x(56.4), y(34.474), { size: font(6.76), anchor: 'middle' });
    effectsHeading.setAttribute('textLength', formatNumber(x(19.001)));
    effectsHeading.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    appendMekHeatEffectRows(group, STANDARD_MEK_HEAT_EFFECTS, { x, y, font });
    appendMekHeatSinkData(group, entity, { x, y, font, fontScale });
}

function drawLamHeatDataContents(group: SVGGElement, entity: MekEntity, box: Box): void {
    const sx = box.width / 159.5;
    const sy = box.height / 180.5;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    const heatHeading = addText(group, 'Heat', x(15), y(24.521), { size: font(6.76), anchor: 'middle' });
    heatHeading.setAttribute('textLength', formatNumber(x(13.53)));
    heatHeading.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    const levelHeading = addText(group, 'Level*', x(15), y(31.042), { size: font(6.76), anchor: 'middle' });
    levelHeading.setAttribute('textLength', formatNumber(x(18.187)));
    levelHeading.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    const effectsHeading = addText(group, 'Effects', x(56.4), y(31.042), { size: font(6.76), anchor: 'middle' });
    effectsHeading.setAttribute('textLength', formatNumber(x(19.001)));
    effectsHeading.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    appendMekHeatEffectRows(group, LAM_HEAT_EFFECTS, { x, y, font });
    appendMekHeatSinkData(group, entity, { x, y, font, fontScale }, '(AirMech +3)');
}

function appendMekHeatEffectRows(
    group: SVGGElement,
    effects: readonly MekHeatEffectRow[],
    scale: {
        readonly x: (value: number) => number;
        readonly y: (value: number) => number;
        readonly font: (value: number) => number;
    },
): void {
    const { x, y, font } = scale;
    effects.forEach(effect => {
        const row = svgElement('g');
        setAttributes(row, {
            class: 'heatEffect',
            heat: effect.heat,
            [effect.effectAttribute]: effect.effectValue,
        });
        addText(row, String(effect.heat), x(15), y(effect.baseline), {
            size: font(6.76), anchor: 'middle',
        });
        const effectText = addText(row, effect.label, x(27), y(effect.baseline), {
            size: font(6.76), maxWidth: x(91),
        });
        if (effect.effectAttribute === 'h-move') effectText.id = `minus${Math.abs(effect.effectValue)}MP`;
        if (effect.secondaryLabel !== undefined && effect.secondaryBaseline !== undefined) {
            addText(row, effect.secondaryLabel, x(30), y(effect.secondaryBaseline), {
                size: font(6.76), maxWidth: x(88),
            });
        }
        group.appendChild(row);
    });
}

function appendMekHeatSinkData(
    group: SVGGElement,
    entity: MekEntity,
    scale: {
        readonly x: (value: number) => number;
        readonly y: (value: number) => number;
        readonly font: (value: number) => number;
        readonly fontScale: number;
    },
    secondaryLabel?: string,
): void {
    const { x, y, font, fontScale } = scale;
    const heatSinkCount = Math.max(0, entity.heatSinkCount());
    const heatSinkType = entity.heatSinkType();
    const heatSinkLabel = heatSinkType === 'Single' ? 'Heat Sinks:' : `${heatSinkType} Heat Sinks:`;
    const sinkType = addText(group, heatSinkLabel, x(152), y(22), {
        size: font(8.44), anchor: 'end',
    });
    sinkType.id = 'hsType';
    sinkType.setAttribute('data-mekbay-field', 'heat-sinks');
    const heatSinkDissipation = heatSinkType === 'Double' ? heatSinkCount * 2 : heatSinkCount;
    const heatSinkCountLabel = heatSinkDissipation === heatSinkCount
        ? String(heatSinkCount)
        : `${heatSinkCount} (${heatSinkDissipation})`;
    const count = addText(group, heatSinkCountLabel, x(152), y(31), {
        size: font(8.44), anchor: 'end',
    });
    count.id = 'hsCount';
    if (secondaryLabel !== undefined) {
        const secondary = addText(group, secondaryLabel, x(152), y(37), {
            size: font(5.8), anchor: 'end',
        });
        secondary.setAttribute('textLength', formatNumber(x(32.291)));
        secondary.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
    const pips = svgElement('g');
    pips.setAttribute('class', 'hsPips');
    for (let index = 0; index < Math.min(30, heatSinkCount); index++) {
        const column = Math.floor(index / 10);
        const row = index % 10;
        const pip = circle(x(131.478 + column * 9.66), y(45.478 + row * 9.66), 3.478 * fontScale, 'pip hsPip');
        pip.setAttribute('loc', 'hs');
        pips.appendChild(pip);
    }
    group.appendChild(pips);
}

const MML_REFERENCE_NOTE_TEXT: Readonly<Record<string, string>> = {
    artemisIV: 'Artemis IV FCS: +2',
    artemisV: 'Artemis V FCS: +3',
    artemisProto: 'Prototype Artemis FCS: +1',
    apollo: 'Apollo MRM FCS: -1',
    hag: 'HAG: short range +2, long range -2',
};

export function drawMekHitLocationAndClusterPanel(
    svg: SVGSVGElement,
    entity: MekEntity,
    box: Box,
    page: RecordSheetPageProfile,
): void {
    const data = clusterTableForMekEntity(entity);
    const table = data.hitLocationTable ?? 'biped';
    const clusterRows = clusterTableRows(data.clusterSizes);
    const rows = hitLocationRows(table).map((row, index) => [
        row.roll,
        row.leftSide,
        row.frontRear,
        row.rightSide,
        ...(clusterRows[index]?.slice(1) ?? []),
    ]);
    const spacing = 0.9 / (data.clusterSizes.length + 4);
    const columnOffsets = Array.from(
        { length: data.clusterSizes.length + 4 },
        (_, index) => 0.05 + spacing / 2 + index * spacing,
    );
    const group = addMekReferenceFrame(svg, 'HIT LOCATION AND CLUSTER TABLE', box, page);
    group.setAttribute('data-mekbay-reference', 'mek-hit-location-cluster');
    const body = createMekReferenceBody(group, page, 3, 22.5);
    const equipmentNotes = referenceTableNotes(undefined, data.equipment)
        .map(note => MML_REFERENCE_NOTE_TEXT[note.id] ?? note.text);
    const notes = [
        '*A result of 2 may inflict a critical hit.',
        ...(table === 'tripod'
            ? ['†Roll 1d6 and apply modifier: 0-2: RL, 3-4: CL, 5-7: LL']
            : []),
        ...equipmentNotes,
    ];
    drawMmlReferenceTableBody(body, {
        bodyWidth: box.width - 3 * page.horizontalScale,
        tableHeight: box.height - 10.545 * page.verticalScale,
        columnOffsets,
        columnKeys: ['roll', 'left-side', 'front-rear', 'right-side',
            ...data.clusterSizes.map(size => `cluster-${size}`)],
        headers: [
            ['Die Roll', '(2D6)'],
            ['LS'],
            ['F/R'],
            ['RS'],
            ...data.clusterSizes.map(size => [String(size)]),
        ],
        rows,
        notes,
        page,
    });
}

export function drawMekPunchKickPanel(
    svg: SVGSVGElement,
    entity: MekEntity,
    box: Box,
    page: RecordSheetPageProfile,
): void {
    const table = clusterTableForMekEntity(entity).hitLocationTable ?? 'biped';
    const rows = recordSheetPhysicalLocationRows(table).map(row => [
        String(row.roll),
        row.punchLeftSide,
        row.punchFrontRear,
        row.punchRightSide,
        row.kickLeftSide,
        row.kickFrontRear,
        row.kickRightSide,
    ]);
    const group = addMekReferenceFrame(svg, 'PUNCH/KICK LOCATION TABLE', box, page);
    group.setAttribute('data-mekbay-reference', 'mek-punch-kick');
    const body = createMekReferenceBody(group, page, 3, 22.5);
    drawMmlReferenceTableBody(body, {
        bodyWidth: box.width - 3 * page.horizontalScale,
        tableHeight: box.height - 9.31 * page.verticalScale,
        columnOffsets: [0.08, 0.18, 0.32, 0.47, 0.61, 0.76, 0.9],
        columnKeys: ['roll', 'punch-left-side', 'punch-front-rear', 'punch-right-side',
            'kick-left-side', 'kick-front-rear', 'kick-right-side'],
        headers: [
            ['Die Roll', '(1D6)'],
            ['LS'],
            ['Punch', 'F/R'],
            ['RS'],
            ['LS'],
            ['Kick', 'F/R'],
            ['RS'],
        ],
        rows,
        notes: [],
        page,
    });
}

function addMekReferenceFrame(
    svg: SVGSVGElement,
    title: string,
    box: Box,
    page: RecordSheetPageProfile,
): SVGGElement {
    const group = addFrame(svg, title, box, {
        fullWidthHeader: true,
        headerFontSize: 6.76 * page.horizontalScale,
        // SvgFrameUtil adds 2.5 points of padding above and below an explicit height.
        headerHeight: Math.max(0.1, 11.25 * page.verticalScale - 5),
        cornerAngleDegrees: 56.31,
    });
    group.setAttribute('class', 'referenceTable');
    group.setAttribute('data-mekbay-region', 'center-panel');
    Array.from(group.children)
        .filter((child): child is SVGPathElement => child.tagName.toLowerCase() === 'path')
        .slice(0, 2)
        .forEach(path => path.setAttribute('stroke-width', formatNumber(1.6 * page.horizontalScale)));
    const header = Array.from(group.children)
        .find((child): child is SVGGElement => child.tagName.toLowerCase() === 'g');
    const titleText = header?.querySelector<SVGTextElement>('.svg-frame-title');
    if (header) header.setAttribute('transform', 'translate(2.5 3)');
    if (titleText) {
        titleText.setAttribute('x', formatNumber(70.574 * page.horizontalScale));
        titleText.setAttribute('y', formatNumber(8.438 * page.verticalScale));
        titleText.setAttribute('letter-spacing', '0');
        titleText.removeAttribute('textLength');
        titleText.removeAttribute('lengthAdjust');
    }
    return group;
}

function createMekReferenceBody(
    group: SVGGElement,
    page: RecordSheetPageProfile,
    x: number,
    y: number,
): SVGGElement {
    const body = svgElement('g');
    body.setAttribute('class', 'reference-table-body');
    body.setAttribute(
        'transform',
        `translate(${formatNumber(x * page.horizontalScale)} ${formatNumber(y * page.verticalScale)})`,
    );
    group.appendChild(body);
    return body;
}

interface MmlReferenceTableOptions {
    readonly bodyWidth: number;
    readonly tableHeight: number;
    readonly columnOffsets: readonly number[];
    readonly columnKeys: readonly string[];
    readonly headers: readonly (readonly string[])[];
    readonly rows: readonly (readonly string[])[];
    readonly notes: readonly string[];
    readonly page: RecordSheetPageProfile;
}

/** Mirrors MegaMekLab's ReferenceTable vertical and alternating-row layout. */
function drawMmlReferenceTableBody(
    body: SVGGElement,
    options: MmlReferenceTableOptions,
): void {
    const { page } = options;
    const headerLineCount = Math.max(1, ...options.headers.map(header => header.length));
    const noteLineCount = options.notes.reduce(
        (count, note) => count + Math.max(1, note.split('\n').length),
        0,
    );
    const lineCount = headerLineCount + options.rows.length + noteLineCount;
    const rowSpacing = Math.max(1, options.tableHeight / (lineCount + 2));
    const baseFontSize = 5.4 * page.horizontalScale;
    const minimumFontSize = 4.9 * page.horizontalScale;
    const fontSize = Math.max(
        minimumFontSize,
        Math.min(baseFontSize, rowSpacing * 5.4 / (7 * page.verticalScale)),
    );
    const lineHeight = 7 * page.verticalScale * fontSize / baseFontSize;
    const columnWidth = (index: number): number => {
        const left = index === 0
            ? 0
            : (options.columnOffsets[index - 1] + options.columnOffsets[index]) / 2;
        const right = index === options.columnOffsets.length - 1
            ? 1
            : (options.columnOffsets[index] + options.columnOffsets[index + 1]) / 2;
        return Math.max(1, (right - left) * options.bodyWidth - page.horizontalScale);
    };
    let yPosition = 0;

    options.headers.forEach((lines, columnIndex) => {
        let useY = lineHeight * (headerLineCount - lines.length);
        lines.forEach(line => {
            const text = addText(
                body,
                line,
                options.bodyWidth * (options.columnOffsets[columnIndex] ?? 0),
                useY,
                {
                    size: fontSize,
                    weight: 700,
                    anchor: 'middle',
                    class: 'reference-table-heading',
                },
            );
            text.setAttribute('data-mekbay-reference-column', options.columnKeys[columnIndex] ?? String(columnIndex));
            useY += lineHeight;
        });
    });
    yPosition += rowSpacing + lineHeight * (headerLineCount - 1);

    options.rows.forEach((row, rowIndex) => {
        const rowGroup = svgElement('g');
        rowGroup.setAttribute('class', 'reference-table-row');
        rowGroup.setAttribute('data-mekbay-reference-roll', row[0] ?? String(rowIndex));
        if (rowIndex % 2 === 0) {
            const shade = svgElement('rect');
            setAttributes(shade, {
                x: page.horizontalScale,
                y: yPosition - fontSize / 3 - rowSpacing / 2,
                width: options.bodyWidth - 5 * page.horizontalScale,
                height: rowSpacing,
                fill: '#bbb',
                class: 'tableshading',
            });
            rowGroup.appendChild(shade);
        }
        row.slice(0, options.columnOffsets.length).forEach((value, columnIndex) => {
            const text = addText(
                rowGroup,
                value,
                options.bodyWidth * (options.columnOffsets[columnIndex] ?? 0),
                yPosition,
                {
                    size: fontSize,
                    anchor: 'middle',
                    class: 'reference-table-cell',
                    maxWidth: columnWidth(columnIndex),
                },
            );
            const key = options.columnKeys[columnIndex] ?? String(columnIndex);
            text.setAttribute('data-mekbay-reference-column', key);
            if (key.startsWith('cluster-')) {
                text.setAttribute('data-cluster-rack', key.slice('cluster-'.length));
                text.setAttribute('data-cluster-roll', String(rowIndex + 2));
            }
        });
        body.appendChild(rowGroup);
        yPosition += rowSpacing;
    });

    yPosition += rowSpacing / 2;
    options.notes.forEach(note => {
        note.split('\n').forEach(line => {
            addText(body, line, 3 * page.horizontalScale, yPosition, {
                size: fontSize,
                class: 'reference-table-note',
                maxWidth: options.bodyWidth - 6 * page.horizontalScale,
            });
            yPosition += lineHeight;
        });
        yPosition += rowSpacing - lineHeight;
    });
}
