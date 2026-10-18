// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { formatProtectionCounter } from '../record-sheet-protection-counter';
import { addInventoryText, appendInventoryHitModifier, appendInventoryTargetNumber, fitInventoryText, inventoryCellLines, inventoryRowSpan, inventoryRowLineCount } from '../inventory-text-layout';
import { RECORD_SHEET_FONT } from '../record-sheet-typography';

import type { BaseEntity } from '../../../models/entity/base-entity';
import { type MekEntity } from '../../../models/entity/entities/mek/mek-entity';
import {
type EntityMountedEquipment,
type IntrinsicWeapon,
} from '../../../models/entity/types';
import { getMekLocationLabel } from '../../../models/entity/types/mek';
import { RUN_WITHOUT_MASC_CALCULATION, STANDARD_MOVEMENT_CALCULATION } from '../../../models/entity/types/move';
import { isMekEntity } from '../../../models/entity/utils/entity-type-guards';
import { intrinsicActionBaseDamageText } from '../../../models/entity/utils/mek-intrinsic-actions';
import { resolveShieldProfile } from '../../../models/entity/utils/physical-weapon';
import { isHeatSinkEquipment } from '../../../models/heat-equipment.model';
import type { CBTRuleset } from '../../../models/cbt-ruleset.model';
import { mekCriticalDamageThreshold } from '../../../models/runtime/equipment-status-kernel';
import { isJumpJetEquipment } from '../../../models/jump-equipment.model';
import { mekSystemDamageDisplayCapacities } from '../../../models/rules/mek-system-damage-rules';
import { recordSheetHeatEffects } from '../../../models/runtime/heat-effect-presentation';
import { formatEquipmentLocationCodes } from '../../equipment-location-display.util';
import { mekCriticalCaseLabel,mekCriticalSlotLines } from '../../mek-critical-display.util';
import { mekCriticalLocationCells,mekCriticalTableRowCount } from '../../mek-location-layout.util';
import { clusterTableForMekEntity,clusterTableRows,hitLocationRows,mekHitLocationTable,mekPhysicalLocationTableRows,referenceTableNotes } from '../../record-sheet-reference-table';
import { MekPaperdollGenerator, usesBipedMekPaperdoll, type MekStructureTonnage } from '../mek-paperdoll-generator';
import type { PaperdollOptions, PaperdollPipLayout } from '../paperdoll-generator';
import { appendGeneratedMekCriticalHeadingControls } from '../generated-record-sheet-controls';
import { SvgFrameUtil } from '../svg-frame.util';
import { measureSvgTextCanvas } from '../../svg-text.util';
import { COCKPIT_CREW_ROLES } from '../../../models/entity/components/cockpit-data';
import {
flowMekCriticalLocation,
MEK_CRITICAL_BRACKET_TOP,
positionMekCriticalExtraHitPip,
writeMekCriticalSlotLines,
} from '../mek-critical-slot-rendering';
import { appendRecordSheetAmmoProfile, markAmmoBefore, markAmmoInventory, measureRecordSheetAmmoProfile } from '../record-sheet-ammo-rendering';
import { appendDataPanelEraIcon } from '../record-sheet-embedded-art';
import { recordSheetQuirksText } from '../record-sheet-quirks';
import { isMekRecordSheetInventorySupport, recordSheetInventoryMountName } from '../record-sheet-inventory-equipment';
import {
fullRecordSheetLayoutProfile,
recordSheetPageProfile,
type RecordSheetLayoutProfile,
type RecordSheetPageFormat,
} from '../record-sheet-layout';
import {
crewSkillValueX,
CREW_STATE_MENU_SPACE,
addCrewSkillValue,
addDiagramHeading,
addFrame,
addReferenceTableFrame,
addReferenceShade,
addLine,
addText,
appendBattleValue,
appendLegacyIdentityAnchors,
circle,
constructionMaterialSubtitle,
createRoot,
decoratePaperdollPips,
addTemplateCaption,
appendDataPanelFacts,
appendDataPanelType,
type DataPanelFact,
formatRecordSheetTonnage,
appendHeatEffectRows,
appendHeatSinkData,
drawAdvancedMovementCompass,
drawCrewHitGrid,
drawGeneratedFooter,
appendHeatPanelControls,
drawHeatScale,
drawPageChrome,
formatGeometryNumber,
formatMovementWithMaximum,
formatNumber,
formatTechBase,
makeDistributedPips,
markRecordSheetHeatProfile,
paperdollPipOptions,
recordSheetAmmoProfile,
recordSheetHeatProfileText,
recordSheetInventoryWeapons,
setAttributes,
setInventoryComponentIds,
svgElement,
transparentRect,
type Box,
type RecordSheetInventoryAlternativeMode,
type RecordSheetLinkedEquipment,
} from '../record-sheet-svg-rendering';
import type {
RecordSheetLayout,
RecordSheetLayoutRequest,
} from './record-sheet-layout';
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
        const reference = recordSheetPageProfile();
        const widthDelta = page.width - reference.width;
        const heightDelta = page.height - reference.height;
        const at = (box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }) =>
            ({ ...box, x: box.x + widthDelta });
        drawPageChrome(svg, mekRecordSheetTitle(entity), page, false);

        drawMekDataPanel(svg, entity, { x: 18.966, y: 87.857, width: 220.4 + widthDelta, height: 301.5 }, request.ruleset, request.showQuirks);
        const crewCount = Math.max(1, entity.crewSlotCount());
        const lamLayout = entity.chassisConfig === 'LAM';
        const crewHeight = lamLayout ? 107 : 31 + crewCount * MEK_CREW_STATION_HEIGHT;
        drawMekCrewPanel(svg, entity, at({ x: 249.366, y: 87.857, width: 145.6, height: crewHeight }));
        if (lamLayout) {
            drawMekHitLocationAndClusterPanel(
                svg,
                entity,
                at({ x: 249.366, y: 202.857, width: 145.6, height: 114 }),
            );
            drawAdvancedMovementCompass(svg, at({ x: 249.366, y: 319, width: 145.6, height: 70 }),
                'lam-advanced-movement-compass',
                { width: 145.6, height: 70, captionX: 36.9, centerX: 110.7, centerY: 35, halfHeight: 25 });
        } else if (crewCount === 1) {
            drawMekHitLocationAndClusterPanel(
                svg,
                entity,
                at({ x: 249.366, y: 178.857, width: 145.6, height: 123 }),
            );
            drawMekPunchKickPanel(
                svg,
                entity,
                at({ x: 249.366, y: 309.312, width: 145.6, height: 80 }),
                request.ruleset,
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
            );
        }
        await drawMekPaperdolls(svg, entity, at({ x: 402.966, y: 18, width: 173, height: 543 }), request.pipLayout);
        await drawMekCriticalPanel(svg, entity, { x: 18.966, y: 389, width: 377.7 + widthDelta, height: 363 + heightDelta }, request.ruleset);
        drawHeatPanel(svg, entity, at({ x: 402.966, y: 571.5 + heightDelta, width: 159.5, height: 180.5 }));
        drawHeatScale(svg, at({ x: 574.546, y: 386 + heightDelta, width: 19.454, height: 366 }), 'mek');
        const catalyst = entity.chassisConfig === 'Tripod'
            ? { catalystX: 140.64, catalystY: 646.025, catalystScale: 0.968 }
            : entity.chassisConfig === 'LAM'
                ? { catalystX: 140.363, catalystY: 694.565, catalystScale: 1.08 }
                : { catalystX: 140.363, catalystY: 674.365, catalystScale: 1.08 };
        const criticalWidthScale = (377.7 + widthDelta) / 377.7;
        const criticalHeightScale = (363 + heightDelta) / 363;
        drawGeneratedFooter(svg, page, {
            catalystX: 18.966 + (catalyst.catalystX - 18.966) * criticalWidthScale,
            catalystY: 389 + (catalyst.catalystY - 389) * criticalHeightScale,
            catalystScale: catalyst.catalystScale * Math.min(criticalWidthScale, criticalHeightScale),
        });
        return svg;
    }
}

function mekRecordSheetTitle(entity: MekEntity): string {
    if (entity.chassisConfig === 'LAM') return "LAND-AIR 'MECH RECORD SHEET";
    if (entity.chassisConfig === 'QuadVee') {
        return `${entity.omni() ? 'OMNI' : ''}QUADVEE RECORD SHEET`;
    }
    const weight = entity.isSuperHeavy() ? 'SUPERHEAVY ' : entity.mountedCockpit().isPrimitive ? 'PRIMITIVE ' : '';
    const configuration = entity.chassisConfig === 'Quad'
        ? 'FOUR-LEGGED '
        : entity.chassisConfig === 'Tripod'
            ? 'THREE-LEGGED '
            : '';
    return `${weight}${configuration}${entity.isIndustrial() ? 'INDUSTRIALMECH' : entity.omni() ? 'OMNIMECH' : 'BATTLEMECH'} RECORD SHEET`;
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
    defs.append(createLifeSupportHeatDamageIcon(), createLifeSupportOxygenDamageIcon());
    warning.appendChild(defs);
    group.appendChild(warning);
}

