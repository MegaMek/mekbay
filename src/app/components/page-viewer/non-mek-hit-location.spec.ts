// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import {
    TestAeroSpaceFighterEntity,
    TestLargeSupportTankEntity,
    TestProtoMekEntity,
    TestSmallCraftEntity,
    TestSupportVtolEntity,
    TestTankEntity,
    TestVtolEntity,
    TestWarShipEntity,
} from '../../models/entity/testing/test-entities';
import type { NonMekRecordSheetSnapshot } from '../../models/runtime/non-mek-record-sheet';
import { nonMekHitArcs,resolveNonMekHitLocation,type NonMekHitArc } from './non-mek-hit-location';

describe('non-Mek paperdoll hit locations', () => {
    function snapshot(entity: BaseEntity): NonMekRecordSheetSnapshot {
        return { locations: entity.damageLocations().map(location => ({
            ...location, sheetCode: location.sheetCode, previewRemainingInternal: 1,
        })) } as unknown as NonMekRecordSheetSnapshot;
    }

    function rolls(entity: BaseEntity, arc: NonMekHitArc): string[] {
        const state = snapshot(entity);
        return Array.from({ length: 11 }, (_, index) =>
            resolveNonMekHitLocation(entity, state, arc, index + 2, () => 1)?.locationCode ?? 'missing');
    }

    it('uses the ordinary vehicle front and flank hit distributions and turret availability', () => {
        const entity = new TestTankEntity();
        expect(rolls(entity, 'front')).toEqual(['FR', 'FR', 'FR', 'LS', 'FR', 'FR', 'FR', 'LS', 'FR', 'FR', 'FR']);
        entity.hasTurret.set(true);
        expect(rolls(entity, 'left')).toEqual(['LS', 'LS', 'LS', 'FR', 'LS', 'LS', 'LS', 'RR', 'TU', 'TU', 'TU']);
        entity.hasDualTurret.set(true);
        expect(resolveNonMekHitLocation(entity, snapshot(entity), 'front', 10, () => 5)?.locationCode).toBe('FT');
        expect(resolveNonMekHitLocation(entity, snapshot(entity), 'rear', 12, () => 2)?.locationCode).toBe('RT');
    });

    it('uses six arcs on large vehicles without silently choosing a front or rear flank', () => {
        const entity = new TestLargeSupportTankEntity();
        entity.setTonnage(150);
        entity.motiveType.set('Naval');
        expect(entity.isSuperHeavy()).toBeFalse();
        expect(nonMekHitArcs(entity)).toEqual(['front', 'front-right', 'rear-right', 'rear', 'rear-left', 'front-left']);
        expect(rolls(entity, 'front-left')).toEqual(['FRLS', 'FR', 'FRLS', 'FRLS', 'FRLS', 'FRLS', 'FRLS', 'FRLS', 'FRLS', 'FRLS', 'FRLS']);
        expect(rolls(entity, 'rear-right')).toEqual(Array(11).fill('RRRS'));
        expect(resolveNonMekHitLocation(entity, snapshot(entity), 'front', 3, () => 1)?.locationCode).toBe('FRRS');
        expect(resolveNonMekHitLocation(entity, snapshot(entity), 'rear', 3, () => 1)?.locationCode).toBe('RRLS');
    });

    it('selects VTOL rotors and substitutes a turret on a four', () => {
        const entity = new TestVtolEntity();
        expect(rolls(entity, 'front')).toEqual(['FR', 'RO', 'RO', 'RS', 'FR', 'FR', 'FR', 'LS', 'RO', 'RO', 'RO']);
        entity.hasTurret.set(true);
        expect(resolveNonMekHitLocation(entity, snapshot(entity), 'left', 4, () => 1)?.locationCode).toBe('TU');
    });

    it('retains four arcs on support VTOLs above the superheavy weight threshold', () => {
        const entity = new TestSupportVtolEntity();
        entity.setTonnage(40);
        entity.motiveType.set('VTOL');
        expect(entity.isSuperHeavy()).toBeTrue();
        expect(nonMekHitArcs(entity)).toEqual(['front', 'right', 'rear', 'left']);
        for (const arc of nonMekHitArcs(entity)) {
            expect(rolls(entity, arc)).not.toContain('missing');
        }
    });

    it('preserves ProtoMek near misses and transfers unavailable parts to the torso', () => {
        const entity = new TestProtoMekEntity();
        entity.hasMainGun.set(true);
        expect(rolls(entity, 'front')).toEqual(['MG', 'MISS', 'RA', 'L', 'T', 'T', 'T', 'L', 'LA', 'MISS', 'HD']);
        entity.isQuad.set(true);
        expect(resolveNonMekHitLocation(entity, snapshot(entity), 'right', 4, () => 1)?.locationCode).toBe('L');
        entity.hasMainGun.set(false);
        expect(resolveNonMekHitLocation(entity, snapshot(entity), 'front', 2, () => 1))
            .toEqual({ locationCode: 'T', transferredFrom: 'MG' });
        const state = snapshot(entity);
        expect(resolveNonMekHitLocation(entity, { ...state, locations: state.locations.map(location => ({
            ...location, previewRemainingInternal: location.code === 'Head' ? 0 : 1,
        })) }, 'left', 12, () => 1)).toEqual({ locationCode: 'T', transferredFrom: 'HD' });
    });

    it('uses different side distributions for fighters, small craft and capital ships', () => {
        const fighter = new TestAeroSpaceFighterEntity();
        const smallCraft = new TestSmallCraftEntity();
        const warship = new TestWarShipEntity();
        expect(rolls(fighter, 'left')).toEqual(['NOS', 'LWG', 'NOS', 'NOS', 'LWG', 'LWG', 'LWG', 'AFT', 'AFT', 'LWG', 'AFT']);
        expect(rolls(smallCraft, 'left')).toEqual(['NOS', 'NOS', 'NOS', 'LS', 'LS', 'LS', 'LS', 'LS', 'AFT', 'AFT', 'AFT']);
        expect(rolls(warship, 'right')).toEqual(['NOS', 'FRS', 'FRS', 'FRS', 'FRS', 'ARS', 'ARS', 'ARS', 'ARS', 'AFT', 'AFT']);
        expect(rolls(warship, 'rear')).toEqual(['AFT', 'AFT', 'ARS', 'ARS', 'AFT', 'AFT', 'AFT', 'ALS', 'ALS', 'AFT', 'AFT']);
    });
});
