// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EntityValidationMessage, EntityTransportBay, MotiveType } from '../../types';
import { buildingLimits, buildingHexKey } from '../../types/building';
import type { StaticEmplacementEntity } from './static-emplacement-entity';
import { isQuartersBay } from '../../bays/bay-definitions';

/** TO:AUE pp. 76–81. Order in the power rows is ground, air, naval, submarine. */
export const MOBILE_POWER_SYSTEMS = {
  STEAM: { label: 'Steam', is: [6, 6, 6, 7], clan: [7, 7, 7, 8], fuel: .04, cost: 4000 },
  COMBUSTION_LIQUID: { label: 'Internal combustion (liquid)', is: [3, 3, 3, 3.2], clan: [3, 3, 3, 3], fuel: .02, cost: 5000 },
  COMBUSTION_SOLID: { label: 'Internal combustion (solid)', is: [3, 3, 3, 3.2], clan: [3, 3, 3, 3], fuel: .02, cost: 5000 },
  FUEL_CELL: { label: 'Fuel cell', is: [4, 4.4, 4, 5], clan: [4, 4.2, 4, 4.4], fuel: .02, cost: 7000 },
  FISSION: { label: 'Fission', is: [3, 3, 3, 3], clan: [4, 4, 4, 4], fuel: 0, cost: 15000 },
  FUSION: { label: 'Fusion', is: [2, 2, 2, 2.2], clan: [1.8, 1.8, 1.8, 2], fuel: 0, cost: 10000 },
} as const;
export type MobilePowerSystem = keyof typeof MOBILE_POWER_SYSTEMS;
export const MOBILE_MOTIVE_TYPES = ['Tracked', 'VTOL', 'Naval', 'Submarine'] as const;
// Discard multiplication noise only, so 1470.0000000000002 t is 1470, while actual fractional tons round up.
const wholeTons = (value: number) => Math.ceil(value - 4 * Number.EPSILON * Math.abs(value));

export function mobileStructureLimits(type: number, classification: number) {
  if (![0, 1, 2].includes(classification)) return null;
  const limits = buildingLimits(type, classification);
  return !limits ? null : classification === 1 && type === 2 ? { ...limits, maximumCF: 20 }
    : classification === 1 && type === 3 ? { ...limits, minimumCF: 21 } : limits;
}

export function mobileMaximumMP(motive: MotiveType): number {
  return motive === 'Tracked' ? 2 : motive === 'Naval' ? 3 : motive === 'VTOL' || motive === 'Submarine' ? 4 : 0;
}

export function mobileBaseCrew(entity: StaticEmplacementEntity): number {
  const classification = entity.buildingClass() ?? 0, motive = entity.motiveType();
  const count = classification === 1 ? (motive === 'VTOL' || motive === 'Submarine' ? 3 : 2)
    : classification === 0 ? (motive === 'VTOL' || motive === 'Submarine' ? 4 : 3)
      : motive === 'Naval' ? 5 : motive === 'Submarine' ? 6 : motive === 'Tracked' ? 4 : 0;
  return count * entity.coordinates().length;
}

export function mobileSystemWeights(entity: StaticEmplacementEntity) {
  const count = entity.coordinates().length, height = entity.height() ?? 1, clan = entity.techBase() === 'Clan';
  const index = MOBILE_MOTIVE_TYPES.indexOf(entity.motiveType() as typeof MOBILE_MOTIVE_TYPES[number]);
  const power = MOBILE_POWER_SYSTEMS[entity.mobilePowerSystem()];
  const powerTons = wholeTons(count * height * entity.originalWalkMP() * (index < 0 ? 0 : (clan ? power.clan : power.is)[index]));
  const motiveTons = wholeTons(count * height * (index < 0 ? 0 : (clan ? [3.5, 4, 1.8, 3.5] : [4, 5, 2, 3.5])[index])
    * (entity.buildingClass() === 1 ? .3 : entity.buildingClass() === 0 ? .5 : 1));
  // p. 79 rounds each distributed system separately, after computing its total.
  const powerPerHex = count ? Math.ceil(powerTons / count * 2) / 2 : 0;
  const motivePerHex = count ? Math.ceil(motiveTons / count * 2) / 2 : 0;
  const fuel = wholeTons(entity.operatingRange() / 100 * power.fuel * powerTons);
  // Submersible motive systems already include sealing (p. 81).
  const sealingPerHex = entity.motiveType() !== 'Submarine' && entity.hasEnvironmentalSealing()
    ? Math.ceil((entity.constructionFactor() ?? 0) * height / 10) : 0;
  return { power: powerTons, motive: motiveTons, fuel, powerPerHex, motivePerHex, sealingPerHex };
}

