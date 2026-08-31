// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { GameSystem } from '../common.model';
import type { SerializedForce } from '../force-serialization';
import {
    cloneAsJson,
    extractDeferredUnitRecovery,
    sanitizeSavedEntityIdentity,
    type DeferredUnitSource,
    type ForceRecoveryEvidence,
    type JsonObject,
    type JsonValue,
    type PersistedUnitIdentity,
    type UnitIdentityResolver,
} from '../persisted-unit-state';
import { isUnitConditionKey, type UnitConditionKey } from '../unit-condition.model';
import {
    CBT_FORCE_MINIMUM_WRITER_VERSION,
    CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
    emptyRuntimeHistory,
    asForceId,
    validateSerializedCBTForceV2,
    type SerializedCBTForceV2,
    type SerializedForceUnitEntryV2,
    type SerializedCBTUnitV2,
} from './persistence-v2';
import {
    CBT_FORCE_ROSTER_SCHEMA_VERSION,
    CBT_FORCE_UNASSIGNED_GROUP_ID,
    CBTForceRosterValidationError,
    MAX_CBT_FORCE_ROSTER_METADATA_LENGTH,
    type SerializedCBTForceRosterGroupV1,
} from './cbt-force-roster';
import {
    asStateRevision,
    asUnitInstanceId,
    freezeRuntimeState,
    type MekUnitRuntimeState,
    type CrewRuntimeState,
} from './runtime-state';
import type { ReadyMekUnit } from './ready-unit-factory';
import type { ReadyNonMekUnit } from './ready-non-mek-unit';
import type { SerializedNonMekUnit } from './non-mek-unit-persistence';
import type {
    NonMekDamageTrack,
    NonMekRuntimeComponent,
    NonMekRuntimeIndex,
} from './non-mek-runtime-index';
import type { CrewAssignment, CrewTopology } from './crew-assignment';
import { createDefaultCrewAssignment } from './crew-assignment';
import type {
    ArmorFaceId,
    ComponentId,
    CrewPositionId,
    LocationId,
    SystemDamageTrackId,
} from '../entity/entity-identifiers';
import { restoreLegacyUnitState } from './state-restorer';
import { encodeLegacyUnitRestorationSidecarV2 } from './legacy-restoration-sidecar';
import { serializeCBTUnitStateV2 } from './runtime-state-codec-v2';
import { canonicalizeMekTurnStateV2 } from './mek-turn-state-v2';
import { buildMekRuntimeIndex } from './mek-runtime-index';
import {
    createMekHeatContextV2,
    mekHeatSourceSignatureV2,
} from './mek-heat-state-v2';
import { createMekMechanicsContextV2 } from './mek-mechanics-context-v2';
import { CBTUnitInstance } from './unit-instance';

const V1_SCENARIO_RULES = Object.freeze({
    schemaVersion: 1 as const,
    values: Object.freeze({ id: 'v1-conversion' }),
});

const V1_CONVERSION_DEPLOYMENT = Object.freeze({ id: 'legacy-v1-to-v2' });

export interface PersistedForceV1ConversionOptions {
    readonly resolveIdentity?: UnitIdentityResolver;
    readonly materializeUnit?: (request: {
        readonly source: DeferredUnitSource;
        readonly instanceId: ReturnType<typeof asUnitInstanceId>;
        readonly deployment: typeof V1_CONVERSION_DEPLOYMENT;
        readonly scenario: typeof V1_SCENARIO_RULES.values;
    }) => Promise<SerializedCBTUnitV2 | SerializedNonMekUnit | undefined>;
}

/** The only force V1 ingress. Runtime construction receives the returned V2 record. */
export async function convertPersistedForceV1(
    force: SerializedForce,
    options: PersistedForceV1ConversionOptions = {},
): Promise<SerializedForce> {
    if (force.version !== 1) {
        throw new Error('Force V1 conversion requires a version 1 force');
    }
    if (force.type === GameSystem.ALPHA_STRIKE) {
        const payload = requireObject(cloneAsJson(force), 'Alpha Strike V1 force');
        return Object.freeze({
            ...payload,
            version: 2,
        }) as unknown as SerializedForce;
    }
    if (force.type !== GameSystem.CLASSIC || force.cbt !== undefined) {
        throw new Error('Unsupported version 1 force type');
    }

    return convertClassicForce(force, options);
}

/** Converts one pristine V2 Mek baseline plus its V1 payload into a standalone V2 snapshot. */
export async function convertPersistedMekUnitV1(
    source: DeferredUnitSource,
    fresh: ReadyMekUnit,
): Promise<SerializedCBTUnitV2> {
    const baseline = fresh.serialize();
    if (baseline.stateRevision !== 0 || baseline.restoration !== undefined) {
        throw new Error('V1 conversion requires a pristine current Mek baseline');
    }
    const restored = await restoreLegacyUnitState(source, fresh.getUnit(), {
        baselineRef: baseline.baselineRefAtSave,
        state: fresh.getInstance().snapshot(),
    });
    const restoredState = convertLegacyMovementHeatAcknowledgement(
        restored.state,
        fresh,
        baseline,
    );
    const restoration = encodeLegacyUnitRestorationSidecarV2(source, restored.metadata);
    const state = freezeRuntimeState({
        ...restoredState,
        crew: restoreLegacyCrewRuntime(
            source,
            restoredState.crew,
            fresh.getIndex().crewPositions,
        ),
    });
    return serializeCBTUnitStateV2({
        entity: fresh.getUnit(),
        index: fresh.getIndex(),
        instanceId: baseline.instanceId,
        baselineRef: baseline.baselineRefAtSave,
        state,
        deployment: Object.freeze({
            ...baseline.deployment,
            values: Object.freeze({
                ...baseline.deployment.values,
                crewAssignment: restoreLegacyCrewAssignment(
                    source,
                    fresh.getIndex().crewPositions,
                ),
            }),
        }),
        ...(restoration === undefined ? {} : { restoration }),
    });
}

