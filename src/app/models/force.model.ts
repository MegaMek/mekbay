// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal, computed, type Signal, type WritableSignal, type Injector } from '@angular/core';
import { Subject } from 'rxjs';
import type { DataService } from '../services/data.service';
import type { UnitSummary } from "./unit-summary.model";
import { type SerializedClassicForce, type SerializedForce, type SerializedGroup, type SerializedC3NetworkGroup, C3_NETWORK_GROUP_SCHEMA, C3_POSITION_SCHEMA, FORCE_NOTE_MAX_LENGTH, sanitizeForceTags } from './force-serialization';
import { applyForceUnitOwnerC3Position, type ForceUnit } from './force-unit.model';
import { GameSystem } from './common.model';
import { C3NetworkEditor } from './c3-network-editor';
import { Sanitizer } from '../utils/sanitizer.util';
import { LoggerService } from '../services/logger.service';
import { type Faction } from './factions.model';
import type { Era } from './eras.model';
import { type FormationTypeDefinition, type FormationMatch, formationNameMatchesGroupName, isNoFormation, NO_FORMATION } from '../utils/formation-type.model';
import { LanceTypeIdentifierUtil } from '../utils/lance-type-identifier.util';
import { FormationNamerUtil } from '../utils/formation-namer.util';
import type { OrgSizeResult } from '../utils/org/org-types';
import { getOrgFromForce, getOrgFromGroup } from '../utils/org/org-namer.util';
import { getUnitsAverageTechBase, TechBase } from './tech.model';
import { MULFACTION_EXTINCT } from './mulfactions.model';
import { createMulForceAvailabilityContext, type ForceAvailabilityContext } from '../utils/force-availability.util';
import { uuidv7 } from '../utils/uuid.util';
import { jsonValuesEqual } from '../utils/json-value.util';
import { C3Network } from './c3-network.model';
import {
    prepareInitialCBTForceV2,
    type PreparedCBTForcePersistenceV2,
} from './runtime/force-persistence-boundary';
import {
    type SerializedCBTEncounterStateV2,
    type SerializedCBTForceV2,
    type SerializedForceEncounterEntryV2,
} from './runtime/persistence-v2';
import {
    formationUnitTechBaseFacts,
    type FormationUnitLike,
} from '../utils/formation-unit-facts.util';
import type { ForceMember } from './force-member.model';


export const MAX_GROUPS = 50;
export const MAX_UNITS = 100;
const MAX_PERSISTENCE_PREPARATION_ATTEMPTS = 3;

interface PreparedForcePersistenceSnapshot {
    readonly serialized: SerializedForce;
    readonly identityInstalled: boolean;
}

function sameCBTEncounterPersistenceState(
    left: SerializedCBTEncounterStateV2 | undefined,
    right: SerializedCBTEncounterStateV2 | undefined,
): boolean {
    return jsonValuesEqual(left, right);
}

/** Protected transaction value; callers cannot install it without the owner CAS. */
export interface CBTForceV2AuthorityMutationContext {
    readonly metadata: SerializedForce & { readonly instanceId: string; readonly timestamp: string };
    readonly previous?: SerializedCBTForceV2;
    readonly typedEncounterState?: SerializedCBTEncounterStateV2;
    readonly expectedCBTForceV2State: SerializedCBTForceV2 | null;
    readonly expectedInstanceId: string | null;
    readonly expectedTimestamp: string | null;
    readonly expectedOwnerGeneration: number;
}

/** Detached subclass authority prepared during a V2 load. */
export interface PreparedLoadedCBTForceV2Authority {
    /** Optional one-way normalized envelope produced by an exact load converter. */
    readonly replacement?: SerializedCBTForceV2;
    /** Complete synchronous validation performed before any base pointer moves. */
    readonly canInstall: () => boolean;
    /** Synchronous, prevalidated pointer install. It must not call user code. */
    readonly install: () => void;
    /** Optional notice emitted only after the prepared owner was installed. */
    readonly afterInstall?: () => void | Promise<void>;
}

const forceOwnerRetirementTokenBrand: unique symbol = Symbol('ForceOwnerRetirementToken');
const forceOwnerAuthorityFingerprintBrand: unique symbol = Symbol('ForceOwnerAuthorityFingerprint');
const forceOwnerRevisionFenceBrand: unique symbol = Symbol('ForceOwnerRevisionFence');
const forceOwnerReplacementCommitAuthorityBrand: unique symbol = Symbol('ForceOwnerReplacementCommitAuthority');
const forcePersistenceIdentityPromotionProofBrand: unique symbol = Symbol('ForcePersistenceIdentityPromotionProof');
/** Module-private friend seam: UnitGroup cannot expose an unfenced owner write. */
const reserveUnitGroupOwnerMutation = Symbol('reserveUnitGroupOwnerMutation');
const publishReservedUnitGroupOwnerMutation = Symbol('publishReservedUnitGroupOwnerMutation');
const queryUnitGroupOwnerCapacity = Symbol('queryUnitGroupOwnerCapacity');
const pruneUnitGroupOwnerLegacyC3 = Symbol('pruneUnitGroupOwnerLegacyC3');

interface ForceOwnerAuthorityFingerprintBinding {
    readonly owner: object;
    readonly generation: number;
    readonly intentEpoch: number;
    readonly persistentWitness: string;
    readonly groups: readonly Readonly<{
        readonly group: object;
        readonly units: readonly object[];
    }>[];
    readonly subclassFence: unknown;
}

const forceOwnerAuthorityFingerprintBindings = new WeakMap<object, ForceOwnerAuthorityFingerprintBinding>();
const forceOwnerRevisionFenceBindings = new WeakMap<object, {
    readonly owner: object;
    readonly generation: number;
    readonly intentEpoch: number;
}>();
const forceOwnerReplacementCommitAuthorityBindings = new WeakMap<object, {
    readonly owner: object;
    readonly token: ForceOwnerRetirementToken;
    active: boolean;
    consumed: boolean;
}>();
const forcePersistenceIdentityPromotionProofBindings = new WeakMap<object, {
    readonly owner: object;
    readonly instanceId: string;
    readonly revisionFence: ForceOwnerRevisionFence;
    readonly identityInstalled: boolean;
}>();

/** Opaque one-owner capability; only Force can mint or retarget it. */
export interface ForceOwnerRetirementToken {
    readonly [forceOwnerRetirementTokenBrand]: true;
}

/** Opaque exact-owner witness. Its authority is held only in a private WeakMap. */
export interface ForceOwnerAuthorityFingerprint {
    readonly [forceOwnerAuthorityFingerprintBrand]: true;
}

/** Opaque O(1) owner revision fence for scheduling persistence off the UI event. */
export interface ForceOwnerRevisionFence {
    readonly [forceOwnerRevisionFenceBrand]: true;
}

/** Opaque, callback-scoped proof that an exact predecessor is retiring. */
export interface ForceOwnerReplacementCommitAuthority {
    readonly [forceOwnerReplacementCommitAuthorityBrand]: true;
}

/** Read-only proof that this exact owner operation promoted null to a Force-minted ID. */
export interface ForcePersistenceIdentityPromotionProof {
    readonly [forcePersistenceIdentityPromotionProofBrand]: true;
}

/** Synchronously closes the owner, then drains already-submitted work. */
export interface ForceOwnerRetirementHandle {
    readonly token: ForceOwnerRetirementToken;
    readonly ready: Promise<boolean>;
}

/** Snapshot plus the exact post-normalization owner authority that produced it. */
export interface ForcePersistenceRevisionSnapshotAuthority {
    readonly serialized: SerializedForce;
    readonly revisionFence: ForceOwnerRevisionFence;
    readonly identityPromotionProof: ForcePersistenceIdentityPromotionProof;
}

/** Export/replacement snapshot with the additional full persistent-graph witness. */
export interface ForcePersistenceSnapshotAuthority extends ForcePersistenceRevisionSnapshotAuthority {
    readonly authorityFingerprint: ForceOwnerAuthorityFingerprint;
}

export interface ForceC3UnitPosition {
    readonly unitId: string;
    readonly x: number;
    readonly y: number;
}

export interface ForceGroupPatch {
    readonly name?: string | null;
    readonly color?: string | null;
    readonly formation?: FormationTypeDefinition | null;
    readonly formationTargetGroupId?: string | null;
    readonly formationLock?: boolean;
}

export type CBTForceV2AuthorityMutationCommitResult =
    | { readonly kind: 'committed' }
    | { readonly kind: 'rejected'; readonly reason: 'stale' | 'install-failed' };

export interface CBTForceV2AuthorityMutationInstall {
    readonly context: CBTForceV2AuthorityMutationContext;
    readonly prepared: PreparedCBTForcePersistenceV2;
    readonly installAuthority: () => void;
    readonly rollbackAuthority: () => void;
}

function getEraEndYear(era: Era): number {
    return era.years.to ?? Number.POSITIVE_INFINITY;
}

function hasFactionEraAvailability(
    faction: Faction,
    era: Era,
    availabilityContext: ForceAvailabilityContext = createMulForceAvailabilityContext(),
): boolean {
    return availabilityContext.getFactionEraUnitIds(faction, era).size > 0;
}

export function resolveSerializedFormation(
    formationId: string | undefined,
    formationLock: boolean | undefined,
    gameSystem: GameSystem,
): FormationTypeDefinition | null {
    if (formationId) {
        return LanceTypeIdentifierUtil.getDefinitionById(formationId, gameSystem);
    }

    return formationLock ? NO_FORMATION : null;
}

export interface EraUnitValidationSummary {
    totalUnits: number;
    validUnits: number;
    invalidTrackedUnits: number;
    invalidTrackedUnitNames: string[];
    extinctTrackedUnits: number;
    extinctTrackedUnitNames: string[];
    invalidYearFallbackUnits: number;
    invalidYearFallbackUnitNames: string[];
}

function formatEraWarningUnits(unitNames: readonly string[]): string {
    return unitNames.map(unitName => `"${unitName}"`).join(', ');
}

export function buildEraWarningMessage(
    units: readonly UnitSummary[],
    era: Era | null,
    faction: Faction | null,
    eras: readonly Era[],
    extinctFaction: Faction | null,
    availabilityContext: ForceAvailabilityContext = createMulForceAvailabilityContext(),
    factionExistsInEra: (faction: Faction, era: Era) => boolean = (candidateFaction, candidateEra) => (
        hasFactionEraAvailability(candidateFaction, candidateEra, availabilityContext)
    ),
): string | null {
    if (!era) {
        return null;
    }

    const warnings: string[] = [];
    const {
        invalidTrackedUnits,
        invalidTrackedUnitNames,
        extinctTrackedUnits,
        extinctTrackedUnitNames,
        invalidYearFallbackUnits,
        invalidYearFallbackUnitNames,
    } = getEraUnitValidationSummary(units, era, eras, extinctFaction, availabilityContext);

    if (faction && !factionExistsInEra(faction, era)) {
        warnings.push(`${faction.name} does not exist in this era.`);
    }

    if (invalidTrackedUnits > 0) {
        const unitLabel = invalidTrackedUnits === 1 ? 'unit is' : 'units are';
        warnings.push(`${invalidTrackedUnits} ${unitLabel} not listed in the ${era.name} era: ${formatEraWarningUnits(invalidTrackedUnitNames)}.`);
    }

    if (extinctTrackedUnits > 0) {
        const unitLabel = extinctTrackedUnits === 1 ? 'unit is' : 'units are';
        warnings.push(`${extinctTrackedUnits} ${unitLabel} extinct in the ${era.name} era: ${formatEraWarningUnits(extinctTrackedUnitNames)}.`);
    }

    if (invalidYearFallbackUnits > 0) {
        const unitLabel = invalidYearFallbackUnits === 1 ? 'unit is' : 'units are';
        warnings.push(`${invalidYearFallbackUnits} ${unitLabel} newer than this era ends in ${era.years.to}: ${formatEraWarningUnits(invalidYearFallbackUnitNames)}.`);
    }

    return warnings.length > 0 ? warnings.join(' ') : null;
}

