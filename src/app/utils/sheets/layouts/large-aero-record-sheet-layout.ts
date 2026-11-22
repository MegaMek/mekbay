// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { appendInventoryBadges, appendInventoryRowButtons, fitInventoryText, inventoryRowSpan } from '../inventory-text-layout';
import { aeroValueColumns, fitAeroValueColumns } from './aero-inventory-columns';
import { RECORD_SHEET_FONT } from '../record-sheet-typography';
import { measureSvgTextCanvas } from '../../svg-text.util';
import type { SystemDamageKind } from '../../../models/rules/system-damage-rules';
import { systemDamageControls } from '../../../models/runtime/system-damage-presentation';

import { isMobileHpgEquipment } from '../../../models/aerospace-support-equipment.model';
import { isApolloEquipment } from '../../../models/apollo-mode.model';
import { artemisKind } from '../../../models/artemis-equipment.model';
import type { BaseEntity } from '../../../models/entity/base-entity';
import type { CBTRuleset } from '../../../models/cbt-ruleset.model';
import type { AeroEntity } from '../../../models/entity/entities/aero/aero-entity';
import { SmallCraftEntity } from '../../../models/entity/entities/aero/small-craft-entity';
import { JumpShipEntity } from '../../../models/entity/entities/largecraft/jumpship-entity';
import type { EntityMountedEquipment, EntityMountedWeapon } from '../../../models/entity/types';
import { heatSinkTypeDissipation } from '../../../models/entity/types';
import { isAeroEntity } from '../../../models/entity/utils/entity-type-guards';
import { AmmoEquipment, MiscEquipment, ammoMatchesWeapon } from '../../../models/equipment.model';
import { isPrintableLargeCraftMisc, largeCraftMiscFeatureName } from '../../../models/entity/utils/large-craft-features';
import {
isPpcCapacitorEquipment,
PPC_CAPACITOR_DAMAGE_BONUS,
PPC_CAPACITOR_HEAT_BONUS,
} from '../../../models/ppc-capacitor.model';
import {
ATM_AMMO_PROFILES,
ATM_IMPROVED_MAGNETIC_PULSE_PROFILE,
ATM_STANDARD_PROFILE,
MML_AMMO_PROFILES,
resolveAmmoWeaponProfile,
type AmmoWeaponProfile,
} from '../../../models/ammo-weapon-profile.model';
import { aerospaceAttackValues } from '../../aerospace-range.util';
import { appendDataPanelFooter } from '../record-sheet-embedded-art';
import { recordSheetQuirksText } from '../record-sheet-quirks';
import {
fullRecordSheetLayoutProfile,
recordSheetPageProfile,
type RecordSheetLayoutProfile,
type RecordSheetPageFormat,
} from '../record-sheet-layout';
import {
drawCrewHitGrid,
addFrame,
addLine,
addText,
condenseDataPanelCaption,
valueXAfterCaptions,
drawCriticalDamageBox,
createRoot,
drawGeneratedFooter,
drawHeatScale,
drawNotesPanel,
drawPageChrome,
formatNumber,
formatWholeNumber,
recordSheetAmmoProfiles,
recordSheetWeaponArtemis,
scalePageBox,
setInventoryComponentIds,
svgElement,
wrapRecordSheetText,
type Box,
} from '../record-sheet-svg-rendering';
import {
aeroBayRowLines,
aeroCargoLines,
aeroRowRangeValues,
appendAeroBayRowText,
appendAeroDataPanelHeader,
drawAeroDiagramHeader,
appendAeroSkillRows,
drawAeroArtworkRegion,
drawAeroDataPanel,
drawAeroMovementCompass,
drawAeroPaperdoll,
aeroPageBox,
AERO_LOWER_PANEL_BOX,
AERO_LOWER_PANEL_TAB_NOTCH,
drawAeroVelocityPanel,
AERO_BAY_CONTINUATION_X,
AERO_BAY_NAME_X,
type AeroBayColumns,
type AeroBayMunitionLine,
type AeroBayRow,
type AeroDataInventoryRow,
} from './aero-record-sheet-components';
import {
planLargeAeroRecordSheetPages,
type LargeAeroRecordSheetBlock,
type LargeAeroRecordSheetPagePlan,
} from './large-aero-record-sheet-page-plan';
import {
createLargeAeroAdvancedMovementReferenceArt,
createLargeAeroReverseMovementCompassArt,
createLargeAeroVelocityRecordArt,
} from './large-aero-reverse-reference-art';
import type { RecordSheetLayout,RecordSheetLayoutRequest } from './record-sheet-layout';

function isCapitalAeroVessel(entity: AeroEntity): boolean {
    return entity.entityType === 'JumpShip'
        || entity.entityType === 'WarShip'
        || entity.entityType === 'SpaceStation';
}

/** Shared bay tables, reverse-page planning and vessel composition for DropShips and capital ships. */
export abstract class LargeAeroRecordSheetLayout implements RecordSheetLayout {
    public abstract readonly id: string;
    public abstract matches(entity: BaseEntity): boolean;
    protected abstract sheetTitle(entity: AeroEntity): string;
    protected abstract dataPanelTitle(entity: AeroEntity): string;
    protected abstract paperdollAsset(entity: AeroEntity): string;

    public profile(
        entity: BaseEntity,
        pageFormat: RecordSheetPageFormat = 'letter',
    ): RecordSheetLayoutProfile {
        if (!this.matches(entity)) {
            throw new Error('Large-aero layout requires a large aerospace vessel');
        }
        return fullRecordSheetLayoutProfile(pageFormat);
    }

    public async generate(
        entity: BaseEntity,
        request: RecordSheetLayoutRequest,
    ): Promise<SVGSVGElement> {
        if (!isAeroEntity(entity) || !this.matches(entity)) {
            throw new Error('Large-aero layout requires a large aerospace vessel');
        }
        return this.generatePrimaryPage(entity, request, largeAeroPageContent(entity, request.showQuirks));
    }

    public async generatePages(
        entity: BaseEntity,
        request: RecordSheetLayoutRequest,
    ): Promise<readonly SVGSVGElement[]> {
        if (!isAeroEntity(entity) || !this.matches(entity)) {
            throw new Error('Large-aero layout requires a large aerospace vessel');
        }
        const content = largeAeroPageContent(entity, request.showQuirks);
        const primary = await this.generatePrimaryPage(entity, request, content);
        return content.plan.pageCount === 1
            ? Object.freeze([primary])
            : Object.freeze([primary, this.generateReversePage(entity, request, content)]);
    }

    private async generatePrimaryPage(
        entity: AeroEntity,
        request: RecordSheetLayoutRequest,
        content: LargeAeroPageContent,
    ): Promise<SVGSVGElement> {
        const page = request.page;
        const svg = createRoot(page.width, page.height, entity.entityType.toLowerCase());
        const at = (box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }) =>
            aeroPageBox(page, box);
        const capital = isCapitalAeroVessel(entity);

