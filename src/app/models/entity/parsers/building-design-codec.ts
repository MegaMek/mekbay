// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { StaticEmplacementEntity } from '../entities/misc/static-emplacement-entity';
import { DEFAULT_BUILDING_OPTIONS, buildingHexKey, parseBuildingHex, type BuildingOptions, type BuildingHex,
  type BuildingLocation, type BuildingEquipmentPlacement, type BuildingSpace } from '../types/building';
import { blkEquipmentOrder } from '../utils/blk-equipment-order';
import type { BuildingBlockWriter } from '../writers/building-block-writer';
import type { BuildingBlock } from './building-block';
import type { ParseContext } from './parse-context';

const OPTION_TAGS: Readonly<Record<keyof BuildingOptions, string>> = {
  sealing: 'sealing', heavyMetal: 'heavy_metal', civilianOfficers: 'civilian_officers', tunnel: 'tunnel',
  openSpace: 'open_space', roofClearance: 'roof_clearance', ceiling: 'ceiling', site: 'site', depth: 'depth', baseLevel: 'base_level',
};

/** The same optional construction facts and clockwise sides as MegaMek's BuildingDesignCodec. */
export function readBuildingDesign(bb: BuildingBlock, entity: StaticEmplacementEntity, ctx: ParseContext): void {
  const options = { ...DEFAULT_BUILDING_OPTIONS };
  for (const line of bb.getDataAsString('building_options').filter(line => line.trim())) {
    const pair = line.split('=');
    const key = (Object.keys(OPTION_TAGS) as (keyof BuildingOptions)[]).find(key => OPTION_TAGS[key] === pair[0]);
    let value: boolean | string | number | undefined;
    if (key && pair.length === 2) {
      if (typeof options[key] === 'boolean' && ['true', 'false'].includes(pair[1])) value = pair[1] === 'true';
      else if (key === 'depth' && Number.isSafeInteger(Number(pair[1])) && pair[1].trim()) value = Number(pair[1]);
      else if (key === 'baseLevel' && /^[+-]?\d+$/.test(pair[1]) && Number(pair[1]) >= -2147483648 && Number(pair[1]) <= 2147483647) value = Number(pair[1]);
      else if (key === 'ceiling' && ['STANDARD', 'HIGH', 'LOW'].includes(pair[1])) value = pair[1];
      else if (key === 'site' && ['SURFACE', 'UNDERGROUND', 'UNDERWATER'].includes(pair[1])) value = pair[1];
    }
    if (value === undefined || !key) ctx.error('building_options', 'Invalid building option: ' + line);
    else Object.assign(options, { [key]: value });
  }
  entity.buildingOptions.set(options);
  entity.portalHex2.set(null);
  entity.portalHex3.set(null);
  for (const line of bb.getDataAsString('building_portal_templates').filter(line => line.trim())) {
    const [reference, cube] = parts(line, ';', 2);
    const field = reference === '2' ? entity.portalHex2 : reference === '3' ? entity.portalHex3 : null;
    if (!field || field()) throw new Error('Large Portal templates require unique Hex 2 and Hex 3 references.');
    const hex = readHex(cube);
    if (!entity.coordinates().some(occupied => buildingHexKey(occupied) === buildingHexKey(hex)))
      throw new Error('Large Portal template is outside the footprint.');
    field.set(hex);
  }
  const occupied = new Set(entity.coordinates().map(buildingHexKey));
  for (const [tag, field] of [['building_wall_sides', entity.wallSides], ['building_bridge_decks', entity.bridgeDecks]] as const) {
    const values = new Map<string, number>();
    for (const line of bb.getDataAsString(tag).filter(line => line.trim())) {
      const [cube, raw, ...extra] = line.split(';');
      const hex = parseBuildingHex(cube), value = Number(raw);
      const key = hex && buildingHexKey(hex);
      if (!key || !occupied.has(key) || values.has(key) || extra.length || !raw?.trim()
        || !Number.isSafeInteger(value) || value < 0 || (tag === 'building_wall_sides' && value > 63))
        ctx.error(tag, 'Invalid or duplicate structure geometry: ' + line);
      else values.set(key, value);
    }
    field.set(values);
  }
  const lines = (tag: string) => bb.getDataAsString(tag).filter(line => line.trim());
  entity.doors.set(lines('building_doors').map(line => {
    const [position, facing, height, group] = parts(line, ';', 4);
    const side = integer(facing);
    if (side < 0 || side > 5) throw new Error('Building door facing must be between 0 and 5.');
    const linkGroup = integer(group);
    if (linkGroup < 0 || linkGroup > 2147483647) throw new Error('Door link group must be between 0 and 2147483647.');
    return { position: readPosition(position), facing: side, height: integer(height), ...(linkGroup ? { linkGroup } : {}) };
  }));
  entity.elevators.set(lines('building_elevators').map(line => {
    const [hex, capacity, stops] = parts(line, ';', 3);
    const exits = new Map<number, number>();
    for (const entry of stops.split(',')) {
      const [level, sides] = parts(entry, '=', 2), floor = integer(level);
      if (exits.has(floor)) throw new Error('Duplicate building elevator stop.');
      exits.set(floor, integer(sides));
    }
    return { hex: readHex(hex), capacity: tons(capacity), exits };
  }));
  const equipment = new Map<string, BuildingEquipmentPlacement>();
  const ordered = blkEquipmentOrder(entity);
  for (const line of lines('building_equipment_space')) {
    const [reference, automated, positions, source] = parts(line, ';', 4);
    const [location, ordinal] = parts(reference, ',', 2).map(integer);
    const mount = ordered.filter(mount => mount.location === entity.locationOrder[location])[ordinal];
    if (!mount || equipment.has(mount.mountId) || !['true', 'false'].includes(automated))
      throw new Error('Invalid or duplicate building equipment placement.');
    equipment.set(mount.mountId, { automated: automated === 'true', positions: positions ? positions.split('|').map(readPosition) : [], pcmtSource: tons(source) });
  }
  entity.equipmentDesign.set(equipment);
  const bays = entity.transporters().filter(bay => bay.kind === 'bay');
  entity.bayDoors.set(lines('building_bay_doors').map(line => {
    const [number, position, facing] = parts(line, ';', 3);
    const bay = bays.find(bay => bay.bayNumber === integer(number)), side = integer(facing);
    if (!bay || side < 0 || side > 5) throw new Error('Bay doors require an existing bay number and facing between 0 and 5.');
    const location = readPosition(position);
    if (!occupied.has(buildingHexKey(location.hex)) || location.floor < 0 || location.floor >= entity.hexHeight(location.hex))
      throw new Error('Bay door must be inside an occupied hex and floor.');
    return { bayId: bay.id, position: location, facing: side };
  }));
  const baySpace = new Map<string, readonly BuildingSpace[]>();
  for (const line of lines('building_bay_space')) {
    const [reference, spaces] = parts(line, ';', 2), bay = bays[integer(reference)];
    if (!bay || baySpace.has(bay.id)) throw new Error('Invalid or duplicate building bay placement.');
    baySpace.set(bay.id, spaces ? spaces.split('|').map(space => {
      const [position, weight] = parts(space, '=', 2);
      return { position: readPosition(position), tons: tons(weight) };
    }) : []);
  }
  entity.baySpace.set(baySpace);
}

