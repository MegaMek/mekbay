// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { roundToNearestHalfTon } from './equipment-engine-weight';

describe('equipment engine weight rounding', () => {
  it('stabilizes nearest-half boundaries at kilogram precision', () => {
    expect(roundToNearestHalfTon(20.25 - Number.EPSILON * 20.25)).toBe(20.5);
    expect(roundToNearestHalfTon(20.2494)).toBe(20);
    expect(roundToNearestHalfTon(20.2504)).toBe(20.5);
  });
});