// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    TestAeroSpaceFighterEntity,
    TestBattleArmorEntity,
    TestBipedMekEntity,
    TestDropShipEntity,
    TestHandheldWeaponEntity,
    TestInfantryEntity,
    TestProtoMekEntity,
    TestSupportNavalEntity,
    TestTankEntity,
    TestVtolEntity,
} from '../../../models/entity/testing/test-entities';
import { AeroFighterRecordSheetLayout } from './aero-fighter-record-sheet-layout';
import { BattleArmorRecordSheetLayout } from './battle-armor-record-sheet-layout';
import { CombatVehicleRecordSheetLayout } from './combat-vehicle-record-sheet-layout';
import { ConventionalInfantryRecordSheetLayout } from './conventional-infantry-record-sheet-layout';
import { LargeAeroRecordSheetLayout } from './large-aero-record-sheet-layout';
import { MekRecordSheetLayout } from './mek-record-sheet-layout';
import { NavalRecordSheetLayout } from './naval-record-sheet-layout';
import { ProtoMekRecordSheetLayout } from './protomek-record-sheet-layout';
import { recordSheetLayoutId } from './record-sheet-layout-resolver';

describe('record-sheet layout resolver', () => {
    it('selects the requested family classes', () => {
        expect(recordSheetLayoutId(new TestBipedMekEntity())).toBe('mek');
        expect(recordSheetLayoutId(new TestTankEntity())).toBe('combat-vehicle');
        expect(recordSheetLayoutId(new TestVtolEntity())).toBe('combat-vehicle');
        expect(recordSheetLayoutId(new TestSupportNavalEntity())).toBe('naval');
        expect(recordSheetLayoutId(new TestProtoMekEntity())).toBe('protomek');
        expect(recordSheetLayoutId(new TestBattleArmorEntity())).toBe('battle-armor');
        expect(recordSheetLayoutId(new TestInfantryEntity())).toBe('conventional-infantry');
        expect(recordSheetLayoutId(new TestAeroSpaceFighterEntity())).toBe('aero-fighter');
        expect(recordSheetLayoutId(new TestDropShipEntity())).toBe('large-aero');
    });

    it('routes marine motive types to the naval owner even when parsed as Tanks', () => {
        for (const motiveType of ['Naval', 'Hydrofoil', 'Submarine'] as const) {
            const entity = new TestTankEntity();
            entity.motiveType.set(motiveType);
            expect(recordSheetLayoutId(entity)).withContext(motiveType).toBe('naval');
        }
    });

    it('retains a safe generic fallback for unsupported entity families', () => {
        expect(recordSheetLayoutId(new TestHandheldWeaponEntity())).toBe('generic');
    });

    it('keeps a concrete rendering hook in every supported family owner', () => {
        const fullPageOwners = [
            MekRecordSheetLayout,
            AeroFighterRecordSheetLayout,
            LargeAeroRecordSheetLayout,
        ];
        const compactOwners = [
            CombatVehicleRecordSheetLayout,
            NavalRecordSheetLayout,
            ProtoMekRecordSheetLayout,
            BattleArmorRecordSheetLayout,
            ConventionalInfantryRecordSheetLayout,
        ];

        for (const owner of fullPageOwners) {
            expect(Object.prototype.hasOwnProperty.call(owner.prototype, 'generate'))
                .withContext(owner.name)
                .toBeTrue();
        }
        for (const owner of compactOwners) {
            expect(Object.prototype.hasOwnProperty.call(owner.prototype, 'drawCompact'))
                .withContext(owner.name)
                .toBeTrue();
        }
    });
});
