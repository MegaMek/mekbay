// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, WeaponEquipment } from '../../../equipment.model';
import { isHeatSinkEquipment } from '../../../heat-equipment.model';
import type { StaticEmplacementEntity } from '../../entities/misc/static-emplacement-entity';
import { buildingLocationName, type BuildingHex } from '../../types/building';
import { buildingElevatorWeight } from '../building-construction';
import { ceilToHalfTon } from './weight-rounding';

/** TO:AR pp. 128–129, TO:AUE p. 83. Armor and mechanisms are counted once per hex. */
export function calculateBuildingHexWeight(entity: StaticEmplacementEntity, hex: BuildingHex) {
  const armor = Math.ceil(
    entity.getArmorValue(buildingLocationName(hex, 0)) * entity.cfScale() / (entity.techBase() === 'Clan' ? 20 : 16),
  ) * entity.segmentsInHex(hex);
  let weapons = 0,
    ammo = 0,
    miscellaneous = 0,
    heatSinks = 0;
  let energyWeapons = 0,
    capitalControls = 0,
    turretPayload = 0,
    pintle = 0,
    smallItems = 0;
  for (const mount of entity.getEquipmentInHex(hex)) {
    const equipment = mount.equipment;
    if (!equipment || mount.getTonnage(entity) === undefined) throw new Error(`Unable to calculate tonnage for ${mount.equipmentId}`);
    const tons = entity.equipmentWeightInHex(mount, hex);
    if (equipment instanceof WeaponEquipment && equipment.isInfantryWeapon()
      || equipment instanceof AmmoEquipment && equipment.ammoType === 'INFANTRY'
      || (mount.getTonnage(entity) ?? 0) < .5) smallItems += tons;
    if (equipment instanceof AmmoEquipment) ammo += tons;
    else if (equipment instanceof WeaponEquipment) {
      weapons += tons;
      if ((equipment.capital || equipment.subCapital) && !equipment.hasFlag('F_MISSILE')) capitalControls += tons * 0.1;
      if (equipment.hasFlag('F_ENERGY') && !equipment.isInfantryWeapon()
        && (mount.getTonnage(entity) ?? 0) >= (entity.isMobile() ? .5 : .25)) energyWeapons += tons;
    } else if (isHeatSinkEquipment(equipment)) heatSinks += tons;
    else miscellaneous += tons;
    if (!(equipment instanceof AmmoEquipment)) {
      if (mount.turretType === 'sponson' && !isHeatSinkEquipment(equipment)) turretPayload += tons;
      if (mount.turretType === 'pintle') pintle += Math.ceil(tons * 50) / 1000;
    }
  }
  const powerAmplifiers = entity.powerSupply().nuclear ? 0
    : entity.isMobile() ? Math.ceil(energyWeapons / 5) / 2 : Math.ceil(energyWeapons) / 10;
  const turret = Math.ceil(turretPayload / 5) / 2;
  const elevators = entity.elevators().filter(lift => lift.hex.q === hex.q && lift.hex.r === hex.r).reduce((sum, lift) => sum + buildingElevatorWeight(lift), 0);
  const carryingSpace = entity.transporters().reduce((sum, transporter) => sum + (transporter.kind === 'troop-space'
    ? transporter.totalSpace / entity.coordinates().length : transporter.kind === 'bay'
      ? entity.baySpaces(transporter).filter(space => space.position.hex.q === hex.q && space.position.hex.r === hex.r).reduce((total, space) => total + space.tons, 0) : 0), 0);
  const systems = entity.mobileSystems();
  const powerSystem = entity.isMobile() ? systems.powerPerHex : 0;
  const motiveSystem = entity.isMobile() ? systems.motivePerHex : 0;
  const fuel = entity.isMobile() ? entity.fuelInHex(hex) : 0;
  const sealing = entity.isMobile() ? systems.sealingPerHex : 0;
  // TO:AUE pp. 71, 83–84: aggregate kilogram items, including pintles, before half-ton rounding.
  // Cargo may use the loose kilograms instead of wasting that remaining capacity.
  const smallItemsRounding = entity.isMobile() && smallItems + pintle > 0
    ? Math.max(0, ceilToHalfTon(smallItems + pintle + carryingSpace) - smallItems - pintle - carryingSpace) : 0;
  const exact = armor + weapons + ammo + miscellaneous + heatSinks + powerAmplifiers + capitalControls + turret + pintle + elevators + carryingSpace
    + powerSystem + motiveSystem + fuel + sealing + smallItemsRounding;
  return { hex, armor, weapons, ammo, miscellaneous, heatSinks, powerAmplifiers, capitalControls, turret, pintle, elevators, carryingSpace,
    powerSystem, motiveSystem, fuel, sealing, smallItemsRounding, exact };
}

export function calculateBuildingWeightBreakdown(entity: StaticEmplacementEntity) {
  const hexes = entity.hexLoads();
  const sum = (key: Exclude<keyof (typeof hexes)[number], 'hex'>) => hexes.reduce((total, hex) => total + hex[key], 0);
  const exact = sum('exact');
  return {
    armor: sum('armor'),
    weapons: sum('weapons'),
    ammo: sum('ammo'),
    miscellaneous: sum('miscellaneous'),
    heatSinks: sum('heatSinks'),
    powerAmplifiers: sum('powerAmplifiers'),
    capitalControls: sum('capitalControls'),
    turret: sum('turret'),
    pintle: sum('pintle'),
    elevators: sum('elevators'),
    carryingSpace: sum('carryingSpace'),
    powerSystem: sum('powerSystem'),
    motiveSystem: sum('motiveSystem'),
    fuel: sum('fuel'),
    sealing: sum('sealing'),
    smallItemsRounding: sum('smallItemsRounding'),
    exact,
    rounded: exact,
  };
}
