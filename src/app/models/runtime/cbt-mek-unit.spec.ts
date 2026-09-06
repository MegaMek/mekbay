// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CBTMekUnit } from './cbt-mek-unit';
import { createDirectMekRuntimeFixture, createDirectCommandConsoleRuntimeFixture } from './testing/direct-mek-runtime-fixture';

describe('CBTMekUnit direct entity boundary', () => {
    it('rebinds exact committed personal health without staging gameplay edits', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const ready = await CBTMekUnit.createFromEntity({ uuid: fixture.identity, instanceId: 'assigned-health' },
            fixture.entity, fixture.identity, initializeOptions);
        const seat = ready.getCrewAssignment().positions[0]!.positionId;
        const health = new Map([[seat, { wounds: 2, unconscious: false, ejected: false }]]);
        const pending = CBTMekUnit.redeployCrew(ready, ready.getCrewAssignment(), initializeOptions.scenario, health);
        health.set(seat, { wounds: 4, unconscious: false, ejected: false });
        const replacement = await pending;
        expect(replacement.getInstance().query().crewState(seat).wounds).toBe(2);
        expect(replacement.getInstance().revision()).toBe(0);
        expect(replacement.getInstance().query().hasPendingPhaseChanges()).toBeFalse();
        expect(ready.getInstance().query().crewState(seat).wounds).toBe(0);
    });

    it('restores an explicit empty assignment as vacant and blocks phantom crew edits', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const ready = await CBTMekUnit.createFromEntity({ uuid: fixture.identity, instanceId: 'vacant' },
            fixture.entity, fixture.identity, { ...initializeOptions,
                deployment: { id: 'vacant', crewAssignment: { schemaVersion: 1, positions: [] } },
            });
        const restored = await CBTMekUnit.restoreFromEntity(ready.serialize(), fixture.entity,
            fixture.identity, initializeOptions);
        const runtime = restored.getInstance();
        const seat = [...restored.getIndex().crewPositions.keys()][0]!;
        expect(restored.getCrewAssignment().positions).toEqual([]);
        expect(runtime.query().crewState(seat).effectiveState()).toBe('vacant');
        expect(runtime.query().hasCondition('abandoned')).toBeTrue();
        expect(runtime.query().hasCondition('immobile')).toBeTrue();
        expect(runtime.query().mekMovementPsr().kind).toBe('supported');
        expect(runtime.dispatch({ type: 'set-crew-state', positionId: seat,
            wounds: 1, unconscious: false, ejected: false }).changed).toBeFalse();
        expect(runtime.snapshot().crew.size).toBe(0);
    });

    it('uses an occupied command-console station when the primary station is vacant', async () => {
        const fixture = createDirectCommandConsoleRuntimeFixture('total-warfare');
        const options = { ...initializeOptions, scenario: { id: 'megamek', ruleset: 'total-warfare' as const } };
        const assigned = fixture.initialized.deployment.crewAssignment.positions[1]!;
        const ready = await CBTMekUnit.createFromEntity({ uuid: fixture.identity, instanceId: 'partial' },
            fixture.entity, fixture.identity, { ...options,
                deployment: { id: 'partial', crewAssignment: { schemaVersion: 1, positions: [assigned] } },
            });
        const restored = await CBTMekUnit.restoreFromEntity(ready.serialize(), fixture.entity,
            fixture.identity, options);
        const query = restored.getInstance().query();
        expect(restored.getCrewAssignment().positions).toEqual([assigned]);
        expect(query.hasCondition('abandoned')).toBeFalse();
        expect(query.hasCondition('immobile')).toBeFalse();
        expect(query.crewState(assigned.positionId).isAvailable()).toBeTrue();
        const wounded = await CBTMekUnit.redeployCrew(restored, restored.getCrewAssignment(), options.scenario,
            new Map([[assigned.positionId, { wounds: 4, unconscious: false, ejected: false }]]));
        expect(wounded.getInstance().query().hasCondition('crippled')).toBeTrue();
    });

    it('creates and restores one effective unit around the same pristine entity', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const ready = await CBTMekUnit.createFromEntity({
            uuid: fixture.identity,
            instanceId: 'unit:ready',
        }, fixture.entity, fixture.identity, initializeOptions);
        const face = [...ready.getIndex().armorFaces.values()].find(candidate => candidate.maximumPoints > 1)!;

        expect(ready.getUnit()).toBe(fixture.entity);
        expect(ready.getInstance().matchesEntity(fixture.entity)).toBeTrue();
        expect(ready.getInstance().query().heatCapability().kind).toBe('supported');
        expect(ready.getInstance().query().mekDestruction().kind).toBe('supported');
        expect(ready.getInstance().dispatch({
            type: 'damage-armor',
            faceId: face.id, amount: 1, target: 'committed',
        }).accepted).toBeTrue();

        const saved = ready.serialize();
        const restored = await CBTMekUnit.restoreFromEntity(
            saved,
            fixture.entity,
            fixture.identity,
            initializeOptions,
        );
        expect(restored.getUnit()).toBe(fixture.entity);
        expect(restored.getInstance().query().remainingArmor(face.id)).toBe(face.maximumPoints - 1);
        expect(Object.prototype.hasOwnProperty.call(saved.baselineRefAtSave, 'published')).toBeFalse();
    });

});

const initializeOptions = {
    initializerRevision: 1,
    profileId: 'pristine',
    deployment: { id: 'default' },
    scenario: { id: 'megamek', ruleset: 'core-2026' as const },
};
