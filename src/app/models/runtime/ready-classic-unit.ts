// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ReadyMekUnit } from './ready-unit-factory';
import { ReadyNonMekUnit } from './ready-non-mek-unit';
import type { BaseEntity } from '../entity/base-entity';
import type { SavedEntityIdentity } from '../persisted-unit-state';
import type { NativeUnitSourceHandle } from '../native-unit-source-handle';
import type { CrewAssignment } from './crew-assignment';
import type { StateRevision, UnitInstanceId } from './runtime-state';
import type {
    ClassicUnitRuntimeIndex,
    ClassicUnitRuntimeReadModel,
} from './classic-unit-runtime';
import type { SerializedCBTUnitV2 } from './persistence-v2';
import type { SerializedNonMekUnit } from './non-mek-unit-persistence';
import type { TargetRegistrySnapshot } from './encounter-runtime';
import type { EquipmentRowOrderGroup } from './equipment-row-order';
import type {
    CBTUnitAttackerTargetingCommand,
    CBTUnitSelectedWeaponFireCommand,
    CommandReduction,
} from './unit-instance';

export interface ReadyTargetingReconciliation {
    readonly expectedRevision: StateRevision;
    commit(): boolean;
}

export type ReadyEquipmentRowOrderResult =
    | Readonly<{
        readonly accepted: true;
        readonly idempotent: boolean;
        readonly currentRevision: StateRevision;
    }>
    | Readonly<{
        readonly accepted: false;
        readonly reason: 'REVISION_CONFLICT' | 'FORCE_READ_ONLY' | 'INVALID_ORDER';
        readonly currentRevision: StateRevision;
    }>;

export type ReadySelectedWeaponFireResult =
    | Readonly<{
        readonly accepted: true;
        readonly idempotent: boolean;
        readonly currentRevision: StateRevision;
    }>
    | Readonly<{
        readonly accepted: false;
        readonly reason: Extract<CommandReduction, { readonly accepted: false }>['reason'];
        readonly currentRevision: StateRevision;
    }>;

export type ReadyAttackerTargetingResult = ReadySelectedWeaponFireResult;

export type ReadyEndTurnResult = Readonly<{
    readonly accepted: boolean;
    readonly reason?: string;
}>;

/** Family-neutral ownership boundary used by CBTForce. */
export interface ReadyClassicUnit {
    readonly instanceId: UnitInstanceId;
    getUnit(): BaseEntity;
    getIndex(): ClassicUnitRuntimeIndex;
    getSourceRef(): SavedEntityIdentity;
    getNativeSource(): NativeUnitSourceHandle | undefined;
    getCrewAssignment(): CrewAssignment;
    revision(): StateRevision;
    captureRuntime(): ClassicUnitRuntimeReadModel;
    planTargetingReconciliation(registry: TargetRegistrySnapshot): ReadyTargetingReconciliation | null;
    setEquipmentRowOrder(
        expectedRevision: StateRevision,
        group: EquipmentRowOrderGroup,
        permutation: readonly number[],
        rowCount: number,
        forceReadOnly: boolean,
    ): ReadyEquipmentRowOrderResult;
    dispatchSelectedWeaponFire(
        command: CBTUnitSelectedWeaponFireCommand,
        registry: TargetRegistrySnapshot,
        forceReadOnly: boolean,
        c3Available: boolean,
    ): ReadySelectedWeaponFireResult;
    dispatchAttackerTargeting(
        command: CBTUnitAttackerTargetingCommand,
        registry: TargetRegistrySnapshot,
        forceReadOnly: boolean,
    ): ReadyAttackerTargetingResult;
    serialize(): SerializedCBTUnitV2 | SerializedNonMekUnit;
}

export function isReadyMekUnit(unit: ReadyClassicUnit): unit is ReadyMekUnit {
    return unit instanceof ReadyMekUnit;
}

export function isReadyNonMekUnit(unit: ReadyClassicUnit): unit is ReadyNonMekUnit {
    return unit instanceof ReadyNonMekUnit;
}
