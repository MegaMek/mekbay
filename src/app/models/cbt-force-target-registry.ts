// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type {
    CBTForceTargetRegistryAuthority,
    CBTForceTargetRegistryDispatchResult,
} from './cbt-force-api';
import type {
    TargetRegistryCommand,
    TargetRegistryCommandResult,
    TargetRegistrySnapshot,
} from './runtime/encounter-runtime';

export function authorizeCBTForceTargetRegistryCommand(
    current: TargetRegistrySnapshot,
    command: TargetRegistryCommand,
    authority: CBTForceTargetRegistryAuthority,
): TargetRegistryCommand | CBTForceTargetRegistryDispatchResult {
    const manualTargets = current.targets.filter(target => target.source !== 'opfor');
    const opforTargets = current.targets.filter(target => target.source === 'opfor');
    if (authority === 'registry-reset') {
        return command.kind === 'reset-targets'
            ? command
            : rejectedCBTForceTargetRegistry(current, 'TARGET_ORIGIN_POLICY');
    }
    if (authority === 'opfor-sync') {
        if (command.kind !== 'replace-targets'
            || command.targets.some(target => target.source !== 'opfor' || target.readOnly !== true)) {
            return rejectedCBTForceTargetRegistry(current, 'TARGET_ORIGIN_POLICY');
        }
        return { ...command, targets: [...manualTargets, ...command.targets] };
    }

    if (command.kind === 'create-target'
        && (command.target.source === 'opfor' || command.target.readOnly === true)) {
        return rejectedCBTForceTargetRegistry(current, 'TARGET_ORIGIN_POLICY');
    }
    if (command.kind === 'delete-target'
        && opforTargets.some(target => target.id === command.targetId)) {
        return rejectedCBTForceTargetRegistry(current, 'TARGET_ORIGIN_POLICY');
    }
    if (command.kind === 'replace-targets') {
        if (command.targets.some(target => target.source === 'opfor' || target.readOnly === true)) {
            return rejectedCBTForceTargetRegistry(current, 'TARGET_ORIGIN_POLICY');
        }
        return { ...command, targets: [...command.targets, ...opforTargets] };
    }
    if (command.kind === 'reset-targets') {
        return {
            kind: 'replace-targets',
            expectedRevision: command.expectedRevision,
            targets: opforTargets,
        };
    }
    return command;
}

export function rejectedCBTForceTargetRegistry(
    snapshot: TargetRegistrySnapshot,
    reason: Extract<TargetRegistryCommandResult, { readonly accepted: false }>['reason'] | 'FORCE_READ_ONLY',
): CBTForceTargetRegistryDispatchResult {
    return Object.freeze({ accepted: false, changed: false, reason, snapshot });
}
