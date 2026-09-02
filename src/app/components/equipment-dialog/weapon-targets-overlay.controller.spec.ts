// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injector, signal } from '@angular/core';
import type { CBTForce } from '../../models/cbt-force.model';
import { CBTForceMember, type CBTMekForceMember } from '../../models/force-member.model';
import { TestBipedMekEntity } from '../../models/entity/testing/test-entities';
import {
    asEncounterTargetId,
    type EncounterTarget,
    type TargetRegistryCommand,
} from '../../models/runtime/encounter-runtime';
import {
    ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
} from '../../models/runtime/attacker-targeting-state';
import { InventoryControlOpforService } from '../../services/inventory-control-opfor.service';
import { LoggerService } from '../../services/logger.service';
import { ToastService } from '../../services/toast.service';
import {
    WeaponTargetsOverlayController,
    type WeaponTargetsOverlayOpenOptions,
} from './weapon-targets-overlay.controller';

function sharedTarget(overrides: Partial<EncounterTarget> = {}): EncounterTarget {
    return {
        id: asEncounterTargetId('A'),
        letter: 'A',
        name: 'Target A',
        color: '#c0f7ff',
        source: 'manual',
        unitType: 'mek-biped',
        tnCalculator: { largeTarget: false },
        ...overrides,
    };
}

function createHarness(readOnly = false) {
    const target = sharedTarget();
    const snapshot = { revision: 4, targets: [target] };
    const query = jasmine.createSpy('queryInventoryControlTargetRegistry').and.returnValue(snapshot);
    const dispatch = jasmine.createSpy('dispatchInventoryControlTargetRegistry').and.returnValue({
        accepted: true,
        changed: false,
        snapshot,
    });
    const instanceId = 'attacker-1';
    const targeting = {
        instanceId,
        stateRevision: 2,
        registryRevision: 4,
        state: {
            schemaVersion: ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
            components: new Map(),
            actions: new Map(),
            targets: new Map(),
        },
    };
    const dispatchTargeting = jasmine.createSpy('dispatchAttackerTargeting')
        .and.resolveTo({ accepted: true, idempotent: false, currentRevision: 3 });
    const force = {
        queryInventoryControlTargetRegistry: query,
        dispatchInventoryControlTargetRegistry: dispatch,
        targetRegistryVersion: signal(0).asReadonly(),
        inventoryControlOpforEnabled: signal(false),
        readOnly: () => readOnly,
        getAttackerTargeting: () => targeting,
        dispatchAttackerTargeting: dispatchTargeting,
        getUnitSnapshot: () => ({ ruleset: 'total-warfare' }),
        getMekTurnPanelSnapshot: () => ({ movementState: { movement: null } }),
        getC3State: () => 'none',
        getRosterGroupId: () => 'group:test',
    } as unknown as CBTForce;
    const entity = new TestBipedMekEntity();
    entity.chassis.set('Attacker');
    const member = new CBTForceMember(instanceId, force, entity) as CBTMekForceMember;
    const opforService = jasmine.createSpyObj<InventoryControlOpforService>(
        'InventoryControlOpforService',
        ['setEnabled', 'isAvailable'],
    );
    opforService.setEnabled.and.returnValue(true);
    opforService.isAvailable.and.returnValue(true);
    const logger = jasmine.createSpyObj<LoggerService>('LoggerService', ['error']);
    const toast = jasmine.createSpyObj<ToastService>('ToastService', ['showToast']);
    const injector = {
        get(token: unknown) {
            if (token === InventoryControlOpforService) return opforService;
            if (token === LoggerService) return logger;
            if (token === ToastService) return toast;
            throw new Error(`Unexpected injection token ${String(token)}`);
        },
    } as Injector;
    const controller = new WeaponTargetsOverlayController({
        overlay: {} as never,
        overlayManager: {} as never,
        injector,
        destroyRef: {} as never,
    });
    const options: WeaponTargetsOverlayOpenOptions = {
        overlayKey: 'targets:test',
        target: document.createElement('button'),
        member,
        readOnly: () => readOnly,
    };
    return {
        controller: controller as any,
        options,
        force,
        member,
        query,
        dispatch,
        dispatchTargeting,
        opforService,
        logger,
        toast,
        snapshot,
        target,
    };
}

