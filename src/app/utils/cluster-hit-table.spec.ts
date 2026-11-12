// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { clusterHits } from './cluster-hit-table';

describe('clusterHits', () => {
  it('returns Java-compatible values at the roll boundaries', () => {
    expect(clusterHits(2, 6)).toBe(2);
    expect(clusterHits(12, 6)).toBe(6);
    expect(clusterHits(7, 40)).toBe(24);
  });

  it('returns zero for invalid rack sizes', () => {
    expect(clusterHits(7, 0)).toBe(0);
    expect(clusterHits(7, 2.5)).toBe(0);
  });

  it('splits sizes the table lacks at its largest smaller row, reading both parts on one roll', () => {
    expect(clusterHits(7, 31)).toBe(clusterHits(7, 30) + clusterHits(7, 1));
    expect(clusterHits(7, 45)).toBe(clusterHits(7, 40) + clusterHits(7, 5));
  });

  it('rejects rolls outside the 2d6 result range', () => {
    expect(() => clusterHits(1, 6)).toThrowError(RangeError);
    expect(() => clusterHits(13, 6)).toThrowError(RangeError);
    expect(() => clusterHits(7.5, 6)).toThrowError(RangeError);
  });
});
