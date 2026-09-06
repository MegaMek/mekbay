// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { projectNonMekMovementCapabilities } from './non-mek-unit-instance';
import { projectNonMekRecordSheet } from './non-mek-record-sheet';
import { createDefaultCrewAssignment } from './crew-assignment';
import { TestTankEntity, TestProtoMekEntity, TestAeroSpaceFighterEntity } from '../entity/testing/test-entities';
import { InfantryEntity } from '../entity/entities/infantry/infantry-entity';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { CBTNonMekUnit } from './cbt-non-mek-unit';

describe('CBTNonMekUnit', () => {
    it('rebinds exact committed personal health to an occupied seat without a phase edit', () => {
        const entity = new TestTankEntity();
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e8');
        entity.uuid.set(uuid);
        const ready = CBTNonMekUnit.create(entity, {
            instanceId: 'health', uuid, deployment: { id: 'vacant', crewAssignment: { schemaVersion: 1, positions: [] } },
            scenario: { id: 'megamek', ruleset: 'core-2026' }, initialStateProfileId: 'pristine',
        });
        const assignment = createDefaultCrewAssignment(ready.getIndex().crewPositions);
        const seat = assignment.positions[0]!.positionId;
        const replacement = CBTNonMekUnit.redeploy(ready, assignment,
            new Map([[seat, { wounds: 2, unconscious: true, ejected: false }]]));
        expect(replacement.getInstance().query().crewState(seat).wounds).toBe(2);
        expect(replacement.getInstance().query().crewState(seat).isAvailable()).toBeFalse();
        expect(replacement.getInstance().query().hasPendingPhaseChanges()).toBeFalse();
        expect(replacement.revision()).toBe(0);
        expect(ready.getInstance().query().crewState(seat).effectiveState()).toBe('vacant');
    });

    it('preserves explicit vacancies through restore, repair and redeployment for each crewed family', () => {
        for (const entity of [new TestTankEntity(), new TestProtoMekEntity(), new TestAeroSpaceFighterEntity()]) {
            const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e8');
            entity.uuid.set(uuid);
            const scenario = { id: 'megamek', ruleset: 'core-2026' as const };
            const unit = CBTNonMekUnit.create(entity, {
                instanceId: 'vacant', uuid, deployment: { id: 'vacant', crewAssignment: { schemaVersion: 1, positions: [] } },
                scenario, initialStateProfileId: 'pristine', crewSkills: { gunnery: 3, piloting: 4 },
            });
            const restored = CBTNonMekUnit.restore(unit.serialize(), entity, uuid, scenario);
            for (const ready of [restored, CBTNonMekUnit.repair(restored), CBTNonMekUnit.redeploy(restored, unit.getCrewAssignment())]) {
                const runtime = ready.getInstance();
                const seat = [...runtime.getIndex().crewPositions.keys()][0]!;
                expect(ready.getCrewAssignment().positions).toEqual([]);
                expect(runtime.query().crewState(seat).effectiveState()).toBe('vacant');
                expect(runtime.hasCondition('abandoned')).toBeTrue();
                expect(runtime.hasCondition('immobile')).toBeTrue();
                const movement = projectNonMekMovementCapabilities(entity, runtime.getIndex(), runtime.snapshot(),
                    runtime.ruleset, ready.getCrewAssignment());
                expect(movement.canTakeActiveActions).toBeFalse();
                expect(movement.maximum.walk).toBe(0);
                expect(runtime.dispatch({ kind: 'set-spotting', spotting: true }).changed).toBeFalse();
                expect(runtime.dispatch({ kind: 'set-crew-state', positionId: seat,
                    wounds: 1, unconscious: false, ejected: false }).changed).toBeFalse();
                expect(runtime.snapshot().crew.size).toBe(0);
                const sheet = projectNonMekRecordSheet(entity, runtime.getIndex(), runtime.snapshot(), runtime.ruleset,
                    0, 0, ready.getCrewAssignment());
                expect(sheet.crew.length).toBe(runtime.getIndex().crewPositions.size);
                expect(sheet.crew.every(person => person.effectiveState === 'vacant')).toBeTrue();
                expect(sheet.crewSize).toBe(runtime.getIndex().crewPositions.size);
            }
        }
    });

    it('preserves raw personal Piloting and derives the fixed value only for the record sheet', () => {
        const entity = new InfantryEntity(createTestEquipmentRegistry());
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e8');
        entity.uuid.set(uuid);

        const unit = CBTNonMekUnit.create(entity, {
            instanceId: 'unit:fixed-piloting-clone',
            uuid,
            deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'core-2026' },
            initialStateProfileId: 'pristine-non-mek-v1',
            crewSkills: { gunnery: 4, piloting: 5 },
        });

        const positions = unit.getCrewAssignment().positions;
        expect(positions.length).toBeGreaterThan(0);
        expect(positions.every(position => position.piloting === 5)).toBeTrue();
        const runtime = unit.getInstance();
        const sheet = projectNonMekRecordSheet(entity, runtime.getIndex(), runtime.snapshot(), runtime.ruleset, 0, 0, unit.getCrewAssignment());
        expect(sheet.crew.every(position => position.piloting === 8)).toBeTrue();
    });
});