export function getEraUnitValidationSummary(
    units: readonly UnitSummary[],
    era: Era,
    eras: readonly Era[],
    extinctFaction: Faction | null,
    availabilityContext: ForceAvailabilityContext = createMulForceAvailabilityContext(),
): EraUnitValidationSummary {
    const eraEndYear = getEraEndYear(era);
    let invalidTrackedUnits = 0;
    const invalidTrackedUnitNames: string[] = [];
    let extinctTrackedUnits = 0;
    const extinctTrackedUnitNames: string[] = [];
    let invalidYearFallbackUnits = 0;
    const invalidYearFallbackUnitNames: string[] = [];
    const trackedUnitIds = new Set<string>();
    const selectedEraUnitIds = availabilityContext.getVisibleEraUnitIds(era);
    const extinctEraUnitIds = extinctFaction
        ? availabilityContext.getFactionEraUnitIds(extinctFaction, era)
        : new Set<string>();

    for (const candidateEra of eras) {
        for (const unitId of availabilityContext.getVisibleEraUnitIds(candidateEra)) {
            trackedUnitIds.add(unitId);
        }
    }

    for (const unit of units) {
        const displayName = unit.name;
        const unitKey = availabilityContext.getUnitKey(unit);
        const isTrackedInAnyEra = trackedUnitIds.has(unitKey);

        if (isTrackedInAnyEra) {
            const existsInSelectedEra = selectedEraUnitIds.has(unitKey);
            const isExtinctInSelectedEra = extinctEraUnitIds.has(unitKey);

            if (isExtinctInSelectedEra) {
                extinctTrackedUnits++;
                extinctTrackedUnitNames.push(displayName);
            } else if (!existsInSelectedEra) {
                invalidTrackedUnits++;
                invalidTrackedUnitNames.push(displayName);
            }
            continue;
        }

        if (unit.year > eraEndYear) {
            invalidYearFallbackUnits++;
            invalidYearFallbackUnitNames.push(displayName);
        }
    }

    const totalUnits = units.length;
    const validUnits = totalUnits - invalidTrackedUnits - extinctTrackedUnits - invalidYearFallbackUnits;

    return {
        totalUnits,
        validUnits,
        invalidTrackedUnits,
        invalidTrackedUnitNames,
        extinctTrackedUnits,
        extinctTrackedUnitNames,
        invalidYearFallbackUnits,
        invalidYearFallbackUnitNames,
    };
}

export class UnitGroup<TUnit extends ForceUnit = ForceUnit> {
    private _forceRef = signal<Force>(null!);

    /**
     * The force this group belongs to.
     * Backed by a signal so that computed properties automatically react
     * when the group is moved to a different force.
     */
    get force(): Force { return this._forceRef(); }
    set force(value: Force) { this._forceRef.set(value); }

    id: string = uuidv7();
    name = signal<string | undefined>(undefined);
    color?: string;
    formation = signal<FormationTypeDefinition | null>(null);
    formationLock?: boolean; // If true, the formation name will not be upgraded by the random generator (this is unset when we have automatic formation)
    formationTargetGroupId = signal<string | null>(null);
    formationHistory = new Set<string>(); // Temporarily stores previously assigned formation IDs for this group
    units: WritableSignal<TUnit[]> = signal([]);

    totalBV = computed(() => {
        return this.units().reduce((sum, unit) => sum + (unit.getBv()), 0);
    });

    constructor(force: Force) {
        this.force = force;
        this.id = uuidv7();
    }

    setName(name: string | undefined, emitChange: boolean = true) {
        if (this.name() === name) return;
        const intent = this.force?.[reserveUnitGroupOwnerMutation](this) ?? null;
        if (intent === null) return;
        this.name.set(name);
        if (emitChange) {
            this.force?.[publishReservedUnitGroupOwnerMutation](intent);
        }
    }

    /** Reorder a unit within this group (no-op if indices are equal or out of range). */
    reorderUnit(fromIndex: number, toIndex: number): void {
        if (fromIndex === toIndex) return;
        const units = [...this.units()];
        if (fromIndex < 0 || fromIndex >= units.length || toIndex < 0 || toIndex >= units.length) return;
        const intent = this.force[reserveUnitGroupOwnerMutation](this);
        if (intent === null) return;
        const [moved] = units.splice(fromIndex, 1);
        units.splice(toIndex, 0, moved);
        this.units.set(units);
        this.force[publishReservedUnitGroupOwnerMutation](intent);
    }

    /**
     * Move a unit from this group to another group (may be in a different force).
     * Returns the moved unit, or null if the index is out of range.
     * Automatically updates the unit's force reference to match the target group's force.
     */
    moveUnitTo(fromIndex: number, targetGroup: UnitGroup, toIndex?: number): TUnit | null {
        return this.transferUnitTo(fromIndex, targetGroup, toIndex) as TUnit | null;
    }

    /**
     * Atomically moves one exact unit, optionally replacing it with a prepared
     * cross-system candidate. Neither owner is changed unless both groups and
     * the source row are still exact and writable.
     */
    transferUnitTo(
        fromIndex: number,
        targetGroup: UnitGroup,
        toIndex?: number,
        replacement?: ForceUnit,
    ): ForceUnit | null {
        const sourceForce = this.force;
        const targetForce = targetGroup.force;
        const sourceUnits = [...this.units()];
        if (fromIndex < 0 || fromIndex >= sourceUnits.length
            || sourceForce.readOnly()
            || targetForce.readOnly()
            || !sourceForce.groups().some(candidate => candidate === this)
            || !targetForce.groups().some(candidate => candidate === targetGroup)) return null;
        const sourceUnit = sourceUnits[fromIndex];
        if (sourceUnit.force !== sourceForce) return null;
        const insertedUnit = replacement ?? sourceUnit;
        if (replacement !== undefined && replacement.force !== targetForce) return null;
        if (sourceForce !== targetForce
            && targetForce[queryUnitGroupOwnerCapacity]() >= MAX_UNITS) return null;
        if (sourceForce !== targetForce
            && targetForce.units().some(candidate => candidate.id === insertedUnit.id)) return null;
        const sourceIntent = sourceForce[reserveUnitGroupOwnerMutation](this);
        if (sourceIntent === null) return null;
        const targetIntent = sourceForce === targetForce
            ? sourceIntent
            : targetForce[reserveUnitGroupOwnerMutation](targetGroup);
        if (targetIntent === null) return null;

        sourceUnits.splice(fromIndex, 1);
        const targetUnits = this === targetGroup ? sourceUnits : [...targetGroup.units()];
        const insertAt = toIndex !== undefined
            ? Math.min(Math.max(0, toIndex), targetUnits.length)
            : targetUnits.length;
        if (insertedUnit.commander()
            && targetUnits.some(candidate => candidate.commander())) {
            insertedUnit.setFormationCommander(false, false);
        }
        insertedUnit.force = targetForce;
        targetUnits.splice(insertAt, 0, insertedUnit);
        this.units.set(sourceUnits as TUnit[]);
        if (this === targetGroup) this.units.set(targetUnits as TUnit[]);
        else targetGroup.units.set(targetUnits);
        if (sourceForce !== targetForce) sourceForce[pruneUnitGroupOwnerLegacyC3](sourceUnit.id);
        sourceForce[publishReservedUnitGroupOwnerMutation](sourceIntent);
        if (targetForce !== sourceForce) {
            targetForce[publishReservedUnitGroupOwnerMutation](targetIntent);
        }
        return insertedUnit;
    }

    /** Direct domain members used by formation and organization rules. */
    formationUnits(): readonly FormationUnitLike[] {
        return this.force.getFormationUnitsForGroup(this);
    }

    /** Structural evaluation result for this group (name + matched ForceType). */
    organizationalResult = computed<OrgSizeResult>(() => {
        const result = getOrgFromGroup(this, {
            displayOnlyTopLevel: true,
        });
        return result;
    });

    organizationalName = computed(() => {
        return this.organizationalResult().name;
    });

    activeFormation = computed<FormationTypeDefinition | null>(() => {
        const formation = this.formation();
        return !!formation && !isNoFormation(formation) ? formation : null;
    });

    groupDisplayName = computed<string>(() => {
        const name = this.name();
        if (name) return name;
        return this.formationDisplayName() ?? this.organizationalName();
    });

    isFormationAlreadyInGroupName = computed<boolean>(() => {
        const formation = this.activeFormation();
        if (!formation) return true;
        const customName = this.name();
        // No custom name means display name is derived from the formation, so it's inherently included
        if (!customName) return true;
        return formationNameMatchesGroupName(formation, customName);
    });

    formationDisplayName = computed<string | null>(() => {
        const formation = this.activeFormation();
        if (!formation) return null;
        return FormationNamerUtil.composeFormationDisplayName(
            formation,
            this,
            this.isFormationRequirementsFiltered()
        );
    });

    /**
     * Formation validation.
     * Returns the FormationMatch if the current formation is valid, or null.
     */
    private _formationMatch = computed<FormationMatch | null>(() => {
        const formation = this.activeFormation();
        if (!formation) return null;
        return LanceTypeIdentifierUtil.isFormationValidForGroup(formation, this);
    });

    hasValidFormation = computed<boolean>(() => {
        const formation = this.activeFormation();
        if (!formation) return true;
        return this._formationMatch() !== null;
    });

    /** Whether the current formation required organization-level unit filtering. */
    isFormationRequirementsFiltered = computed<boolean>(() => {
        return this._formationMatch()?.requirementsFiltered ?? false;
    });

    formationRequirementsFilterNotice = computed<string | null>(() => {
        return this._formationMatch()?.requirementsFilterNotice ?? null;
    });

    formationRequirementsFilterCompositionName = computed<string | null>(() => {
        return this._formationMatch()?.requirementsFilterCompositionName ?? null;
    });
}

