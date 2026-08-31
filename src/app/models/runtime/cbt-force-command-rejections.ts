// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
    CBTUnitRepairResult,
    CBTUnitTransferResult,
    RuntimeUndoCommandResult,
} from '../cbt-force-api';
import type { CBTForceRosterCommandRejection } from './cbt-force-roster-owner';

export function rejectedRosterCommand(
    reason: CBTForceRosterCommandRejection['reason'],
): CBTForceRosterCommandRejection {
    return Object.freeze({ accepted: false, changed: false, reason });
}

export function rejectedUnitRepair(
    reason: Extract<CBTUnitRepairResult, { readonly accepted: false }>['reason'],
): Extract<CBTUnitRepairResult, { readonly accepted: false }> {
    return Object.freeze({ accepted: false, changed: false, reason });
}

export function rejectedUnitTransfer(
    reason: Extract<CBTUnitTransferResult, { readonly accepted: false }>['reason'],
): Extract<CBTUnitTransferResult, { readonly accepted: false }> {
    return Object.freeze({ accepted: false, changed: false, reason });
}

export function rejectedRuntimeUndoCommand(
    reason: NonNullable<RuntimeUndoCommandResult['reason']>,
): RuntimeUndoCommandResult {
    return Object.freeze({ accepted: false, changed: false, reason });
}
