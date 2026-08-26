// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { StateRevision } from './runtime-state';
import {
    canonicalizeCrewAssignment,
    type CrewAssignment,
    type CrewAssignmentPosition,
    type CrewTopology,
} from './crew-assignment';

export type CrewProfilePosition = CrewAssignmentPosition;

export interface CrewProfileSnapshot {
    readonly revision: number;
    readonly positions: readonly CrewProfilePosition[];
}

export interface ReplaceCrewProfileCommand {
    readonly expectedRevision: number;
    readonly positions: readonly CrewProfilePosition[];
}

export type CrewProfileCommandResult =
    | { readonly accepted: true; readonly snapshot: CrewProfileSnapshot }
    | { readonly accepted: false; readonly reason: 'REVISION_CONFLICT' | 'INVALID_PROFILE' | 'COMBAT_STARTED'; readonly snapshot: CrewProfileSnapshot };

export type PreparedCrewProfileReplacement =
    | {
        readonly accepted: true;
        readonly snapshot: CrewProfileSnapshot;
        readonly assignment: CrewAssignment;
    }
    | Extract<CrewProfileCommandResult, { readonly accepted: false }>;

export function createCrewProfileSnapshot(
    assignment: CrewAssignment,
    revision: number,
): CrewProfileSnapshot {
    return Object.freeze({
        revision,
        positions: Object.freeze(assignment.positions.map(position => Object.freeze({ ...position }))),
    });
}

/** Validates one pre-combat crew edit without mutating the entity or runtime. */
export function prepareCrewProfileReplacement(
    topology: CrewTopology,
    currentAssignment: CrewAssignment,
    runtimeRevision: StateRevision,
    currentRevision: number,
    command: ReplaceCrewProfileCommand,
): PreparedCrewProfileReplacement {
    const current = createCrewProfileSnapshot(currentAssignment, currentRevision);
    if (command.expectedRevision !== currentRevision) {
        return Object.freeze({ accepted: false, reason: 'REVISION_CONFLICT', snapshot: current });
    }
    if (runtimeRevision !== 0) {
        return Object.freeze({ accepted: false, reason: 'COMBAT_STARTED', snapshot: current });
    }

    try {
        const assignment = canonicalizeCrewAssignment(topology, {
            schemaVersion: 1,
            positions: command.positions,
        });
        return Object.freeze({
            accepted: true,
            assignment,
            snapshot: createCrewProfileSnapshot(assignment, currentRevision + 1),
        });
    } catch {
        return Object.freeze({ accepted: false, reason: 'INVALID_PROFILE', snapshot: current });
    }
}
