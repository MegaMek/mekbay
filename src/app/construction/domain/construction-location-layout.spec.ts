// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { VehicleEntity } from '../../models/entity/entities/vehicle/vehicle-entity';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { constructionLocationLayout } from './construction-location-layout';
import { CONSTRUCTION_UNIT_TYPES, createConstructionEntity } from './construction-factory';
import { getConstructionLocations } from './construction-rules';

describe('fixed construction location layouts', () => {
    const registry = createTestEquipmentRegistry();

    it('preserves the five-column desktop Mek and derives a fixed three-column compact layout', () => {
        const entity = createConstructionEntity('Biped', registry);
        expect(constructionLocationLayout(entity)).toEqual({ kind: 'mek',
            desktopColumns: [['LA'], ['LT', 'LL'], ['HD', 'CT'], ['RT', 'RL'], ['RA']],
            compactColumns: [['LA', 'LT', 'LL'], ['HD', 'CT'], ['RA', 'RT', 'RL']],
        });
        entity.setEquipment([]);
        entity.armorValues.set(new Map());
        expect(constructionLocationLayout(entity).compactColumns).toEqual([
            ['LA', 'LT', 'LL'], ['HD', 'CT'], ['RA', 'RT', 'RL'],
        ]);
    });

    it('uses the native Quad/QuadVee and Tripod critical topology', () => {
        for (const kind of ['Quad', 'QuadVee'] as const) {
            const layout = constructionLocationLayout(createConstructionEntity(kind, registry));
            expect(layout.desktopColumns).toEqual([['FLL'], ['LT', 'RLL'], ['HD', 'CT'], ['RT', 'RRL'], ['FRL']]);
            expect(layout.compactColumns).toEqual([['FLL', 'LT', 'RLL'], ['HD', 'CT'], ['FRL', 'RT', 'RRL']]);
        }
        expect(constructionLocationLayout(createConstructionEntity('Tripod', registry)).compactColumns)
            .toEqual([['LA', 'LT', 'LL'], ['HD', 'CT', 'CL'], ['RA', 'RT', 'RL']]);
    });

    it('keeps large vehicle flanks, both turrets and Body in fixed columns', () => {
        const entity = createConstructionEntity('LargeSupportTank', registry) as VehicleEntity;
        entity.hasTurret.set(true);
        entity.hasDualTurret.set(true);
        const layout = constructionLocationLayout(entity);
        expect(layout.kind).toBe('matrix');
        expect(layout.compactColumns).toEqual([
            ['Front Right', 'Rear Right'], ['Front', 'Front Turret', 'Body', 'Rear Turret', 'Rear'], ['Front Left', 'Rear Left'],
        ]);
    });

    it('retains aerospace storage and capital broadside locations even when empty', () => {
        expect(constructionLocationLayout(createConstructionEntity('FixedWingSupport', registry)).compactColumns)
            .toEqual([['Left Wing'], ['Nose', 'Body', 'Wings', 'Aft'], ['Right Wing']]);
        expect(constructionLocationLayout(createConstructionEntity('WarShip', registry)).compactColumns)
            .toEqual([['FLS', 'Left Broadside', 'ALS'], ['Nose', 'Hull', 'Aft'], ['FRS', 'Right Broadside', 'ARS']]);
    });

    for (const kind of CONSTRUCTION_UNIT_TYPES) {
        it(`renders every ${kind.id} construction location exactly once at each width`, () => {
            const entity = createConstructionEntity(kind.id, registry);
            const layout = constructionLocationLayout(entity);
            const expected = getConstructionLocations(entity).map(location => location.id).sort();
            for (const columns of [layout.desktopColumns, layout.compactColumns]) {
                expect(columns.flat().slice().sort()).toEqual(expected);
                expect(new Set(columns.flat()).size).toBe(expected.length);
                expect(columns.length).toBe(layout.kind === 'list' ? 1 : columns === layout.desktopColumns && layout.kind === 'mek' ? 5 : 3);
            }
        });
    }
});
