// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export type CrewEditAction = 'unassign' | 'delete';

/** Detached dialog affordances derived by the caller from the Force crew policy. */
export interface CrewEditActions {
    readonly canUnassign: boolean;
    readonly canDelete: boolean;
}
