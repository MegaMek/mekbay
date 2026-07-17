import {
  DATE_ES,
  DATE_PS,
  type InfantrySpecialization,
  type MotiveType,
  type TechAdvancement,
} from '../types';

const defineInfantryTech = (data: Omit<TechAdvancement, 'factions'>): TechAdvancement => data;

const CONVENTIONAL_INFANTRY_CONSTRUCTION_TECH = defineInfantryTech({
  techBase: 'All', rating: 'C', availability: ['A', 'A', 'A', 'A'], level: 'Standard',
  dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
});

const CONVENTIONAL_INFANTRY_PLATOON_TECH = defineInfantryTech({
  techBase: 'All', rating: 'D', availability: ['D', 'D', 'D', 'D'], level: 'Standard',
  dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
});

const INFANTRY_MOTIVE_TECH = {
  Leg: defineInfantryTech({
    techBase: 'All', rating: 'A', availability: ['A', 'A', 'A', 'A'], level: 'Standard',
    dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
  }),
  Motorized: defineInfantryTech({
    techBase: 'All', rating: 'B', availability: ['A', 'A', 'A', 'A'], level: 'Standard',
    dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
  }),
  Jump: defineInfantryTech({
    techBase: 'All', rating: 'D', availability: ['B', 'B', 'B', 'B'], level: 'Standard',
    dates: { prototype: DATE_ES, production: DATE_ES, common: DATE_ES },
  }),
  UMU: defineInfantryTech({
    techBase: 'All', rating: 'B', availability: ['D', 'D', 'D', 'D'], level: 'Advanced',
    dates: { prototype: DATE_PS, production: DATE_PS },
  }),
  Wheeled: defineInfantryTech({
    techBase: 'All', rating: 'A', availability: ['A', 'B', 'A', 'A'], level: 'Standard',
    dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
  }),
  Tracked: defineInfantryTech({
    techBase: 'All', rating: 'B', availability: ['B', 'C', 'B', 'B'], level: 'Standard',
    dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
  }),
  Hover: defineInfantryTech({
    techBase: 'All', rating: 'C', availability: ['A', 'B', 'A', 'B'], level: 'Standard',
    dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
  }),
  VTOL: defineInfantryTech({
    techBase: 'All', rating: 'C', availability: ['C', 'D', 'D', 'C'], level: 'Advanced',
    dates: { prototype: DATE_ES, production: DATE_ES },
  }),
  Submarine: defineInfantryTech({
    techBase: 'All', rating: 'C', availability: ['D', 'D', 'D', 'D'], level: 'Advanced',
    dates: { prototype: DATE_PS, production: DATE_PS },
  }),
  Beast: defineInfantryTech({
    techBase: 'All', rating: 'A', availability: ['A', 'A', 'A', 'A'], level: 'Advanced',
    dates: { prototype: DATE_PS, production: DATE_PS },
  }),
} as const;

export function getInfantryMotiveTech(motiveType: MotiveType): TechAdvancement {
  return INFANTRY_MOTIVE_TECH[motiveType as keyof typeof INFANTRY_MOTIVE_TECH]
    ?? INFANTRY_MOTIVE_TECH.Leg;
}

export function getConventionalInfantryConstructionTech(
  motiveType: MotiveType,
  hasFieldEquipment: boolean,
  hasEncumberingArmor: boolean,
): TechAdvancement {
  const dismounted = motiveType === 'Leg'
    || motiveType === 'Motorized'
    || motiveType === 'Jump'
    || motiveType === 'UMU';
  return dismounted && !hasFieldEquipment && !hasEncumberingArmor
    ? CONVENTIONAL_INFANTRY_PLATOON_TECH
    : CONVENTIONAL_INFANTRY_CONSTRUCTION_TECH;
}

const COMBAT_ENGINEER_SPECIALIZATIONS: ReadonlySet<InfantrySpecialization> = new Set([
  'bridge-engineers', 'demo-engineers', 'fire-engineers',
  'mine-engineers', 'sensor-engineers', 'trench-engineers',
]);

const COMBAT_ENGINEER_TECH = defineInfantryTech({
  techBase: 'All', rating: 'C', availability: ['A', 'B', 'A', 'A'], level: 'Advanced',
  dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
});
const MARINE_TECH = defineInfantryTech({
  techBase: 'All', rating: 'C', availability: ['A', 'A', 'A', 'A'], level: 'Advanced',
  dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
});
const MOUNTAIN_OR_PARATROOPER_TECH = defineInfantryTech({
  techBase: 'All', rating: 'B', availability: ['A', 'A', 'A', 'A'], level: 'Advanced',
  dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
});
const PARAMEDIC_TECH = defineInfantryTech({
  techBase: 'All', rating: 'B', availability: ['C', 'C', 'C', 'C'], level: 'Advanced',
  dates: { prototype: DATE_PS, production: DATE_PS, common: DATE_PS },
});
const TAG_TROOPS_TECH = defineInfantryTech({
  techBase: 'All', rating: 'E', availability: ['F', 'X', 'E', 'E'], level: 'Advanced',
  dates: {
    is: { prototype: 2585, production: 2600, extinct: 2535, reintroduced: 3037 },
    clan: { prototype: 2585, production: 2600 },
  },
});

export function getInfantrySpecializationTech(
  specializations: ReadonlySet<InfantrySpecialization>,
): readonly TechAdvancement[] {
  const result: TechAdvancement[] = [];
  if ([...specializations].some(value => COMBAT_ENGINEER_SPECIALIZATIONS.has(value))) {
    result.push(COMBAT_ENGINEER_TECH);
  }
  if (specializations.has('marines')) result.push(MARINE_TECH);
  if (specializations.has('mountain-troops')) result.push(MOUNTAIN_OR_PARATROOPER_TECH);
  if (specializations.has('paratroops')) result.push(MOUNTAIN_OR_PARATROOPER_TECH);
  if (specializations.has('paramedics')) result.push(PARAMEDIC_TECH);
  if (specializations.has('tag-troops')) result.push(TAG_TROOPS_TECH);
  return result;
}
