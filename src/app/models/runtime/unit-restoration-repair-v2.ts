// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { SavedEntityIdentity } from '../persisted-unit-state';
import { jsonValuesEqual } from '../../utils/json-value.util';
import { compareText } from '../../utils/string.util';
import {
    asSavedTargetRef,
    CBT_UNIT_RESTORATION_ALGORITHM_VERSION_V2,
    savedTargetReferenceClosureV2,
    type SavedBlueprintReferenceTableV2,
    type SavedStateTargetV2,
    type SavedTargetRef,
    type SerializedIgnoredStateRecoveryDecisionV2,
    type SerializedPersistedRestoreAliasV2,
    type SerializedRecoverableStateFactV2,
    type SerializedUnitRestorationMetadataV2,
    type SerializedUnresolvedStateRecoveryEntryV2,
} from './persistence-v2';

/** Bump only when automatic target resolution semantics change. */
export const STATE_RESTORATION_ALGORITHM_VERSION_V2 = CBT_UNIT_RESTORATION_ALGORITHM_VERSION_V2;

export type UnitRestorationRepairErrorCode =
    | 'ALGORITHM_VERSION_MISMATCH'
    | 'CONFLICTING_REMAP'
    | 'INVALID_RECOVERY_ID'
    | 'RECOVERY_NOT_FOUND'
    | 'RECOVERY_AUTHORITY_MISMATCH'
    | 'TARGET_KIND_MISMATCH'
    | 'TARGET_NOT_FOUND'
    | 'TARGET_ENTITY_MISMATCH'
    | 'UNSUPPORTED_FACT_CAPABILITY';

export class UnitRestorationRepairError extends Error {
    public constructor(
        public readonly code: UnitRestorationRepairErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'UnitRestorationRepairError';
    }
}

export interface UnitRestorationRepairContextV2 {
    /** The exact entity revision still active when the command commits. */
    readonly currentEntity: SavedEntityIdentity;
    readonly currentReferences: SavedBlueprintReferenceTableV2;
}

export type UnitRestorationRepairCommandV2 =
    | {
        readonly kind: 'ignore-unresolved';
        readonly recoveryId: string;
    }
    | {
        readonly kind: 'remap-unresolved';
        readonly recoveryId: string;
        readonly target: SavedTargetRef;
        /** Captured when the user selected the target; prevents a stale repair racing a reload. */
        readonly expectedTargetEntity: SavedEntityIdentity;
    };

/**
 * Updates recovery metadata only. The caller persists the returned sidecar with the unit snapshot;
 * applying a remap to runtime state remains the restoration codec's job on the next restore.
 */
export async function applyUnitRestorationRepairV2(
    metadata: SerializedUnitRestorationMetadataV2,
    context: UnitRestorationRepairContextV2,
    command: UnitRestorationRepairCommandV2,
): Promise<SerializedUnitRestorationMetadataV2> {
    metadata = cloneFrozen(metadata);
    context = cloneFrozen(context);
    command = cloneFrozen(command);
    assertRecoveryId(command.recoveryId);
    if (metadata.algorithmVersion !== STATE_RESTORATION_ALGORITHM_VERSION_V2) {
        fail(
            'ALGORITHM_VERSION_MISMATCH',
            `Recovery metadata uses algorithm ${metadata.algorithmVersion}; expected ${STATE_RESTORATION_ALGORITHM_VERSION_V2}`,
        );
    }
    if (context.currentReferences.schemaVersion !== 1) {
        fail('TARGET_NOT_FOUND', 'Unsupported current target-table version');
    }

    if (command.kind === 'ignore-unresolved') {
        return ignoreRecovery(metadata, command.recoveryId);
    }
    return remapRecovery(metadata, context, command);
}

