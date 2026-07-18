/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

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
