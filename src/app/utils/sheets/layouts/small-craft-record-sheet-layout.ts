// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import type { AeroEntity } from '../../../models/entity/entities/aero/aero-entity';
import { isAeroEntity } from '../../../models/entity/utils/entity-type-guards';
import { fullRecordSheetLayoutProfile, type RecordSheetLayoutProfile, type RecordSheetPageFormat } from '../record-sheet-layout';
import { type InventoryWeaponStateKey } from '../record-sheet-weapon-grouping';
import { addPageIssuesNote, createRoot, drawGeneratedFooter, drawHeatScale, drawPageChrome, type Box } from '../record-sheet-svg-rendering';
import { drawFighterCriticalPanel, drawFighterPilotPanel } from './aero-fighter-record-sheet-controls';
import type { EntityMountedEquipment } from '../../../models/entity/types';
import { recordSheetFeatures } from '../record-sheet-features';
import { aeroInventoryEquipmentRows, aeroInventoryWeaponRows, aeroPageBox, drawAeroArtworkRegion, drawAeroDiagramHeader, drawAeroDataPanel, drawAeroHeatDataPanel, drawAeroMovementCompass, drawAeroPaperdoll, drawAeroVelocityPanel, AERO_LOWER_PANEL_BOX, type AeroDataInventoryRow } from './aero-record-sheet-components';
import type { RecordSheetLayout, RecordSheetLayoutRequest } from './record-sheet-layout';

/** Small Craft have fighter-style mount rows and a distinct lower-page composition. */
export class SmallCraftRecordSheetLayout implements RecordSheetLayout {
    public readonly id = 'small-craft';

    public matches(entity: BaseEntity): boolean {
        return isAeroEntity(entity) && entity.entityType === 'SmallCraft';
    }

    public profile(entity: BaseEntity, pageFormat: RecordSheetPageFormat = 'letter'): RecordSheetLayoutProfile {
        if (!this.matches(entity)) throw new Error('Small-craft layout requires a Small Craft entity');
        return fullRecordSheetLayoutProfile(pageFormat);
    }

    public async generate(entity: BaseEntity, request: RecordSheetLayoutRequest): Promise<SVGSVGElement> {
        if (!isAeroEntity(entity) || !this.matches(entity)) throw new Error('Small-craft layout requires a Small Craft entity');
        const page = request.page;
        const svg = createRoot(page.width, page.height, 'smallcraft');
        const at = (box: Box): Box => aeroPageBox(page, box);
        const motive = entity.getMotiveTypeAsString()?.toUpperCase() ?? 'AERODYNE';
        drawPageChrome(svg, `${motive} SMALL CRAFT RECORD SHEET`, page, false);
        addPageIssuesNote(svg, entity, page);
        const dataBox = at({ x: 18.966, y: 87.857, width: 222.4, height: 310.143 });
        drawAeroDataPanel(svg, entity, dataBox, 310.143, {
            panelTitle: 'CRAFT DATA', identity: 'small-craft',
            inventoryRows: stateKey => this.smallCraftInventoryRows(entity, stateKey),
            groupWeapons: request.groupWeapons,
            flowCargoAfterInventory: true, showAmmoSummary: true, featureText: recordSheetFeatures(entity).join(', '),
            showQuirks: request.showQuirks, ruleset: request.ruleset,
        });
        await drawAeroPaperdoll(svg, entity, at({ x: 249.651, y: 18, width: 344, height: 440 }), 440, {
            assetUrl: `/images/paperdolls/smallcraft-${motive.includes('SPHEROID') ? 'spheroid' : 'aerodyne'}.svg`,
            capitalFallback: false, pipLayout: request.pipLayout,
        });
        drawAeroDiagramHeader(svg, page, 'vessel', 'Standard Scale');
        drawAeroMovementCompass(svg, at({ x: 249.651, y: 456.4, width: 90, height: 50 }));
        drawAeroArtworkRegion(svg, at({ x: 43, y: 404, width: 193, height: 96 }));
        drawFighterPilotPanel(svg, at({ x: 251.4, y: 509.4, width: 142.6, height: 93.934 }));
        drawFighterCriticalPanel(svg, entity, at({ x: 18.966, y: 509.4, width: 220.4, height: 93.934 }));
        drawAeroVelocityPanel(svg, at(AERO_LOWER_PANEL_BOX));
        drawAeroHeatDataPanel(svg, entity, at({ x: 405.456, y: 509.4, width: 161, height: 246.6 }));
        if (entity.tracksHeat()) drawHeatScale(svg, at({ x: 574, y: 388.911, width: 19.454, height: 366 }), 'aero');
        const catalyst = at({ x: 527.13, y: 59.25, width: 0, height: 0 });
        drawGeneratedFooter(svg, page, { catalystX: catalyst.x, catalystY: catalyst.y, catalystScale: 1.015 });
        return svg;
    }

    /**
     * Small Craft use one standard-scale record-sheet row per mounted weapon; a grouped inventory counts identical
     * weapons per row.
     */
    private smallCraftInventoryRows(entity: AeroEntity, stateKey: InventoryWeaponStateKey | null): readonly AeroDataInventoryRow[] {
        const spheroid = entity.motiveType() === 'Spheroid';
        const location = (mount: EntityMountedEquipment) => {
            const code = entity.componentLocationLabel(mount.getOccupiedLocations()[0] ?? mount.location).toUpperCase();
            const sideArcs: Readonly<Record<string, string>> = spheroid
                ? { LS: mount.rearMounted ? 'ALS' : 'FLS', RS: mount.rearMounted ? 'ARS' : 'FRS' }
                : { LS: 'LWG', RS: 'RWG' };
            return sideArcs[code] ?? (code || '—');
        };
        const rows = [...aeroInventoryWeaponRows(entity, stateKey, location),
            ...aeroInventoryEquipmentRows(entity, stateKey, location)];

        const implicit = entity.implicitSystemEquipment().map((equipment, index): AeroDataInventoryRow => ({
            id: `generated-small-craft-system-row@${index}`,
            kind: 'equipment',
            ...(stateKey === null ? {} : { quantity: 1 }),
            nameLines: [`${equipment.name}${/\bECM\b/iu.test(equipment.name) ? ' [E]' : ''}`],
            location: 'NOS',
            heat: '—',
            damageByRange: ['—', '—', '—', '—'],
            componentIds: [],
        }));
        return [...rows, ...implicit];
    }

}