/** The flame badge printed "HOT", identical to the reference sheet runtime's icon. */
function createLifeSupportHeatDamageIcon(): SVGSymbolElement {
    const symbol = svgElement('symbol');
    symbol.id = 'lifeSupportHeatDamageIcon';
    symbol.setAttribute('viewBox', '-48 -48 608 608');
    const flame = svgElement('path');
    setAttributes(flame, {
        class: 'lifeSupportHeatFlame',
        d: 'M392.172,147.731c13.598,34.6-10.914,87.102-45.319,68.762c-25.344-13.528-18.732-38.095,0.456-72.5c27.26-48.843-20.194-82.996-20.194-82.996s-9.013,62.081-60.738,51.402C222.128,103.268,220.306,27.526,239.464,0c-69.092,8.212-79.267,107.563-46.951,144.15c38.864,43.999,31.594,102.649-18.451,100.592c-36.398-1.492-53.231-46.943-33.965-91.712c-65.763,27.213-92.19,109.904-87.338,161.722c3.282,34.805,10.411,76.778,39.633,112.682c51.71,72.099,146.821,104.148,234.237,72.208c84.402-30.84,135.859-111.889,133.065-197.044C459.254,264.197,450.617,186.932,392.172,147.731z',
        fill: '#f4511e',
        stroke: '#000',
        'stroke-width': 96,
        'stroke-linejoin': 'round',
        'paint-order': 'stroke fill',
    });
    const letters = [
        'M199.123,395.55c-0.141,0.895-0.722,1.554-1.602,1.672l-17.634,2.34c-0.88,0.11-1.461-0.392-1.319-1.288l6.862-39.53c0.142-0.598-0.157-0.856-0.738-0.778l-31.327,4.153c-0.58,0.078-0.879,0.408-1.02,1.013l-6.847,39.524c-0.157,0.903-0.596,1.539-1.46,1.656l-17.634,2.34c-0.88,0.118-1.46-0.392-1.319-1.287l17.053-98.448c0.142-0.888,0.738-1.555,1.602-1.672l17.634-2.34c0.88-0.117,1.32,0.416,1.178,1.303l-6.564,38.472c-0.142,0.613,0.141,0.864,0.722,0.786l31.185-4.138c0.597-0.079,0.88-0.408,1.021-1.013l6.705-38.487c0.157-0.895,0.738-1.562,1.601-1.672l17.634-2.34c0.879-0.118,1.46,0.392,1.319,1.288L199.123,395.55z',
        'M293.606,363.344c-7.883,16.936-20.854,25.501-38.487,27.841c-18.654,2.473-31.327-6.195-31.327-26.161c0-8.888,4.804-39.398,9.908-50.57c7.867-16.928,20.994-25.525,38.472-27.841c18.655-2.473,31.342,6.194,31.342,26.16C303.515,321.668,298.71,352.178,293.606,363.344z',
        'M389.236,289.455c-0.142,0.895-0.722,1.554-1.602,1.672l-24.339,3.227c-0.581,0.078-0.88,0.408-1.021,1.005l-13.85,80.39c-0.141,0.903-0.722,1.554-1.602,1.672l-17.634,2.339c-0.723,0.094-1.303-0.408-1.162-1.303l13.85-80.39c0.142-0.604-0.157-0.856-0.738-0.777l-24.182,3.211c-0.88,0.11-1.461-0.392-1.32-1.287l2.764-15.672c0.157-0.887,0.738-1.554,1.617-1.672l70.678-9.374c0.879-0.117,1.46,0.4,1.303,1.288L389.236,289.455z',
    ].map(d => {
        const letter = svgElement('path');
        setAttributes(letter, { class: 'lifeSupportHeatLetter', d, fill: '#fff' });
        return letter;
    });
    const counter = svgElement('path');
    setAttributes(counter, {
        class: 'lifeSupportHeatCounter',
        d: 'M269.408,305.205c-8.008,1.06-13.692,6.328-17.053,13.92c-3.501,7.31-7.867,34.114-7.867,41.259c0,8.597,4.946,13.339,13.41,12.216c8.008-1.06,13.692-6.336,17.194-13.936c3.345-7.302,7.726-34.114,7.726-41.251C282.819,308.808,278.014,304.058,269.408,305.205z',
        fill: '#f4511e',
    });
    symbol.append(flame, ...letters, counter);
    return symbol;
}

/** The oxygen-tank "O2" badge, identical to the reference sheet runtime's icon. */
function createLifeSupportOxygenDamageIcon(): SVGSymbolElement {
    const symbol = svgElement('symbol');
    symbol.id = 'lifeSupportOxygenDamageIcon';
    symbol.setAttribute('viewBox', '-48 -48 608 608');
    const shapes = [
        'M80 456V226c0-46 32-76 70-84v-28h30v28c38 8 70 38 70 84v230q0 18-18 18H98q-18 0-18-18z',
        'M140 142V82h-28V42h96v40h-28v23h88v40h-88v-3z',
        'M112 78a50 50 0 1 0 0 100a50 50 0 1 0 0-100zm0 34a16 16 0 1 1 0 32a16 16 0 1 1 0-32z',
        'M292 224q0-58 58-58h18q58 0 58 58v106q0 58-58 58h-18q-58 0-58-58zm50 2v102q0 16 16 16h2q16 0 16-16V226q0-16-16-16h-2q-16 0-16 16z',
        'M412 360q0-46 46-46h12q40 0 40 40q0 24-22 40l-37 27h59v47H404v-48l57-45q9-7 9-17q0-8-10-8h-8q-8 0-8 10z',
    ].map((d, index) => {
        const tank = index < 3;
        const shape = svgElement('path');
        setAttributes(shape, {
            class: tank ? 'lifeSupportOxygenTank' : 'lifeSupportOxygenLabel',
            d,
            fill: tank ? '#2196f3' : '#fff',
            stroke: '#000',
            'stroke-width': 96,
            'stroke-linejoin': 'round',
            'paint-order': 'stroke fill',
            'fill-rule': index === 2 || index === 3 ? 'evenodd' : undefined,
            transform: index === 3 ? 'translate(-44 0)' : undefined,
        });
        return shape;
    });
    symbol.append(...shapes);
    return symbol;
}

export function drawMekDataPanel(
    svg: SVGSVGElement,
    entity: MekEntity,
    box: Box,
    ruleset: CBTRuleset,
    showQuirks = true,
): void {
    const group = addFrame(svg, "'MECH DATA", box, {
        bottomLeftNotchWidth: box.width * 0.48,
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45 },
    });
    group.id = 'unitDataPanel';
    // Keep the authored columns inside the frame's right border and padding.
    const sx = (box.width - 6) / 220.4;
    const sy = box.height / 301.5;
    const fontScale = box.width / 220.4;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    appendDataPanelType(group, entity, { x, y, font }, 3);
    const lamLayout = entity.chassisConfig === 'LAM';
    const quadVeeLayout = entity.chassisConfig === 'QuadVee';
    if (lamLayout) {
        drawLamMekDataHeader(group, entity, { x, y, font, fontScale });
    } else if (quadVeeLayout) {
        drawQuadVeeMekDataHeader(group, entity, { x, y, font });
    } else {
        addText(group, 'Movement Points:', x(6), y(38), { size: font(RECORD_SHEET_FONT.body), weight: 700 }).id = 'movementPointsLabel';
        const boosted = { ...STANDARD_MOVEMENT_CALCULATION, forceTSM: true };
        const movement = { labelX: 6, valueX: 56, anchor: 'middle' } as const;
        appendDataPanelFacts(group, [
            { ...movement, label: 'Walking:', baseline: 47, id: 'mpWalk', field: 'walk',
                value: formatMovementWithMaximum(entity.walkMP(), entity.computeWalkMP(boosted)) },
            { ...movement, label: 'Running:', baseline: 56, id: 'mpRun', field: 'run',
                value: formatMovementWithMaximum(entity.computeRunMP(RUN_WITHOUT_MASC_CALCULATION), entity.computeRunMP(boosted)) },
            { ...movement, label: entity.umuMP() > 0 ? 'Underwater:' : 'Jumping:', baseline: 65, id: 'mpJump', field: 'jump',
                value: String(entity.umuMP() > 0 ? entity.umuMP() : entity.jumpMP()) },
            ...mekDataPanelFacts(entity, [38, 47, 56, 65]),
        ], { x, y, font });
    }
    const inventoryTitleY = lamLayout ? 105.5 : quadVeeLayout ? 87.5 : 80.462;
    const inventoryHeadingY = lamLayout ? 116.3 : quadVeeLayout ? 98.3 : 91.262;
    addLine(group, x(3), y(inventoryTitleY - 10.5), box.width - x(3), y(inventoryTitleY - 10.5), '#111', 0.8 * fontScale);
    addTemplateCaption(group, 'Weapons & Equipment Inventory', x(3), y(inventoryTitleY), {
        size: font(RECORD_SHEET_FONT.section), weight: 700,
    });
    addText(group, '(hexes)', x(171.132), y(inventoryTitleY), { size: font(RECORD_SHEET_FONT.inventory) });
    const headings: readonly [string, number, 'start' | 'middle'][] = [
        ['Type', 8.41, 'start'], ['Loc', 89.56, 'middle'], ['Ht', 103.626, 'middle'],
        ['Dmg', 111.2, 'start'], ['Min', 172.874, 'middle'], ['Sht', 185.425, 'middle'],
        ['Med', 198.842, 'middle'], ['Lng', 212.908, 'middle'],
    ];
    headings.forEach(([label, position, anchor]) => addText(group, label, x(position), y(inventoryHeadingY), {
        size: font(RECORD_SHEET_FONT.inventory), weight: 700, anchor, maxWidth: anchor === 'middle' ? x(11) : undefined,
    }));
    appendMekInventoryRows(group, entity, box, { sx, sy, fontScale }, {
        showQuirks,
        firstBaselineReference: lamLayout ? 126.2 : quadVeeLayout ? 108.2 : 101.162,
        heatProfileReference: quadVeeLayout ? 167.519 : undefined,
    });

    addLine(group, x(3), y(275.143), box.width - x(3), y(275.143), '#111', 1.932 * fontScale);
    appendBattleValue(group, entity.battleValue(ruleset), { x: x(13.845), valueX: x(32.79), y: y(287.143), size: font(9.67) });
    appendLegacyIdentityAnchors(group, entity, box, ruleset);
    appendDataPanelEraIcon(svg, group, entity.year(), { x, y }, 278.25);
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
    const [tonnage, techBase, role, engineType] = mekDataPanelFacts(entity, [38, 38, 47, 47]);
    appendDataPanelFacts(group, [
        { ...tonnage, labelX: 6, valueX: 39.629, maxWidth: 60 },
        techBase,
        { ...engineType, labelX: 6, valueX: 52.222, maxWidth: 60 },
        role,
    ], { x, y, font });
    addText(group, 'Movement Points:', x(6), y(56), { size: font(RECORD_SHEET_FONT.body), weight: 700 }).id = 'movementPointsLabel';
    addText(group, 'BattleMech', x(6), y(65), { size: font(RECORD_SHEET_FONT.body), weight: 700 });
    addText(group, 'AirMech', x(105.312), y(65), { size: font(RECORD_SHEET_FONT.body), weight: 700, anchor: 'middle' });
    addText(group, 'Fighter', x(163.968), y(65), { size: font(RECORD_SHEET_FONT.body), weight: 700 });
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
        const movementFont = font(7.1);
        addText(group, label, x(6), baseline, { size: movementFont, weight: 700 });
        const battle = addText(group, battleMek, x(42), baseline, { size: movementFont, anchor: 'middle' });
        if (index === 0) { battle.id = 'mpWalk'; battle.setAttribute('data-mekbay-field', 'walk'); }
        if (index === 1) { battle.id = 'mpRun'; battle.setAttribute('data-mekbay-field', 'run'); }
        if (index === 2) { battle.id = 'mpJump'; battle.setAttribute('data-mekbay-field', 'jump'); }
        if (airLabel) addText(group, airLabel, x(58.656), baseline, { size: movementFont, weight: 700 });
        if (airMek) {
            const air = addText(group, airMek, x(94.656), baseline, { size: movementFont, anchor: 'middle' });
            air.id = index === 0 ? 'mpAirMekWalk' : 'mpAirMekRun';
        }
        if (fighterLabel) addText(group, fighterLabel, x(111.312), baseline, { size: movementFont, weight: 700 });
        if (fighterValue) {
            const fighter = addText(group, fighterValue, x(147.312), baseline, { size: movementFont, anchor: 'middle' });
            fighter.id = index === 0 ? 'mpAirMekCruise' : 'mpAirMekFlank';
        }
        if (thrustLabel) {
            const thrust = index === 0 ? entity.jumpMP() : Math.ceil(entity.jumpMP() * 1.5);
            addText(group, thrustLabel, x(163.968), baseline, { size: movementFont, weight: 700 });
            const thrustNode = addText(group, String(thrust), x(208.968), baseline, { size: movementFont, anchor: 'middle' });
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
    addText(group, 'Movement Points:', x(6), y(38), { size: font(RECORD_SHEET_FONT.body), weight: 700 }).id = 'movementPointsLabel';
    addText(group, 'BattleMech', x(6.023), y(47), { size: font(RECORD_SHEET_FONT.body), weight: 700 });
    addText(group, 'Vehicle', x(60.85), y(47), { size: font(RECORD_SHEET_FONT.body), weight: 700 });

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
        addText(group, battleLabel, x(6), baseline, { size: font(RECORD_SHEET_FONT.body), weight: 700 });
        const battle = addText(group, battleValue, x(48), baseline, { size: font(RECORD_SHEET_FONT.body), anchor: 'middle' });
        battle.id = battleId;
        battle.setAttribute('data-mekbay-field', field);
        if (vehicleLabel) addText(group, vehicleLabel, x(60.85), baseline, { size: font(RECORD_SHEET_FONT.body), weight: 700 });
        if (vehicleValue) {
            const vehicle = addText(group, vehicleValue, x(102.85), baseline, { size: font(RECORD_SHEET_FONT.body), anchor: 'middle' });
            vehicle.id = vehicleId;
        }
    });

    appendDataPanelFacts(group, mekDataPanelFacts(entity, [38, 47, 56, 65]), { x, y, font });
}