        drawPageChrome(svg, this.sheetTitle(entity), page, false);
        const dataPanelHeight = 420.257;
        const dataPanelBox = at({
            x: 18.966,
            y: 87.857,
            width: 222.4,
            height: dataPanelHeight + page.height - recordSheetPageProfile().height,
        });
        if (capital || content.plan.pageCount > 1 || content.capitalRows.length > 0) {
            drawCapitalAeroDataPanel(svg, entity, dataPanelBox, content, request.ruleset);
        } else {
            drawAeroDataPanel(svg, entity, dataPanelBox, dataPanelHeight, {
                panelTitle: this.dataPanelTitle(entity),
                identity: 'large-vessel',
                inventoryRows: () => this.standardBayInventoryRows(entity),
                flowCargoAfterInventory: true,
                showAmmoSummary: false,
                showQuirks: request.showQuirks,
                ruleset: request.ruleset,
                featureText: capitalAeroFeatures(entity),
            });
        }
        await drawAeroPaperdoll(svg, entity, at({
            x: 249.651,
            y: 18,
            width: 344,
            height: 450,
        }), 450, {
            assetUrl: this.paperdollAsset(entity),
            capitalFallback: capital,
            // Capital armor and integrity tracks always use square tables.
            pipLayout: capital ? 'capital-grid' : request.pipLayout,
        });
        drawAeroDiagramHeader(svg, page, 'vessel', capital ? 'Capital Scale' : 'Standard Scale');
        drawAeroMovementCompass(svg, at({ x: 249.651, y: 456.4, width: 90, height: 50 }));
        if (entity.entityType === 'SpaceStation') {
            const upperNotes = at({ x: 18.966, y: 509.4, width: 220.4, height: 93.934 });
            drawNotesPanel(svg, upperNotes, upperNotes.width * AERO_LOWER_PANEL_TAB_NOTCH);
            drawNotesPanel(svg, at(AERO_LOWER_PANEL_BOX));
        } else {
            drawAeroArtworkRegion(svg, at({ x: 43, y: 510, width: 193, height: 84.72 }));
            drawAeroVelocityPanel(svg, at(AERO_LOWER_PANEL_BOX));
        }
        drawLargeAeroPilotPanel(svg, entity, at({ x: 252.366, y: 509.4, width: 142.6, height: 93.934 }));
        drawLargeAeroCriticalPanel(svg, entity, at({ x: 405.966, y: 509.4, width: 180.5, height: 166.104 }));
        drawLargeAeroHeatPanel(svg, entity, at({ x: 405.966, y: 675.29, width: 180.5, height: 79.71 }));
        if (entity.tracksHeat()) {
            drawHeatScale(svg, at({ x: 574, y: 388.911, width: 19.454, height: 366 }), 'aero');
        }
        const catalyst = at({ x: 527.13, y: 59.25, width: 0, height: 0 });
        drawGeneratedFooter(svg, page, { catalystX: catalyst.x, catalystY: catalyst.y, catalystScale: 1.015 });
        return svg;
    }

    private generateReversePage(
        entity: AeroEntity,
        request: RecordSheetLayoutRequest,
        content: LargeAeroPageContent,
    ): SVGSVGElement {
        const page = request.page;
        const svg = createRoot(page.width, page.height, `${entity.entityType.toLowerCase()}-reverse`);
        svg.setAttribute('data-mekbay-partial-sheet', '1');
        drawPageChrome(svg, `${this.sheetTitle(entity)} (REVERSE)`, page, false);
        drawLargeAeroReverseMovementCompass(svg, scalePageBox(page, {
            x: 405,
            y: 21,
            width: 182.5,
            height: 71.571,
        }));
        drawLargeAeroReverseDataPanel(svg, entity, scalePageBox(page, {
            x: 18.966,
            y: 90.857,
            width: 278.5,
            height: 662.643,
        }), content);
        drawAdvancedMovementReference(svg, scalePageBox(page, {
            x: 306,
            y: 90.857,
            width: 281.5,
            height: 328.072,
        }));
        drawLargeAeroReverseVelocityRecord(svg, scalePageBox(page, {
            x: 306,
            y: 428.428,
            width: 284.5,
            height: 325.072,
        }));
        drawGeneratedFooter(svg, page);
        return svg;
    }

    /** The single-page DropShip panel prints the same bay rows as the capital panel. */
    private standardBayInventoryRows(entity: AeroEntity): readonly AeroDataInventoryRow[] {
        return largeAeroBayRows(entity, 'standard').map((row, index) => ({
            id: `bay_${index + 1}`,
            kind: 'bay',
            nameLines: row.nameLines,
            location: row.location,
            heat: row.heat,
            damageByRange: row.damageByRange,
            componentIds: row.componentIds,
            munitionLines: row.munitionLines,
            ...(row.footnote === undefined ? {} : { footnote: row.footnote }),
        }));
    }
}

interface CapitalAeroInventoryRow extends AeroBayRow {
    readonly configurationKey: string;
    readonly munitionLines: readonly AeroBayMunitionLine[];
    readonly componentIds: readonly string[];
    readonly sortOrder: number;
    readonly rearMounted: boolean;
    readonly footnote?: string;
}

/** One printed row represents equal opposite bays, retaining both sets of mount controls. */
function condenseSymmetricAeroBays(bays: readonly CapitalAeroInventoryRow[]): readonly CapitalAeroInventoryRow[] {
    const opposites: Readonly<Record<string, string>> = {
        LS: 'RS', RS: 'LS', FLS: 'FRS', FRS: 'FLS', LW: 'RW', RW: 'LW',
        LBS: 'RBS', RBS: 'LBS', ALS: 'ARS', ARS: 'ALS',
    };
    const signature = (bay: CapitalAeroInventoryRow): string => JSON.stringify({
        nameLines: bay.nameLines,
        heat: bay.heat,
        damageByRange: bay.damageByRange,
        munitionLines: bay.munitionLines,
        rearMounted: bay.rearMounted,
        footnote: bay.footnote,
        configurationKey: bay.configurationKey,
    });
    const consumed = new Set<number>();
    const result: CapitalAeroInventoryRow[] = [];
    for (let index = 0; index < bays.length; index++) {
        if (consumed.has(index)) continue;
        const bay = bays[index];
        const opposite = opposites[bay.location];
        const match = opposite ? bays.findIndex((candidate, candidateIndex) =>
            candidateIndex > index && !consumed.has(candidateIndex)
            && candidate.location === opposite && signature(candidate) === signature(bay)) : -1;
        if (match < 0) {
            result.push(bay);
            continue;
        }
        consumed.add(match);
        // The shared row names its arcs in inventory order (FLS/FRS) and takes the first one's place
        const [first, second] = [bay, bays[match]].sort((left, right) => left.sortOrder - right.sortOrder);
        result.push({
            ...first,
            location: `${first.location}/${second.location}`,
            componentIds: [...first.componentIds, ...second.componentIds],
        });
    }
    return result.sort((left, right) => left.sortOrder - right.sortOrder);
}

interface LargeAeroPageContent {
    readonly capitalRows: readonly CapitalAeroInventoryRow[];
    readonly standardRows: readonly CapitalAeroInventoryRow[];
    readonly gravDecks: readonly number[];
    readonly cargoLines: readonly string[];
    readonly footerText: { readonly fuel: string; readonly features: string; readonly quirks: string };
    readonly plan: LargeAeroRecordSheetPagePlan;
}

function largeAeroPageContent(entity: AeroEntity, showQuirks: boolean | undefined): LargeAeroPageContent {
    const capitalRows = largeAeroBayRows(entity, 'capital');
    const standardRows = largeAeroBayRows(entity, 'standard');
    const gravDecks = entity instanceof JumpShipEntity ? entity.gravDecks() : [];
    const cargoLines = aeroCargoLines(entity);
    const plan = planLargeAeroRecordSheetPages({
        capitalWeaponLines: plannedBayLines(capitalRows, false),
        standardWeaponLines: plannedBayLines(standardRows, true),
        hasAr10: entity.rangedWeapons().some(mount => mount.equipment.ammoType === 'AR10'),
        gravDeckCount: gravDecks.length,
        transportBayLines: cargoLines.length,
    });
    const features = capitalAeroFeatures(entity);
    const footerText = Object.freeze({
        fuel: `Fuel Points: ${formatWholeNumber(entity.fuel())}`,
        features: features ? `Features ${features}` : '',
        quirks: recordSheetQuirksText(entity, showQuirks),
    });
    return Object.freeze({ capitalRows, standardRows, gravDecks, cargoLines, footerText, plan });
}

/** Each bay row's lines, its munition lines included, at `fontSize` in column units. */
function inventoryRowLines(rows: readonly CapitalAeroInventoryRow[], fontSize: number,
    columns: LargeAeroInventoryColumns): readonly number[] {
    return rows.map(row => aeroBayRowLines(row, columns, fontSize, width => width).lines);
}

/** A page's inventory columns, widened so its printed locations, heat and damage fit on one line at `fontSize`. */
function fittedInventoryColumns(columns: LargeAeroInventoryColumns, content: LargeAeroPageContent,
    blocks: ReadonlySet<LargeAeroRecordSheetBlock>, fontSize: number): LargeAeroInventoryColumns {
    const rows = [
        ...(blocks.has('capital-weapons') ? content.capitalRows : []),
        ...(blocks.has('standard-weapons') ? content.standardRows : []),
    ];
    return fitAeroValueColumns(columns, {
        locations: rows.map(row => row.location),
        heats: rows.map(row => row.heat),
        damage: rows.flatMap(aeroRowRangeValues),
    }, fontSize);
}

/** Weapon rows carrying to-hit badges in the given blocks, for the fit's badge leading: one per bay row. */
function largeAeroBadgeRows(content: LargeAeroPageContent, blocks: ReadonlySet<LargeAeroRecordSheetBlock>,
    fontSize: number, columns: LargeAeroInventoryColumns): readonly number[] {
    return [
        ...(blocks.has('capital-weapons') ? inventoryRowLines(content.capitalRows, fontSize, columns) : []),
        ...(blocks.has('standard-weapons') ? inventoryRowLines(content.standardRows, fontSize, columns) : []),
    ];
}

function inventoryLineCount(rows: readonly CapitalAeroInventoryRow[], includeFootnotes: boolean, fontSize: number,
    columns: LargeAeroInventoryColumns): number {
    const entries = inventoryRowLines(rows, fontSize, columns).reduce((sum, lines) => sum + lines, 0);
    return entries + (includeFootnotes ? bayFootnoteCount(rows) : 0);
}

/**
 * A bay table's lines as MegaMekLab plans its pages (`InventoryWriter.standardBayLines`): one per weapon name and
 * munition line, before wrapping. The font fit then absorbs the wrapped lines, so a sheet MegaMekLab prints on one page
 * stays on one.
 */
function plannedBayLines(rows: readonly CapitalAeroInventoryRow[], includeFootnotes: boolean): number {
    return rows.reduce((sum, row) => sum + row.nameLines.length + row.munitionLines.length, 0)
        + (includeFootnotes ? bayFootnoteCount(rows) : 0);
}

