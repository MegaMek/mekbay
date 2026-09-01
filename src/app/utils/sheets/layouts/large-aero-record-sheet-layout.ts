// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import type { AeroEntity } from '../../../models/entity/entities/aero/aero-entity';
import { SmallCraftEntity } from '../../../models/entity/entities/aero/small-craft-entity';
import { JumpShipEntity } from '../../../models/entity/entities/largecraft/jumpship-entity';
import { isAeroEntity } from '../../../models/entity/utils/entity-type-guards';
import type { EntityMountedEquipment, EntityMountedWeapon, EquipmentBay } from '../../../models/entity/types';
import { AmmoEquipment, ammoMatchesWeapon } from '../../../models/equipment.model';
import {
    isPpcCapacitorEquipment,
    PPC_CAPACITOR_DAMAGE_BONUS,
    PPC_CAPACITOR_HEAT_BONUS,
} from '../../../models/ppc-capacitor.model';
import { artemisKind } from '../../../models/artemis-equipment.model';
import { isApolloEquipment } from '../../../models/apollo-mode.model';
import { projectRecordSheetBays } from '../../../models/entity/bays/record-sheet-bay-projection';
import { aerospaceAttackValues } from '../../aerospace-range.util';
import { formatRecordSheetWeaponDamageText } from '../../record-sheet-weapon-info.util';
import type { RecordSheetLayout, RecordSheetLayoutRequest } from './record-sheet-layout';
import {
    fullRecordSheetLayoutProfile,
    type RecordSheetLayoutProfile,
    type RecordSheetPageFormat,
} from '../record-sheet-layout';
import {
    type Box,
    addDiagramHeading,
    addFrame,
    addLine,
    addText,
    appendLegacyIdentityAnchors,
    createRoot,
    drawGeneratedFooter,
    drawHeatScale,
    drawNotesPanel,
    drawPageChrome,
    formatNumber,
    formatTechBase,
    formatWholeNumber,
    scalePageBox,
    setAttributes,
    setInventoryComponentIds,
    svgElement,
    transparentRect,
} from '../record-sheet-svg-rendering';
import { appendRecordSheetEraIcon } from '../record-sheet-embedded-art';
import { isMobileHpgEquipment } from '../../../models/aerospace-support-equipment.model';
import {
    type AeroDataInventoryRow,
    drawAeroArtworkRegion,
    drawAeroDataPanel,
    drawAeroHeatDataPanel,
    drawAeroMovementCompass,
    drawAeroPaperdoll,
    drawAeroVelocityPanel,
} from './aero-record-sheet-components';
import {
    drawFighterCriticalPanel,
    drawFighterPilotPanel,
} from './aero-fighter-record-sheet-controls';
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

function isCapitalAeroVessel(entity: AeroEntity): boolean {
    return entity.entityType === 'JumpShip'
        || entity.entityType === 'WarShip'
        || entity.entityType === 'SpaceStation';
}

/** Small craft, DropShips, JumpShips, WarShips, and space stations. */
export class LargeAeroRecordSheetLayout implements RecordSheetLayout {
    public readonly id = 'large-aero';

