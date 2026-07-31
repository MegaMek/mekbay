/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version.
 */

import {
  createLocationComponentLayout,
  effectiveLocationComponents,
  locationComponentAt,
  uniformLocationComponent,
  withLocationComponent,
  withUniformLocationComponent,
} from './location-component-layout';

interface Component {
  readonly id: number;
  readonly label: string;
}

const semanticallyEqual = (left: Component, right: Component): boolean => left.id === right.id;

describe('LocationComponentLayout', () => {
  it('resolves a total effective map from a compact default and overrides', () => {
    const standard = { id: 0, label: 'Standard' };
    const endo = { id: 1, label: 'Endo Steel' };
    const layout = createLocationComponentLayout(standard, [['LA', endo], ['STALE', endo]]);

    expect(locationComponentAt(layout, 'CT')).toBe(standard);
    expect(locationComponentAt(layout, 'LA')).toBe(endo);
    expect([...effectiveLocationComponents(layout, ['LA', 'CT'])]).toEqual([
      ['LA', endo],
      ['CT', standard],
    ]);
  });

  it('creates immutable snapshots and compacts semantically default overrides', () => {
    const standard = { id: 0, label: 'Standard' };
    const layout = createLocationComponentLayout(standard);
    const withEndo = withLocationComponent(
      layout,
      'LA',
      { id: 1, label: 'Endo Steel' },
      semanticallyEqual,
    );
    const restored = withLocationComponent(
      withEndo,
      'LA',
      { id: 0, label: 'Different instance and label' },
      semanticallyEqual,
    );

    expect(layout.overrides.size).toBe(0);
    expect(withEndo.overrides.size).toBe(1);
    expect(restored.overrides.size).toBe(0);
    expect(restored.overrides).not.toBe(withEndo.overrides);
  });

  it('determines uniformity using semantic equality rather than object identity', () => {
    const standard = { id: 0, label: 'Standard' };
    const equivalent = { id: 0, label: 'Equivalent Standard' };
    const layout = createLocationComponentLayout(standard, [['LA', equivalent]]);

    expect(uniformLocationComponent(layout, ['LA', 'CT'], semanticallyEqual)).toBe(equivalent);

    const hybrid = withLocationComponent(
      layout,
      'RA',
      { id: 1, label: 'Endo Steel' },
      semanticallyEqual,
    );
    expect(uniformLocationComponent(hybrid, ['LA', 'RA', 'CT'], semanticallyEqual)).toBeNull();
  });

  it('replaces the default and removes all previous overrides for uniform assignment', () => {
    const layout = createLocationComponentLayout(
      { id: 0, label: 'Standard' },
      [['LA', { id: 1, label: 'Endo Steel' }]],
    );
    const uniform = withUniformLocationComponent<string, Component>({ id: 2, label: 'Composite' });

    expect(uniform.defaultComponent).toEqual({ id: 2, label: 'Composite' });
    expect(uniform.overrides.size).toBe(0);
    expect(layout.overrides.size).toBe(1);
  });
});