function bayFootnoteCount(rows: readonly CapitalAeroInventoryRow[]): number {
    return new Set(rows.map(row => row.footnote).filter((note): note is string => Boolean(note))).size;
}

function drawCapitalAeroDataPanel(
    svg: SVGSVGElement,
    entity: AeroEntity,
    box: Box,
    content: LargeAeroPageContent,
    ruleset: CBTRuleset,
): SVGGElement {
    const frameOptions = { bottomLeftNotchWidth: box.width * 0.36, cornerAngleDegrees: { topRight: 0, bottomLeft: 45 } };
    const group = addFrame(svg, capitalAeroDataPanelTitle(entity), box, frameOptions);
    group.setAttribute('data-mekbay-region', 'aero-data');
    const firstScale = content.plan.front.has('capital-weapons') ? 'capital' : 'standard';
    group.setAttribute('data-mekbay-aero-scale', firstScale);
    // Keep the authored columns inside the frame's right border and padding.
    const sx = (box.width - 6) / 222.4;
    const sy = box.height / 420.257;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * box.width / 222.4;

    const stationary = entity.entityType === 'JumpShip' || entity.entityType === 'SpaceStation';
    appendAeroDataPanelHeader(group, entity, { x, y, font }, 'large-vessel', stationary);

    const inventoryOffset = stationary ? -7.339 : 0;
    const inventoryY = (value: number): number => y(value + inventoryOffset);
    addLine(group, x(3), inventoryY(69), x(219.4), inventoryY(69), '#000', 1.932 * Math.min(sx, sy));
    addText(group, 'Weapons & Equipment Inventory', x(3), inventoryY(79), {
        size: font(RECORD_SHEET_FONT.section), weight: 700,
    });
    // Sized at the largest inventory font, in column units, so the values also fit at any smaller fitted font.
    const columns = fittedInventoryColumns(FRONT_INVENTORY_COLUMNS, content, content.plan.front,
        RECORD_SHEET_FONT.inventory * font(1) / x(1));
    // Text is measured at the font it is drawn with against the column widths it is drawn in, so no cell wraps unseen
    const drawnFont = (fontSize: number) => fontSize * font(1) / x(1);
    const metrics = fitInventoryText(282, fontSize => ({
        lineCount: largeAeroBlockLineCount(content, content.plan.front, drawnFont(fontSize), columns)
            + (content.plan.reverse.has('standard-weapons') ? 2 : 0),
        badgeRows: largeAeroBadgeRows(content, content.plan.front, drawnFont(fontSize), columns), content: undefined }));
    const rowStep = metrics.lineStep;
    const inventoryFont = (size: number) => font(size * metrics.fontSize / RECORD_SHEET_FONT.inventory);
    const geometry: LargeAeroInventoryGeometry = {
        group, x, y: inventoryY, font: inventoryFont, rowStep, lineHeight: y(rowStep),
        fontSize: drawnFont(metrics.fontSize), badgeScale: font(1), badgeHeight: metrics.badgeHeight,
        headingOffset: rowStep, firstRowOffset: rowStep * 2, columns,
    };
    let detailY = 89.8;
    detailY = drawLargeAeroBlocks(geometry, content, content.plan.front, detailY, 'front');
    if (content.plan.reverse.has('standard-weapons')) {
        addText(group, 'Standard Scale on Reverse', x(7.328), inventoryY(detailY), {
            size: font(RECORD_SHEET_FONT.inventory), weight: 700,
        });
    }

    if (content.plan.front.has('footer')) {
        const footer = largeAeroFooterLines(content, geometry);
        const fuelBaseline = stationary ? 393.454 : 376.854;
        // Bottom-anchored like MegaMekLab's footer block: quirk rows lift fuel and features.
        drawLargeAeroFooter(geometry, footer, fuelBaseline - Math.max(0, footer.length - 2) * rowStep);
    }
    appendDataPanelFooter(svg, group, { battleValue: entity.battleValue(ruleset), year: entity.year() },
        { height: box.height, options: frameOptions }, { x, font }, x(219.4));
    return group;
}

interface LargeAeroInventoryColumns extends AeroBayColumns {
    readonly sectionX: number;
    readonly quantityHeaderX: number;
    readonly typeHeaderX: number;
    readonly mainButtonWidth: number;
    readonly gravDeckSecondColumnX: number;
    readonly gravDeckColumnWidth: number;
    readonly cargoMaxWidth: number;
}

const FRONT_VALUE_COLUMNS = aeroValueColumns(AERO_BAY_NAME_X);
const FRONT_INVENTORY_COLUMNS: LargeAeroInventoryColumns = Object.freeze({
    ...FRONT_VALUE_COLUMNS,
    sectionX: 7.328,
    quantityHeaderX: 8.41,
    typeHeaderX: 13.82,
    nameX: AERO_BAY_NAME_X,
    continuationX: AERO_BAY_CONTINUATION_X,
    // The row's main target spans name, location and heat, up to the range brackets.
    mainButtonWidth: FRONT_VALUE_COLUMNS.heatX + FRONT_VALUE_COLUMNS.heatMaxWidth / 2 - 3,
    gravDeckSecondColumnX: 110.328,
    gravDeckColumnWidth: 99,
    cargoMaxWidth: 205,
});

const REVERSE_INVENTORY_COLUMNS: LargeAeroInventoryColumns = Object.freeze({
    sectionX: 8.42,
    quantityHeaderX: 9.775,
    typeHeaderX: 16.55,
    nameX: 8.42,
    continuationX: 13.84,
    locationX: 135.79,
    heatX: 165.6,
    rangeX: [189.99, 211.67, 233.35, 255.03] as const,
    nameMaxWidth: 105,
    locationMaxWidth: 28,
    heatMaxWidth: 12,
    rangeMaxWidth: 20.68,
    mainButtonWidth: 177,
    gravDeckSecondColumnX: 143.92,
    gravDeckColumnWidth: 130,
    cargoMaxWidth: 262,
});

interface LargeAeroInventoryGeometry {
    readonly group: SVGGElement;
    readonly x: (value: number) => number;
    readonly y: (value: number) => number;
    readonly font: (value: number) => number;
    readonly rowStep: number;
    /** `rowStep` on the sheet; `y` places lines, and on a station's front page also shifts them. */
    readonly lineHeight: number;
    /** The fitted inventory type size in column units, as its text is drawn, so the footer wraps as the fit did. */
    readonly fontSize: number;
    readonly badgeScale: number;
    /** The badge height the rows were fitted with (`fitInventoryText`), which spaces them. */
    readonly badgeHeight: number;
    readonly headingOffset: number;
    readonly firstRowOffset: number;
    readonly columns: LargeAeroInventoryColumns;
}

function drawLargeAeroBlocks(
    geometry: LargeAeroInventoryGeometry,
    content: LargeAeroPageContent,
    blocks: ReadonlySet<LargeAeroRecordSheetBlock>,
    startY: number,
    pageRole: 'front' | 'reverse',
): number {
    let currentY = startY;
    if (blocks.has('capital-weapons')) {
        currentY = drawLargeAeroInventoryTable(geometry, content.capitalRows, 'capital', currentY, pageRole);
    }
    if (blocks.has('ar10-munitions')) currentY = drawAr10Munitions(geometry, currentY);
    if (blocks.has('standard-weapons')) {
        currentY = drawLargeAeroInventoryTable(geometry, content.standardRows, 'standard', currentY, pageRole);
    }
    if (blocks.has('grav-decks')) currentY = drawGravDecks(geometry, content.gravDecks, currentY);
    if (blocks.has('transport-bays')) currentY = drawCargo(geometry, content.cargoLines, currentY);
    if (blocks.has('footer') && pageRole === 'reverse') {
        const footer = largeAeroFooterLines(content, geometry);
        drawLargeAeroFooter(geometry, footer, currentY);
        currentY += geometry.rowStep * Math.max(2, footer.length);
    }
    return currentY;
}

