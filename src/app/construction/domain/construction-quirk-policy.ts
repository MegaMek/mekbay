// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { CONSTRUCTION_VALIDATE_QUIRKS } from './construction-config';

const QUIRK_ISSUE_CODES = new Set([
  'QUIRK_NOT_APPLICABLE', 'WEAPON_QUIRK_NOT_APPLICABLE', 'WEAPON_QUIRK_UNMATCHED',
  'MEK_INTERFACE_CRAMPED', 'QUIRK_NOT_FOUND',
]);

export function isQuirkIssue(issue: { readonly code: string }): boolean {
  return QUIRK_ISSUE_CODES.has(issue.code);
}

/** Apply the quirk policy to live validation and cached catalog issues without changing source data. */
export function filterQuirkIssues<T extends { readonly code: string }>(issues: readonly T[], quirksEnabled: boolean): readonly T[] {
  return CONSTRUCTION_VALIDATE_QUIRKS && quirksEnabled ? issues : issues.filter(issue => !isQuirkIssue(issue));
}
