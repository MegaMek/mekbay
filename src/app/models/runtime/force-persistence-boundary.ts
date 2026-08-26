// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { SerializedForce } from '../force-serialization';
import type {
    JsonValue,
} from '../persisted-unit-state';
import { jsonValuesEqual } from '../../utils/json-value.util';
import {
    appendCBTForceRosterMember,
    appendUnassignedCBTForceRosterMember,
} from './cbt-force-roster';
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
    type SerializedScenarioRulesV2,
} from './persistence-v2';
import type { SerializedCBTUnitV2 } from './persistence-v2';
import type { SerializedNonMekUnit } from './non-mek-unit-persistence';
import type { ReadyClassicUnit } from './ready-classic-unit';
import {
    asStateRevision,
    asUnitInstanceId,
    type StateRevision,
    type UnitInstanceId,
} from './runtime-state';
import { CORE_2026_RULESET } from '../cbt-ruleset.model';

const DEFAULT_SCENARIO_RULES: JsonValue = Object.freeze({
    id: 'megamek',
    ruleset: CORE_2026_RULESET,
});

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
    | 'CANDIDATE_SCENARIO_MISMATCH'
    | 'MATERIALIZED_ENVELOPE_INVALID';

export type CBTForcePersistenceResultV2 =
    | ({ readonly kind: 'writable' } & PreparedCBTForcePersistenceV2)
    | {
        readonly kind: 'read-only';
        readonly code: CBTForcePersistenceFailureCode;
        readonly error: string;
    };

interface CapturedReadyUnit {
    readonly ready: ReadyClassicUnit;
    readonly instanceId: UnitInstanceId;
    readonly revision: StateRevision;
    readonly serialized: SerializedCBTUnitV2 | SerializedNonMekUnit;
}

/**
 * Writes the current ready runtimes into one V2 envelope. Deferred entries are
 * inert source records and pass through unchanged.
 */