function drawLargeAeroInventoryTable(
    geometry: LargeAeroInventoryGeometry,
    rows: readonly CapitalAeroInventoryRow[],
    scale: 'capital' | 'standard',
    startY: number,
    pageRole: 'front' | 'reverse',
): number {
    if (rows.length === 0) return startY;
    const { group, x, y, font, rowStep, lineHeight, headingOffset, firstRowOffset, columns } = geometry;
    const textSize = RECORD_SHEET_FONT.inventory;
    addText(group, scale === 'capital' ? 'Capital Scale' : 'Standard Scale', x(columns.sectionX), y(startY), {
        size: font(textSize), weight: 700,
    });
    const rangeHeadings = scale === 'capital'
        ? ['(1-12)', '(13-24)', '(25-40)', '(41-50)']
        : ['(1-6)', '(7-12)', '(13-20)', '(21-25)'];
    rangeHeadings.forEach((label, index) => addText(group, label, x(columns.rangeX[index]), y(startY), {
        size: font(Math.min(5.8, textSize)), anchor: 'middle', maxWidth: x(columns.rangeMaxWidth),
    }));
    const headings: readonly [string, number, 'start' | 'middle'][] = scale === 'capital'
        ? [['Bay', columns.sectionX, 'start'], ['Loc', columns.locationX, 'middle'], ['Ht', columns.heatX, 'middle'],
            ['SRV', columns.rangeX[0], 'middle'], ['MRV', columns.rangeX[1], 'middle'],
            ['LRV', columns.rangeX[2], 'middle'], ['ERV', columns.rangeX[3], 'middle']]
        : [['#', columns.quantityHeaderX, 'middle'], ['Type', columns.typeHeaderX, 'start'],
            ['Loc', columns.locationX, 'middle'], ['Ht', columns.heatX, 'middle'],
            ['SRV', columns.rangeX[0], 'middle'], ['MRV', columns.rangeX[1], 'middle'],
            ['LRV', columns.rangeX[2], 'middle'], ['ERV', columns.rangeX[3], 'middle']];
    headings.forEach(([label, position, anchor]) => addText(group, label, x(position), y(startY + headingOffset), {
        size: font(textSize), weight: 700, anchor,
    }));
    let displayLine = 0;
    rows.forEach((row, index) => {
        const lines = aeroBayRowLines(row, columns, font(textSize), x);
        // The row is one block under one badge, as the fit counts it; its buttons span the munition lines too
        const span = inventoryRowSpan(lines.lines, rowStep, geometry.badgeHeight);
        const baseline = y(startY + firstRowOffset + displayLine * rowStep);
        const entry = svgElement('g');
        entry.setAttribute('class', 'inventoryEntry bay');
        entry.id = `${pageRole}_${scale}_bay_${index + 1}`;
        setInventoryComponentIds(entry, row.componentIds);
        appendInventoryRowButtons(entry, baseline, geometry.badgeScale, lineHeight, span,
            [x(3), x(columns.mainButtonWidth)],
            columns.rangeX.map((position, rangeIndex) => [
                ['shrButton', 'medButton', 'lngButton', 'extButton'][rangeIndex],
                x(position - columns.rangeMaxWidth / 2), x(columns.rangeMaxWidth),
            ] as const));
        appendInventoryBadges(entry, baseline, geometry.badgeScale, lineHeight);
        appendAeroBayRowText(entry, row, columns, lines, { x, baseline, lineHeight, fontSize: font(textSize) });
        group.appendChild(entry);
        displayLine += span;
    });
    let nextY = startY + firstRowOffset + displayLine * rowStep;
    if (scale === 'standard') {
        const footnotes = [...new Set(rows.map(row => row.footnote).filter((note): note is string => Boolean(note)))];
        footnotes.forEach(note => {
            addText(group, note, x(columns.sectionX), y(nextY), { size: font(textSize) });
            nextY += rowStep;
        });
    }
    return nextY + rowStep;
}

function drawAr10Munitions(geometry: LargeAeroInventoryGeometry, startY: number): number {
    const { group, x, y, font, rowStep, columns } = geometry;
    const textSize = RECORD_SHEET_FONT.inventory;
    addText(group, 'AR10 Munitions', x(columns.sectionX), y(startY), { size: font(textSize), weight: 700 });
    const valueColumns = [columns.locationX, columns.heatX, ...columns.rangeX];
    ['Tons', 'Ht', 'SRV', 'MRV', 'LRV', 'ERV'].forEach((label, index) => addText(
        group, label, x(valueColumns[index]), y(startY + rowStep),
        { size: font(textSize), weight: 700, anchor: 'middle' },
    ));
    const rows: readonly [string, string, string, string][] = [
        ['Killer Whale', '50', '20', '4'],
        ['White Shark', '40', '15', '3'],
        ['Barracuda', '30', '10', '2'],
    ];
    rows.forEach(([name, tons, heat, damage], index) => {
        const baseline = startY + rowStep * (index + 2);
        addText(group, name, x(columns.sectionX), y(baseline), { size: font(textSize) });
        [tons, heat, damage, damage, damage, damage].forEach((value, column) => addText(
            group, value, x(valueColumns[column]), y(baseline), { size: font(textSize), anchor: 'middle' },
        ));
    });
    return startY + rowStep * 6;
}

function drawGravDecks(
    geometry: LargeAeroInventoryGeometry,
    gravDecks: readonly number[],
    startY: number,
): number {
    if (gravDecks.length === 0) return startY;
    const { group, x, y, font, rowStep, columns } = geometry;
    const textSize = RECORD_SHEET_FONT.inventory;
    addText(group, 'Grav Decks:', x(columns.sectionX), y(startY), { size: font(textSize), weight: 700 });
    const rows = Math.ceil(gravDecks.length / 2);
    gravDecks.forEach((diameter, index) => {
        const column = index >= rows ? 1 : 0;
        const row = column === 0 ? index : index - rows;
        addText(group, `Grav Deck #${index + 1}: ${formatWholeNumber(diameter)}-meters`,
            x(column === 0 ? columns.sectionX : columns.gravDeckSecondColumnX),
            y(startY + rowStep * (row + 1)), {
                size: font(textSize), maxWidth: x(columns.gravDeckColumnWidth),
            });
    });
    return startY + rowStep * (rows + 2);
}

function drawCargo(
    geometry: LargeAeroInventoryGeometry,
    cargoLines: readonly string[],
    startY: number,
): number {
    if (cargoLines.length === 0) return startY;
    const { group, x, y, font, rowStep, columns } = geometry;
    const textSize = RECORD_SHEET_FONT.inventory;
    addText(group, 'Cargo:', x(columns.sectionX), y(startY), { size: font(textSize), weight: 700 });
    cargoLines.forEach((line, index) => addText(group, line, x(columns.sectionX), y(startY + rowStep * (index + 1)), {
        size: font(textSize), maxWidth: x(columns.cargoMaxWidth),
    }));
    return startY + rowStep * (cargoLines.length + 2);
}

/**
 * MegaMekLab's footer block: fuel, features, then italic quirks at 90% type; fuel and features keep two rows. The fit
 * and the drawing wrap the quirks alike, at the type size the footer prints in (`fontSize`, in column units).
 */
function largeAeroFooterLines(
    content: LargeAeroPageContent,
    { fontSize, columns }: Pick<LargeAeroInventoryGeometry, 'fontSize' | 'columns'>,
): readonly { readonly text: string; readonly quirk: boolean }[] {
    const { fuel, features, quirks } = content.footerText;
    return [
        { text: fuel, quirk: false },
        ...(features ? [{ text: features, quirk: false }] : []),
        ...wrapRecordSheetText(quirks, columns.cargoMaxWidth, fontSize * 0.9).map(text => ({ text, quirk: true })),
    ];
}

function drawLargeAeroFooter(
    { group, x, y, font, rowStep, columns }: LargeAeroInventoryGeometry,
    lines: ReturnType<typeof largeAeroFooterLines>,
    firstBaseline: number,
): void {
    const textSize = RECORD_SHEET_FONT.inventory;
    const quirks = svgElement('g');
    quirks.setAttribute('class', 'unitQuirks');
    lines.forEach(({ text, quirk }, index) => {
        const line = addText(quirk ? quirks : group, text, x(8.41), y(firstBaseline + index * rowStep), {
            size: font(quirk ? textSize * 0.9 : textSize), maxWidth: x(columns.cargoMaxWidth),
        });
        if (quirk) line.setAttribute('font-style', 'italic');
    });
    if (quirks.hasChildNodes()) group.appendChild(quirks);
}

function largeAeroBlockLineCount(
    content: LargeAeroPageContent,
    blocks: ReadonlySet<LargeAeroRecordSheetBlock>,
    fontSize: number,
    columns: LargeAeroInventoryColumns,
): number {
    let count = 0;
    if (blocks.has('capital-weapons')) count += inventoryLineCount(content.capitalRows, false, fontSize, columns) + 3;
    if (blocks.has('ar10-munitions')) count += 5;
    if (blocks.has('standard-weapons')) count += inventoryLineCount(content.standardRows, true, fontSize, columns) + 3;
    if (blocks.has('grav-decks')) count += Math.ceil(content.gravDecks.length / 2) + 2;
    if (blocks.has('transport-bays')) count += content.cargoLines.length + 2;
    if (blocks.has('footer')) count += Math.max(2, largeAeroFooterLines(content, { fontSize, columns }).length);
    return count;
}

function capitalAeroDataPanelTitle(entity: AeroEntity): string {
    switch (entity.entityType) {
        case 'DropShip': return 'DROPSHIP DATA';
        case 'JumpShip': return 'JUMPSHIP DATA';
        case 'WarShip': return 'WARSHIP DATA';
        case 'SpaceStation': return 'STATION DATA';
        default: return 'VESSEL DATA';
    }
}

function drawLargeAeroReverseMovementCompass(svg: SVGSVGElement, box: Box): void {
    const group = createLargeAeroReverseMovementCompassArt();
    appendLargeAeroReverseReferenceArt(
        svg,
        group,
        box,
        { x: 387, y: 3, width: 182.5, height: 71.571 },
        'advanced-movement-compass',
    );
}