/** Converts one pristine non-Mek Entity baseline and its V1 sparse state. */
export function convertPersistedNonMekUnitV1(
    source: DeferredUnitSource,
    fresh: ReadyNonMekUnit,
): SerializedNonMekUnit {
    const baseline = fresh.serialize();
    if (baseline.stateRevision !== 0 || baseline.restoration !== undefined) {
        throw new Error('V1 conversion requires a pristine current Entity baseline');
    }
    if (source.identity.kind !== 'resolved'
        || source.identity.savedIdentity.provider !== baseline.entity.provider
        || source.identity.savedIdentity.uuid !== baseline.entity.uuid) {
        throw new Error('V1 Entity state belongs to a different design');
    }

    const index = fresh.getIndex();
    const recovery = extractDeferredUnitRecovery(source);
    const rawState = isRecord(recovery.rawUnitAndFamilyState)
        ? recovery.rawUnitAndFamilyState
        : {};
    const warnings: string[] = [];
    const unresolved: string[] = [];
    if (source.identity.savedIdentity.sourceHashAtSave
        && source.identity.savedIdentity.sourceHashAtSave !== baseline.entity.sourceHashAtSave) {
        warnings.push('The native source changed since this V1 unit was saved.');
    }

    const locations = restoreLegacyEntityLocations(rawState['locations'], index, warnings, unresolved);
    const componentState = new Map<ComponentId, {
        status?: 'disabled' | 'destroyed';
        mode?: string;
        jammed?: true;
    }>();
    const pendingComponentState = new Map<ComponentId, 'available' | 'disabled' | 'destroyed'>();
    const ammoState = new Map<ComponentId, { shotsSpent: number; munitionOverride?: string }>();
    const damageTrackState = new Map<SystemDamageTrackId, Readonly<{
        hits: number;
        hitTimestamps: readonly number[];
    }>>();
    const pendingDamageTrackHits = new Map<SystemDamageTrackId, Readonly<{
        hitDelta: number;
        hitTimestamps: readonly number[];
    }>>();
    for (const raw of recovery.rawInventoryRecords) {
        restoreLegacyEntityInventory(
            raw,
            index,
            componentState,
            pendingComponentState,
            ammoState,
            warnings,
            unresolved,
        );
    }
    for (const raw of recovery.rawCriticalRecords) {
        if (restoreLegacyNonMekDamageTrack(
            raw,
            index,
            damageTrackState,
            pendingDamageTrackHits,
            warnings,
            unresolved,
        )) continue;
        restoreLegacyNonMekComponentDamage(raw, index, componentState, pendingComponentState, unresolved);
    }

    const conditions = restoreLegacyEntityConditions(rawState['conditions'], unresolved);
    const crewState = restoreLegacyNonMekCrewState(source, index.crewPositions, unresolved);
    const heat = restoreLegacyEntityHeat(
        rawState['heat'],
        fresh.getUnit().tracksHeat(),
        fresh.getUnit().engineHeatSinks(),
        warnings,
        unresolved,
    );
    const turn = restoreLegacyEntityTurn(rawState['turnState'], unresolved);
    const destroyed = rawState['destroyed'] === true;
    if (rawState['destroyed'] !== undefined && typeof rawState['destroyed'] !== 'boolean') {
        unresolved.push('Malformed V1 destroyed state was retained for recovery.');
    }
    preserveUnsupportedLegacyFamilyState(rawState, unresolved);

    const pendingCombat = Object.freeze({
        ...(locations.pendingInternal.length === 0
            ? {}
            : { internalDamage: Object.freeze(locations.pendingInternal) }),
        ...(locations.pendingArmor.length === 0
            ? {}
            : { armorDamage: Object.freeze(locations.pendingArmor) }),
        ...(pendingComponentState.size === 0
            ? {}
            : { componentStatus: Object.freeze([...pendingComponentState]
                .sort(([left], [right]) => compareText(left, right))
                .map(([componentId, status]) => Object.freeze({ componentId, status }))) }),
        ...(pendingDamageTrackHits.size === 0
            ? {}
            : { damageTrackHits: Object.freeze([...pendingDamageTrackHits]
                .sort(([left], [right]) => compareText(left, right))
                .map(([damageTrackId, state]) => Object.freeze({ damageTrackId, ...state }))) }),
    });
    const hasPendingCombat = Object.keys(pendingCombat).length > 0;
    const hasRestoration = warnings.length > 0 || unresolved.length > 0;

    return Object.freeze({
        ...baseline,
        deployment: Object.freeze({
            ...baseline.deployment,
            values: Object.freeze({
                ...baseline.deployment.values,
                crewAssignment: restoreLegacyCrewAssignment(source, index.crewPositions),
            }),
        }),
        ...(destroyed ? { destroyed: true as const } : {}),
        ...(locations.state.length === 0 ? {} : { locationState: Object.freeze(locations.state) }),
        ...(componentState.size === 0
            ? {}
            : { componentState: Object.freeze([...componentState]
                .sort(([left], [right]) => compareText(left, right))
                .map(([componentId, state]) => Object.freeze({ componentId, ...state }))) }),
        ...(damageTrackState.size === 0
            ? {}
            : { damageTrackState: Object.freeze([...damageTrackState]
                .sort(([left], [right]) => compareText(left, right))
                .map(([damageTrackId, state]) => Object.freeze({ damageTrackId, ...state }))) }),
        ...(ammoState.size === 0
            ? {}
            : { ammoState: Object.freeze([...ammoState]
                .sort(([left], [right]) => compareText(left, right))
                .map(([componentId, state]) => Object.freeze({ componentId, ...state }))) }),
        ...(crewState.length === 0 ? {} : { crewState: Object.freeze(crewState) }),
        ...(conditions.length === 0 ? {} : { conditions: Object.freeze(conditions) }),
        ...(heat === undefined ? {} : { heat }),
        ...(turn === undefined ? {} : { turn }),
        ...(hasPendingCombat ? { pendingCombat } : {}),
        ...(hasRestoration
            ? {
                restoration: Object.freeze({
                    warnings: Object.freeze(warnings),
                    unresolved: Object.freeze(unresolved),
                }),
            }
            : {}),
    });
}

function restoreLegacyCrewAssignment(
    source: DeferredUnitSource,
    topology: CrewTopology,
): CrewAssignment {
    const defaults = createDefaultCrewAssignment(topology);
    const rows = legacyCrewRows(source);
    return Object.freeze({
        schemaVersion: 1 as const,
        positions: Object.freeze(defaults.positions.map((position, occurrence) => {
            const row = legacyCrewRow(rows, occurrence);
            return Object.freeze({
                ...position,
                name: boundedLegacyText(row?.['name'], 160) ?? position.name,
                gunnery: legacySkill(row?.['gunnerySkill']) ?? position.gunnery,
                piloting: legacySkill(row?.['pilotingSkill']) ?? position.piloting,
            });
        })),
    });
}

function restoreLegacyCrewRuntime(
    source: DeferredUnitSource,
    current: ReadonlyMap<CrewPositionId, CrewRuntimeState>,
    topology: CrewTopology,
): ReadonlyMap<CrewPositionId, CrewRuntimeState> {
    const crew = new Map(current);
    const rows = legacyCrewRows(source);
    for (const position of [...topology.values()].sort((left, right) => left.occurrence - right.occurrence)) {
        const row = legacyCrewRow(rows, position.occurrence);
        if (!row) continue;
        const state = legacyCrewState(row);
        if (state.wounds === 0 && !state.unconscious && !state.ejected) crew.delete(position.id);
        else crew.set(position.id, state);
    }
    return crew;
}

