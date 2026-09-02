// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { freezeRuntimeState } from './runtime-state';
import { ImmutableIndex } from '../entity/immutable-collections';
import {
    restoreSerializedCBTUnitV2,
    serializeCBTUnitStateV2,
} from './runtime-state-codec-v2';
import {
    createDirectBoobyTrapRuntimeFixture,
    createDirectEscalatingFailureRuntimeFixture,
    createDirectMekRuntimeFixture,
    createDirectModularArmorRuntimeFixture,
    createDirectShieldRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

describe('direct Mek V2 state codec', () => {
    it('persists only an explicit destruction override, not derived destruction', () => {
        const fixture = createDirectBoobyTrapRuntimeFixture();
        const trap = fixture.equipmentComponent('Test Booby Trap');

        expect(fixture.instance.dispatch({
            type: 'detonate-booby-trap',
            componentId: trap.id,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(fixture.instance.query().destroyed()).toBeTrue();
        expect(serialize(fixture).destroyed).toBeUndefined();

        const explicit = freezeRuntimeState({
            ...fixture.instance.snapshot(),
            explicitlyDestroyed: true,
            destroyed: true,
        });
        expect(serialize(fixture, explicit).destroyed).toBeTrue();
    });

    it('round-trips only sparse runtime deviations over the entity baseline', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const face = [...fixture.index.armorFaces.values()].find(candidate => candidate.maximumPoints > 2)!;
        const ammo = [...fixture.index.components.values()].find(component =>
            component.kind === 'equipment' && component.mount.equipmentId === 'Test Ammo')!;
        if (ammo.kind !== 'equipment') throw new Error('Fixture ammo is missing');

        expect(fixture.instance.dispatch({
            type: 'damage-armor',
            faceId: face.id, amount: 2, target: 'committed',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'spend-ammo',
            componentId: ammo.id, amount: 4,
        }).accepted).toBeTrue();

        const saved = serialize(fixture);
        expect(Object.prototype.hasOwnProperty.call(saved, 'index')).toBeFalse();
        expect(saved.baselineRefAtSave.entity).toEqual(fixture.identity);
        expect(Object.prototype.hasOwnProperty.call(saved.baselineRefAtSave, 'published')).toBeFalse();
        expect(saved.locationState?.length).toBe(1);
        expect(saved.ammoState?.length).toBe(1);

        const wire = JSON.parse(JSON.stringify(saved));
        const restored = await restoreSerializedCBTUnitV2(wire, fixture.entity, fixture.index, fixture.initialized);
        const replay = fixture.createInstance('unit:codec-replay');
        expect(restored.state.locations.size).toBe(1);
        expect(restored.state.ammo.size).toBe(1);
        expect(restored.unresolved).toEqual([]);
        expect(replay.snapshot().locations.size).toBe(0);
    });

    it('restores under the current application rules without persisting a ruleset', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const saved = serialize(fixture);
        const initialized = {
            ...fixture.initialized,
            baselineRef: Object.freeze({
                ...fixture.initialized.baselineRef,
                ruleset: 'total-warfare' as const,
            }),
        };

        const restored = await restoreSerializedCBTUnitV2(
            saved,
            fixture.entity,
            fixture.index,
            initialized,
        );

        expect('ruleset' in saved.baselineRefAtSave).toBeFalse();
        expect(restored.warnings).toEqual([]);
    });

    it('round-trips pending and committed crew death distinctly', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const positionId = [...fixture.index.crewPositions.keys()][0]!;
        expect(fixture.instance.dispatch({
            type: 'set-crew-state',
            positionId,
            wounds: 6,
            unconscious: false,
            ejected: false,
        })).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));

        const pendingSave = serialize(fixture);
        expect(pendingSave.crew.positions[0]?.dead).toBeUndefined();
        const pendingRestore = await restoreSerializedCBTUnitV2(
            pendingSave,
            fixture.entity,
            fixture.index,
            fixture.initialized,
        );
        expect(pendingRestore.state.crew.get(positionId)?.dead).toBeUndefined();

        expect(fixture.instance.dispatch({ type: 'end-phase' }))
            .toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        const committedSave = serialize(fixture);
        expect(committedSave.crew.positions[0]?.dead).toBeTrue();
        const committedRestore = await restoreSerializedCBTUnitV2(
            committedSave,
            fixture.entity,
            fixture.index,
            fixture.initialized,
        );
        expect(committedRestore.state.crew.get(positionId)?.dead).toBeTrue();
    });

    it('round-trips an automatic fall as sparse phase state', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const leg = [...fixture.index.locations.values()].find(location => location.code === 'LL')!;

        expect(fixture.instance.dispatch({
            type: 'damage-internal',
            locationId: leg.id,
            amount: leg.internalPoints, target: 'committed',
        }).accepted).toBeTrue();

        const saved = serialize(fixture);
        expect(saved.movementPsr).toEqual(jasmine.objectContaining({
            schemaVersion: 2,
            automaticFalls: [{
                triggerKind: 'leg-destroyed-auto-fall',
                locationIds: [leg.id],
            }],
        }));

        const restored = await restoreSerializedCBTUnitV2(saved, fixture.entity, fixture.index, fixture.initialized);
        expect(restored.state.movementPsr.automaticFalls).toEqual([{
            triggerKind: 'leg-destroyed-auto-fall',
            locationIds: [leg.id],
        }]);
    });

    it('round-trips the unit turn counter and critical destruction turn', async () => {
        const fixture = createDirectMekRuntimeFixture('total-warfare');
        const hip = [...fixture.index.slots.values()].find(slot =>
            fixture.index.locations.get(slot.locationId)?.code === 'LL'
            && slot.componentIds.some(componentId => {
                const component = fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Hip';
            }))!;

        expect(fixture.instance.dispatch({
            type: 'end-turn',


            policy: 'automatic',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'hit-critical',


            slotId: hip.id,
            hits: 1,
            target: 'committed',
        }).accepted).toBeTrue();

        const saved = serialize(fixture);
        const savedHip = saved.slotState?.find(entry => {
            const target = saved.blueprintReferences.targets[entry.target];
            return target?.kind === 'critical-slot' && target.savedSlotId === hip.id;
        });
        expect(saved.turn.turnCounter).toBe(1);
        expect(savedHip?.destroyedTurn).toBe(1);

        const restored = await restoreSerializedCBTUnitV2(saved, fixture.entity, fixture.index, fixture.initialized);
        expect(restored.state.turn.turnCounter).toBe(1);
        expect(restored.state.slots.get(hip.id)?.destroyedTurn).toBe(1);
    });

    it('round-trips independent HAG mode and sparse Gauss power state', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const hag = fixture.equipmentComponent('Test HAG');
        expect(fixture.instance.dispatch({
            type: 'set-component-mode',

            componentId: hag.id, mode: 'Flak',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'toggle-gauss-power',

            componentId: hag.id,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'end-turn',

            policy: 'automatic',
        }).accepted).toBeTrue();

        const saved = serialize(fixture);
        const componentState = saved.componentState?.find(entry => {
            const target = saved.blueprintReferences.targets[entry.target];
            return target?.kind === 'component' && target.savedComponentId === hag.id;
        });
        expect(componentState).toEqual(jasmine.objectContaining({
            mode: 'Flak',
            gaussPower: 'Powered Down',
        }));

        const restored = await restoreSerializedCBTUnitV2(saved, fixture.entity, fixture.index, fixture.initialized);
        expect(restored.unresolved).toEqual([]);
        expect(restored.state.components.get(hag.id)).toEqual(jasmine.objectContaining({
            mode: 'Flak',
            gaussPower: 'Powered Down',
        }));
    });

    it('round-trips a pending Stealth Armor End Turn transition as one sparse mode', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const stealth = fixture.equipmentComponent('Test Stealth');
        expect(fixture.instance.dispatch({
            type: 'set-stealth-state',


            componentId: stealth.id,
            state: 'enabling',
        }).accepted).toBeTrue();

        const saved = serialize(fixture);
        const componentState = saved.componentState?.find(entry => {
            const target = saved.blueprintReferences.targets[entry.target];
            return target?.kind === 'component' && target.savedComponentId === stealth.id;
        });
        expect(componentState).toEqual(jasmine.objectContaining({ mode: 'Enabling' }));

        const restored = await restoreSerializedCBTUnitV2(saved, fixture.entity, fixture.index, fixture.initialized);
        expect(restored.unresolved).toEqual([]);
        expect(restored.state.components.get(stealth.id)?.mode).toBe('Enabling');
    });

    it('round-trips a rules-sized escalating sequence beyond the old MASC limit', async () => {
        const fixture = createDirectEscalatingFailureRuntimeFixture('total-warfare');
        const blueShield = fixture.equipmentComponent('Test Blue Shield');
        for (let index = 0; index < 14; index += 1) {
            expect(fixture.instance.dispatch({
                type: 'edit-escalating-failure',


                componentId: blueShield.id,
                edit: { kind: 'select-sequence', index },
            }).accepted).toBeTrue();
        }

        const saved = serialize(fixture);
        const restored = await restoreSerializedCBTUnitV2(saved, fixture.entity, fixture.index, fixture.initialized);
        expect(restored.unresolved).toEqual([]);
        expect(restored.state.components.get(blueShield.id)?.escalatingFailure)
            .toEqual({ sequence: 14, active: true });
    });

    it('round-trips committed and pending physical-shield track damage', async () => {
        const fixture = createDirectShieldRuntimeFixture();
        const shield = fixture.equipmentComponent('Test Medium Shield');
        expect(fixture.instance.dispatch({
            type: 'damage-shield',

            componentId: shield.id, track: 'absorption', amount: 2, target: 'committed',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'damage-shield',

            componentId: shield.id, track: 'capacity', amount: 4, target: 'pending',
        }).accepted).toBeTrue();

        const saved = serialize(fixture);
        expect(saved.componentState?.[0]?.shieldDamage).toEqual({
            absorptionDamage: 2,
            capacityDamage: 0,
        });
        expect(saved.pendingCombat?.shieldDamage?.[0]).toEqual(jasmine.objectContaining({
            absorptionDamage: 0,
            capacityDamage: 4,
        }));

        const restored = await restoreSerializedCBTUnitV2(saved, fixture.entity, fixture.index, fixture.initialized);
        expect(restored.unresolved).toEqual([]);
        expect(restored.state.components.get(shield.id)?.shieldDamage).toEqual({
            absorptionDamage: 2,
            capacityDamage: 0,
        });
        expect(restored.state.pendingCombat.shieldDamage.get(shield.id)).toEqual({
            absorptionDamage: 0,
            capacityDamage: 4,
        });
    });

    it('round-trips committed and pending Modular Armor damage', async () => {
        const fixture = createDirectModularArmorRuntimeFixture();
        const panel = [...fixture.index.components.values()].find(component =>
            component.kind === 'equipment'
            && component.mount.equipment?.hasFlag('F_MODULAR_ARMOR') === true)!;
        const slot = [...fixture.index.slots.values()].find(candidate =>
            candidate.componentIds.includes(panel.id))!;
        const face = [...fixture.index.armorFaces.values()].find(candidate =>
            candidate.locationId === slot.locationId && candidate.face === 'front')!;
        expect(fixture.instance.dispatch({
            type: 'damage-armor',

            faceId: face.id, amount: 6, target: 'committed',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'damage-armor',

            faceId: face.id, amount: 3, target: 'pending',
        }).accepted).toBeTrue();

        const saved = serialize(fixture);
        expect(saved.componentState?.find(entry => {
            const target = saved.blueprintReferences.targets[entry.target];
            return target?.kind === 'component' && target.savedComponentId === panel.id;
        })?.modularArmorDamage).toBe(6);
        expect(saved.pendingCombat?.modularArmorDamage?.[0]).toEqual(jasmine.objectContaining({
            damage: 3,
        }));

        const restored = await restoreSerializedCBTUnitV2(saved, fixture.entity, fixture.index, fixture.initialized);
        expect(restored.unresolved).toEqual([]);
        expect(restored.state.components.get(panel.id)?.modularArmorDamage).toBe(6);
        expect(restored.state.pendingCombat.modularArmorDamage.get(panel.id)).toBe(3);
    });

    it('rejects impossible live shield damage and clamps stale saved damage for recovery', async () => {
        const fixture = createDirectShieldRuntimeFixture();
        const shield = fixture.equipmentComponent('Test Medium Shield');
        const impossibleState = {
            ...fixture.instance.snapshot(),
            components: new ImmutableIndex([[
                shield.id,
                Object.freeze({ shieldDamage: Object.freeze({ absorptionDamage: 6, capacityDamage: 19 }) }),
            ]]),
        };
        expect(() => serialize(fixture, impossibleState)).toThrowError(/shield damage exceeds its track bounds/u);

        expect(fixture.instance.dispatch({
            type: 'damage-shield',

            componentId: shield.id, track: 'absorption', amount: 1, target: 'committed',
        }).accepted).toBeTrue();
        const stale = serialize(fixture);
        const shieldState = stale.componentState?.find(entry => {
            const target = stale.blueprintReferences.targets[entry.target];
            return target?.kind === 'component' && target.savedComponentId === shield.id;
        });
        if (!shieldState) throw new Error('Serialized shield state is missing');
        (shieldState as { shieldDamage: { absorptionDamage: number; capacityDamage: number } }).shieldDamage = {
            absorptionDamage: 6,
            capacityDamage: 19,
        };

        const restored = await restoreSerializedCBTUnitV2(stale, fixture.entity, fixture.index, fixture.initialized);
        expect(restored.state.components.get(shield.id)?.shieldDamage).toEqual({
            absorptionDamage: 5,
            capacityDamage: 18,
        });
        expect(restored.warnings).toContain(jasmine.objectContaining({ code: 'DAMAGE_CLAMPED' }));
        expect(restored.unresolved).toContain(jasmine.objectContaining({
            reason: 'SHIELD_DAMAGE_EXCEEDS_CURRENT_CAPACITY',
        }));
    });

    it('rejects a snapshot for another unit UUID', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const original = serialize(fixture);
        const changedIdentity = '019f6767-0dcb-7bb8-992f-aef08202f5e2' as typeof original.entity;
        const saved = {
            ...original,
            entity: changedIdentity,
            baselineRefAtSave: {
                ...original.baselineRefAtSave,
                entity: changedIdentity,
            },
        };
        await expectAsync(restoreSerializedCBTUnitV2(saved, fixture.entity, fixture.index, fixture.initialized))
            .toBeRejectedWithError(/UUID/u);
    });
});

function serialize(
    fixture: ReturnType<typeof createDirectMekRuntimeFixture>,
    state = fixture.instance.snapshot(),
) {
    return structuredClone(serializeCBTUnitStateV2({
        entity: fixture.entity,
        index: fixture.index,
        instanceId: fixture.instance.id,
        baselineRef: fixture.instance.baselineRef,
        state,
        deployment: {
            schemaVersion: 2,
            values: fixture.initialized.deployment,
        },
    }));
}
