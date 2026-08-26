// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Ephemeral Intel-tab presentation data parsed from a native MTF/BLK on demand. */
export interface UnitFluffSystem {
  label?: string;
  manufacturer?: string;
  model?: string;
}

/** Never stored in a UnitSummary, summary archive, or runtime catalog. */
export interface UnitFluff {
  manufacturer?: string;
  primaryFactory?: string;
  capabilities?: string;
  overview?: string;
  deployment?: string;
  history?: string;
  notes?: string;
  systems?: UnitFluffSystem[];
}