async function ignoreRecovery(
    metadata: SerializedUnitRestorationMetadataV2,
    recoveryId: string,
): Promise<SerializedUnitRestorationMetadataV2> {
    const ignored = metadata.ignoredRecovery ?? [];
    if (ignored.some(decision => decision.recoveryId === recoveryId
        && decision.algorithmVersion === STATE_RESTORATION_ALGORITHM_VERSION_V2)) return metadata;

    const recovery = findRecovery(metadata, recoveryId);
    const decision: SerializedIgnoredStateRecoveryDecisionV2 = {
        recoveryId,
        algorithmVersion: STATE_RESTORATION_ALGORITHM_VERSION_V2,
    };
    const unresolved = metadata.unresolved.filter(entry => entry.recoveryId !== recoveryId);
    const activeAliasSources = new Set(unresolved.map(entry => entry.sourceTargetRef));
    const acceptedAliases = metadata.acceptedAliases.filter(alias =>
        activeAliasSources.has(alias.sourceTargetRef));
    const { heatRecovery, ...withoutHeatRecovery } = metadata;
    const activeSourceRefs = new Set(unresolved.map(entry => entry.sourceTargetRef));
    let prunedHeatRecovery: SerializedUnitRestorationMetadataV2['heatRecovery'];
    if (heatRecovery !== undefined && unresolved.length > 0) {
        const retainedSourceRefs = savedTargetReferenceClosureV2(
            heatRecovery.sourceReferences.targets,
            [...activeSourceRefs],
        );
        if (retainedSourceRefs === undefined) {
            fail('RECOVERY_AUTHORITY_MISMATCH', 'Active recovery source closure is incomplete');
        }
        const retained = new Set(retainedSourceRefs);
        prunedHeatRecovery = {
            ...heatRecovery,
            sourceReferences: {
                schemaVersion: 1 as const,
                targets: Object.fromEntries(Object.entries(heatRecovery.sourceReferences.targets)
                    .filter(([ref]) => retained.has(asSavedTargetRef(ref)))),
            },
            targetTranslation: Object.fromEntries(Object.entries(heatRecovery.targetTranslation)
                .filter(([ref]) => activeSourceRefs.has(asSavedTargetRef(ref)))),
        };
    }
    return cloneFrozen({
        ...withoutHeatRecovery,
        unresolved,
        acceptedAliases,
        ...(prunedHeatRecovery === undefined ? {} : { heatRecovery: prunedHeatRecovery }),
        ignoredRecovery: [...ignored, decision].sort(compareIgnoredDecision),
    });
}

async function remapRecovery(
    metadata: SerializedUnitRestorationMetadataV2,
    context: UnitRestorationRepairContextV2,
    command: Extract<UnitRestorationRepairCommandV2, { readonly kind: 'remap-unresolved' }>,
): Promise<SerializedUnitRestorationMetadataV2> {
    if (!entityIdentitiesEqual(command.expectedTargetEntity, context.currentEntity)) {
        fail('TARGET_ENTITY_MISMATCH', 'The entity changed after the repair target was selected');
    }
    const recovery = findRecovery(metadata, command.recoveryId);
    rejectUncompiledMunitionFact(recovery.fact);
    const heatRecovery = metadata.heatRecovery;
    if (heatRecovery === undefined
        || !jsonValuesEqual(heatRecovery.currentReferences, context.currentReferences)) {
        fail(
            'RECOVERY_AUTHORITY_MISMATCH',
            'Repair target table does not match the exact durable recovery current references',
        );
    }
    const ownedSource = heatRecovery.sourceReferences.targets[recovery.sourceTargetRef];
    if (ownedSource === undefined
        || !jsonValuesEqual(ownedSource, recovery.sourceTarget)) {
        fail(
            'RECOVERY_AUTHORITY_MISMATCH',
            'Recovery source is not byte-owned by the durable recovery authority',
        );
    }

    let target: SavedTargetRef;
    try {
        target = asSavedTargetRef(command.target);
    } catch {
        fail('TARGET_NOT_FOUND', 'The selected target reference is invalid');
    }
    const currentTarget = context.currentReferences.targets[target];
    if (!currentTarget) fail('TARGET_NOT_FOUND', `The selected target ${target} is not in the current entity`);
    assertCompatibleTarget(recovery, currentTarget);

    const alias: SerializedPersistedRestoreAliasV2 = {
        sourceTargetRef: recovery.sourceTargetRef,
        targetEntity: context.currentEntity,
        target,
        algorithmVersion: STATE_RESTORATION_ALGORITHM_VERSION_V2,
    };
    const exactAlias = metadata.acceptedAliases.find(existing => aliasesEqual(existing, alias));
    if (exactAlias && heatRecovery.targetTranslation[recovery.sourceTargetRef] === target) return metadata;
    const conflicting = metadata.acceptedAliases.find(existing =>
        existing.sourceTargetRef === recovery.sourceTargetRef
        && existing.algorithmVersion === STATE_RESTORATION_ALGORITHM_VERSION_V2
        && entityIdentitiesEqual(existing.targetEntity, context.currentEntity)
        && existing.target !== target,
    );
    if (conflicting) {
        fail('CONFLICTING_REMAP', `The source witness is already remapped to ${conflicting.target}`);
    }
    return cloneFrozen({
        ...metadata,
        acceptedAliases: exactAlias === undefined
            ? [...metadata.acceptedAliases, alias].sort(compareAlias)
            : metadata.acceptedAliases,
        heatRecovery: {
            ...heatRecovery,
            targetTranslation: {
                ...heatRecovery.targetTranslation,
                [recovery.sourceTargetRef]: target,
            },
        },
    });
}

