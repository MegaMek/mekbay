// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import type { AeroEntity } from '../../../models/entity/entities/aero/aero-entity';
import { isAeroEntity } from '../../../models/entity/utils/entity-type-guards';
import { isSingleHeatSinkEquipment } from '../../../models/heat-equipment.model';
import { formatRecordSheetWeaponDamageText } from '../../record-sheet-weapon-info.util';
import { aerospaceAttackValues } from '../../aerospace-range.util';
import type { RecordSheetLayout, RecordSheetLayoutRequest } from './record-sheet-layout';
import {
    fullRecordSheetLayoutProfile,
    type RecordSheetLayoutProfile,
    type RecordSheetPageFormat,
} from '../record-sheet-layout';
import {
    type Box,
    addFrame,
    addText,
    createRoot,
    addDiagramHeading,
    constructionMaterialSubtitle,
    drawGeneratedFooter,
    drawHeatScale,
    drawPageChrome,
    formatNumber,
    scalePageBox,
    setAttributes,
    svgElement,
} from '../record-sheet-svg-rendering';
import { appendRecordSheetEraIcon } from '../record-sheet-embedded-art';
import {
    type AeroDataInventoryRow,
    drawAeroArtworkRegion,
    drawAeroDataPanel,
    drawAeroExternalStores,
    drawAeroHeatDataPanel,
    drawAeroMovementCompass,
    drawAeroPaperdoll,
    drawAeroVelocityPanel,
} from './aero-record-sheet-components';
import {
    drawFighterCriticalPanel,
    drawFighterPilotPanel,
} from './aero-fighter-record-sheet-controls';

/** Aerospace, conventional, and fixed-wing-support fighter composition. */
export class AeroFighterRecordSheetLayout implements RecordSheetLayout {
    public readonly id = 'aero-fighter';

    public matches(entity: BaseEntity): boolean {
        return isAeroEntity(entity) && (
            entity.entityType === 'Aero'
            || entity.entityType === 'ConvFighter'
            || entity.entityType === 'FixedWingSupport'
        );
    }

    public profile(
        entity: BaseEntity,
        pageFormat: RecordSheetPageFormat = 'letter',
    ): RecordSheetLayoutProfile {
        if (!this.matches(entity)) throw new Error('Aero-fighter layout requires a fighter entity');
        return fullRecordSheetLayoutProfile(pageFormat);
    }

    public async generate(
        entity: BaseEntity,
        request: RecordSheetLayoutRequest,
    ): Promise<SVGSVGElement> {
        if (!isAeroEntity(entity) || !this.matches(entity)) {
            throw new Error('Aero-fighter layout requires a fighter entity');
        }
        const page = request.page;
        const svg = createRoot(page.width, page.height, entity.entityType.toLowerCase());
        const conventional = entity.entityType === 'ConvFighter'
            || entity.entityType === 'FixedWingSupport';
        const at = (box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }) =>
            scalePageBox(page, box);

