// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type {
    CBTForceTargetRegistryAuthority,
} from './cbt-force.types';
import type {
    TargetRegistryCommand,
    TargetRegistryCommandResult,
    TargetRegistrySnapshot,
} from './runtime/encounter-runtime';
import {
    readOnlyTargetRegistry,
    unchangedTargetRegistry,
} from './runtime/encounter-runtime';

export function authorizeCBTForceTargetRegistryCommand(
    current: TargetRegistrySnapshot,
    command: TargetRegistryCommand,
    authority: CBTForceTargetRegistryAuthority,
): TargetRegistryCommand | TargetRegistryCommandResult {
    const manualTargets = current.targets.filter(target => target.source !== 'opfor');
    const opforTargets = current.targets.filter(target => target.source === 'opfor');
    if (authority === 'registry-reset') {
        return command.kind === 'reset-targets'
            ? command
            : unchangedTargetRegistry(current);
    }
    if (authority === 'opfor-sync') {
        if (command.kind !== 'replace-targets'
            || command.targets.some(target => target.source !== 'opfor' || target.readOnly !== true)) {
            return unchangedTargetRegistry(current);
        }
        return { ...command, targets: [...manualTargets, ...command.targets] };
    }

    if (command.kind === 'create-target'
        && (command.target.source === 'opfor' || command.target.readOnly === true)) {
        return unchangedTargetRegistry(current);
    }
    if (command.kind === 'delete-target'
        && opforTargets.some(target => target.id === command.targetId)) {
        return readOnlyTargetRegistry(current);
    }
    if (command.kind === 'replace-targets') {
        if (command.targets.some(target => target.source === 'opfor' || target.readOnly === true)) {
            return unchangedTargetRegistry(current);
        }
        return { ...command, targets: [...command.targets, ...opforTargets] };
    }
    if (command.kind === 'reset-targets') {
        return {
            kind: 'replace-targets',
            targets: opforTargets,
        };
    }
    return command;
}
