// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/**
 * Barrel re-export for entity type definitions.
 *
 * Consumers can keep importing from `'../types'` (or `'./types'`), which
 * resolves to this index.ts.  Each concern is in its own file for
 * maintainability.
 */
export * from './tech';
export * from './entity';
export * from './weight';
export * from './engine';
export * from './cockpit';
export * from './heat-sink';
export * from './armor';
export * from './aero';
export * from './locations';
export * from './mek';
export * from './motive';
export * from './move';
export * from './vehicle';
export * from './infantry';
export * from './equipment';
export * from './weapon';
export * from './transport';
export * from './common';
export * from './validation-sets';
export * from './faction';
export * from './classification';
export * from './feature';
