import {
  approx,
  DATE_ES,
  type TechAdvancement,
  type WeightClass,
} from '../types';

function advancement(
  data: Omit<TechAdvancement, 'factions'>,
): TechAdvancement {
  return data;
}

const MEK_CONSTRUCTION_TECH = {
  standard: advancement({
    techBase: 'All', rating: 'D', availability: ['C', 'E', 'D', 'C'], level: 'Introductory',
    dates: { prototype: 2463, production: 2470, common: 2500 },
  }),
  ultraLight: advancement({
    techBase: 'All', rating: 'D', availability: ['E', 'F', 'E', 'E'], level: 'Advanced',
    dates: { prototype: 2500, production: 2519, common: approx(3075) },
  }),
  superHeavy: advancement({
    techBase: 'IS', rating: 'D', availability: ['X', 'F', 'F', 'F'], level: 'Advanced',
    dates: { prototype: 3077, production: 3078 },
  }),
  industrial: advancement({
    techBase: 'All', rating: 'C', availability: ['C', 'C', 'C', 'B'], level: 'Standard',
    dates: { prototype: 2463, production: 2470, common: 2500 },
  }),
  superHeavyIndustrial: advancement({
    techBase: 'IS', rating: 'D', availability: ['X', 'F', 'X', 'F'], level: 'Advanced',
    dates: { prototype: 2930, production: 2940 },
  }),
  primitive: advancement({
    techBase: 'IS', rating: 'C', availability: ['C', 'X', 'F', 'F'], level: 'Advanced',
    dates: { prototype: 2439, production: 2443, common: 2470, extinct: 2520 },
  }),
  primitiveIndustrial: advancement({
    techBase: 'IS', rating: 'D', availability: ['D', 'X', 'F', 'F'], level: 'Advanced',
    dates: { prototype: 2300, production: 2350, common: 2425, extinct: 2520 },
  }),
  tripod: advancement({
    techBase: 'IS', rating: 'D', availability: ['F', 'F', 'F', 'E'], level: 'Advanced',
    dates: { prototype: approx(2585), production: 2602 },
  }),
  superHeavyTripod: advancement({
    techBase: 'IS', rating: 'D', availability: ['X', 'F', 'X', 'F'], level: 'Advanced',
    dates: { prototype: approx(2930), production: 2940 },
  }),
} as const;

export interface MekConstructionContext {
  readonly primitive: boolean;
  readonly industrial: boolean;
  readonly tripod: boolean;
  readonly weightClass: WeightClass;
}

export function getMekConstructionTech(context: MekConstructionContext): TechAdvancement {
  const superHeavy = context.weightClass === 'Super Heavy';
  if (context.tripod) {
    return superHeavy ? MEK_CONSTRUCTION_TECH.superHeavyTripod : MEK_CONSTRUCTION_TECH.tripod;
  }
  if (context.primitive) {
    return context.industrial
      ? MEK_CONSTRUCTION_TECH.primitiveIndustrial
      : MEK_CONSTRUCTION_TECH.primitive;
  }
  if (context.industrial) {
    return superHeavy
      ? MEK_CONSTRUCTION_TECH.superHeavyIndustrial
      : MEK_CONSTRUCTION_TECH.industrial;
  }
  if (context.weightClass === 'Ultra Light') return MEK_CONSTRUCTION_TECH.ultraLight;
  return superHeavy ? MEK_CONSTRUCTION_TECH.superHeavy : MEK_CONSTRUCTION_TECH.standard;
}

export const LAM_CONSTRUCTION_TECH = {
  Standard: advancement({
    techBase: 'IS', rating: 'D', availability: ['D', 'E', 'F', 'F'], level: 'Experimental',
    dates: {
      is: { prototype: 2683, production: 2688, reintroduced: 3085 },
      clan: { production: 2688, reintroduced: 2825 },
    },
  }),
  Bimodal: advancement({
    techBase: 'IS', rating: 'E', availability: ['E', 'F', 'X', 'X'], level: 'Experimental',
    dates: {
      is: { prototype: 2680, production: 2684, reintroduced: 2781 },
      clan: { production: 2684, reintroduced: 2801 },
    },
  }),
} as const;

