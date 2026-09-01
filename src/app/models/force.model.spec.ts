// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Injector } from '@angular/core';
import { GameSystem } from './common.model';
import type { Era } from './eras.model';
import type { Faction } from './factions.model';
import {
    Force,
    MAX_UNITS,
    UnitGroup,
    type RestoredCBTForce,
    buildEraWarningMessage,
    getEraUnitValidationSummary,
    resolveSerializedFormation,
} from './force.model';
import { applyForceUnitOwnerC3Position, type ForceUnit } from './force-unit.model';
import type { SerializedForce, SerializedUnit } from './force-serialization';
import type { UnitSummary } from './unit-summary.model';
import type { DataService } from '../services/data.service';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import type { ForceAvailabilityContext } from '../utils/force-availability.util';
import { NO_FORMATION } from '../utils/formation-type.model';
import { C3NetworkType } from './c3-network.model';
import type { PreparedCBTForcePersistenceV2 } from './runtime/force-persistence-boundary';
import {
    CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
    validateSerializedCBTForceV2,
    type SerializedCBTEncounterStateV2,
    type SerializedCBTForceV2,
} from './runtime/persistence-v2';

interface ControlledGate {
    readonly entered: Promise<void>;
    readonly wait: Promise<void>;
    markEntered(): void;
    release(): void;
}

function controlledGate(): ControlledGate {
    let markEntered!: () => void;
    let release!: () => void;
    return {
        entered: new Promise<void>(resolve => { markEntered = resolve; }),
        wait: new Promise<void>(resolve => { release = resolve; }),
        markEntered,
        release,
    };
}

function createUnit(id: number, name: string, year: number): UnitSummary {
    return createEmptyUnit({
        id,
        name,
        chassis: 'Test',
        model: 'Unit',
        year,
    });
}

function createForceUnit(unit: UnitSummary): ForceUnit {
    return {
        getSummary: () => unit,
        getDisplayName: () => unit.name,
    } as ForceUnit;
}

function createEra(id: number, from: number, to: number): Era {
    return {
        id,
        name: `Era ${id}`,
        years: { from, to },
        factions: new Set<number>(),
        units: new Set<number>(),
    };
}

function createFaction(id: number, name: string): Faction {
    return {
        id,
        name,
        group: 'Inner Sphere',
        img: '',
        eras: {},
    };
}

function createSerializedUnit(id: string): SerializedUnit {
    return {
        id,
        unit: 'Test Unit',
        state: {
            modified: false,
            destroyed: false,
        },
    };
}

function createStubDeserializedUnit(data: SerializedUnit): ForceUnit {
    const unit = createUnit(1, data.unit, 3025);
    let c3Position: { x: number; y: number } | null = data.state.c3Position ?? null;

    return {
        id: data.id,
        force: null!,
        update: () => undefined,
        commander: () => false,
        setFormationCommander: () => undefined,
        getBv: () => 0,
        getSummary: () => unit,
        getDisplayName: () => unit.name,
        c3Position: () => c3Position,
        [applyForceUnitOwnerC3Position]: (position: { x: number; y: number } | null) => {
            c3Position = position;
        },
        serialize: () => data,
    } as unknown as ForceUnit;
}

class TestForce extends Force<ForceUnit> {
    override gameSystem: GameSystem;
    private cbtAuthority: SerializedCBTForceV2 | null = null;
    private nextLoadGate: ControlledGate | null = null;
    private nextPersistenceGate: ControlledGate | null = null;

    constructor(gameSystem = GameSystem.AS) {
        const dataService = {
            getFactionById: () => null,
            getEraById: () => null,
            getEras: () => [],
        } as unknown as DataService;
        const injector = {
            get: () => ({
                warn: () => undefined,
                error: () => undefined,
            }),
        } as unknown as Injector;

        super('Test Force', dataService, injector);
        this.gameSystem = gameSystem;
    }

    protected override projectMembers(): never[] {
        return [];
    }

    protected override projectMembersInGroup(_group: UnitGroup): never[] {
        return [];
    }

    private deserializeTestUnit(data: SerializedUnit): ForceUnit {
        const forceUnit = createStubDeserializedUnit(data);
        forceUnit.force = this;
        return forceUnit;
    }

    protected override async deserializeFrom(_serialized: SerializedForce): Promise<Force<ForceUnit>> {
        const force = new TestForce(this.gameSystem);
        force.loadSerialized(structuredClone(_serialized));
        return force;
    }

    loadSerialized(data: SerializedForce): void {
        if (data.cbt !== undefined) {
            this.populateFromCBTForceV2(data);
            return;
        }
        if (!Array.isArray(data.groups)) {
            throw new Error('Invalid test force fixture: missing groups');
        }

        this.loading = true;
        try {
            this.populateSerializedMetadata(data);
            const groups = data.groups.map(serializedGroup => {
                const group = new UnitGroup<ForceUnit>(this);
                group.id = serializedGroup.id;
                group.setName(serializedGroup.name, false);
                group.color = serializedGroup.color ?? '';
                group.formationLock = serializedGroup.formationLock || undefined;
                group.formation.set(resolveSerializedFormation(
                    serializedGroup.formationId,
                    group.formationLock,
                    this.gameSystem,
                ));
                group.formationTargetGroupId.set(serializedGroup.formationTargetGroupId ?? null);
                group.units.set(serializedGroup.units.map(unit => {
                    if (!('unit' in unit)) throw new Error('TestForce expects a V1-style unit fixture');
                    return this.deserializeTestUnit(unit);
                }));
                return group;
            });
            this.groups.set(groups);
            this.setNetwork(data.c3Networks ?? []);
        } finally {
            this.loading = false;
        }
    }