export async function prepareCBTForcePersistenceV2(input: {
    readonly previous: SerializedCBTForceV2;
    readonly liveUnits: readonly ReadyClassicUnit[];
    readonly encounterState?: SerializedCBTEncounterStateV2;
}): Promise<CBTForcePersistenceResultV2> {
    let previous: SerializedCBTForceV2;
    try {
        previous = await validateSerializedCBTForceV2(input.previous);
    } catch (error) {
        return readOnly('INVALID_ENVELOPE', errorMessage(error));
    }
    let captures: readonly CapturedReadyUnit[];
    try {
        captures = captureReadyUnits(input.liveUnits);
    } catch (error) {
        return readOnly('READY_RUNTIME_SERIALIZATION_FAILED', errorMessage(error));
    }
    const materialized = materializeReadyEntries(previous, captures);
    if (materialized.kind === 'read-only') return materialized;

    const encounter = materializeEncounter(previous.encounter, input.encounterState);
    if (encounter.kind === 'read-only') return encounter;

    const atCurrentRevision: SerializedCBTForceV2 = {
        ...previous,
        units: materialized.units,
        encounter: encounter.entry,
    };
    if (jsonValuesEqual(atCurrentRevision, previous)) {
        return Object.freeze({
            kind: 'writable' as const,
            envelope: previous,
            reused: true,
        });
    }
    try {
        const envelope = await validateSerializedCBTForceV2({
            ...atCurrentRevision,
            forceRevision: nextRevision(previous.forceRevision),
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

/** Adds one ready Non-Mek runtime directly to the current Classic owner. */
export async function prepareDirectUnitAdmission(input: {
    readonly forceId: string;
    readonly previous?: SerializedCBTForceV2;
    readonly liveUnits: readonly ReadyClassicUnit[];
    readonly candidate: ReadyClassicUnit;
    readonly scenarioRules: JsonValue;
    readonly typedEncounterState?: SerializedCBTEncounterStateV2;
    readonly targetRosterGroupId?: string;
    readonly targetRosterMemberIndex?: number;
    readonly commander?: boolean;
}): Promise<CBTForcePersistenceResultV2> {
    let candidate: CapturedReadyUnit;
    let live: readonly CapturedReadyUnit[];
    try {
        [candidate] = captureReadyUnits([input.candidate]);
        live = captureReadyUnits(input.liveUnits);
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
            base = await createEmptyCBTForceV2(
                asForceId(input.forceId),
                Object.freeze({ schemaVersion: 1, values: structuredClone(input.scenarioRules) }),
            );
            if (input.typedEncounterState) {
                base = await validateSerializedCBTForceV2({
                    ...base,
                    encounter: Object.freeze({
                        encounterRevision: input.typedEncounterState.encounterRevision,
                        state: input.typedEncounterState,
                        ...(base.encounter.recovery === undefined ? {} : { recovery: base.encounter.recovery }),
                    }),
                });
            }
        } catch (error) {
            return readOnly('MATERIALIZED_ENVELOPE_INVALID', errorMessage(error));
        }
    }

    if (!jsonValuesEqual(base.scenarioRules.values, input.scenarioRules)) {
        return readOnly('CANDIDATE_SCENARIO_MISMATCH', 'The candidate scenario differs from the force scenario');
    }
    if (base.units.some(entry => entry.instanceId === candidate.instanceId)
        || live.some(entry => entry.instanceId === candidate.instanceId)) {
        return readOnly('INSTANCE_ID_COLLISION', `Force instance ${candidate.instanceId} is already owned`);
    }

    const member = Object.freeze({
        instanceId: candidate.instanceId,
        kind: 'ready' as const,
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
            kind: 'ready' as const,
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

/** Creates the empty current Classic owner used before the first admission. */
export async function prepareInitialCBTForceV2(input: {
    readonly forceId: string;
    readonly initialScenarioRules?: SerializedScenarioRulesV2;
    readonly typedEncounterState?: SerializedCBTEncounterStateV2;
}): Promise<PreparedCBTForcePersistenceV2> {
    const scenarioRules = input.initialScenarioRules
        ?? Object.freeze({ schemaVersion: 1 as const, values: DEFAULT_SCENARIO_RULES });
    let envelope = await createEmptyCBTForceV2(asForceId(input.forceId), scenarioRules);
    if (input.typedEncounterState) {
        envelope = await validateSerializedCBTForceV2({
            ...envelope,
            encounter: Object.freeze({
                encounterRevision: input.typedEncounterState.encounterRevision,
                state: input.typedEncounterState,
                ...(envelope.encounter.recovery === undefined ? {} : { recovery: envelope.encounter.recovery }),
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
    scenarioRules: SerializedScenarioRulesV2,
): Promise<SerializedCBTForceV2> {
    const revision = asStateRevision(0);
    return validateSerializedCBTForceV2({
        schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
        minimumWriterVersion: CBT_FORCE_MINIMUM_WRITER_VERSION,
        forceId,
        forceRevision: revision,
        scenarioRules,
        history: emptyRuntimeHistory(),
        units: [],
        roster: { schemaVersion: 1, groups: [] },
        encounter: {
            encounterRevision: revision,
            state: { schemaVersion: 2, encounterRevision: revision, facts: [] },
        },
    });
}

/** Validates the current Classic payload carried by the outer force record. */
export async function inspectSerializedCBTForceV2(
    data: SerializedForce,
): Promise<SerializedCBTForceV2 | null> {
    const raw = structuredClone(data).cbt;
    if (raw === undefined) return null;
    return validateSerializedCBTForceV2(raw);
}

function captureReadyUnits(units: readonly ReadyClassicUnit[]): readonly CapturedReadyUnit[] {
    const ids = new Set<string>();
    return Object.freeze(units.map(ready => {
        const serialized = ready.serialize();
        const revision = ready.revision();
        if (serialized.instanceId !== ready.instanceId || serialized.stateRevision !== revision) {
            throw new Error(`Ready runtime ${ready.instanceId} serialized a different identity or revision`);
        }
        if (ids.has(ready.instanceId)) throw new Error(`Duplicate ready runtime ${ready.instanceId}`);
        ids.add(ready.instanceId);
        return Object.freeze({ ready, instanceId: ready.instanceId, revision, serialized });
    }));
}

function capturesAreCurrent(captures: readonly CapturedReadyUnit[]): boolean {
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
    captures: readonly CapturedReadyUnit[],
): { readonly kind: 'ready'; readonly units: readonly SerializedForceUnitEntryV2[] }
    | Extract<CBTForcePersistenceResultV2, { readonly kind: 'read-only' }> {
    const expected = previous.units.filter(entry => entry.kind === 'ready');
    const byId = new Map(captures.map(capture => [capture.instanceId, capture] as const));
    if (expected.length !== byId.size || expected.some(entry => !byId.has(entry.instanceId))) {
        return readOnly('READY_RUNTIME_SET_MISMATCH', 'Ready runtime ownership does not match the persisted unit set');
    }

    const units: SerializedForceUnitEntryV2[] = [];
    for (const entry of previous.units) {
        if (entry.kind === 'deferred') {
            units.push(entry);
            continue;
        }
        const capture = byId.get(entry.instanceId)!;
        if (capture.serialized.instanceId !== entry.instanceId) {
            return readOnly('READY_RUNTIME_IDENTITY_MISMATCH', `Ready runtime ${entry.instanceId} changed identity`);
        }
        if (capture.revision < entry.stateRevision) {
            return readOnly('READY_RUNTIME_REVISION_REGRESSION', `Ready runtime ${entry.instanceId} regressed its revision`);
        }
        // stateRevision belongs to combat state. An immutable wrapper replacement may change
        // deployment metadata at the same combat revision; the enclosing force revision records it.
        units.push(Object.freeze({
            kind: 'ready' as const,
            instanceId: capture.instanceId,
            stateRevision: capture.revision,
            unit: capture.serialized,
        }));
    }
    return Object.freeze({ kind: 'ready' as const, units: Object.freeze(units) });
}

function materializeEncounter(
    previous: SerializedForceEncounterEntryV2,
    next: SerializedCBTEncounterStateV2 | undefined,
): { readonly kind: 'ready'; readonly entry: SerializedForceEncounterEntryV2 }
    | Extract<CBTForcePersistenceResultV2, { readonly kind: 'read-only' }> {
    if (!next) return Object.freeze({ kind: 'ready' as const, entry: previous });
    if (next.encounterRevision < previous.encounterRevision) {
        return readOnly('ENCOUNTER_REVISION_REGRESSION', 'The encounter revision regressed');
    }
    if (next.encounterRevision === previous.encounterRevision
        && !jsonValuesEqual(next, previous.state)) {
        return readOnly('ENCOUNTER_UNREVISIONED_CHANGE', 'The encounter changed without advancing its revision');
    }
    return Object.freeze({
        kind: 'ready' as const,
        entry: Object.freeze({
            encounterRevision: next.encounterRevision,
            state: next,
            ...(previous.recovery === undefined ? {} : { recovery: previous.recovery }),
        }),
    });
}

function nextRevision(revision: number): StateRevision {
    if (revision >= Number.MAX_SAFE_INTEGER) throw new Error('Force revision is exhausted');
    return asStateRevision(revision + 1);
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