function restoreLegacyNonMekCrewState(
    source: DeferredUnitSource,
    topology: CrewTopology,
    unresolved: string[],
): readonly Readonly<{
    positionId: CrewPositionId;
    wounds: number;
    unconscious: boolean;
    ejected: boolean;
    state?: 'killed' | 'stunned';
}>[] {
    const rows = legacyCrewRows(source);
    const restored = [...topology.values()]
        .sort((left, right) => left.occurrence - right.occurrence)
        .flatMap(position => {
            const row = legacyCrewRow(rows, position.occurrence);
            if (!row) return [];
            const rawState = integer(row['state']);
            if (rawState !== null && ![0, 1, 2, 3, 4, 5].includes(rawState)) {
                unresolved.push(`Unknown V1 crew state ${rawState} at position ${position.occurrence}.`);
            }
            const state = legacyNonMekCrewState(row);
            return state.wounds === 0 && !state.unconscious && !state.ejected
                && state.state === undefined
                ? []
                : [Object.freeze({ positionId: position.id, ...state })];
        });
    return Object.freeze(restored);
}

function legacyCrewRows(source: DeferredUnitSource): readonly JsonValue[] {
    const recovery = extractDeferredUnitRecovery(source);
    const state = isRecord(recovery.rawUnitAndFamilyState)
        ? recovery.rawUnitAndFamilyState
        : {};
    return Array.isArray(state['crew']) ? state['crew'] : [];
}

function legacyCrewRow(rows: readonly JsonValue[], occurrence: number): Readonly<Record<string, JsonValue>> | undefined {
    const byId = rows.find(row => isRecord(row) && integer(row['id']) === occurrence);
    const candidate = byId ?? rows[occurrence];
    return isRecord(candidate) ? candidate : undefined;
}

function legacyCrewState(row: Readonly<Record<string, JsonValue>>): Readonly<{
    wounds: number;
    unconscious: boolean;
    ejected: boolean;
}> {
    const rawHits = integer(row['hits']);
    const rawState = integer(row['state']);
    return Object.freeze({
        wounds: rawState === 2 || rawState === 4
            ? 6
            : Math.min(6, Math.max(0, rawHits ?? 0)),
        unconscious: rawState === 1,
        ejected: rawState === 3,
    });
}

function legacyNonMekCrewState(row: Readonly<Record<string, JsonValue>>): Readonly<{
    wounds: number;
    unconscious: boolean;
    ejected: boolean;
    state?: 'killed' | 'stunned';
}> {
    const rawHits = integer(row['hits']);
    const rawState = integer(row['state']);
    return Object.freeze({
        wounds: rawState === 2 ? 6 : Math.min(6, Math.max(0, rawHits ?? 0)),
        unconscious: rawState === 1,
        ejected: rawState === 3,
        ...(rawState === 4 ? { state: 'killed' as const }
            : rawState === 5 ? { state: 'stunned' as const } : {}),
    });
}

interface LegacyEntityLocationRestore {
    readonly state: readonly Readonly<{
        locationId: LocationId;
        internalDamage?: number;
        armorDamage?: readonly Readonly<{ faceId: ArmorFaceId; damage: number }>[];
    }>[];
    readonly pendingInternal: readonly Readonly<{ locationId: LocationId; damage: number }>[];
    readonly pendingArmor: readonly Readonly<{ faceId: ArmorFaceId; damage: number }>[];
}

function restoreLegacyEntityLocations(
    raw: JsonValue | undefined,
    index: NonMekRuntimeIndex,
    warnings: string[],
    unresolved: string[],
): LegacyEntityLocationRestore {
    if (raw === undefined) return Object.freeze({ state: [], pendingInternal: [], pendingArmor: [] });
    if (!isRecord(raw)) {
        unresolved.push('Malformed V1 location state was retained for recovery.');
        return Object.freeze({ state: [], pendingInternal: [], pendingArmor: [] });
    }

    const locations = new Map<LocationId, {
        internalDamage: number;
        armorDamage: Map<ArmorFaceId, number>;
    }>();
    const pendingInternal = new Map<LocationId, number>();
    const pendingArmor = new Map<ArmorFaceId, number>();
    for (const [savedCode, value] of Object.entries(raw)) {
        if (!isRecord(value)) {
            unresolved.push(`Malformed V1 location ${savedCode} was retained for recovery.`);
            continue;
        }
        const rear = savedCode.endsWith('-rear');
        const code = rear ? savedCode.slice(0, -'-rear'.length) : savedCode;
        const location = [...index.locations.values()].find(candidate => candidate.code === code);
        if (!location) {
            unresolved.push(`V1 location ${savedCode} does not exist in the current Entity.`);
            continue;
        }
        const face = location.armorFaceIds
            .map(faceId => index.armorFaces.get(faceId))
            .find(candidate => candidate?.face === (rear ? 'rear' : 'front'));
        if (!face) {
            unresolved.push(`V1 location ${savedCode} has no current ${rear ? 'rear' : 'front'} armor face.`);
            continue;
        }
        const current = locations.get(location.id) ?? { internalDamage: 0, armorDamage: new Map() };
        const internal = boundedLegacyDamage(
            value['internal'],
            location.internalPoints,
            `${savedCode} internal damage`,
            warnings,
            unresolved,
        );
        if (internal !== undefined) {
            if (current.internalDamage !== 0 && current.internalDamage !== internal) {
                warnings.push(`Conflicting V1 internal damage at ${savedCode}; the larger value was kept.`);
            }
            current.internalDamage = Math.max(current.internalDamage, internal);
        }
        const armor = boundedLegacyDamage(
            value['armor'],
            face.maximumPoints,
            `${savedCode} armor damage`,
            warnings,
            unresolved,
        );
        if (armor !== undefined) {
            if (armor === 0) current.armorDamage.delete(face.id);
            else current.armorDamage.set(face.id, armor);
        }
        locations.set(location.id, current);

        const pendingI = boundedLegacyPendingDamage(
            value['pendingInternal'],
            current.internalDamage,
            location.internalPoints,
            `${savedCode} pending internal damage`,
            warnings,
            unresolved,
        );
        if (pendingI !== undefined && pendingI !== 0) pendingInternal.set(location.id, pendingI);
        const pendingA = boundedLegacyPendingDamage(
            value['pendingArmor'],
            current.armorDamage.get(face.id) ?? 0,
            face.maximumPoints,
            `${savedCode} pending armor damage`,
            warnings,
            unresolved,
        );
        if (pendingA !== undefined && pendingA !== 0) pendingArmor.set(face.id, pendingA);
        if (value['conditions'] !== undefined) {
            unresolved.push(`V1 location conditions at ${savedCode} have no generic family runtime field.`);
        }
    }

    return Object.freeze({
        state: Object.freeze([...locations]
            .sort(([left], [right]) => compareText(left, right))
            .flatMap(([locationId, value]) => {
                const armorDamage = [...value.armorDamage]
                    .sort(([left], [right]) => compareText(left, right))
                    .map(([faceId, damage]) => Object.freeze({ faceId, damage }));
                return value.internalDamage === 0 && armorDamage.length === 0
                    ? []
                    : [Object.freeze({
                        locationId,
                        ...(value.internalDamage === 0 ? {} : { internalDamage: value.internalDamage }),
                        ...(armorDamage.length === 0 ? {} : { armorDamage: Object.freeze(armorDamage) }),
                    })];
            })),
        pendingInternal: Object.freeze([...pendingInternal]
            .sort(([left], [right]) => compareText(left, right))
            .map(([locationId, damage]) => Object.freeze({ locationId, damage }))),
        pendingArmor: Object.freeze([...pendingArmor]
            .sort(([left], [right]) => compareText(left, right))
            .map(([faceId, damage]) => Object.freeze({ faceId, damage }))),
    });
}

