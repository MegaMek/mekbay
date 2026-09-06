// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import type { AeroEntity } from '../../../models/entity/entities/aero/aero-entity';
import { isAeroEntity } from '../../../models/entity/utils/entity-type-guards';
import { aerospaceAttackValues } from '../../aerospace-range.util';
import { formatRecordSheetWeaponDamageText } from '../../record-sheet-weapon-info.util';
import { appendRecordSheetEraIcon } from '../record-sheet-embedded-art';
import { fullRecordSheetLayoutProfile, type RecordSheetLayoutProfile, type RecordSheetPageFormat } from '../record-sheet-layout';
import { createRoot, drawGeneratedFooter, drawHeatScale, drawPageChrome, recordSheetInventoryWeaponMounts, scalePageBox, type Box } from '../record-sheet-svg-rendering';
import { drawFighterCriticalPanel, drawFighterPilotPanel } from './aero-fighter-record-sheet-controls';
import { drawAeroArtworkRegion, drawAeroDataPanel, drawAeroHeatDataPanel, drawAeroMovementCompass, drawAeroPaperdoll, drawAeroVelocityPanel, type AeroDataInventoryRow } from './aero-record-sheet-components';
import { drawLargeAeroDiagramHeader } from './large-aero-record-sheet-layout';
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
        const at = (box: Box): Box => scalePageBox(page, box);
        const motive = entity.getMotiveTypeAsString()?.toUpperCase() ?? 'AERODYNE';
        drawPageChrome(svg, `${motive} SMALL CRAFT RECORD SHEET`, page, false);
        const dataBox = at({ x: 18.966, y: 87.857, width: 222.4, height: 310.143 });
        const dataGroup = drawAeroDataPanel(svg, entity, dataBox, 310.143, {
            panelTitle: 'CRAFT DATA', identity: 'small-craft',
            inventoryRows: this.smallCraftInventoryRows(entity),
            flowCargoAfterInventory: true, showAmmoSummary: true, stationary: false,
        });
        await appendRecordSheetEraIcon(svg, dataGroup, entity.year(), {
            x: 158.563 * dataBox.width / 222.4, y: 285.25 * dataBox.height / 310.143,
            width: 20 * dataBox.width / 222.4, height: 20 * dataBox.height / 310.143,
        });
        await drawAeroPaperdoll(svg, entity, at({ x: 249.651, y: 18, width: 344, height: 440 }), 440, {
            assetUrl: `/images/paperdolls/smallcraft-${motive.includes('SPHEROID') ? 'spheroid' : 'aerodyne'}.svg`,
            capitalFallback: false, pipLayout: request.pipLayout,
        });
        drawLargeAeroDiagramHeader(svg, false, page);
        drawAeroMovementCompass(svg, at({ x: 249.651, y: 456.4, width: 90, height: 50 }));
        drawAeroArtworkRegion(svg, at({ x: 43, y: 404, width: 193, height: 96 }));
        drawFighterPilotPanel(svg, at({ x: 251.4, y: 509.4, width: 142.6, height: 93.934 }));
        drawFighterCriticalPanel(svg, entity, at({ x: 18.966, y: 509.4, width: 220.4, height: 93.934 }));
        drawAeroVelocityPanel(svg, at({ x: 18.966, y: 603.12, width: 377.7, height: 151.88 }));
        drawAeroHeatDataPanel(svg, entity, at({ x: 405.456, y: 509.4, width: 161, height: 246.6 }), true);
        if (entity.tracksHeat()) drawHeatScale(svg, at({ x: 574, y: 388.911, width: 19.454, height: 366 }));
        drawGeneratedFooter(svg, page, { catalystX: 527.13, catalystY: 59.25, catalystScale: 1.015 });
        return svg;
    }

    /** Small Craft use one standard-scale record-sheet row per mounted weapon. */
    private smallCraftInventoryRows(entity: AeroEntity): readonly AeroDataInventoryRow[] {
        const spheroid = entity.motiveType() === 'Spheroid';
        const rows = recordSheetInventoryWeaponMounts(entity).map((mount, index): AeroDataInventoryRow => {
            const ranges = aerospaceAttackValues(mount.equipment, null);
            const notation = formatRecordSheetWeaponDamageText(mount.equipment, '').trim();
            const displayName = mount.displayName();
            const name = notation && !displayName.includes(notation)
                ? `${displayName} ${notation}`
                : displayName;
            const occupied = mount.getOccupiedLocations();
            const sourceLocation = occupied[0] ?? mount.location;
            const code = entity.componentLocationLabel(sourceLocation).toUpperCase();
            const sideArcs: Readonly<Record<string, string>> = spheroid
                ? { LS: mount.rearMounted ? 'ALS' : 'FLS', RS: mount.rearMounted ? 'ARS' : 'FRS' }
                : { LS: 'LWG', RS: 'RWG' };
            return {
                id: `generated-small-craft-inventory-row@${index}`,
                kind: 'equipment',
                quantity: 1,
                nameLines: [name],
                location: sideArcs[code] ?? (code || '—'),
                heat: String(mount.equipment.heat),
                damageByRange: ranges.map(value => value > 0 ? String(value) : '—') as
                    [string, string, string, string],
                componentIds: [mount.mountId],
            };
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
        return [...rows, ...implicit];
    }

}