/** Tonnage, tech base, role and engine facts of every Mek data panel, at the given baselines. */
function mekDataPanelFacts(entity: MekEntity, baselines: readonly [number, number, number, number]): readonly DataPanelFact[] {
    const engine = entity.mountedEngine();
    return [
        { label: 'Tonnage:', value: formatRecordSheetTonnage(entity.tonnage()), baseline: baselines[0], id: 'tonnage', field: 'tonnage' },
        { label: 'Tech Base:', value: formatTechBase(entity.techBase(), entity.mixedTech()), baseline: baselines[1],
            id: 'techBase', field: 'tech-base' },
        { label: 'Role:', value: entity.role() || '—', baseline: baselines[2], id: 'role', field: 'role' },
        { label: 'Engine Type:', value: `${engine.rating} ${engine.type()}`, baseline: baselines[3], id: 'engineType' },
    ];
}

/** Weapon names run up to halfway between the location (89.56) and heat (103.626) columns. */
const MEK_INVENTORY_NAME_WIDTH = 89.56 - (103.626 - 89.56) / 2 - 8.41 - 1;

interface MekInventoryGeometry {
    readonly showQuirks?: boolean;
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
    const ammo = recordSheetAmmoProfile(entity);
    const quirks = recordSheetQuirksText(entity, geometry.showQuirks);
    const rowLines = (row: { name: string; location?: string; heat?: string; damage: string; minimumRange?: string; ranges: readonly string[] }, size: number, nameWidth = MEK_INVENTORY_NAME_WIDTH) =>
        inventoryRowLineCount([[row.name, x(nameWidth)], [row.location ?? '', x(18)], [row.heat ?? '', x(8)],
            [row.damage, x(54)], [row.minimumRange ?? '', x(12)], ...row.ranges.map(value => [value, x(12)] as const)], font(size));
    const metrics = fitInventoryText(273.143 - geometry.firstBaselineReference, fontSize => {
        const equipment = equipmentRows.map(row => [rowLines(row, fontSize),
            ...(row.linkedEquipment ? [rowLines({ ...row.linkedEquipment, ranges: [] }, fontSize, 66)] : []),
            ...row.alternativeModes.map(mode => rowLines(mode, fontSize, 66))]);
        const physical = physicalAttacks.map(row => rowLines(row, fontSize));
        const ammoLines = measureRecordSheetAmmoProfile(ammo, { width: x(209.38), fontSize: font(fontSize) }).lines;
        // Measured like addInventoryText, so each line renders without wrapping again.
        const quirkLines = quirks ? inventoryCellLines(quirks, x(209.38), font(fontSize) * 0.9) : [];
        return { lineCount: equipment.flat().reduce((a, b) => a + b, 0) + physical.reduce((a, b) => a + b, 0)
            + ammoLines.length + quirkLines.length + 2,
            badgeRows: [...equipment.flat(), ...physical], content: { equipment, physical, ammoLines, quirkLines } };
    });
    const equipmentSpans = metrics.content.equipment.map(rows => rows.map(lines => inventoryRowSpan(lines, metrics.lineStep)));
    const physicalSpans = metrics.content.physical.map(lines => inventoryRowSpan(lines, metrics.lineStep));
    const equipmentLineOffsets = equipmentSpans.map((_, i, rows) => rows.slice(0, i).flat().reduce((a, b) => a + b, 0));
    const equipmentDisplayLines = equipmentSpans.flat().reduce((a, b) => a + b, 0);
    const physicalOffsets = physicalSpans.map((_, i, rows) => rows.slice(0, i).reduce((a, b) => a + b, 0));
    const physicalLines = physicalSpans.reduce((a, b) => a + b, 0);
    const firstBaseline = y(geometry.firstBaselineReference);
    const rowStep = y(metrics.lineStep);
    const rowFont = font(metrics.fontSize);
    const addCell = (parent: SVGElement, value: string, x: number, y: number, options: Parameters<typeof addText>[4] = {}) =>
        addInventoryText(parent, value, x, y, { ...options, lineHeight: rowStep });
    const rowFontScale = metrics.fontSize / RECORD_SHEET_FONT.inventory;
    const heatProfileY = geometry.heatProfileReference === undefined
        ? firstBaseline + equipmentDisplayLines * rowStep + rowStep * 0.5
        : y(geometry.heatProfileReference);
    const footerFlowLines = physicalLines
        + (physicalAttacks.length > 0 ? 0.5 : 0)
        + metrics.content.quirkLines.length;
    const footerOrigin = y(273.143)
        - Math.max(0, footerFlowLines - 1) * rowStep
        - rowStep * 0.5;
    const inventoryGroup = svgElement('g');
    markAmmoInventory(inventoryGroup, {
        top: firstBaseline - rowFont,
        bottom: footerOrigin - rowStep,
        contentBottom: Math.max(heatProfileY, firstBaseline + Math.max(0, equipmentDisplayLines - 1) * rowStep) + rowFont * 0.3,
    });
    group.appendChild(inventoryGroup);
    const physicalGroup = svgElement('g');
    markAmmoBefore(physicalGroup);
    group.appendChild(physicalGroup);
    const maximumHeat = Math.max(0, entity.heatGeneration());
    markRecordSheetHeatProfile(addCell(
        inventoryGroup,
        recordSheetHeatProfileText(maximumHeat, Math.max(0, entity.heatDissipation())),
        x(8.41),
        heatProfileY,
        { size: font(RECORD_SHEET_FONT.inventory), maxWidth: box.width - x(17) },
    ), maximumHeat);

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
            : footerOrigin + physicalOffsets[index - equipmentRows.length] * rowStep;
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
        const controlHeight = Math.max(y(8) * rowFontScale, (isEquipment ? equipmentSpans[index][0] : physicalSpans[index - equipmentRows.length]) * rowStep);
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

        appendInventoryHitModifier(row, localBaseline, fontScale, rowStep);

