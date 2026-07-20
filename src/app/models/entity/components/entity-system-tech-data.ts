import {
  approx,
  DATE_PS,
  type TechAdvancement,
} from '../types';

/** Technology for the Omni capability shared by Meks and aerospace units. */
export const OMNI_TECH = {
  techBase: 'All',
  rating: 'E',
  availability: ['X', 'E', 'E', 'D'],
  level: 'Standard',
  dates: {
    is: { common: 3052 },
    clan: { prototype: approx(2854), production: approx(2856), common: approx(2864) },
  },
  factions: {
    prototype: ['CCY', 'CSF'],
    production: ['CCY', 'DC'],
  },
} as const satisfies TechAdvancement;

/** Vehicle-specific Omni progression implied by early Dragoon OmniVehicles. */
export const OMNI_VEHICLE_TECH = {
  ...OMNI_TECH,
  dates: {
    is: { prototype: approx(3008), common: 3052 },
    clan: OMNI_TECH.dates.clan,
  },
  factions: {
    prototype: ['CCY', 'CSF', 'MERC'],
    production: ['CCY', 'DC'],
  },
} as const satisfies TechAdvancement;

/** Technology cost of combining Inner Sphere and Clan systems. */
export const MIXED_TECH = {
  techBase: 'All',
  rating: 'A',
  availability: ['X', 'X', 'E', 'D'],
  level: 'Standard',
  dates: {
    is: { production: approx(3050), common: approx(3082) },
    clan: { production: approx(2820), common: approx(3082) },
  },
  factions: { prototype: ['CLAN', 'DC', 'FS', 'LC'] },
} as const satisfies TechAdvancement;

/** Construction technology for combining different armor types by location. */
export const PATCHWORK_ARMOR_TECH = {
  techBase: 'All',
  rating: 'A',
  availability: ['E', 'D', 'E', 'E'],
  level: 'Advanced',
  dates: { prototype: DATE_PS, production: approx(3080) },
} as const satisfies TechAdvancement;