        drawPageChrome(svg, this.sheetTitle(entity), page, false);
        const dataBox = at({ x: 18.966, y: 87.857, width: 222.4, height: 308.357 });
        const dataGroup = drawAeroDataPanel(
            svg,
            entity,
            dataBox,
            308.357,
            {
                panelTitle: 'FIGHTER DATA',
                identity: 'fighter',
                inventoryRows: this.inventoryRows(entity),
                flowCargoAfterInventory: false,
                showAmmoSummary: true,
                stationary: false,
            },
        );
        await appendRecordSheetEraIcon(svg, dataGroup, entity.year(), {
            x: 158.563 * dataBox.width / 222.4,
            y: 285.25 * dataBox.height / 308.357,
            width: 20 * dataBox.width / 222.4,
            height: 20 * dataBox.height / 308.357,
        });
        await drawAeroPaperdoll(
            svg,
            entity,
            at({ x: 251.4, y: 18, width: 344, height: 440 }),
            440,
            {
                assetUrl: this.paperdollAsset(entity),
                capitalFallback: false,
            },
        );
        drawFighterDiagramHeader(svg, entity, page);
        if (!conventional) {
            drawAeroMovementCompass(svg, at({ x: 251.4, y: 456.4, width: 90, height: 50 }));
        }
        drawAeroExternalStores(svg, entity, at({ x: 467.534, y: 18, width: 124.466, height: 127 }));
        drawAeroArtworkRegion(svg, entity, at({ x: 43, y: 404, width: 193, height: 96 }));
        drawFighterPilotPanel(svg, at({ x: 251.4, y: 509.4, width: 142.6, height: 93.934 }));
        drawFighterCriticalPanel(svg, at({ x: 18.966, y: 509.4, width: 220.4, height: 93.934 }));
        drawAeroVelocityPanel(svg, at({ x: 18.966, y: 603.12, width: 377.7, height: 151.88 }));
        if (conventional) {
            drawGroundMapStraightMovementTable(svg, at({ x: 405.966, y: 509.4, width: 184, height: 157.89 }));
            drawFighterReturnTable(svg, at({ x: 405.966, y: 675.29, width: 184, height: 79.71 }));
        } else {
            drawAeroHeatDataPanel(svg, entity, at({ x: 405.456, y: 509.4, width: 161, height: 246.6 }), true);
        }
        if (entity.tracksHeat()) {
            drawHeatScale(svg, at({ x: 574, y: 388.911, width: 19.454, height: 366 }));
        }
        drawGeneratedFooter(svg, page, {
            catalystX: 521,
            catalystY: 476.987,
            catalystScale: 1.015,
        });
        return svg;
    }

    /** Fighter inventory projection belongs to the fighter family, not to the shared panel renderer. */
    private inventoryRows(entity: AeroEntity): readonly AeroDataInventoryRow[] {
        interface MutableRow {
            quantity: number;
            name: string;
            location: string;
            heat: string;
            damageByRange: [string, string, string, string];
            componentIds: string[];
        }
        const rows = new Map<string, MutableRow>();
        const ranged = new Set(entity.rangedWeapons());
        for (const mount of entity.rangedWeapons()) {
            const equipment = mount.equipment;
            const row: MutableRow = {
                quantity: 1,
                name: this.weaponRecordSheetName(mount.displayName(), equipment),
                location: this.inventoryLocation(entity, mount.getOccupiedLocations()),
                heat: String(equipment.heat),
                damageByRange: aerospaceAttackValues(equipment, null)
                    .map(value => value > 0 ? String(value) : '—') as [string, string, string, string],
                componentIds: [mount.mountId],
            };
            const key = JSON.stringify({ ...row, quantity: 0, componentIds: undefined });
            const existing = rows.get(key);
            if (existing) {
                existing.quantity++;
                existing.componentIds.push(mount.mountId);
            } else {
                rows.set(key, row);
            }
        }
        for (const mount of entity.equipment()) {
            if (ranged.has(mount as never) || mount.getAmmoShots() !== undefined) continue;
            const equipment = mount.equipment;
            if (!equipment) continue;
            if (equipment.type === 'armor' || equipment.type === 'structure'
                || isSingleHeatSinkEquipment(equipment)) continue;
            if (/engine|cockpit|landing gear|fuel|avionics|life support/iu.test(mount.displayName())) continue;
            const row: MutableRow = {
                quantity: 1,
                name: mount.displayName(),
                location: this.inventoryLocation(entity, mount.getOccupiedLocations()),
                heat: '—',
                damageByRange: ['—', '—', '—', '—'],
                componentIds: [mount.mountId],
            };
            const key = JSON.stringify({ ...row, quantity: 0, componentIds: undefined });
            const existing = rows.get(key);
            if (existing) {
                existing.quantity++;
                existing.componentIds.push(mount.mountId);
            } else {
                rows.set(key, row);
            }
        }
        return [...rows.values()].map((row, index) => ({
            id: `generated-aero-inventory-row@${index}`,
            kind: 'equipment',
            quantity: row.quantity,
            nameLines: [row.name],
            location: row.location,
            heat: row.heat,
            damageByRange: row.damageByRange,
            componentIds: row.componentIds,
        }));
    }

    private weaponRecordSheetName(
        displayName: string,
        weapon: ReturnType<AeroEntity['rangedWeapons']>[number]['equipment'],
    ): string {
        const notation = formatRecordSheetWeaponDamageText(weapon, '').trim();
        return notation && !displayName.includes(notation)
            ? `${displayName} ${notation}`
            : displayName;
    }

    private inventoryLocation(entity: AeroEntity, locations: readonly string[]): string {
        return locations.map(value => entity.componentLocationLabel(value)).filter(Boolean).join('/') || '—';
    }

    private sheetTitle(entity: AeroEntity): string {
        return entity.entityType === 'ConvFighter' || entity.entityType === 'FixedWingSupport'
            ? 'CONVENTIONAL FIGHTER RECORD SHEET'
            : 'AEROSPACE FIGHTER RECORD SHEET';
    }

    private paperdollAsset(entity: AeroEntity): string {
        return entity.entityType === 'ConvFighter' || entity.entityType === 'FixedWingSupport'
            ? '/images/paperdolls/fighter-conventional.svg'
            : '/images/paperdolls/fighter-aerospace.svg';
    }
}

