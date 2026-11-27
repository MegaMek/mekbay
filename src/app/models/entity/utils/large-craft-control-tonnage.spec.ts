// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { largeCraftStandardRound } from '../../large-craft-equipment.model';

describe('large-craft control-system tonnage', () => {
  it('stabilizes exact upward half-ton boundaries at kilogram precision', () => {
    expect(largeCraftStandardRound(100 * 0.07)).toBe(7);
    expect(largeCraftStandardRound(7.001)).toBe(7.5);
    expect(largeCraftStandardRound(7.5)).toBe(7.5);
  });
});