    public matches(entity: BaseEntity): boolean {
        return isAeroEntity(entity) && (
            entity.entityType === 'SmallCraft'
            || entity.entityType === 'DropShip'
            || entity.entityType === 'JumpShip'
            || entity.entityType === 'WarShip'
            || entity.entityType === 'SpaceStation'
        );
    }

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
        return this.generatePrimaryPage(entity, request, largeAeroPageContent(entity));
    }

    public async generatePages(
        entity: BaseEntity,
        request: RecordSheetLayoutRequest,
    ): Promise<readonly SVGSVGElement[]> {
        if (!isAeroEntity(entity) || !this.matches(entity)) {
            throw new Error('Large-aero layout requires a large aerospace vessel');
        }
        const content = largeAeroPageContent(entity);
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
            scalePageBox(page, box);
        const smallCraft = entity.entityType === 'SmallCraft';
        const capital = isCapitalAeroVessel(entity);

        drawPageChrome(svg, this.sheetTitle(entity), page, false);
        const dataPanelHeight = smallCraft ? 310.143 : 420.257;
        const dataPanelBox = at({
            x: 18.966,
            y: 87.857,
            width: 222.4,
            height: dataPanelHeight,
        });
        const dataGroup = capital || content.plan.pageCount > 1 || content.capitalRows.length > 0
            ? drawCapitalAeroDataPanel(svg, entity, dataPanelBox, content)
            : drawAeroDataPanel(svg, entity, dataPanelBox, dataPanelHeight, {
                panelTitle: this.dataPanelTitle(entity),
                identity: smallCraft ? 'small-craft' : 'large-vessel',
                inventoryRows: smallCraft
                    ? this.smallCraftInventoryRows(entity)
                    : this.standardBayInventoryRows(entity),
                flowCargoAfterInventory: true,
                showAmmoSummary: smallCraft,
                stationary: false,
            });
        const eraY = smallCraft ? 285.25 : 395.65;
        await appendRecordSheetEraIcon(svg, dataGroup, entity.year(), {
            x: 158.563 * dataPanelBox.width / 222.4,
            y: eraY * dataPanelBox.height / dataPanelHeight,
            width: 20 * dataPanelBox.width / 222.4,
            height: 20 * dataPanelBox.height / dataPanelHeight,
        });
        await drawAeroPaperdoll(svg, entity, at({
            x: 249.651,
            y: 18,
            width: 344,
            height: smallCraft ? 440 : 450,
        }), smallCraft ? 440 : 450, {
            assetUrl: this.paperdollAsset(entity),
            capitalFallback: capital,
            pipLayout: capital ? 'capital-grid' : 'classic',
        });
        drawLargeAeroDiagramHeader(svg, capital, page);
        drawAeroMovementCompass(svg, at({ x: 249.651, y: 456.4, width: 90, height: 50 }));
        if (smallCraft) {
            drawAeroArtworkRegion(svg, entity, at({ x: 43, y: 404, width: 193, height: 96 }));
            drawFighterPilotPanel(svg, at({ x: 251.4, y: 509.4, width: 142.6, height: 93.934 }));
            drawFighterCriticalPanel(svg, at({ x: 18.966, y: 509.4, width: 220.4, height: 93.934 }));
            drawAeroVelocityPanel(svg, at({ x: 18.966, y: 603.12, width: 377.7, height: 151.88 }));
            drawAeroHeatDataPanel(svg, entity, at({ x: 405.456, y: 509.4, width: 161, height: 246.6 }), true);
        } else {
            if (entity.entityType === 'SpaceStation') {
                drawNotesPanel(svg, at({ x: 18.966, y: 509.4, width: 220.4, height: 93.934 }));
                drawNotesPanel(svg, at({ x: 18.966, y: 603.12, width: 377.7, height: 151.88 }));
            } else {
                drawAeroArtworkRegion(svg, entity, at({ x: 43, y: 510, width: 193, height: 84.72 }));
                drawAeroVelocityPanel(svg, at({ x: 18.966, y: 603.12, width: 377.7, height: 151.88 }));
            }
            drawLargeAeroPilotPanel(svg, entity, at({ x: 252.366, y: 509.4, width: 142.6, height: 93.934 }));
            drawLargeAeroCriticalPanel(svg, entity, at({ x: 405.966, y: 509.4, width: 180.5, height: 166.104 }));
            drawLargeAeroHeatPanel(svg, entity, at({ x: 405.966, y: 675.29, width: 180.5, height: 79.71 }));
        }
        if (entity.tracksHeat()) {
            drawHeatScale(svg, at({ x: 574, y: 388.911, width: 19.454, height: 366 }));
        }
        drawGeneratedFooter(svg, page, {
            catalystX: 527.13,
            catalystY: 59.25,
            catalystScale: 1.015,
        });
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

    private sheetTitle(entity: AeroEntity): string {
        switch (entity.entityType) {
            case 'SmallCraft':
                return `${entity.getMotiveTypeAsString()?.toUpperCase() ?? 'AERODYNE'} SMALL CRAFT RECORD SHEET`;
            case 'DropShip':
                return `${entity.getMotiveTypeAsString()?.toUpperCase() ?? 'AERODYNE'} DROPSHIP RECORD SHEET`;
            case 'JumpShip': return 'JUMPSHIP RECORD SHEET';
            case 'WarShip': return 'WARSHIP RECORD SHEET';
            case 'SpaceStation': return 'SPACE STATION RECORD SHEET';
            default: throw new Error(`Unsupported large-aero sheet type: ${entity.entityType}`);
        }
    }

    private dataPanelTitle(entity: AeroEntity): string {
        switch (entity.entityType) {
            case 'SmallCraft': return 'CRAFT DATA';
            case 'DropShip': return 'DROPSHIP DATA';
            case 'JumpShip': return 'JUMPSHIP DATA';
            case 'WarShip': return 'WARSHIP DATA';
            case 'SpaceStation': return 'SPACE STATION DATA';
            default: throw new Error(`Unsupported large-aero data panel: ${entity.entityType}`);
        }
    }

    private paperdollAsset(entity: AeroEntity): string {
        const spheroid = (entity.getMotiveTypeAsString() ?? '').toLowerCase().includes('spheroid');
        switch (entity.entityType) {
            case 'SmallCraft':
                return `/images/paperdolls/smallcraft-${spheroid ? 'spheroid' : 'aerodyne'}.svg`;
            case 'DropShip':
                return `/images/paperdolls/dropship-${spheroid ? 'spheroid' : 'aerodyne'}.svg`;
            case 'JumpShip': return '/images/paperdolls/jumpship.svg';
            case 'WarShip': return '/images/paperdolls/warship.svg';
            case 'SpaceStation': return '/images/paperdolls/spacestation.svg';
            default: throw new Error(`Unsupported large-aero paperdoll: ${entity.entityType}`);
        }
    }

    /** Small Craft use one standard-scale record-sheet row per mounted weapon. */
    private smallCraftInventoryRows(entity: AeroEntity): readonly AeroDataInventoryRow[] {
        interface ProjectedMount {
            readonly mount: ReturnType<AeroEntity['rangedWeapons']>[number];
            readonly row: AeroDataInventoryRow;
            readonly ranges: readonly number[];
            readonly locationOrder: number;
        }
        const locationOrder = new Map(entity.componentLocationOrder().map((location, index) => [location, index]));
        const projected = entity.rangedWeapons().map((mount, index): ProjectedMount => {
            const ranges = aerospaceAttackValues(mount.equipment, null);
            const notation = formatRecordSheetWeaponDamageText(mount.equipment, '').trim();
            const displayName = mount.displayName();
            const name = notation && !displayName.includes(notation)
                ? `${displayName} ${notation}`
                : displayName;
            const occupied = mount.getOccupiedLocations();
            const sourceLocation = occupied[0] ?? mount.location;
            const code = entity.componentLocationLabel(sourceLocation).toUpperCase();
            return {
                mount,
                ranges,
                locationOrder: locationOrder.get(sourceLocation) ?? Number.MAX_SAFE_INTEGER,
                row: {
                    id: `generated-small-craft-inventory-row@${index}`,
                    kind: 'equipment',
                    quantity: 1,
                    nameLines: [name],
                    location: ({ LS: 'LWG', RS: 'RWG' } as Readonly<Record<string, string>>)[code]
                        ?? (code || '—'),
                    heat: String(mount.equipment.heat),
                    damageByRange: ranges.map(value => value > 0 ? String(value) : '—') as
                        [string, string, string, string],
                    componentIds: [mount.mountId],
                },
            };
        });
        projected.sort((left, right) => {
            const lastRange = (values: readonly number[]): number => {
                for (let index = values.length - 1; index >= 0; index--) {
                    if ((values[index] ?? 0) > 0) return index;
                }
                return -1;
            };
            const rangeDelta = lastRange(right.ranges) - lastRange(left.ranges);
            if (rangeDelta !== 0) return rangeDelta;
            for (let index = 0; index < 4; index++) {
                const damageDelta = (right.ranges[index] ?? 0) - (left.ranges[index] ?? 0);
                if (damageDelta !== 0) return damageDelta;
            }
            if (left.mount.rearMounted !== right.mount.rearMounted) return left.mount.rearMounted ? 1 : -1;
            return left.locationOrder - right.locationOrder;
        });

        const implicit = entity.implicitSystemEquipment().map((equipment, index): AeroDataInventoryRow => ({
            id: `generated-small-craft-system-row@${index}`,
            kind: 'equipment',
            quantity: 1,
            nameLines: [`${equipment.name}${/\bECM\b/iu.test(equipment.name) ? ' [E]' : ''}`],
            location: 'NOS',
            heat: '—',
            damageByRange: ['—', '—', '—', '—'],
            componentIds: [],
        }));
        return [...projected.map(entry => entry.row), ...implicit];
    }

    /**
     * Standard-scale large-craft rows are weapon bays, not fighter-style mount rows.
     * This deliberately mirrors MegaMekLab's per-weapon-type rounding and symmetric
     * side-bay condensation while leaving the shared component responsible only for drawing.
     */
    private standardBayInventoryRows(entity: AeroEntity): readonly AeroDataInventoryRow[] {
        interface ProjectedBay {
            row: AeroDataInventoryRow;
            sortOrder: number;
        }
        const projected: ProjectedBay[] = [];
        for (const bay of entity.equipmentBays()) {
            const weapons = bay.weapons.filter(mount => !mount.equipment.capital && !mount.equipment.subCapital);
            if (weapons.length === 0) continue;
            const row = this.standardBayRow(entity, bay, weapons);
            const locationCode = entity.componentLocationLabel(
                weapons[0].getOccupiedLocations()[0] ?? weapons[0].location,
            ).toUpperCase();
            projected.push({
                row,
                sortOrder: this.largeAeroBaySortOrder(locationCode, weapons[0].rearMounted),
            });
        }
        return projected
            .sort((left, right) => left.sortOrder - right.sortOrder)
            .map((projection, index) => ({ ...projection.row, id: `bay_${index + 1}` }));
    }

    private standardBayRow(
        entity: AeroEntity,
        bay: EquipmentBay,
        weapons: readonly EntityMountedWeapon[],
    ): AeroDataInventoryRow {
        interface WeaponGroup {
            readonly equipment: EntityMountedWeapon['equipment'];
            readonly mounts: EntityMountedWeapon[];
        }
        const groups = new Map<string, WeaponGroup>();
        for (const mount of weapons) {
            const key = mount.equipment.id;
            const existing = groups.get(key);
            if (existing) existing.mounts.push(mount);
            else groups.set(key, { equipment: mount.equipment, mounts: [mount] });
        }
        const orderedGroups = [...groups.values()].sort((left, right) =>
            right.equipment.shortName.localeCompare(left.equipment.shortName));
        const allEnhancements = weapons.map(mount => entity.getLinkingMount(mount)?.equipment);
        const marker = allEnhancements.some(equipment => artemisKind(equipment) === 'iv') ? '*'
            : allEnhancements.length > 0 && allEnhancements.every(equipment => artemisKind(equipment) === 'v') ? '†'
                : allEnhancements.length > 0 && allEnhancements.every(isApolloEquipment) ? '‡'
                    : '';
        const nameLines = orderedGroups.map((group, index) => {
            const matchingAmmo = bay.ammo.filter(mount =>
                mount.equipment instanceof AmmoEquipment
                && ammoMatchesWeapon(group.equipment, mount.equipment));
            let ammoText = '';
            if (matchingAmmo.length > 0) {
                if (group.equipment.ammoType === 'AR10') {
                    const details = matchingAmmo.map(mount =>
                        `${formatWholeNumber(mount.getAmmoShots() ?? 0)} ${mount.equipment?.shortName ?? mount.displayName()}`);
                    ammoText = ` (${details.join(', ')})`;
                } else {
                    const unit = group.equipment.capital && group.equipment.hasWeaponTrait('missile')
                        ? 'missiles'
                        : 'rounds';
                    ammoText = ` (${formatWholeNumber(matchingAmmo[0].getAmmoShots() ?? 0)} ${unit})`;
                }
            }
            const capacitorCount = group.mounts.filter(mount =>
                isPpcCapacitorEquipment(entity.getLinkingMount(mount)?.equipment)).length;
            const capacitorText = capacitorCount === group.mounts.length && capacitorCount > 0
                ? ' w/Capacitor'
                : capacitorCount > 0
                    ? ` w/${capacitorCount} ${capacitorCount === 1 ? 'Capacitor' : 'Capacitors'}`
                    : '';
            const punctuation = index === 0
                ? `${marker}${orderedGroups.length > 1 ? ',' : ''}`
                : '';
            const rear = weapons[0].rearMounted && entity.entityType === 'DropShip'
                && entity.motiveType() !== 'Spheroid' && index === 0 ? ' (R)' : '';
            return `${group.mounts.length} ${group.equipment.shortName}${ammoText}${capacitorText}${punctuation}${rear}`;
        });

        const standardDamage = [0, 0, 0, 0];
        const bayDamage = [0, 0, 0, 0];
        for (const group of orderedGroups) {
            const values = aerospaceAttackValues(group.equipment, null);
            if (group.equipment.ammoType === 'ATM' || group.equipment.ammoType === 'IATM') {
                const base = Math.ceil(values[0] * group.mounts.length
                    * (group.equipment.ammoType === 'IATM' ? 1 : 0.5));
                const totals = [Math.ceil(base * 1.5), base, Math.ceil(base * 0.5), Math.ceil(base * 0.5)];
                totals.forEach((total, rangeIndex) => {
                    standardDamage[rangeIndex] += total;
                    bayDamage[rangeIndex] += Math.round(total / 10);
                });
                continue;
            }
            values.forEach((value, rangeIndex) => {
                if (value <= 0) return;
                let total = value * group.mounts.length;
                if (group.equipment.ammoType === 'MML' && rangeIndex === 0) total *= 2;
                const capacitorCount = group.mounts.filter(mount =>
                    isPpcCapacitorEquipment(entity.getLinkingMount(mount)?.equipment)).length;
                total += capacitorCount * PPC_CAPACITOR_DAMAGE_BONUS;
                standardDamage[rangeIndex] += total;
                bayDamage[rangeIndex] += Math.round(total / 10);
            });
        }
        const locationCode = entity.componentLocationLabel(
            weapons[0].getOccupiedLocations()[0] ?? weapons[0].location,
        ).toUpperCase();
        const heat = weapons.reduce((total, mount) => total + mount.equipment.heat
            + (isPpcCapacitorEquipment(entity.getLinkingMount(mount)?.equipment)
                ? PPC_CAPACITOR_HEAT_BONUS : 0), 0);
        return {
            id: '',
            kind: 'bay',
            nameLines,
            location: this.singleLargeAeroLocation(entity, locationCode, weapons[0].rearMounted),
            heat: String(heat),
            damageByRange: bayDamage.map((value, rangeIndex) => value + standardDamage[rangeIndex] > 0
                ? `${value} (${formatWholeNumber(standardDamage[rangeIndex])})`
                : '—') as [string, string, string, string],
            componentIds: bay.mounts.map(mount => mount.mountId),
        };
    }

    private singleLargeAeroLocation(entity: AeroEntity, code: string, rear: boolean): string {
        if (entity.entityType !== 'DropShip' || (code !== 'LS' && code !== 'RS')) return code || '—';
        if (entity.motiveType() === 'Spheroid') {
            if (code === 'LS') return rear ? 'ALS' : 'FLS';
            return rear ? 'ARS' : 'FRS';
        }
        return code === 'LS' ? 'LW' : 'RW';
    }

    private largeAeroBaySortOrder(code: string, rear: boolean): number {
        const base: Readonly<Record<string, number>> = { NOS: 0, LS: 1, RS: 3, AFT: 9 };
        return (base[code] ?? 8) + ((code === 'LS' || code === 'RS') && rear ? 1 : 0);
    }
}

