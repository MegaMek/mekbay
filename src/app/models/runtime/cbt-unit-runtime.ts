// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EntityMountedEquipment } from '../entity/types';
import type { ArmorFaceId, ComponentId, CrewPositionId, LocationId } from '../entity/entity-identifiers';
import type { EquipmentStatus } from '../equipment-status.model';
import type { AmmoEquipment } from '../equipment.model';
import type { UnitConditionKey } from '../unit-condition.model';
import type { AttackerTargetingState } from './attacker-targeting-state';
import type { EquipmentRowOrderState } from './equipment-row-order';
import type { EndTurnCheckpoint } from './end-turn-checkpoint';
import type { AmmoRuntimeState, ComponentRuntimeState } from './runtime-state';

export type RuntimeStatePerspective = 'committed' | 'preview';

/** Shared immutable location topology for every CBT BaseEntity runtime. */
export interface CBTRuntimeLocation {
    readonly id: LocationId;
    readonly code: string;
    readonly sheetCode?: string;
    readonly internalPoints: number;
    readonly armorFaceIds: readonly ArmorFaceId[];
    readonly combinedPips?: boolean;
    readonly soldierPips?: boolean;
}

/** Shared immutable armor topology for every CBT BaseEntity runtime. */
export interface CBTRuntimeArmorFace {
    readonly id: ArmorFaceId;
    readonly locationId: LocationId;
    readonly face: 'front' | 'rear';
    readonly maximumPoints: number;
}

/** Components share identity; only equipment-backed components have a mount. */
export interface CBTRuntimeComponent {
    readonly id: ComponentId;
    readonly kind: 'equipment' | 'system';
    readonly mount?: EntityMountedEquipment;
}

export interface CBTRuntimeCrewPosition {
    readonly id: CrewPositionId;
    readonly occurrence: number;
}

/**
 * One disposable topology contract for every CBT BaseEntity. Family-only
 * metadata lives on the indexed rows or in explicit mechanics capabilities.
 */
export interface CBTUnitRuntimeIndex {
    readonly locations: ReadonlyMap<LocationId, CBTRuntimeLocation>;
    readonly armorFaces: ReadonlyMap<ArmorFaceId, CBTRuntimeArmorFace>;
    readonly components: ReadonlyMap<ComponentId, CBTRuntimeComponent>;
    readonly crewPositions: ReadonlyMap<CrewPositionId, CBTRuntimeCrewPosition>;
}

export interface CBTLocationRuntimeState {
    readonly internalDamage: number;
    readonly armorDamage: readonly { readonly faceId: ArmorFaceId; readonly damage: number }[];
}

export interface CBTCrewRuntimeState {
    readonly wounds: number;
    readonly unconscious: boolean;
    readonly ejected: boolean;
    /** Sparse committed death. Six wounds without this flag remain pending until phase end. */
    readonly dead?: true;
    /** Earliest turn for an automated recovery roll; null means no queued recovery. */
    readonly recoveryReadyTurn?: number | null;
}

/** A sixth wound is fatal, but origin/next commits that death only at phase end. */
export function isCrewDeathCommitted(state: CBTCrewRuntimeState): boolean {
    return state.dead === true;
}

/** Boundary facts shared by every CBT family runtime. */
export interface CBTTurnRuntimeState {
    readonly turnCounter: number;
    /** A committed phase-scoped edit exists and has not crossed End Phase yet. */
    readonly phaseStateChanged: boolean;
    readonly endTurnCheckpoint?: EndTurnCheckpoint;
}

/**
 * Common sparse state owned by every CBT runtime. Family-specific turn
 * declarations extend the shared boundary facts on their concrete state.
 */
export interface CBTUnitRuntimeState {
    readonly stateRevision: number;
    readonly locations: ReadonlyMap<LocationId, CBTLocationRuntimeState>;
    readonly components: ReadonlyMap<ComponentId, ComponentRuntimeState>;
    readonly ammo: ReadonlyMap<ComponentId, AmmoRuntimeState>;
    readonly crew: ReadonlyMap<CrewPositionId, CBTCrewRuntimeState>;
    readonly conditions: ReadonlySet<UnitConditionKey>;
    readonly turn: CBTTurnRuntimeState;
    readonly attackerTargeting: AttackerTargetingState;
    readonly equipmentRowOrder?: EquipmentRowOrderState;
}

export interface CBTUnitCommandResult<State extends CBTUnitRuntimeState | null> {
    /** False only when the owning force is read-only. */
    readonly accepted: boolean;
    readonly changed: boolean;
    readonly state: State;
}

/**
 * Family-neutral runtime reads used by CBTForce and generic presentation.
 * Mek-only rule queries extend this interface and are obtained through an
 * explicit capability guard.
 */
export interface CBTUnitQueryPort {
    readonly stateRevision: number;
    /** One authoritative dirty check for the current phase. */
    hasPendingPhaseChanges(): boolean;
    hasPendingCombat(): boolean;
    destroyed(): boolean;
    currentBaseBattleValue(): number | null;
    remainingArmor(faceId: ArmorFaceId, perspective?: RuntimeStatePerspective): number;
    remainingInternal(locationId: LocationId, perspective?: RuntimeStatePerspective): number;
    componentStatus(componentId: ComponentId, perspective?: RuntimeStatePerspective): EquipmentStatus;
    componentMode(componentId: ComponentId): string | undefined;
    remainingAmmo(componentId: ComponentId): number;
    ammoEquipment(componentId: ComponentId): AmmoEquipment | null;
    attackerTargetingState(): AttackerTargetingState;
    equipmentRowOrder(): EquipmentRowOrderState | undefined;
    hasCondition(condition: UnitConditionKey): boolean;
    conditions(): readonly UnitConditionKey[];
    crewState(positionId: CrewPositionId): CBTCrewRuntimeState;
}

/** One atomically captured force-facing runtime read model. */
export interface CBTUnitRuntimeReadModel {
    readonly index: CBTUnitRuntimeIndex;
    readonly state: CBTUnitRuntimeState;
    readonly query: CBTUnitQueryPort;
}

/** Minimal family-neutral source for an atomic force-facing runtime read. */
export interface CBTUnitRuntimePort {
    getIndex(): CBTUnitRuntimeIndex;
    snapshot(): CBTUnitRuntimeState;
    query(): CBTUnitQueryPort;
}

/** The single capture path used by every ready CBT unit. */
export function captureCBTUnitRuntime(
    runtime: CBTUnitRuntimePort,
): CBTUnitRuntimeReadModel {
    return Object.freeze({
        index: runtime.getIndex(),
        state: runtime.snapshot(),
        query: runtime.query(),
    });
}
