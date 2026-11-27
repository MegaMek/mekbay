// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { ForcePreviewEntry } from './force-preview.model';

/** Saved force preview with a transient search index owned by the load dialog. */
export interface LoadForceEntry extends ForcePreviewEntry {
    _searchText?: string;
}
