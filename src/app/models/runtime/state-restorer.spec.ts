// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { DeferredUnitSource, JsonObject, JsonValue, SavedEntityIdentity } from '../persisted-unit-state';
import { asSourceHash, asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { restoreLegacyUnitState, StateRestoreIdentityError } from './state-restorer';
import {
    createDirectEscalatingFailureRuntimeFixture,
    createDirectMekRuntimeFixture,
    createDirectModularArmorRuntimeFixture,
    createDirectShieldRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

describe('V1 unit-state ingress', () => {
    it('converts legacy facts once into sparse V2 state over the direct entity', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const center = [...fixture.index.locations.values()].find(location => location.code === 'CT')!;
        const savedIdentity: SavedEntityIdentity = {
            ...fixture.identity,
            sourceHashAtSave: asSourceHash('B'.repeat(26) + 'A'),
        };
        const restored = await restoreLegacyUnitState(record(savedIdentity, {
            destroyed: true,
            conditions: ['prone'],
            heat: { current: 4, previous: 2, next: 7, heatsinksOff: 1 },
            locations: { CT: { internal: 2, armor: 1 } },
        }), fixture.entity, fixture.initialized);

        expect(restored.state.destroyed).toBeTrue();
        expect(restored.state.conditions.has('prone')).toBeTrue();
        expect(restored.state.heat).toEqual({
            current: 4, previous: 2, pendingOverride: 7, heatsinksOff: 1,
        });
        expect(restored.state.locations.get(center.id)?.internalDamage).toBe(2);
        expect(restored.metadata.savedIdentity).toEqual(savedIdentity);
        expect(restored.metadata.targetEntity).toEqual(fixture.identity);
        expect(restored.metadata.warnings.map(warning => warning.code))
            .toContain('SOURCE_REVISION_CHANGED');
        expect(Object.prototype.hasOwnProperty.call(restored.metadata, 'targetPublished')).toBeFalse();
    });

    it('never applies legacy state to another entity UUID', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const foreign: SavedEntityIdentity = {
            ...fixture.identity,
            uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2'),
        };
        await expectAsync(restoreLegacyUnitState(record(foreign, {}), fixture.entity, fixture.initialized))
            .toBeRejectedWithError(StateRestoreIdentityError);
    });

    it('keeps unconvertible V1 movement as diagnostics, not a second runtime mode', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const restored = await restoreLegacyUnitState(record(fixture.identity, {
            turnState: { moveMode: 'run', moveDistance: 8 },
        }), fixture.entity, fixture.initialized);

        expect(restored.state.movementPsr.movement).toBeNull();
        expect(restored.metadata.unresolved).toEqual(jasmine.arrayContaining([
            jasmine.objectContaining({
                kind: 'unit-family',
                reason: jasmine.stringMatching('could not be converted'),
            }),
        ]));
        expect(Object.prototype.hasOwnProperty.call(restored.state, 'movementPsrRecovery')).toBeFalse();
        expect(Object.prototype.hasOwnProperty.call(restored.state, 'movementHeatFallback')).toBeFalse();
    });

    it('converts the legacy Gauss control state into the independent sparse field', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const gauss = fixture.equipmentComponent('Test HAG');
        const restored = await restoreLegacyUnitState(record(fixture.identity, {}, [{
            id: gauss.id,
            states: [{ name: 'inventory_control_mode', value: 'Powered Down' }],
        }]), fixture.entity, fixture.initialized);

        expect(restored.state.components.get(gauss.id)?.gaussPower).toBe('Powered Down');
        expect(restored.state.components.get(gauss.id)?.mode).toBeUndefined();
        expect(restored.metadata.unresolved).toEqual([]);
    });

    it('converts production V1 escalating keys with their rules-owned sequence length', async () => {
        const fixture = createDirectEscalatingFailureRuntimeFixture('total-warfare');
        const blueShield = fixture.equipmentComponent('Test Blue Shield');
        const viralJammer = fixture.equipmentComponent('Test RISC Viral Jammer');
        const restored = await restoreLegacyUnitState(record(fixture.identity, {}, [{
            id: blueShield.id,
            states: [
                { name: 'blueShieldUses', value: '14' },
                { name: 'blueShieldUsedThisTurn', value: 'true' },
            ],
        }, {
            id: viralJammer.id,
            states: [
                { name: 'riscViralJammer', value: '8' },
                { name: 'riscViralJammerActive', value: 'true' },
            ],
        }]), fixture.entity, fixture.initialized);

        expect(restored.state.components.get(blueShield.id)?.escalatingFailure)
            .toEqual({ sequence: 14, active: true });
        expect(restored.state.components.get(viralJammer.id)?.escalatingFailure)
            .toEqual({ sequence: 8, active: true });
        expect(restored.metadata.unresolved).toEqual([]);
    });

    it('converts legacy synthetic shield tracks into direct component runtime damage', async () => {
        const fixture = createDirectShieldRuntimeFixture('core-2026', 'medium');
        const shield = fixture.equipmentComponent('Test Medium Shield');
        const restored = await restoreLegacyUnitState(record(fixture.identity, {
            locations: {
                DALA: { armor: 3, pendingArmor: 2 },
                DCLA: { armor: 7, pendingArmor: -2 },
            },
        }), fixture.entity, fixture.initialized);

        expect(restored.state.components.get(shield.id)?.shieldDamage).toEqual({
            absorptionDamage: 3,
            capacityDamage: 7,
        });
        expect(restored.state.pendingCombat.shieldDamage.get(shield.id)).toEqual({
            absorptionDamage: 2,
            capacityDamage: -2,
        });
        expect(restored.state.locations.size).toBe(0);
        expect(restored.state.pendingCombat.armorDamage.size).toBe(0);
        expect(restored.metadata.unresolved).toEqual([]);
    });

    it('converts production V1 Modular Armor consumption into sparse panel damage', async () => {
        const fixture = createDirectModularArmorRuntimeFixture();
        const panel = [...fixture.index.components.values()].find(component =>
            component.kind === 'equipment'
            && component.mount.equipment?.hasFlag('F_MODULAR_ARMOR') === true)!;
        const restored = await restoreLegacyUnitState(record(fixture.identity, {}, [{
            id: panel.id,
            consumed: 7,
        }]), fixture.entity, fixture.initialized);

        expect(restored.state.components.get(panel.id)?.modularArmorDamage).toBe(7);
        expect(restored.state.ammo.has(panel.id)).toBeFalse();
        expect(restored.metadata.unresolved).toEqual([]);
    });

    it('converts production turn chronology into current sparse critical state', async () => {
        const fixture = createDirectMekRuntimeFixture('total-warfare');
        const hip = [...fixture.index.slots.values()].find(slot =>
            fixture.index.locations.get(slot.locationId)?.code === 'LL'
            && slot.componentIds.some(componentId => {
                const component = fixture.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Hip';
            }))!;
        const restored = await restoreLegacyUnitState(record(
            fixture.identity,
            { turnState: { turnCounter: 3 } },
            [],
            [{ loc: 'LL', slot: hip.slotIndex, hits: 1, destroyedTurn: 2 }],
        ), fixture.entity, fixture.initialized);

        expect(restored.state.turn.turnCounter).toBe(3);
        expect(restored.state.slots.get(hip.id)).toEqual({ hits: 1, destroyedTurn: 2 });
        expect(restored.metadata.unresolved).toEqual([]);
    });
});

function record(
    identity: SavedEntityIdentity,
    state: JsonObject,
    inventory: readonly JsonValue[] = [],
    criticals: readonly JsonValue[] = [],
): DeferredUnitSource {
    return {
        payload: {
            state: {
                ...state,
                ...(inventory.length === 0 ? {} : { inventory: [...inventory] }),
                ...(criticals.length === 0 ? {} : { crits: [...criticals] }),
            },
        },
        identity: { kind: 'resolved', savedIdentity: identity },
    };
}