function drawLargeAeroReverseDataPanel(
    svg: SVGSVGElement,
    entity: AeroEntity,
    box: Box,
    content: LargeAeroPageContent,
): void {
    const group = addFrame(
        svg,
        `${capitalAeroDataPanelTitle(entity)} (Cont.)`,
        box,
        {
            headerWidth: 93.209,
            headerHeight: 10,
            headerFontSize: 10.6,
            headerAngleDegrees: 56.31,
            cornerAngleDegrees: { topLeft: 56.31, topRight: 45, bottomRight: 45, bottomLeft: 45 },
        },
    );
    group.setAttribute('data-mekbay-region', 'aero-data-continuation');
    const sx = box.width / 278.5;
    const sy = box.height / 662.643;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);
    const typeCaption = condenseDataPanelCaption(addText(group, 'Type:', x(6), y(28), { size: font(9.67), weight: 700 }));
    const type = addText(group, entity.displayName(), valueXAfterCaptions([typeCaption]), y(28), {
        size: font(9.67), weight: 700, maxWidth: x(238),
    });
    type.id = 'type';
    const name = valueXAfterCaptions([condenseDataPanelCaption(addText(group, 'Name:', x(3), y(38), { size: font(9.67), weight: 700 }))]);
    const fluffName = addText(group, '', name, y(38), { size: font(9.67), maxWidth: x(126.913) - name });
    fluffName.id = 'fluffName';
    addLine(group, name, y(39), x(126.913), y(39), '#000', 0.72 * Math.min(sx, sy));
    addLine(group, x(3), y(43), x(274), y(43), '#000', 1.932 * Math.min(sx, sy));
    addText(group, 'Weapons & Equipment Inventory', x(3), y(53), {
        size: font(RECORD_SHEET_FONT.section), weight: 700,
    });
    const columns = fittedInventoryColumns(REVERSE_INVENTORY_COLUMNS, content, content.plan.reverse,
        RECORD_SHEET_FONT.inventory * font(1) / x(1));
    const drawnFont = (fontSize: number) => fontSize * font(1) / x(1);
    const metrics = fitInventoryText(570, fontSize => ({
        lineCount: largeAeroBlockLineCount(content, content.plan.reverse, drawnFont(fontSize), columns),
        badgeRows: largeAeroBadgeRows(content, content.plan.reverse, drawnFont(fontSize), columns), content: undefined }));
    const rowStep = metrics.lineStep;
    const inventoryFont = (size: number) => font(size * metrics.fontSize / RECORD_SHEET_FONT.inventory);
    const compressed = rowStep / 9.126;
    const geometry: LargeAeroInventoryGeometry = {
        group, x, y, font: inventoryFont, rowStep, lineHeight: y(rowStep), fontSize: drawnFont(metrics.fontSize),
        badgeScale: Math.min(sx, sy), badgeHeight: metrics.badgeHeight, headingOffset: 10.8 * compressed,
        firstRowOffset: 20.7 * compressed, columns,
    };
    drawLargeAeroBlocks(geometry, content, content.plan.reverse, 63.8, 'reverse');
}

function drawAdvancedMovementReference(svg: SVGSVGElement, box: Box): void {
    const group = createLargeAeroAdvancedMovementReferenceArt();
    appendLargeAeroReverseReferenceArt(
        svg,
        group,
        box,
        { x: 288, y: 72.857, width: 281.5, height: 328.072 },
        'advanced-aerospace-movement',
        'data-mekbay-reference',
    );
}

function drawLargeAeroReverseVelocityRecord(svg: SVGSVGElement, box: Box): void {
    const group = createLargeAeroVelocityRecordArt();
    appendLargeAeroReverseReferenceArt(
        svg,
        group,
        box,
        { x: 288, y: 410.428, width: 284.5, height: 325.072 },
        'advanced-velocity-record',
    );
}

function appendLargeAeroReverseReferenceArt(
    svg: SVGSVGElement,
    group: SVGGElement,
    box: Box,
    source: Box,
    region: string,
    regionAttribute = 'data-mekbay-region',
): void {
    const scale = Math.min(box.width / source.width, box.height / source.height);
    const wrapper = svgElement('g');
    wrapper.setAttribute(regionAttribute, region);
    wrapper.setAttribute(
        'transform',
        `translate(${formatNumber(box.x - source.x * scale)} ${formatNumber(box.y - source.y * scale)}) scale(${formatNumber(scale)})`,
    );
    wrapper.appendChild(group);
    svg.appendChild(wrapper);
}

/**
 * One row per weapon bay, its weapons in unit-file order, each with its ammo; equal opposite bays share a row.
 * Both large-craft panels print these rows.
 */
function largeAeroBayRows(
    entity: AeroEntity,
    scale: 'capital' | 'standard',
): readonly CapitalAeroInventoryRow[] {
    const rows: CapitalAeroInventoryRow[] = [];
    const capitalScale = scale === 'capital';
    for (const bay of entity.equipmentBays()) {
        if (bay.kind !== 'weapon-bay') continue;
        const weapons = bay.weapons.filter(mount =>
            (mount.equipment.capital || mount.equipment.subCapital) === capitalScale);
        if (weapons.length === 0) continue;
        const groups = new Map<string, BayWeaponGroup>();
        weapons.forEach(mount => {
            const existing = groups.get(mount.equipment.id);
            if (existing) existing.mounts.push(mount);
            else groups.set(mount.equipment.id, { equipment: mount.equipment, mounts: [mount] });
        });
        const enhancements = weapons.map(mount => entity.getLinkingMounts(mount).find(source => artemisKind(source.equipment) !== null || isApolloEquipment(source.equipment))?.equipment);
        const marker = enhancements.some(equipment => artemisKind(equipment) === 'iv') ? '*'
            : enhancements.length > 0 && enhancements.every(equipment => artemisKind(equipment) === 'v') ? '†'
                : enhancements.length > 0 && enhancements.every(isApolloEquipment) ? '‡'
                    : '';
        const footnote = marker === '*' ? '* w/Artemis IV'
            : marker === '†' ? '† w/Artemis V (-1 to hit)'
                : marker === '‡' ? '‡ w/Apollo (ignore +1 to hit)'
                    : undefined;
        const rear = weapons[0].rearMounted;
        // An aerodyne's rear wing bays carry "(R)"; a spheroid's print as aft sides instead
        const rearSuffix = rear && entity.entityType === 'DropShip' && entity.motiveType() !== 'Spheroid' ? ' (R)' : '';
        const groupList = [...groups.values()];
        const ammo = claimBayAmmo(groupList, bay.ammo);
        // Each weapon's rounds of each munition, which its name and the munition lines print alike
        const totals = new Map(groupList.map(group => [group, bayAmmoTotals(ammo.get(group)!, bayMunitionName)] as const));
        const lines: readonly BayDamageLine[] = capitalScale
            ? [{ name: '', values: [0, 1, 2, 3].map(rangeIndex => groupList.reduce((total, group) =>
                total + Math.max(0, group.equipment.weapon.av[rangeIndex] ?? 0) * group.mounts.length, 0)) }]
            : standardBayDamageLines(entity, groupList, ammo, totals);
        const bayLine = lines.find(line => line.munition === undefined);
        const munitionLines = lines.filter(line => line.munition !== undefined);
        const nameLines = groupList.map((group, index) => {
            const capacitorCount = group.mounts.filter(mount =>
                entity.getLinkingMounts(mount).some(source => isPpcCapacitorEquipment(source.equipment))).length;
            const capacitorText = capacitorCount === group.mounts.length && capacitorCount > 0
                ? ' w/Capacitor'
                : capacitorCount > 0
                    ? ` w/${capacitorCount} ${capacitorCount === 1 ? 'Capacitor' : 'Capacitors'}`
                    : '';
            const suffix = index === 0
                ? `${marker}${groups.size > 1 ? ',' : ''}${rearSuffix}`
                : '';
            // A munition printing a line of its own carries its rounds there
            const ammoText = bayAmmoText(group.equipment, new Map([...totals.get(group)!]
                .filter(([name]) => !munitionLines.some(line => line.munition?.displayName === name))));
            return `${group.mounts.length} ${group.equipment.shortName}${ammoText}${capacitorText}${suffix}`;
        });
        const location = capitalAeroInventoryLocation(entity, weapons[0]);
        // An AR10's heat and values depend on the missile it fires (TW p. 304); the AR10 table prints them
        const ar10 = weapons.some(mount => mount.equipment.ammoType === 'AR10');
        // Each value is the bay's combined value: a capital total rounds normally, .5 up (SO p. 88); a standard bay
        // prints its capital value, the standard value over 10 rounded normally, then the standard value (SO p. 10).
        // A narrow no-break space (half a Roboto space) keeps the pair compact and on one line.
        const damageText = (values: readonly number[]) => values.map(value => ar10 ? '*'
            : value <= 0 ? '—'
                : capitalScale ? formatWholeNumber(Math.round(value))
                    : `${formatWholeNumber(Math.round(value / 10))}\u202F(${formatWholeNumber(value)})`) as [string, string, string, string];
        rows.push({
            configurationKey: largeAeroBayConfigurationKey(entity, groupList, ammo),
            nameLines,
            location: location.label,
            // Laser insulators fit only units of 200 tons and less (TO:AUE p. 134), never a bay's DropShip or larger craft
            heat: ar10 ? '*' : String(weapons.reduce((total, mount) => total + largeAeroWeaponHeat(entity, mount), 0)),
            damageByRange: bayLine ? damageText(bayLine.values) : ['', '', '', ''],
            munitionLines: munitionLines.map(line => ({ name: line.name, damageByRange: damageText(line.values) })),
            componentIds: weapons.map(mount => mount.mountId),
            sortOrder: location.sortOrder,
            rearMounted: rear,
            footnote,
        });
    }
    return condenseSymmetricAeroBays(rows);
}