    protected override getSupportedCBTForceV2Envelope(): SerializedCBTForceV2 | null {
        return this.cbtAuthority;
    }

    public override serialize(): SerializedForce {
        const envelope = this.getSupportedCBTForceV2Envelope();
        return envelope && this.instanceId() && this.timestamp
            ? this.buildCBTForcePersistenceRecord(
                this.buildCBTForceMetadataRecord(this.instanceId()!, this.timestamp),
                envelope,
            )
            : super.serialize();
    }

    gateNextLoadPreparation(): ControlledGate {
        const gate = controlledGate();
        this.nextLoadGate = gate;
        return gate;
    }

    gateNextPersistencePreparation(): ControlledGate {
        const gate = controlledGate();
        this.nextPersistenceGate = gate;
        return gate;
    }

    commitQueuedOwnerMutation(): Promise<void> {
        this.reserveForceOwnerMutationIntent();
        return this.enqueueCBTMutation(() => {
            this.emitChangedFromReservedIntent();
        });
    }

    protected override async restoreCBTForce(
        envelope: SerializedCBTForceV2,
    ): Promise<RestoredCBTForce> {
        const validated = await validateSerializedCBTForceV2(envelope);
        const expected = this.cbtAuthority;
        const gate = this.nextLoadGate;
        this.nextLoadGate = null;
        if (gate) {
            gate.markEntered();
            await gate.wait;
        }
        return Object.freeze({
            replacement: validated,
            install: () => {
                if (this.cbtAuthority !== expected) throw new Error('Test CBT authority changed');
                this.cbtAuthority = validated;
            },
        });
    }

    protected override clearLoadedCBTForceV2Authority(): boolean {
        const changed = this.cbtAuthority !== null;
        this.cbtAuthority = null;
        return changed;
    }

    protected override commitPreparedCBTForcePersistenceV2(
        prepared: PreparedCBTForcePersistenceV2,
    ): void {
        this.cbtAuthority = prepared.envelope;
    }

    protected override async prepareCBTForcePersistenceV2(input: {
        readonly forceId: string;
        readonly previous?: SerializedCBTForceV2;
        readonly typedEncounterState?: SerializedCBTEncounterStateV2;
    }): Promise<PreparedCBTForcePersistenceV2> {
        const gate = this.nextPersistenceGate;
        this.nextPersistenceGate = null;
        if (gate) {
            gate.markEntered();
            await gate.wait;
        }
        return super.prepareCBTForcePersistenceV2(input);
    }
}

function createSerializedForce(groups: SerializedForce['groups']): SerializedForce {
    return {
        version: 2,
        timestamp: new Date().toISOString(),
        instanceId: 'force-id',
        type: GameSystem.AS,
        name: 'Test Force',
        groups: groups ?? [],
    };
}

async function createInitializedCBTForce(): Promise<TestForce> {
    const force = new TestForce(GameSystem.CBT);
    await force.serializeForPersistence();
    return force;
}

describe('getEraUnitValidationSummary', () => {
    it('treats context-provided extinct units as extinct even when they are absent from visible era units', () => {
        const selectedEra = createEra(3025, 3025, 3049);
        const earlierEra = createEra(3000, 3000, 3024);
        const extinctFaction = createFaction(3, 'Extinct');
        const unit = createUnit(101, 'Shadow Hawk SHD-2H', 3020);

        const visibilityByEra = new Map<number, ReadonlySet<string>>([
            [earlierEra.id, new Set([unit.name])],
            [selectedEra.id, new Set()],
        ]);
        const extinctByEra = new Map<number, ReadonlySet<string>>([
            [selectedEra.id, new Set([unit.name])],
        ]);

        const availabilityContext: ForceAvailabilityContext = {
            source: 'megamek',
            getUnitKey: (candidate) => candidate.name,
            getVisibleEraUnitIds: (era) => visibilityByEra.get(era.id) ?? new Set<string>(),
            getFactionUnitIds: () => new Set<string>(),
            getFactionEraUnitIds: (faction, era) => faction.id === extinctFaction.id
                ? (extinctByEra.get(era.id) ?? new Set<string>())
                : new Set<string>(),
        };

        const summary = getEraUnitValidationSummary(
            [unit],
            selectedEra,
            [earlierEra, selectedEra],
            extinctFaction,
            availabilityContext
        );

        expect(summary.extinctTrackedUnits).toBe(1);
        expect(summary.extinctTrackedUnitNames).toEqual([unit.name]);
        expect(summary.invalidTrackedUnits).toBe(0);
    });
});

describe('buildEraWarningMessage', () => {
    it('accepts a custom faction-exists predicate for force-scoped availability contexts', () => {
        const selectedEra = createEra(3025, 3025, 3049);
        const unit = createUnit(101, 'Phoenix Hawk PXH-1', 3020);
        const faction = createFaction(11, 'Context Faction');

        const availabilityContext: ForceAvailabilityContext = {
            source: 'megamek',
            getUnitKey: (candidate) => candidate.name,
            getVisibleEraUnitIds: () => new Set([unit.name]),
            getFactionUnitIds: () => new Set<string>(),
            getFactionEraUnitIds: () => new Set<string>(),
        };

        const warning = buildEraWarningMessage(
            [unit],
            selectedEra,
            faction,
            [selectedEra],
            null,
            availabilityContext,
            () => true,
        );

        expect(warning).toBeNull();
    });
});

