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
    ClassicUnitCommandResult,
    ClassicUnitRuntimeIndex,
    ClassicUnitRuntimeReadModel,
    ClassicUnitRuntimeState,
} from './classic-unit-runtime';
import type { SerializedCBTUnitV2 } from './persistence-v2';
import type { SerializedNonMekUnit } from './non-mek-unit-persistence';
import type { TargetRegistrySnapshot } from './encounter-runtime';
import type { EquipmentRowOrderGroup } from './equipment-row-order';
import type {
    CBTUnitAttackerTargetingCommand,
    CBTUnitSelectedWeaponFireCommand,
} from './unit-instance';
import type { PrototypeLaserHeatResult } from '../prototype-laser-heat.model';

export interface ReadyTargetingReconciliation {
    install(): void;
}

export type ReadyUnitCommandResult = ClassicUnitCommandResult<ClassicUnitRuntimeState>;
export type ReadySelectedWeaponFireResult = Readonly<
    ReadyUnitCommandResult & { readonly prototypeHeat: readonly PrototypeLaserHeatResult[] }
>;

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
        group: EquipmentRowOrderGroup,
        permutation: readonly number[],
        rowCount: number,
        forceReadOnly: boolean,
    ): ReadyUnitCommandResult;
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
    ): ReadyUnitCommandResult;
    serialize(): SerializedCBTUnitV2 | SerializedNonMekUnit;
}

export function isReadyMekUnit(unit: ReadyClassicUnit): unit is ReadyMekUnit {
    return unit instanceof ReadyMekUnit;
}

export function isReadyNonMekUnit(unit: ReadyClassicUnit): unit is ReadyNonMekUnit {
    return unit instanceof ReadyNonMekUnit;
}
