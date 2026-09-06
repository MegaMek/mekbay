// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { LegacyUnitSourceV1, JsonObject, JsonValue } from '../persisted-unit-state';
import { asUnitUuid, type UnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { restoreLegacyUnitState, StateRestoreIdentityError } from './state-restorer';
import { buildMekRuntimeIndex } from './mek-runtime-index';
import { initializeUnitState } from './unit-state-initializer';
import {
    createDirectEscalatingFailureRuntimeFixture,
    createDirectEngineHeatRuntimeFixture,
    createDirectMekRuntimeFixture,
    createDirectModularArmorRuntimeFixture,
    createDirectShieldRuntimeFixture,
    createDirectSuperheavyRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

describe('V1 unit-state ingress', () => {
    for (const shutdown of [false, true]) {
        it(`converts the early V1 shutdown boolean (${shutdown}) without a lost-state warning`, async () => {
            const fixture = createDirectMekRuntimeFixture();
            const restored = await restoreLegacyUnitState(record(fixture.identity, {
                shutdown,
                conditions: ['prone'],
                ruleChecks: {},
            }), fixture.entity, fixture.initialized);

            expect(restored.state.conditions.has('shutdown')).toBe(shutdown);
            expect(restored.state.conditions.has('prone')).toBeTrue();
            expect(restored.warnings).toEqual([]);
        });
    }

    for (const [engineType, name] of [['Fusion', 'Fusion Engine'], ['XL', 'XL Fusion Engine']] as const) {
        it(`recognizes the V1 ${name} sheet label and redundant location-destruction markers`, async () => {
            const fixture = createDirectEngineHeatRuntimeFixture(engineType);
            const center = [...fixture.index.locations.values()].find(location => location.code === 'CT')!;
            const restored = await restoreLegacyUnitState(record(fixture.identity, {
                locations: { CT: { internal: center.internalPoints } },
            }, [], [
                { id: 'Engine', name, loc: 'CT', slot: 0, hits: 0,
                    destroying: 1780034437681, destroyed: 1780034437681 },
                { id: 'Engine', name, loc: 'CT', slot: 1, hits: 1,
                    destroying: 1780034437682, destroyed: 1780034437682, armored: false },
            ]), fixture.entity, fixture.initialized);
            const slots = [...fixture.index.slots.values()].filter(slot => slot.locationId === center.id);

            expect(restored.state.locations.get(center.id)?.internalDamage).toBe(center.internalPoints);
            expect(restored.state.slots.has(slots.find(slot => slot.slotIndex === 0)!.id)).toBeFalse();
            expect(restored.state.slots.get(slots.find(slot => slot.slotIndex === 1)!.id)?.hits).toBe(1);
            expect(restored.state.pendingCombat.criticalHits.size).toBe(0);
            expect(restored.warnings).toEqual([]);
        });
    }

    it('restores a V1 destroying timestamp as pending direct damage without committing it', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const restored = await restoreLegacyUnitState(record(fixture.identity, {}, [], [
            { id: 'Engine', name: 'Fusion Engine', loc: 'CT', slot: 0, hits: 1, destroying: 1780034437681 },
            { id: 'Engine', name: 'Fusion Engine', loc: 'CT', slot: 1, hits: 0, destroying: 1780034437681 },
            { id: 'Engine', name: 'Fusion Engine', loc: 'CT', slot: 2, hits: 1, pendingHits: -1,
                destroying: 1780034437681, destroyed: 1780034437681 },
        ]), fixture.entity, fixture.initialized);
        const centerSlots = [...fixture.index.slots.values()].filter(slot =>
            fixture.index.locations.get(slot.locationId)?.code === 'CT');

        expect(restored.state.slots.has(centerSlots.find(slot => slot.slotIndex === 0)!.id)).toBeFalse();
        expect(restored.state.pendingCombat.criticalHits.get(centerSlots.find(slot => slot.slotIndex === 0)!.id)).toBe(1);
        expect(restored.state.pendingCombat.criticalHits.has(centerSlots.find(slot => slot.slotIndex === 1)!.id)).toBeFalse();
        expect(restored.state.slots.get(centerSlots.find(slot => slot.slotIndex === 2)!.id)?.hits).toBe(1);
        expect(restored.state.pendingCombat.criticalHits.get(centerSlots.find(slot => slot.slotIndex === 2)!.id)).toBe(-1);
        expect(restored.warnings).toEqual([]);
    });

    it('does not turn a false V1 destruction marker into critical damage', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const restored = await restoreLegacyUnitState(record(fixture.identity, {}, [], [
            { id: 'Engine', name: 'Fusion Engine', loc: 'CT', slot: 0, destroyed: false, destroying: false },
        ]), fixture.entity, fixture.initialized);

        expect(restored.state.slots.size).toBe(0);
        expect(restored.state.pendingCombat.criticalHits.size).toBe(0);
        expect(restored.warnings).toEqual([]);
    });

    it('accepts pristine V1 inventory and physical-attack rows without requiring a mount', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const restored = await restoreLegacyUnitState(record(fixture.identity, {}, [
            { id: 'Punch@LA', destroyed: false },
            { id: 'Punch@RA', destroyed: false },
            { id: 'Kick@—', destroyed: false },
            { id: 'Charge@—', destroyed: false },
            { id: 'Push@—', destroyed: false },
            { id: 'Heat Sink@RA#4', destroyed: false },
        ]), fixture.entity, fixture.initialized);

        expect(restored.state.components.size).toBe(0);
        expect(restored.warnings).toEqual([]);
    });

    it('uses the saved critical coordinate to distinguish identical equipment in one location', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const rightArmSlots = [...fixture.index.slots.values()].filter(slot =>
            fixture.index.locations.get(slot.locationId)?.code === 'RA');
        const targetId = rightArmSlots.find(slot => slot.slotIndex === 4)!.componentIds[0];
        const otherId = rightArmSlots.find(slot => slot.slotIndex === 5)!.componentIds[0];
        const restored = await restoreLegacyUnitState(record(fixture.identity, {}, [
            { id: 'Heat Sink@RA#4', destroyed: true },
        ]), fixture.entity, fixture.initialized);

        expect(restored.state.components.get(targetId)?.statusOverride).toBe('destroyed');
        expect(restored.state.components.has(otherId)).toBeFalse();
        expect(restored.warnings).toEqual([]);
    });

    it('still reports unmatched inventory when it contains a saved change', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const restored = await restoreLegacyUnitState(record(fixture.identity, {}, [
            { id: 'Punch@LA', destroyed: true },
            { id: 'Heat Sink@RA#0', destroyed: true },
        ]), fixture.entity, fixture.initialized);

        expect(restored.state.components.size).toBe(0);
        expect(restored.warnings).toEqual(['Equipment-specific state has no unique compatible target']);
    });

    for (const [consumed, expectedSpent] of [[0, [0, 0]], [5, [5, 0]], [17, [12, 5]], [25, [12, 12]]] as const) {
        it(`restores ${consumed} consumed shots from a combined superheavy V1 ammo slot`, async () => {
            const fixture = createDirectSuperheavyRuntimeFixture('total-warfare');
            const bin = fixture.equipmentComponent('Test Artemis Ammo').mount;
            fixture.entity.setEquipment([
                ...fixture.entity.equipment(),
                bin.clone({ mountId: 'paired-ammo-bin' }),
            ]);
            const index = buildMekRuntimeIndex(fixture.entity);
            const initialized = initializeUnitState(fixture.entity, index, fixture.identity, {
                initializerRevision: 1, profileId: 'pristine', deployment: { id: 'default' },
                scenario: { id: 'megamek', ruleset: 'total-warfare' },
            });
            const slot = [...index.slots.values()].find(candidate => candidate.componentIds.length === 2)!;
            const restored = await restoreLegacyUnitState(record(fixture.identity, {}, [], [{
                id: 'Test Artemis Ammo', name: 'Test Artemis Ammo',
                loc: index.locations.get(slot.locationId)!.code, slot: slot.slotIndex, hits: 0, consumed,
            }]), fixture.entity, initialized);

            expect(slot.componentIds.map(id => restored.state.ammo.get(id)?.shotsSpent ?? 0)).toEqual([...expectedSpent]);
            expect(restored.state.slots.size).toBe(0);
            expect(restored.warnings).toEqual(consumed > 24
                ? ['Critical-slot ammunition consumption exceeded current capacity']
                : []);
        });
    }

    it('keeps warnings for malformed shutdown, unknown state, and genuinely different slot occupants', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const restored = await restoreLegacyUnitState(record(fixture.identity, {
            shutdown: 'yes', unknownState: true,
        }, [], [
            { id: 'Engine', name: 'Medium Laser', loc: 'CT', slot: 0, hits: 1 },
        ]), fixture.entity, fixture.initialized);

        expect(restored.state.conditions.has('shutdown')).toBeFalse();
        expect(restored.warnings.some(warning => warning.includes('shutdown'))).toBeTrue();
        expect(restored.warnings.some(warning => warning.includes('family state'))).toBeTrue();
        expect(restored.warnings.some(warning => warning.includes('occupant mismatch'))).toBeTrue();
    });

    it('converts legacy facts once into sparse V2 state over the direct entity', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const center = [...fixture.index.locations.values()].find(location => location.code === 'CT')!;
        const savedUuid = fixture.identity;
        const restored = await restoreLegacyUnitState(record(savedUuid, {
            destroyed: true,
            conditions: ['prone'],
            heat: { current: 4, previous: 2, next: 7, heatsinksOff: 1 },
            locations: { CT: { internal: 2, armor: 1 } },
        }), fixture.entity, fixture.initialized);

        expect(restored.state.explicitlyDestroyed).toBeTrue();
        expect(restored.state.destroyed).toBeTrue();
        expect(restored.state.conditions.has('prone')).toBeTrue();
        expect(restored.state.heat).toEqual({
            current: 4, previous: 2, pendingOverride: 7, heatsinksOff: 1,
        });
        expect(restored.state.locations.get(center.id)?.internalDamage).toBe(2);
        expect(restored.warnings).toEqual([]);
        expect(Object.keys(restored).sort()).toEqual(['state', 'warnings']);
    });

    it('never applies legacy state to another entity UUID', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const foreign = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2');
        await expectAsync(restoreLegacyUnitState(record(foreign, {}), fixture.entity, fixture.initialized))
            .toBeRejectedWithError(StateRestoreIdentityError);
    });

    it('reports unconvertible V1 movement with a warning and retains no raw recovery state', async () => {
        const fixture = createDirectMekRuntimeFixture();
        const restored = await restoreLegacyUnitState(record(fixture.identity, {
            turnState: { moveMode: 'run', moveDistance: 8 },
        }), fixture.entity, fixture.initialized);

        expect(restored.state.movementPsr.movement).toBeNull();
        expect(restored.warnings.some(message => message.includes('could not be converted'))).toBeTrue();
        expect(Object.keys(restored).sort()).toEqual(['state', 'warnings']);
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
        expect(restored.warnings).toEqual([]);
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
        expect(restored.warnings).toEqual([]);
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
        expect(restored.warnings).toEqual([]);
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
        expect(restored.warnings).toEqual([]);
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
        expect(restored.warnings).toEqual([]);
    });
});

function record(
    identity: UnitUuid,
    state: JsonObject,
    inventory: readonly JsonValue[] = [],
    criticals: readonly JsonValue[] = [],
): LegacyUnitSourceV1 {
    return {
        payload: {
            state: {
                ...state,
                ...(inventory.length === 0 ? {} : { inventory: [...inventory] }),
                ...(criticals.length === 0 ? {} : { crits: [...criticals] }),
            },
        },
        identity: { kind: 'resolved', uuid: identity },
    };
}
