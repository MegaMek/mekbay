// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { StaticEmplacementEntity } from './static-emplacement-entity';
import type { EntityValidationMessage } from '../../types';
import { buildingHexKey, buildingNeighbors, buildingLocationName, parseBuildingLocation, type BuildingLocation } from '../../types/building';
import { buildingCanAutomate, buildingCanSpread, buildingCapitalWeapon, buildingElevatorRange, buildingRoofFacility } from '../../utils/building-construction';
import { getBayConstructionWeight } from '../../bays/bay-definitions';

/** Construction checks for authored placements, matching MegaMek's TestBuilding. */
export function buildingDesignValidation(entity: StaticEmplacementEntity): EntityValidationMessage[] {
  const issues: EntityValidationMessage[] = [];
  const add = (code: string, message: string) => issues.push({ severity: 'error', category: 'structure', code, message });
  const hexes = new Set(entity.coordinates().map(buildingHexKey));
  const height = entity.height() ?? 1;
  const valid = (position: BuildingLocation) => hexes.has(buildingHexKey(position.hex)) && position.floor >= 0 && position.floor < entity.hexHeight(position.hex);
  const doors = new Set<string>();
  for (const door of entity.doors()) {
    const key = `${buildingHexKey(door.position.hex)}/${door.facing}`;
    if (!valid(door.position) || door.height < 1 || door.position.floor + door.height > entity.hexHeight(door.position.hex)
      || door.facing < 0 || door.facing > 5 || doors.has(key) || entity.hasNoInterior() || entity.buildingClass() === 3
      || hexes.has(buildingHexKey(buildingNeighbors(door.position.hex)[door.facing] ?? door.position.hex)))
      add('BUILDING_DOOR', 'Doors need a unique exterior hexside and must fit within the building height.');
    doors.add(key);
  }
  const bays = entity.transporters().filter(bay => bay.kind === 'bay');
  const baySides = new Map<string, number>();
  for (const door of entity.bayDoors()) {
    const key = `${buildingHexKey(door.position.hex)}/${door.facing}`;
    const sideCount = (baySides.get(key) ?? 0) + 1;
    baySides.set(key, sideCount);
    if (!bays.some(bay => bay.id === door.bayId) || !valid(door.position) || !Number.isInteger(door.facing)
      || door.facing < 0 || door.facing > 5 || entity.hasNoInterior()
      || hexes.has(buildingHexKey(buildingNeighbors(door.position.hex)[door.facing] ?? door.position.hex))
      || (entity.isMobile() && sideCount > (entity.buildingClass() === 1 ? 2 : 1)))
      add('BUILDING_BAY_DOOR', 'Bay doors must belong to an existing bay on a valid exterior hexside. Mobile Structures allow one door per side, or two for Hangars.');
  }
  if (entity.bayDoors().length) for (const bay of bays) {
    if (entity.bayDoors().filter(door => door.bayId === bay.id).length !== bay.doors)
      add('BUILDING_BAY_DOOR_COUNT', `Bay ${bay.bayNumber}: assign exactly ${bay.doors} bay door positions.`);
  }
  for (const lift of entity.elevators()) {
    const [lower, upper] = buildingElevatorRange(lift), key = buildingHexKey(lift.hex);
    if (entity.hasNoInterior() || !hexes.has(key) || lift.capacity <= 0
      || lift.capacity > (entity.constructionFactor() ?? 0) * entity.cfScale()
      || lift.exits.size < 2 || lower < 0 || upper > entity.hexHeight(lift.hex) || lift.exits.size !== upper - lower + 1)
      add('BUILDING_ELEVATOR', 'An elevator needs at least two consecutive levels and positive capacity no greater than standard-scale CF.');
    if (entity.elevators().some(other => other !== lift && buildingHexKey(other.hex) === key
      && buildingElevatorRange(other)[0] <= upper && buildingElevatorRange(other)[1] >= lower))
      add('BUILDING_ELEVATOR_OVERLAP', 'Elevator shafts cannot overlap within a hex.');
    for (const [floor, mask] of lift.exits) {
      if (mask < 1 || mask > 63 || buildingNeighbors(lift.hex).some((neighbor, side) =>
        !!(mask & (1 << side)) && (!hexes.has(buildingHexKey(neighbor)) || floor > entity.hexHeight(neighbor))))
        add('BUILDING_ELEVATOR_ACCESS', 'Every elevator stop needs access through an internal hexside.');
    }
    const inShaft = (position: BuildingLocation) => buildingHexKey(position.hex) === key && position.floor >= lower && position.floor <= upper;
    if (entity.getEquipmentInHex(lift.hex).some(mount => entity.equipmentPositions(mount).some(position => inShaft(position)
      || (buildingHexKey(position.hex) === key && upper === entity.hexHeight(lift.hex) && (mount.turretType === 'sponson' || buildingRoofFacility(mount.equipment)))))
      || bays.some(bay => entity.baySpaces(bay).some(space => space.tons > 0 && inShaft(space.position))))
      add('BUILDING_ELEVATOR_OCCUPIED', 'Elevator shafts must be clear of equipment and allocated bay/quarters space.');
  }
  if (entity.buildingOptions().openSpace && (entity.elevators().length
    || bays.some(bay => entity.baySpaces(bay).some(space => space.tons > 0 && space.position.floor !== 0))))
    add('BUILDING_OPEN_SPACE_PLACEMENT', 'Open-space construction permits bays on the lowest floor and no internal elevators.');
  if (entity.buildingOptions().tunnel && (entity.buildingClass() !== 1 || entity.equipment().length
    || entity.transporters().length || entity.elevators().length || entity.doors().length < 2))
    add('BUILDING_TUNNEL', 'Tunnels use Hangar construction with at least two connection doors and no equipment, bays or elevators.');
  const options = entity.buildingOptions();
  const reservedRoof = (options.site === 'UNDERGROUND' && !options.roofClearance)
    || entity.equipment().some(mount => ['SOLAR PowerGenerator', 'EXTERNAL_PCMT PowerGenerator'].includes(mount.equipmentId));
  for (const hex of entity.coordinates()) {
    const mounts = entity.getEquipmentInHex(hex);
    const decks = mounts.filter(mount => buildingRoofFacility(mount.equipment));
    const turrets = mounts.some(mount => mount.turretType === 'sponson');
    if (decks.length > 1 || (decks.length && turrets))
      add('BUILDING_ROOF_SPACE', `Hex ${entity.displayHex(hex)} cannot share roof space between decks, helipads or turrets.`);
    if ((reservedRoof && (decks.length || turrets)) || (decks.length && mounts.some(mount => buildingCapitalWeapon(mount.equipment))))
      add('BUILDING_RESERVED_ROOF', `Hex ${entity.displayHex(hex)} has no roof space available for these facilities or turrets.`);
  }
  if (entity.equipment().filter(mount => mount.equipmentId === 'Building Landing Deck').length > 1)
    add('BUILDING_LANDING_DECK_COUNT', 'A building may mount only one landing deck.');
  for (const mount of entity.equipment()) {
    const design = entity.equipmentDesign().get(mount.mountId);
    if (buildingRoofFacility(mount.equipment)) {
      const positions = entity.equipmentPositions(mount), covered = new Set(positions.map(position => buildingHexKey(position.hex)));
      if (positions.some(position => position.floor !== entity.hexHeight(position.hex) - 1))
        add('BUILDING_ROOF_LEVEL', 'Decks and helipads must be assigned to the highest internal level, below the roof.');
      if (mount.equipmentId === 'Building Flight Deck' && !(covered.size === 3 && positions.some(position => {
        const neighbors = buildingNeighbors(position.hex);
        return neighbors.slice(0, 3).some((neighbor, side) => covered.has(buildingHexKey(neighbor))
          && covered.has(buildingHexKey(neighbors[side + 3])));
      }))) add('BUILDING_FLIGHT_DECK', 'A flight deck requires three consecutive roof hexes in a straight line.');
      if (mount.equipmentId === 'Building Landing Deck') {
        const radius = covered.size === 7 ? 1 : covered.size === 19 ? 2 : covered.size === 37 ? 3 : 0;
        const anchor = parseBuildingLocation(mount.location)?.hex;
        if (!radius || mount.size !== covered.size || !anchor || positions.some(({ hex }) =>
          Math.max(Math.abs(hex.q - anchor.q), Math.abs(hex.r - anchor.r), Math.abs(hex.q + hex.r - anchor.q - anchor.r)) > radius))
          add('BUILDING_LANDING_DECK', 'A landing deck needs 7, 19 or 37 roof hexes filling a radius of 1, 2 or 3 around its primary hex.');
      }
    }
    if (mount.equipmentId === 'EXTERNAL_PCMT PowerGenerator' && (!design || design.pcmtSource <= 0 || entity.coordinates().length < Math.ceil(design.pcmtSource * 5)))
      add('BUILDING_PCMT', 'A PCMT receiver requires its transmitter tonnage and five roof hexes per transmitter ton, rounded up.');
    if (!design) continue;
    if (design.automated && !buildingCanAutomate(mount.equipment))
      add('BUILDING_AUTOMATION', 'Only heavy weapons requiring gunners, excluding capital weapons and artillery, can be automated.');
    if (design.positions.length) {
      const anchor = parseBuildingLocation(mount.location);
      if (!buildingCanSpread(mount.equipment) || !anchor || !design.positions.some(position => buildingLocationName(position.hex, position.floor) === mount.location)
        || new Set(design.positions.map(position => buildingHexKey(position.hex))).size !== design.positions.length || design.positions.some(position => !valid(position)))
        add('BUILDING_EQUIPMENT_SPACE', 'Spreadable equipment needs unique occupied hexes including its primary location.');
      if (anchor && buildingCapitalWeapon(mount.equipment) && design.positions.length > 1) {
        const adjacent = buildingNeighbors(anchor.hex).filter(hex => hexes.has(buildingHexKey(hex))).map(buildingHexKey);
        const assigned = new Set(design.positions.map(position => buildingHexKey(position.hex)));
        if (adjacent.some(key => !assigned.has(key)) || [...assigned].some(key => key !== buildingHexKey(anchor.hex) && !adjacent.includes(key)))
          add('BUILDING_CAPITAL_SPACE', 'Capital weapon mass sharing must include its primary hex and every immediately adjacent building hex.');
      }
    }
  }
  for (const bay of bays) {
    const spaces = entity.baySpaces(bay);
    if (Math.abs(spaces.reduce((sum, space) => sum + space.tons, 0) - getBayConstructionWeight(bay)) > 0.00001
      || spaces.some(space => !valid(space.position) || space.tons < 0 || !Number.isFinite(space.tons)))
      add('BUILDING_BAY_SPACE', `Bay ${bay.bayNumber}: assign exactly ${getBayConstructionWeight(bay)} t among valid hexes and levels.`);
  }
  return issues;
}
