// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    TestAeroSpaceFighterEntity,
    TestBattleArmorEntity,
    TestInfantryEntity,
    TestProtoMekEntity,
    TestTankEntity,
} from '../entity/testing/test-entities';
import {
    MM_DATA_UNIT_PROVIDER_ID,
    asUnitUuid,
} from '../../services/unit-catalog/unit-catalog.types';
import { CORE_2026_RULESET } from '../cbt-ruleset.model';
import { asUnitInstanceId, type InstanceBaselineRef } from './runtime-state';
import { NonMekUnitInstance } from './non-mek-unit-instance';
import { projectNonMekRecordSheet } from './non-mek-record-sheet';

describe('projectNonMekRecordSheet', () => {
    it('maps a Tank Entity and sparse runtime damage to authored sheet codes', () => {
        const entity = new TestTankEntity();
        entity.uuid.set(UUID);
        entity.chassis.set('Test Tank');
        entity.model.set('T-1');
        entity.setTonnage(20);
        entity.originalWalkMP.set(8);
        entity.setArmorValue('Front', 'front', 3);
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:tank-sheet'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const front = [...runtime.getIndex().locations.values()]
            .find(location => location.code === 'Front')!;
        const face = runtime.getIndex().armorFaces.get(front.armorFaceIds[0])!;
        runtime.dispatch({
            kind: 'set-armor-damage',
            expectedRevision: runtime.revision(),
            faceId: face.id,
            damage: 1,
        });
        const crewPositionId = [...runtime.getIndex().crewPositions.keys()][0]!;
        const crewAssignment = Object.freeze({
            schemaVersion: 1 as const,
            positions: Object.freeze([Object.freeze({
                positionId: crewPositionId,
                name: 'Morgan Kell',
                role: 'Commander',
                gunnery: 3,
                piloting: 4,
            })]),
        });
        runtime.dispatch({
            kind: 'set-crew-state',
            expectedRevision: runtime.revision(),
            positionId: crewPositionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            state: 'stunned',
        });

        const snapshot = projectNonMekRecordSheet(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
            95,
            100,
            crewAssignment,
        );
        const projectedFront = snapshot.locations.find(location => location.code === 'Front')!;

        expect(snapshot.displayName).toBe('Test Tank T-1');
        expect(snapshot.currentBattleValue).toBe(95);
        expect(snapshot.pristineBattleValue).toBe(100);
        expect(snapshot.movement).toEqual({ walk: 8, run: 0, jump: 0, umu: 0 });
        expect(snapshot.crew[0]).toEqual(jasmine.objectContaining({
            positionId: crewPositionId,
            name: 'Morgan Kell',
            role: 'Commander',
            gunnery: 3,
            piloting: 4,
            effectiveState: 'stunned',
        }));
        expect(projectedFront.sheetCode).toBe('FR');
        expect(projectedFront.armor[0]).toEqual(jasmine.objectContaining({
            faceId: face.id,
            maximum: 3,
            remaining: 2,
            previewRemaining: 2,
        }));
    });

    it('projects one combined armor/internal row per Battle Armor trooper', () => {
        const entity = new TestBattleArmorEntity();
        entity.uuid.set(UUID);
        entity.trooperCount.set(4);
        entity.setArmorValue('Squad', 'front', 6);
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:battle-armor-sheet'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );

        const snapshot = projectNonMekRecordSheet(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
            runtime.battleValue(),
            entity.battleValue(),
        );

        expect(snapshot.locations.map(location => location.sheetCode)).toEqual(['T1', 'T2', 'T3', 'T4']);
        expect(snapshot.locations.every(location => location.combinedPips === true)).toBeTrue();
        expect(snapshot.locations.every(location => location.maximumInternal === 1
            && location.armor[0]?.maximum === 6)).toBeTrue();
    });

    it('projects rules-derived Battle Armor destruction and zero movement', () => {
        const entity = new TestBattleArmorEntity();
        entity.uuid.set(UUID);
        entity.trooperCount.set(1);
        entity.originalWalkMP.set(1);
        entity.propulsionMP.set(3);
        entity.motiveType.set('Jump');
        entity.setArmorValue('Squad', 'front', 2);
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:battle-armor-destroyed-sheet'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const location = [...runtime.getIndex().locations.values()][0]!;
        const face = runtime.getIndex().armorFaces.get(location.armorFaceIds[0]!)!;
        runtime.dispatch({
            kind: 'set-armor-damage',
            expectedRevision: runtime.revision(),
            faceId: face.id,
            damage: face.maximumPoints,
        });
        runtime.dispatch({
            kind: 'set-internal-damage',
            expectedRevision: runtime.revision(),
            locationId: location.id,
            damage: location.internalPoints,
        });

        const snapshot = projectNonMekRecordSheet(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
            runtime.battleValue(),
            entity.battleValue(),
        );

        expect(snapshot.destroyed).toBeTrue();
        expect(snapshot.movement).toEqual({ walk: 0, run: 0, jump: 0, umu: 0 });
    });

    it('projects conventional-infantry casualties onto the authored soldier grid', () => {
        const entity = new TestInfantryEntity();
        entity.uuid.set(UUID);
        entity.squadSize.set(7);
        entity.squadCount.set(4);
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:infantry-sheet'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );

        const snapshot = projectNonMekRecordSheet(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
            runtime.battleValue(),
            entity.battleValue(),
        );

        expect(snapshot.locations).toEqual([jasmine.objectContaining({
            code: 'Infantry',
            soldierPips: true,
            maximumInternal: 28,
        })]);
    });

    it('projects ProtoMek rules, crew controls, and effective movement', () => {
        const entity = new TestProtoMekEntity();
        entity.uuid.set(UUID);
        entity.setTonnage(6);
        entity.originalWalkMP.set(6);
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:protomek-sheet'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        const crewId = [...runtime.getIndex().crewPositions.keys()][0]!;
        runtime.dispatch({
            kind: 'set-crew-state',
            expectedRevision: runtime.revision(),
            positionId: crewId,
            wounds: 0,
            unconscious: true,
            ejected: false,
        });

        const snapshot = projectNonMekRecordSheet(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
            runtime.battleValue(),
            entity.battleValue(),
        );

        expect(snapshot.conditions).toContain('immobile');
        expect(snapshot.conditionControlKeys).toEqual([
            'swarmed', 'tagged', 'ecm-shielded', 'jammed',
        ]);
        expect(snapshot.crewStateControlKeys).toEqual(['unconscious']);
        expect(snapshot.crewStateDisplayKeys).toEqual(['unconscious', 'dead']);
        expect(snapshot.crew[0].effectiveState).toBe('unconscious');
        expect(snapshot.movement).toEqual({ walk: 0, run: 0, jump: 0, umu: 0 });
    });

    it('projects aerospace heat preview, dissipation, and effective destruction', () => {
        const entity = new TestAeroSpaceFighterEntity();
        entity.uuid.set(UUID);
        entity.structuralIntegrity.set(8);
        entity.heatSinkCount.set(10);
        entity.heatSinkType.set('Double');
        const runtime = new NonMekUnitInstance(
            asUnitInstanceId('unit:aero-sheet'),
            baseline(),
            entity,
            CORE_2026_RULESET,
        );
        runtime.dispatch({
            kind: 'set-heat',
            expectedRevision: runtime.revision(),
            heat: 19,
            target: 'pending',
        });
        runtime.dispatch({
            kind: 'set-heatsinks-off',
            expectedRevision: runtime.revision(),
            heatsinksOff: 2,
        });
        const snapshot = projectNonMekRecordSheet(
            entity,
            runtime.getIndex(),
            runtime.snapshot(),
            CORE_2026_RULESET,
            runtime.battleValue(),
            entity.battleValue(),
        );

        expect(snapshot.heat).toEqual(jasmine.objectContaining({
            tracked: true,
            current: 0,
            pending: 19,
            heatsinksOff: 2,
            heatSinkCount: 10,
            dissipation: 16,
        }));
        expect(snapshot.destroyed).toBeFalse();
    });
});

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');

function baseline(): InstanceBaselineRef {
    return Object.freeze({
        entity: Object.freeze({
            origin: 'megamek' as const,
            provider: MM_DATA_UNIT_PROVIDER_ID,
            uuid: UUID,
            sourceFormat: 'blk' as const,
        }),
        ruleset: CORE_2026_RULESET,
        initialStateProfile: Object.freeze({
            schemaVersion: 1 as const,
            initializerRevision: 1,
            profileId: 'pristine-non-mek-v1',
        }),
    });
}