function drawGroundMapStraightMovementTable(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'GROUND MAP STRAIGHT MOVEMENT', box);
    group.classList.add('referenceTable', 'ground-map-straight-movement-table');
    const sx = box.width / 184;
    const sy = box.height / 157.89;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;

    addText(group, 'MINIMUM STRAIGHT MOVEMENT', x(90.5), y(24.995), {
        size: font(5.7), weight: 700, anchor: 'middle',
    });
    addText(group, '(IN HEXES)', x(90.5), y(31.989), {
        size: font(5.7), weight: 700, anchor: 'middle',
    });
    addText(group, 'SMALL CRAFT AND FIXED', x(135.75), y(40.382), {
        size: font(5.7), weight: 700, anchor: 'middle',
    });
    addText(group, 'FIGHTER', x(72.4), y(47.377), {
        size: font(5.7), weight: 700, anchor: 'middle',
    });
    addText(group, 'WING SUPPORT VEHICLES', x(135.75), y(47.377), {
        size: font(5.7), weight: 700, anchor: 'middle',
    });

    const fighter = [8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52];
    const support = [8, 14, 20, 26, 32, 38, 44, 50, 56, 62, 68, 74];
    fighter.forEach((value, index) => {
        const baseline = 54.371 + index * 6.994;
        if (index % 2 === 1) appendReferenceShade(group, x(7), y(baseline - 5.865), x(170), y(7));
        addText(group, String(index + 1), x(27.15), y(baseline), {
            size: font(5.7), weight: 700, anchor: 'middle',
        });
        addText(group, String(value), x(72.4), y(baseline), {
            size: font(5.7), anchor: 'middle',
        });
        addText(group, String(support[index]), x(135.75), y(baseline), {
            size: font(5.7), anchor: 'middle',
        });
    });
    addText(group, 'Velocity above 12 is not possible on ground maps.', x(90.5), y(145.3), {
        size: font(5.7), anchor: 'middle', maxWidth: x(170),
    });
}

function drawFighterReturnTable(svg: SVGSVGElement, box: Box): void {
    const group = addFrame(svg, 'FIGHTER RETURN TABLE', box);
    group.classList.add('referenceTable', 'fighter-return-table');
    const sx = box.width / 184;
    const sy = box.height / 79.71;
    const fontScale = Math.min(sx, sy);
    const x = (value: number): number => value * sx;
    const y = (value: number): number => value * sy;
    const font = (value: number): number => value * fontScale;
    addText(group, 'TURNS BEFORE RETURN', x(126.7), y(31.224), {
        size: font(5.7), weight: 700, anchor: 'middle',
    });
    const rows: readonly [string, string][] = [
        ['1-4', '3'], ['5-8', '2'], ['9-12', '1'], ['13+', '0'],
    ];
    rows.forEach(([turns, returns], index) => {
        const baseline = 40.04 + index * 8.816;
        if (index % 2 === 0) appendReferenceShade(group, x(7), y(baseline - 5.54), x(170), y(9));
        addText(group, turns, x(41.63), y(baseline), {
            size: font(5.7), weight: 700, anchor: 'middle',
        });
        addText(group, returns, x(126.7), y(baseline), {
            size: font(5.7), anchor: 'middle',
        });
    });
}

function appendReferenceShade(
    group: SVGGElement,
    x: number,
    y: number,
    width: number,
    height: number,
): void {
    const shade = svgElement('rect');
    setAttributes(shade, { x, y, width, height, fill: '#bbb', class: 'tableshading' });
    group.appendChild(shade);
}

function drawFighterDiagramHeader(
    svg: SVGSVGElement,
    entity: BaseEntity,
    page: RecordSheetLayoutRequest['page'],
): void {
    const origin = scalePageBox(page, { x: 276.4, y: 82.857, width: 83.991, height: 24.25 });
    const group = svgElement('g');
    group.setAttribute('class', 'aero-diagram-header fighter-diagram-header');
    group.setAttribute(
        'transform',
        `translate(${formatNumber(origin.x)} ${formatNumber(origin.y)}) `
        + `scale(${formatNumber(page.horizontalScale)} ${formatNumber(page.verticalScale)})`,
    );
    addDiagramHeading(
        group,
        'ARMOR DIAGRAM',
        constructionMaterialSubtitle(entity.uniformArmor()?.armor.name, 'Armor', 'Patchwork Armor'),
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
            subtitleY: 21.5,
        },
    );
    svg.appendChild(group);
}