        const name = addCell(row, rowData?.name ?? '', x(8.41), localBaseline, {
            class: 'name', size: rowFont, maxWidth: x(MEK_INVENTORY_NAME_WIDTH),
        });
        name.setAttribute('data-mekbay-field', 'inventory-name');
        addCell(row, rowData?.location ?? '', x(89.56), localBaseline, {
            class: 'location', size: rowFont, anchor: 'middle', maxWidth: x(18),
        });
        addCell(row, rowData?.heat ?? '', x(103.626), localBaseline, {
            class: 'heat', size: rowFont, anchor: 'middle', maxWidth: x(8),
        });
        const damage = svgElement('g');
        damage.setAttribute('class', 'damage');
        addCell(damage, rowData?.damage ?? '', x(111.2), localBaseline, {
            size: rowFont, maxWidth: x(54),
        });
        row.appendChild(damage);
        const ranges = rowData?.ranges ?? [];
        const rangeColumns: readonly [string, number, string][] = [
            ['range_min', 172.874, rowData?.minimumRange ?? ''],
            ['range_short', 185.425, ranges[0] ?? ''],
            ['range_medium', 198.842, ranges[1] ?? ''],
            ['range_long', 212.908, ranges[2] ?? ''],
        ];
        rangeColumns.forEach(([className, position, value]) => addCell(row, String(value), x(position), localBaseline, {
            class: className, size: rowFont, anchor: 'middle', maxWidth: x(12),
        }));
        if (rowData) {
            const linked = isEquipment ? equipmentRows[index]?.linkedEquipment ?? null : null;
            if (linked) {
                const entry = svgElement('g');
                setAttributes(entry, { class: 'inventoryEntry linked', id: `generated-inventory-linked-row@${index}` });
                setInventoryComponentIds(entry, [linked.componentId]);
                const linkedBaseline = localBaseline + equipmentSpans[index][0] * rowStep;
                addCell(entry, linked.name, x(12.738), linkedBaseline, { class: 'name', size: rowFont, maxWidth: x(66) });
                addCell(entry, linked.heat, x(103.626), linkedBaseline, {
                    class: 'heat', size: rowFont, anchor: 'middle', maxWidth: x(8),
                });
                const linkedDamage = svgElement('g');
                linkedDamage.setAttribute('class', 'damage');
                addCell(linkedDamage, linked.damage, x(111.2), linkedBaseline, { size: rowFont, maxWidth: x(54) });
                entry.appendChild(linkedDamage);
                row.appendChild(entry);
            }
            alternativeModes.forEach((mode, modeIndex) => {
                const alternative = svgElement('g');
                alternative.setAttribute('class', 'alternativeMode');
                alternative.setAttribute('data-mekbay-mode', mode.name);
                alternative.setAttribute('data-mekbay-static-mode-profile', '1');
                alternative.setAttribute('data-mekbay-mode-label-only', '1');
                const alternativeY = equipmentSpans[index].slice(0, modeIndex + 1 + (linked ? 1 : 0))
                    .reduce((a, b) => a + b, 0) * rowStep;
                alternative.appendChild(transparentRect(
                    x(2), controlY + alternativeY, x(177.104), controlHeight,
                    'inventoryEntryButton alternativeModeButton',
                ));
                buttons.forEach(([className, position, width]) => alternative.appendChild(
                    transparentRect(x(position), controlY + alternativeY, x(width), controlHeight,
                        `inventoryEntryButton ${className}`),
                ));
                const modeBaseline = localBaseline + alternativeY;
                const modeName = addCell(alternative, mode.name, x(12.738), modeBaseline, {
                    class: 'name', size: rowFont, maxWidth: x(66),
                });
                modeName.setAttribute('data-mekbay-field', 'inventory-name');
                addCell(alternative, '', x(89.56), modeBaseline, {
                    class: 'location', size: rowFont, anchor: 'middle', maxWidth: x(18),
                });
                addCell(alternative, mode.heat ?? '', x(103.626), modeBaseline, {
                    class: 'heat', size: rowFont, anchor: 'middle', maxWidth: x(8),
                });
                const modeDamage = svgElement('g');
                modeDamage.setAttribute('class', 'damage');
                addCell(modeDamage, mode.damage, x(111.2), modeBaseline, {
                    size: rowFont, maxWidth: x(54),
                });
                alternative.appendChild(modeDamage);
                const modeValues = [mode.minimumRange, ...mode.ranges];
                rangeColumns.forEach(([className, position], rangeIndex) => addCell(
                    alternative,
                    modeValues[rangeIndex] ?? '',
                    x(position),
                    modeBaseline,
                    { class: className, size: rowFont, anchor: 'middle', maxWidth: x(12) },
                ));
                row.appendChild(alternative);
            });
        }
        addCell(row, '', x(-4), localBaseline, { class: 'quantity', size: font(6.1) * rowFontScale });
        addCell(row, '', x(106), localBaseline, { class: 'mekbay-inventory-summary', size: 0.1, fill: '#fff' });

        appendInventoryTargetNumber(row, 0, localBaseline, fontScale, rowStep);
        (isEquipment ? inventoryGroup : physicalGroup).appendChild(row);
    }

    let footerCursor = footerOrigin + physicalLines * rowStep;
    if (physicalAttacks.length > 0) footerCursor += rowStep * 0.5;
    appendRecordSheetAmmoProfile(group, ammo, {
        x: x(8.41), y: footerCursor - rowStep,
        width: x(209.38), fontSize: rowFont, lineHeight: rowStep,
    });
    metrics.content.quirkLines.forEach((line, index) => {
        const text = addCell(group, line, x(8.41), footerCursor + index * rowStep * 0.9, {
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
    readonly linkedEquipment: RecordSheetLinkedEquipment | null;
    readonly alternativeModes: readonly RecordSheetInventoryAlternativeMode[];
}


function mekRecordSheetInventoryRows(entity: MekEntity): readonly MekRecordSheetInventoryRow[] {
    const mountsById = new Map(entity.equipment().map(mount => [String(mount.mountId), mount] as const));
    const weaponRows: MekRecordSheetInventoryRow[] = recordSheetInventoryWeapons(entity).map(row => {
        const firstId = row.componentIds[0];
        const mount = firstId === undefined ? undefined : mountsById.get(firstId);
        return Object.freeze({
            ...row,
            name: mount ? recordSheetInventoryMountName(entity, mount) : row.name,
        });
    });
    const rangedMounts = new Set<EntityMountedEquipment>(entity.rangedWeapons());
    const equipmentRows: MekRecordSheetInventoryRow[] = entity.equipment()
        .filter(mount => !rangedMounts.has(mount) && isPrintableMekInventoryMount(entity, mount))
        .map(mount => Object.freeze({
            name: recordSheetInventoryMountName(entity, mount),
            location: formatEquipmentLocationCodes(mount.getOccupiedLocations()),
            heat: '—',
            damage: mekMiscInventoryDamage(mount),
            minimumRange: '—',
            ranges: Object.freeze(['—', '—', '—']),
            componentIds: Object.freeze([String(mount.mountId)]),
            quantity: 1,
            linkedEquipment: null,
            alternativeModes: Object.freeze([]),
        }));
    return Object.freeze([...weaponRows, ...equipmentRows]);
}

function isPrintableMekInventoryMount(entity: MekEntity, mount: EntityMountedEquipment): boolean {
    const equipment = mount.equipment;
    if (!equipment || equipment.type !== 'misc' || !equipment.hittable) return false;
    if (mount.location === 'Engine' || mount.location === 'Unallocated') return false;
    if (isHeatSinkEquipment(equipment) || isJumpJetEquipment(equipment)) return false;
    if (entity.chassisConfig === 'QuadVee' && equipment.hasFlag('F_TRACKS')) return false;
    return !isMekRecordSheetInventorySupport(equipment);
}

function mekMiscInventoryDamage(mount: EntityMountedEquipment): string {
    const equipment = mount.equipment;
    if (!equipment) return '—';
    if (equipment.hasFlag('F_AP_POD')) return '[PB,OS,AI]';
    const physicalDamage = mount.getPhysicalWeaponDamage();
    return physicalDamage === undefined ? '[E]' : String(physicalDamage.value);
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
        name: attack.name,
        location: attack.locations.join('/'),
        heat: '—',
        damage: mekPhysicalDamageText(attack),
        minimumRange: '—',
        ranges: Object.freeze(['—', '—', '—']),
        componentIds: Object.freeze([]),
    })));
}

function mekPhysicalDamageText(attack: IntrinsicWeapon): string {
    if (attack.damage.kind === 'fixed' && attack.damage.boostedValue !== undefined) {
        return `${intrinsicActionBaseDamageText(attack)} [${attack.damage.boostedValue}]`;
    }
    if (attack.kind !== 'charge' || attack.damage.kind !== 'per-hex') {
        return intrinsicActionBaseDamageText(attack);
    }
    const coefficient = formatNumber(attack.damage.coefficient * 2);
    return `${coefficient}×(TMM+1)${attack.damage.bonus === 0 ? '' : `+${attack.damage.bonus}`}`;
}

function drawMekCrewPanelContents(group: SVGGElement, entity: MekEntity, box: Box): void {
    if (entity.chassisConfig === 'LAM') {
        drawLamMekCrewPanelContents(group, box);
        return;
    }
    const roles = COCKPIT_CREW_ROLES[entity.mountedCockpit().crewType];
    const content = svgElement('g');
    content.setAttribute('class', `frame ${roles.length > 1 ? 'mek-multi-crew-data' : 'mek-single-crew-data'}`);
    content.setAttribute('transform', `translate(${MEK_CREW_CONTENT_X} 18)`);
    // Stations end two units inside the frame's inner border, as on the reference sheet.
    const width = SvgFrameUtil.innerRight(box.width) - 2 - MEK_CREW_CONTENT_X;
    // A single station is captioned "Name", like MegaMekLab's single-crew sheet.
    (roles.length > 1 ? roles : ['Name']).forEach((role, occurrence) =>
        appendMekCrewStation(content, occurrence, role, width));
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
    const nameEnd = SvgFrameUtil.innerRight(box.width) - 2 - CREW_STATE_MENU_SPACE;
    const name = addText(group, '', x(29), y(27), { size: font(7.2), weight: 700, maxWidth: nameEnd - x(29) });
    name.id = 'crewName0';
    const nameButton = transparentRect(x(27), y(17), nameEnd - x(27), y(13), 'crewNameButton');
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
    const gunnery = addCrewSkillValue(group, '4', x(49), y(baseline), font(1), 'middle');
    gunnery.id = gunneryId;
    const gunButton = transparentRect(x(43), y(baseline - 9), x(13), y(12) - y(0), 'crewSkillButton');
    gunButton.setAttribute('crewId', String(crewId));
    gunButton.setAttribute('skill', gunneryId.startsWith('aero') ? 'aero-gunnery' : 'gunnery');
    group.appendChild(gunButton);
    addText(group, 'Piloting Skill:', x(72), y(baseline), { size: font(5.7), weight: 700 });
    const piloting = addCrewSkillValue(group, '5', x(132), y(baseline), font(1), 'middle');
    piloting.id = pilotingId;
    const pilotButton = transparentRect(x(124), y(baseline - 9), x(16), y(12) - y(0), 'crewSkillButton');
    pilotButton.setAttribute('crewId', String(crewId));
    pilotButton.setAttribute('skill', pilotingId.startsWith('aero') ? 'aero-piloting' : 'piloting');
    group.appendChild(pilotButton);
}

/** Left gutter of the station content; the reference sheet indents captions by three more units. */
const MEK_CREW_CONTENT_X = 3;
const MEK_CREW_STATION_HEIGHT = 52;

