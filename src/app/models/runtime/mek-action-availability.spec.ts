// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { canPerformMekAction } from './mek-action-availability';
import { asEncounterTargetId } from './encounter-runtime';
import { createDirectAesRuntimeFixture, createDirectMekRuntimeFixture, emptyCBTEncounterSnapshot } from './testing/direct-mek-runtime-fixture';

describe('Mek attack declarations', () => {
    for (const ruleset of ['total-warfare', 'core-2026'] as const) {
        it(`requires conscious crew to shoot or punch under ${ruleset}`, () => {
            const { instance, index, entity, equipmentComponent } = createDirectMekRuntimeFixture(ruleset);
            const positionId = [...index.crewPositions.keys()][0]!;
            const punch = () => canPerformMekAction(entity, index, instance.query(),
                { kind: 'intrinsic', actionId: 'intrinsic:punch:RA' }, 'physical-attack', ruleset);
            const shoot = () => instance.dispatch({ type: 'fire-weapons',
                selections: [{ weaponId: equipmentComponent('ISMediumLaser').id }] }).changed;
            instance.dispatch({ type: 'set-crew-state', positionId, wounds: 1, unconscious: true, ejected: false });
            expect([shoot(), punch()]).toEqual([false, false]);
            instance.dispatch({ type: 'set-crew-state', positionId, wounds: 1, unconscious: false, ejected: false });
            expect([shoot(), punch()]).toEqual([true, true]);
        });
        it(`refuses a distant punch at declaration and accepts it after moving adjacent under ${ruleset}`, () => {
            const { instance } = createDirectMekRuntimeFixture(ruleset);
            const targetId = asEncounterTargetId('target:reach');
            const registry = { revision: 0, targets: [{ id: targetId, letter: 'A', color: '#ffffff',
                name: 'Target', unitType: 'mek-biped' as const }] };
            const setDistance = (distance: number) => instance.dispatchAttackerTargeting({ type: 'edit-attacker-targeting',
                edit: { kind: 'set-target-facts', targetId, facts: { distance } },
            }, registry, false);
            const punch = () => instance.dispatchAttackerTargeting({ type: 'edit-attacker-targeting',
                edit: { kind: 'set-action-selection', target: { kind: 'intrinsic', actionId: 'intrinsic:punch:LA' },
                    selection: { kind: 'target', targetId } },
            }, registry, false).changed;
            expect(setDistance(5).changed).toBeTrue();
            expect(punch()).toBeFalse();
            expect(setDistance(1).changed).toBeTrue();
            expect(punch()).toBeTrue();
        });
        it(`accepts two punches but refuses a third conflicting declaration under ${ruleset}`, () => {
            const { instance } = createDirectMekRuntimeFixture(ruleset);
            const declare = (actionId: string, select = true) => instance.dispatchAttackerTargeting({
                type: 'edit-attacker-targeting', edit: { kind: 'set-action-selection', target: { kind: 'intrinsic', actionId },
                    selection: select ? { kind: 'selected' } : null },
            }, emptyCBTEncounterSnapshot(), false).changed;
            expect(declare('intrinsic:punch:LA')).toBeTrue();
            const laser = [...instance.getIndex().components.values()].find(component =>
                component.kind === 'equipment' && component.mount.equipment?.id === 'ISMediumLaser')!;
            expect(instance.dispatch({ type: 'fire-weapons', selections: [{ weaponId: laser.id }] }).changed).toBeFalse();
            expect(declare('intrinsic:punch:RA')).toBeTrue();
            expect(declare('intrinsic:kick')).toBeFalse();
            expect(declare('intrinsic:punch:LA', false)).toBeTrue();
            expect(declare('intrinsic:punch:RA', false)).toBeTrue();
            expect(declare('intrinsic:kick')).toBeTrue();
        });
        it(`reserves fired arms after clearing their selection under ${ruleset}`, () => {
            const { instance, index, entity, equipmentComponent } = createDirectMekRuntimeFixture(ruleset);
            instance.dispatch({ type: 'fire-weapons', selections: [{ weaponId: equipmentComponent('ISMediumLaser').id }] });
            const can = (id: string) => canPerformMekAction(entity, index, instance.query(),
                { kind: 'intrinsic', actionId: 'intrinsic:' + id }, 'physical-attack', ruleset);
            expect([can('punch:LA'), can('punch:RA'), can('push'), can('kick')]).toEqual([false, true, false, true]);
        });
        it(`requires an intact supporting arm while prone under ${ruleset}`, () => {
            const { instance, index, entity, equipmentComponent } = createDirectMekRuntimeFixture(ruleset);
            instance.dispatch({ type: 'set-condition', condition: 'prone', active: true });
            const rightArm = [...index.locations.values()].find(location => location.code === 'RA')!;
            instance.dispatch({ type: 'set-location-condition', locationId: rightArm.id,
                condition: 'blown-off', value: 1, target: 'committed' });
            const can = (name: string) => canPerformMekAction(entity, index, instance.query(),
                { kind: 'component', componentId: equipmentComponent(name).id }, 'fire', ruleset);
            expect([can('ISMediumLaser'), can('Test HAG')]).toEqual([false, ruleset === 'core-2026']);
        });
        it(`reserves one supporting arm across simultaneous and successive shots under ${ruleset}`, () => {
            const { instance, index } = createDirectAesRuntimeFixture(ruleset);
            const lasers = [...index.components.values()].filter(component =>
                component.kind === 'equipment' && component.mount.equipment?.id === 'ISMediumLaser');
            expect(lasers.length).toBe(2);
            instance.dispatch({ type: 'set-condition', condition: 'prone', active: true });
            const selections = lasers.map(component => ({ weaponId: component.id }));
            expect(instance.dispatch({ type: 'fire-weapons', selections }).changed).toBeFalse();
            expect(instance.dispatch({ type: 'fire-weapons', selections: [selections[0]!] }).changed).toBeTrue();
            expect(instance.dispatch({ type: 'fire-weapons', selections: [selections[1]!] }).changed).toBeFalse();
        });
    }
});
