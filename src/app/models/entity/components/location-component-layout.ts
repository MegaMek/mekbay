// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/**
 * Immutable compact storage for a component that has an effective value at
 * every active entity location. The default is the uniform value; overrides
 * contain only semantically different location values.
 */
export interface LocationComponentLayout<L extends string, C> {
  readonly defaultComponent: C;
  readonly overrides: ReadonlyMap<L, C>;
}

export function createLocationComponentLayout<L extends string, C>(
  defaultComponent: C,
  overrides?: ReadonlyMap<L, C> | Iterable<readonly [L, C]>,
): LocationComponentLayout<L, C> {
  return {
    defaultComponent,
    overrides: new Map(overrides),
  };
}

export function locationComponentAt<L extends string, C>(
  layout: LocationComponentLayout<L, C>,
  location: L,
): C {
  return layout.overrides.get(location) ?? layout.defaultComponent;
}

export function withLocationComponent<L extends string, C>(
  layout: LocationComponentLayout<L, C>,
  location: L,
  component: C,
  equals: (left: C, right: C) => boolean,
): LocationComponentLayout<L, C> {
  const overrides = new Map(layout.overrides);
  if (equals(component, layout.defaultComponent)) {
    overrides.delete(location);
  } else {
    overrides.set(location, component);
  }
  return createLocationComponentLayout(layout.defaultComponent, overrides);
}

export function withUniformLocationComponent<L extends string, C>(
  component: C,
): LocationComponentLayout<L, C> {
  return createLocationComponentLayout<L, C>(component);
}

/** Materialize a total effective map for the supplied active locations. */
export function effectiveLocationComponents<L extends string, C>(
  layout: LocationComponentLayout<L, C>,
  locations: readonly L[],
): ReadonlyMap<L, C> {
  return new Map(locations.map(location => [location, locationComponentAt(layout, location)]));
}

/** Return the common semantic value, or null when active locations differ. */
export function uniformLocationComponent<L extends string, C>(
  layout: LocationComponentLayout<L, C>,
  locations: readonly L[],
  equals: (left: C, right: C) => boolean,
): C | null {
  if (locations.length === 0) return layout.defaultComponent;
  const first = locationComponentAt(layout, locations[0]);
  for (let index = 1; index < locations.length; index++) {
    if (!equals(first, locationComponentAt(layout, locations[index]))) return null;
  }
  return first;
}