function appendMekCrewStation(
    content: SVGGElement,
    occurrence: number,
    role: string,
    width: number,
): void {
    const block = svgElement('g');
    block.setAttribute('class', 'mek-crew-position');
    block.setAttribute('data-mekbay-crew-position', String(occurrence));
    block.setAttribute('data-mekbay-crew-width', formatNumber(width));
    block.setAttribute('data-mekbay-crew-height', String(MEK_CREW_STATION_HEIGHT));
    if (occurrence > 0) block.setAttribute('transform', `translate(0 ${occurrence * MEK_CREW_STATION_HEIGHT})`);

    const roleLabel = addText(block, `${role}:`, 3, 12, { size: RECORD_SHEET_FONT.inventory, weight: 700 });
    roleLabel.id = `crewName${occurrence}`;
    // The written name and its line start after the measured caption, so long
    // roles such as "Tech Officer:" never run under the name.
    const nameX = 3 + measureSvgTextCanvas(roleLabel, roleLabel.textContent ?? '') + 3;
    // The line stops short of the right gutter, leaving room for the crew-state menu.
    const lineEnd = width - CREW_STATE_MENU_SPACE;
    const pilotName = addText(block, '', nameX, 12, { size: RECORD_SHEET_FONT.inventory });
    pilotName.id = `pilotName${occurrence}`;
    const blankName = svgElement('path');
    setAttributes(blankName, {
        id: `blankCrewName${occurrence}`,
        d: `M ${formatNumber(nameX)} 13 H ${formatNumber(lineEnd)}`,
        stroke: '#000',
        'stroke-width': 0.72,
        'stroke-linejoin': 'round',
        fill: 'none',
    });
    block.appendChild(blankName);
    const nameButton = transparentRect(3, 1, lineEnd - 3, 12, 'crewNameButton');
    nameButton.id = `crewNameButton${occurrence}`;
    nameButton.setAttribute('crewId', String(occurrence));
    nameButton.setAttribute('textElement', pilotName.id);
    nameButton.setAttribute('blankElement', blankName.id);
    block.appendChild(nameButton);

    const gunneryLabel = addText(block, 'Gunnery Skill:', 3, 24, { size: RECORD_SHEET_FONT.inventory, weight: 700 });
    gunneryLabel.id = `gunnerySkillText${occurrence}`;
    const gunnery = addCrewSkillValue(block, '4', crewSkillValueX(gunneryLabel, 48.632), 24);
    gunnery.id = `gunnerySkill${occurrence}`;
    const blankGunnery = svgElement('path');
    setAttributes(blankGunnery, {
        id: `blankGunnerySkill${occurrence}`,
        class: 'skillBlank hidden',
        d: 'M 48.632 25 H 67.17',
        stroke: '#000', 'stroke-width': 0.72, 'stroke-linejoin': 'round', fill: 'none',
    });
    block.appendChild(blankGunnery);

    const pilotingLabel = addText(block, 'Piloting Skill:', 71.3, 24, { size: RECORD_SHEET_FONT.inventory, weight: 700 });
    pilotingLabel.id = `pilotingSkillText${occurrence}`;
    const piloting = addCrewSkillValue(block, '5', crewSkillValueX(pilotingLabel, 116.932), 24);
    piloting.id = `pilotingSkill${occurrence}`;
    const blankPiloting = svgElement('path');
    setAttributes(blankPiloting, {
        id: `blankPilotingSkill${occurrence}`,
        class: 'skillBlank hidden',
        d: `M 116.932 25 H ${formatNumber(width)}`,
        stroke: '#000', 'stroke-width': 0.72, 'stroke-linejoin': 'round', fill: 'none',
    });
    block.appendChild(blankPiloting);

    const damage = svgElement('g');
    damage.id = `crewDamage${occurrence}`;
    drawCrewHitGrid(damage, occurrence, {
        x: 49.91, y: 32, cellWidth: (width - 49.91) / 6, cellHeight: 10,
        labelX: 3, labelWidth: 43.91, fontScale: 1,
    });
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
    content.appendChild(block);
}

