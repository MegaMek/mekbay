// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EntityMountedEquipment } from '../entity/types';
import type {
    ArmorFaceId,
    ComponentId,
    CrewPositionId,
    LocationId,
} from '../entity/entity-identifiers';
import type { EquipmentStatus } from '../equipment-status.model';
import type { AmmoEquipment } from '../equipment.model';
import type { UnitConditionKey } from '../unit-condition.model';
import type { AttackerTargetingState } from './attacker-targeting-state';
import type { EquipmentRowOrderState } from './equipment-row-order';
import type { EndTurnCheckpoint } from './end-turn-checkpoint';
import type {
    AmmoRuntimeState,
    ComponentRuntimeState,
    StateRevision,
} from './runtime-state';

export type RuntimeStatePerspective = 'committed' | 'preview';

/** Shared immutable location topology for every Classic BaseEntity runtime. */
export interface ClassicRuntimeLocation {
    readonly id: LocationId;
    readonly code: string;
    readonly sheetCode?: string;
    readonly internalPoints: number;
    readonly armorFaceIds: readonly ArmorFaceId[];
    readonly combinedPips?: boolean;
    readonly soldierPips?: boolean;
}

/** Shared immutable armor topology for every Classic BaseEntity runtime. */
export interface ClassicRuntimeArmorFace {
    readonly id: ArmorFaceId;
    readonly locationId: LocationId;
    readonly face: 'front' | 'rear';
    readonly maximumPoints: number;
}

/** Components share identity; only equipment-backed components have a mount. */
export interface ClassicRuntimeComponent {
    readonly id: ComponentId;
    readonly kind: 'equipment' | 'system';
    readonly mount?: EntityMountedEquipment;
}

export interface ClassicRuntimeCrewPosition {
    readonly id: CrewPositionId;
    readonly occurrence: number;
}

/**
 * One disposable topology contract for every Classic BaseEntity. Family-only
 * metadata lives on the indexed rows or in explicit mechanics capabilities.
 */
export interface ClassicUnitRuntimeIndex {
    readonly locations: ReadonlyMap<LocationId, ClassicRuntimeLocation>;
    readonly armorFaces: ReadonlyMap<ArmorFaceId, ClassicRuntimeArmorFace>;
    readonly components: ReadonlyMap<ComponentId, ClassicRuntimeComponent>;
    readonly crewPositions: ReadonlyMap<CrewPositionId, ClassicRuntimeCrewPosition>;
}

export interface ClassicLocationRuntimeState {
    readonly internalDamage: number;
    readonly armorDamage: readonly { readonly faceId: ArmorFaceId; readonly damage: number }[];
}

export interface ClassicCrewRuntimeState {
    readonly wounds: number;
    readonly unconscious: boolean;
    readonly ejected: boolean;
    /** Earliest turn for an automated recovery roll; null means no queued recovery. */
    readonly recoveryReadyTurn?: number | null;
}

/** Boundary facts shared by every Classic family runtime. */
export interface ClassicTurnRuntimeState {
    readonly turnCounter: number;
    readonly endTurnCheckpoint?: EndTurnCheckpoint;
}

/**
 * Common sparse state owned by every Classic runtime. Family-specific turn
 * declarations extend the shared boundary facts on their concrete state.
 */
export interface ClassicUnitRuntimeState {
    readonly stateRevision: StateRevision;
    readonly locations: ReadonlyMap<LocationId, ClassicLocationRuntimeState>;
    readonly components: ReadonlyMap<ComponentId, ComponentRuntimeState>;
    readonly ammo: ReadonlyMap<ComponentId, AmmoRuntimeState>;
    readonly crew: ReadonlyMap<CrewPositionId, ClassicCrewRuntimeState>;
    readonly conditions: ReadonlySet<UnitConditionKey>;
    readonly turn: ClassicTurnRuntimeState;
    readonly attackerTargeting: AttackerTargetingState;
    readonly equipmentRowOrder?: EquipmentRowOrderState;
}

export interface ClassicUnitCommandResult<State extends ClassicUnitRuntimeState | null> {
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
export interface ClassicUnitQueryPort {
    readonly stateRevision: StateRevision;
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
    crewState(positionId: CrewPositionId): ClassicCrewRuntimeState;
}

/** One atomically captured force-facing runtime read model. */
export interface ClassicUnitRuntimeReadModel {
    readonly index: ClassicUnitRuntimeIndex;
    readonly state: ClassicUnitRuntimeState;
    readonly query: ClassicUnitQueryPort;
}

/** Minimal family-neutral source for an atomic force-facing runtime read. */
export interface ClassicUnitRuntimePort {
    getIndex(): ClassicUnitRuntimeIndex;
    snapshot(): ClassicUnitRuntimeState;
    query(): ClassicUnitQueryPort;
}

/** The single capture path used by every ready Classic unit. */
export function captureClassicUnitRuntime(
    runtime: ClassicUnitRuntimePort,
): ClassicUnitRuntimeReadModel {
    const state = runtime.snapshot();
    const query = runtime.query();
    if (state.stateRevision !== query.stateRevision) {
        throw new Error('Classic unit changed while its read model was captured');
    }
    return Object.freeze({ index: runtime.getIndex(), state, query });
}
