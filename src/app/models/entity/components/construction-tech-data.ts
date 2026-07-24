import {
  approx,
  DATE_ES,
  DATE_PS,
  type MotiveType,
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

const LAM_CONSTRUCTION_TECH = {
  Standard: advancement({
    techBase: 'IS', rating: 'D', availability: ['D', 'E', 'F', 'F'], level: 'Experimental',
    dates: {
      is: { prototype: 2683, production: 2688, extinct: 3085 },
      clan: { production: 2688, extinct: 2825 },
    },
  }),
  Bimodal: advancement({
    techBase: 'IS', rating: 'E', availability: ['E', 'F', 'X', 'X'], level: 'Experimental',
    dates: {
      is: { prototype: 2680, production: 2684, extinct: 2781 },
      clan: { production: 2684, extinct: 2801 },
    },
  }),
} as const;

const QUADVEE_CONSTRUCTION_TECH = advancement({
  techBase: 'Clan', rating: 'F', availability: ['X', 'X', 'X', 'F'], level: 'Advanced',
  dates: { is: undefined, clan: { prototype: approx(3130), production: 3135 } },
});

const PROTOMEK_CONSTRUCTION_TECH = {
  standard: advancement({
    techBase: 'Clan', rating: 'F', availability: ['X', 'X', 'E', 'D'], level: 'Standard',
    dates: { prototype: approx(3055), production: 3059, common: 3060 },
  }),
  quad: advancement({
    techBase: 'Clan', rating: 'F', availability: ['X', 'X', 'E', 'D'], level: 'Advanced',
    dates: { prototype: 3075, production: approx(3083), common: 3100 },
  }),
  ultraheavy: advancement({
    techBase: 'Clan', rating: 'F', availability: ['X', 'X', 'D', 'D'], level: 'Advanced',
    dates: { prototype: 3075, production: approx(3083), common: 3100 },
  }),
  glider: advancement({
    techBase: 'Clan', rating: 'F', availability: ['X', 'X', 'E', 'E'], level: 'Advanced',
    dates: { prototype: 3075, production: approx(3084), common: 3100 },
  }),
} as const;

const PROTOMEK_INTERFACE_COCKPIT_TECH = advancement({
  techBase: 'IS', rating: 'E', availability: ['X', 'X', 'F', 'X'], level: 'Experimental',
  dates: { prototype: approx(3071), reintroduced: 3085 },
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

const AEROSPACE_FIGHTER_CONSTRUCTION_TECH = advancement({
  techBase: 'All', rating: 'D', availability: ['C', 'E', 'D', 'C'], level: 'Standard',
  dates: { production: 2470, common: 2490 },
});

const PRIMITIVE_AEROSPACE_FIGHTER_CONSTRUCTION_TECH = advancement({
  techBase: 'IS', rating: 'D', availability: ['D', 'X', 'F', 'F'], level: 'Advanced',
  dates: { prototype: DATE_ES, production: approx(2200), extinct: approx(2781) },
});

const CONVENTIONAL_FIGHTER_CONSTRUCTION_TECH = advancement({
  techBase: 'All', rating: 'D', availability: ['C', 'D', 'C', 'B'], level: 'Standard',
  dates: { production: 2470, common: 2490 },
});

const COMBAT_VEHICLE_CONSTRUCTION_TECH = advancement({
  techBase: 'All', rating: 'D', availability: ['C', 'C', 'C', 'B'], level: 'Introductory',
  dates: { production: 2470, common: 2490 },
});

const SUPERHEAVY_COMBAT_VEHICLE_CONSTRUCTION_TECH = advancement({
  techBase: 'All', rating: 'C', availability: ['E', 'F', 'F', 'E'], level: 'Standard',
  dates: { prototype: approx(2470), common: approx(3075) },
});

const DUAL_TURRET_TECH = advancement({
  techBase: 'All', rating: 'B', availability: ['F', 'F', 'F', 'E'], level: 'Standard',
  dates: { prototype: DATE_PS, common: approx(3080) },
});

const VTOL_CHIN_TURRET_TECH = advancement({
  techBase: 'All', rating: 'B', availability: ['F', 'F', 'F', 'D'], level: 'Advanced',
  dates: { prototype: DATE_PS, production: approx(3079), common: 3080 },
});

const SMALL_CRAFT_CONSTRUCTION_TECH = advancement({
  techBase: 'All', rating: 'D', availability: ['D', 'E', 'D', 'D'], level: 'Standard',
  dates: { production: approx(2350), common: 2400 },
});

const PRIMITIVE_SMALL_CRAFT_CONSTRUCTION_TECH = advancement({
  techBase: 'IS', rating: 'D', availability: ['D', 'X', 'F', 'F'], level: 'Standard',
  dates: { prototype: DATE_ES, production: approx(2200), extinct: approx(2781) },
});

const DROPSHIP_CONSTRUCTION_TECH = advancement({
  techBase: 'All', rating: 'D', availability: ['D', 'E', 'D', 'D'], level: 'Standard',
  dates: { production: approx(2470), common: 2490 },
});

const PRIMITIVE_DROPSHIP_CONSTRUCTION_TECH = advancement({
  techBase: 'IS', rating: 'D', availability: ['D', 'X', 'X', 'X'], level: 'Standard',
  dates: { prototype: DATE_ES, production: approx(2200), extinct: 2500 },
});

const JUMPSHIP_CONSTRUCTION_TECH = advancement({
  techBase: 'All', rating: 'D', availability: ['D', 'E', 'D', 'F'], level: 'Advanced',
  dates: { production: approx(2300) },
});

const PRIMITIVE_JUMPSHIP_CONSTRUCTION_TECH = advancement({
  techBase: 'IS', rating: 'D', availability: ['D', 'X', 'X', 'X'], level: 'Advanced',
  dates: { prototype: approx(2100), production: approx(2200), extinct: 2500 },
});

const WARSHIP_CONSTRUCTION_TECH = advancement({
  techBase: 'All', rating: 'E', availability: ['D', 'E', 'E', 'F'], level: 'Advanced',
  dates: {
    is: { prototype: approx(2295), production: 2305, extinct: 2950, reintroduced: 3050 },
    clan: { prototype: approx(2295), production: 2305 },
  },
});

const SPACE_STATION_CONSTRUCTION_TECH = advancement({
  techBase: 'All', rating: 'D', availability: ['C', 'D', 'C', 'C'], level: 'Advanced',
  dates: { prototype: DATE_ES, production: DATE_ES },
});

const HANDHELD_WEAPON_CONSTRUCTION_TECH = advancement({
  techBase: 'All', rating: 'D', availability: ['E', 'E', 'F', 'E'], level: 'Experimental',
  dates: { prototype: 3055, production: approx(3083) },
});

export function getLamConstructionTech(configuration: 'Standard' | 'Bimodal'): TechAdvancement {
  return LAM_CONSTRUCTION_TECH[configuration];
}

export function getQuadVeeConstructionTech(): TechAdvancement {
  return QUADVEE_CONSTRUCTION_TECH;
}

export interface ProtoMekConstructionContext {
  readonly quad: boolean;
  readonly glider: boolean;
  readonly ultraheavy: boolean;
}

export function getProtoMekConstructionTech(context: ProtoMekConstructionContext): TechAdvancement {
  if (context.quad) return PROTOMEK_CONSTRUCTION_TECH.quad;
  if (context.glider) return PROTOMEK_CONSTRUCTION_TECH.glider;
  if (context.ultraheavy) return PROTOMEK_CONSTRUCTION_TECH.ultraheavy;
  return PROTOMEK_CONSTRUCTION_TECH.standard;
}

export function getProtoMekInterfaceCockpitTech(): TechAdvancement {
  return PROTOMEK_INTERFACE_COCKPIT_TECH;
}

export function getAerospaceFighterConstructionTech(primitive: boolean): TechAdvancement {
  return primitive
    ? PRIMITIVE_AEROSPACE_FIGHTER_CONSTRUCTION_TECH
    : AEROSPACE_FIGHTER_CONSTRUCTION_TECH;
}

export function getConventionalFighterConstructionTech(): TechAdvancement {
  return CONVENTIONAL_FIGHTER_CONSTRUCTION_TECH;
}

export function getCombatVehicleConstructionTech(superHeavy = false): TechAdvancement {
  return superHeavy
    ? SUPERHEAVY_COMBAT_VEHICLE_CONSTRUCTION_TECH
    : COMBAT_VEHICLE_CONSTRUCTION_TECH;
}

export function getDualTurretTech(): TechAdvancement {
  return DUAL_TURRET_TECH;
}

export function getVtolChinTurretTech(): TechAdvancement {
  return VTOL_CHIN_TURRET_TECH;
}

export function getSmallCraftConstructionTech(primitive: boolean): TechAdvancement {
  return primitive ? PRIMITIVE_SMALL_CRAFT_CONSTRUCTION_TECH : SMALL_CRAFT_CONSTRUCTION_TECH;
}

export function getDropshipConstructionTech(primitive: boolean): TechAdvancement {
  return primitive ? PRIMITIVE_DROPSHIP_CONSTRUCTION_TECH : DROPSHIP_CONSTRUCTION_TECH;
}

export function getJumpshipConstructionTech(primitive: boolean): TechAdvancement {
  return primitive ? PRIMITIVE_JUMPSHIP_CONSTRUCTION_TECH : JUMPSHIP_CONSTRUCTION_TECH;
}

export function getWarshipConstructionTech(primitive: boolean): TechAdvancement {
  return primitive ? PRIMITIVE_JUMPSHIP_CONSTRUCTION_TECH : WARSHIP_CONSTRUCTION_TECH;
}

export function getSpaceStationConstructionTech(): TechAdvancement {
  return SPACE_STATION_CONSTRUCTION_TECH;
}

export function getHandheldWeaponConstructionTech(): TechAdvancement {
  return HANDHELD_WEAPON_CONSTRUCTION_TECH;
}

function defineSupportConstructionTech(
  rating: TechAdvancement['rating'],
  availability: TechAdvancement['availability'],
  level: TechAdvancement['level'] = 'Standard',
  dates: TechAdvancement['dates'] = { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
): TechAdvancement {
  return advancement({ techBase: 'All', rating, availability, level, dates });
}

const SUPPORT_TANK_CONSTRUCTION_TECH = {
  hover: defineSupportConstructionTech('C', ['A', 'B', 'A', 'A'], 'Standard',
    { prototype: DATE_PS, production: DATE_ES, common: DATE_ES }),
  hoverLarge: defineSupportConstructionTech('C', ['B', 'C', 'B', 'B'], 'Standard',
    { prototype: DATE_PS, production: DATE_ES, common: DATE_ES }),
  naval: defineSupportConstructionTech('A', ['C', 'D', 'C', 'C']),
  navalLarge: defineSupportConstructionTech('A', ['C', 'E', 'D', 'D'], 'Advanced'),
  tracked: defineSupportConstructionTech('B', ['B', 'C', 'B', 'B']),
  trackedLarge: defineSupportConstructionTech('B', ['C', 'D', 'C', 'C']),
  wheeledSmall: defineSupportConstructionTech('A', ['A', 'A', 'A', 'A']),
  wheeledMedium: defineSupportConstructionTech('A', ['A', 'B', 'A', 'A']),
  wheeledLarge: defineSupportConstructionTech('A', ['B', 'C', 'B', 'B']),
  wige: defineSupportConstructionTech('C', ['B', 'C', 'B', 'B'], 'Standard',
    { prototype: DATE_ES, production: DATE_ES, common: DATE_ES }),
  wigeLarge: defineSupportConstructionTech('C', ['C', 'D', 'C', 'C'], 'Standard',
    { prototype: DATE_ES, production: DATE_ES, common: DATE_ES }),
  rail: defineSupportConstructionTech('A', ['C', 'C', 'C', 'C'], 'Advanced'),
  railLarge: defineSupportConstructionTech('A', ['C', 'D', 'D', 'D'], 'Advanced'),
} as const;

export function getSupportTankConstructionTech(
  motiveType: MotiveType,
  weightClass: WeightClass,
): TechAdvancement {
  const large = weightClass === 'Large Support';
  switch (motiveType) {
    case 'Hover': return large ? SUPPORT_TANK_CONSTRUCTION_TECH.hoverLarge : SUPPORT_TANK_CONSTRUCTION_TECH.hover;
    case 'Naval':
    case 'Hydrofoil':
    case 'Submarine': return large ? SUPPORT_TANK_CONSTRUCTION_TECH.navalLarge : SUPPORT_TANK_CONSTRUCTION_TECH.naval;
    case 'Wheeled':
      return large ? SUPPORT_TANK_CONSTRUCTION_TECH.wheeledLarge
        : weightClass === 'Medium Support' ? SUPPORT_TANK_CONSTRUCTION_TECH.wheeledMedium
        : SUPPORT_TANK_CONSTRUCTION_TECH.wheeledSmall;
    case 'WiGE': return large ? SUPPORT_TANK_CONSTRUCTION_TECH.wigeLarge : SUPPORT_TANK_CONSTRUCTION_TECH.wige;
    case 'Rail':
    case 'MagLev': return large ? SUPPORT_TANK_CONSTRUCTION_TECH.railLarge : SUPPORT_TANK_CONSTRUCTION_TECH.rail;
    case 'Tracked':
    default: return large ? SUPPORT_TANK_CONSTRUCTION_TECH.trackedLarge : SUPPORT_TANK_CONSTRUCTION_TECH.tracked;
  }
}

const SUPPORT_VTOL_CONSTRUCTION_TECH = defineSupportConstructionTech(
  'C', ['D', 'E', 'D', 'D'], 'Standard',
  { prototype: DATE_PS, production: DATE_ES, common: DATE_ES },
);
const LARGE_SUPPORT_VTOL_CONSTRUCTION_TECH = defineSupportConstructionTech(
  'C', ['C', 'D', 'C', 'C'], 'Standard',
  { prototype: DATE_PS, production: DATE_ES, common: DATE_ES },
);

export function getSupportVtolConstructionTech(weightClass: WeightClass): TechAdvancement {
  return weightClass === 'Large Support'
    ? LARGE_SUPPORT_VTOL_CONSTRUCTION_TECH
    : SUPPORT_VTOL_CONSTRUCTION_TECH;
}

const FIXED_WING_SUPPORT_CONSTRUCTION_TECH = {
  fixed: defineSupportConstructionTech('B', ['C', 'D', 'C', 'C']),
  fixedLarge: defineSupportConstructionTech('B', ['D', 'E', 'D', 'D']),
  airshipSmall: defineSupportConstructionTech('A', ['C', 'D', 'C', 'C']),
  airshipMedium: defineSupportConstructionTech('B', ['D', 'E', 'D', 'D']),
  airshipLarge: defineSupportConstructionTech('C', ['D', 'E', 'D', 'D'], 'Advanced'),
  satelliteSmall: defineSupportConstructionTech('C', ['C', 'D', 'C', 'C'], 'Advanced',
    { prototype: DATE_ES, production: DATE_ES, common: DATE_ES }),
  satelliteMedium: defineSupportConstructionTech('C', ['C', 'D', 'D', 'D'], 'Advanced',
    { prototype: DATE_ES, production: DATE_ES, common: DATE_ES }),
  satelliteLarge: defineSupportConstructionTech('C', ['D', 'E', 'D', 'D'], 'Advanced',
    { prototype: DATE_ES, production: DATE_ES, common: DATE_ES }),
} as const;

export function getFixedWingSupportConstructionTech(
  motiveType: MotiveType,
  weightClass: WeightClass,
): TechAdvancement {
  if (motiveType === 'Airship') {
    return weightClass === 'Large Support' ? FIXED_WING_SUPPORT_CONSTRUCTION_TECH.airshipLarge
      : weightClass === 'Medium Support' ? FIXED_WING_SUPPORT_CONSTRUCTION_TECH.airshipMedium
      : FIXED_WING_SUPPORT_CONSTRUCTION_TECH.airshipSmall;
  }
  if (motiveType === 'Station Keeping') {
    return weightClass === 'Large Support' ? FIXED_WING_SUPPORT_CONSTRUCTION_TECH.satelliteLarge
      : weightClass === 'Medium Support' ? FIXED_WING_SUPPORT_CONSTRUCTION_TECH.satelliteMedium
      : FIXED_WING_SUPPORT_CONSTRUCTION_TECH.satelliteSmall;
  }
  return weightClass === 'Large Support'
    ? FIXED_WING_SUPPORT_CONSTRUCTION_TECH.fixedLarge
    : FIXED_WING_SUPPORT_CONSTRUCTION_TECH.fixed;
}
