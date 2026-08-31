// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { DeferredUnitSource } from '../models/persisted-unit-state';
import { convertPersistedMekUnitV1 } from '../models/runtime/legacy-force-v1-converter';
import { CBT_UNIT_PERSISTENCE_SCHEMA_VERSION } from '../models/runtime/persistence-v2';
import { ReadyMekUnitFactory } from '../models/runtime/ready-unit-factory';
import { asCommandId, asStateRevision, asUnitInstanceId } from '../models/runtime/runtime-state';
import { mekHeatSourceSignatureV2 } from '../models/runtime/mek-heat-state-v2';
import { mekCriticalSlotDirectHitThreshold } from '../models/runtime/mek-critical-slot-rules';
import {
    createDirectMekRuntimeFixture,
    createDirectShieldRuntimeFixture,
} from '../models/runtime/testing/direct-mek-runtime-fixture';

describe('ReadyMekUnitFactory direct entity boundary', () => {
    it('creates and restores one effective unit around the same pristine entity', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const factory = readyFactory();
        const ready = await factory.createFromEntity({
            identity: fixture.identity,
            instanceId: asUnitInstanceId('unit:ready'),
        }, fixture.entity, fixture.identity);
        const face = [...ready.getIndex().armorFaces.values()].find(candidate => candidate.maximumPoints > 1)!;

        expect(ready.getUnit()).toBe(fixture.entity);
        expect(ready.getInstance().matchesEntity(fixture.entity)).toBeTrue();
        expect(ready.getInstance().query().heatCapability().kind).toBe('supported');
        expect(ready.getInstance().query().mekDestruction().kind).toBe('supported');
        expect(ready.getInstance().dispatch({
            type: 'damage-armor', commandId: asCommandId('ready:damage'),
            expectedRevision: asStateRevision(0), faceId: face.id, amount: 1, target: 'committed',
        }).accepted).toBeTrue();

        const saved = ready.serialize();
        const restored = await factory.restoreFromEntity(saved, fixture.entity, fixture.identity);
        expect(restored.getUnit()).toBe(fixture.entity);
        expect(restored.getInstance().query().remainingArmor(face.id)).toBe(face.maximumPoints - 1);
        expect(Object.prototype.hasOwnProperty.call(saved.baselineRefAtSave, 'published')).toBeFalse();
    });

    it('converts V1 ingress to a V2 snapshot and does not expose a legacy runtime', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const ready = await readyFactory().createFromEntity({
            identity: fixture.identity,
            instanceId: asUnitInstanceId('unit:v1-ingress'),
        }, fixture.entity, fixture.identity);
        const source: DeferredUnitSource = {
            payload: { state: {
                conditions: ['prone'],
                unknownFamilyState: { sourceOwned: true },
            } },
            identity: { kind: 'resolved', savedIdentity: fixture.identity },
        };

        const converted = await convertPersistedMekUnitV1(source, ready);
        expect(converted.schemaVersion).toBe(CBT_UNIT_PERSISTENCE_SCHEMA_VERSION);
        expect(converted.conditions?.values).toContain('prone');
        expect(converted.restoration).toBeUndefined();
        expect(JSON.stringify(converted)).not.toContain('sourceOwned');
        expect('convertLegacyV1' in ready).toBeFalse();

        const restored = await readyFactory().restoreFromEntity(
            converted,
            fixture.entity,
            fixture.identity,
        );
        expect(restored.getInstance().query().heatCapability().kind).toBe('supported');
        expect(restored.getInstance().query().mekDestruction().kind).toBe('supported');
        expect(restored.serialize().restoration).toBeUndefined();
    });

    it('converts V1 crew and manual shutdown without persisting migration diagnostics', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const factory = readyFactory();
        const ready = await factory.createFromEntity({
            identity: fixture.identity,
            instanceId: asUnitInstanceId('unit:v1-crew-shutdown'),
        }, fixture.entity, fixture.identity);
        const source: DeferredUnitSource = {
            payload: { state: {
                shutdown: true,
                crew: [{
                    id: 0,
                    name: 'Ada',
                    gunnerySkill: 3,
                    pilotingSkill: 4,
                    hits: 2,
                    state: 1,
                }],
            } },
            identity: { kind: 'resolved', savedIdentity: fixture.identity },
        };

        const converted = await convertPersistedMekUnitV1(source, ready);
        const restored = await factory.restoreFromEntity(converted, fixture.entity, fixture.identity);
        const positionId = [...ready.getIndex().crewPositions.keys()][0]!;

        expect(converted.conditions?.values).toContain('shutdown');
        expect(converted.deployment.values.crewAssignment.positions[0]).toEqual(
            jasmine.objectContaining({ name: 'Ada', gunnery: 3, piloting: 4 }),
        );
        expect(converted.restoration).toBeUndefined();
        expect(restored.getInstance().query().hasCondition('shutdown')).toBeTrue();
        expect(restored.getInstance().query().crewState(positionId)).toEqual({
            wounds: 2,
            unconscious: true,
            ejected: false,
        });
    });

    it('converts the V1 movement heat witness only at legacy ingress', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const factory = readyFactory();
        const ready = await factory.createFromEntity({
            identity: fixture.identity,
            instanceId: asUnitInstanceId('unit:v1-movement-heat'),
        }, fixture.entity, fixture.identity);
        const legacySignature = '[1,null,null]';
        const source: DeferredUnitSource = {
            payload: { state: {
                turnState: {
                    moveMode: 'walk',
                    moveDistance: 1,
                    acknowledgedHeatSources: { movement: legacySignature },
                },
            } },
            identity: { kind: 'resolved', savedIdentity: fixture.identity },
        };

        const converted = await convertPersistedMekUnitV1(source, ready);
        const acknowledgement = converted.turn.acknowledgedHeatSources?.find(entry =>
            entry.sourceId === 'movement');
        expect(acknowledgement).toBeDefined();
        expect(acknowledgement?.signature).not.toBe(legacySignature);

        const restored = await factory.restoreFromEntity(converted, fixture.entity, fixture.identity);
        const projection = restored.getInstance().query().heatProjection('manual');
        expect(projection.kind).toBe('supported');
        if (projection.kind !== 'supported') return;
        const movement = projection.projection.committedSources.find(source => source.id === 'movement')!;
        expect(acknowledgement?.signature).toBe(mekHeatSourceSignatureV2(movement));
        expect(restored.getInstance().query().turnState().acknowledgedHeatSources.get('movement'))
            .toBe(acknowledgement?.signature);
    });

    it('imports the latest production V1 turn, critical chronology, and paused-event fields', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const factory = readyFactory();
        const ready = await factory.createFromEntity({
            identity: fixture.identity,
            instanceId: asUnitInstanceId('unit:v1-current-production'),
        }, fixture.entity, fixture.identity);
        const slot = [...fixture.index.slots.values()].find(candidate => candidate.componentIds.length > 0)!;
        const location = fixture.index.locations.get(slot.locationId)!;
        const source: DeferredUnitSource = {
            payload: { state: {
                turnState: {
                    turnCounter: 4,
                    moveMode: 'walk',
                    moveDistance: 0,
                    standAttempts: 1,
                    carefulStand: true,
                    cover: 2,
                    endTurnCheckpoint: 'heat-staged',
                    pendingEvents: [{
                        type: 'mek-critical-chance',
                        id: 'pending:critical',
                        location: location.code,
                        result: 1,
                    }],
                },
                crits: [{
                    id: `saved@${location.code}#${slot.slotIndex}`,
                    loc: location.code,
                    slot: slot.slotIndex,
                    hits: mekCriticalSlotDirectHitThreshold(slot),
                    destroyedTurn: 4,
                }],
            } },
            identity: { kind: 'resolved', savedIdentity: fixture.identity },
        };

        const converted = await convertPersistedMekUnitV1(source, ready);
        expect(converted.turn).toEqual(jasmine.objectContaining({ turnCounter: 4, cover: 2 }));
        expect(converted.movementPsr).toEqual(jasmine.objectContaining({
            standAttempts: 1,
            carefulStand: true,
        }));
        expect(converted.restoration).toBeUndefined();

        const restored = await factory.restoreFromEntity(converted, fixture.entity, fixture.identity);
        expect(restored.getInstance().query().turnState()).toEqual(jasmine.objectContaining({
            turnCounter: 4,
            cover: 'heavy',
        }));
        expect(restored.getInstance().query().mekMovementPsrState()).toEqual(jasmine.objectContaining({
            standAttempts: 1,
            carefulStand: true,
        }));
        expect(restored.getInstance().snapshot().slots.get(slot.id)?.destroyedTurn).toBe(4);
    });

    it('converts V1 shield aliases once and restores only direct V2 component state', async () => {
        const fixture = createDirectShieldRuntimeFixture();
        const factory = readyFactory();
        const ready = await factory.createFromEntity({
            identity: fixture.identity,
            instanceId: asUnitInstanceId('unit:v1-shield-ingress'),
        }, fixture.entity, fixture.identity);
        const source: DeferredUnitSource = {
            payload: { state: {
                locations: {
                    DALA: { armor: 3, pendingArmor: 1 },
                    DCLA: { armor: 7 },
                },
            } },
            identity: { kind: 'resolved', savedIdentity: fixture.identity },
        };

        const converted = await convertPersistedMekUnitV1(source, ready);
        const restored = await factory.restoreFromEntity(converted, fixture.entity, fixture.identity);
        const shield = fixture.equipmentComponent('Test Medium Shield');

        expect(restored.getInstance().snapshot().components.get(shield.id)?.shieldDamage).toEqual({
            absorptionDamage: 3,
            capacityDamage: 7,
        });
        expect(restored.getInstance().snapshot().pendingCombat.shieldDamage.get(shield.id)).toEqual({
            absorptionDamage: 1,
            capacityDamage: 0,
        });
        expect(restored.getInstance().snapshot().locations.size).toBe(0);
        expect(converted.locationState).toBeUndefined();
        expect(converted.pendingCombat?.locationDamage).toBeUndefined();
    });
});

function readyFactory(): ReadyMekUnitFactory {
    return new ReadyMekUnitFactory({
        initializeOptions: {
            initializerRevision: 1,
            profileId: 'pristine',
            deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'core-2026' },
        },
    });
}
