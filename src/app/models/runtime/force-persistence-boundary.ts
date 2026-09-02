// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { SerializedForce } from '../force-serialization';
import { jsonValuesEqual } from '../../utils/json-value.util';
import { appendCBTForceRosterMember, appendUnassignedCBTForceRosterMember } from './cbt-force-roster';
import {
    CBT_FORCE_MINIMUM_WRITER_VERSION,
    CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
    asForceId,
    emptyRuntimeHistory,
    validateSerializedCBTForceV2,
    type SerializedCBTEncounterStateV2,
    type SerializedCBTForceV2,
    type SerializedForceEncounterEntryV2,
    type SerializedForceUnitEntryV2,
} from './persistence-v2';
import type { SerializedCBTUnitV2 } from './persistence-v2';
import type { SerializedNonMekUnit } from './non-mek-unit-persistence';
import type { CBTUnit } from './cbt-unit';

export interface PreparedCBTForcePersistenceV2 {
    readonly envelope: SerializedCBTForceV2;
    readonly reused: boolean;
}

export type CBTForcePersistenceFailureCode =
    | 'INVALID_ENVELOPE'
    | 'FORCE_ID_MISMATCH'
    | 'READY_RUNTIME_SET_MISMATCH'
    | 'READY_RUNTIME_SERIALIZATION_FAILED'
    | 'READY_RUNTIME_IDENTITY_MISMATCH'
    | 'READY_RUNTIME_REVISION_REGRESSION'
    | 'ENCOUNTER_REVISION_REGRESSION'
    | 'ENCOUNTER_UNREVISIONED_CHANGE'
    | 'INSTANCE_ID_COLLISION'
    | 'MATERIALIZED_ENVELOPE_INVALID';

export type CBTForcePersistenceResultV2 =
    | ({ readonly kind: 'writable' } & PreparedCBTForcePersistenceV2)
    | {
        readonly kind: 'read-only';
        readonly code: CBTForcePersistenceFailureCode;
        readonly error: string;
    };

interface CapturedCBTUnit {
    readonly ready: CBTUnit;
    readonly instanceId: string;
    readonly revision: number;
    readonly serialized: SerializedCBTUnitV2 | SerializedNonMekUnit;
}

/**
 * Writes the current ready runtimes into one V2 envelope. Deferred entries are
 * inert source records and pass through unchanged.
 */
export async function prepareCBTForcePersistenceV2(input: {
    readonly previous: SerializedCBTForceV2;
    readonly liveUnits: readonly CBTUnit[];
    readonly encounterState?: SerializedCBTEncounterStateV2;
}): Promise<CBTForcePersistenceResultV2> {
    // `previous` is the already validated, deeply frozen envelope installed by
    // CBTUnitStore. Revalidating it here cloned and walked the complete
    // force on every autosave, then did the same work again for the candidate.
    // Persistence is an internal typed transition; untrusted envelopes are
    // still fully validated by inspect/load and direct-admission boundaries.
    const previous = input.previous;
    let captures: readonly CapturedCBTUnit[];
    try {
        captures = captureCBTUnits(input.liveUnits, previous);
    } catch (error) {
        return readOnly('READY_RUNTIME_SERIALIZATION_FAILED', errorMessage(error));
    }
    const materialized = materializeReadyEntries(previous, captures);
    if (materialized.kind === 'read-only') return materialized;

    const encounter = materializeEncounter(previous.encounter, input.encounterState);
    if (encounter.kind === 'read-only') return encounter;

    if (!materialized.changed && !encounter.changed) {
        return Object.freeze({
            kind: 'writable' as const,
            envelope: previous,
            reused: true,
        });
    }
    try {
        const envelope: SerializedCBTForceV2 = Object.freeze({
            ...previous,
            forceRevision: nextRevision(previous.forceRevision),
            units: materialized.units,
            encounter: encounter.entry,
        });
        if (!capturesAreCurrent(captures)) {
            return readOnly('READY_RUNTIME_SERIALIZATION_FAILED', 'A ready runtime changed while persistence was prepared');
        }
        return Object.freeze({
            kind: 'writable' as const,
            envelope,
            reused: false,
        });
    } catch (error) {
        return readOnly('MATERIALIZED_ENVELOPE_INVALID', errorMessage(error));
    }
}