function restoreLegacyEntityInventory(
    raw: JsonValue,
    index: NonMekRuntimeIndex,
    componentState: Map<ComponentId, { status?: 'disabled' | 'destroyed'; mode?: string; jammed?: true }>,
    pendingComponentState: Map<ComponentId, 'available' | 'disabled' | 'destroyed'>,
    ammoState: Map<ComponentId, { shotsSpent: number; munitionOverride?: string }>,
    warnings: string[],
    unresolved: string[],
): void {
    if (!isRecord(raw)) {
        unresolved.push('A malformed V1 inventory row was retained for recovery.');
        return;
    }
    const component = matchLegacyNonMekComponent(raw, index);
    if (!component) {
        unresolved.push(`V1 inventory ${legacyRowLabel(raw)} has no unique current component.`);
        return;
    }
    const destroyed = legacyStateMarker(raw['destroyed']);
    const destroying = legacyStateMarker(raw['destroying']);
    const states = Array.isArray(raw['states']) ? raw['states'] : [];
    const disabled = states.some(state => isRecord(state)
        && state['name'] === 'disabled' && state['value'] === 'true');
    if (destroyed || disabled) {
        componentState.set(component.id, Object.freeze({
            ...componentState.get(component.id),
            status: destroyed ? 'destroyed' : 'disabled',
        }));
    }
    if (destroying) pendingComponentState.set(component.id, 'destroyed');

    const capacity = component.mount.getAmmoShots();
    const consumed = nonnegativeInteger(raw['consumed']);
    const munition = boundedLegacyText(raw['ammo'], 256);
    if (consumed !== null || munition !== undefined) {
        if (capacity === undefined) {
            unresolved.push(`V1 ammunition state for ${legacyRowLabel(raw)} targets a non-ammo component.`);
        } else {
            const shotsSpent = Math.min(consumed ?? 0, capacity);
            if (consumed !== null && shotsSpent !== consumed) {
                warnings.push(`V1 ammunition use for ${legacyRowLabel(raw)} exceeded current capacity.`);
            }
            ammoState.set(component.id, Object.freeze({
                shotsSpent,
                ...(munition === undefined ? {} : { munitionOverride: munition }),
            }));
        }
    } else if (raw['consumed'] !== undefined) {
        unresolved.push(`Malformed V1 ammunition use for ${legacyRowLabel(raw)} was retained for recovery.`);
    }
    const savedCapacity = nonnegativeInteger(raw['totalAmmo']);
    if (savedCapacity !== null && capacity !== undefined && savedCapacity !== capacity) {
        warnings.push(`Ammunition capacity for ${legacyRowLabel(raw)} changed from ${savedCapacity} to ${capacity}.`);
    }
    const unsupportedStates = states.filter(state => !(isRecord(state)
        && state['name'] === 'disabled' && state['value'] === 'true'));
    if (unsupportedStates.length > 0) {
        unresolved.push(`V1 equipment modes for ${legacyRowLabel(raw)} have no generic family runtime field.`);
    }
}

function restoreLegacyNonMekComponentDamage(
    raw: JsonValue,
    index: NonMekRuntimeIndex,
    componentState: Map<ComponentId, { status?: 'disabled' | 'destroyed'; mode?: string; jammed?: true }>,
    pendingComponentState: Map<ComponentId, 'available' | 'disabled' | 'destroyed'>,
    unresolved: string[],
): void {
    if (!isRecord(raw)) {
        unresolved.push('A malformed V1 critical row was retained for recovery.');
        return;
    }
    const component = matchLegacyNonMekComponent(raw, index);
    const hits = nonnegativeInteger(raw['hits']) ?? 0;
    const destroyed = legacyStateMarker(raw['destroyed']) || hits > 0;
    const destroying = legacyStateMarker(raw['destroying'])
        || (integer(raw['pendingHits']) ?? 0) > 0;
    if (!component) {
        if (destroyed || destroying || Object.keys(raw).some(key => !['id', 'name', 'loc', 'slot'].includes(key))) {
            unresolved.push(`V1 critical ${legacyRowLabel(raw)} has no unique current component.`);
        }
        return;
    }
    if (destroyed) componentState.set(component.id, Object.freeze({
        ...componentState.get(component.id),
        status: 'destroyed',
    }));
    if (destroying) pendingComponentState.set(component.id, 'destroyed');
}

/**
 * V1 stored non-Mek system tracks beside equipment critical rows. Match the
 * stable record-sheet ID before attempting equipment recovery so rotor,
 * motive, engine, sensor, and aerospace-system damage cannot be mistaken for
 * missing mounted equipment.
 */
