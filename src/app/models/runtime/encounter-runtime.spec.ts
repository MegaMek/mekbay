// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asComponentId } from '../entity/entity-identifiers';
import {
    asEncounterNetworkId,
    asEncounterTargetId,
    CBTEncounterRuntime,
    createEncounterTargetId,
    decodeCBTEncounterStateV2,
    emptyCBTEncounterSnapshot,
    encodeCBTEncounterStateV2,
    queryTargetRegistry,
    reduceTargetRegistry,
    type EncounterTarget,
} from './encounter-runtime';
import { encounterTargetFactId } from './persistence-v2';

function registryTarget(letter: string, overrides: Partial<EncounterTarget> = {}): EncounterTarget {
    return {
        id: asEncounterTargetId(`target:${letter}`),
        letter,
        name: `Target ${letter}`,
        color: '#123456',
        source: 'manual',
        ...overrides,
    };
}

describe('CBT encounter runtime', () => {
    it('owns immutable, revisioned force targets behind explicit CAS commands', () => {
        const runtime = new CBTEncounterRuntime();
        const first = { ...registryTarget('A'), id: createEncounterTargetId() };
        const second = { ...registryTarget('B'), id: createEncounterTargetId() };
        expect(runtime.dispatchTargetRegistry({
            kind: 'create-target', target: first,
        }).accepted).toBeTrue();
        expect(runtime.dispatchTargetRegistry({
            kind: 'create-target', target: second,
        }).accepted).toBeTrue();

        expect(String(first.id)).toMatch(/^target:[0-9a-f-]{36}$/u);
        expect(String(second.id)).toMatch(/^target:[0-9a-f-]{36}$/u);
        expect(first.id).not.toBe(second.id);
        expect(runtime.snapshot().revision).toBe(2);
        expect(Object.isFrozen(runtime.snapshot().targets)).toBeTrue();

        const firstId = first.id;
        const secondId = second.id;
        expect(Object.isFrozen(runtime.targetRegistry().targets[0])).toBeTrue();

        runtime.dispatchTargetRegistry({
            kind: 'update-target',
            targetId: firstId, patch: { name: 'Primary' },
        });
        expect(runtime.targetRegistry().targets.find(target => target.id === firstId)).toEqual(jasmine.objectContaining({
            name: 'Primary',
        }));
        runtime.dispatchTargetRegistry({
            kind: 'delete-target', targetId: secondId,
        });
        expect(runtime.targetRegistry().targets.map(target => target.id)).toEqual([firstId]);
    });

    it('stores detached network facts without reimplementing C3 rule validation', () => {
        const runtime = new CBTEncounterRuntime();
        const network = {
            id: asEncounterNetworkId('network:c3:internal-master'),
            networkType: 'c3' as const,
            color: '#123456',
            endpoints: [
                {
                    instanceId: 'instance-1',
                    componentId: asComponentId('component:c3-master-a'),
                    role: 'master' as const,
                },
                {
                    instanceId: 'instance-1',
                    componentId: asComponentId('component:c3-master-b'),
                    role: 'member' as const,
                },
            ],
        };
        runtime.replaceNetworks([network]);
        network.color = '#abcdef';
        network.endpoints[0].componentId = asComponentId('caller-mutation');

        expect(runtime.snapshot().networks[0]).toEqual(jasmine.objectContaining({
            color: '#123456',
            endpoints: [
                jasmine.objectContaining({ componentId: asComponentId('component:c3-master-a') }),
                jasmine.objectContaining({ componentId: asComponentId('component:c3-master-b') }),
            ],
        }));

        // Domain-invalid topology is deliberately not rejected here. Admission
        // belongs to C3NetworkEditor/projectC3EditorNetworksToEncounter.
        runtime.replaceNetworks([...runtime.snapshot().networks, {
            id: asEncounterNetworkId('network:opaque-fact'),
            networkType: 'c3',
            color: '#123456',
            endpoints: [],
        }]);

        const restored = decodeCBTEncounterStateV2(encodeCBTEncounterStateV2(runtime.snapshot(), []));
        expect(restored.snapshot.networks
            .find(candidate => candidate.id === asEncounterNetworkId('network:c3:internal-master'))
            ?.endpoints.map(endpoint => endpoint.componentId)).toEqual([
            asComponentId('component:c3-master-a'),
            asComponentId('component:c3-master-b'),
        ]);
    });

    it('round-trips owned facts and preserves unknown typed facts without adopting them', () => {
        const runtime = new CBTEncounterRuntime();
        const created = { ...registryTarget('A'), id: createEncounterTargetId() };
        runtime.dispatchTargetRegistry({
            kind: 'create-target', target: created,
        });
        const preserved = {
            kind: 'cross-unit-effect' as const,
            factId: 'effect:tagged',
            effectKey: 'tagged',
            target: { instanceId: 'unit:target' },
        };

        const encoded = encodeCBTEncounterStateV2(runtime.snapshot(), [preserved]);
        const decoded = decodeCBTEncounterStateV2(encoded);
        const restored = new CBTEncounterRuntime();
        restored.restoreSerialized(encoded);

        expect(decoded.preservedFacts).toEqual([preserved]);
        expect(restored.targetRegistry().targets.map(target => target.id)).toEqual([created.id]);
        expect(restored.serializedState().facts).toEqual(encoded.facts);
    });

    it('rejects invalid persisted target origin ownership before restoring runtime state', () => {
        const invalid = {
            schemaVersion: 2 as const,
            encounterRevision: 1,
            facts: [{
                kind: 'target' as const,
                factId: encounterTargetFactId('opfor:v1:invalid-origin'),
                target: {
                    id: 'opfor:v1:invalid-origin',
                    letter: 'A',
                    name: 'Invalid OPFOR target',
                    color: '#fff',
                    source: 'opfor' as const,
                    readOnly: false,
                },
            }],
        };
        const runtime = new CBTEncounterRuntime();

        expect(() => decodeCBTEncounterStateV2(invalid)).toThrow();
        expect(() => runtime.restoreSerialized(invalid)).toThrow();
        expect(runtime.targetRegistry()).toEqual({
            revision: 0,
            targets: [],
        });
    });

});

