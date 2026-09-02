// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asComponentId } from '../entity/entity-identifiers';
import {
    asEncounterNetworkId,
    asEncounterTargetId,
    CBTEncounterC3State,
    createEncounterTargetId,
    decodeCBTEncounterStateV2,
    encodeCBTEncounterStateV2,
    queryTargetRegistry,
    reduceTargetRegistry,
    type EncounterTarget,
    type CBTEncounterSnapshot,
} from './encounter-runtime';
import { CBTForceSession } from './cbt-force-session';

function forceSession(): CBTForceSession {
    return new CBTForceSession({} as never);
}

function emptyCBTEncounterSnapshot(): CBTEncounterSnapshot {
    return { revision: 0, targets: [], networks: [], c3Positions: [] };
}

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

describe('CBT force session and durable encounter C3 state', () => {
    it('owns immutable, revisioned force targets behind explicit CAS commands', () => {
        const session = forceSession();
        const first = { ...registryTarget('A'), id: createEncounterTargetId() };
        const second = { ...registryTarget('B'), id: createEncounterTargetId() };
        expect(session.dispatchTargetRegistry({
            kind: 'create-target', target: first,
        }).accepted).toBeTrue();
        expect(session.dispatchTargetRegistry({
            kind: 'create-target', target: second,
        }).accepted).toBeTrue();

        expect(String(first.id)).toMatch(/^target:[0-9a-f-]{36}$/u);
        expect(String(second.id)).toMatch(/^target:[0-9a-f-]{36}$/u);
        expect(first.id).not.toBe(second.id);
        expect(session.targetRegistry().revision).toBe(2);
        expect(Object.isFrozen(session.targetRegistry().targets)).toBeTrue();

        const firstId = first.id;
        const secondId = second.id;
        expect(Object.isFrozen(session.targetRegistry().targets[0])).toBeTrue();

        session.dispatchTargetRegistry({
            kind: 'update-target',
            targetId: firstId, patch: { name: 'Primary' },
        });
        expect(session.targetRegistry().targets.find(target => target.id === firstId)).toEqual(jasmine.objectContaining({
            name: 'Primary',
        }));
        session.dispatchTargetRegistry({
            kind: 'delete-target', targetId: secondId,
        });
        expect(session.targetRegistry().targets.map(target => target.id)).toEqual([firstId]);
    });

    it('stores detached networks without reimplementing C3 rule validation', () => {
        const c3 = new CBTEncounterC3State();
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
        c3.replaceC3Configuration([network], [{ unitId: 'instance-1', x: 203, y: 392 }]);
        network.color = '#abcdef';
        network.endpoints[0].componentId = asComponentId('caller-mutation');

        expect(c3.snapshot().networks[0]).toEqual(jasmine.objectContaining({
            color: '#123456',
            endpoints: [
                jasmine.objectContaining({ componentId: asComponentId('component:c3-master-a') }),
                jasmine.objectContaining({ componentId: asComponentId('component:c3-master-b') }),
            ],
        }));
        expect(c3.snapshot().c3Positions).toEqual([{ unitId: 'instance-1', x: 203, y: 392 }]);

        // Domain-invalid topology is deliberately not rejected here. Admission
        // belongs to C3NetworkEditor/projectC3EditorNetworksToEncounter.
        c3.replaceC3Configuration([...c3.snapshot().networks, {
            id: asEncounterNetworkId('network:opaque-fact'),
            networkType: 'c3',
            color: '#123456',
            endpoints: [],
        }], c3.snapshot().c3Positions);

        const restored = decodeCBTEncounterStateV2(encodeCBTEncounterStateV2(c3.snapshot()));
        expect(restored.networks
            .find(candidate => candidate.id === asEncounterNetworkId('network:c3:internal-master'))
            ?.endpoints.map(endpoint => endpoint.componentId)).toEqual([
            asComponentId('component:c3-master-a'),
            asComponentId('component:c3-master-b'),
        ]);
        expect(restored.c3Positions).toEqual([{ unitId: 'instance-1', x: 203, y: 392 }]);
    });

    it('keeps targets session-only while round-tripping durable C3 state', () => {
        const session = forceSession();
        const c3 = new CBTEncounterC3State();
        const created = { ...registryTarget('A'), id: createEncounterTargetId() };
        session.dispatchTargetRegistry({
            kind: 'create-target', target: created,
        });
        const encoded = encodeCBTEncounterStateV2(c3.snapshot());
        const restoredC3 = new CBTEncounterC3State();
        const restoredSession = forceSession();
        restoredC3.restoreSerialized(encoded);

        expect(encoded).toEqual({ networks: [] });
        expect(session.targetRegistry()).toEqual({
            revision: 1,
            targets: [jasmine.objectContaining({ id: created.id })],
        });
        expect(restoredSession.targetRegistry()).toEqual({ revision: 0, targets: [] });
        expect(restoredC3.snapshot()).toEqual({ networks: [], c3Positions: [] });
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
        const session = forceSession();
        const emptyReset = session.dispatchTargetRegistry({
            kind: 'reset-targets',
        });
        const created = session.dispatchTargetRegistry({
            kind: 'create-target', target: registryTarget('A'),
        });
        const unchangedUpdate = session.dispatchTargetRegistry({
            kind: 'update-target',
            targetId: asEncounterTargetId('target:A'), patch: { name: 'Target A' },
        });
        const unchangedReplace = session.dispatchTargetRegistry({
            kind: 'replace-targets', targets: [registryTarget('A')],
        });

        expect(emptyReset).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(created).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(unchangedUpdate).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(unchangedReplace).toEqual(jasmine.objectContaining({ accepted: true, changed: false }));
        expect(session.targetRegistry().revision).toBe(1);
    });

    it('returns deeply immutable queries detached from runtime state and later queries', () => {
        const session = forceSession();
        session.dispatchTargetRegistry({
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
        const first = session.targetRegistry();

        expect(Object.isFrozen(first)).toBeTrue();
        expect(Object.isFrozen(first.targets)).toBeTrue();
        expect(Object.isFrozen(first.targets[0])).toBeTrue();
        expect(Object.isFrozen(first.targets[0].tnCalculator)).toBeTrue();
        expect(Object.isFrozen(first.targets[0].tnCalculator?.stealth)).toBeTrue();
        const stealth = first.targets[0].tnCalculator?.stealth;
        expect(typeof stealth === 'object'
            && Object.isFrozen(stealth.conventionalInfantry)).toBeTrue();
        expect(first.targets[0]).not.toBe(session.targetRegistry().targets[0]);
        expect(() => {
            (first.targets[0] as { name: string }).name = 'escaped mutation';
        }).toThrow();

        session.dispatchTargetRegistry({
            kind: 'update-target',
            targetId: first.targets[0].id, patch: { color: '#abcdef' },
        });
        const second = session.targetRegistry();
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
