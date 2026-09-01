// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CBTMekUnit } from './cbt-mek-unit';
import { CBTNonMekUnit } from './cbt-non-mek-unit';
import type { BaseEntity } from '../entity/base-entity';
import type { SavedEntityIdentity } from '../persisted-unit-state';
import type { NativeUnitSourceHandle } from '../native-unit-source-handle';
import type { CrewAssignment } from './crew-assignment';
import type {
    CBTUnitCommandResult,
    CBTUnitRuntimeIndex,
    CBTUnitRuntimeReadModel,
    CBTUnitRuntimeState,
} from './cbt-unit-runtime';
import type { SerializedCBTUnitV2 } from './persistence-v2';
import type { SerializedNonMekUnit } from './non-mek-unit-persistence';
import type { TargetRegistrySnapshot } from './encounter-runtime';
import type { EquipmentRowOrderGroup } from './equipment-row-order';
import type { CBTUnitAttackerTargetingCommand, CBTUnitSelectedWeaponFireCommand } from './unit-instance';
import type { PrototypeLaserHeatResult } from '../prototype-laser-heat.model';

export interface CBTTargetingReconciliation {
    install(): void;
}

export type CBTUnitDispatchResult = CBTUnitCommandResult<CBTUnitRuntimeState>;
export type CBTSelectedWeaponFireResult = Readonly<
    CBTUnitDispatchResult & { readonly prototypeHeat: readonly PrototypeLaserHeatResult[] }
>;

/** Family-neutral ownership boundary used by CBTForce. */
export interface CBTUnit {
    readonly instanceId: string;
    getUnit(): BaseEntity;
    getIndex(): CBTUnitRuntimeIndex;
    getSourceRef(): SavedEntityIdentity;
    getNativeSource(): NativeUnitSourceHandle | undefined;
    getCrewAssignment(): CrewAssignment;
    revision(): number;
    captureRuntime(): CBTUnitRuntimeReadModel;
    planTargetingReconciliation(registry: TargetRegistrySnapshot): CBTTargetingReconciliation | null;
    setEquipmentRowOrder(
        group: EquipmentRowOrderGroup,
        permutation: readonly number[],
        rowCount: number,
        forceReadOnly: boolean,
    ): CBTUnitDispatchResult;
    dispatchSelectedWeaponFire(
        command: CBTUnitSelectedWeaponFireCommand,
        registry: TargetRegistrySnapshot,
        forceReadOnly: boolean,
        c3Available: boolean,
    ): CBTSelectedWeaponFireResult;
    dispatchAttackerTargeting(
        command: CBTUnitAttackerTargetingCommand,
        registry: TargetRegistrySnapshot,
        forceReadOnly: boolean,
    ): CBTUnitDispatchResult;
    serialize(): SerializedCBTUnitV2 | SerializedNonMekUnit;
}

export function isCBTMekUnit(unit: CBTUnit): unit is CBTMekUnit {
    return unit instanceof CBTMekUnit;
}

export function isCBTNonMekUnit(unit: CBTUnit): unit is CBTNonMekUnit {
    return unit instanceof CBTNonMekUnit;
}