function restoreLegacyNonMekDamageTrack(
    value: JsonValue,
    index: NonMekRuntimeIndex,
    committed: Map<SystemDamageTrackId, Readonly<{
        hits: number;
        hitTimestamps: readonly number[];
    }>>,
    pending: Map<SystemDamageTrackId, Readonly<{
        hitDelta: number;
        hitTimestamps: readonly number[];
    }>>,
    warnings: string[],
    unresolved: string[],
): boolean {
    if (!isRecord(value)) return false;
    const track = matchLegacyNonMekDamageTrack(value, index);
    if (!track) return false;

    const label = legacyRowLabel(value);
    const parsedHits = value['hits'] === undefined ? 0 : nonnegativeInteger(value['hits']);
    if (parsedHits === null) {
        unresolved.push(`Malformed V1 system damage for ${label} was retained for recovery.`);
    }
    const requestedHits = parsedHits ?? 0;
    const rowHits = requestedHits > 0
        ? requestedHits
        : legacyStateMarker(value['destroyed'])
            ? 1
            : 0;
    const current = committed.get(track.id);
    const availableHits = track.maximumHits - (current?.hits ?? 0);
    const restoredHits = Math.min(rowHits, availableHits);
    if (restoredHits !== rowHits) {
        warnings.push(`V1 system damage for ${label} exceeded the current track and was clamped.`);
    }
    if (restoredHits > 0) {
        const timestamps = legacyDamageTrackTimestamps(
            value['hitTimestamps'],
            rowHits,
            restoredHits,
            (current?.hitTimestamps.at(-1) ?? -1) + 1,
            `${label} committed hits`,
            unresolved,
        );
        committed.set(track.id, Object.freeze({
            hits: (current?.hits ?? 0) + restoredHits,
            hitTimestamps: Object.freeze([
                ...(current?.hitTimestamps ?? []),
                ...timestamps,
            ].sort(compareNumbers)),
        }));
    }

    const parsedPending = value['pendingHits'] === undefined
        ? 0
        : integer(value['pendingHits']);
    if (parsedPending === null) {
        unresolved.push(`Malformed V1 pending system damage for ${label} was retained for recovery.`);
    }
    const rowPending = parsedPending ?? 0;
    const requestedPending = rowPending !== 0
        ? rowPending
        : legacyStateMarker(value['destroying'])
            ? 1
            : 0;
    const currentPending = pending.get(track.id);
    const committedHits = committed.get(track.id)?.hits ?? 0;
    const currentDelta = currentPending?.hitDelta ?? 0;
    const nextDelta = Math.max(
        -committedHits,
        Math.min(currentDelta + requestedPending, track.maximumHits - committedHits),
    );
    const restoredPending = nextDelta - currentDelta;
    if (restoredPending !== requestedPending) {
        warnings.push(`V1 pending system damage for ${label} exceeded the current track and was clamped.`);
    }
    if (restoredPending !== 0) {
        const timestamps = restoredPending > 0
            ? legacyDamageTrackTimestamps(
                value['pendingHitTimestamps'],
                Math.max(0, requestedPending),
                restoredPending,
                Math.max(
                    committed.get(track.id)?.hitTimestamps.at(-1) ?? -1,
                    currentPending?.hitTimestamps.at(-1) ?? -1,
                ) + 1,
                `${label} pending hits`,
                unresolved,
            )
            : Object.freeze([]);
        const hitTimestamps = nextDelta > 0
            ? Object.freeze([
                ...(currentPending?.hitTimestamps ?? []),
                ...timestamps,
            ].sort(compareNumbers).slice(0, nextDelta))
            : Object.freeze([]);
        if (nextDelta === 0) pending.delete(track.id);
        else pending.set(track.id, Object.freeze({ hitDelta: nextDelta, hitTimestamps }));
    }
    return true;
}

function matchLegacyNonMekDamageTrack(
    raw: Readonly<Record<string, JsonValue>>,
    index: NonMekRuntimeIndex,
): NonMekDamageTrack | null {
    if (typeof raw['id'] !== 'string') return null;
    const id = raw['id'];
    const matches = [...index.damageTracks.values()].filter(track =>
        track.id === id || track.sheetId === id);
    return matches.length === 1 ? matches[0] : null;
}

function legacyDamageTrackTimestamps(
    value: JsonValue | undefined,
    requestedCount: number,
    restoredCount: number,
    fallbackStart: number,
    label: string,
    unresolved: string[],
): readonly number[] {
    if (restoredCount <= 0) return Object.freeze([]);
    if (Array.isArray(value)
        && value.length === requestedCount
        && value.every(timestamp => typeof timestamp === 'number'
            && Number.isSafeInteger(timestamp) && timestamp >= 0)) {
        return Object.freeze([...(value as number[])].sort(compareNumbers).slice(0, restoredCount));
    }
    if (value !== undefined) {
        unresolved.push(`Malformed V1 timestamps for ${label} were replaced with stable recovery order.`);
    }
    const maximumFallback = fallbackStart + restoredCount - 1;
    const start = Number.isSafeInteger(fallbackStart)
        && fallbackStart >= 0
        && Number.isSafeInteger(maximumFallback)
        ? fallbackStart
        : 0;
    return Object.freeze(Array.from(
        { length: restoredCount },
        (_unused, index) => start + index,
    ));
}