interface BayWeaponGroup {
    readonly equipment: EntityMountedWeapon['equipment'];
    readonly mounts: EntityMountedWeapon[];
}

interface BayAmmo {
    readonly equipment: AmmoEquipment;
    readonly shots: number;
}

/** Each loaded bin of the bay feeds the first of its weapon types that can fire it, so no bin prints twice. */
function claimBayAmmo(
    groups: readonly BayWeaponGroup[],
    ammo: readonly EntityMountedEquipment[],
): ReadonlyMap<BayWeaponGroup, readonly BayAmmo[]> {
    const claimed = new Map(groups.map(group => [group, [] as BayAmmo[]]));
    for (const bin of ammo) {
        const equipment = bin.equipment;
        const shots = bin.getAmmoShots() ?? 0;
        if (!(equipment instanceof AmmoEquipment) || shots <= 0) continue;
        const group = groups.find(candidate => ammoMatchesWeapon(candidate.equipment, equipment));
        if (group) claimed.get(group)!.push({ equipment, shots });
    }
    return claimed;
}

/** The shots of each munition, as `munition` names a bin's, in the order the bay lists them; bins of one add up. */
function bayAmmoTotals(ammo: readonly BayAmmo[], munition: (equipment: AmmoEquipment) => string): ReadonlyMap<string, number> {
    const totals = new Map<string, number>();
    for (const bin of ammo) {
        const name = munition(bin.equipment);
        totals.set(name, (totals.get(name) ?? 0) + bin.shots);
    }
    return totals;
}

/** The munition a bin prints as: an MML or ATM munition by the name its line prints, any other ammo by its short name. */
function bayMunitionName(ammo: AmmoEquipment): string {
    return resolveAmmoWeaponProfile(ammo)?.displayName ?? ammo.shortName;
}

/**
 * A bay weapon's ammo: one total per munition, as a weapon line carries its rounds (SO p. 142). Several munitions
 * print each total under the words their names don't share: an LB-X's slugs and cluster as (10 Standard, 10 Cluster),
 * an AR10's missiles as (15 KW, 15 B), an ATM's as (10 Standard, 10 Extended Range). An MML's or ATM's only munition
 * prints by name unless it is the launcher's first (LRM, Standard): (10 Extended Range).
 */
function bayAmmoText(weapon: EntityMountedWeapon['equipment'], shots: ReadonlyMap<string, number>): string {
    if (shots.size === 0) return '';
    const totals = [...shots];
    if (totals.length === 1 && weapon.ammoType !== 'AR10') {
        const [[name, count]] = totals;
        const munition = BAY_MUNITIONS.find(profile => profile.displayName === name);
        const unit = munition !== undefined && munition !== recordSheetAmmoProfiles(weapon)[0] ? name
            : weapon.capital && weapon.hasFlag('F_MISSILE') ? 'missiles' : 'rounds';
        return ` (${formatWholeNumber(count)} ${unit})`;
    }
    const words = totals.map(([name]) => name.split(/[ /]/u));
    const shortest = Math.min(...words.map(name => name.length));
    const shared = (word: (name: readonly string[]) => string) => words.length > 1
        && words.every(name => word(name) === word(words[0]));
    let head = 0;
    while (head < shortest && shared(name => name[head])) head++;
    let tail = 0;
    while (head + tail < shortest && shared(name => name[name.length - 1 - tail])) tail++;
    return ` (${totals.map(([, count], index) => `${formatWholeNumber(count)} ${
        words[index].slice(head, words[index].length - tail).join(' ') || 'Standard'}`).join(', ')})`;
}

/** Printed rounds omit munition identity; symmetric bays must still carry the same total of each munition. */
function largeAeroBayConfigurationKey(
    entity: AeroEntity,
    groups: readonly BayWeaponGroup[],
    ammo: ReadonlyMap<BayWeaponGroup, readonly BayAmmo[]>,
): string {
    return JSON.stringify(groups.map(group => ({
        weapon: group.equipment.id,
        enhancements: group.mounts
            .map(mount => JSON.stringify(entity.getLinkingMounts(mount).map(source => source.equipmentId).sort())).sort(),
        ammo: [...bayAmmoTotals(ammo.get(group)!, equipment => equipment.shortName)]
            .sort(([left], [right]) => left.localeCompare(right)),
    })).sort((left, right) => left.weapon.localeCompare(right.weapon)));
}

/** The munitions a bay prints a line for, in the order of TW p. 303, then the iATM's (IO:AE p. 61). */
const BAY_MUNITIONS: readonly AmmoWeaponProfile[] = [
    ...MML_AMMO_PROFILES,
    ...ATM_AMMO_PROFILES,
    ATM_IMPROVED_MAGNETIC_PULSE_PROFILE,
];

/**
 * Whether a bay weapon fires the munition: an MML its LRM and SRM missiles, an ATM its Standard, Extended Range and High
 * Explosive missiles, and an iATM also its Improved Magnetic Pulse missiles (IO:AE p. 61).
 */
function bayWeaponFires(weapon: EntityMountedWeapon['equipment'], profile: AmmoWeaponProfile): boolean {
    return recordSheetAmmoProfiles(weapon).includes(profile)
        || (profile === ATM_IMPROVED_MAGNETIC_PULSE_PROFILE && weapon.ammoType === 'IATM');
}

/** A bay's attack values: its own, printed on its first row, or one munition's, on a line named with its rounds. */
interface BayDamageLine {
    readonly munition?: AmmoWeaponProfile;
    readonly name: string;
    readonly values: readonly number[];
}

/**
 * A standard bay's attack values, each weapon with the Artemis linked to it. An MML or ATM bay whose munitions give
 * different values prints a line for each munition it carries, with its rounds; an ATM bay where every launcher carries
 * at least a ton each of Standard, Extended Range and High Explosive missiles prints the bay profile of TW p. 304
 * instead. Improved Magnetic Pulse missiles do not count toward the profile, so they print a line of their own under it.
 */
