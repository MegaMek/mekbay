// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from './cbt-ruleset.model';
import type { BaseEntity } from './entity/base-entity';
import type { MekEntity } from './entity/entities/mek/mek-entity';
import type { NativeUnitSourceHandle } from './native-unit-source-handle';
import type { SavedEntityIdentity } from './persisted-unit-state';
import type { CrewAssignment } from './runtime/crew-assignment';
import type {
    ClassicUnitQueryPort,
    ClassicUnitRuntimeIndex,
    ClassicUnitRuntimeState,
} from './runtime/classic-unit-runtime';
import type { NonMekRuntimeIndex } from './runtime/non-mek-runtime-index';
import type { NonMekUnitRuntimeState } from './runtime/non-mek-unit-instance';
import type { MekRuntimeIndex } from './runtime/mek-runtime-index';
import type { MekUnitQueryPort } from './runtime/unit-instance';
import type { MekUnitRuntimeState, UnitInstanceId } from './runtime/runtime-state';

/** Complete immutable read model for any force-owned Classic BaseEntity. */
export interface CBTUnitSnapshot {
    readonly instanceId: UnitInstanceId;
    readonly entity: BaseEntity;
    readonly index: ClassicUnitRuntimeIndex;
    readonly sourceRef: SavedEntityIdentity;
    readonly nativeSource?: NativeUnitSourceHandle;
    readonly ruleset: CBTRuleset;
    readonly crewAssignment: CrewAssignment;
    readonly state: ClassicUnitRuntimeState;
    readonly query: ClassicUnitQueryPort;
}

/**
 * Narrows the Mek mechanics capability. Critical slots and critical-hit state
 * exist only behind this guard; the top-level BaseEntity snapshot stays unified.
 */
export function hasMekRuntime(
    snapshot: CBTUnitSnapshot,
): snapshot is CBTUnitSnapshot & Readonly<{
    entity: MekEntity;
    index: MekRuntimeIndex;
    state: MekUnitRuntimeState;
    query: MekUnitQueryPort;
}> {
    return snapshot.entity.entityType === 'Mek';
}

/** Narrows non-Mek mechanics without defining a parallel snapshot interface. */
export function hasNonMekRuntime(
    snapshot: CBTUnitSnapshot,
): snapshot is CBTUnitSnapshot & Readonly<{
    index: NonMekRuntimeIndex;
    state: NonMekUnitRuntimeState;
    query: ClassicUnitQueryPort;
}> {
    return snapshot.entity.entityType !== 'Mek';
}