export const QUADVEE_CONSTRUCTION_TECH = advancement({
  techBase: 'Clan', rating: 'F', availability: ['X', 'X', 'X', 'F'], level: 'Advanced',
  dates: { is: undefined, clan: { prototype: approx(3130), production: 3135 } },
});

const BATTLE_ARMOR_CONSTRUCTION_TECH = {
  exoskeleton: advancement({
    techBase: 'All', rating: 'C', availability: ['B', 'B', 'B', 'B'], level: 'Standard',
    dates: { prototype: approx(2100), common: approx(2200) },
  }),
  ultraLight: advancement({
    techBase: 'All', rating: 'D', availability: ['F', 'X', 'E', 'D'], level: 'Standard',
    dates: {
      is: { prototype: 2710, common: 3058, extinct: 2766, reintroduced: 2905 },
      clan: { prototype: 2710, common: 3058 },
    },
  }),
  light: advancement({
    techBase: 'All', rating: 'E', availability: ['X', 'F', 'E', 'D'], level: 'Standard',
    dates: {
      is: { production: 3050, common: 3050 },
      clan: { prototype: approx(2865), production: 2870, common: 2900 },
    },
  }),
  medium: advancement({
    techBase: 'All', rating: 'E', availability: ['X', 'D', 'D', 'D'], level: 'Standard',
    dates: {
      is: { prototype: 2864, production: 3052, common: 3052 },
      clan: { prototype: approx(2840), production: 2868, common: 2875 },
    },
  }),
  heavy: advancement({
    techBase: 'All', rating: 'E', availability: ['X', 'F', 'E', 'D'], level: 'Standard',
    dates: {
      is: { production: 3050, common: 3058 },
      clan: { prototype: approx(2867), production: 2875, common: 3058 },
    },
  }),
  assault: advancement({
    techBase: 'All', rating: 'E', availability: ['X', 'F', 'E', 'D'], level: 'Standard',
    dates: {
      is: { production: 3058, common: 3060 },
      clan: { prototype: approx(2870), production: 2877, common: 3060 },
    },
  }),
} as const;

export function getBattleArmorConstructionTech(
  weightClass: WeightClass,
  exoskeleton: boolean,
): TechAdvancement {
  if (exoskeleton) return BATTLE_ARMOR_CONSTRUCTION_TECH.exoskeleton;
  switch (weightClass) {
    case 'Ultra Light': return BATTLE_ARMOR_CONSTRUCTION_TECH.ultraLight;
    case 'Light': return BATTLE_ARMOR_CONSTRUCTION_TECH.light;
    case 'Heavy': return BATTLE_ARMOR_CONSTRUCTION_TECH.heavy;
    case 'Assault': return BATTLE_ARMOR_CONSTRUCTION_TECH.assault;
    case 'Medium':
    default: return BATTLE_ARMOR_CONSTRUCTION_TECH.medium;
  }
}

export const AEROSPACE_FIGHTER_CONSTRUCTION_TECH = advancement({
  techBase: 'All', rating: 'D', availability: ['C', 'E', 'D', 'C'], level: 'Standard',
  dates: { production: 2470, common: 2490 },
});

export const PRIMITIVE_AEROSPACE_FIGHTER_CONSTRUCTION_TECH = advancement({
  techBase: 'IS', rating: 'D', availability: ['D', 'X', 'F', 'F'], level: 'Advanced',
  dates: { prototype: DATE_ES, production: approx(2200), extinct: approx(2781) },
});

export const CONVENTIONAL_FIGHTER_CONSTRUCTION_TECH = advancement({
  techBase: 'All', rating: 'D', availability: ['C', 'D', 'C', 'B'], level: 'Standard',
  dates: { production: 2470, common: 2490 },
});

export const COMBAT_VEHICLE_CONSTRUCTION_TECH = advancement({
  techBase: 'All', rating: 'D', availability: ['C', 'C', 'C', 'B'], level: 'Introductory',
  dates: { production: 2470, common: 2490 },
});