export abstract class Force<TUnit extends ForceUnit = ForceUnit> {
    gameSystem: GameSystem = GameSystem.CLASSIC;
    private readonly _instanceId: WritableSignal<string | null> = signal(null);
    /** Durable owner identity is observable but can only be assigned by Force-owned transactions. */
    public readonly instanceId: Signal<string | null> = this._instanceId.asReadonly();
    _name: WritableSignal<string>;
    _note: WritableSignal<string>;
    _tags: WritableSignal<string[]>;
    timestamp: string | null = null;
    groups: WritableSignal<UnitGroup<TUnit>[]> = signal([]);
    _c3Networks: WritableSignal<SerializedC3NetworkGroup[]> = signal([]); // C3 network configurations
    loading: boolean = false;
    cloud?: boolean = false; // Indicates if this force is stored in the cloud
    private readonly _owned = signal<boolean>(true);
    /** Ownership is persistence authority, not a UI-writable field. */
    public readonly owned: Signal<boolean> = this._owned.asReadonly();
    faction = signal<Faction | null>(null);
    factionLock: boolean = false; // If true, the force faction cannot be changed by the random generator
    era = signal<Era | null>(null);
    eraLock: boolean = false; // If true, the force era cannot be changed by the random generator
    c3Networks = this._c3Networks.asReadonly();
    /**
     * Emits synchronously after each accepted mutation. `null` means the whole
     * force may have changed; otherwise only the listed runtime units changed.
     */
    public readonly changed = new Subject<readonly string[] | null>();
    private readonly memberRevision = signal(0);
    /** One owner tail for V2 loads, saves, admissions, and retained-runtime mutations. */
    private persistencePreparation: Promise<void> = Promise.resolve();
    /** Nonzero while one queued owner operation is executing across its awaits. */
    private forceOwnerOperationDepth = 0;
    /** Advances only when force-owned authority actually changes. */
    private forceOwnerGeneration = 0;
    /** Synchronous local-write intent invalidates older in-flight remote loads. */
    private forceLocalMutationIntentEpoch = 0;
    /** Routes a pre-reserved commit through the public/override emission seam once. */
    private reservedIntentEmissionDepth = 0;
    /** Whole-owner replacement closes submission before draining the owner tail. */
    private readonly forceOwnerLifecycle = signal<'active' | 'retirement-pending' | 'retired'>('active');
    private pendingForceOwnerRetirement: {
        readonly token: ForceOwnerRetirementToken;
        readonly generation: number;
        readonly intentEpoch: number;
        readonly entryFingerprint: ForceOwnerAuthorityFingerprint;
        readonly settled: Promise<'active' | 'retired'>;
        readonly settle: (state: 'active' | 'retired') => void;
        drained: boolean;
    } | null = null;
    private expectedCloudCBTForceV2Revision: number | null | undefined = undefined;
    /** Force-minted provisional identity retained until the owner is replaced/rekeyed. */
    private persistenceIdentityPromotionInstanceId: string | null = null;
    protected dataService: DataService;
    protected injector: Injector;

    constructor(name: string,
        dataService: DataService,
        injector: Injector) {
        this._name = signal(name);
        this._note = signal('');
        this._tags = signal([]);
        this.dataService = dataService;
        this.injector = injector;
    }

    readOnly = computed<boolean>(() => {
        return this.forceOwnerLifecycle() === 'retired'
            || !this.owned();
    });

    /** True only while this exact object may accept a newly submitted owner write. */
    public isWholeOwnerActive(): boolean {
        return this.forceOwnerLifecycle() === 'active';
    }

    public isWholeOwnerRetired(): boolean {
        return this.forceOwnerLifecycle() === 'retired';
    }

    /**
     * Closes submission synchronously and drains all previously submitted
     * owner work. The returned token is one-owner and one-shot.
     */
    public beginWholeOwnerRetirement(): ForceOwnerRetirementHandle | null {
        if (this.forceOwnerLifecycle() !== 'active') return null;
        const token = Object.freeze({
            [forceOwnerRetirementTokenBrand]: true,
        }) as ForceOwnerRetirementToken;
        const entryFingerprint = this.captureWholeOwnerAuthorityFingerprint();
        let settle!: (state: 'active' | 'retired') => void;
        const settled = new Promise<'active' | 'retired'>(resolve => { settle = resolve; });
        const pending = {
            token,
            generation: this.forceOwnerGeneration,
            intentEpoch: this.forceLocalMutationIntentEpoch,
            entryFingerprint,
            settled,
            settle,
            drained: false,
        };
        this.pendingForceOwnerRetirement = pending;
        this.forceOwnerLifecycle.set('retirement-pending');
        const ready = this.enqueueCBTForceV2AuthorityMutation(() => {
            const current = this.forceOwnerLifecycle() === 'retirement-pending'
                && this.pendingForceOwnerRetirement === pending
                && this.forceOwnerGeneration === pending.generation
                && this.forceLocalMutationIntentEpoch === pending.intentEpoch
                && this.isWholeOwnerAuthorityFingerprintCurrent(pending.entryFingerprint);
            if (!current) return false;
            pending.drained = true;
            return true;
        });
        return Object.freeze({ token, ready });
    }

    /**
     * Permanently retires this exact owner after its tail has drained. The
     * preparation callback may consume predecessor-bound capabilities, but it
     * must not publish anything: it returns the no-throw finalizer that runs
     * only after the predecessor has been rechecked and retired.
     */
    public commitWholeOwnerRetirement(
        token: ForceOwnerRetirementToken,
        prepareReplacement: (
            authority: ForceOwnerReplacementCommitAuthority,
        ) => (() => void) | null,
    ): boolean {
        return Force.commitWholeOwnerRetirements(
            Object.freeze([{ force: this, token }]),
            authorities => prepareReplacement(authorities[0]),
        );
    }

    /**
     * Batch form used when one slot publication replaces/removes several live
     * owners. Every predecessor is prepared and rechecked before any one of
     * them becomes irreversibly retired; the finalizer observes all retired.
     */
    public static commitWholeOwnerRetirements(
        retirements: readonly Readonly<{
            readonly force: Force;
            readonly token: ForceOwnerRetirementToken;
        }>[],
        prepareReplacement: (
            authorities: readonly ForceOwnerReplacementCommitAuthority[],
        ) => (() => void) | null,
    ): boolean {
        if (retirements.length === 0) return false;
        const owners = new Set<Force>();
        const prepared: Array<Readonly<{
            force: Force;
            token: ForceOwnerRetirementToken;
            pending: NonNullable<Force['pendingForceOwnerRetirement']>;
        }>> = [];
        for (const retirement of retirements) {
            if (owners.has(retirement.force)) return false;
            owners.add(retirement.force);
            const pending = retirement.force.pendingForceOwnerRetirement;
            if (!pending
                || pending.token !== retirement.token
                || retirement.force.forceOwnerLifecycle() !== 'retirement-pending'
                || !pending.drained
                || retirement.force.forceOwnerGeneration !== pending.generation
                || retirement.force.forceLocalMutationIntentEpoch !== pending.intentEpoch
                || !retirement.force.isWholeOwnerAuthorityFingerprintCurrent(pending.entryFingerprint)) return false;
            prepared.push({
                force: retirement.force,
                token: retirement.token,
                pending,
            });
        }

        const authorities: ForceOwnerReplacementCommitAuthority[] = [];
        const authorityBindings: Array<{
            readonly owner: object;
            readonly token: ForceOwnerRetirementToken;
            active: boolean;
            consumed: boolean;
        }> = [];
        for (const entry of prepared) {
            const authority = Object.freeze({
                [forceOwnerReplacementCommitAuthorityBrand]: true,
            }) as ForceOwnerReplacementCommitAuthority;
            const authorityBinding = {
                owner: entry.force,
                token: entry.token,
                active: true,
                consumed: false,
            };
            forceOwnerReplacementCommitAuthorityBindings.set(authority, authorityBinding);
            authorities.push(authority);
            authorityBindings.push(authorityBinding);
        }

        let finalizeReplacement: (() => void) | null;
        try {
            finalizeReplacement = prepareReplacement(Object.freeze(authorities));
            if (finalizeReplacement === null) return false;
        } catch {
            return false;
        } finally {
            for (const binding of authorityBindings) binding.active = false;
        }
        // Every predecessor must be claimed by a coordinator-owned participant
        // (Data replacement/removal, or another exact owner authority). A caller
        // returning an arbitrary no-op finalizer cannot retire a published owner.
        if (authorityBindings.some(binding => !binding.consumed)) return false;

        for (const entry of prepared) {
            const { force, pending } = entry;
            if (force.pendingForceOwnerRetirement !== pending
                || force.forceOwnerLifecycle() !== 'retirement-pending'
                || !pending.drained
                || force.forceOwnerGeneration !== pending.generation
                || force.forceLocalMutationIntentEpoch !== pending.intentEpoch
                || !force.isWholeOwnerAuthorityFingerprintCurrent(pending.entryFingerprint)) return false;
        }
        for (const entry of prepared) {
            const { force, pending } = entry;
            force.pendingForceOwnerRetirement = null;
            force.forceOwnerLifecycle.set('retired');
            force.advanceForceOwnerGeneration();
            pending.settle('retired');
        }
        // This closure is deliberately invoked only after every predecessor is
        // retired. It is an internal, prevalidated, synchronous no-throw commit.
        finalizeReplacement();
        return true;
    }

    /**
     * Claims a one-shot replacement proof while this exact retirement callback
     * is executing. Data authority cannot be replaced by a detached candidate
     * through a trivial caller callback that did not drain its predecessor.
     */
    public consumeWholeOwnerReplacementCommitAuthority(
        authority: ForceOwnerReplacementCommitAuthority,
    ): boolean {
        const binding = forceOwnerReplacementCommitAuthorityBindings.get(authority);
        const pending = this.pendingForceOwnerRetirement;
        if (!binding
            || binding.owner !== this
            || !binding.active
            || binding.consumed
            || !pending
            || pending.token !== binding.token
            || this.forceOwnerLifecycle() !== 'retirement-pending'
            || !pending.drained
            || this.forceOwnerGeneration !== pending.generation
            || this.forceLocalMutationIntentEpoch !== pending.intentEpoch
            || !this.isWholeOwnerAuthorityFingerprintCurrent(pending.entryFingerprint)) return false;
        binding.consumed = true;
        return true;
    }

    /** Reopens only the exact still-pending owner; committed retirement is permanent. */
    public cancelWholeOwnerRetirement(token: ForceOwnerRetirementToken): void {
        const pending = this.pendingForceOwnerRetirement;
        if (!pending
            || pending.token !== token
            || this.forceOwnerLifecycle() !== 'retirement-pending') return;
        this.pendingForceOwnerRetirement = null;
        this.forceOwnerLifecycle.set('active');
        pending.settle('active');
    }

    /** Captures the exact persistent graph plus subclass-owned runtime authority. */
    public captureWholeOwnerAuthorityFingerprint(): ForceOwnerAuthorityFingerprint {
        const fingerprint = Object.freeze({
            [forceOwnerAuthorityFingerprintBrand]: true,
        }) as ForceOwnerAuthorityFingerprint;
        forceOwnerAuthorityFingerprintBindings.set(fingerprint, {
            owner: this,
            generation: this.forceOwnerGeneration,
            intentEpoch: this.forceLocalMutationIntentEpoch,
            persistentWitness: this.wholeOwnerPersistentAuthoritySnapshotJson(),
            groups: Object.freeze(this.groups().map(group => Object.freeze({
                group,
                units: Object.freeze([...group.units()]),
            }))),
            subclassFence: this.captureWholeOwnerSubclassAuthorityFence(),
        });
        return fingerprint;
    }

    /**
     * Captures only the monotonic owner revision. Unlike the exact export/
     * replacement fingerprint this never serializes the force graph, so an
     * autosave can be admitted without blocking the click that caused it.
     */
    public captureForceOwnerRevisionFence(): ForceOwnerRevisionFence {
        const fence = Object.freeze({
            [forceOwnerRevisionFenceBrand]: true,
        }) as ForceOwnerRevisionFence;
        forceOwnerRevisionFenceBindings.set(fence, {
            owner: this,
            generation: this.forceOwnerGeneration,
            intentEpoch: this.forceLocalMutationIntentEpoch,
        });
        return fence;
    }

    public isForceOwnerRevisionFenceCurrent(fence: ForceOwnerRevisionFence): boolean {
        const binding = forceOwnerRevisionFenceBindings.get(fence);
        return !!binding
            && binding.owner === this
            && this.forceOwnerLifecycle() === 'active'
            && binding.generation === this.forceOwnerGeneration
            && binding.intentEpoch === this.forceLocalMutationIntentEpoch;
    }