describe('WeaponTargetsOverlayController target-registry routing', () => {
    it('splits shared target facts from attacker-local target state', async () => {
        const harness = createHarness();

        await harness.controller.updateTarget(harness.options, {
            targetId: 'A',
            patch: {
                unitType: 'vehicle',
                distance: 8,
                c3Distance: 3,
                useC3: true,
                tnModifier: 2,
                tnCalculator: {
                    prone: true,
                    indirectFire: true,
                    secondaryTarget: true,
                },
            },
        });

        expect(harness.dispatch).toHaveBeenCalledOnceWith({
            kind: 'update-target',
            targetId: asEncounterTargetId('A'),
            patch: {
                unitType: 'vehicle',
                tnCalculator: { largeTarget: false, prone: true },
            },
        }, 'user');
        expect(harness.dispatchTargeting).toHaveBeenCalledOnceWith(harness.member.id, {
            type: 'edit-attacker-targeting',
            edit: {
                kind: 'set-target-facts',
                targetId: asEncounterTargetId('A'),
                facts: {
                    distance: 8,
                    c3Distance: 3,
                    useC3: true,
                    calculator: { indirectFire: true, secondaryTarget: true },
                },
            },
        });
    });

    it('routes OPFOR presentation color while filtering shared defaults and applying the local delta', async () => {
        const harness = createHarness();
        const opfor = sharedTarget({
            id: asEncounterTargetId('opfor:v1:readonly'),
            source: 'opfor',
            readOnly: true,
            tnCalculator: { prone: false, immobile: false },
        });
        harness.query.and.returnValue({
            revision: 7,
            targets: [opfor],
        });

        await harness.controller.updateTarget(harness.options, {
            targetId: opfor.id,
            patch: {
                color: '#abcdef',
                distance: 9,
                tnCalculator: {
                    // The full dialog form contains shared defaults that the
                    // OPFOR registry correctly refuses to mutate.
                    targetHexCover: 'none',
                    indirectFire: true,
                    secondaryTarget: true,
                },
            },
        });

        expect(harness.dispatch).toHaveBeenCalledOnceWith({
            kind: 'update-target',
            targetId: opfor.id,
            patch: { color: '#abcdef' },
        }, 'user');
        expect(harness.dispatchTargeting).toHaveBeenCalledOnceWith(harness.member.id, {
            type: 'edit-attacker-targeting',
            edit: {
                kind: 'set-target-facts',
                targetId: opfor.id,
                facts: {
                    distance: 9,
                    calculator: { indirectFire: true, secondaryTarget: true },
                },
            },
        });
        expect(harness.logger.error).not.toHaveBeenCalled();
        expect(harness.toast.showToast).not.toHaveBeenCalled();
    });

    it('keeps manual TN overrides attacker-local without registry dispatch', async () => {
        const harness = createHarness();

        await harness.controller.updateTarget(harness.options, {
            targetId: 'A',
            patch: { tnModifier: 5 },
            manualTnOverride: true,
        });

        expect(harness.dispatch).not.toHaveBeenCalled();
        expect(harness.dispatchTargeting).toHaveBeenCalledOnceWith(harness.member.id, jasmine.objectContaining({
            edit: {
                kind: 'set-target-facts',
                targetId: asEncounterTargetId('A'),
                facts: { manualTnOverride: { kind: 'user-manual', modifier: 5 } },
            },
        }));
    });

    it('surfaces a refused shared update and does not apply its local half', async () => {
        const harness = createHarness();
        harness.dispatch.and.returnValue({
            accepted: false,
            changed: false,
            snapshot: harness.snapshot,
        });

        await harness.controller.updateTarget(harness.options, {
            targetId: 'A',
            patch: { name: 'Changed', distance: 12 },
        });

        expect(harness.dispatch.calls.mostRecent().args[0]).toEqual({
            kind: 'update-target',
            
            targetId: asEncounterTargetId('A'),
            patch: { name: 'Changed' },
        } satisfies TargetRegistryCommand);
        expect(harness.dispatchTargeting).not.toHaveBeenCalled();
        expect(harness.logger.error).toHaveBeenCalledWith('Could not update target: the target is read-only.');
        expect(harness.toast.showToast).toHaveBeenCalledWith(
            'Could not update target: the target is read-only.',
            'error',
        );
    });

    it('creates and deletes against the force-owned registry', () => {
        const harness = createHarness();
        const emptySnapshot = { revision: 8, targets: [] as EncounterTarget[] };
        const populatedSnapshot = { revision: 9, targets: [harness.target] };
        harness.query.and.returnValues(emptySnapshot, populatedSnapshot);

        harness.controller.createTarget(harness.options);
        harness.controller.deleteTarget(harness.options, 'A');

        expect(harness.dispatch.calls.argsFor(0)[0]).toEqual(jasmine.objectContaining({
            kind: 'create-target',
        }));
        expect(harness.dispatch.calls.argsFor(1)[0]).toEqual({
            kind: 'delete-target',
            targetId: asEncounterTargetId('A'),
        });
    });

    it('atomically reclaims an OPFOR slot for a manual target but rejects an all-manual full registry', () => {
        const harness = createHarness();
        const manual = Array.from({ length: 23 }, (_value, index) => {
            const letter = String.fromCharCode('A'.charCodeAt(0) + index);
            return sharedTarget({ id: asEncounterTargetId(letter), letter, name: `Target ${letter}` });
        });
        const opfor = sharedTarget({
            id: asEncounterTargetId('opfor:v1:capacity'),
            letter: 'X',
            source: 'opfor',
            readOnly: true,
        });
        harness.query.and.returnValue({ revision: 10, targets: [...manual, opfor] });

        harness.controller.createTarget(harness.options);

        const [createCommand, source] = harness.dispatch.calls.mostRecent().args;
        expect(source).toBe('user');
        expect(createCommand).toEqual(jasmine.objectContaining({
            kind: 'create-target',
            target: jasmine.objectContaining({
                letter: 'X',
                name: 'Target X',
                color: opfor.color,
                source: 'manual',
            }),
        }));
        expect(String(createCommand.target.id)).toMatch(/^target:[0-9a-f-]{36}$/u);
        expect(createCommand.target.id).not.toBe(opfor.id);

        harness.dispatch.calls.reset();
        harness.logger.error.calls.reset();
        harness.toast.showToast.calls.reset();
        const allManual = [...manual, sharedTarget({ id: asEncounterTargetId('X'), letter: 'X' })];
        harness.query.and.returnValue({ revision: 11, targets: allManual });
        harness.controller.createTarget(harness.options);

        expect(harness.dispatch).not.toHaveBeenCalled();
        expect(harness.logger.error).toHaveBeenCalledWith(
            'Could not add target: the target registry is full.',
        );
        expect(harness.toast.showToast).toHaveBeenCalledWith(
            'Could not add target: the target registry is full.',
            'error',
        );
    });

    it('routes CLEAR directly through one typed atomic registry reset', () => {
        const harness = createHarness();

        harness.controller.resetTargets(harness.options);

        expect(harness.opforService.setEnabled).not.toHaveBeenCalled();
        expect(harness.dispatch).toHaveBeenCalledOnceWith({
            kind: 'reset-targets',
        }, 'registry-reset');
        expect(harness.force.inventoryControlOpforEnabled()).toBeFalse();
    });

    it('blocks every target mutation while read-only', async () => {
        const harness = createHarness(true);

        harness.controller.createTarget(harness.options);
        await harness.controller.updateTarget(harness.options, { targetId: 'A', patch: { name: 'Changed', distance: 4 } });
        harness.controller.deleteTarget(harness.options, 'A');
        harness.controller.resetTargets(harness.options);

        expect(harness.query).not.toHaveBeenCalled();
        expect(harness.dispatch).not.toHaveBeenCalled();
        expect(harness.dispatchTargeting).not.toHaveBeenCalled();
    });

    it('projects and edits retained V2 target facts through the original target overlay', async () => {
        const harness = createHarness();
        const instanceId = 'retained-targeting';
        const targeting = {
            instanceId,
            stateRevision: 12,
            registryRevision: 4,
            state: {
                schemaVersion: ATTACKER_TARGETING_STATE_SCHEMA_VERSION,
                components: new Map(),
                targets: new Map([[asEncounterTargetId('A'), {
                    distance: 8,
                    calculator: { interveningWoods: 'light1' as const },
                    manualTnOverride: { kind: 'user-manual' as const, modifier: 6 },
                }]]),
            },
        };
        const dispatchTargeting = jasmine.createSpy('dispatchAttackerTargeting')
            .and.resolveTo({ accepted: true, idempotent: false, currentRevision: 13 });
        const force = {
            ...harness.force,
            readOnly: () => false,
            getAttackerTargeting: () => targeting,
            dispatchAttackerTargeting: dispatchTargeting,
            getUnitSnapshot: () => ({
                ruleset: 'total-warfare',
                entity: { key: { ruleset: { implementation: 'total-warfare' } } },
            }),
            getC3State: () => 'none',
        } as unknown as CBTForce;
        const member = new CBTForceMember(
            instanceId,
            force,
            new TestBipedMekEntity(),
        ) as CBTMekForceMember;
        const options: WeaponTargetsOverlayOpenOptions = {
            overlayKey: 'targets:retained',
            target: document.createElement('button'),
            member,
        };

        const projected = harness.controller.targets(options);
        expect(projected).toEqual([jasmine.objectContaining({
            id: asEncounterTargetId('A'),
            distance: 8,
            tnModifier: 6,
            tnCalculator: { largeTarget: false, interveningWoods: 'light1' },
        })]);

        await harness.controller.updateTarget(options, {
            targetId: 'A',
            patch: {
                distance: 9,
                tnModifier: 3,
                tnCalculator: {
                    interveningWoods: 'none',
                    partialCover: true,
                    attackDirection: 'front',
                    indirectFire: true,
                    spotterMoveMode: 'walk',
                    spotterDeclaredAttacks: true,
                },
            },
        });

        expect(dispatchTargeting).toHaveBeenCalledOnceWith(instanceId, {
            type: 'edit-attacker-targeting',
            edit: {
                kind: 'set-target-facts',
                targetId: asEncounterTargetId('A'),
                facts: {
                    distance: 9,
                    calculator: {
                        partialCover: true,
                        indirectFire: true,
                        spotterMoveMode: 'walk',
                        spotterDeclaredAttacks: true,
                    },
                },
            },
        });
    });
});