export function writeBuildingDesign(writer: BuildingBlockWriter, entity: StaticEmplacementEntity): void {
  const options = entity.buildingOptions();
  const lines = (Object.keys(OPTION_TAGS) as (keyof BuildingOptions)[])
    .filter(key => options[key] !== DEFAULT_BUILDING_OPTIONS[key])
    .map(key => `${OPTION_TAGS[key]}=${options[key]}`);
  if (lines.length) writer.addBlock('building_options', ...lines);
  writer.addBlockIfPresent('building_portal_templates', ([[2, entity.portalHex2()], [3, entity.portalHex3()]] as const)
    .flatMap(([reference, hex]) => hex ? [`${reference};${cubeText(hex)}`] : []));
  for (const [tag, values] of [['building_wall_sides', entity.wallSides()], ['building_bridge_decks', entity.bridgeDecks()]] as const) {
    const entries = entity.coordinates().filter(hex => values.has(buildingHexKey(hex)))
      .map(hex => `${hex.q},${hex.r},${-hex.q - hex.r};${values.get(buildingHexKey(hex))}`);
    if (entries.length) writer.addBlock(tag, ...entries);
  }
  writer.addBlockIfPresent('building_doors', entity.doors().map(door => `${positionText(door.position)};${door.facing};${door.height};${door.linkGroup ?? 0}`));
  writer.addBlockIfPresent('building_bay_doors', entity.bayDoors().flatMap(door => {
    const bay = entity.transporters().find(bay => bay.kind === 'bay' && bay.id === door.bayId);
    return bay?.kind === 'bay' ? [`${bay.bayNumber};${positionText(door.position)};${door.facing}`] : [];
  }));
  writer.addBlockIfPresent('building_elevators', entity.elevators().map(lift => `${cubeText(lift.hex)};${lift.capacity};${[...lift.exits]
    .sort(([a], [b]) => a - b).map(([level, sides]) => `${level}=${sides}`).join(',')}`));
  const placements: string[] = [];
  const ordered = blkEquipmentOrder(entity);
  entity.locationOrder.forEach((location, index) => ordered.filter(mount => mount.location === location).forEach((mount, ordinal) => {
    const design = entity.equipmentDesign().get(mount.mountId);
    if (design && (design.automated || design.positions.length || design.pcmtSource))
      placements.push(`${index},${ordinal};${design.automated};${design.positions.map(positionText).join('|')};${design.pcmtSource}`);
  }));
  writer.addBlockIfPresent('building_equipment_space', placements);
  writer.addBlockIfPresent('building_bay_space', entity.transporters().filter(bay => bay.kind === 'bay').flatMap((bay, index) => {
    const spaces = entity.baySpace().get(bay.id);
    return spaces ? [`${index};${spaces.map(space => `${positionText(space.position)}=${space.tons}`).join('|')}`] : [];
  }));
}

const cubeText = (hex: BuildingHex) => `${hex.q},${hex.r},${-hex.q - hex.r}`;
const positionText = (position: BuildingLocation) => `${cubeText(position.hex)}/${position.floor}`;
function parts(text: string, separator: string, count: number): string[] {
  const values = text.split(separator);
  if (values.length !== count) throw new Error('Invalid building placement field count.');
  return values;
}
function integer(text: string): number {
  const value = Number(text);
  if (!text.trim() || !Number.isSafeInteger(value)) throw new Error('Building placement requires whole numbers.');
  return value;
}
function tons(text: string): number {
  const value = Number(text);
  if (!text.trim() || !Number.isFinite(value) || value < 0) throw new Error('Building placement requires non-negative tonnage.');
  return value;
}
function readHex(text: string): BuildingHex {
  const hex = parseBuildingHex(text);
  if (!hex) throw new Error('Invalid building placement hex.');
  return hex;
}
function readPosition(text: string): BuildingLocation {
  const [hex, floor] = parts(text, '/', 2);
  return { hex: readHex(hex), floor: integer(floor) };
}