function findRecovery(
    metadata: SerializedUnitRestorationMetadataV2,
    recoveryId: string,
): SerializedUnresolvedStateRecoveryEntryV2 {
    const matches = metadata.unresolved.filter(entry => entry.recoveryId === recoveryId);
    if (matches.length !== 1) {
        fail(
            'RECOVERY_NOT_FOUND',
            matches.length === 0
                ? `Unknown recovery entry ${recoveryId}`
                : `Recovery ID ${recoveryId} is not unique`,
        );
    }
    return matches[0];
}

function assertCompatibleTarget(
    recovery: SerializedUnresolvedStateRecoveryEntryV2,
    currentTarget: SavedStateTargetV2,
): void {
    const allowed = allowedTargetKinds(recovery.fact);
    if (!allowed.includes(recovery.sourceTarget.kind) || !allowed.includes(currentTarget.kind)) {
        fail(
            'TARGET_KIND_MISMATCH',
            `A ${recovery.fact.kind} recovery cannot be remapped from ${recovery.sourceTarget.kind} to ${currentTarget.kind}`,
        );
    }
}

function allowedTargetKinds(
    fact: SerializedRecoverableStateFactV2,
): readonly SavedStateTargetV2['kind'][] {
    switch (fact.kind) {
        case 'location-damage':
        case 'location-condition':
        case 'mek-rule-check':
        case 'pending-location-damage':
        case 'pending-location-condition':
            return ['location-section'];
        case 'slot-hits':
        case 'pending-slot-hits':
            return ['critical-slot'];
        case 'component-state':
        case 'pending-component-status':
            return ['component', 'intrinsic-system'];
        case 'pending-shield-damage':
        case 'pending-modular-armor-damage':
            return ['component'];
        case 'ammo-state':
            return ['ammo-source'];
        case 'crew-state':
            return ['crew-position'];
    }
}

function rejectUncompiledMunitionFact(fact: SerializedRecoverableStateFactV2): void {
    if (fact.kind === 'ammo-state' && fact.munitionOverride !== undefined) {
        fail('UNSUPPORTED_FACT_CAPABILITY', 'A munition override cannot be remapped until the target exposes a compiled capability');
    }
}

function assertRecoveryId(value: string): void {
    if (typeof value !== 'string' || !value.trim() || value.length > 512 || value.includes('\0')) {
        fail('INVALID_RECOVERY_ID', 'Recovery ID must be a non-empty bounded string');
    }
}

function entityIdentitiesEqual(left: SavedEntityIdentity, right: SavedEntityIdentity): boolean {
    return jsonValuesEqual(left, right);
}

function aliasesEqual(
    left: SerializedPersistedRestoreAliasV2,
    right: SerializedPersistedRestoreAliasV2,
): boolean {
    return left.sourceTargetRef === right.sourceTargetRef
        && left.target === right.target
        && left.algorithmVersion === right.algorithmVersion
        && entityIdentitiesEqual(left.targetEntity, right.targetEntity);
}

function compareAlias(left: SerializedPersistedRestoreAliasV2, right: SerializedPersistedRestoreAliasV2): number {
    return compareText(JSON.stringify(left), JSON.stringify(right));
}

function compareIgnoredDecision(
    left: SerializedIgnoredStateRecoveryDecisionV2,
    right: SerializedIgnoredStateRecoveryDecisionV2,
): number {
    return compareText(left.recoveryId, right.recoveryId)
        || left.algorithmVersion - right.algorithmVersion;
}

function cloneFrozen<T>(value: T): T {
    return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    return Object.freeze(value);
}

function fail(code: UnitRestorationRepairErrorCode, message: string): never {
    throw new UnitRestorationRepairError(code, message);
}