describe('Force formation deserialization', () => {
    it('loads locked groups without a formation id as NO_FORMATION', () => {
        const force = new TestForce();

        force.loadSerialized(createSerializedForce([
            {
                id: 'group-1',
                formationLock: true,
                units: [],
            },
        ]));

        expect(force.groups()[0].formation()).toBe(NO_FORMATION);
        expect(force.groups()[0].formationLock).toBeTrue();
    });

});

describe('Force C3 cleanup', () => {
    it('preserves serialized networks during load', () => {
        const network = {
            id: 'peer-network',
            type: C3NetworkType.C3I,
            color: '#1',
            peerIds: ['first', 'second'],
        };
        const serialized = {
            ...createSerializedForce([{
                id: 'group',
                units: [createSerializedUnit('first'), createSerializedUnit('second')],
            }]),
            c3Networks: [network],
        };
        const force = new TestForce();

        force.loadSerialized(serialized);
        expect(force.c3Networks()).toEqual([network]);

        expect(force.c3Networks()).toEqual([network]);
    });

    it('removes every deleted group unit from the evolving network revision', async () => {
        const force = new TestForce();
        const first = createStubDeserializedUnit(createSerializedUnit('first'));
        const second = createStubDeserializedUnit(createSerializedUnit('second'));
        const group = await force.addGroup();
        group.units.set([first, second]);
        force.setNetwork([{
            id: 'peer-network', type: C3NetworkType.C3I, color: '#1', peerIds: ['first', 'second', 'remaining'],
        }]);

        await force.removeGroup(group);

        expect(force.c3Networks()).toEqual([]);
    });
});