/** Adds one ready Non-Mek runtime directly to the current CBT owner. */
export async function prepareDirectUnitAdmission(input: {
    readonly forceId: string;
    readonly previous?: SerializedCBTForceV2;
    readonly liveUnits: readonly CBTUnit[];
    readonly candidate: CBTUnit;
    readonly typedEncounterState?: SerializedCBTEncounterStateV2;
    readonly targetRosterGroupId?: string;
    readonly targetRosterMemberIndex?: number;
    readonly commander?: boolean;
}): Promise<CBTForcePersistenceResultV2> {
    let candidate: CapturedCBTUnit;
    let live: readonly CapturedCBTUnit[];
    try {
        [candidate] = captureCBTUnits([input.candidate]);
        live = captureCBTUnits(input.liveUnits);
    } catch (error) {
        return readOnly('READY_RUNTIME_SERIALIZATION_FAILED', errorMessage(error));
    }

    let base: SerializedCBTForceV2;
    if (input.previous) {
        try {
            base = await validateSerializedCBTForceV2(input.previous);
        } catch (error) {
            return readOnly('INVALID_ENVELOPE', errorMessage(error));
        }
        if (base.forceId !== input.forceId) {
            return readOnly('FORCE_ID_MISMATCH', 'The force ID does not match the persisted V2 owner');
        }
        const materialized = materializeReadyEntries(base, live);
        if (materialized.kind === 'read-only') return materialized;
        const encounter = materializeEncounter(base.encounter, input.typedEncounterState);
        if (encounter.kind === 'read-only') return encounter;
        base = { ...base, units: materialized.units, encounter: encounter.entry };
    } else {
        try {
            base = await createEmptyCBTForceV2(asForceId(input.forceId));
            if (input.typedEncounterState) {
                base = await validateSerializedCBTForceV2({
                    ...base,
                    encounter: Object.freeze({
                        encounterRevision: input.typedEncounterState.encounterRevision,
                        state: input.typedEncounterState,
                    }),
                });
            }
        } catch (error) {
            return readOnly('MATERIALIZED_ENVELOPE_INVALID', errorMessage(error));
        }
    }

    if (base.units.some(entry => entry.instanceId === candidate.instanceId)
        || live.some(entry => entry.instanceId === candidate.instanceId)) {
        return readOnly('INSTANCE_ID_COLLISION', `Force instance ${candidate.instanceId} is already owned`);
    }

    const member = Object.freeze({
        instanceId: candidate.instanceId,
        ...(input.commander === true ? { commander: true as const } : {}),
    });
    let roster;
    try {
        roster = input.targetRosterGroupId
            ? appendCBTForceRosterMember(
                base.roster,
                member,
                input.targetRosterGroupId,
                input.targetRosterMemberIndex,
            )
            : appendUnassignedCBTForceRosterMember(base.roster, member);
    } catch (error) {
        return readOnly('MATERIALIZED_ENVELOPE_INVALID', errorMessage(error));
    }

    try {
        const entry: SerializedForceUnitEntryV2 = Object.freeze({
            instanceId: candidate.instanceId,
            stateRevision: candidate.revision,
            unit: candidate.serialized,
        });
        const envelope = await validateSerializedCBTForceV2({
            ...base,
            forceRevision: nextRevision(base.forceRevision),
            units: Object.freeze([...base.units, entry]),
            roster,
        });
        if (!capturesAreCurrent([...live, candidate])) {
            return readOnly('READY_RUNTIME_SERIALIZATION_FAILED', 'A ready runtime changed while admission was prepared');
        }
        return Object.freeze({
            kind: 'writable' as const,
            envelope,
            reused: false,
        });
    } catch (error) {
        return readOnly('MATERIALIZED_ENVELOPE_INVALID', errorMessage(error));
    }
}

/** Creates the empty current CBT owner used before the first admission. */
export async function prepareInitialCBTForceV2(input: {
    readonly forceId: string;
    readonly typedEncounterState?: SerializedCBTEncounterStateV2;
}): Promise<PreparedCBTForcePersistenceV2> {
    let envelope = await createEmptyCBTForceV2(asForceId(input.forceId));
    if (input.typedEncounterState) {
        envelope = await validateSerializedCBTForceV2({
            ...envelope,
            encounter: Object.freeze({
                encounterRevision: input.typedEncounterState.encounterRevision,
                state: input.typedEncounterState,
            }),
        });
    }
    return Object.freeze({
        envelope,
        reused: false,
    });
}

async function createEmptyCBTForceV2(
    forceId: ReturnType<typeof asForceId>,
): Promise<SerializedCBTForceV2> {
    const revision = 0;
    return validateSerializedCBTForceV2({
        schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
        minimumWriterVersion: CBT_FORCE_MINIMUM_WRITER_VERSION,
        forceId,
        forceRevision: revision,
        history: emptyRuntimeHistory(),
        units: [],
        roster: { schemaVersion: 1, groups: [] },
        encounter: {
            encounterRevision: revision,
            state: { schemaVersion: 2, encounterRevision: revision, facts: [] },
        },
    });
}

/** Validates the current CBT payload carried by the outer force record. */
export async function inspectSerializedCBTForceV2(
    data: SerializedForce,
): Promise<SerializedCBTForceV2 | null> {
    const raw = structuredClone(data).cbt;
    if (raw === undefined) return null;
    return validateSerializedCBTForceV2(raw);
}