function standardBayDamageLines(
    entity: AeroEntity,
    groups: readonly BayWeaponGroup[],
    ammo: ReadonlyMap<BayWeaponGroup, readonly BayAmmo[]>,
    totals: ReadonlyMap<BayWeaponGroup, ReadonlyMap<string, number>>,
): readonly BayDamageLine[] {
    // The munitions a weapon carries and fires, and its rounds of one
    const munitions = (group: BayWeaponGroup) => BAY_MUNITIONS.filter(profile =>
        bayWeaponFires(group.equipment, profile) && totals.get(group)!.has(profile.displayName));
    const rounds = (group: BayWeaponGroup, profile: AmmoWeaponProfile) =>
        bayWeaponFires(group.equipment, profile) ? totals.get(group)!.get(profile.displayName) ?? 0 : 0;
    const tons = (group: BayWeaponGroup, profile: AmmoWeaponProfile) => ammo.get(group)!
        .filter(bin => resolveAmmoWeaponProfile(bin.equipment) === profile)
        .reduce((total, bin) => total + bin.shots / bin.equipment.shots, 0);
    const values = (profile: AmmoWeaponProfile | null) => [0, 1, 2, 3].map(rangeIndex => groups.reduce((total, group) => {
        const carried = munitions(group);
        const fired = profile !== null && bayWeaponFires(group.equipment, profile) ? profile : null;
        // An MML or ATM fires only a munition it can fire and carries (TW p. 103); with no munition named, as in a bay
        // that carries none, it keeps its listed values
        if (profile !== null && recordSheetAmmoProfiles(group.equipment).length > 0
            && (fired === null || !carried.includes(fired))) return total;
        // Each launcher that fires the munition spends a round of it (TW p. 103)
        const firing = fired !== null && carried.includes(fired) ? group.mounts.slice(0, rounds(group, fired)) : group.mounts;
        return total + firing.reduce((sum, mount) => {
            const value = aerospaceAttackValues(group.equipment, fired, recordSheetWeaponArtemis(entity, mount,
                ammo.get(group)!.map(bin => bin.equipment), fired))[rangeIndex];
            // A bay's PPC capacitors count as charged (TO:AUE p. 149)
            const capacitor = entity.getLinkingMounts(mount).some(source => isPpcCapacitorEquipment(source.equipment));
            return sum + (value > 0 ? value + (capacitor ? PPC_CAPACITOR_DAMAGE_BONUS : 0) : 0);
        }, 0);
    }, 0));
    const atm = groups.filter(group => group.equipment.ammoType === 'ATM' || group.equipment.ammoType === 'IATM');
    // A large craft's ATMs fire special munitions only with "at least 10 shots of each ammo type per ATM launcher"
    // (TM p. 194), counted in the bay that fires them (TM p. 195); bays print only for DropShips and larger craft
    const atmBuiltWith = (profile: AmmoWeaponProfile) => atm.filter(group => bayWeaponFires(group.equipment, profile))
        .every(group => rounds(group, profile) >= 10 * group.mounts.length);
    const atmSpecialMunitions = ATM_AMMO_PROFILES.every(atmBuiltWith);
    // Extended Range and High Explosive missiles fire only as the bay profile (TW p. 304); Improved Magnetic Pulse ones
    // print a line of their own
    const carried = BAY_MUNITIONS.filter(profile => groups.some(group => munitions(group).includes(profile))
        && !ATM_PROFILE_MUNITIONS.includes(profile)
        && (profile !== ATM_IMPROVED_MAGNETIC_PULSE_PROFILE || (atmSpecialMunitions && atmBuiltWith(profile))));
    // Each munition's line carries its rounds: LRM (78 rounds)
    const line = (profile: AmmoWeaponProfile): BayDamageLine => ({
        munition: profile,
        name: `${profile.displayName} (${formatWholeNumber(groups.reduce((total, group) =>
            total + rounds(group, profile), 0))} rounds)`,
        values: values(profile),
    });
    if (atm.length > 0 && atmSpecialMunitions
        && atm.every(group => ATM_AMMO_PROFILES.every(profile => tons(group, profile) >= group.mounts.length))) {
        // Short range times 1.5, medium unchanged, long and extreme half the standard value, each rounded up
        const [short, medium] = values(ATM_STANDARD_PROFILE);
        return [{ name: '', values: [Math.ceil(short * 1.5), medium, Math.ceil(medium / 2), Math.ceil(medium / 2)] },
            ...carried.filter(profile => profile === ATM_IMPROVED_MAGNETIC_PULSE_PROFILE).map(line)];
    }
    if (carried.length <= 1) return [{ name: '', values: values(carried[0] ?? null) }];
    return carried.map(line);
}

/** The ATM munitions a bay fires only as its profile (TW p. 304) */
const ATM_PROFILE_MUNITIONS: readonly AmmoWeaponProfile[] =
    ATM_AMMO_PROFILES.filter(profile => profile !== ATM_STANDARD_PROFILE);

/** A bay location's place in the inventory (MegaMekLab's `WeaponBayText.getLocWeight`); any other prints last. */
const BAY_LOCATION_ORDER: Readonly<Record<string, number>> = {
    NOS: 0, LS: 1, FLS: 1, RS: 3, FRS: 3, LBS: 5, RBS: 6, ALS: 7, ARS: 8,
};

/**
 * A bay's printed arc and its place in the inventory, by its location before a DropShip's side arcs are relabeled: the
 * nose, the left side's front then rear bays, the right side's front then rear, the broadsides, the aft sides, then
 * the aft. A spheroid's sides print FLS, ALS, FRS, ARS; an aerodyne's LW, LW (R), RW, RW (R).
 */
function capitalAeroInventoryLocation(
    entity: AeroEntity,
    mount: EntityMountedWeapon,
): { readonly label: string; readonly sortOrder: number } {
    const code = entity.componentLocationLabel(mount.getOccupiedLocations()[0] ?? '').toUpperCase();
    const order = BAY_LOCATION_ORDER[code] ?? 9;
    // A side's rear bays follow its front ones
    const rear = mount.rearMounted && (order === 1 || order === 3) ? 1 : 0;
    return { label: largeAeroArcLabel(entity, code, mount.rearMounted), sortOrder: order + rear };
}

/** A DropShip's side arcs: front and aft sides on a spheroid, wings on an aerodyne. */
function largeAeroArcLabel(entity: AeroEntity, code: string, rear: boolean): string {
    if (entity.entityType !== 'DropShip' || (code !== 'LS' && code !== 'RS')) return code || '—';
    if (entity.motiveType() === 'Spheroid') {
        if (code === 'LS') return rear ? 'ALS' : 'FLS';
        return rear ? 'ARS' : 'FRS';
    }
    return code === 'LS' ? 'LW' : 'RW';
}