interface CapitalAeroInventoryRow {
    readonly nameLines: readonly string[];
    readonly location: string;
    readonly heat: number;
    readonly damageByRange: readonly [string, string, string, string];
    readonly componentIds: readonly string[];
    readonly sortOrder: number;
    readonly footnote?: string;
}

interface LargeAeroPageContent {
    readonly capitalRows: readonly CapitalAeroInventoryRow[];
    readonly standardRows: readonly CapitalAeroInventoryRow[];
    readonly gravDecks: readonly number[];
    readonly cargoLines: readonly string[];
    readonly plan: LargeAeroRecordSheetPagePlan;
}

function largeAeroPageContent(entity: AeroEntity): LargeAeroPageContent {
    if (entity.entityType === 'SmallCraft') {
        return Object.freeze({
            capitalRows: Object.freeze([]),
            standardRows: Object.freeze([]),
            gravDecks: Object.freeze([]),
            cargoLines: Object.freeze([]),
            plan: planLargeAeroRecordSheetPages({
                capitalWeaponLines: 0,
                standardWeaponLines: 0,
                hasAr10: false,
                gravDeckCount: 0,
                transportBayLines: 0,
            }),
        });
    }
    const capitalRows = capitalAeroInventoryRows(entity, 'capital');
    const standardRows = capitalAeroInventoryRows(entity, 'standard');
    const gravDecks = entity instanceof JumpShipEntity ? entity.gravDecks() : [];
    const cargoLines = capitalAeroCargoLines(entity);
    const plan = planLargeAeroRecordSheetPages({
        capitalWeaponLines: inventoryLineCount(capitalRows, false),
        standardWeaponLines: inventoryLineCount(standardRows, true),
        hasAr10: entity.rangedWeapons().some(mount => mount.equipment.ammoType === 'AR10'),
        gravDeckCount: gravDecks.length,
        transportBayLines: cargoLines.length,
    });
    return Object.freeze({ capitalRows, standardRows, gravDecks, cargoLines, plan });
}