function captureCBTUnits(
    units: readonly CBTUnit[],
    previous?: SerializedCBTForceV2,
): readonly CapturedCBTUnit[] {
    const ids = new Set<string>();
    const previousById = new Map(previous?.units.map(entry => [entry.instanceId, entry] as const));
    return Object.freeze(units.map(ready => {
        const revision = ready.revision();
        const previousEntry = previousById.get(ready.instanceId);
        const serialized = previousEntry
            && previousEntry.stateRevision === revision
            && jsonValuesEqual(
                previousEntry.unit.deployment.values.crewAssignment,
                ready.getCrewAssignment(),
            )
            ? previousEntry.unit
            : ready.serialize();
        if (serialized.instanceId !== ready.instanceId || serialized.stateRevision !== revision) {
            throw new Error(`Ready runtime ${ready.instanceId} serialized a different identity or revision`);
        }
        if (serialized.entity !== ready.uuid) {
            throw new Error(`Ready runtime ${ready.instanceId} serialized a different native source`);
        }
        if (ids.has(ready.instanceId)) throw new Error(`Duplicate ready runtime ${ready.instanceId}`);
        ids.add(ready.instanceId);
        return Object.freeze({ ready, instanceId: ready.instanceId, revision, serialized });
    }));
}

function capturesAreCurrent(captures: readonly CapturedCBTUnit[]): boolean {
    return captures.every(capture => {
        try {
            return capture.ready.instanceId === capture.instanceId
                && capture.ready.revision() === capture.revision;
        } catch {
            return false;
        }
    });
}

function materializeReadyEntries(
    previous: SerializedCBTForceV2,
    captures: readonly CapturedCBTUnit[],
): {
    readonly kind: 'ready';
    readonly units: readonly SerializedForceUnitEntryV2[];
    readonly changed: boolean;
}
    | Extract<CBTForcePersistenceResultV2, { readonly kind: 'read-only' }> {
    const expected = previous.units;
    const byId = new Map(captures.map(capture => [capture.instanceId, capture] as const));
    if (expected.length !== byId.size || expected.some(entry => !byId.has(entry.instanceId))) {
        return readOnly('READY_RUNTIME_SET_MISMATCH', 'Ready runtime ownership does not match the persisted unit set');
    }

    const units: SerializedForceUnitEntryV2[] = [];
    let changed = false;
    for (const entry of previous.units) {
        const capture = byId.get(entry.instanceId)!;
        if (capture.serialized.instanceId !== entry.instanceId) {
            return readOnly('READY_RUNTIME_IDENTITY_MISMATCH', `Ready runtime ${entry.instanceId} changed identity`);
        }
        if (capture.revision < entry.stateRevision) {
            return readOnly('READY_RUNTIME_REVISION_REGRESSION', `Ready runtime ${entry.instanceId} regressed its revision`);
        }
        if (capture.revision === entry.stateRevision && capture.serialized === entry.unit) {
            units.push(entry);
            continue;
        }
        // stateRevision belongs to combat state. An immutable wrapper replacement may change
        // deployment metadata at the same combat revision; the enclosing force revision records it.
        changed = true;
        units.push(Object.freeze({
            instanceId: capture.instanceId,
            stateRevision: capture.revision,
            unit: capture.serialized,
        }));
    }
    return Object.freeze({
        kind: 'ready' as const,
        units: changed ? Object.freeze(units) : previous.units,
        changed,
    });
}

function materializeEncounter(
    previous: SerializedForceEncounterEntryV2,
    next: SerializedCBTEncounterStateV2 | undefined,
): {
    readonly kind: 'ready';
    readonly entry: SerializedForceEncounterEntryV2;
    readonly changed: boolean;
}
    | Extract<CBTForcePersistenceResultV2, { readonly kind: 'read-only' }> {
    if (!next || next === previous.state) {
        return Object.freeze({ kind: 'ready' as const, entry: previous, changed: false });
    }
    if (next.encounterRevision < previous.encounterRevision) {
        return readOnly('ENCOUNTER_REVISION_REGRESSION', 'The encounter revision regressed');
    }
    if (next.encounterRevision === previous.encounterRevision
        && !jsonValuesEqual(next, previous.state)) {
        return readOnly('ENCOUNTER_UNREVISIONED_CHANGE', 'The encounter changed without advancing its revision');
    }
    if (next.encounterRevision === previous.encounterRevision) {
        return Object.freeze({ kind: 'ready' as const, entry: previous, changed: false });
    }
    return Object.freeze({
        kind: 'ready' as const,
        entry: Object.freeze({
            encounterRevision: next.encounterRevision,
            state: next,
        }),
        changed: true,
    });
}

function nextRevision(revision: number): number {
    if (revision >= Number.MAX_SAFE_INTEGER) throw new Error('Force revision is exhausted');
    return revision + 1;
}

function readOnly(
    code: CBTForcePersistenceFailureCode,
    error: string,
): Extract<CBTForcePersistenceResultV2, { readonly kind: 'read-only' }> {
    return Object.freeze({ kind: 'read-only', code, error });
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