function bipedStructureTonnage(entity: MekEntity): Exclude<MekStructureTonnage, number> {
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

/**
 * Each view owns an independent box in the canonical 173 by 543 diagram area.
 * Its labels use box coordinates; `art` registers the authored artwork with the
 * reference sheet's silhouette inside that box.
 */
export const BIPED_MEK_PAPERDOLL_BOXES = Object.freeze({
    front: Object.freeze({ x: 6, y: 7.667, width: 176.347, height: 272.325,
        art: Object.freeze({ scale: 0.97, x: -1.295, y: -0.703 }) }),
    rear: Object.freeze({ x: 46.726, y: 252.479, width: 98.94, height: 87.3,
        art: Object.freeze({ scale: 0.97, x: -0.29, y: 5.32 }) }),
    structure: Object.freeze({ x: 30.2, y: 383.11, width: 117, height: 171,
        art: Object.freeze({ scale: 0.995, x: -2.03, y: -0.26 }) }),
});

function mekArmorSubtitle(entity: MekEntity): string {
    const armor = entity.uniformArmor()?.armor;
    const name = constructionMaterialSubtitle(armor?.name, 'Armor', 'Patchwork');
    return armor && armor.bar < 10 ? `${name}, BAR: ${armor.bar}` : name;
}

export async function drawMekPaperdolls(svg: SVGSVGElement, entity: MekEntity, box: Box, pipLayout: PaperdollPipLayout): Promise<void> {
    const shieldValues = Object.fromEntries(entity.equipment().flatMap(mount => {
        const shield = resolveShieldProfile(mount.equipment);
        const arm = mount.getOccupiedLocations().find(location => location === 'LA' || location === 'RA');
        return shield && arm ? [[arm, { da: shield.damageAbsorption, dc: shield.damageCapacity }]] : [];
    }));
    if (!usesBipedMekPaperdoll(entity.chassisConfig)) {
        await drawProfiledMekPaperdolls(svg, entity, box, pipLayout, shieldValues);
        return;
    }
    const group = svgElement('g');
    group.setAttribute('class', 'mek-paperdolls');
    const scale = Math.min(1, box.width / 173, box.height / 543);
    group.setAttribute('transform', `translate(${formatNumber(box.x + box.width - 173 * scale)} ${formatNumber(box.y)}) scale(${formatGeometryNumber(scale)})`);
    group.setAttribute('data-mekbay-pip-layout', pipLayout);
    const armor: Record<string, number> = {};
    const structurePipCounts: Record<string, number> = {};
    for (const location of entity.damageLocations()) {
        armor[location.code] = location.armor.front;
        armor[`${location.code}_R`] = location.armor.rear;
        structurePipCounts[location.code] = location.internalPoints;
    }
    addDiagramHeading(group, 'ARMOR DIAGRAM',
        mekArmorSubtitle(entity),
        173, 0, {
            titleWidth: 84, titleX: 54.004, titleY: -0.197,
            ribbonX: 36.004, ribbonY: 0, ribbonWidth: 123.749, ribbonCut: 3.749,
            subtitleX: 96, subtitleY: 21.5, subtitleId: 'armorType',
        });
    addDiagramHeading(group, 'INTERNAL STRUCTURE DIAGRAM',
        constructionMaterialSubtitle(entity.uniformStructureMaterial()?.structure.name, 'Structure', 'Hybrid Structure'),
        173, 370, {
            titleWidth: 142.791, titleX: 13.745, titleY: 352.888,
            ribbonX: 25.723, ribbonY: 354.03, ribbonWidth: 122.512, ribbonCut: 3.712,
            subtitleX: 86.034, subtitleY: 375.445, subtitleId: 'structureType',
            subtitleHorizontalScale: 0.990245,
        });
    const boxes = BIPED_MEK_PAPERDOLL_BOXES;
    const options = { pipLayout, fallbackPipLayout: 'distributed' as const, shieldValues,
        scale: false, preserveAuthoredCoordinates: true,
        pipOptions: paperdollPipOptions(pipLayout, 2.15, 0.9) };
    const [front, rear, structure] = await Promise.all([
        MekPaperdollGenerator.createArmorPaperdoll(boxes.front.width, boxes.front.height, armor, options),
        MekPaperdollGenerator.createArmorRearPaperdoll(boxes.rear.width, boxes.rear.height, armor, options),
        MekPaperdollGenerator.createStructurePaperdoll(boxes.structure.width, boxes.structure.height,
            bipedStructureTonnage(entity), { ...options, structurePipCounts,
                pipOptions: paperdollPipOptions(pipLayout, 1.55, 0.7) }),
    ]);
    const layers = { front, rear, structure };
    for (const view of ['front', 'rear', 'structure'] as const) {
        const placement = boxes[view];
        const layer = layers[view];
        // The biped labels use sheet coordinates. Keep their authored alignment
        // as source viewBoxes tighten or optional shields extend the artwork.
        const { scale, x: offsetX, y: offsetY } = placement.art;
        const art = svgElement('g');
        art.setAttribute('transform', `matrix(${scale} 0 0 ${scale} ${offsetX} ${offsetY})`);
        art.append(...Array.from(layer.childNodes));
        layer.appendChild(art);
        layer.setAttribute('data-art-x', String(Number(layer.getAttribute('data-art-x')) * scale + offsetX));
        layer.setAttribute('data-art-y', String(Number(layer.getAttribute('data-art-y')) * scale + offsetY));
        layer.setAttribute('data-art-width', String(Number(layer.getAttribute('data-art-width')) * scale));
        layer.setAttribute('data-art-height', String(Number(layer.getAttribute('data-art-height')) * scale));
        layer.classList.add('mek-paperdoll-view', `mek-paperdoll-${view}`);
        layer.setAttribute('data-mekbay-paperdoll-view', view);
        layer.setAttribute('transform', `translate(${placement.x} ${placement.y})`);
        decoratePaperdollPips(layer, view === 'rear');
        group.appendChild(layer);
    }
    drawBipedDiagramValues(layers, entity);
    svg.appendChild(group);
}

// Coordinates are local to each view, so layout placement changes carry all labels with the art.
const BIPED_ARMOR_VALUE_LABELS: Readonly<Record<string, readonly [number, number]>> = {
    HD: [97.641, 26.276], CT: [90.262, 191.399], CT_R: [49.536, 3.439],
    RT: [123.423, 39.362], RT_R: [116.971, 85.947],
    LT: [56.367, 39.362], LT_R: [-18.014, 85.947],
    RA: [161.601, 189.479], LA: [20.156, 189.479],
    RL: [167.581, 240.287], LL: [12.454, 240.287],
};

const BIPED_STRUCTURE_VALUE_LABELS: Readonly<Record<string, readonly [number, number]>> = {
    CT: [55.14, 119.484], RT: [120.854, 14], LT: [21.08, 14],
    RA: [122.68, 90.283], LA: [-14.48, 90.283],
    RL: [112.108, 148.079], LL: [-2.014, 148.079],
};

const BIPED_ARMOR_NAME_LINES: Readonly<Record<string, readonly string[]>> = {
    HD: ['Head'], CT: ['Center', 'Torso'], CT_R: ['Center', 'Torso'],
    RT: ['Right Torso'], LT: ['Left Torso'], RA: ['Right Arm'], LA: ['Left Arm'],
    RT_R: ['Right', 'Torso Rear'], LT_R: ['Left', 'Torso Rear'],
    RL: ['Right', 'Leg'], LL: ['Left', 'Leg'],
};

const BIPED_STRUCTURE_NAME_LINES: Readonly<Record<string, readonly string[]>> = {
    CT: ['Center', 'Torso'], RT: ['Right Torso'], LT: ['Left Torso'],
    RA: ['Right', 'Arm'], LA: ['Left', 'Arm'], RL: ['Right', 'Leg'], LL: ['Left', 'Leg'],
};

function drawBipedDiagramValues(
    views: Readonly<Record<'front' | 'rear' | 'structure', SVGGElement>>,
    entity: MekEntity,
): void {
    const labels = { front: svgElement('g'), rear: svgElement('g'), structure: svgElement('g') };
    for (const view of ['front', 'rear', 'structure'] as const) {
        labels[view].setAttribute('class', 'mek-paperdoll-labels');
        views[view].appendChild(labels[view]);
    }
    const locations = new Map(entity.damageLocations().map(location => [location.code, location] as const));
    const addValue = (
        group: SVGGElement,
        id: string,
        value: number,
        position: readonly [number, number],
        horizontalScale: number,
        xCorrection: number,
        nameLines: readonly string[],
    ): void => {
        const anchorX = position[0] - xCorrection;
        const head = id === 'textArmor_HD';
        const structure = id.startsWith('textIS_');
        const inlineTorso = id === 'textIS_LT' || id === 'textIS_RT';
        const lineHeight = structure ? 8.47 : 6.746;
        nameLines.forEach((line, index) => {
            const name = addText(group, line, inlineTorso ? anchorX - 10 : head ? anchorX - 7 : anchorX,
                position[1] - 0.85 - (head || inlineTorso ? 0 : (nameLines.length - index) * lineHeight), {
                    size: structure ? 5.7662 : 5.6216, weight: 700, anchor: head || inlineTorso ? 'end' : 'middle',
                    class: 'diagram-value diagram-location-name',
                });
            name.setAttribute('data-counter-id', id);
        });
        const label = addText(group, formatProtectionCounter(Math.max(0, value)), anchorX, (position[1] - 0.85), {
            size: 5.7955,
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
            labels[rear ? 'rear' : 'front'],
            `textArmor_${rear ? `${location.code}R` : location.code}`,
            rear ? location.armor.rear : location.armor.front,
            position,
            0.971555,
            0.1034,
            BIPED_ARMOR_NAME_LINES[code],
        );
        const material = !rear && !entity.uniformArmor() ? entity.armorAt(location.code).armor : undefined;
        if (material && !['STANDARD', 'STEALTH', 'STEALTH_VEHICLE'].includes(material.armorType)) {
            const name = addText(labels.front, material.name, position[0] - 0.1034, position[1] + 5.9, {
                size: 5.6216, anchor: 'middle', maxWidth: 45, class: 'diagram-material-name',
            });
            name.setAttribute('data-loc', location.code);
        }
    });
    Object.entries(BIPED_STRUCTURE_VALUE_LABELS).forEach(([code, position]) => {
        const location = locations.get(code);
        if (location) addValue(labels.structure, `textIS_${code}`, location.internalPoints, position,
            0.99483, 0.0877, BIPED_STRUCTURE_NAME_LINES[code]);
    });
    addText(labels.structure, 'Head', 32.126, 2.965, {
        size: 5.7662, weight: 700, class: 'diagram-value diagram-location-name',
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
    readonly rear: string;
    readonly structure: string;
}

interface ProfiledMekDiagramHeading {
    readonly titleWidth: number;
    readonly titleX: number;
    readonly titleY: number;
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
}

interface ProfiledMekPaperdollProfile {
    readonly armor: ProfiledMekArtPlacement;
    readonly rear: ProfiledMekArtPlacement;
    readonly structure: ProfiledMekArtPlacement;
    readonly armorHeading: ProfiledMekDiagramHeading;
    readonly structureHeading: ProfiledMekDiagramHeading;
}

type ProfiledMekChassis = 'Quad' | 'Tripod' | 'QuadVee';

const NON_BIPED_PAPERDOLL_ASSETS: Readonly<Record<ProfiledMekChassis, NonBipedPaperdollAssets>> = {
    Quad: {
        armor: '/images/paperdolls/quad-armor.svg',
        rear: '/images/paperdolls/quad-armor-back.svg',
        structure: '/images/paperdolls/quad-structure.svg',
    },
    Tripod: {
        armor: '/images/paperdolls/tripod-armor.svg',
        rear: '/images/paperdolls/tripod-armor-back.svg',
        structure: '/images/paperdolls/tripod-structure.svg',
    },
    QuadVee: {
        armor: '/images/paperdolls/quadvee-armor.svg',
        rear: '/images/paperdolls/quadvee-armor-back.svg',
        structure: '/images/paperdolls/quadvee-structure.svg',
    },
};

const STANDARD_PROFILED_ARMOR_HEADING: ProfiledMekDiagramHeading = Object.freeze({
    titleWidth: 83.991,
    titleX: 54.004,
    titleY: 0,
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
    ribbonX: 25.983062,
    ribbonY: 354,
    ribbonWidth: 123.749,
    ribbonCut: 3.749,
    subtitleX: 86.879062,
    subtitleY: 375.5,
});

const PROFILED_MEK_PAPERDOLLS: Readonly<Record<ProfiledMekChassis, ProfiledMekPaperdollProfile>> = Object.freeze({
    Quad: Object.freeze({
        armor: Object.freeze({ x: 0, y: 0 }),
        rear: Object.freeze({ x: 0, y: 0 }),
        structure: Object.freeze({ x: 0, y: 368 }),
        armorHeading: STANDARD_PROFILED_ARMOR_HEADING,
        structureHeading: STANDARD_PROFILED_STRUCTURE_HEADING,
    }),
    QuadVee: Object.freeze({
        armor: Object.freeze({ x: 0, y: 0 }),
        rear: Object.freeze({ x: 0, y: 0 }),
        structure: Object.freeze({ x: 0, y: 368 }),
        armorHeading: STANDARD_PROFILED_ARMOR_HEADING,
        structureHeading: STANDARD_PROFILED_STRUCTURE_HEADING,
    }),
    Tripod: Object.freeze({
        armor: Object.freeze({ x: -0.88073, y: 2.473206 }),
        rear: Object.freeze({ x: -0.88073, y: 2.473206 }),
        structure: Object.freeze({ x: 0, y: 372 }),
        armorHeading: Object.freeze({
            titleWidth: 83.991,
            titleX: 53.123571,
            titleY: 2.473206,
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
            ribbonX: 25.983062,
            ribbonY: 356,
            ribbonWidth: 123.749,
            ribbonCut: 3.749,
            subtitleX: 86.879062,
            subtitleY: 377.5,
        }),
    }),
});

async function drawProfiledMekPaperdolls(
    svg: SVGSVGElement, entity: MekEntity, box: Box, pipLayout: PaperdollPipLayout,
    shieldValues: PaperdollOptions['shieldValues'],
): Promise<void> {
    const group = svgElement('g');
    group.setAttribute('class', 'mek-paperdolls mek-paperdolls-schematic');
    group.setAttribute('transform', `translate(${formatNumber(box.x)} ${formatNumber(box.y)})`);
    group.setAttribute('data-mekbay-pip-layout', pipLayout);
    const chassis = entity.chassisConfig as keyof typeof NON_BIPED_PAPERDOLL_ASSETS;
    const assets = NON_BIPED_PAPERDOLL_ASSETS[chassis];
    const profile = PROFILED_MEK_PAPERDOLLS[chassis];
    const content = svgElement('g');
    content.setAttribute(
        'transform',
        `scale(${formatGeometryNumber(Math.min(1, box.width / 173, box.height / 543))})`,
    );
    group.appendChild(content);

    addDiagramHeading(
        content,
        'ARMOR DIAGRAM',
        mekArmorSubtitle(entity),
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
        const armorArt = await MekPaperdollGenerator.createArmorPaperdoll(
            armorArea.width,
            armorArea.height,
            armorValues,
            {
                assetUrl: assets.armor,
                shieldValues,
                preserveAuthoredCoordinates: true,
                className: 'mek-paperdoll-art mek-paperdoll-art-armor mek-paperdoll-view mek-paperdoll-front',
                centeredHorizontally: false,
                centeredVertically: false,
                scale: false,
                pipLayout,
                pipOptions: paperdollPipOptions(pipLayout, 2.45, 0.72),
            },
        );
        armorArt.setAttribute(
            'transform',
            `translate(${formatGeometryNumber(profile.armor.x)} ${formatGeometryNumber(profile.armor.y)})`,
        );
        armorArt.setAttribute('data-mekbay-paperdoll-view', 'front');
        decoratePaperdollPips(armorArt);
        exactLayers.appendChild(armorArt);
        const rearArt = await MekPaperdollGenerator.createArmorRearPaperdoll(185, 85, armorValues, {
            assetUrl: assets.rear,
            preserveAuthoredCoordinates: true,
            className: 'mek-paperdoll-art mek-paperdoll-art-rear mek-paperdoll-view mek-paperdoll-rear',
            centeredHorizontally: false, centeredVertically: false, scale: false,
            pipLayout, pipOptions: paperdollPipOptions(pipLayout, 2.45, 0.72),
        });
        rearArt.setAttribute('data-mekbay-paperdoll-view', 'rear');
        rearArt.setAttribute('transform', `translate(${formatGeometryNumber(profile.rear.x)} ${formatGeometryNumber(profile.rear.y)})`);
        decoratePaperdollPips(rearArt, true);
        exactLayers.appendChild(rearArt);

        const structureArt = await MekPaperdollGenerator.createStructurePaperdoll(
            structureArea.width,
            structureArea.height,
            0,
            {
                assetUrl: assets.structure,
                preserveAuthoredCoordinates: true,
                className: 'mek-paperdoll-art mek-paperdoll-art-structure mek-paperdoll-view mek-paperdoll-structure',
                centeredHorizontally: false,
                centeredVertically: false,
                scale: false,
                pipLayout,
                pipOptions: paperdollPipOptions(pipLayout, 2.45, 0.72),
                structurePipCounts,
            },
        );
        structureArt.setAttribute(
            'transform',
            `translate(${formatGeometryNumber(profile.structure.x)} ${formatGeometryNumber(profile.structure.y)})`,
        );
        structureArt.setAttribute('data-mekbay-paperdoll-view', 'structure');
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
        if (counter) counter.textContent = formatProtectionCounter(Math.max(0, value));
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

const REAR_TORSO_REGIONS: readonly MekSchematicRegion[] = Object.freeze([
    { code: 'LT', x: 0, y: 0.14, width: 0.34, height: 0.72 },
    { code: 'CT', x: 0.33, y: 0, width: 0.34, height: 1 },
    { code: 'RT', x: 0.66, y: 0.14, width: 0.34, height: 0.72 },
]);

function nonBipedFrontRegions(config: MekEntity['chassisConfig']): readonly MekSchematicRegion[] {
    if (config === 'Tripod') return TRIPOD_SCHEMATIC_REGIONS;
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
    target.setAttribute('data-loc', location);
    if (kind === 'rear') target.setAttribute('data-rear', '');
    group.appendChild(target);
}

export async function drawMekCriticalPanel(
    svg: SVGSVGElement, entity: MekEntity, box: Box, ruleset: CBTRuleset,
): Promise<void> {
    const group = addFrame(svg, 'CRITICAL TABLE', box, {
        id: 'criticalHitTable',
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    await drawCanonicalMekCriticalContents(group, entity, box, ruleset);
}

interface CanonicalCriticalLocationLayout {
    readonly headingX: number;
    readonly headingY: number;
    readonly numberX: number;
    readonly textX: number;
    readonly firstBaseline: number;
    readonly step: number;
    readonly rightEdge: number;
    /** Lowest baseline the column may use when multi-line slots push its rows down. */
    readonly lastBaseline: number;
    /** "1-3" and "4-6" labels of a 12-slot location, centered beside each six-row block. */
    readonly rollLabels?: Readonly<{ x: number; y: readonly [number, number] }>;
}

const CANONICAL_BIPED_CRITICAL_LAYOUT: Readonly<Record<string, CanonicalCriticalLocationLayout>> = {
    LA: { headingX: 31.05, headingY: 34, numberX: 24, textX: 34.34, firstBaseline: 43.154, step: 8.154, rightEdge: 121.397, lastBaseline: 158, rollLabels: { x: 6, y: [64.875, 119.125] } },
    HD: { headingX: 146.05, headingY: 23, numberX: 139, textX: 149.34, firstBaseline: 32.333, step: 8.333, rightEdge: 236.795, lastBaseline: 89 },
    RA: { headingX: 261.05, headingY: 34, numberX: 254, textX: 264.34, firstBaseline: 43.154, step: 8.154, rightEdge: 371.7, lastBaseline: 158, rollLabels: { x: 236.795, y: [64.875, 119.125] } },
    LT: { headingX: 31.05, headingY: 167, numberX: 24, textX: 34.34, firstBaseline: 176.154, step: 8.154, rightEdge: 121.397, lastBaseline: 292, rollLabels: { x: 6, y: [198.39, 252.64] } },
    CT: { headingX: 146.05, headingY: 98, numberX: 139, textX: 149.34, firstBaseline: 107.154, step: 8.154, rightEdge: 236.795, lastBaseline: 206, rollLabels: { x: 121.397, y: [128.7, 182.95] } },
    RT: { headingX: 261.05, headingY: 167, numberX: 254, textX: 264.34, firstBaseline: 176.154, step: 8.154, rightEdge: 371.7, lastBaseline: 292, rollLabels: { x: 236.795, y: [198.39, 252.64] } },
    LL: { headingX: 31.05, headingY: 301, numberX: 24, textX: 34.34, firstBaseline: 310.333, step: 8.334, rightEdge: 121.397, lastBaseline: 358 },
    RL: { headingX: 261.05, headingY: 301, numberX: 254, textX: 264.34, firstBaseline: 310.333, step: 8.334, rightEdge: 371.7, lastBaseline: 358 },
};

const CANONICAL_QUAD_CRITICAL_LAYOUT: Readonly<Record<string, CanonicalCriticalLocationLayout>> = {
    FLL: { headingX: 31.05, headingY: 64, numberX: 24, textX: 34.34, firstBaseline: 73.333, step: 8.333, rightEdge: 121.397, lastBaseline: 158 },
    HD: CANONICAL_BIPED_CRITICAL_LAYOUT['HD'],
    FRL: { headingX: 261.05, headingY: 64, numberX: 254, textX: 264.34, firstBaseline: 73.333, step: 8.333, rightEdge: 371.7, lastBaseline: 158 },
    LT: CANONICAL_BIPED_CRITICAL_LAYOUT['LT'],
    CT: CANONICAL_BIPED_CRITICAL_LAYOUT['CT'],
    RT: CANONICAL_BIPED_CRITICAL_LAYOUT['RT'],
    RLL: { headingX: 31.05, headingY: 301, numberX: 24, textX: 34.34, firstBaseline: 310.333, step: 8.334, rightEdge: 121.397, lastBaseline: 358 },
    RRL: { headingX: 261.05, headingY: 301, numberX: 254, textX: 264.34, firstBaseline: 310.333, step: 8.334, rightEdge: 371.7, lastBaseline: 358 },
};

const CANONICAL_TRIPOD_CRITICAL_LAYOUT: Readonly<Record<string, CanonicalCriticalLocationLayout>> = {
    ...CANONICAL_BIPED_CRITICAL_LAYOUT,
    CL: { headingX: 146.05, headingY: 301, numberX: 139, textX: 149.34, firstBaseline: 310.333, step: 8.334, rightEdge: 236.795, lastBaseline: 358 },
};

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
    ruleset: CBTRuleset,
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

    mekCriticalLocationCells(entity.chassisConfig).forEach(location => {
        if (location === null) return;
        const locationLayout = layout[location];
        if (!locationLayout) return;
        const rollLabels = locationLayout.rollLabels;
        rollLabels?.y.forEach((labelY, half) => addText(group, half === 0 ? '1-3' : '4-6', x(rollLabels.x), y(labelY), {
            size: font(9.65),
            weight: 700,
            class: 'critical-roll-range',
        }).setAttribute('data-mekbay-roll-loc', location));
        const criticalGroup = svgElement('g');
        criticalGroup.setAttribute('class', 'critGroup');
        criticalGroup.setAttribute('data-loc', location);
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
        const slotBaseline = (slotIndex: number): number => locationLayout.firstBaseline
            + slotIndex * locationLayout.step + (slotCount === 12 && slotIndex >= 6 ? 5.15 : 0);
        const equipmentRuns = new Map<string, { first: number; last: number }[]>();
        for (let slotIndex = 0; slotIndex < slotCount; slotIndex++) {
            const row = svgElement('g');
            row.setAttribute('class', 'critRow');
            criticalGroup.appendChild(row);
            const slot = slots[slotIndex];
            const baseline = slotBaseline(slotIndex);
            if (slot?.type === 'equipment') {
                for (const mount of slot.mounts) {
                    if (mount.equipment?.hittable !== true) continue;
                    const runs = equipmentRuns.get(mount.mountId) ?? [];
                    const previous = runs.at(-1);
                    if (previous?.last === slotIndex - 1) previous.last = slotIndex;
                    else runs.push({ first: slotIndex, last: slotIndex });
                    equipmentRuns.set(mount.mountId, runs);
                }
            }
            const number = slotCount === 12 ? slotIndex % 6 + 1 : slotIndex + 1;
            addText(row, `${number}.`, x(locationLayout.numberX), y(baseline), {
                size: font(7),
                weight: 700,
                maxWidth: x(10),
            });

            const slotTop = baseline - locationLayout.step;
            const slotGroup = svgElement('g');
            slotGroup.setAttribute('class', 'critSlot');
            slotGroup.setAttribute('data-loc', location);
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
            }
            if (slot && slot.type !== 'empty') {
                slotGroup.appendChild(transparentRect(
                    x(locationLayout.numberX - locationLayout.textX - 2),
                    1,
                    x(locationLayout.rightEdge - locationLayout.numberX - 4),
                    y(locationLayout.step),
                    'critSlot-bg-rect',
                ));
            }
            const extraHit = slot?.type === 'equipment' && slot.mounts.some(mount =>
                mount.placedCriticalSlotCount === 1 && mount.equipment
                && mekCriticalDamageThreshold(ruleset, mount.equipment.flags) === 2);
            const textX = slot?.armored ? font(7) : 0;
            const label = addText(slotGroup, '', textX, y(locationLayout.step), {
                size: font(7),
                weight: hittable ? 700 : undefined,
                fill: hittable ? undefined : '#3f3f3f',
            });
            label.setAttribute('data-mekbay-max-width', formatNumber(
                x(locationLayout.rightEdge - locationLayout.textX - 5) - textX - (extraHit ? font(7) : 0)));
            writeMekCriticalSlotLines(label, mekCriticalSlotLines(slot, entity));
            if (slot?.armored) {
                const armorPip = circle(
                    font(2.8),
                    y(locationLayout.step) - font(2.6),
                    font(2.8),
                    'armoredLocPip pip',
                );
                slotGroup.appendChild(armorPip);
            }
            if (extraHit) {
                const extraHitPip = svgElement('rect');
                setAttributes(extraHitPip, {
                    class: 'extraHitPip pip',
                    y: y(locationLayout.step) - font(5.4),
                    width: font(5.6), height: font(5.6),
                });
                positionMekCriticalExtraHitPip(label, extraHitPip);
                slotGroup.appendChild(extraHitPip);
            }
            row.appendChild(slotGroup);
        }
        for (const runs of equipmentRuns.values()) {
            for (const run of runs) {
                if (run.first === run.last) continue;
                const bracket = svgElement('path');
                const top = slotBaseline(run.first) - locationLayout.step * MEK_CRITICAL_BRACKET_TOP;
                setAttributes(bracket, {
                    class: 'critical-equipment-bracket',
                    'data-mekbay-slots': `${run.first} ${run.last}`,
                    d: `M ${formatNumber(x(locationLayout.textX - 1))} ${formatNumber(y(top))}`
                        + ` h ${formatNumber(x(-1.88))}`
                        + ` v ${formatNumber(y(slotBaseline(run.last) - top))} h ${formatNumber(x(1.88))}`,
                    fill: 'none', stroke: '#000', 'stroke-width': font(0.72), 'pointer-events': 'none',
                });
                criticalGroup.appendChild(bracket);
            }
        }
        criticalGroup.setAttribute('data-mekbay-row-slack',
            formatNumber(y(locationLayout.lastBaseline - slotBaseline(slotCount - 1))));
        group.appendChild(criticalGroup);
        flowMekCriticalLocation(criticalGroup);
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
    const capacity = mekSystemDamageDisplayCapacities(entity);
    const systems: readonly [string, string, number, number][] = [
        ['Engine Hits', 'engine_hit_', capacity['engine'], 41.995],
        ['Gyro Hits', 'gyro_hit_', capacity['gyro'], 34.811],
        ['Sensor Hits', 'sensor_hit_', capacity['sensors'], 43.825],
        ['Life Support', 'life_support_hit_', capacity['life-support'], 45.633],
    ];
    systems.forEach(([label, prefix, count, textLength], rowIndex) => {
        const baseline = 12 + rowIndex * 9;
        const labelText = addText(systemGroup, label, x(55.93), y(baseline), {
            size: font(RECORD_SHEET_FONT.section),
            weight: 700,
            anchor: 'end',
        });
        labelText.setAttribute('textLength', formatNumber(x(textLength)));
        labelText.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        for (let index = 0; index < count; index++) {
            const pip = circle(
                x(61.53 + index * Math.min(9.2, 24 / Math.max(1, count - 1))),
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
    const capacity = mekSystemDamageDisplayCapacities(entity);
    const systems: readonly [string, string, number, number][] = [
        ['Avionics Hits', 'avionics_hit_', capacity['avionics'], 47.966],
        ['Engine Hits', 'engine_hit_', capacity['engine'], 41.995],
        ['Gyro Hits', 'gyro_hit_', capacity['gyro'], 34.811],
        ['Sensor Hits', 'sensor_hit_', capacity['sensors'], 43.825],
        ['Landing Gear', 'landing_gear_hit_', capacity['landing-gear'], 49.036],
        ['Life Support', 'life_support_hit_', capacity['life-support'], 45.633],
    ];
    systems.forEach(([label, prefix, count, textLength], rowIndex) => {
        const baseline = 12 + rowIndex * 9;
        const labelText = addText(systemGroup, label, x(59.333), y(baseline), {
            size: font(RECORD_SHEET_FONT.section), weight: 700, anchor: 'end',
        });
        labelText.setAttribute('textLength', formatNumber(x(textLength)));
        labelText.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        for (let index = 0; index < count; index++) {
            const pip = circle(
                x(64.933 + index * Math.min(9.2, 24 / Math.max(1, count - 1))),
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
        size: font(RECORD_SHEET_FONT.section), weight: 700, anchor: 'middle',
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
            fill: '#fff', stroke: '#000', 'stroke-width': font(1.72), 'data-loc': 'SI',
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
    const diagram = await MekPaperdollGenerator.createArmorPaperdoll(
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
        size: RECORD_SHEET_FONT.inventory * fontScale,
        weight: 700,
        anchor: 'middle',
        maxWidth: x(70),
    });
    addText(group, 'Diagram', centerX, y(353), {
        size: RECORD_SHEET_FONT.inventory * fontScale,
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
    const diagram = await MekPaperdollGenerator.createArmorPaperdoll(
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
            { size: RECORD_SHEET_FONT.inventory * fontScale, weight: 700, anchor: 'middle', maxWidth: x(38) },
        ));
    } else {
        addText(group, 'Damage Transfer', x(205.695), y(345), {
            size: RECORD_SHEET_FONT.inventory * fontScale,
            weight: 700,
            anchor: 'middle',
            maxWidth: x(70),
        });
        addText(group, 'Diagram', x(205.695), y(353), {
            size: RECORD_SHEET_FONT.inventory * fontScale,
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
    drawMekHeatDataContents(group, entity, box, entity.chassisConfig === 'LAM' ? 'lam' : 'mek');
    appendMekHeatControls(group, box);
}

function appendMekHeatControls(group: SVGGElement, box: Box): void {
    appendHeatPanelControls(group, {
        x: Math.max(0, box.width - 42),
        y: 35,
        width: 38,
        height: Math.max(12, box.height - 72),
    });
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
}

const STANDARD_HEAT_ROW_BASELINES = [42.711, 50.947, 59.184, 67.421, 75.658, 83.895, 92.132, 100.368,
    108.605, 116.842, 125.079, 133.316, 141.553, 149.789, 158.026, 166.263, 174.5];
const LAM_HEAT_ROW_BASELINES = [37.563, 44.083, 50.604, 57.125, 70.167, 76.688, 83.208, 89.729,
    102.771, 109.292, 115.812, 122.333, 135.375, 141.896, 148.417, 161.458, 167.979];

/** Mek and LAM heat panels share one template; only their row baselines and the AirMech note differ. */
function drawMekHeatDataContents(group: SVGGElement, entity: MekEntity, box: Box, family: 'mek' | 'lam'): void {
    const sx = box.width / 159.5;
    const sy = box.height / 180.5;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);
    const baselines = family === 'lam' ? LAM_HEAT_ROW_BASELINES : STANDARD_HEAT_ROW_BASELINES;
    appendHeatEffectRows(group, recordSheetHeatEffects(family, 0).map((effect, index) => ({
        heat: effect.heat,
        lines: effect.secondaryLabel === undefined ? [effect.label] : [effect.label, effect.secondaryLabel],
        baseline: baselines[index],
        movementModifier: effect.movementModifier,
    })), { x, y, font }, {
        headingBaselines: family === 'lam' ? [24.521, 31.042] : [26.237, 34.474],
        effectsX: 56.4,
        lineHeight: 6.521,
        labelMaxWidth: 91,
    });
    appendHeatSinkData(group, { count: entity.heatSinkCount(), type: entity.heatSinkType() }, { x, y, font },
        { rightX: 152, pipsX: 131.478 });
    if (family === 'lam') {
        addText(group, '(AirMech +3)', x(152), y(37), { size: font(5.8), anchor: 'end', textLength: x(32.291) });
    }
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
    const group = addMekReferenceFrame(svg, 'HIT LOCATION AND CLUSTER TABLE', box);
    group.setAttribute('data-mekbay-reference', 'mek-hit-location-cluster');
    const body = createMekReferenceBody(group, 3, 22.5);
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
        bodyWidth: box.width - 3,
        tableHeight: box.height - 26.5,
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
    });
}

export function drawMekPunchKickPanel(
    svg: SVGSVGElement,
    entity: MekEntity,
    box: Box,
    ruleset: CBTRuleset,
): void {
    const rows = mekPhysicalLocationTableRows(mekHitLocationTable(entity), ruleset).map(row => [
        String(row.roll),
        row.punchLeftSide,
        row.punchFrontRear,
        row.punchRightSide,
        row.kickLeftSide,
        row.kickFrontRear,
        row.kickRightSide,
    ]);
    const group = addMekReferenceFrame(svg, 'PUNCH/KICK LOCATION TABLE', box);
    group.setAttribute('data-mekbay-reference', 'mek-punch-kick');
    const body = createMekReferenceBody(group, 3, 22.5);
    drawMmlReferenceTableBody(body, {
        bodyWidth: box.width - 3,
        tableHeight: box.height - 26.5,
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
    });
}

function addMekReferenceFrame(
    svg: SVGSVGElement,
    title: string,
    box: Box,
): SVGGElement {
    const group = addReferenceTableFrame(svg, title, box);
    group.setAttribute('data-mekbay-region', 'center-panel');
    return group;
}

function createMekReferenceBody(
    group: SVGGElement,
    x: number,
    y: number,
): SVGGElement {
    const body = svgElement('g');
    body.setAttribute('class', 'reference-table-body');
    body.setAttribute(
        'transform',
        `translate(${formatNumber(x)} ${formatNumber(y)})`,
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
}

/** Mirrors MegaMekLab's ReferenceTable vertical and alternating-row layout. */
function drawMmlReferenceTableBody(
    body: SVGGElement,
    options: MmlReferenceTableOptions,
): void {
    const headerLineCount = Math.max(1, ...options.headers.map(header => header.length));
    const noteLineCount = options.notes.reduce(
        (count, note) => count + Math.max(1, note.split('\n').length),
        0,
    );
    const lineCount = headerLineCount + options.rows.length + noteLineCount;
    const rowSpacing = options.tableHeight / (lineCount + 0.5);
    const fontSize = Math.min(5.4, rowSpacing * 5.4 / 7);
    const lineHeight = 7 * fontSize / 5.4;
    const columnWidth = (index: number): number => {
        const left = index === 0
            ? 0
            : (options.columnOffsets[index - 1] + options.columnOffsets[index]) / 2;
        const right = index === options.columnOffsets.length - 1
            ? 1
            : (options.columnOffsets[index] + options.columnOffsets[index + 1]) / 2;
        return Math.max(1, (right - left) * options.bodyWidth - 1);
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
            addReferenceShade(rowGroup, 1, yPosition - fontSize / 3 - rowSpacing / 2, options.bodyWidth - 5, rowSpacing);
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
            addText(body, line, 3, yPosition, {
                size: fontSize,
                class: 'reference-table-note',
                maxWidth: options.bodyWidth - 6,
            });
            yPosition += lineHeight;
        });
        yPosition += rowSpacing - lineHeight;
    });
}
