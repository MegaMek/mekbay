// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import type { AeroEntity } from '../../../models/entity/entities/aero/aero-entity';
import { recordSheetFeatures } from '../record-sheet-features';
import { isAeroEntity } from '../../../models/entity/utils/entity-type-guards';
import type { EntityMountedEquipment } from '../../../models/entity/types';
import { type InventoryWeaponStateKey } from '../record-sheet-weapon-grouping';
import {
fullRecordSheetLayoutProfile,
type RecordSheetLayoutProfile,
type RecordSheetPageFormat,
} from '../record-sheet-layout';
import {
addFrame,
addReferenceShade,
addText,
type Box,
armorDiagramSubtitle,
createRoot,
drawGeneratedFooter,
drawHeatScale,
drawPageChrome,
} from '../record-sheet-svg-rendering';
import {
drawFighterCriticalPanel,
drawFighterPilotPanel,
} from './aero-fighter-record-sheet-controls';
import {
type AeroDataInventoryRow,
aeroInventoryEquipmentRows,
aeroInventoryWeaponRows,
aeroPageBox,
drawAeroArtworkRegion,
drawAeroDataPanel,
drawAeroDiagramHeader,
drawAeroExternalStores,
drawAeroHeatDataPanel,
drawAeroMovementCompass,
drawAeroPaperdoll,
AERO_LOWER_PANEL_BOX,
drawAeroVelocityPanel,
} from './aero-record-sheet-components';
import type { RecordSheetLayout,RecordSheetLayoutRequest } from './record-sheet-layout';

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
            aeroPageBox(page, box);

        drawPageChrome(svg, this.sheetTitle(entity), page, false);
        const dataBox = at({ x: 18.966, y: 87.857, width: 222.4, height: 308.357 });
        drawAeroDataPanel(
            svg,
            entity,
            dataBox,
            308.357,
            {
                panelTitle: 'FIGHTER DATA',
                identity: 'fighter',
                inventoryRows: stateKey => this.inventoryRows(entity, stateKey),
                groupWeapons: request.groupWeapons,
                flowCargoAfterInventory: false,
                showAmmoSummary: true,
                showQuirks: request.showQuirks,
                ruleset: request.ruleset,
                featureText: recordSheetFeatures(entity).join(', '),
            },
        );
        await drawAeroPaperdoll(
            svg,
            entity,
            at({ x: 251.4, y: 18, width: 344, height: 440 }),
            440,
            {
                assetUrl: this.paperdollAsset(entity),
                pipLayout: request.pipLayout,
                capitalFallback: false,
            },
        );
        drawAeroDiagramHeader(svg, page, 'fighter', armorDiagramSubtitle(entity));
        if (!conventional) {
            drawAeroMovementCompass(svg, at({ x: 251.4, y: 456.4, width: 90, height: 50 }));
        }
        drawAeroExternalStores(svg, entity, at({ x: 467.534, y: 18, width: 124.466, height: 127 }));
        drawAeroArtworkRegion(svg, at({ x: 21, y: 402, width: 224.4, height: 101.4 }));
        drawFighterPilotPanel(svg, at({ x: 251.4, y: 509.4, width: 142.6, height: 93.934 }));
        drawFighterCriticalPanel(svg, entity, at({ x: 18.966, y: 509.4, width: 220.4, height: 93.934 }));
        drawAeroVelocityPanel(svg, at(AERO_LOWER_PANEL_BOX));
        if (conventional) {
            drawGroundMapStraightMovementTable(svg, at({ x: 405.966, y: 509.4, width: 184, height: 157.89 }));
            drawFighterReturnTable(svg, at({ x: 405.966, y: 675.29, width: 184, height: 79.71 }));
        } else {
            drawAeroHeatDataPanel(svg, entity, at({ x: 405.456, y: 509.4, width: 161, height: 246.6 }));
        }
        if (entity.tracksHeat()) {
            drawHeatScale(svg, at({ x: 574, y: 388.911, width: 19.454, height: 366 }), 'aero');
        }
        const catalyst = at({ x: 521, y: 476.987, width: 0, height: 0 });
        drawGeneratedFooter(svg, page, { catalystX: catalyst.x, catalystY: catalyst.y, catalystScale: 1.015 });
        return svg;
    }

    /** Fighter inventory projection belongs to the fighter family, not to the shared panel renderer. */
    private inventoryRows(entity: AeroEntity, stateKey: InventoryWeaponStateKey | null): readonly AeroDataInventoryRow[] {
        const location = (mount: EntityMountedEquipment) => this.inventoryLocation(entity, mount.getOccupiedLocations());
        return [...aeroInventoryWeaponRows(entity, stateKey, location),
            ...aeroInventoryEquipmentRows(entity, stateKey, location)];
    }

    private inventoryLocation(entity: AeroEntity, locations: readonly string[]): string {
        return locations.map(value => entity.componentLocationLabel(value)).filter(Boolean).join('/') || '—';
    }

    private sheetTitle(entity: AeroEntity): string {
        if (entity.entityType === 'FixedWingSupport') {
            const family = entity.motiveType() === 'Station Keeping' ? 'SATELLITE'
                : entity.motiveType() === 'Airship' ? 'AIRSHIP' : 'FIXED WING';
            return `${family} SUPPORT VEHICLE RECORD SHEET`;
        }
        return entity.entityType === 'ConvFighter'
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
    const group = addFrame(svg, 'GROUND MAP STRAIGHT MOVEMENT', box, { fullWidthHeader: true });
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
        if (index % 2 === 1) addReferenceShade(group, x(7), y(baseline - 5.865), x(170), y(7));
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
        if (index % 2 === 0) addReferenceShade(group, x(7), y(baseline - 5.54), x(170), y(9));
        addText(group, turns, x(41.63), y(baseline), {
            size: font(5.7), weight: 700, anchor: 'middle',
        });
        addText(group, returns, x(126.7), y(baseline), {
            size: font(5.7), anchor: 'middle',
        });
    });
}