describe('force-shared target registry kernel', () => {
    it('applies sequential registry edits to the latest snapshot', () => {
        const initial = queryTargetRegistry(emptyCBTEncounterSnapshot());
        const created = reduceTargetRegistry(initial, {
            kind: 'create-target', target: registryTarget('A'),
        });
        const updated = reduceTargetRegistry(created.snapshot, {
            kind: 'update-target',
            targetId: asEncounterTargetId('target:A'), patch: { name: 'Stale edit' },
        });

        expect(created).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(created.snapshot.revision).toBe(1);
        expect(updated).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(updated.snapshot.revision).toBe(2);
        expect(updated.snapshot.targets[0].name).toBe('Stale edit');
    });

    it('accepts semantic no-ops without advancing the revision', () => {
        const runtime = new CBTEncounterRuntime();
        const emptyReset = runtime.dispatchTargetRegistry({
            kind: 'reset-targets',
        });
        const created = runtime.dispatchTargetRegistry({
            kind: 'create-target', target: registryTarget('A'),
        });
        const unchangedUpdate = runtime.dispatchTargetRegistry({
            kind: 'update-target',
            targetId: asEncounterTargetId('target:A'), patch: { name: 'Target A' },
        });
        const unchangedReplace = runtime.dispatchTargetRegistry({
            kind: 'replace-targets', targets: [registryTarget('A')],
        });

        expect(emptyReset).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(created).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(unchangedUpdate).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(unchangedReplace).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(runtime.targetRegistry().revision).toBe(1);
    });

    it('returns deeply immutable queries detached from runtime state and later queries', () => {
        const runtime = new CBTEncounterRuntime();
        runtime.dispatchTargetRegistry({
            kind: 'create-target',
            target: registryTarget('A', {
                tnCalculator: {
                    prone: true,
                    targetMovementDistance: 2,
                    targetHeight: 3,
                    stealth: {
                        short: 0,
                        medium: 1,
                        long: 2,
                        conventionalInfantry: { short: 0, medium: 0, long: 0 },
                    },
                    stealthSystem: 'stealth-armor',
                },
            }),
        });
        const first = runtime.targetRegistry();

        expect(Object.isFrozen(first)).toBeTrue();
        expect(Object.isFrozen(first.targets)).toBeTrue();
        expect(Object.isFrozen(first.targets[0])).toBeTrue();
        expect(Object.isFrozen(first.targets[0].tnCalculator)).toBeTrue();
        expect(Object.isFrozen(first.targets[0].tnCalculator?.stealth)).toBeTrue();
        const stealth = first.targets[0].tnCalculator?.stealth;
        expect(typeof stealth === 'object'
            && Object.isFrozen(stealth.conventionalInfantry)).toBeTrue();
        expect(first.targets[0]).not.toBe(runtime.snapshot().targets[0]);
        expect(() => {
            (first.targets[0] as { name: string }).name = 'escaped mutation';
        }).toThrow();

        runtime.dispatchTargetRegistry({
            kind: 'update-target',
            targetId: first.targets[0].id, patch: { color: '#abcdef' },
        });
        const second = runtime.targetRegistry();
        expect(first.targets[0].color).toBe('#123456');
        expect(second.targets[0].color).toBe('#abcdef');
        expect(second.targets[0]).not.toBe(first.targets[0]);
    });

    it('treats create and whole-registry replacement overflow as no-ops', () => {
        const fullTargets = Array.from({ length: 24 }, (_value, index) =>
            registryTarget(String.fromCharCode('A'.charCodeAt(0) + index)));
        const full = queryTargetRegistry({ revision: 4, targets: fullTargets });
        const createOverflow = reduceTargetRegistry(full, {
            kind: 'create-target', target: registryTarget('Y'),
        });
        const replaceOverflow = reduceTargetRegistry(queryTargetRegistry(emptyCBTEncounterSnapshot()), {
            kind: 'replace-targets',
            targets: [...fullTargets, registryTarget('Y')],
        });

        expect(createOverflow).toEqual(jasmine.objectContaining({
            accepted: true, changed: false,
        }));
        expect(replaceOverflow).toEqual(jasmine.objectContaining({
            accepted: true, changed: false,
        }));
        expect(replaceOverflow.snapshot.revision).toBe(0);
        expect(replaceOverflow.snapshot.targets).toEqual([]);
    });

    it('atomically gives a new manual target priority over the last reclaimable OPFOR row', () => {
        const manual = Array.from({ length: 23 }, (_value, index) =>
            registryTarget(String.fromCharCode('A'.charCodeAt(0) + index)));
        const opfor = registryTarget('X', {
            id: asEncounterTargetId('opfor:v1:capacity'),
            source: 'opfor',
            readOnly: true,
        });
        const full = queryTargetRegistry({
            revision: 8,
            targets: [...manual, opfor],
        });

        const created = reduceTargetRegistry(full, {
            kind: 'create-target',

            target: registryTarget('X'),
        });

        expect(created).toEqual(jasmine.objectContaining({
            accepted: true,
            changed: true,
        }));
        expect(created.snapshot.revision).toBe(9);
        expect(created.snapshot.targets).toHaveSize(24);
        expect(created.snapshot.targets.filter(target => target.source === 'opfor')).toEqual([]);
        expect(created.snapshot.targets.map(target => target.letter)).toEqual([
            'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L',
            'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X',
        ]);
    });

    it('protects read-only target identity while allowing its presentation color to change', () => {
        const opfor = registryTarget('A', {
            id: asEncounterTargetId('opfor:unit-1'), source: 'opfor', readOnly: true,
        });
        const snapshot = queryTargetRegistry({ revision: 2, targets: [opfor] });
        const renamed = reduceTargetRegistry(snapshot, {
            kind: 'update-target',
            targetId: opfor.id, patch: { name: 'Forged identity' },
        });
        const deleted = reduceTargetRegistry(snapshot, {
            kind: 'delete-target', targetId: opfor.id,
        });
        const recolored = reduceTargetRegistry(snapshot, {
            kind: 'update-target',
            targetId: opfor.id, patch: { color: '#abcdef' },
        });

        expect(renamed).toEqual(jasmine.objectContaining({
            accepted: false, changed: false,
        }));
        expect(deleted).toEqual(jasmine.objectContaining({
            accepted: false, changed: false,
        }));
        expect(recolored).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(recolored.snapshot.targets[0].color).toBe('#abcdef');
    });

    it('treats invalid, inapplicable, and not-found edits as deterministic no-ops', () => {
        const initial = queryTargetRegistry(emptyCBTEncounterSnapshot());
        const invalidOrigin = reduceTargetRegistry(initial, {
            kind: 'create-target',
            target: registryTarget('A', { source: 'opfor' }),
        });
        const notFound = reduceTargetRegistry(initial, {
            kind: 'delete-target',
            targetId: asEncounterTargetId('missing'),
        });
        const attackerLocal = reduceTargetRegistry(initial, {
            kind: 'create-target',
            target: { ...registryTarget('A'), distance: 7 } as EncounterTarget,
        });
        const malformedAfterOrigin = registryTarget('B', { name: '' });
        const bothOrders = [
            [registryTarget('A', { source: 'opfor' }), malformedAfterOrigin],
            [malformedAfterOrigin, registryTarget('A', { source: 'opfor' })],
        ].map(targets => reduceTargetRegistry(initial, {
            kind: 'replace-targets', targets,
        }));

        expect(invalidOrigin).toEqual(jasmine.objectContaining({
            accepted: true, changed: false,
        }));
        expect(notFound).toEqual(jasmine.objectContaining({
            accepted: true, changed: false,
        }));
        expect(attackerLocal).toEqual(jasmine.objectContaining({
            accepted: true, changed: false,
        }));
        expect(bothOrders).toEqual([
            jasmine.objectContaining({ accepted: true, changed: false }),
            jasmine.objectContaining({ accepted: true, changed: false }),
        ]);
    });
});