function capitalAeroFeatures(entity: AeroEntity): string {
    const features: string[] = [];
    if (entity instanceof JumpShipEntity && entity.lithiumFusion()) features.push('LF Battery');
    const counts = new Map<string, number>();
    for (const mount of entity.equipment()) {
        if (!(mount.equipment instanceof MiscEquipment) || !isPrintableLargeCraftMisc(mount.equipment)) continue;
        const label = largeCraftMiscFeatureName(mount.equipment, mount.size ?? 1);
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    for (const [label, count] of counts) features.push(count > 1 ? `${count}x${label}` : label);
    if (entity instanceof JumpShipEntity && entity.hpg()
        && !entity.equipment().some(mount => isMobileHpgEquipment(mount.equipment))) {
        features.push('Mobile HPG');
    }
    return features.join(', ');
}

interface LargeAeroCriticalRow {
    readonly label: string;
    readonly x: number;
    readonly y: number;
    readonly controlX: number;
    readonly ids: readonly string[];
    readonly modifiers: readonly string[];
}

function drawLargeAeroCriticalPanel(svg: SVGSVGElement, entity: AeroEntity, box: Box): void {
    const group = addFrame(svg, 'CRITICAL DAMAGE', box, {
        bottomLeftNotchWidth: box.width * 0.40,
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    group.setAttribute('data-mekbay-region', 'critical-damage');
    const sx = box.width / 180.5;
    const sy = box.height / 166.104;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);
    const spaceStation = entity.entityType === 'SpaceStation';
    const capital = isCapitalAeroVessel(entity);
    const standardRows = spaceStation
        ? { first: 27.992, second: 47.976, third: 67.961 }
        : { first: 26.743, second: 44.229, third: 61.716 };
    const row = (label: string, x: number, y: number, controlX: number, system: SystemDamageKind): LargeAeroCriticalRow =>
        ({ label, x, y, controlX, ...systemDamageControls(entity, system) });
    const rows: LargeAeroCriticalRow[] = [
        row('Avionics', 6, standardRows.first, 56.46, 'avionics'),
        row(capital ? 'CIC' : 'FCS', 6, standardRows.second, 56.46, capital ? 'combat-information' : 'fire-control'),
        row('Sensors', 6, standardRows.third, 56.46, 'sensors'),
    ];
    if (entity.entityType === 'DropShip') {
        rows.push(
            row('Landing Gear', 115.14, standardRows.first, 47.3, 'landing-gear'),
            row('Life Support', 115.14, standardRows.second, 47.3, 'life-support'),
            row('K-F Boom', 115.14, standardRows.third, 47.3, 'kf-boom'),
            row('Docking Collar', 115.14, 79.202, 47.3, 'docking-collar'),
        );
    } else {
        rows.push(row('Life Support', 115.14, standardRows.first, 47.3, 'life-support'));
    }
    const thrusterLabelY = spaceStation ? 98.745 : 90.002;
    const leftThrusterY = spaceStation ? 107.929 : 96.688;
    const rightThrusterY = spaceStation ? 127.914 : 114.174;
    addText(group, 'Thrusters', x(6), y(thrusterLabelY), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
    rows.push(
        row('Left', 18, leftThrusterY, 44.46, 'left-thruster'),
        row('Right', 18, rightThrusterY, 44.46, 'right-thruster'),
    );
    if (!spaceStation) rows.push(row('Engine', 6, 131.661, 56.46, 'engine'));
    rows.forEach(row => drawLargeAeroCriticalRow(group, row, { x, y, font }));
}

function drawLargeAeroCriticalRow(
    group: SVGGElement,
    row: LargeAeroCriticalRow,
    scale: {
        readonly x: (value: number) => number;
        readonly y: (value: number) => number;
        readonly font: (value: number) => number;
    },
): void {
    addText(group, row.label, scale.x(row.x), scale.y(row.y + 9.6), {
        size: scale.font(RECORD_SHEET_FONT.inventory), weight: 700, maxWidth: scale.x(row.controlX - 3),
    });
    row.ids.forEach((id, index) => {
        const controlX = row.x + row.controlX + index * 15;
        drawCriticalDamageBox(group, id,
            { x: scale.x(controlX), y: scale.y(row.y), width: scale.x(12), height: scale.y(12) },
            { text: row.modifiers[index], size: scale.font(5.7) }, scale.x(1));
    });
}

function drawLargeAeroPilotPanel(svg: SVGSVGElement, entity: AeroEntity, box: Box): void {
    const group = addFrame(svg, 'PILOT DATA', box, {
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    group.setAttribute('data-mekbay-region', 'pilot-data');
    const sx = box.width / 142.6;
    const sy = box.height / 93.934;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);

    appendAeroSkillRows(group, { x, y, font }, 29.986);

    drawCrewHitGrid(group, 0, {
        x: x(48.86), y: y(35.979), cellWidth: x(87.74 / 6), cellHeight: y(10),
        labelX: x(3), labelWidth: x(42.86), fontScale: font(1), mode: 'vessel-crew',
    });

    const personnel = largeAeroPersonnel(entity);
    const facts: readonly [string, number, number, number, string][] = [
        ['Crew:', personnel.crew, 6, 63.969, 'nCrew'],
        ['Passengers:', personnel.passengers, 6, 71.969, 'nPassengers'],
        ['Other:', personnel.other, 6, 79.969, 'nOther'],
        ['Marines:', personnel.marines, 72.8, 63.969, 'nMarines'],
        ['BattleArmor:', personnel.battleArmor, 72.8, 71.969, 'nBattleArmor'],
    ];
    facts.forEach(([label, value, left, baseline, id]) => {
        addText(group, label, x(left), y(baseline), { size: font(RECORD_SHEET_FONT.inventory), weight: 700 });
        const valueX = left < 70 ? 61.84 : 128.64;
        const node = addText(group, String(value), x(valueX), y(baseline), {
            size: font(RECORD_SHEET_FONT.inventory), anchor: 'end', maxWidth: x(17),
        });
        node.id = id;
    });
    const boats = addText(
        group,
        `Life Boats/Escape Pods: ${personnel.lifeboats}/${personnel.escapePods}`,
        x(72.8),
        y(89.539),
        { size: font(RECORD_SHEET_FONT.inventory), weight: 700, anchor: 'middle', maxWidth: x(130) },
    );
    boats.id = 'lifeBoatsEscapePods';
}

function largeAeroPersonnel(entity: AeroEntity): {
    readonly crew: number;
    readonly passengers: number;
    readonly other: number;
    readonly marines: number;
    readonly battleArmor: number;
    readonly lifeboats: number;
    readonly escapePods: number;
} {
    if (entity instanceof SmallCraftEntity) {
        return {
            crew: entity.crew(),
            passengers: entity.passengers(),
            other: entity.otherPassenger(),
            marines: entity.marines(),
            battleArmor: entity.battleArmor(),
            lifeboats: entity.lifeboats(),
            escapePods: entity.escapePods(),
        };
    }
    if (entity instanceof JumpShipEntity) {
        return {
            crew: entity.crew(),
            passengers: entity.passengers(),
            other: 0,
            marines: entity.marines(),
            battleArmor: entity.battleArmor(),
            lifeboats: entity.lifeboats(),
            escapePods: entity.escapePods(),
        };
    }
    return {
        crew: 0,
        passengers: 0,
        other: 0,
        marines: 0,
        battleArmor: 0,
        lifeboats: 0,
        escapePods: 0,
    };
}

function drawLargeAeroHeatPanel(svg: SVGSVGElement, entity: AeroEntity, box: Box): void {
    const group = addFrame(svg, 'HEAT DATA', box, {
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45, bottomRight: 45 },
    });
    group.id = 'heatDataPanel';
    const sx = box.width / 180.5;
    const sy = box.height / 79.71;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);
    addText(group, 'Heat Sinks:', x(6), y(31), { size: font(7.2), weight: 700 });
    const heatSinkCount = Math.max(0, entity.heatSinkCount());
    const count = addText(group, String(heatSinkCount), x(29.7), y(44), {
        size: font(11.59), weight: 700, anchor: 'middle',
    });
    count.id = 'hsCount';
    const dissipation = heatSinkTypeDissipation(entity.heatSinkType());
    if (dissipation !== 1) {
        addText(group, `(${heatSinkCount * dissipation})`, x(29.7), y(57), {
            size: font(11.59), weight: 700, anchor: 'middle',
        });
    }
    addText(group, 'Heat Generation Per Arc:', x(65.3), y(31), {
        size: font(7.2), weight: 700, maxWidth: x(104),
    });

    const heat = largeAeroHeatByArc(entity);
    const rows = entity.entityType === 'WarShip'
        ? [
            ['Nose:', heat.nose, 'noseHeat'],
            ['Left/Right Fore:', `${heat.leftFore}/${heat.rightFore}`, 'foreSidesHeat'],
            ['Left/Right Broadsides:', `${heat.leftBroadside}/${heat.rightBroadside}`, 'broadsidesHeat'],
            ['Left/Right Aft:', `${heat.leftAft}/${heat.rightAft}`, 'aftSidesHeat'],
            ['Aft:', heat.aft, 'aftHeat'],
        ] as const
        : entity.entityType === 'DropShip' && entity.motiveType() !== 'Spheroid'
            ? [
                ['Nose:', heat.nose, 'noseHeat'],
                ['Left/Right Wing:', `${heat.leftFore}/${heat.rightFore}`, 'foreSidesHeat'],
                ['Left/Right Wing (Rear):', `${heat.leftAft}/${heat.rightAft}`, 'aftSidesHeat'],
                ['Aft:', heat.aft, 'aftHeat'],
            ] as const
            : [
                ['Nose:', heat.nose, 'noseHeat'],
                ['Left/Right Fore:', `${heat.leftFore}/${heat.rightFore}`, 'foreSidesHeat'],
                ['Left/Right Aft:', `${heat.leftAft}/${heat.rightAft}`, 'aftSidesHeat'],
                ['Aft:', heat.aft, 'aftHeat'],
            ] as const;
    const start = rows.length === 5 ? 39.816 : 41.285;
    const size = font(RECORD_SHEET_FONT.inventory);
    const cells = rows.map(([label, value, id], index) => {
        const labelNode = addText(group, label, x(65.3), y(start + index * 8), { size });
        const valueNode = addText(group, String(value), 0, y(start + index * 8), { size, anchor: 'middle' });
        valueNode.id = id;
        return [labelNode, valueNode] as const;
    });
    const labels = cells.map(([label]) => label);
    const values = cells.map(([, value]) => value);
    // MegaMekLab's value column, moved right only as far as the widest label and value need to stay unsqueezed.
    const labelsEnd = x(65.3) + Math.max(...labels.map(label => measureSvgTextCanvas(label, label.textContent ?? '')));
    const valueWidth = Math.max(...values.map(value => measureSvgTextCanvas(value, value.textContent ?? '')));
    const authoredX = entity.entityType === 'JumpShip' || entity.entityType === 'SpaceStation' ? 145.4 : 154.3;
    const valueX = formatNumber(Math.max(x(authoredX), labelsEnd + size * 0.5 + valueWidth / 2));
    values.forEach(value => value.setAttribute('x', valueX));
}

/**
 * A large craft weapon's heat: rapid-fire weapons always fire at their maximum rate (TW p. 238), each shot making the
 * weapon's heat (TW p. 114), and a PPC capacitor adds its 5, as a bay counts it always charged (TO:AUE p. 149).
 */
function largeAeroWeaponHeat(entity: AeroEntity, mount: EntityMountedWeapon): number {
    const capacitated = entity.getLinkingMounts(mount).some(source => isPpcCapacitorEquipment(source.equipment));
    return mount.equipment.heat * (mount.equipment.getRapidFireCount() || 1) + (capacitated ? PPC_CAPACITOR_HEAT_BONUS : 0);
}

function largeAeroHeatByArc(entity: AeroEntity): {
    readonly nose: number;
    readonly leftFore: number;
    readonly rightFore: number;
    readonly leftBroadside: number;
    readonly rightBroadside: number;
    readonly leftAft: number;
    readonly rightAft: number;
    readonly aft: number;
} {
    const byCode = new Map<string, number>();
    entity.rangedWeapons().forEach(mount => {
        const locations = mount.getOccupiedLocations();
        const divisor = Math.max(1, locations.length);
        const heat = largeAeroWeaponHeat(entity, mount);
        locations.forEach(location => {
            let code = entity.componentLocationLabel(location).toUpperCase().replaceAll(/[^A-Z]/gu, '');
            if (mount.rearMounted && ['LS', 'LW', 'LWG', 'RS', 'RW', 'RWG'].includes(code)) code += 'R';
            byCode.set(code, (byCode.get(code) ?? 0) + heat / divisor);
        });
    });
    const sum = (...codes: readonly string[]): number => Math.round(codes.reduce(
        (total, code) => total + (byCode.get(code) ?? 0),
        0,
    ));
    return {
        nose: sum('NOS', 'NOSE'),
        leftFore: sum('LS', 'LW', 'LWG', 'FLS'),
        rightFore: sum('RS', 'RW', 'RWG', 'FRS'),
        leftBroadside: sum('LBS'),
        rightBroadside: sum('RBS'),
        leftAft: sum('LWR', 'LWGR', 'LSR', 'ALS'),
        rightAft: sum('RWR', 'RWGR', 'RSR', 'ARS'),
        aft: sum('AFT', 'REAR'),
    };
}