describe('Force owner structure', () => {
    it('writes grouped Alpha Strike forces only as V2', () => {
        const force = new TestForce();
        force.loadSerialized(createSerializedForce([]));

        expect(force.serialize().version).toBe(2);
    });

    it('rejects public Force and UnitGroup mutations before changing a read-only owner', () => {
        const force = new TestForce();
        force.loadSerialized({
            ...createSerializedForce([{
                id: 'group:readonly',
                name: 'Original group',
                units: [createSerializedUnit('first'), createSerializedUnit('second')],
            }]),
            owned: false,
            name: 'Original force',
            note: 'Original note',
            tags: ['Original'],
        });
        const group = force.groups()[0];
        const originalUnits = [...group.units()];
        const originalName = force.name;
        let emissions = 0;
        const subscription = force.changed.subscribe(() => { emissions += 1; });

        force.setName('Unauthorized');
        force.setNote('Unauthorized');
        force.setTags(['Unauthorized']);
        force.setNetwork([{ id: 'unauthorized', type: C3NetworkType.C3I, color: '#000', peerIds: [] }]);
        group.setName('Unauthorized group');
        group.reorderUnit(0, 1);

        expect(force.name).toBe(originalName);
        expect(force.note).toBe('Original note');
        expect(force.tags).toEqual(['Original']);
        expect(force.c3Networks()).toEqual([]);
        expect(group.name()).toBe('Original group');
        expect(group.units()).toEqual(originalUnits);
        expect(emissions).toBe(0);
        subscription.unsubscribe();
    });

    it('publishes a standalone UnitGroup reorder through the owning force', () => {
        const force = new TestForce();
        force.loadSerialized(createSerializedForce([{
            id: 'group:ordered',
            units: [createSerializedUnit('first'), createSerializedUnit('second')],
        }]));
        const group = force.groups()[0];
        let emissions = 0;
        const subscription = force.changed.subscribe(() => { emissions += 1; });

        group.reorderUnit(0, 1);

        expect(group.units().map(unit => unit.id)).toEqual(['second', 'first']);
        expect(emissions).toBe(1);
        subscription.unsubscribe();
    });

    it('does not rebuild structural members for a scoped runtime change', () => {
        const force = new TestForce();
        force.loadSerialized(createSerializedForce([]));
        const membersBefore = force.members();
        const emissions: Array<readonly string[] | null> = [];
        const subscription = force.changed.subscribe(scope => emissions.push(scope));

        force.emitChanged(['unit:changed', 'unit:changed']);

        expect(force.members()).toBe(membersBefore);
        expect(emissions).toEqual([['unit:changed']]);

        force.emitChanged();

        expect(force.members()).not.toBe(membersBefore);
        expect(emissions[1]).toBeNull();
        subscription.unsubscribe();
    });

    it('does not remove a source unit when the destination group is stale', () => {
        const source = new TestForce();
        const target = new TestForce();
        const unrelated = new TestForce();
        source.loadSerialized(createSerializedForce([{
            id: 'group:source',
            units: [createSerializedUnit('retained')],
        }]));
        target.loadSerialized(createSerializedForce([{
            id: 'group:target',
            units: [],
        }]));
        const sourceGroup = source.groups()[0];
        const staleTarget = target.groups()[0];
        staleTarget.force = unrelated;

        expect(sourceGroup.moveUnitTo(0, staleTarget)).toBeNull();
        expect(sourceGroup.units().map(unit => unit.id)).toEqual(['retained']);
    });

    it('rejects an atomic transfer that would exceed target capacity', () => {
        const source = new TestForce();
        const target = new TestForce();
        source.loadSerialized(createSerializedForce([{
            id: 'group:source', units: [createSerializedUnit('overflow')],
        }]));
        target.loadSerialized(createSerializedForce([{
            id: 'group:full',
            units: Array.from({ length: MAX_UNITS }, (_, index) => createSerializedUnit(`target:${index}`)),
        }]));

        expect(source.groups()[0].moveUnitTo(0, target.groups()[0])).toBeNull();
        expect(source.units().map(unit => unit.id)).toEqual(['overflow']);
        expect(target.units().length).toBe(MAX_UNITS);
    });

    it('prunes a moved unit from the source legacy C3 authority', () => {
        const source = new TestForce();
        const target = new TestForce();
        source.loadSerialized(createSerializedForce([{
            id: 'group:source',
            units: [createSerializedUnit('moved'), createSerializedUnit('remaining')],
        }]));
        target.loadSerialized(createSerializedForce([{ id: 'group:target', units: [] }]));
        source.setNetwork([{
            id: 'network:source',
            type: C3NetworkType.C3I,
            color: '#123',
            peerIds: ['moved', 'remaining'],
        }]);

        expect(source.groups()[0]!.moveUnitTo(0, target.groups()[0]!)?.id).toBe('moved');
        expect(JSON.stringify(source.c3Networks())).not.toContain('moved');
    });

    it('keeps an exact group in its source when target adoption is rejected', () => {
        const source = new TestForce();
        const target = new TestForce();
        source.loadSerialized(createSerializedForce([{
            id: 'group:source',
            units: [createSerializedUnit('retained')],
        }]));
        target.loadSerialized({ ...createSerializedForce([]), owned: false });
        const group = source.groups()[0];

        expect(() => target.adoptGroup(group)).toThrowError(/read-only/);
        expect(source.groups()).toEqual([group]);
        expect(group.force).toBe(source);
    });

    it('detaches serialized C3 arrays from both caller and live authority', () => {
        const force = new TestForce();
        force.loadSerialized(createSerializedForce([]));
        const networks = [{
            id: 'network:detached', type: C3NetworkType.C3I, color: '#abc', peerIds: ['first', 'second'],
        }];
        force.setNetwork(networks);

        const serialized = force.serialize();
        networks[0].peerIds.push('caller mutation');
        serialized.c3Networks![0]!.peerIds!.push('snapshot mutation');

        expect(force.c3Networks()[0].peerIds).toEqual(['first', 'second']);
    });

    it('does not remove a same-ID group substituted for the selected object', async () => {
        const force = new TestForce();
        const selected = await force.addGroup();
        const substitute = new UnitGroup<ForceUnit>(force);
        substitute.id = selected.id;
        force.groups.set([substitute]);

        await force.removeGroup(selected);

        expect(force.groups()).toEqual([substitute]);
    });

    it('does not remove a same-ID unit substituted for the selected object', async () => {
        const force = new TestForce();
        const group = await force.addGroup();
        const selected = createStubDeserializedUnit(createSerializedUnit('shared-id'));
        const substitute = createStubDeserializedUnit(createSerializedUnit('shared-id'));
        selected.force = force;
        substitute.force = force;
        group.units.set([substitute]);

        force.removeUnit(selected);

        expect(group.units()).toEqual([substitute]);
    });

    it('does not remove a selected group after it is reparented', async () => {
        const original = new TestForce();
        const replacementOwner = new TestForce();
        const selected = await original.addGroup();
        selected.force = replacementOwner;

        await original.removeGroup(selected);

        expect(original.groups()).toEqual([selected]);
    });

    it('installs legacy C3 cleanup only for the exact current owner fingerprint', () => {
        const force = new TestForce();
        force.loadSerialized(createSerializedForce([]));
        const fingerprint = force.captureWholeOwnerAuthorityFingerprint();
        const networks = [{
            id: 'network:guarded', type: C3NetworkType.C3I, color: '#abc', peerIds: ['unit:a', 'unit:b'],
        }];

        expect(force.setNetworkIfWholeOwnerAuthorityCurrent(fingerprint, networks)).toBeTrue();
        networks[0].peerIds.push('caller-owned-late-mutation');
        expect(force.c3Networks()[0].peerIds).toEqual(['unit:a', 'unit:b']);

        const stale = force.captureWholeOwnerAuthorityFingerprint();
        force.setName('Newer authority');
        expect(force.setNetworkIfWholeOwnerAuthorityCurrent(stale, [])).toBeFalse();
        expect(force.c3Networks().map(network => network.id)).toEqual(['network:guarded']);
    });

    it('applies C3 positions and networks together only to the current owner revision', () => {
        const force = new TestForce();
        force.loadSerialized(createSerializedForce([{
            id: 'group:c3',
            units: [
                createSerializedUnit('unit:a'),
                createSerializedUnit('unit:b'),
                createSerializedUnit('unit:without-c3'),
            ],
        }]));
        const revisionFence = force.captureForceOwnerRevisionFence();
        let emissions = 0;
        const subscription = force.changed.subscribe(() => { emissions += 1; });

        expect(force.setC3ConfigurationIfOwnerRevisionCurrent(
            revisionFence,
            [{ id: 'network:c3', type: C3NetworkType.C3I, color: '#abc', peerIds: ['unit:a', 'unit:b'] }],
            [
                { unitId: 'unit:a', x: 10, y: 20 },
                { unitId: 'unit:b', x: 30, y: 40 },
            ],
        )).toBeTrue();
        expect(force.units().map(unit => unit.c3Position())).toEqual([
            { x: 10, y: 20 }, { x: 30, y: 40 }, null,
        ]);
        expect(force.c3Networks().map(network => network.id)).toEqual(['network:c3']);
        expect(emissions).toBe(1);

        const stale = force.captureForceOwnerRevisionFence();
        force.setName('Newer owner');
        expect(force.setC3ConfigurationIfOwnerRevisionCurrent(
            stale,
            [],
            [
                { unitId: 'unit:a', x: 100, y: 200 },
                { unitId: 'unit:b', x: 300, y: 400 },
            ],
        )).toBeFalse();
        expect(force.units().map(unit => unit.c3Position())).toEqual([
            { x: 10, y: 20 }, { x: 30, y: 40 }, null,
        ]);
        subscription.unsubscribe();
    });
});