function inventoryLineCount(rows: readonly CapitalAeroInventoryRow[], includeFootnotes: boolean): number {
    const entries = rows.reduce((sum, row) => sum + Math.max(1, row.nameLines.length), 0);
    if (!includeFootnotes) return entries;
    return entries + new Set(rows.map(row => row.footnote).filter((note): note is string => Boolean(note))).size;
}

function drawCapitalAeroDataPanel(
    svg: SVGSVGElement,
    entity: AeroEntity,
    box: Box,
    content: LargeAeroPageContent,
): SVGGElement {
    const group = addFrame(svg, capitalAeroDataPanelTitle(entity), box, {
        bottomLeftNotchWidth: box.width * 0.36,
        cornerAngleDegrees: { topRight: 45, bottomLeft: 45 },
    });
    group.setAttribute('data-mekbay-region', 'aero-data');
    const firstScale = content.plan.front.has('capital-weapons') ? 'capital' : 'standard';
    group.setAttribute('data-mekbay-aero-scale', firstScale);
    const sx = box.width / 222.4;
    const sy = box.height / 420.257;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);

    addText(group, 'Type:', x(6), y(28), { size: font(9.67), weight: 700 });
    const type = addText(group, entity.displayName(), x(32.229), y(28), {
        size: font(9.67), weight: 700, maxWidth: x(184),
    });
    type.id = 'type';
    type.setAttribute('data-mekbay-field', 'display-name');
    addText(group, 'Name:', x(6), y(38), { size: font(7.7), weight: 700 });
    const fluffName = addText(group, '', x(31.315), y(38), { size: font(7.7), maxWidth: x(74) });
    fluffName.id = 'fluffName';
    addLine(group, x(31.315), y(39), x(105.218), y(39), '#000', 0.72 * Math.min(sx, sy));

    const stationary = entity.entityType === 'JumpShip' || entity.entityType === 'SpaceStation';
    addText(group, 'Thrust:', x(6), y(47), { size: font(7.7), weight: 700 });
    if (stationary) {
        addText(group, 'Station Keeping Only', x(9.844), y(56), { size: font(7.7), maxWidth: x(96) });
    } else {
        addText(group, 'Safe Thrust:', x(9.844), y(56), { size: font(7.7), weight: 700 });
        const safe = addText(group, String(entity.safeThrust()), x(79.844), y(56), {
            size: font(7.7), anchor: 'middle',
        });
        safe.id = 'mpWalk';
        addText(group, 'Maximum Thrust:', x(9.844), y(65), { size: font(7.7), weight: 700 });
        const maximum = addText(group, String(entity.maxThrust()), x(79.844), y(65), {
            size: font(7.7), anchor: 'middle',
        });
        maximum.id = 'mpRun';
    }

    const facts: readonly [string, string, number, string, string?][] = [
        ['Tonnage:', formatWholeNumber(entity.tonnage()), 38, 'tonnage', 'tonnage'],
        ['Tech Base:', formatTechBase(entity.techBase(), entity.mixedTech()), 47, 'techBase', 'tech-base'],
        ...stationary ? [] : [[
            'Role:', entity.role() || 'None', 56, 'role', 'role',
        ] as [string, string, number, string, string]],
    ];
    facts.forEach(([label, value, baseline, id, field]) => {
        addText(group, label, x(115.7), y(baseline), { size: font(7.7), weight: 700 });
        const node = addText(group, value, x(158.24), y(baseline), { size: font(7.7), maxWidth: x(58) });
        node.id = id;
        if (field) node.setAttribute('data-mekbay-field', field);
    });

    const inventoryOffset = stationary ? -7.339 : 0;
    const inventoryY = (value: number): number => y(value + inventoryOffset);
    addLine(group, x(3), inventoryY(69), x(219.4), inventoryY(69), '#000', 1.932 * Math.min(sx, sy));
    addText(group, 'Weapons & Equipment Inventory', x(3), inventoryY(79), {
        size: font(8.6), weight: 700, maxWidth: x(155),
    });
    const frontLines = largeAeroBlockLineCount(content, content.plan.front)
        + (content.plan.reverse.has('standard-weapons') ? 2 : 0);
    const rowStep = Math.max(6.4, Math.min(9.126, 282 / Math.max(1, frontLines)));
    const geometry = largeAeroInventoryGeometry(group, x, inventoryY, font, rowStep);
    let detailY = 89.8;
    detailY = drawLargeAeroBlocks(geometry, entity, content, content.plan.front, detailY, 'front');
    if (content.plan.reverse.has('standard-weapons')) {
        addText(group, 'Standard Scale on Reverse', x(7.328), inventoryY(detailY), {
            size: font(Math.min(6.76, rowStep * 0.75)), weight: 700,
        });
    }

    if (content.plan.front.has('footer')) {
        const fuelBaseline = stationary ? 393.454 : 376.854;
        drawLargeAeroFooter(group, entity, x, inventoryY, font, fuelBaseline, rowStep, 204);
    }
    addLine(group, x(3), y(392.543), x(219.4), y(392.543), '#000', 1.932 * Math.min(sx, sy));
    addText(group, 'BV:', x(13.845), y(404.543), { size: font(9.67), weight: 700 });
    const bv = addText(group, formatWholeNumber(entity.battleValue()), x(32.79), y(404.543), {
        size: font(9.67),
    });
    bv.id = 'bv';
    appendLegacyIdentityAnchors(group, entity, box);
    return group;
}

interface LargeAeroInventoryColumns {
    readonly sectionX: number;
    readonly quantityHeaderX: number;
    readonly typeHeaderX: number;
    readonly nameX: number;
    readonly continuationX: number;
    readonly locationX: number;
    readonly heatX: number;
    readonly rangeX: readonly [number, number, number, number];
    readonly nameMaxWidth: number;
    readonly locationMaxWidth: number;
    readonly rangeMaxWidth: number;
    readonly mainButtonWidth: number;
    readonly gravDeckSecondColumnX: number;
    readonly gravDeckColumnWidth: number;
    readonly cargoMaxWidth: number;
}