export function mobileStructureValidation(entity: StaticEmplacementEntity): EntityValidationMessage[] {
  const issues: EntityValidationMessage[] = [];
  const add = (code: string, message: string) => issues.push({ severity: 'error', category: 'structure', code, message });
  const max = mobileMaximumMP(entity.motiveType()), mp = entity.originalWalkMP();
  if (entity.coordinates().length < 2) add('MOBILE_MINIMUM_SIZE', 'Mobile Structures require at least two connected hexes.');
  if (!max || !Number.isFinite(mp) || mp < .25 || mp > max || !Number.isInteger(mp * 4)
    || (entity.buildingClass() === 2 && entity.motiveType() === 'VTOL'))
    add('MOBILE_MOVEMENT', 'Choose an allowed motive system and maximum MP in quarter-point increments; Fortresses cannot fly.');
  if (entity.buildingOptions().site !== 'SURFACE')
    add('MOBILE_SITE', 'Mobile Structures use their motive system rather than a fixed underground or underwater site.');
  const options = entity.buildingOptions();
  if (entity.buildingClass() === 1 && options.openSpace) {
    const keys = new Set(entity.coordinates().map(buildingHexKey));
    const hex2 = entity.portalHex2(), hex3 = entity.portalHex3();
    if (!hex2 || !hex3 || !keys.has(buildingHexKey(hex2)) || !keys.has(buildingHexKey(hex3))
      || buildingHexKey(hex2) === buildingHexKey(hex3))
      add('MOBILE_PORTAL_TEMPLATES', 'Choose two distinct occupied hexes as the Large Portal Hex 2 and Hex 3 equipment templates (TO:AUE p. 76).');
  }
  if (options.heavyMetal || options.ceiling !== 'STANDARD' || options.tunnel || options.roofClearance || options.baseLevel !== null)
    add('MOBILE_STATIC_OPTIONS', 'Heavy-metal construction, ceiling variants, tunnels, cave clearance and custom ground references apply to static buildings.');
  if (entity.coordinates().some(hex => !Number.isSafeInteger(entity.hexHeight(hex)) || entity.hexHeight(hex) < 1)
    || Math.max(...entity.coordinates().map(hex => entity.hexHeight(hex))) !== entity.height())
    add('MOBILE_HEX_HEIGHT', 'Each hex needs a positive whole height; maximum height must equal the tallest hex.');
  if (!Number.isFinite(entity.operatingRange()) || entity.operatingRange() < 0
    || (MOBILE_POWER_SYSTEMS[entity.mobilePowerSystem()].fuel > 0 && entity.operatingRange() === 0))
    add('MOBILE_FUEL_RANGE', 'A fuel-burning Mobile Structure needs a positive operating range.');
  const allocations = entity.fuelLocations();
  if (allocations.size) {
    const keys = new Set(entity.coordinates().map(buildingHexKey));
    if ([...allocations].some(([key, tons]) => !keys.has(key) || !Number.isFinite(tons) || tons < 0)
      || Math.abs([...allocations.values()].reduce((sum, tons) => sum + tons, 0) - entity.mobileSystems().fuel) > .00001)
      add('MOBILE_FUEL_ALLOCATION', `Allocate exactly ${entity.mobileSystems().fuel} t of fuel among occupied hexes.`);
  }
  const bays = entity.transporters().filter((bay): bay is EntityTransportBay => bay.kind === 'bay' && !isQuartersBay(bay));
  const exterior = entity.coordinates().reduce((sum, hex) => sum + entity.exteriorSides(hex).length, 0);
  const maxDoors = Math.floor(exterior / 2) * (entity.buildingClass() === 1 ? 2 : 1);
  const bayDoors = bays.reduce((sum, bay) => sum + bay.doors, 0);
  if ((bays.length > 0 && bayDoors < 1) || bayDoors > maxDoors)
    add('MOBILE_BAY_DOORS', `A Mobile Structure with transport bays requires at least one door; this footprint permits at most ${maxDoors} bay doors (TO:AUE p. 84).`);
  const armor = new Set([...entity.armorValues().values()].map(value => value.front));
  if (armor.size > 1) add('MOBILE_UNIFORM_ARMOR', 'Every hex of a Mobile Structure must have the same armor points.');
  for (const hex of entity.coordinates()) {
    const links = entity.getEquipmentInHex(hex).filter(mount => mount.equipmentId === 'Modular Structure Linkage');
    if (links.length > 1 || links.length && !entity.exteriorSides(hex).length)
      add('MOBILE_LINKAGE_LOCATION', 'A linkage occupies one exterior hex; a hex cannot contain multiple linkages.');
  }
  return issues;
}