describe('Force CBT V2 persistence boundary', () => {
    it('retires only after its drained entry fingerprint remains exact', async () => {
        const force = await createInitializedCBTForce();
        const persisted = force.serialize();
        const handle = force.beginWholeOwnerRetirement();
        expect(handle).not.toBeNull();
        if (!handle) return;

        expect(force.commitWholeOwnerRetirement(handle.token, () => () => undefined)).toBeFalse();
        expect(await handle.ready).toBeTrue();
        let replacementCommitted = false;
        expect(force.commitWholeOwnerRetirement(handle.token, authority => {
            expect(replacementCommitted).toBeFalse();
            expect(force.consumeWholeOwnerReplacementCommitAuthority(authority)).toBeTrue();
            return () => {
                expect(force.isWholeOwnerRetired()).toBeTrue();
                replacementCommitted = true;
            };
        })).toBeTrue();
        expect(replacementCommitted).toBeTrue();
        expect(force.isWholeOwnerRetired()).toBeTrue();
        await expectAsync(force.serializeForPersistence()).toBeRejected();
        expect(await force.loadCBTForceV2Persistence(persisted)).toBeFalse();
    });

    it('rechecks the exact token and owner after the replacement commit callback', async () => {
        const mutated = await createInitializedCBTForce();
        const mutationHandle = mutated.beginWholeOwnerRetirement();
        expect(mutationHandle).not.toBeNull();
        if (!mutationHandle) return;
        expect(await mutationHandle.ready).toBeTrue();

        expect(mutated.commitWholeOwnerRetirement(mutationHandle.token, () => {
            mutated.setName('Late local edit');
            return () => undefined;
        })).toBeFalse();
        expect(mutated.isWholeOwnerRetired()).toBeFalse();
        expect(mutated.name).toBe('Late local edit');
        mutated.cancelWholeOwnerRetirement(mutationHandle.token);
        expect(mutated.isWholeOwnerActive()).toBeTrue();

        const cancelled = await createInitializedCBTForce();
        const cancellationHandle = cancelled.beginWholeOwnerRetirement();
        expect(cancellationHandle).not.toBeNull();
        if (!cancellationHandle) return;
        expect(await cancellationHandle.ready).toBeTrue();
        expect(cancelled.commitWholeOwnerRetirement(cancellationHandle.token, () => {
            cancelled.cancelWholeOwnerRetirement(cancellationHandle.token);
            return () => undefined;
        })).toBeFalse();
        expect(cancelled.isWholeOwnerActive()).toBeTrue();
    });

    it('exposes replacement authority only inside the exact retirement callback and only once', async () => {
        const force = await createInitializedCBTForce();
        const handle = force.beginWholeOwnerRetirement();
        expect(handle).not.toBeNull();
        if (!handle) return;
        expect(await handle.ready).toBeTrue();

        let retainedAuthority: Parameters<Force['consumeWholeOwnerReplacementCommitAuthority']>[0] | null = null;
        expect(force.commitWholeOwnerRetirement(handle.token, authority => {
            retainedAuthority = authority;
            expect(force.consumeWholeOwnerReplacementCommitAuthority(authority)).toBeTrue();
            expect(force.consumeWholeOwnerReplacementCommitAuthority(authority)).toBeFalse();
            return () => undefined;
        })).toBeTrue();
        expect(retainedAuthority).not.toBeNull();
        expect(force.consumeWholeOwnerReplacementCommitAuthority(retainedAuthority!)).toBeFalse();
    });

    it('rejects a retirement callback that does not claim its exact predecessor authority', async () => {
        const force = await createInitializedCBTForce();
        const handle = force.beginWholeOwnerRetirement();
        expect(handle).not.toBeNull();
        if (!handle) return;
        expect(await handle.ready).toBeTrue();

        expect(force.commitWholeOwnerRetirement(handle.token, () => () => undefined)).toBeFalse();
        expect(force.isWholeOwnerRetired()).toBeFalse();
        force.cancelWholeOwnerRetirement(handle.token);
        expect(force.isWholeOwnerActive()).toBeTrue();
    });

    it('compares persistent bytes independently of the owner-local cloud CAS fence', async () => {
        const force = await createInitializedCBTForce();
        const serialized = await force.serializeForPersistence();
        const comparableBefore = force.getWholeOwnerPersistentAuthoritySnapshotJson();
        const exactOwnerBefore = force.captureWholeOwnerAuthorityFingerprint();
        const revisionBefore = force.captureForceOwnerRevisionFence();

        force.markCloudCBTForceV2Saved(serialized);

        expect(force.getWholeOwnerPersistentAuthoritySnapshotJson()).toBe(comparableBefore);
        expect(force.isWholeOwnerAuthorityFingerprintCurrent(exactOwnerBefore)).toBeFalse();
        expect(force.isForceOwnerRevisionFenceCurrent(revisionBefore)).toBeTrue();
    });

    it('returns the exact post-normalization owner fence with a persistence snapshot', async () => {
        const force = new TestForce(GameSystem.CBT);
        const before = force.captureWholeOwnerAuthorityFingerprint();

        const captured = await force.serializeForPersistenceWithAuthorityFence();

        expect(captured.serialized.cbt).toBeDefined();
        expect(force.isWholeOwnerAuthorityFingerprintCurrent(captured.authorityFingerprint)).toBeTrue();
        expect(force.isWholeOwnerAuthorityFingerprintCurrent(before)).toBeFalse();
        force.setName('Later mutation');
        expect(force.isWholeOwnerAuthorityFingerprintCurrent(captured.authorityFingerprint)).toBeFalse();
    });

    it('does not rebuild the whole-owner digest for a local persistence snapshot', async () => {
        const force = await createInitializedCBTForce();
        const captureExact = spyOn(force, 'captureWholeOwnerAuthorityFingerprint').and.callThrough();

        const captured = await force.serializeForPersistenceWithRevisionFence();

        expect(captured.serialized.cbt).toBeDefined();
        expect(force.isForceOwnerRevisionFenceCurrent(captured.revisionFence)).toBeTrue();
        expect(captureExact).not.toHaveBeenCalled();
    });

    it('proves that the paired AS serializer promoted its fresh identity', async () => {
        const force = new TestForce();
        force.gameSystem = GameSystem.AS;

        expect(force.instanceId()).toBeNull();
        expect(force.timestamp).toBeNull();

        const captured = await force.serializeForPersistenceWithAuthorityFence();

        expect(force.instanceId()).toBe(captured.serialized.instanceId);
        expect(force.timestamp).toBe(captured.serialized.timestamp);
        expect(force.isPersistenceIdentityPromotion(captured.identityPromotionProof)).toBeTrue();
    });

    it('rejects an identity-promotion proof after the promoted owner changes', async () => {
        const force = new TestForce();
        force.gameSystem = GameSystem.AS;
        const captured = await force.serializeForPersistenceWithAuthorityFence();
        expect(force.isPersistenceIdentityPromotion(captured.identityPromotionProof)).toBeTrue();

        force.setName('Changed after the local snapshot');

        expect(force.isPersistenceIdentityPromotion(captured.identityPromotionProof)).toBeFalse();
    });

    it('retains Force-minted promotion provenance across a public serialization and later edit', async () => {
        const force = new TestForce();
        force.gameSystem = GameSystem.AS;
        const first = await force.serializeForPersistence();
        force.setName('One edit before the Data-owned save');

        const retry = await force.serializeForPersistenceWithAuthorityFence();

        expect(retry.serialized.instanceId).toBe(first.instanceId);
        expect(force.isPersistenceIdentityPromotion(retry.identityPromotionProof)).toBeTrue();
    });

    it('does not expose a writable Force identity signal', () => {
        const force = new TestForce();

        expect((force.instanceId as unknown as { set?: unknown }).set).toBeUndefined();
    });

    it('includes writable ownership in the cross-owner persistent authority digest', () => {
        const force = new TestForce();
        force.loadSerialized(createSerializedForce([]));
        const ownedDigest = force.getWholeOwnerPersistentAuthoritySnapshotJson();

        (force as any)._owned.set(false);

        expect(force.getWholeOwnerPersistentAuthoritySnapshotJson()).not.toBe(ownedDigest);
    });

    it('retires several owners atomically before one replacement finalizer publishes', async () => {
        const first = await createInitializedCBTForce();
        const second = await createInitializedCBTForce();
        const firstHandle = first.beginWholeOwnerRetirement();
        const secondHandle = second.beginWholeOwnerRetirement();
        expect(firstHandle).not.toBeNull();
        expect(secondHandle).not.toBeNull();
        if (!firstHandle || !secondHandle) return;
        expect(await firstHandle.ready).toBeTrue();
        expect(await secondHandle.ready).toBeTrue();

        let finalized = false;
        expect(Force.commitWholeOwnerRetirements([
            { force: first, token: firstHandle.token },
            { force: second, token: secondHandle.token },
        ], authorities => {
            expect(first.consumeWholeOwnerReplacementCommitAuthority(authorities[0])).toBeTrue();
            expect(second.consumeWholeOwnerReplacementCommitAuthority(authorities[1])).toBeTrue();
            return () => {
                expect(first.isWholeOwnerRetired()).toBeTrue();
                expect(second.isWholeOwnerRetired()).toBeTrue();
                finalized = true;
            };
        })).toBeTrue();
        expect(finalized).toBeTrue();
    });

    it('does not partially retire a batch when preparation invalidates one predecessor', async () => {
        const first = await createInitializedCBTForce();
        const second = await createInitializedCBTForce();
        const firstHandle = first.beginWholeOwnerRetirement();
        const secondHandle = second.beginWholeOwnerRetirement();
        expect(firstHandle).not.toBeNull();
        expect(secondHandle).not.toBeNull();
        if (!firstHandle || !secondHandle) return;
        expect(await firstHandle.ready).toBeTrue();
        expect(await secondHandle.ready).toBeTrue();

        let finalized = false;
        expect(Force.commitWholeOwnerRetirements([
            { force: first, token: firstHandle.token },
            { force: second, token: secondHandle.token },
        ], authorities => {
            expect(first.consumeWholeOwnerReplacementCommitAuthority(authorities[0])).toBeTrue();
            expect(second.consumeWholeOwnerReplacementCommitAuthority(authorities[1])).toBeTrue();
            second.setName('Late local authority');
            return () => { finalized = true; };
        })).toBeFalse();
        expect(first.isWholeOwnerRetired()).toBeFalse();
        expect(second.isWholeOwnerRetired()).toBeFalse();
        expect(finalized).toBeFalse();
        first.cancelWholeOwnerRetirement(firstHandle.token);
        second.cancelWholeOwnerRetirement(secondHandle.token);
    });

    it('invalidates retirement when earlier owner work commits and succeeds on a fresh retry', async () => {
        const force = await createInitializedCBTForce();
        const gate = force.gateNextPersistencePreparation();
        const saving = force.serializeForPersistence();
        const firstHandle = force.beginWholeOwnerRetirement();
        expect(firstHandle).not.toBeNull();
        if (!firstHandle) return;
        await gate.entered;
        gate.release();
        await saving;

        expect(await firstHandle.ready).toBeFalse();
        expect(force.commitWholeOwnerRetirement(firstHandle.token, () => () => undefined)).toBeFalse();
        force.cancelWholeOwnerRetirement(firstHandle.token);
        expect(force.isWholeOwnerActive()).toBeTrue();

        const retry = force.beginWholeOwnerRetirement();
        expect(retry).not.toBeNull();
        if (!retry) return;
        expect(await retry.ready).toBeTrue();
        expect(force.commitWholeOwnerRetirement(retry.token, authority => {
            expect(force.consumeWholeOwnerReplacementCommitAuthority(authority)).toBeTrue();
            return () => undefined;
        })).toBeTrue();
    });

    it('preserves a pending local edit and cloud acknowledgement when retirement is cancelled', async () => {
        const force = await createInitializedCBTForce();
        const baseline = await force.serializeForPersistence();
        expect(baseline.cbt).toBeDefined();

        const handle = force.beginWholeOwnerRetirement();
        expect(handle).not.toBeNull();
        if (!handle) return;
        force.setName('Local edit wins');
        force.markCloudCBTForceV2Saved(baseline);
        const saving = force.serializeForPersistence();

        expect(await handle.ready).toBeFalse();
        force.cancelWholeOwnerRetirement(handle.token);
        const saved = await saving;
        expect(saved.name).toBe('Local edit wins');
        expect(force.name).toBe('Local edit wins');
        expect(force.getExpectedCloudCBTForceV2Revision())
            .toBe(baseline.cbt!.forceRevision);
    });

    it('rejects a post-begin save while the exact retirement is still valid', async () => {
        const force = await createInitializedCBTForce();
        const handle = force.beginWholeOwnerRetirement();
        expect(handle).not.toBeNull();
        if (!handle) return;

        await expectAsync(force.serializeForPersistence()).toBeRejectedWithError(/cannot accept a new persistence request/);
        expect(await handle.ready).toBeTrue();
        expect(force.commitWholeOwnerRetirement(handle.token, authority => {
            expect(force.consumeWholeOwnerReplacementCommitAuthority(authority)).toBeTrue();
            return () => undefined;
        })).toBeTrue();
    });

    it('applies explicit-persistence tags with monotonic authority and no autosave emission', () => {
        const force = new TestForce();
        const priorTimestamp = '2099-01-01T00:00:00.000Z';
        force.loadSerialized({ ...createSerializedForce([]), timestamp: priorTimestamp });
        let emissions = 0;
        const subscription = force.changed.subscribe(() => { emissions += 1; });

        expect(force.setTagsForExplicitPersistence(['  Alpha  ', 'alpha', 'Bravo'])).toBeTrue();
        expect(force.tags).toEqual(['Alpha', 'Bravo']);
        expect(Date.parse(force.timestamp!)).toBeGreaterThan(Date.parse(priorTimestamp));
        expect(emissions).toBe(0);

        const settledTimestamp = force.timestamp;
        expect(force.setTagsForExplicitPersistence(['Alpha', 'Bravo'])).toBeFalse();
        expect(force.timestamp).toBe(settledTimestamp);
        expect(emissions).toBe(0);
        subscription.unsubscribe();
    });

    it('rejects a same-content owner-object substitution against an opaque fingerprint', () => {
        const force = new TestForce();
        force.loadSerialized(createSerializedForce([{ id: 'group-1', units: [] }]));
        const fingerprint = force.captureWholeOwnerAuthorityFingerprint();
        const substitute = new TestForce();
        substitute.loadSerialized(force.serialize());

        force.groups.set(substitute.groups());

        expect(force.isWholeOwnerAuthorityFingerprintCurrent(fingerprint)).toBeFalse();
    });

    it('installs the first save identity and timestamp and makes the second save byte-stable', async () => {
        const force = new TestForce(GameSystem.CBT);

        expect(force.instanceId()).toBeNull();
        expect(force.timestamp).toBeNull();

        const first = await force.serializeForPersistence();
        expect(force.instanceId()).toBe(first.instanceId);
        expect(force.timestamp).toBe(first.timestamp);

        const second = await force.serializeForPersistence();
        expect(second.instanceId).toBe(first.instanceId);
        expect(second.timestamp).toBe(first.timestamp);
        expect(second.cbt).toEqual(first.cbt);
        expect(force.instanceId()).toBe(second.instanceId);
        expect(force.timestamp).toBe(second.timestamp);
    });

    it('retries a delayed save against the winning live identity and timestamp', async () => {
        const winningOwner = new TestForce(GameSystem.CBT);
        const winning = await winningOwner.serializeForPersistence();
        const force = new TestForce(GameSystem.CBT);
        const gate = force.gateNextPersistencePreparation();
        const saving = force.serializeForPersistence();
        await gate.entered;

        force.loadSerialized(winning);
        gate.release();

        const saved = await saving;
        expect(saved.instanceId).toBe(winning.instanceId);
        expect(saved.timestamp).toBe(winning.timestamp);
        expect(force.instanceId()).toBe(winning.instanceId);
        expect(force.timestamp).toBe(winning.timestamp);
        expect(String(saved.cbt?.forceId)).toBe(winning.instanceId);
    });

    it('initializes direct V2 authority and reloads/resaves the same canonical envelope', async () => {
        const force = new TestForce(GameSystem.CBT);
        const first = await force.serializeForPersistence();
        expect(first.cbt).toBeDefined();
        expect(force.serialize().cbt).toEqual(first.cbt);
        expect(first.cbt!.units).toEqual([]);

        const reloaded = new TestForce(GameSystem.CBT);
        reloaded.loadSerialized(first);
        expect(reloaded.hasCBTForceV2()).toBeFalse();
        expect(await reloaded.loadCBTForceV2Persistence(first)).toBeTrue();
        expect(reloaded.readOnly()).toBeFalse();
        const second = await reloaded.serializeForPersistence();
        expect(second.cbt).toEqual(first.cbt);

        reloaded.setName('Changed Force');
        const changed = await reloaded.serializeForPersistence();
        expect(Number(changed.cbt!.forceRevision)).toBe(0);
        expect(Number(changed.cbt!.encounter.encounterRevision)).toBe(0);
    });

    it('refuses unsupported V2 envelopes instead of installing a compatibility wrapper', async () => {
        const source = new TestForce(GameSystem.CBT);
        const persisted = await source.serializeForPersistence();
        const forwardVersion = CBT_FORCE_PERSISTENCE_SCHEMA_VERSION + 1;
        const forwardValue = {
            schemaVersion: forwardVersion,
            minimumWriterVersion: forwardVersion,
            future: true,
        } as unknown as SerializedCBTForceV2;
        const forwardData = { ...persisted, cbt: forwardValue };
        const forward = new TestForce(GameSystem.CBT);
        forward.loadSerialized(forwardData);
        expect(await forward.loadCBTForceV2Persistence(forwardData)).toBeFalse();
        expect(forward.hasCBTForceV2()).toBeFalse();
    });

    it('serializes overlapping requests in revision order without publishing stale state', async () => {
        const force = await createInitializedCBTForce();

        const beforeChange = force.serializeForPersistence();
        force.setName('Second Snapshot');
        const afterChange = force.serializeForPersistence();

        const [first, second] = await Promise.all([beforeChange, afterChange]);
        expect(Number(first.cbt!.forceRevision)).toBe(0);
        // Both requests enter the owner queue after the synchronous edit. The
        // first captures it and the identical second save is a true no-op.
        expect(Number(second.cbt!.forceRevision)).toBe(0);
        expect(first.name).toBe('Second Snapshot');
        expect(second.name).toBe('Second Snapshot');
    });

    it('lets a later queued load win after an earlier queued local command commits', async () => {
        const source = new TestForce(GameSystem.CBT);
        const persisted = await source.serializeForPersistence();
        const target = new TestForce(GameSystem.CBT);
        target.loadSerialized(persisted);
        expect(await target.loadCBTForceV2Persistence(persisted)).toBeTrue();

        const command = target.commitQueuedOwnerMutation();
        const loading = target.loadCBTForceV2Persistence(persisted);

        await command;
        expect(await loading).toBeTrue();
        expect(target.hasCBTForceV2()).toBeTrue();
        expect(target.readOnly()).toBeFalse();
    });

    it('invalidates an older delayed load when a queued local command is invoked later', async () => {
        const source = new TestForce(GameSystem.CBT);
        const persisted = await source.serializeForPersistence();
        const target = new TestForce(GameSystem.CBT);
        target.loadSerialized(persisted);
        expect(await target.loadCBTForceV2Persistence(persisted)).toBeTrue();

        const gate = target.gateNextLoadPreparation();
        const loading = target.loadCBTForceV2Persistence(persisted);
        await gate.entered;
        const command = target.commitQueuedOwnerMutation();
        gate.release();

        expect(await loading).toBeFalse();
        await command;
        expect(target.hasCBTForceV2()).toBeTrue();
        expect(target.readOnly()).toBeFalse();
    });

    it('commits FIFO loads in call order so the second valid envelope is final', async () => {
        const source = new TestForce(GameSystem.CBT);
        const first = await source.serializeForPersistence();
        expect(first.cbt).toBeDefined();
        const secondEnvelope = await validateSerializedCBTForceV2({
            ...first.cbt!,
            forceRevision: Number(first.cbt!.forceRevision) + 1,
        } as SerializedCBTForceV2);
        const second = {
            ...first,
            cbt: secondEnvelope,
        };
        const target = new TestForce(GameSystem.CBT);
        target.loadSerialized(first);
        const gate = target.gateNextLoadPreparation();

        const loadingFirst = target.loadCBTForceV2Persistence(first);
        await gate.entered;
        const loadingSecond = target.loadCBTForceV2Persistence(second);
        gate.release();

        expect(await loadingFirst).toBeTrue();
        expect(await loadingSecond).toBeTrue();
        expect(target.getCBTForceV2Revision()).toBe(secondEnvelope.forceRevision);
    });
});