const FRONT_INVENTORY_COLUMNS: LargeAeroInventoryColumns = Object.freeze({
    sectionX: 7.328,
    quantityHeaderX: 8.41,
    typeHeaderX: 13.82,
    nameX: 7.328,
    continuationX: 11.656,
    locationX: 109.036,
    heatX: 132.84,
    rangeX: [152.316, 169.628, 186.94, 204.252] as const,
    nameMaxWidth: 97,
    locationMaxWidth: 21,
    rangeMaxWidth: 16.312,
    mainButtonWidth: 134,
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
    nameMaxWidth: 123,
    locationMaxWidth: 28,
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
    readonly headingOffset: number;
    readonly firstRowOffset: number;
    readonly columns: LargeAeroInventoryColumns;
}

function largeAeroInventoryGeometry(
    group: SVGGElement,
    x: (value: number) => number,
    y: (value: number) => number,
    font: (value: number) => number,
    rowStep: number,
    columns: LargeAeroInventoryColumns = FRONT_INVENTORY_COLUMNS,
    headingOffset = rowStep,
    firstRowOffset = rowStep * 2,
): LargeAeroInventoryGeometry {
    return { group, x, y, font, rowStep, headingOffset, firstRowOffset, columns };
}

function drawLargeAeroBlocks(
    geometry: LargeAeroInventoryGeometry,
    entity: AeroEntity,
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
        drawLargeAeroFooter(
            geometry.group,
            entity,
            geometry.x,
            geometry.y,
            geometry.font,
            currentY,
            geometry.rowStep,
            205,
        );
        currentY += geometry.rowStep * 2;
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
    const { group, x, y, font, rowStep, headingOffset, firstRowOffset, columns } = geometry;
    const textSize = Math.min(6.76, rowStep * 0.75);
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
        const lineCount = Math.max(1, row.nameLines.length);
        const baseline = startY + firstRowOffset + displayLine * rowStep;
        const entry = svgElement('g');
        entry.setAttribute('class', 'inventoryEntry bay');
        entry.id = `${pageRole}_${scale}_bay_${index + 1}`;
        setInventoryComponentIds(entry, row.componentIds);
        entry.appendChild(transparentRect(x(3), y(baseline - rowStep), x(columns.mainButtonWidth), y(rowStep * lineCount),
            'inventoryEntryButton mainButton'));
        columns.rangeX.forEach((position, rangeIndex) => entry.appendChild(
            transparentRect(x(position - columns.rangeMaxWidth / 2), y(baseline - rowStep),
                x(columns.rangeMaxWidth), y(rowStep),
                `inventoryEntryButton ${['shrButton', 'medButton', 'lngButton', 'extButton'][rangeIndex]}`),
        ));
        row.nameLines.forEach((name, lineIndex) => {
            addText(entry, name, x(lineIndex === 0 ? columns.nameX : columns.continuationX),
                y(baseline + lineIndex * rowStep), {
                    class: lineIndex === 0 ? 'name' : 'name continuation',
                    size: font(textSize), maxWidth: x(columns.nameMaxWidth),
                });
        });
        addText(entry, row.location, x(columns.locationX), y(baseline), {
            class: 'location', size: font(textSize), anchor: 'middle', maxWidth: x(columns.locationMaxWidth),
        });
        addText(entry, String(row.heat), x(columns.heatX), y(baseline), {
            class: 'heat', size: font(textSize), anchor: 'middle',
        });
        row.damageByRange.forEach((value, rangeIndex) => addText(entry, value,
            x(columns.rangeX[rangeIndex]), y(baseline), {
                class: ['range_short', 'range_medium', 'range_long', 'range_extreme'][rangeIndex],
                size: font(textSize), anchor: 'middle', maxWidth: x(columns.rangeMaxWidth),
            }));
        group.appendChild(entry);
        displayLine += lineCount;
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
    const textSize = Math.min(6.76, rowStep * 0.75);
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
    const textSize = Math.min(6.76, rowStep * 0.75);
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
    const textSize = Math.min(6.76, rowStep * 0.75);
    addText(group, 'Cargo:', x(columns.sectionX), y(startY), { size: font(textSize), weight: 700 });
    cargoLines.forEach((line, index) => addText(group, line, x(columns.sectionX), y(startY + rowStep * (index + 1)), {
        size: font(textSize), maxWidth: x(columns.cargoMaxWidth),
    }));
    return startY + rowStep * (cargoLines.length + 2);
}

function drawLargeAeroFooter(
    group: SVGGElement,
    entity: AeroEntity,
    x: (value: number) => number,
    y: (value: number) => number,
    font: (value: number) => number,
    baseline: number,
    rowStep: number,
    maxWidth: number,
): void {
    const textSize = Math.min(6.76, rowStep * 0.75);
    addText(group, `Fuel Points: ${formatWholeNumber(entity.fuel())}`, x(8.41), y(baseline), {
        size: font(textSize), maxWidth: x(maxWidth),
    });
    const featureText = capitalAeroFeatures(entity);
    if (featureText) addText(group, `Features ${featureText}`, x(8.41), y(baseline + rowStep), {
        size: font(textSize), maxWidth: x(maxWidth),
    });
}

function largeAeroBlockLineCount(
    content: LargeAeroPageContent,
    blocks: ReadonlySet<LargeAeroRecordSheetBlock>,
): number {
    let count = 0;
    if (blocks.has('capital-weapons')) count += inventoryLineCount(content.capitalRows, false) + 3;
    if (blocks.has('ar10-munitions')) count += 5;
    if (blocks.has('standard-weapons')) count += inventoryLineCount(content.standardRows, true) + 3;
    if (blocks.has('grav-decks')) count += Math.ceil(content.gravDecks.length / 2) + 2;
    if (blocks.has('transport-bays')) count += content.cargoLines.length + 2;
    if (blocks.has('footer')) count += 2;
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

interface LargeAeroReferenceHeader {
    readonly width: number;
    readonly textLength: number;
}

function addLargeAeroReferenceFrame(
    svg: SVGSVGElement,
    title: string,
    box: Box,
    header: LargeAeroReferenceHeader,
): SVGGElement {
    const group = addFrame(svg, title, box, {
        headerWidth: header.width,
        // SvgFrameUtil adds the same 2.5px padding above and below explicit
        // content height, so 10 produces MegaMekLab's 15px title tab.
        headerHeight: 10,
        headerFontSize: 10.6,
        headerAngleDegrees: 56.31,
        cornerAngleDegrees: { topLeft: 56.31, topRight: 45, bottomRight: 45, bottomLeft: 45 },
    });
    const headerGroup = Array.from(group.children).find(
        (child): child is SVGGElement => child.tagName.toLowerCase() === 'g'
            && child.querySelector('.svg-frame-title') !== null,
    );
    const headerText = headerGroup?.querySelector<SVGTextElement>('.svg-frame-title');
    if (headerGroup) headerGroup.setAttribute('transform', 'translate(2.5 3)');
    if (headerText) {
        headerText.setAttribute('x', formatNumber(header.width / 2));
        headerText.setAttribute('y', '11.25');
        headerText.setAttribute('textLength', formatNumber(header.textLength));
        headerText.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
    return group;
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
    const group = addLargeAeroReferenceFrame(
        svg,
        `${capitalAeroDataPanelTitle(entity)} (Cont.)`,
        box,
        { width: 93.209, textLength: 75.646 },
    );
    group.setAttribute('data-mekbay-region', 'aero-data-continuation');
    const sx = box.width / 278.5;
    const sy = box.height / 662.643;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);
    addText(group, 'Type:', x(6), y(28), { size: font(9.67), weight: 700 });
    const type = addText(group, entity.displayName(), x(32.229), y(28), {
        size: font(9.67), weight: 700, maxWidth: x(238),
    });
    type.id = 'type';
    addText(group, 'Name:', x(3), y(38), { size: font(9.67), weight: 700 });
    const fluffName = addText(group, '', x(34.798), y(38), { size: font(9.67), maxWidth: x(92.115) });
    fluffName.id = 'fluffName';
    addLine(group, x(34.798), y(39), x(126.913), y(39), '#000', 0.72 * Math.min(sx, sy));
    addLine(group, x(3), y(43), x(274), y(43), '#000', 1.932 * Math.min(sx, sy));
    addText(group, 'Weapons & Equipment Inventory', x(3), y(53), {
        size: font(8.6), weight: 700, maxWidth: x(121.508),
    });
    const reverseLines = largeAeroBlockLineCount(content, content.plan.reverse);
    const rowStep = Math.max(6.4, Math.min(9.126, 570 / Math.max(1, reverseLines)));
    const compressed = rowStep / 9.126;
    const geometry = largeAeroInventoryGeometry(
        group,
        x,
        y,
        font,
        rowStep,
        REVERSE_INVENTORY_COLUMNS,
        10.8 * compressed,
        20.7 * compressed,
    );
    drawLargeAeroBlocks(geometry, entity, content, content.plan.reverse, 63.8, 'reverse');
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
    const scaleX = box.width / source.width;
    const scaleY = box.height / source.height;
    const wrapper = svgElement('g');
    wrapper.setAttribute(regionAttribute, region);
    wrapper.setAttribute(
        'transform',
        `translate(${formatNumber(box.x - source.x * scaleX)} ${formatNumber(box.y - source.y * scaleY)}) scale(${formatNumber(scaleX)} ${formatNumber(scaleY)})`,
    );
    wrapper.appendChild(group);
    svg.appendChild(wrapper);
}

function capitalAeroInventoryRows(
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
        const groups = new Map<string, {
            readonly equipment: EntityMountedWeapon['equipment'];
            readonly mounts: EntityMountedWeapon[];
        }>();
        weapons.forEach(mount => {
            const existing = groups.get(mount.equipment.id);
            if (existing) existing.mounts.push(mount);
            else groups.set(mount.equipment.id, { equipment: mount.equipment, mounts: [mount] });
        });
        const enhancements = weapons.map(mount => entity.getLinkingMount(mount)?.equipment);
        const marker = enhancements.some(equipment => artemisKind(equipment) === 'iv') ? '*'
            : enhancements.length > 0 && enhancements.every(equipment => artemisKind(equipment) === 'v') ? '†'
                : enhancements.length > 0 && enhancements.every(isApolloEquipment) ? '‡'
                    : '';
        const footnote = marker === '*' ? '* w/Artemis IV'
            : marker === '†' ? '† w/Artemis V (-1 to hit)'
                : marker === '‡' ? '‡ w/Apollo (ignore +1 to hit)'
                    : undefined;
        const nameLines = [...groups.values()].map((group, index) => {
            const matchingAmmo = bay.ammo.filter(mount =>
                mount.equipment instanceof AmmoEquipment
                && ammoMatchesWeapon(group.equipment, mount.equipment));
            let ammoText = '';
            if (matchingAmmo.length > 0) {
                if (group.equipment.ammoType === 'AR10') {
                    const details = matchingAmmo.map(mount =>
                        `${formatWholeNumber(mount.getAmmoShots() ?? 0)} ${mount.equipment?.shortName ?? mount.displayName()}`);
                    ammoText = ` (${details.join(', ')})`;
                } else {
                    const unit = group.equipment.capital && group.equipment.hasWeaponTrait('missile')
                        ? 'missiles'
                        : 'rounds';
                    ammoText = ` (${formatWholeNumber(matchingAmmo[0].getAmmoShots() ?? 0)} ${unit})`;
                }
            }
            const capacitorCount = group.mounts.filter(mount =>
                isPpcCapacitorEquipment(entity.getLinkingMount(mount)?.equipment)).length;
            const capacitorText = capacitorCount === group.mounts.length && capacitorCount > 0
                ? ' w/Capacitor'
                : capacitorCount > 0
                    ? ` w/${capacitorCount} ${capacitorCount === 1 ? 'Capacitor' : 'Capacitors'}`
                    : '';
            const suffix = index === 0
                ? `${marker}${groups.size > 1 ? ',' : ''}`
                : '';
            return `${group.mounts.length} ${group.equipment.shortName}${ammoText}${capacitorText}${suffix}`;
        });
        const location = capitalAeroInventoryLocation(entity, weapons[0].getOccupiedLocations());
        const capitalDamage = [0, 0, 0, 0];
        const bayDamage = [0, 0, 0, 0];
        const standardDamage = [0, 0, 0, 0];
        for (const group of groups.values()) {
            const values = aerospaceAttackValues(group.equipment, null);
            if (capitalScale) {
                values.forEach((value, rangeIndex) => {
                    capitalDamage[rangeIndex] += Math.max(0, value) * group.mounts.length;
                });
                continue;
            }
            if (group.equipment.ammoType === 'ATM' || group.equipment.ammoType === 'IATM') {
                const base = Math.ceil(Math.max(0, values[0] ?? 0) * group.mounts.length
                    * (group.equipment.ammoType === 'IATM' ? 1 : 0.5));
                const totals = [Math.ceil(base * 1.5), base, Math.ceil(base * 0.5), Math.ceil(base * 0.5)];
                totals.forEach((total, rangeIndex) => {
                    standardDamage[rangeIndex] += total;
                    bayDamage[rangeIndex] += Math.round(total / 10);
                });
                continue;
            }
            const bonus = group.mounts.reduce((total, mount) => total
                + capitalAeroEnhancementBonus(group.equipment, entity.getLinkingMount(mount)?.equipment), 0);
            values.forEach((value, rangeIndex) => {
                if (value <= 0) return;
                const standardValue = value * group.mounts.length + bonus;
                const capitalValue = rangeIndex === 0 && group.equipment.ammoType === 'MML'
                    ? standardValue * 2
                    : standardValue;
                standardDamage[rangeIndex] += standardValue;
                bayDamage[rangeIndex] += Math.round(capitalValue / 10);
            });
        }
        const damage = (capitalScale ? capitalDamage : standardDamage).map((value, rangeIndex) => {
            if (value <= 0) return '—';
            return capitalScale
                ? formatWholeNumber(value)
                : `${formatWholeNumber(bayDamage[rangeIndex])} (${formatWholeNumber(value)})`;
        }) as [string, string, string, string];
        const row: CapitalAeroInventoryRow = {
            nameLines,
            location: location.label,
            heat: weapons.reduce((total, mount) => total + mount.equipment.heat
                + (isPpcCapacitorEquipment(entity.getLinkingMount(mount)?.equipment)
                    ? PPC_CAPACITOR_HEAT_BONUS : 0), 0),
            damageByRange: damage,
            componentIds: weapons.map(mount => mount.mountId),
            sortOrder: location.sortOrder,
            footnote,
        };
        rows.push(row);
    }
    return rows.sort((left, right) => left.sortOrder - right.sortOrder);
}

function capitalAeroEnhancementBonus(
    weapon: EntityMountedWeapon['equipment'],
    enhancement: EntityMountedEquipment['equipment'] | undefined,
): number {
    if (!enhancement) return 0;
    const kind = artemisKind(enhancement);
    if (kind === 'iv' || kind === 'v') {
        if (weapon.ammoType === 'MML') {
            if (weapon.rackSize >= 7) return 2;
            if (weapon.rackSize >= 5 || kind === 'v') return 1;
        } else if (weapon.hasWeaponTrait('lrm')) {
            return Math.floor(weapon.rackSize / 5);
        } else if (weapon.hasWeaponTrait('srm')) {
            return 2;
        }
    } else if (kind === 'prototype' && weapon.rackSize === 2) {
        return 2;
    } else if (isPpcCapacitorEquipment(enhancement)) {
        return PPC_CAPACITOR_DAMAGE_BONUS;
    }
    return 0;
}

function capitalAeroUsesCapitalScale(entity: AeroEntity): boolean {
    return entity.equipmentBays().some(bay => bay.kind === 'weapon-bay'
        && bay.weapons.some(mount => mount.equipment.capital || mount.equipment.subCapital));
}

function capitalAeroInventoryLocation(
    entity: AeroEntity,
    locations: readonly string[],
): { readonly label: string; readonly sortOrder: number } {
    const code = entity.componentLocationLabel(locations[0] ?? '').toUpperCase();
    const paired = ({
        FLS: 'FLS/FRS', FRS: 'FLS/FRS',
        LBS: 'LBS/RBS', RBS: 'LBS/RBS',
        ALS: 'ALS/ARS', ARS: 'ALS/ARS',
    } as Readonly<Record<string, string>>)[code] ?? (code || '—');
    const orderByLocation: Readonly<Record<string, number>> = {
        NOS: 0, NOSE: 0, 'FLS/FRS': 1, 'LBS/RBS': 2, 'ALS/ARS': 3, AFT: 4,
    };
    const order = orderByLocation[paired] ?? 5;
    return { label: paired, sortOrder: order };
}

function capitalAeroCargoLines(entity: AeroEntity): readonly string[] {
    return projectRecordSheetBays(entity.transporters()).map(group => {
        const members = group.members
            .map(member => `${member.typeName} (${formatWholeNumber(member.capacity)})`)
            .join(' + ');
        return `Bay ${group.bayNumber}: ${members} (${group.doors} ${group.doors === 1 ? 'Door' : 'Doors'})`;
    }).slice(0, 9);
}

function capitalAeroFeatures(entity: AeroEntity): string {
    const features: string[] = [];
    if (entity instanceof JumpShipEntity && entity.lithiumFusion()) features.push('LF Battery');
    if ((entity instanceof JumpShipEntity && entity.hpg())
        || entity.equipment().some(mount => isMobileHpgEquipment(mount.equipment))) {
        features.push('Mobile HPG');
    }
    return features.join(', ');
}

function drawLargeAeroDiagramHeader(
    svg: SVGSVGElement,
    capital: boolean,
    page: RecordSheetLayoutRequest['page'],
): void {
    const origin = scalePageBox(page, { x: 510.009, y: 18, width: 83.991, height: 24.25 });
    const group = svgElement('g');
    group.setAttribute('class', 'aero-diagram-header large-aero-diagram-header');
    group.setAttribute(
        'transform',
        `translate(${formatNumber(origin.x)} ${formatNumber(origin.y)}) `
        + `scale(${formatNumber(page.horizontalScale)} ${formatNumber(page.verticalScale)})`,
    );
    addDiagramHeading(
        group,
        'ARMOR DIAGRAM',
        capital ? 'Capital Scale' : 'Standard Scale',
        83.991,
        0,
        {
            titleWidth: 83.991,
            titleX: 0,
            titleY: 0,
            titleTextLength: 69.539,
            ribbonX: -18,
            ribbonY: 0,
            ribbonWidth: 123.749,
            ribbonCut: 3.749,
            subtitleX: 41.996,
            subtitleY: 18.25,
            subtitleFontSize: 6.2,
        },
    );
    svg.appendChild(group);
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
    const rows: LargeAeroCriticalRow[] = [
        criticalRow('Avionics', 6, standardRows.first, 56.46,
            ['avionics_hit_1', 'avionics_hit_2', 'avionics_hit_3'], ['+1', '+2', '+5']),
        criticalRow(capital ? 'CIC' : 'FCS', 6, standardRows.second, 56.46,
            capital ? ['cic_hit_1', 'cic_hit_2', 'cic_hit_3'] : ['fcs_hit_1', 'fcs_hit_2', 'fcs_hit_3'],
            capital ? ['2', '4', 'D'] : ['2', '4', 'D']),
        criticalRow('Sensors', 6, standardRows.third, 56.46,
            ['sensor_hit_1', 'sensor_hit_2', 'sensor_hit_3'], ['+1', '+2', '+5']),
    ];
    if (entity.entityType === 'DropShip') {
        rows.push(
            criticalRow('Landing Gear', 115.14, standardRows.first, 47.3, ['landing_gear_hit_1'], ['+5']),
            criticalRow('Life Support', 115.14, standardRows.second, 47.3, ['life_support_hit_1'], ['+2']),
            criticalRow('K-F Boom', 115.14, standardRows.third, 47.3, ['kf_boom_hit_1'], ['D']),
            criticalRow('Docking Collar', 115.14, 79.202, 47.3, ['docking_collar_hit_1'], ['D']),
        );
    } else {
        const lifeSupportId = entity.entityType === 'WarShip' ? 'life_support_hit' : 'life_support_hit_1';
        rows.push(criticalRow('Life Support', 115.14, standardRows.first, 47.3, [lifeSupportId], ['+2']));
    }
    const thrusterLabelY = spaceStation ? 98.745 : 90.002;
    const leftThrusterY = spaceStation ? 107.929 : 96.688;
    const rightThrusterY = spaceStation ? 127.914 : 114.174;
    addText(group, 'Thrusters', x(6), y(thrusterLabelY), {
        size: font(6.76), weight: 700,
    });
    rows.push(
        criticalRow('Left', 18, leftThrusterY, 44.46,
            ['thruster_left_hit_1', 'thruster_left_hit_2', 'thruster_left_hit_3', 'thruster_left_hit_4'],
            ['+1', '+2', '+3', 'D']),
        criticalRow('Right', 18, rightThrusterY, 44.46,
            ['thruster_right_hit_1', 'thruster_right_hit_2', 'thruster_right_hit_3', 'thruster_right_hit_4'],
            ['+1', '+2', '+3', 'D']),
    );
    if (!spaceStation) {
        rows.push(criticalRow('Engine', 6, 131.661, 56.46,
            ['engine_hit_1', 'engine_hit_2', 'engine_hit_3', 'engine_hit_4', 'engine_hit_5', 'engine_hit_6'],
            ['-1', '-2', '-3', '-4', '-5', 'D']));
    }
    rows.forEach(row => drawLargeAeroCriticalRow(group, row, { x, y, font }));
}

function criticalRow(
    label: string,
    x: number,
    y: number,
    controlX: number,
    ids: readonly string[],
    modifiers: readonly string[],
): LargeAeroCriticalRow {
    return { label, x, y, controlX, ids, modifiers };
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
        size: scale.font(6.76), weight: 700, maxWidth: scale.x(row.controlX - 3),
    });
    row.ids.forEach((id, index) => {
        const controlX = row.x + row.controlX + index * 15;
        const control = svgElement('rect');
        control.id = id;
        control.setAttribute('critId', id);
        setAttributes(control, {
            x: scale.x(controlX),
            y: scale.y(row.y),
            width: scale.x(12),
            height: scale.y(12),
            rx: scale.x(1.315),
            fill: 'none',
            stroke: '#000',
            'stroke-width': 0.96,
            class: 'critLoc criticalPip',
        });
        group.appendChild(control);
        const modifier = addText(group, row.modifiers[index], scale.x(controlX + 6), scale.y(row.y + 7.6), {
            size: scale.font(5.7), anchor: 'middle', maxWidth: scale.x(9),
        });
        modifier.style.pointerEvents = 'none';
    });
}

