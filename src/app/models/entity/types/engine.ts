// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

// ============================================================================
// Engine Types
// ============================================================================

export type EngineType =
  | 'Fusion' | 'ICE' | 'XL' | 'XXL' | 'Light' | 'Compact'
  | 'Fuel Cell' | 'Fission' | 'None' | 'Maglev' | 'Steam'
  | 'Battery' | 'Solar' | 'External';

/** Engine flags - derived from entity properties, not user-set */
export type EngineFlag =
  | 'clan' | 'tank' | 'large' | 'superheavy' | 'support-vee';
