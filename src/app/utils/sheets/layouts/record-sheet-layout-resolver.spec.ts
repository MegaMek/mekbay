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
import { resolveRecordSheetLayout } from './record-sheet-layout-resolver';

describe('record-sheet layout resolver', () => {
    it('selects the requested family classes', () => {
        expect(resolveRecordSheetLayout(new TestBipedMekEntity()).id).toBe('mek');
        expect(resolveRecordSheetLayout(new TestTankEntity()).id).toBe('combat-vehicle');
        expect(resolveRecordSheetLayout(new TestVtolEntity()).id).toBe('combat-vehicle');
        expect(resolveRecordSheetLayout(new TestSupportNavalEntity()).id).toBe('naval');
        expect(resolveRecordSheetLayout(new TestProtoMekEntity()).id).toBe('protomek');
        expect(resolveRecordSheetLayout(new TestBattleArmorEntity()).id).toBe('battle-armor');
        expect(resolveRecordSheetLayout(new TestInfantryEntity()).id).toBe('conventional-infantry');
        expect(resolveRecordSheetLayout(new TestAeroSpaceFighterEntity()).id).toBe('aero-fighter');
        expect(resolveRecordSheetLayout(new TestDropShipEntity()).id).toBe('large-aero');
    });

    it('routes marine motive types to the naval owner even when parsed as Tanks', () => {
        for (const motiveType of ['Naval', 'Hydrofoil', 'Submarine'] as const) {
            const entity = new TestTankEntity();
            entity.motiveType.set(motiveType);
            expect(resolveRecordSheetLayout(entity).id).withContext(motiveType).toBe('naval');
        }
    });

    it('retains a safe generic fallback for unsupported entity families', () => {
        expect(resolveRecordSheetLayout(new TestHandheldWeaponEntity()).id).toBe('generic');
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