function drawLargeAeroPilotPanel(svg: SVGSVGElement, entity: AeroEntity, box: Box): void {
    const group = addFrame(svg, 'PILOT DATA', box, {
        cornerAngleDegrees: { topRight: 0, bottomLeft: 0, bottomRight: 45 },
    });
    group.setAttribute('data-mekbay-region', 'pilot-data');
    const sx = box.width / 142.6;
    const sy = box.height / 93.934;
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * Math.min(sx, sy);

    addText(group, 'Gunnery Skill:', x(3), y(29.986), { size: font(6.76), weight: 700, maxWidth: x(39.172) });
    const gunnery = addText(group, '4', x(47.672), y(29.986), { size: font(6.76), class: 'skillValue' });
    gunnery.id = 'gunnerySkill0';
    addLine(group, x(47.672), y(30.986), x(65.82), y(30.986), '#000', 0.72);
    addText(group, 'Piloting Skill:', x(69.8), y(29.986), { size: font(6.76), weight: 700, maxWidth: x(36.72) });
    const piloting = addText(group, '5', x(114.472), y(29.986), { size: font(6.76), class: 'skillValue' });
    piloting.id = 'pilotingSkill0';
    addLine(group, x(114.472), y(30.986), x(136.6), y(30.986), '#000', 0.72);
    for (const [skill, left, width] of [['gunnery', 44, 24], ['piloting', 111, 27]] as const) {
        const button = transparentRect(x(left), y(20.5), x(width), y(13), 'crewSkillButton');
        button.setAttribute('crewId', '0');
        button.setAttribute('skill', skill);
        group.appendChild(button);
    }

    const table = svgElement('rect');
    setAttributes(table, {
        x: x(48.86), y: y(35.979), width: x(87.74), height: y(20), rx: x(1.015),
        fill: 'none', stroke: '#000', 'stroke-width': 1,
    });
    group.appendChild(table);
    addLine(group, x(48.86), y(45.979), x(136.6), y(45.979), '#000', 0.58);
    const columns = [56.172, 70.795, 85.418, 100.042, 114.665, 129.288];
    columns.slice(1).forEach(column => addLine(
        group, x(column - 7.312), y(35.979), x(column - 7.312), y(55.979), '#000', 0.58,
    ));
    columns.forEach((column, index) => {
        addText(group, String(index + 1), x(column), y(42.979), {
            size: font(5.8), weight: 700, anchor: 'middle',
        });
        addText(group, index === 5 ? 'Incp.' : `+${index + 1}`, x(column), y(52.979), {
            size: font(5.8), weight: 700, anchor: 'middle', maxWidth: x(13),
        });
        const hit = transparentRect(x(column - 7.2), y(35.979), x(14.4), y(10), 'crewHit');
        hit.id = `crew_damage_0_${index + 1}`;
        hit.setAttribute('crewId', '0');
        hit.setAttribute('hit', String(index + 1));
        group.appendChild(hit);
    });
    addText(group, 'Hits Taken', x(45.86), y(42.979), { size: font(5.2), weight: 700, anchor: 'end' });
    addText(group, 'Modifier', x(45.86), y(52.979), { size: font(5.2), weight: 700, anchor: 'end' });

    const personnel = largeAeroPersonnel(entity);
    const facts: readonly [string, number, number, number, string][] = [
        ['Crew:', personnel.crew, 6, 63.969, 'nCrew'],
        ['Passengers:', personnel.passengers, 6, 71.969, 'nPassengers'],
        ['Other:', personnel.other, 6, 79.969, 'nOther'],
        ['Marines:', personnel.marines, 72.8, 63.969, 'nMarines'],
        ['BattleArmor:', personnel.battleArmor, 72.8, 71.969, 'nBattleArmor'],
    ];
    facts.forEach(([label, value, left, baseline, id]) => {
        addText(group, label, x(left), y(baseline), { size: font(6.76), weight: 700 });
        const valueX = left < 70 ? 61.84 : 128.64;
        const node = addText(group, String(value), x(valueX), y(baseline), { size: font(6.76) });
        node.id = id;
    });
    const boats = addText(
        group,
        `Life Boats/Escape Pods: ${personnel.lifeboats}/${personnel.escapePods}`,
        x(72.8),
        y(89.539),
        { size: font(6.76), weight: 700, maxWidth: x(66) },
    );
    boats.id = 'lifeBoatsEscapePods';
    const state = transparentRect(x(2), y(17), x(138), y(74), 'crewStateButton');
    state.setAttribute('crewId', '0');
    group.insertBefore(state, group.children[2] ?? null);
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
    if (entity.heatSinkType() === 'Double') {
        addText(group, `(${heatSinkCount * 2})`, x(29.7), y(57), {
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
        : entity.entityType === 'DropShip'
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
    rows.forEach(([label, value, id], index) => {
        const baseline = start + index * 8;
        addText(group, label, x(65.3), y(baseline), {
            size: font(6.76), maxWidth: x(75),
        });
        const valueX = entity.entityType === 'JumpShip' || entity.entityType === 'SpaceStation' ? 145.4 : 154.3;
        const node = addText(group, String(value), x(valueX), y(baseline), {
            size: font(6.76), anchor: 'middle', maxWidth: x(28),
        });
        node.id = id;
    });
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
        locations.forEach(location => {
            const code = entity.componentLocationLabel(location).toUpperCase().replaceAll(/[^A-Z]/gu, '');
            byCode.set(code, (byCode.get(code) ?? 0) + mount.equipment.heat / divisor);
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
        leftAft: sum('LWR', 'LSR', 'ALS'),
        rightAft: sum('RWR', 'RSR', 'ARS'),
        aft: sum('AFT', 'REAR'),
    };
}
