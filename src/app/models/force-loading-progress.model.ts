// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Transient presentation progress while saved forces are restored. */
export interface ForceLoadingProgress {
    readonly instanceId: string;
    readonly name?: string;
    readonly factionId?: number;
    readonly eraId?: number;
    readonly status: 'pending' | 'loading' | 'loaded' | 'failed';
}