    /** Verifies an opaque fingerprint without exposing its graph/runtime data. */
    public isWholeOwnerAuthorityFingerprintCurrent(
        fingerprint: ForceOwnerAuthorityFingerprint,
    ): boolean {
        const binding = forceOwnerAuthorityFingerprintBindings.get(fingerprint);
        if (!binding
            || binding.owner !== this
            || this.forceOwnerLifecycle() === 'retired'
            || binding.generation !== this.forceOwnerGeneration
            || binding.intentEpoch !== this.forceLocalMutationIntentEpoch
            || binding.persistentWitness !== this.wholeOwnerPersistentAuthoritySnapshotJson()) return false;
        const groups = this.groups();
        if (groups.length !== binding.groups.length) return false;
        for (let index = 0; index < groups.length; index += 1) {
            const currentGroup = groups[index];
            const expected = binding.groups[index];
            if (currentGroup !== expected.group || currentGroup.force !== this) return false;
            const units = currentGroup.units();
            if (units.length !== expected.units.length) return false;
            for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
                if (units[unitIndex] !== expected.units[unitIndex]
                    || units[unitIndex].force !== this) return false;
            }
        }
        return this.isWholeOwnerSubclassAuthorityFenceCurrent(binding.subclassFence);
    }

    /** Comparable JSON snapshot for detached/live same-timestamp conflict checks. */
    public getWholeOwnerPersistentAuthoritySnapshotJson(): string {
        return this.wholeOwnerPersistentAuthoritySnapshotJson(false);
    }

    private wholeOwnerPersistentAuthoritySnapshotJson(includeCloudFence = true): string {
        // Keep unassigned owners deterministic; serialize() intentionally mints
        // a new identity/timestamp and therefore cannot be used as a witness.
        const forceId = this.instanceId();
        const timestamp = this.timestamp;
        const witnessForceId = forceId ?? 'force:unassigned-owner-witness';
        const witnessTimestamp = timestamp ?? '1970-01-01T00:00:00.000Z';
        const cbt = this.getSupportedCBTForceV2Envelope();
        const serialized = this.gameSystem === GameSystem.CLASSIC
            && cbt !== null
            ? this.buildCBTForcePersistenceRecord(
                this.buildCBTForceMetadataRecord(witnessForceId, witnessTimestamp),
                cbt,
            )
            : this.buildGroupedForcePersistenceRecord(witnessForceId, witnessTimestamp);
        return JSON.stringify({
            forceId,
            timestamp,
            owned: this.owned(),
            serialized,
            typedEncounter: this.getCBTEncounterStateForPersistence() ?? null,
            ...(includeCloudFence
                ? { expectedCloudCBTForceV2Revision: this.expectedCloudCBTForceV2Revision ?? null }
                : {}),
        });
    }

    /** Subclasses bind exact live runtime objects/revisions without exposing them. */
    protected captureWholeOwnerSubclassAuthorityFence(): unknown {
        return null;
    }

    protected isWholeOwnerSubclassAuthorityFenceCurrent(fence: unknown): boolean {
        return fence === null;
    }

    public hasCBTForceV2(): boolean {
        return this.getSupportedCBTForceV2Envelope() !== null;
    }

    public getCBTForceV2Revision(): number | undefined {
        return this.getSupportedCBTForceV2Envelope()?.forceRevision;
    }

    /** Subclasses expose their single installed Classic authority here. */
    protected getSupportedCBTForceV2Envelope(): SerializedCBTForceV2 | null {
        return null;
    }

    /** undefined = cloud state was never observed; null = cloud is known to have no V2 envelope. */
    public getExpectedCloudCBTForceV2Revision(): number | null | undefined {
        return this.expectedCloudCBTForceV2Revision;
    }

    /**
     * Proves that this exact paired serialization, rather than a caller writing
     * the public identity signal, promoted a provisional null-ID owner. This is
     * deliberately observational: local durability remains Data-private and can
     * only be recorded after its awaited storage write succeeds.
     */
    public isPersistenceIdentityPromotion(proof: ForcePersistenceIdentityPromotionProof): boolean {
        const binding = forcePersistenceIdentityPromotionProofBindings.get(proof);
        if (!binding
            || binding.owner !== this
            || !binding.identityInstalled
            || this.instanceId() !== binding.instanceId
            || !this.isForceOwnerRevisionFenceCurrent(binding.revisionFence)) return false;
        return true;
    }

    public setExpectedCloudCBTForceV2Revision(revision: number | null | undefined): void {
        this.expectedCloudCBTForceV2Revision = revision;
    }

    /** Serializes whole-owner authority changes against the normal V2 save queue. */
    protected enqueueCBTForceV2AuthorityMutation<T>(operation: () => T | Promise<T>): Promise<T> {
        const execute = async (): Promise<T> => {
            this.forceOwnerOperationDepth += 1;
            try {
                return await operation();
            } finally {
                this.forceOwnerOperationDepth -= 1;
            }
        };
        const queued = this.persistencePreparation.then(execute, execute);
        this.persistencePreparation = queued.then(() => undefined, () => undefined);
        return queued;
    }

    protected captureForceOwnerGeneration(): number {
        return this.forceOwnerGeneration;
    }

    protected isForceOwnerGenerationCurrent(generation: number): boolean {
        return this.forceOwnerGeneration === generation;
    }

    protected advanceForceOwnerGeneration(): void {
        this.forceOwnerGeneration += 1;
    }

    protected reserveForceOwnerMutationIntent(): number {
        if (this.forceOwnerLifecycle() === 'retired') {
            return this.forceLocalMutationIntentEpoch;
        }
        this.forceLocalMutationIntentEpoch += 1;
        return this.forceLocalMutationIntentEpoch;
    }

    /** Module-private UnitGroup authority gate; the symbol is not exported. */
    public [reserveUnitGroupOwnerMutation](group: UnitGroup): number | null {
        if (this.loading) return this.forceLocalMutationIntentEpoch;
        if (this.readOnly()
            || (this.gameSystem === GameSystem.CLASSIC && this.hasCBTForceV2())
            || group.force !== this
            || !this.groups().some(candidate => candidate === group)) return null;
        return this.reserveForceOwnerMutationIntent();
    }

    /** Publishes a UnitGroup mutation that already reserved the exact owner. */
    public [publishReservedUnitGroupOwnerMutation](intent: number): void {
        if (this.loading) return;
        if (!this.isForceOwnerMutationIntentCurrent(intent) || this.readOnly()) return;
        this.emitChangedFromReservedIntent();
    }

    /** Module-private structural capacity query for atomic group transfers. */
    public [queryUnitGroupOwnerCapacity](): number {
        return this.ownedMemberCountForCapacity();
    }

    /** Module-private C3 cleanup; callers already hold both owner intents. */
    public [pruneUnitGroupOwnerLegacyC3](instanceId: string): void {
        this.removeUnitFromLegacyC3Networks(instanceId);
    }

    protected isForceOwnerMutationIntentCurrent(epoch: number): boolean {
        return this.forceLocalMutationIntentEpoch === epoch;
    }

    /**
     * Commits a mutation whose public entrypoint already reserved local intent.
     * Keeping this separate from emitChanged() preserves call-order semantics:
     * a later load observes the reserved intent and is not invalidated again by
     * the eventual successful commit.
     */
    protected emitChangedFromReservedIntent(changedUnitIds: readonly string[] | null = null): void {
        this.reservedIntentEmissionDepth += 1;
        try {
            this.emitChanged(changedUnitIds);
        } finally {
            this.reservedIntentEmissionDepth -= 1;
        }
    }

    /** Captures the exact V2 owner before an asynchronous mutation is prepared. */
    protected prepareCBTForceV2AuthorityMutation(): CBTForceV2AuthorityMutationContext {
        if (this.gameSystem !== GameSystem.CLASSIC) {
            throw new Error('CBT V2 authority can only be installed in a Classic force');
        }
        if (this.readOnly()) {
            throw new Error(`Force "${this.name}" is read-only`);
        }
        const forceId = this.instanceId() ?? uuidv7();
        const timestamp = this.timestamp ?? new Date().toISOString();
        const authority = this.getSupportedCBTForceV2Envelope();
        return Object.freeze({
            metadata: this.buildCBTForceMetadataRecord(forceId, timestamp),
            ...(authority === null
                ? {}
                : { previous: authority }),
            typedEncounterState: this.getCBTEncounterStateForPersistence(),
            expectedCBTForceV2State: authority,
            expectedInstanceId: this.instanceId(),
            expectedTimestamp: this.timestamp,
            expectedOwnerGeneration: this.forceOwnerGeneration,
        });
    }

    /**
     * Synchronous CAS for a previously sealed envelope and a non-throwing
     * authority install. It rejects any intervening owner, encounter, or
     * runtime change without moving the V2 pointer.
     */
    protected commitCBTForceV2AuthorityMutation(
        context: CBTForceV2AuthorityMutationContext,
        prepared: PreparedCBTForcePersistenceV2,
        installAuthority: () => void,
        rollbackAuthority: () => void,
    ): CBTForceV2AuthorityMutationCommitResult {
        if (!this.isCBTForceV2AuthorityMutationCurrent(context, prepared)) {
            return Object.freeze({ kind: 'rejected', reason: 'stale' });
        }

        try {
            // The sealed writer may advance the encounter revision when a
            // legacy witness changes. Install that exact typed authority in
            // the same CAS so the next save cannot observe an older runtime.
            this.restoreCBTEncounterPersistence(prepared.envelope.encounter);
            installAuthority();
            if (this.getSupportedCBTForceV2Envelope() !== prepared.envelope) {
                throw new Error('Classic authority install did not publish its prepared envelope');
            }
        } catch {
            let rollbackSucceeded = true;
            try {
                rollbackAuthority();
                if (context.typedEncounterState) {
                    this.restoreCBTEncounterPersistence({
                        encounterRevision: context.typedEncounterState.encounterRevision,
                        state: context.typedEncounterState,
                    });
                }
            } catch {
                // Rollback functions are sealed, synchronous owner-pointer restores.
                // A second fault cannot authorize publishing any of the new pointers.
                rollbackSucceeded = false;
            }
            if (!rollbackSucceeded) {
                this.reserveForceOwnerMutationIntent();
                this.advanceForceOwnerGeneration();
            }
            return Object.freeze({ kind: 'rejected', reason: 'install-failed' });
        }
        // The install/rollback pair is synchronous and sealed. Reserve mutation
        // authority only after the install succeeds so an exact rollback remains
        // a true no-op and cannot invalidate an older queued load.
        this.reserveForceOwnerMutationIntent();
        this._instanceId.set(context.metadata.instanceId);
        this.timestamp = context.metadata.timestamp;
        return Object.freeze({ kind: 'committed' });
    }

    /** Installs two prevalidated force-owner changes together or leaves both untouched. */
    protected commitPairedCBTForceV2AuthorityMutations(
        other: Force,
        own: CBTForceV2AuthorityMutationInstall,
        peer: CBTForceV2AuthorityMutationInstall,
    ): CBTForceV2AuthorityMutationCommitResult {
        if (other === this
            || !this.isCBTForceV2AuthorityMutationCurrent(own.context, own.prepared)
            || !other.isCBTForceV2AuthorityMutationCurrent(peer.context, peer.prepared)) {
            return Object.freeze({ kind: 'rejected', reason: 'stale' });
        }

        try {
            this.restoreCBTEncounterPersistence(own.prepared.envelope.encounter);
            other.restoreCBTEncounterPersistence(peer.prepared.envelope.encounter);
            own.installAuthority();
            peer.installAuthority();
            if (this.getSupportedCBTForceV2Envelope() !== own.prepared.envelope
                || other.getSupportedCBTForceV2Envelope() !== peer.prepared.envelope) {
                throw new Error('Paired Classic authority install did not publish both prepared envelopes');
            }
        } catch {
            let rollbackSucceeded = true;
            try {
                peer.rollbackAuthority();
                own.rollbackAuthority();
                if (own.context.typedEncounterState) {
                    this.restoreCBTEncounterPersistence({
                        encounterRevision: own.context.typedEncounterState.encounterRevision,
                        state: own.context.typedEncounterState,
                    });
                }
                if (peer.context.typedEncounterState) {
                    other.restoreCBTEncounterPersistence({
                        encounterRevision: peer.context.typedEncounterState.encounterRevision,
                        state: peer.context.typedEncounterState,
                    });
                }
            } catch {
                rollbackSucceeded = false;
            }
            if (!rollbackSucceeded) {
                this.reserveForceOwnerMutationIntent();
                other.reserveForceOwnerMutationIntent();
                this.advanceForceOwnerGeneration();
                other.advanceForceOwnerGeneration();
            }
            return Object.freeze({ kind: 'rejected', reason: 'install-failed' });
        }

        this.reserveForceOwnerMutationIntent();
        other.reserveForceOwnerMutationIntent();
        this._instanceId.set(own.context.metadata.instanceId);
        this.timestamp = own.context.metadata.timestamp;
        other._instanceId.set(peer.context.metadata.instanceId);
        other.timestamp = peer.context.metadata.timestamp;
        return Object.freeze({ kind: 'committed' });
    }

    private isCBTForceV2AuthorityMutationCurrent(
        context: CBTForceV2AuthorityMutationContext,
        prepared: PreparedCBTForcePersistenceV2,
    ): boolean {
        return !this.readOnly()
            && this.forceOwnerGeneration === context.expectedOwnerGeneration
            && this.instanceId() === context.expectedInstanceId
            && this.timestamp === context.expectedTimestamp
            && this.getSupportedCBTForceV2Envelope() === context.expectedCBTForceV2State
            && prepared.envelope.forceId === context.metadata.instanceId
            && sameCBTEncounterPersistenceState(
                context.typedEncounterState,
                this.getCBTEncounterStateForPersistence(),
            );
    }

    public markCloudCBTForceV2Saved(serialized: SerializedForce): void {
        if (this.gameSystem !== GameSystem.CLASSIC) return;
        if (serialized.cbt === undefined) {
            this.expectedCloudCBTForceV2Revision = null;
            return;
        }
        const revision = serialized.cbt.forceRevision;
        if (Number.isSafeInteger(revision) && revision >= 0) {
            this.expectedCloudCBTForceV2Revision = revision;
        }
    }

    /**
     * Async validation is mandatory before a CBT payload may be edited. A mixed
     * envelope remains available for export/display, but is read-only until a
     * real V2 runtime owns every V2 entry.
     */
    public loadCBTForceV2Persistence(data: SerializedForce): Promise<boolean> {
        if (!this.isWholeOwnerActive()) return Promise.resolve(false);
        let captured: SerializedForce;
        try {
            captured = structuredClone(data);
        } catch (error) {
            return Promise.reject(error);
        }
        const submittedIntentEpoch = this.forceLocalMutationIntentEpoch;
        return this.enqueueCBTForceV2AuthorityMutation(() => this.loadCBTForceV2PersistenceNow(
            captured,
            submittedIntentEpoch,
        ));
    }

    private async loadCBTForceV2PersistenceNow(
        data: SerializedForce,
        submittedIntentEpoch: number,
    ): Promise<boolean> {
        if (this.gameSystem !== GameSystem.CLASSIC) return true;
        if (!this.isForceOwnerMutationIntentCurrent(submittedIntentEpoch)) return false;
        const submittedGeneration = this.forceOwnerGeneration;
        const submittedV2State = this.getSupportedCBTForceV2Envelope();
        const submittedForceId = this.instanceId();
        const result = data.cbt ?? null;
        const ownerIsCurrent = (): boolean => this.isForceOwnerGenerationCurrent(submittedGeneration)
            && this.isForceOwnerMutationIntentCurrent(submittedIntentEpoch)
            && this.getSupportedCBTForceV2Envelope() === submittedV2State
            && this.instanceId() === submittedForceId;
        if (!ownerIsCurrent()) return false;
        if (result === null) {
            const clearedAuthority = this.clearLoadedCBTForceV2Authority();
            const changed = submittedV2State !== null || clearedAuthority;
            if (this.getSupportedCBTForceV2Envelope() !== null) {
                throw new Error('Classic authority clear left a persistence envelope installed');
            }
            if (changed) this.advanceForceOwnerGeneration();
            return true;
        }
        if (submittedForceId === null || result.forceId !== submittedForceId) return false;
        const preparedAuthority = await this.prepareLoadedCBTForceV2Authority(result);
        if (!ownerIsCurrent() || !preparedAuthority.canInstall()) return false;
        const installedEnvelope = preparedAuthority.replacement ?? result;
        if (installedEnvelope.forceId !== submittedForceId) return false;
        this.restoreCBTEncounterPersistence(installedEnvelope.encounter);
        preparedAuthority.install();
        if (this.getSupportedCBTForceV2Envelope() !== installedEnvelope) {
            throw new Error('Classic authority load did not publish its validated envelope');
        }
        this.reconcileCBTForceV2Projection();
        this.advanceForceOwnerGeneration();
        await preparedAuthority.afterInstall?.();
        return true;
    }

    /** The only writer for a complete persisted force snapshot. */
    public serializeForPersistence(): Promise<SerializedForce> {
        return this.serializeForPersistenceWithRevisionFence()
            .then(result => result.serialized);
    }

    /**
     * Local persistence needs only the O(1) post-normalization owner fence. It
     * deliberately avoids rebuilding and hashing the complete force a second
     * time after the canonical payload has already been prepared.
     */
    public serializeForPersistenceWithRevisionFence(): Promise<ForcePersistenceRevisionSnapshotAuthority> {
        return this.serializePersistenceSnapshot(false) as Promise<ForcePersistenceRevisionSnapshotAuthority>;
    }

    /**
     * Data persistence uses this paired result because a legitimate first CBT
     * serialization may install its initial V2 owner. The opaque
     * fence is captured in the same owner-tail operation after that controlled
     * normalization, with no opportunity to fold in a later caller mutation.
     */
    public serializeForPersistenceWithAuthorityFence(): Promise<ForcePersistenceSnapshotAuthority> {
        return this.serializePersistenceSnapshot(true) as Promise<ForcePersistenceSnapshotAuthority>;
    }

    private serializePersistenceSnapshot(
        includeAuthorityFingerprint: boolean,
    ): Promise<ForcePersistenceRevisionSnapshotAuthority | ForcePersistenceSnapshotAuthority> {
        if (this.forceOwnerLifecycle() === 'retired') {
            return Promise.reject(new Error(`Force "${this.name}" is being replaced and cannot be persisted`));
        }
        const pendingRetirement = this.forceOwnerLifecycle() === 'retirement-pending'
            ? this.pendingForceOwnerRetirement
            : null;
        if (pendingRetirement
            && this.forceOwnerGeneration === pendingRetirement.generation
            && this.forceLocalMutationIntentEpoch === pendingRetirement.intentEpoch
            && this.isWholeOwnerAuthorityFingerprintCurrent(pendingRetirement.entryFingerprint)) {
            // A new save cannot become work that the already-drained retirement
            // must await: that would form a settlement/drain cycle. Conversely,
            // a local edit made after begin invalidates this exact witness; its
            // autosave may wait for the losing retirement to be cancelled.
            return Promise.reject(new Error(`Force "${this.name}" is being replaced and cannot accept a new persistence request`));
        }
        const pendingSettlement = pendingRetirement?.settled;
        return this.enqueueCBTForceV2AuthorityMutation(async () => {
            if (pendingSettlement) await pendingSettlement;
            if (this.readOnly()) {
                throw new Error(`Force "${this.name}" is read-only and cannot be persisted`);
            }
            let serialized: SerializedForce;
            let identityInstalled = false;
            if (this.gameSystem !== GameSystem.CLASSIC) {
                const forceId = this.instanceId() ?? uuidv7();
                const timestamp = this.timestamp ?? new Date().toISOString();
                identityInstalled = this.instanceId() === null;
                const authorityChanged = this.instanceId() !== forceId
                    || this.timestamp !== timestamp;
                this._instanceId.set(forceId);
                if (identityInstalled) this.persistenceIdentityPromotionInstanceId = forceId;
                this.timestamp = timestamp;
                if (authorityChanged) this.advanceForceOwnerGeneration();
                serialized = this.buildGroupedForcePersistenceRecord(forceId, timestamp);
            } else {
                const forceId = this.instanceId() ?? uuidv7();
                const timestamp = this.timestamp ?? new Date().toISOString();
                const metadata = this.buildCBTForceMetadataRecord(forceId, timestamp);
                const prepared = await this.preparePersistenceSnapshot(metadata);
                serialized = prepared.serialized;
                identityInstalled = prepared.identityInstalled;
                if (identityInstalled) {
                    this.persistenceIdentityPromotionInstanceId = serialized.instanceId;
                }
            }
            const revisionFence = this.captureForceOwnerRevisionFence();
            const identityPromotionProof = Object.freeze({
                [forcePersistenceIdentityPromotionProofBrand]: true,
            }) as ForcePersistenceIdentityPromotionProof;
            forcePersistenceIdentityPromotionProofBindings.set(identityPromotionProof, {
                owner: this,
                instanceId: serialized.instanceId,
                revisionFence,
                identityInstalled: this.persistenceIdentityPromotionInstanceId === serialized.instanceId,
            });
            const lightweight = Object.freeze({ serialized, revisionFence, identityPromotionProof });
            if (!includeAuthorityFingerprint) return lightweight;
            const authorityFingerprint = this.captureWholeOwnerAuthorityFingerprint();
            return Object.freeze({ ...lightweight, authorityFingerprint });
        });
    }

    private async preparePersistenceSnapshot(
        metadata: SerializedForce & { readonly instanceId: string; readonly timestamp: string },
    ): Promise<PreparedForcePersistenceSnapshot> {
        let candidateMetadata = metadata;
        for (let attempt = 0; attempt < MAX_PERSISTENCE_PREPARATION_ATTEMPTS; attempt += 1) {
            if (this.readOnly()) {
                throw new Error(`Force "${this.name}" is read-only and cannot be persisted`);
            }
            const expectedV2State = this.getSupportedCBTForceV2Envelope();
            const expectedOwnerGeneration = this.forceOwnerGeneration;
            const expectedInstanceId = this.instanceId();
            const expectedTimestamp = this.timestamp;
            const attemptForceId = expectedInstanceId ?? candidateMetadata.instanceId;
            const attemptTimestamp = expectedTimestamp ?? candidateMetadata.timestamp;
            if (candidateMetadata.instanceId !== attemptForceId
                || candidateMetadata.timestamp !== attemptTimestamp) {
                candidateMetadata = this.buildCBTForceMetadataRecord(attemptForceId, attemptTimestamp);
            }
            const previous = expectedV2State ?? undefined;
            const typedEncounterState = this.getCBTEncounterStateForPersistence();
            const prepared = await this.prepareCBTForcePersistenceV2({
                forceId: candidateMetadata.instanceId,
                previous,
                typedEncounterState,
            });
            const currentMetadata = this.buildCBTForceMetadataRecord(
                candidateMetadata.instanceId,
                candidateMetadata.timestamp,
            );
            const ownerIsCurrent = !this.readOnly()
                && this.forceOwnerGeneration === expectedOwnerGeneration
                && this.getSupportedCBTForceV2Envelope() === expectedV2State
                && this.instanceId() === expectedInstanceId
                && this.timestamp === expectedTimestamp
                && jsonValuesEqual(candidateMetadata, currentMetadata)
                && sameCBTEncounterPersistenceState(
                    typedEncounterState,
                    this.getCBTEncounterStateForPersistence(),
                )
                && this.isPreparedCBTForcePersistenceCurrent(prepared);
            if (!ownerIsCurrent) {
                const retryForceId = this.instanceId() ?? candidateMetadata.instanceId;
                const retryTimestamp = this.timestamp ?? candidateMetadata.timestamp;
                candidateMetadata = this.buildCBTForceMetadataRecord(retryForceId, retryTimestamp);
                continue;
            }

            // The concrete Classic owner installs its prepared envelope and
            // live runtimes together after all persistence inputs win the CAS.
            const preparedAlreadyInstalled = expectedV2State !== null && prepared.reused;
            if (!preparedAlreadyInstalled) {
                this.commitPreparedCBTForcePersistenceV2(prepared);
                if (this.getSupportedCBTForceV2Envelope() !== prepared.envelope) {
                    throw new Error('Classic persistence commit did not publish its prepared envelope');
                }
                this._instanceId.set(candidateMetadata.instanceId);
                this.timestamp = candidateMetadata.timestamp;
                this.restoreCBTEncounterPersistence(prepared.envelope.encounter);
                this.reconcileCBTForceV2Projection();
                this.advanceForceOwnerGeneration();
            }
            return Object.freeze({
                serialized: this.buildCBTForcePersistenceRecord(candidateMetadata, prepared.envelope),
                identityInstalled: !preparedAlreadyInstalled && expectedInstanceId === null,
            });
        }
        throw new Error('Force authority changed while persistence was being prepared');
    }

    /** Subclasses may stage complete non-legacy authority before mixed writes are enabled. */
    protected async prepareLoadedCBTForceV2Authority(
        envelope: import('./runtime/persistence-v2').SerializedCBTForceV2,
    ): Promise<PreparedLoadedCBTForceV2Authority> {
        return Object.freeze({
            canInstall: () => true,
            install: () => undefined,
        });
    }

    /** Clears subclass-owned authority when a winning load contains no usable V2 envelope. */
    protected clearLoadedCBTForceV2Authority(): boolean {
        return false;
    }

    /** Storage writer seam; the base implementation is intentionally all-legacy only. */
    protected prepareCBTForcePersistenceV2(input: {
        readonly forceId: string;
        readonly previous?: import('./runtime/persistence-v2').SerializedCBTForceV2;
        readonly typedEncounterState?: SerializedCBTEncounterStateV2;
    }): Promise<PreparedCBTForcePersistenceV2> {
        return prepareInitialCBTForceV2({
            forceId: input.forceId,
            ...(input.typedEncounterState === undefined ? {} : { typedEncounterState: input.typedEncounterState }),
        });
    }

    /** Commits subclass-owned live authority after the base persistence CAS succeeds. */
    protected commitPreparedCBTForcePersistenceV2(_prepared: PreparedCBTForcePersistenceV2): void {
    }

    /** Final synchronous subclass fence immediately before a prepared save is installed. */
    protected isPreparedCBTForcePersistenceCurrent(_prepared: PreparedCBTForcePersistenceV2): boolean {
        return true;
    }

    /** Called after a V2 envelope is installed. */
    protected reconcileCBTForceV2Projection(): void {
    }

    /** Lets a concrete force publish fine-grained member dependencies before observers run. */
    protected onForceChanged(_changedUnitIds: readonly string[] | null): void {
    }

    /** Subclasses with typed cross-unit state opt in. */
    protected getCBTEncounterStateForPersistence(): SerializedCBTEncounterStateV2 | undefined {
        return undefined;
    }

    protected restoreCBTEncounterPersistence(_entry: SerializedForceEncounterEntryV2): void {
        // Base/Alpha Strike forces have no typed CBT encounter runtime.
    }

    units = computed<TUnit[]>(() => {
        return this.groups().flatMap(g => g.units());
    });

    /** The force's direct live members in display order. */
    public readonly members = computed<ForceMember[]>(() => {
        this.memberRevision();
        return this.projectMembers();
    });

    protected abstract projectMembers(): ForceMember[];

    public membersInGroup(group: UnitGroup): ForceMember[] {
        this.memberRevision();
        return this.projectMembersInGroup(group);
    }

    protected abstract projectMembersInGroup(group: UnitGroup): ForceMember[];

    /** One normalized, indexed structural/runtime snapshot per force revision. */
    c3Network = computed(() => new C3Network(this.c3Networks(), this.units()));

    /** Total BV (C3 tax is applied at unit level via adjustedBv, not here) */
    totalBv = computed(() => {
        return this.units().reduce((sum, unit) => sum + (unit.getBv()), 0);
    });

    get name(): string {
        return this._name();
    }

    get note(): string {
        return this._note();
    }

    get tags(): string[] {
        return this._tags();
    }

    displayName = computed<string>(() => {
        const name = this.name;
        if (!name) {
            return this.organizationalName();
        }
        return name;
    });

    public setName(name: string, emitChange: boolean = true) {
        if (this._name() === name) return;
        if (!this.loading && this.readOnly()) return;
        const intent = this.loading ? null : this.reserveForceOwnerMutationIntent();
        this._name.set(name);
        if (this.instanceId() || emitChange) {
            if (intent === null) this.emitChanged();
            else this.emitChangedFromReservedIntent();
        } else if (intent !== null) {
            this.advanceForceOwnerGeneration();
        }
    }

    public setNote(note: string | null | undefined, emitChange: boolean = true) {
        const nextNote = (note ?? '').slice(0, FORCE_NOTE_MAX_LENGTH);
        if (this._note() === nextNote) return;
        if (!this.loading && this.readOnly()) return;
        const intent = this.loading ? null : this.reserveForceOwnerMutationIntent();
        this._note.set(nextNote);
        if (this.instanceId() || emitChange) {
            if (intent === null) this.emitChanged();
            else this.emitChangedFromReservedIntent();
        } else if (intent !== null) {
            this.advanceForceOwnerGeneration();
        }
    }

    public setTags(tags: readonly string[] | null | undefined, emitChange: boolean = true) {
        const nextTags = sanitizeForceTags(tags);
        if (this.areTagsEqual(this._tags(), nextTags)) return;
        if (!this.loading && this.readOnly()) return;
        const intent = this.loading ? null : this.reserveForceOwnerMutationIntent();
        this._tags.set(nextTags);
        if (this.instanceId() || emitChange) {
            if (intent === null) this.emitChanged();
            else this.emitChangedFromReservedIntent();
        } else if (intent !== null) {
            this.advanceForceOwnerGeneration();
        }
    }

    organizationalResult = computed<OrgSizeResult>(() => {
        const result = getOrgFromForce(this, {
            displayOnlyTopLevel: true,
        });
        return result;
    });

    organizationalName = computed(() => {
        return this.organizationalResult().name;
    });

    techBase = computed((): TechBase => {
        return getUnitsAverageTechBase(this.groups()
            .flatMap(group => group.formationUnits().map(formationUnitTechBaseFacts)));
    });

    public getFormationUnitsForGroup(group: UnitGroup): readonly FormationUnitLike[] {
        if (group.force !== this || !this.groups().includes(group as UnitGroup<TUnit>)) return Object.freeze([]);
        return group.units();
    }

    eraWarning = computed<string | null>(() => {
        return this.getEraWarningMessage(this.era(), this.faction());
    });

    /**
     * Applies a tag mutation for a caller that will persist it explicitly.
     * This advances the same owner-generation and monotonic-time authority as
     * emitChanged(), but deliberately does not publish the normal autosave
     * notification so the caller performs exactly one awaited persistence.
     */
    public setTagsForExplicitPersistence(tags: readonly string[] | null | undefined): boolean {
        if (!this.isWholeOwnerActive() || this.readOnly()) return false;
        const nextTags = sanitizeForceTags(tags);
        if (this.areTagsEqual(this._tags(), nextTags)) return false;
        this.reserveForceOwnerMutationIntent();
        this._tags.set(nextTags);
        this.advanceForceOwnerGeneration();
        this.advanceMutationTimestamp();
        return true;
    }

    getEraWarningMessage(
        era: Era | null,
        faction: Faction | null,
        availabilityContext: ForceAvailabilityContext = createMulForceAvailabilityContext(),
    ): string | null {
        const eras = this.dataService.getEras();
        const extinctFaction = this.dataService.getFactionById(MULFACTION_EXTINCT) ?? null;
        return buildEraWarningMessage(
            this.units().map(unit => unit.getSummary()),
            era,
            faction,
            eras,
            extinctFaction,
            availabilityContext,
        );
    }

    /** Whole-owner capacity; subclasses may include detached authoritative members. */
    protected ownedMemberCountForCapacity(): number {
        return this.units().length;
    }

    /** Exact durable V2 entry identities, including entries not projected into legacy groups. */
    protected cbtForceV2MemberInstanceIds(): readonly string[] {
        const authority = this.getSupportedCBTForceV2Envelope();
        return authority !== null
            ? Object.freeze(authority.units.map(entry => String(entry.instanceId)))
            : Object.freeze([]);
    }

    public hasMaxGroups = computed<boolean>(() => {
        return this.groups().length >= MAX_GROUPS;
    });

    public hasEmptyGroups = computed<boolean>(() => {
        return this.groups().some(g => g.units().length === 0);
    });

    public async addGroup(name?: string): Promise<UnitGroup<TUnit>> {
        if (!this.loading && this.readOnly()) {
            throw new Error(`Force "${this.name}" is read-only`);
        }
        if (this.hasMaxGroups()) {
            throw new Error(`Cannot add more than ${MAX_GROUPS} groups`);
        }
        const newGroup = new UnitGroup<TUnit>(this);
        if (name) {
            newGroup.name.set(name);
        }
        const intent = this.loading ? null : this.reserveForceOwnerMutationIntent();
        this.groups.update(groups => [...groups, newGroup]);
        if (this.instanceId()) {
            if (intent === null) this.emitChanged();
            else this.emitChangedFromReservedIntent();
        } else if (intent !== null) {
            this.advanceForceOwnerGeneration();
        }
        return newGroup;
    }

    /** Applies group metadata as one force-owned edit. */
    public async updateGroup(group: UnitGroup<TUnit>, patch: ForceGroupPatch): Promise<boolean> {
        if (this.readOnly() || group.force !== this || !this.groups().includes(group)) return false;
        const has = (key: keyof ForceGroupPatch): boolean => Object.prototype.hasOwnProperty.call(patch, key);
        const name = has('name') ? patch.name?.trim() || undefined : group.name();
        const color = has('color') ? patch.color?.trim() || undefined : group.color;
        const formation = has('formation') ? patch.formation ?? null : group.formation();
        const formationTargetGroupId = has('formationTargetGroupId')
            ? patch.formationTargetGroupId?.trim() || null
            : group.formationTargetGroupId();
        const formationLock = has('formationLock') ? patch.formationLock || undefined : group.formationLock;
        if (formationTargetGroupId !== null
            && (formationTargetGroupId === group.id
                || !this.groups().some(candidate => candidate.id === formationTargetGroupId))) return false;
        if (name === group.name()
            && color === group.color
            && formation === group.formation()
            && formationTargetGroupId === group.formationTargetGroupId()
            && formationLock === group.formationLock) return false;
        const intent = this.loading ? null : this.reserveForceOwnerMutationIntent();
        group.name.set(name);
        group.color = color;
        group.formation.set(formation);
        group.formationTargetGroupId.set(formationTargetGroupId);
        group.formationLock = formationLock;
        if (this.instanceId()) {
            if (intent === null) this.emitChanged();
            else this.emitChangedFromReservedIntent();
        } else if (intent !== null) {
            this.advanceForceOwnerGeneration();
        }
        return true;
    }

    /** Reorder groups within this force. */
    public async reorderGroup(fromIndex: number, toIndex: number): Promise<boolean> {
        if (fromIndex === toIndex) return false;
        const groups = [...this.groups()];
        if (fromIndex < 0 || fromIndex >= groups.length || toIndex < 0 || toIndex >= groups.length) return false;
        if (!this.loading && this.readOnly()) return false;
        const intent = this.loading ? null : this.reserveForceOwnerMutationIntent();
        const [moved] = groups.splice(fromIndex, 1);
        groups.splice(toIndex, 0, moved);
        this.groups.set(groups);
        if (this.instanceId()) {
            if (intent === null) this.emitChanged();
            else this.emitChangedFromReservedIntent();
        } else if (intent !== null) {
            this.advanceForceOwnerGeneration();
        }
        return true;
    }

    /**
     * Adopt an existing group into this force at the given index (appends if omitted).
     * Re-parents the group and all its units to this force. Deduplicates IDs.
     */
    public adoptGroup(
        group: UnitGroup,
        atIndex?: number,
        replacementUnits?: readonly ForceUnit[],
    ): void {
        const source = group.force;
        if (source === this && this.groups().includes(group as UnitGroup<TUnit>)) return;
        if (this.forceOwnerOperationDepth > 0
            || source.forceOwnerOperationDepth > 0
            || this.hasCBTForceV2()
            || source.hasCBTForceV2()) {
            throw new Error('Groups with live or in-flight V2 authority cannot be reparented');
        }
        if (this.readOnly() || source.readOnly()) {
            throw new Error('A read-only force cannot reparent a group');
        }
        if (this.groups().includes(group as UnitGroup<TUnit>)) {
            throw new Error('The target force already owns this group');
        }
        if (this.hasMaxGroups()) {
            throw new Error(`Cannot add more than ${MAX_GROUPS} groups`);
        }
        if (group.units().some(unit => unit.force !== source && unit.force !== this)) {
            throw new Error('The group contains a unit owned by an unrelated force');
        }
        const sourceGroups = source.groups();
        if (!sourceGroups.some(candidate => candidate === group)) {
            throw new Error('The source force no longer owns the selected group');
        }
        const originalUnits = [...group.units()];
        const incomingUnits = replacementUnits ?? originalUnits;
        if (source !== this
            && this.ownedMemberCountForCapacity() + originalUnits.length > MAX_UNITS) {
            throw new Error(`Cannot add more than ${MAX_UNITS} units to a single force`);
        }
        if (this.groups().some(candidate => candidate.id === group.id)) {
            throw new Error(`Target force already owns group id ${group.id}`);
        }
        const incomingIds = incomingUnits.map(unit => unit.id);
        if (new Set(incomingIds).size !== incomingIds.length
            || incomingIds.some(id => this.units().some(unit => unit.id === id))) {
            throw new Error('The selected group has a unit identity collision in the target force');
        }
        if (replacementUnits !== undefined
            && (replacementUnits.length !== originalUnits.length
                || replacementUnits.some(unit => unit.force !== this))) {
            throw new Error('Prepared replacement units do not exactly match the selected group');
        }

        source.reserveForceOwnerMutationIntent();
        if (source !== this) this.reserveForceOwnerMutationIntent();
        const remainingSourceGroups = sourceGroups.filter(candidate => candidate !== group);
        if (source !== this) {
            source.clearFormationTargetReferences(remainingSourceGroups, new Set([group.id]));
            group.formationTargetGroupId.set(null);
        }
        source.groups.set(remainingSourceGroups);
        group.force = this;
        if (replacementUnits !== undefined) group.units.set([...replacementUnits]);
        for (const unit of group.units()) {
            unit.force = this;
        }
        const groups = [...this.groups()];
        const insertAt = atIndex !== undefined ? Math.min(Math.max(0, atIndex), groups.length) : groups.length;
        groups.splice(insertAt, 0, group as UnitGroup<TUnit>);
        this.groups.set(groups);
        if (source !== this) {
            for (const unit of originalUnits) source.removeUnitFromLegacyC3Networks(unit.id);
        }
        if (source !== this && source.instanceId()) source.emitChangedFromReservedIntent();
        if (this.instanceId()) this.emitChangedFromReservedIntent();
    }

    public async removeGroup(group: UnitGroup<TUnit>, relocateUnits: boolean = false): Promise<boolean> {
        if (this.readOnly() || group.force !== this) return false;
        const groups = [...this.groups()];
        // The caller selected this exact group object. Never let a same-ID
        // substitute inherit that authority after an asynchronous prompt.
        const idx = groups.findIndex(candidate => candidate === group);
        if (idx === -1) return false;
        this.reserveForceOwnerMutationIntent();
        const removed = groups.splice(idx, 1)[0];
        this.clearFormationTargetReferences(groups, new Set([removed.id]));
        removed.formationTargetGroupId.set(null);
        if (relocateUnits) {
            // Move removed units into previous group or create default
            if (groups.length === 0) {
                const defaultGroup = new UnitGroup<TUnit>(this);
                defaultGroup.units.set(removed.units());
                groups.push(defaultGroup);
            } else {
                const targetIdx = Math.max(0, idx - 1);
                const targetGroup = groups[targetIdx];
                targetGroup.units.set([...targetGroup.units(), ...removed.units()]);
            }
        } else {
            // Destroy all units in the group and clean up C3 networks
            let networks = this._c3Networks();
            for (const unit of removed.units()) {
                if (networks.length > 0 && new C3Network(networks).isUnitConnected(unit.id)) {
                    networks = C3NetworkEditor.removeUnit(networks, unit.id).networks;
                }
            }
            this._c3Networks.set(networks);
        }
        this.groups.set(groups);
        if (this.instanceId()) this.emitChangedFromReservedIntent();
        return true;
    }

    public removeUnit(unitToRemove: TUnit): void {
        if (this.readOnly() || unitToRemove.force !== this) return;
        const groups = [...this.groups()];
        const ownerGroup = groups.find(group => group.units().some(unit => unit === unitToRemove));
        if (!ownerGroup || ownerGroup.force !== this) return;
        const unitIndex = ownerGroup.units().findIndex(unit => unit === unitToRemove);
        if (unitIndex === -1) return;
        this.reserveForceOwnerMutationIntent();

        const remainingUnits = [...ownerGroup.units()];
        remainingUnits.splice(unitIndex, 1);
        ownerGroup.units.set(remainingUnits);

        // Clean up C3 networks - remove the unit from all networks it participates in
        const currentNetworks = this._c3Networks();
        if (currentNetworks.length > 0 && new C3Network(currentNetworks).isUnitConnected(unitToRemove.id)) {
            const result = C3NetworkEditor.removeUnit(currentNetworks, unitToRemove.id);
            this._c3Networks.set(result.networks);
        }

        if (remainingUnits.length === 0) {
            const remainingGroups = groups.filter(group => group !== ownerGroup);
            this.clearFormationTargetReferences(remainingGroups, new Set([ownerGroup.id]));
            ownerGroup.formationTargetGroupId.set(null);
            this.groups.set(remainingGroups);
        }
        if (this.instanceId()) {
            this.emitChangedFromReservedIntent();
        }
    }

    private removeUnitFromLegacyC3Networks(instanceId: string): void {
        const networks = this._c3Networks();
        if (networks.length === 0 || !new C3Network(networks).isUnitConnected(instanceId)) return;
        this._c3Networks.set(C3NetworkEditor.removeUnit(networks, instanceId).networks);
    }

    private clearFormationTargetReferences(
        groups: readonly UnitGroup<TUnit>[],
        removedGroupIds: ReadonlySet<string>,
    ): void {
        for (const group of groups) {
            const targetGroupId = group.formationTargetGroupId();
            if (targetGroupId !== null && removedGroupIds.has(targetGroupId)) {
                group.formationTargetGroupId.set(null);
            }
        }
    }

    /**
     * Ensures no duplicate group or unit IDs exist within this force.
     * If duplicates are found, regenerates them with fresh UUIDs.
     * @returns true if any duplicate IDs were found and fixed.
     */
    public deduplicateIds(): boolean {
        let fixed = false;
        const seenGroupIds = new Set<string>();
        const seenUnitIds = new Set<string>();
        for (const group of this.groups()) {
            if (seenGroupIds.has(group.id)) {
                group.id = uuidv7();
                fixed = true;
            }
            seenGroupIds.add(group.id);
            for (const unit of group.units()) {
                if (seenUnitIds.has(unit.id)) {
                    unit.id = uuidv7();
                    fixed = true;
                }
                seenUnitIds.add(unit.id);
            }
        }
        return fixed;
    }

    public setNetwork(networks: SerializedC3NetworkGroup[]) {
        if (!this.loading && this.readOnly()) return;
        const detached = structuredClone(networks) as SerializedC3NetworkGroup[];
        const normalized = Sanitizer.sanitizeArray(detached, C3_NETWORK_GROUP_SCHEMA);
        if (jsonValuesEqual(normalized, this._c3Networks())) return;
        const intent = this.loading ? null : this.reserveForceOwnerMutationIntent();
        this._c3Networks.set(normalized);
        if (intent === null) this.emitChanged();
        else this.emitChangedFromReservedIntent();
    }

    /**
     * Atomically installs a detached legacy-C3 cleanup only while the exact
     * force graph observed before an asynchronous overlay operation is still
     * authoritative. A stale overlay can neither mutate nor publish this owner.
     */
    public setNetworkIfWholeOwnerAuthorityCurrent(
        fingerprint: ForceOwnerAuthorityFingerprint,
        networks: readonly SerializedC3NetworkGroup[],
    ): boolean {
        if (!this.isWholeOwnerActive()
            || this.readOnly()
            || !this.isWholeOwnerAuthorityFingerprintCurrent(fingerprint)) return false;
        const detached = structuredClone(networks) as SerializedC3NetworkGroup[];
        const normalized = Sanitizer.sanitizeArray(detached, C3_NETWORK_GROUP_SCHEMA);
        if (jsonValuesEqual(normalized, this._c3Networks())) return false;
        // No await or external callback may separate the exact fingerprint
        // check above from this synchronous owner mutation.
        this.reserveForceOwnerMutationIntent();
        this._c3Networks.set(normalized);
        if (this.instanceId()) this.emitChangedFromReservedIntent();
        return true;
    }

    /** Atomically applies a dialog's detached Alpha Strike C3 graph and layout. */
    public setC3ConfigurationIfOwnerRevisionCurrent(
        revisionFence: ForceOwnerRevisionFence,
        networks: readonly SerializedC3NetworkGroup[],
        positions: readonly ForceC3UnitPosition[],
    ): boolean {
        if (!this.isWholeOwnerActive()
            || this.readOnly()
            || !this.isForceOwnerRevisionFenceCurrent(revisionFence)) return false;
        let normalizedNetworks: SerializedC3NetworkGroup[];
        let normalizedPositions: ForceC3UnitPosition[];
        try {
            normalizedNetworks = Sanitizer.sanitizeArray(
                structuredClone(networks) as SerializedC3NetworkGroup[],
                C3_NETWORK_GROUP_SCHEMA,
            );
            normalizedPositions = structuredClone(positions).map(position => Object.freeze({
                unitId: position.unitId,
                ...Sanitizer.sanitize({ x: position.x, y: position.y }, C3_POSITION_SCHEMA),
            }));
        } catch {
            return false;
        }
        const units = this.units();
        const unitsById = new Map(units.map(unit => [unit.id, unit] as const));
        const positionsById = new Map(normalizedPositions.map(position => [position.unitId, position] as const));
        if (unitsById.size !== units.length
            || positionsById.size !== normalizedPositions.length
            || normalizedPositions.some(position => !unitsById.has(position.unitId))) return false;

        const networksChanged = !jsonValuesEqual(normalizedNetworks, this._c3Networks());
        const positionsChanged = normalizedPositions.some(next => {
            const current = unitsById.get(next.unitId)!.c3Position();
            return current?.x !== next.x || current?.y !== next.y;
        });
        if (!networksChanged && !positionsChanged) return false;

        this.reserveForceOwnerMutationIntent();
        for (const position of normalizedPositions) {
            const unit = unitsById.get(position.unitId)!;
            unit[applyForceUnitOwnerC3Position]({ x: position.x, y: position.y });
        }
        this._c3Networks.set(normalizedNetworks);
        if (this.instanceId()) this.emitChangedFromReservedIntent();
        else this.advanceForceOwnerGeneration();
        return true;
    }

    /** Serialize this Force instance to a plain object */
    public serialize(): SerializedForce {
        const instanceId = this.instanceId() ?? uuidv7();
        const timestamp = this.timestamp ?? new Date().toISOString();
        return this.buildGroupedForcePersistenceRecord(instanceId, timestamp);
    }

    /** Direct CBT V2 metadata; unit and encounter state live only in `cbt`. */
    protected buildCBTForceMetadataRecord(
        instanceId: string,
        timestamp: string,
    ): SerializedForce & { readonly instanceId: string; readonly timestamp: string } {
        return Object.freeze({
            version: 2,
            timestamp,
            instanceId,
            type: GameSystem.CLASSIC,
            name: this.name,
            ...(this.note ? { note: this.note } : {}),
            ...(this.tags.length > 0 ? { tags: [...this.tags] } : {}),
            ...(this.faction() === null ? {} : { factionId: this.faction()!.id }),
            ...(this.factionLock ? { factionLock: true } : {}),
            ...(this.era() === null ? {} : { eraId: this.era()!.id }),
            ...(this.eraLock ? { eraLock: true } : {}),
            ...(!this.owned() ? { owned: false } : {}),
        });
    }

    /** Retained owners may need an empty presentation group as durable roster topology. */
    protected shouldPersistEmptyGroup(_group: UnitGroup<TUnit>): boolean {
        return false;
    }

    private buildGroupedForcePersistenceRecord(
        instanceId: string,
        timestamp: string,
    ): SerializedForce {
        const persistentGroups = this.groups()
            .filter(group => group.units().length > 0 || this.shouldPersistEmptyGroup(group));
        const persistentGroupIds = new Set(persistentGroups.map(group => group.id));
        const serializedGroups: SerializedGroup[] = persistentGroups
            .map(g => {
            const formation = g.activeFormation();
            const formationTargetGroupId = g.formationTargetGroupId();
            return {
                id: g.id,
                ...(g.name() ? { name: g.name() } : {}),
                ...(g.color ? { color: g.color } : {}),
                ...(formation === null ? {} : { formationId: formation.id }),
                ...(g.formationLock ? { formationLock: true } : {}),
                ...(formationTargetGroupId !== null
                    && formationTargetGroupId !== g.id
                    && persistentGroupIds.has(formationTargetGroupId)
                    ? { formationTargetGroupId }
                    : {}),
                units: g.units().map(u => u.serialize())
            };
            });
        const result: SerializedForce = {
            version: 2,
            timestamp,
            instanceId: instanceId,
            type: this.gameSystem,
            name: this.name,
            ...(this.note ? { note: this.note } : {}),
            ...(this.tags.length === 0 ? {} : { tags: [...this.tags] }),
            ...(this.faction() === null ? {} : { factionId: this.faction()!.id }),
            ...(this.factionLock ? { factionLock: true } : {}),
            ...(this.era() === null ? {} : { eraId: this.era()!.id }),
            ...(this.eraLock ? { eraLock: true } : {}),
            groups: serializedGroups,
            ...(this.c3Networks().length === 0 ? {} : { c3Networks: this.c3Networks() }),
        };
        return Object.freeze(structuredClone(result));
    }

    protected buildCBTForcePersistenceRecord(
        metadata: SerializedForce,
        cbt: SerializedCBTForceV2,
    ): SerializedClassicForce {
        return Object.freeze({
            version: 2,
            timestamp: metadata.timestamp,
            instanceId: metadata.instanceId,
            type: GameSystem.CLASSIC,
            name: metadata.name,
            ...(metadata.note === undefined ? {} : { note: metadata.note }),
            ...(metadata.tags === undefined ? {} : { tags: metadata.tags }),
            ...(metadata.factionId === undefined ? {} : { factionId: metadata.factionId }),
            ...(metadata.factionLock === undefined ? {} : { factionLock: metadata.factionLock }),
            ...(metadata.eraId === undefined ? {} : { eraId: metadata.eraId }),
            ...(metadata.eraLock === undefined ? {} : { eraLock: metadata.eraLock }),
            ...(metadata.bv === undefined ? {} : { bv: metadata.bv }),
            ...(metadata.owned === undefined ? {} : { owned: metadata.owned }),
            cbt,
        });
    }

    emitChanged(changedUnitIds: readonly string[] | null = null) {
        if (this.loading) return;
        if (this.readOnly()) {
            const logger = this.injector.get(LoggerService);
            logger.warn(`Force.emitChanged() blocked: force "${this.name}" is read-only. Changes will not be persisted.`);
            return;
        }
        if (this.reservedIntentEmissionDepth === 0) {
            this.reserveForceOwnerMutationIntent();
        }
        this.emitChangedCore(changedUnitIds);
    }

    private emitChangedCore(changedUnitIds: readonly string[] | null): void {
        if (this.loading) return;
        if (this.readOnly()) {
            const logger = this.injector.get(LoggerService);
            logger.warn(`Force.emitChanged() blocked: force "${this.name}" is read-only. Changes will not be persisted.`);
            return;
        }
        this.advanceForceOwnerGeneration();
        this.advanceMutationTimestamp();
        this.onForceChanged(changedUnitIds);
        if (changedUnitIds === null) {
            this.memberRevision.update(revision => revision + 1);
        }
        // ForcePersistenceService is the sole persistence/network debounce. Emitting here
        // synchronously makes accepted owner mutations visible to unload and
        // remote-arbitration code immediately, without a second lossy timer.
        this.changed.next(changedUnitIds === null
            ? null
            : Object.freeze([...new Set(changedUnitIds)]));
    }

    private advanceMutationTimestamp(): void {
        const previous = this.timestamp === null ? Number.NaN : Date.parse(this.timestamp);
        const next = Number.isFinite(previous)
            ? Math.max(Date.now(), previous + 1)
            : Date.now();
        this.timestamp = new Date(next).toISOString();
    }

    /** Installs metadata for an already validated direct V2 CBT record. */
    protected populateFromCBTForceV2(data: SerializedForce): void {
        if (data.version !== 2
            || data.type !== GameSystem.CLASSIC
            || typeof data.instanceId !== 'string'
            || !data.instanceId.trim()
            || typeof data.timestamp !== 'string'
            || !data.timestamp
            || typeof data.name !== 'string'
            || data.cbt === undefined) {
            throw new Error('Invalid direct CBT V2 force record');
        }
        this.loading = true;
        try {
            this.populateSerializedMetadata(data);
            this.groups.set([]);
            this._c3Networks.set([]);
        } finally {
            this.loading = false;
        }
    }

    protected populateSerializedMetadata(data: SerializedForce): void {
        this._instanceId.set(data.instanceId);
        this._owned.set(data.owned !== false);
        this._name.set(data.name);
        this.setNote(data.note ?? '', false);
        this.setTags(data.tags ?? [], false);
        this.factionLock = data.factionLock || false;
        this.faction.set(data.factionId == null
            ? null
            : this.dataService.getFactionById(data.factionId) ?? null);
        this.eraLock = data.eraLock || false;
        this.era.set(data.eraId == null
            ? null
            : this.dataService.getEraById(data.eraId) ?? null);
        this.timestamp = data.timestamp ?? null;
    }

    private areTagsEqual(currentTags: readonly string[], nextTags: readonly string[]): boolean {
        if (currentTags.length !== nextTags.length) {
            return false;
        }

        return currentTags.every((tag, index) => tag === nextTags[index]);
    }

    /**
     * Subclass factory: deserialize a SerializedForce into a new Force instance
     * using this instance's injected services.
     */
    protected abstract deserializeFrom(serialized: SerializedForce): Force;

    /**
     * Async clone boundary for the completed force-target registry. Retained
     * V2 units and typed cross-unit facts require a full identity remapper and
     * fail closed; target facts are restored into a fresh runtime and resealed
     * against the clone's fresh force/unit/bridge identities.
     */
    public async cloneForPersistence(): Promise<Force> {
        if ((this.getSupportedCBTForceV2Envelope()?.units.length ?? 0) > 0) {
            throw new Error('Retained V2 force members cannot be cloned without a complete identity remap');
        }
        const encounter = this.getCBTEncounterStateForPersistence();
        if (encounter?.facts.some(fact => fact.kind !== 'target')) {
            throw new Error('Typed cross-unit encounter facts cannot be cloned without a complete identity remap');
        }
        const cloned = this.cloneLegacyGraph();
        if (encounter && encounter.facts.length > 0) {
            cloned.restoreCBTEncounterPersistence(Object.freeze({
                encounterRevision: encounter.encounterRevision,
                state: encounter,
            }));
            await cloned.serializeForPersistence();
        }
        return cloned;
    }

    private cloneLegacyGraph(): Force {
        const serialized = structuredClone(this.serialize());

        // Build old→new unit ID map
        const unitIdMap = new Map<string, string>();
        const groupIdMap = new Map<string, string>();
        serialized.instanceId = uuidv7();
        if (serialized.groups) {
            for (const group of serialized.groups) {
                const previousGroupId = group.id;
                group.id = uuidv7();
                groupIdMap.set(previousGroupId, group.id);
                for (const unit of group.units) {
                    const newId = uuidv7();
                    unitIdMap.set(unit.id, newId);
                    unit.id = newId;
                }
            }
            for (const group of serialized.groups) {
                if (group.formationTargetGroupId !== undefined) {
                    group.formationTargetGroupId = groupIdMap.get(group.formationTargetGroupId);
                }
            }
        }

        // Remap C3 network references
        if (serialized.c3Networks) {
            const remapId = (id: string): string => {
                const parts = id.split(':');
                const mapped = unitIdMap.get(parts[0]);
                if (mapped) {
                    parts[0] = mapped;
                    return parts.join(':');
                }
                return id;
            };
            for (const network of serialized.c3Networks) {
                network.id = uuidv7();
                if (network.peerIds) {
                    network.peerIds = network.peerIds.map(remapId);
                }
                if (network.masterId) {
                    network.masterId = remapId(network.masterId);
                }
                if (network.members) {
                    network.members = network.members.map(remapId);
                }
            }
        }

        serialized.timestamp = new Date().toISOString();
        serialized.owned = true;

        const cloned = this.deserializeFrom(serialized);
        cloned.persistenceIdentityPromotionInstanceId = cloned.instanceId();
        return cloned;
    }
}