function matchLegacyNonMekComponent(
    raw: Readonly<Record<string, JsonValue>>,
    index: NonMekRuntimeIndex,
): NonMekRuntimeComponent | null {
    const id = typeof raw['id'] === 'string' ? raw['id'] : '';
    const exact = index.components.get(id as ComponentId);
    if (exact) return exact;
    const match = /^(.*?)@([^#]+)#([0-9]+)(?:\.[0-9]+)?$/u.exec(id);
    const expectedName = match?.[1]
        || (typeof raw['originalName'] === 'string' ? raw['originalName'] : undefined)
        || (typeof raw['name'] === 'string' ? raw['name'] : undefined)
        || id;
    const expectedLocation = match?.[2]
        || (typeof raw['loc'] === 'string' ? raw['loc'] : undefined);
    if (!expectedName) return null;
    const candidates = [...index.components.values()].filter(component => {
        const names = [component.mount.equipment?.id, component.mount.equipment?.name, component.mount.equipmentId]
            .filter((value): value is string => typeof value === 'string');
        if (!names.some(name => legacyEquipmentNamesMatch(expectedName, name))) return false;
        return expectedLocation === undefined
            || component.mount.getOccupiedLocations().includes(expectedLocation);
    });
    return candidates.length === 1 ? candidates[0] : null;
}

function restoreLegacyEntityConditions(raw: JsonValue | undefined, unresolved: string[]): readonly UnitConditionKey[] {
    if (raw === undefined) return Object.freeze([]);
    if (!Array.isArray(raw)) {
        unresolved.push('Malformed V1 unit conditions were retained for recovery.');
        return Object.freeze([]);
    }
    const conditions = new Set<UnitConditionKey>();
    for (const value of raw) {
        const record = isRecord(value) ? value : undefined;
        const key = typeof value === 'string'
            ? value
            : typeof record?.['key'] === 'string'
                ? record['key']
                : undefined;
        if (!isUnitConditionKey(key)) {
            unresolved.push('An unknown V1 unit condition was retained for recovery.');
            continue;
        }
        if (record?.['pending'] === true || record?.['value'] !== undefined) {
            unresolved.push(`V1 condition details for ${key} have no generic family runtime field.`);
            if (record['pending'] === true) continue;
        }
        conditions.add(key);
    }
    return Object.freeze([...conditions].sort(compareText));
}

function preserveUnsupportedLegacyFamilyState(
    rawState: Readonly<Record<string, JsonValue>>,
    unresolved: string[],
): void {
    const ignored = new Set([
        'modified', 'destroyed', 'conditions', 'crew', 'crits', 'locations', 'inventory', 'heat', 'turnState',
    ]);
    for (const [key, value] of Object.entries(rawState)) {
        if (ignored.has(key) || value === undefined || value === null) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        if (isRecord(value) && Object.keys(value).length === 0) continue;
        unresolved.push(`V1 family field ${key} has no current generic runtime field.`);
    }
}

function restoreLegacyEntityHeat(
    value: JsonValue | undefined,
    tracksHeat: boolean,
    installedHeatSinks: number,
    warnings: string[],
    unresolved: string[],
): SerializedNonMekUnit['heat'] {
    if (value === undefined || value === null) return undefined;
    if (!isRecord(value)) {
        unresolved.push('Malformed V1 heat state was retained for recovery.');
        return undefined;
    }
    const current = nonnegativeInteger(value['current']);
    const previous = nonnegativeInteger(value['previous']);
    const pending = value['next'] === undefined ? undefined : nonnegativeInteger(value['next']);
    const off = value['heatsinksOff'] === undefined
        ? 0
        : nonnegativeInteger(value['heatsinksOff']);
    if (current === null || previous === null || pending === null || off === null) {
        unresolved.push('Malformed V1 heat state was retained for recovery.');
        return undefined;
    }
    const nonPristine = current !== 0 || previous !== 0 || pending !== undefined || off !== 0;
    if (!tracksHeat) {
        if (nonPristine) unresolved.push('V1 heat state belongs to an Entity that does not track heat.');
        return undefined;
    }
    if (current > 1_000_000 || previous > 1_000_000 || (pending ?? 0) > 1_000_000) {
        unresolved.push('V1 heat state exceeds the current runtime limit.');
        return undefined;
    }
    const maximumOff = Math.max(0, Math.trunc(installedHeatSinks));
    const heatsinksOff = Math.min(off, maximumOff);
    if (heatsinksOff !== off) warnings.push('V1 disabled heat sinks exceeded the installed count and were clamped.');
    if (current === 0 && previous === 0
        && (pending === undefined || pending === current)
        && heatsinksOff === 0) return undefined;
    return Object.freeze({
        current,
        previous,
        ...(pending === undefined || pending === current ? {} : { pendingOverride: pending }),
        heatsinksOff,
    });
}

const LEGACY_NON_MEK_MOVEMENT_MODES = new Set([
    'stationary', 'walk', 'run', 'jump', 'UMU', 'VTOL',
]);

function restoreLegacyEntityTurn(
    value: JsonValue | undefined,
    unresolved: string[],
): SerializedNonMekUnit['turn'] {
    if (value === undefined || value === null) return undefined;
    if (!isRecord(value)) {
        unresolved.push('Malformed V1 turn state was retained for recovery.');
        return undefined;
    }
    const supported = new Set(['turnCounter', 'airborne', 'moveMode', 'moveDistance']);
    for (const [key, field] of Object.entries(value)) {
        if (supported.has(key) || field === undefined || field === null || field === false || field === 0) continue;
        if (Array.isArray(field) && field.length === 0) continue;
        if (isRecord(field) && Object.keys(field).length === 0) continue;
        unresolved.push(`V1 turn field ${key} has no current Non-Mek runtime field.`);
    }

    const turnCounter = value['turnCounter'] === undefined
        ? 0
        : nonnegativeInteger(value['turnCounter']);
    if (turnCounter === null) unresolved.push('Malformed V1 turn counter was retained for recovery.');

    const airborne = value['airborne'];
    if (airborne !== undefined && typeof airborne !== 'boolean') {
        unresolved.push('Malformed V1 airborne state was retained for recovery.');
    }

    const rawMode = value['moveMode'];
    const mode = typeof rawMode === 'string' && LEGACY_NON_MEK_MOVEMENT_MODES.has(rawMode)
        ? rawMode as NonNullable<NonNullable<SerializedNonMekUnit['turn']>['movement']>['mode']
        : undefined;
    if (rawMode !== undefined && mode === undefined) {
        unresolved.push('Malformed V1 movement mode was retained for recovery.');
    }
    const rawDistance = value['moveDistance'];
    const distance = rawDistance === undefined ? undefined : nonnegativeInteger(rawDistance);
    if (rawDistance !== undefined && distance === null) {
        unresolved.push('Malformed V1 movement distance was retained for recovery.');
    }
    if ((mode === undefined) !== (distance === undefined || distance === null)) {
        unresolved.push('Incomplete V1 movement declaration was retained for recovery.');
    }
    const movement = mode !== undefined && distance !== undefined && distance !== null
        ? Object.freeze({ mode, distance, boosterComponentIds: Object.freeze([]) })
        : undefined;
    if ((turnCounter ?? 0) === 0 && typeof airborne !== 'boolean' && movement === undefined) {
        return undefined;
    }
    return Object.freeze({
        ...(turnCounter === null || turnCounter === 0 ? {} : { turnCounter }),
        ...(typeof airborne === 'boolean' ? { airborne } : {}),
        ...(movement === undefined ? {} : { movement }),
    });
}

function boundedLegacyDamage(
    value: JsonValue | undefined,
    maximum: number,
    label: string,
    warnings: string[],
    unresolved: string[],
): number | undefined {
    if (value === undefined) return undefined;
    const parsed = nonnegativeInteger(value);
    if (parsed === null) {
        unresolved.push(`Malformed V1 ${label} was retained for recovery.`);
        return undefined;
    }
    const bounded = Math.min(parsed, maximum);
    if (bounded !== parsed) warnings.push(`V1 ${label} exceeded current capacity and was clamped.`);
    return bounded;
}

function boundedLegacyPendingDamage(
    value: JsonValue | undefined,
    committed: number,
    maximum: number,
    label: string,
    warnings: string[],
    unresolved: string[],
): number | undefined {
    if (value === undefined) return undefined;
    const parsed = integer(value);
    if (parsed === null) {
        unresolved.push(`Malformed V1 ${label} was retained for recovery.`);
        return undefined;
    }
    const bounded = Math.max(-committed, Math.min(parsed, maximum - committed));
    if (bounded !== parsed) warnings.push(`V1 ${label} exceeded current capacity and was clamped.`);
    return bounded;
}

function legacyEquipmentNamesMatch(left: string, right: string): boolean {
    return normalizeLegacyEquipmentName(left) === normalizeLegacyEquipmentName(right);
}

function normalizeLegacyEquipmentName(value: string): string {
    return value.trim().toLowerCase().replace(/^(?:is|clan)/u, '').replace(/[^a-z0-9]+/gu, '');
}

function legacyStateMarker(value: JsonValue | undefined): boolean {
    return value === true || (typeof value === 'number' && Number.isFinite(value));
}

function legacyRowLabel(raw: Readonly<Record<string, JsonValue>>): string {
    return boundedLegacyText(raw['id'], 512)
        ?? boundedLegacyText(raw['name'], 512)
        ?? '<unknown>';
}

function boundedLegacyText(value: JsonValue | undefined, maximum: number): string | undefined {
    return typeof value === 'string' && value.length <= maximum && !value.includes('\0')
        ? value
        : undefined;
}

function legacySkill(value: JsonValue | undefined): number | undefined {
    const parsed = integer(value);
    return parsed !== null && parsed >= 0 && parsed <= 8 ? parsed : undefined;
}

function integer(value: JsonValue | undefined): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function nonnegativeInteger(value: JsonValue | undefined): number | null {
    const parsed = integer(value);
    return parsed !== null && parsed >= 0 ? parsed : null;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumbers(left: number, right: number): number {
    return left - right;
}

/** Converts the one heat witness whose V1 and current signatures differ. */
function convertLegacyMovementHeatAcknowledgement(
    state: MekUnitRuntimeState,
    fresh: ReadyMekUnit,
    baseline: SerializedCBTUnitV2,
): MekUnitRuntimeState {
    const savedSignature = state.turn.acknowledgedHeatSources.get('movement');
    if (savedSignature === undefined) return state;

    // Project from the restored state without acknowledgements so unrelated stale V1 witnesses
    // cannot suppress or disable the source needed for this one-way conversion.
    const projectionState = freezeRuntimeState({
        ...state,
        turn: canonicalizeMekTurnStateV2({
            ...state.turn,
            acknowledgedHeatSources: new Map(),
        }),
    });
    const entity = fresh.getUnit();
    const ruleset = baseline.baselineRefAtSave.ruleset;
    const index = buildMekRuntimeIndex(entity);
    const projectionRuntime = new CBTUnitInstance(
        baseline.instanceId,
        baseline.baselineRefAtSave,
        entity,
        index,
        ruleset,
        projectionState,
        fresh.getCrewAssignment(),
        createMekHeatContextV2(entity, index, ruleset, V1_SCENARIO_RULES.values),
        createMekMechanicsContextV2(entity, index, ruleset, V1_SCENARIO_RULES.values),
    );
    const projected = projectionRuntime.query().heatProjection('manual');
    const movement = projected.kind === 'supported'
        ? projected.projection.committedSources.find(source => source.id === 'movement')
        : undefined;
    const acknowledgedHeatSources = new Map(state.turn.acknowledgedHeatSources);
    acknowledgedHeatSources.delete('movement');
    if (movement !== undefined) {
        const currentSignature = mekHeatSourceSignatureV2(movement);
        const legacySignature = JSON.stringify([
            movement.value,
            movement.replacedByFiringEntryId ?? null,
            null,
        ]);
        if (savedSignature === legacySignature || savedSignature === currentSignature) {
            acknowledgedHeatSources.set('movement', currentSignature);
        }
    }
    return freezeRuntimeState({
        ...state,
        turn: canonicalizeMekTurnStateV2({ ...state.turn, acknowledgedHeatSources }),
    });
}

async function convertClassicForce(
    force: SerializedForce,
    options: PersistedForceV1ConversionOptions,
): Promise<SerializedForce> {
    const payload = requireObject(cloneAsJson(force), 'Classic V1 force');
    const rawGroups = payload['groups'];
    if (rawGroups !== undefined && !Array.isArray(rawGroups)) {
        throw new Error('Classic V1 force groups must be an array');
    }

    const stateRevision = asStateRevision(0);
    const seenInstanceIds = new Set<string>();
    const deferredUnits: Array<{
        readonly kind: 'deferred';
        readonly instanceId: ReturnType<typeof asUnitInstanceId>;
        readonly stateRevision: typeof stateRevision;
        readonly source: DeferredUnitSource;
    }> = [];
    const groupIds = new Set<string>();
    const rosterGroups: SerializedCBTForceRosterGroupV1[] = [];

    for (const [groupOrder, rawGroup] of (rawGroups ?? []).entries()) {
        const group = requireObject(rawGroup, `Classic V1 group ${groupOrder}`);
        const groupId = readGroupId(group, groupOrder);
        if (groupId === CBT_FORCE_UNASSIGNED_GROUP_ID) {
            throw new Error(`Classic V1 group ${groupOrder} uses reserved ID ${groupId}`);
        }
        if (groupIds.has(groupId)) throw new Error(`Classic V1 force has duplicate group ID ${groupId}`);
        groupIds.add(groupId);

        const rawMembers = group['units'];
        if (!Array.isArray(rawMembers)) throw new Error(`Classic V1 group ${groupId} requires a units array`);
        let commanderInstanceId: ReturnType<typeof asUnitInstanceId> | undefined;
        const members = rawMembers.map((rawMember, memberOrder) => {
            const unit = requireObject(rawMember, `Classic V1 unit ${groupOrder}:${memberOrder}`);
            const rawId = unit['id'];
            if (typeof rawId !== 'string') throw new Error(`Classic V1 unit ${groupOrder}:${memberOrder} requires an ID`);
            const instanceId = asUnitInstanceId(rawId);
            if (seenInstanceIds.has(instanceId)) {
                throw new Error(`Classic V1 force has duplicate unit ID ${instanceId}`);
            }
            seenInstanceIds.add(instanceId);

            const commander = sparseTrue(unit, 'commander', `Classic V1 unit ${instanceId}`);
            if (commander) {
                if (commanderInstanceId !== undefined) {
                    throw new CBTForceRosterValidationError(
                        'ROSTER_COMMANDER_CONFLICT',
                        `groups/${groupOrder}/units/${memberOrder}/commander`,
                        `roster group ${groupId} may contain at most one commander; ${instanceId} conflicts with ${commanderInstanceId}`,
                    );
                }
                commanderInstanceId = instanceId;
            }

            deferredUnits.push(Object.freeze({
                kind: 'deferred' as const,
                instanceId,
                stateRevision,
                source: buildDeferredSource(unit, options.resolveIdentity),
            }));
            return Object.freeze({
                instanceId,
                kind: 'deferred' as const,
                order: memberOrder,
                ...(commander ? { commander: true as const } : {}),
            });
        });

        const name = optionalMetadata(group, 'name', `Classic V1 group ${groupId}`);
        const color = optionalMetadata(group, 'color', `Classic V1 group ${groupId}`);
        const formationId = optionalMetadata(group, 'formationId', `Classic V1 group ${groupId}`);
        const formationTargetGroupId = optionalMetadata(
            group,
            'formationTargetGroupId',
            `Classic V1 group ${groupId}`,
        );
        const formationLock = sparseTrue(group, 'formationLock', `Classic V1 group ${groupId}`);
        rosterGroups.push(Object.freeze({
            groupId,
            order: groupOrder,
            ...(name === undefined ? {} : { name }),
            ...(color === undefined ? {} : { color }),
            ...(formationId === undefined ? {} : { formationId }),
            ...(formationTargetGroupId === undefined ? {} : { formationTargetGroupId }),
            ...(formationLock ? { formationLock: true as const } : {}),
            members: Object.freeze(members),
        }));
    }

    const forceId = asForceId(force.instanceId);
    const encounterRecovery = buildForceRecovery(payload);
    let cbt = await validateSerializedCBTForceV2({
        schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
        minimumWriterVersion: CBT_FORCE_MINIMUM_WRITER_VERSION,
        forceId,
        forceRevision: stateRevision,
        scenarioRules: V1_SCENARIO_RULES,
        history: emptyRuntimeHistory(),
        units: Object.freeze(deferredUnits),
        roster: {
            schemaVersion: CBT_FORCE_ROSTER_SCHEMA_VERSION,
            groups: Object.freeze(rosterGroups),
        },
        encounter: {
            encounterRevision: stateRevision,
            state: {
                schemaVersion: 2,
                encounterRevision: stateRevision,
                facts: [],
            },
            ...(encounterRecovery === undefined ? {} : { recovery: encounterRecovery }),
        },
    } satisfies SerializedCBTForceV2);

    if (options.materializeUnit) {
        cbt = await materializeResolvedUnits(cbt, options.materializeUnit);
    }

    return Object.freeze({
        version: 2,
        timestamp: force.timestamp,
        instanceId: force.instanceId,
        type: GameSystem.CLASSIC,
        name: force.name,
        ...(force.note === undefined ? {} : { note: force.note }),
        ...(force.tags === undefined ? {} : { tags: force.tags }),
        ...(force.factionId === undefined ? {} : { factionId: force.factionId }),
        ...(force.factionLock === undefined ? {} : { factionLock: force.factionLock }),
        ...(force.eraId === undefined ? {} : { eraId: force.eraId }),
        ...(force.eraLock === undefined ? {} : { eraLock: force.eraLock }),
        ...(force.bv === undefined ? {} : { bv: force.bv }),
        ...(force.owned === undefined ? {} : { owned: force.owned }),
        cbt,
    });
}

async function materializeResolvedUnits(
    envelope: SerializedCBTForceV2,
    materializeUnit: NonNullable<PersistedForceV1ConversionOptions['materializeUnit']>,
): Promise<SerializedCBTForceV2> {
    const materializedIds = new Set<string>();
    const units: SerializedForceUnitEntryV2[] = [];
    for (const entry of envelope.units) {
        if (entry.kind !== 'deferred' || entry.source.identity.kind !== 'resolved') {
            units.push(entry);
            continue;
        }
        const unit = await materializeUnit({
            source: entry.source,
            instanceId: entry.instanceId,
            deployment: V1_CONVERSION_DEPLOYMENT,
            scenario: V1_SCENARIO_RULES.values,
        });
        if (!unit) {
            units.push(entry);
            continue;
        }
        const identity = entry.source.identity.savedIdentity;
        if (unit.instanceId !== entry.instanceId
            || unit.entity.provider !== identity.provider
            || unit.entity.uuid !== identity.uuid) {
            throw new Error(`Converted V1 unit ${entry.instanceId} changed identity`);
        }
        materializedIds.add(entry.instanceId);
        units.push(Object.freeze({
            kind: 'ready' as const,
            instanceId: entry.instanceId,
            stateRevision: unit.stateRevision,
            unit,
        }));
    }
    if (materializedIds.size === 0) return envelope;

    return validateSerializedCBTForceV2({
        ...envelope,
        forceRevision: asStateRevision(envelope.forceRevision + 1),
        units: Object.freeze(units),
        roster: Object.freeze({
            ...envelope.roster,
            groups: Object.freeze(envelope.roster.groups.map(group => Object.freeze({
                ...group,
                members: Object.freeze(group.members.map(member => materializedIds.has(member.instanceId)
                    ? Object.freeze({ ...member, kind: 'ready' as const })
                    : member)),
            }))),
        }),
    });
}

function buildDeferredSource(
    unit: JsonObject,
    resolveIdentity?: UnitIdentityResolver,
): DeferredUnitSource {
    const identity = savedIdentityFromPayload(unit)
        ?? resolveIdentity?.(unit)
        ?? unresolvedIdentity(unit);
    return Object.freeze({
        payload: cloneAsJson(unit),
        identity,
    });
}

function savedIdentityFromPayload(unit: JsonObject): PersistedUnitIdentity | undefined {
    try {
        const savedIdentity = sanitizeSavedEntityIdentity(unit['entityIdentity']);
        return savedIdentity ? Object.freeze({ kind: 'resolved' as const, savedIdentity }) : undefined;
    } catch {
        return undefined;
    }
}

function unresolvedIdentity(unit: JsonObject): PersistedUnitIdentity {
    const rawChassis = stringValue(unit['chassis']);
    const rawModel = stringValue(unit['model']);
    const rawEntityType = stringValue(unit['type']);
    return Object.freeze({
        kind: 'unresolved' as const,
        rawLegacyName: stringValue(unit['unit']) ?? '',
        ...(rawChassis === undefined ? {} : { rawChassis }),
        ...(rawModel === undefined ? {} : { rawModel }),
        ...(rawEntityType === undefined ? {} : { rawEntityType }),
        candidates: Object.freeze([]),
        reason: 'not-found' as const,
    });
}

function buildForceRecovery(payload: JsonObject): ForceRecoveryEvidence | undefined {
    const c3Networks = cloneJsonArray(payload['c3Networks']);
    if (c3Networks.length === 0) return undefined;
    return Object.freeze({
        schemaVersion: 1,
        c3Networks,
    });
}

function cloneJsonArray(value: JsonValue | undefined): readonly JsonValue[] {
    return Array.isArray(value) ? Object.freeze(value.map(cloneAsJson)) : Object.freeze([]);
}

function optionalMetadata(
    record: JsonObject,
    key: 'name' | 'color' | 'formationId' | 'formationTargetGroupId',
    label: string,
): string | undefined {
    const value = record[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.includes('\0')) throw new Error(`${label} has invalid ${key}`);
    const normalized = value.trim();
    if (!normalized) return undefined;
    if (normalized.length > MAX_CBT_FORCE_ROSTER_METADATA_LENGTH) throw new Error(`${label} has invalid ${key}`);
    return normalized;
}

function sparseTrue(record: JsonObject, key: 'formationLock' | 'commander', label: string): boolean {
    const value = record[key];
    if (value === undefined || value === false) return false;
    if (value !== true) throw new Error(`${label} has invalid ${key}`);
    return true;
}

function readGroupId(group: JsonObject, groupOrder: number): string {
    const value = group['id'];
    if (value === undefined) return `v1-group:${groupOrder}`;
    if (typeof value !== 'string' || !value.trim() || value.length > 512 || value.includes('\0')) {
        throw new Error(`Classic V1 group ${groupOrder} has an invalid ID`);
    }
    return value;
}

function requireObject(value: unknown, label: string): JsonObject {
    if (!isRecord(value)) throw new Error(`${label} must be an object`);
    return value as JsonObject;
}

function isRecord(value: unknown): value is Readonly<Record<string, JsonValue>> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: JsonValue | undefined): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
