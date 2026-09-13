// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { StaticEmplacementEntity } from '../entities/misc/static-emplacement-entity';
import { buildingHexKey, buildingLocationName, parseBuildingHex, parseBuildingLocation, type BuildingHex } from '../types/building';
import { locationArmor } from '../types';
import { parseBaseBlk, parseBlkEquipment } from './blk-base-parser';
import { BuildingBlock } from './building-block';
import { decodeMotiveType } from './motive-type-codec';
import { readBuildingDesign } from './building-design-codec';
import { ParseContext } from './parse-context';
import { MOBILE_POWER_SYSTEMS, type MobilePowerSystem } from '../entities/misc/mobile-structure-rules';

const EQUIPMENT_TAG_SUFFIX = ' equipment';

function equipmentLocations(bb: BuildingBlock): readonly [string, string][] {
  const tags = bb.sourceDocument.blocks
    .filter(block => block.normalizedTag.endsWith(EQUIPMENT_TAG_SUFFIX))
    .map(block => block.tag);

  return tags.map(tag => {
    const rawLocation = tag.slice(0, -EQUIPMENT_TAG_SUFFIX.length).trim();
    const parsed = parseBuildingLocation(rawLocation);
    const location = parsed ? buildingLocationName(parsed.hex, parsed.floor) : rawLocation;
    return [tag, location] as const;
  });
}

/** Parse BuildingEntity BLKs, including every hex and floor. */
export function parseBlkStaticEmplacement(
  bb: BuildingBlock,
  ctx: ParseContext,
): StaticEmplacementEntity {
  const entity = new StaticEmplacementEntity(ctx.equipmentRegistry, bb.getFirstString('UnitType') === 'MobileStructure' ? 'MobileStructure' : 'BuildingEntity');
  parseBaseBlk(bb, entity, ctx);
  if (bb.exists('crew')) {
    const crew = Number(bb.getFirstString('crew'));
    if (Number.isSafeInteger(crew) && crew >= 0 && crew <= 2147483647) entity.crewCount.set(crew);
    else ctx.error('crew', 'Building crew must be a non-negative whole number.');
  }

  const equipmentTags = equipmentLocations(bb);

  if (bb.exists('building_class')) entity.buildingClass.set(bb.getFirstInt('building_class'));
  if (bb.exists('building_type')) entity.buildingType.set(bb.getFirstInt('building_type'));
  if (bb.exists('cf')) entity.constructionFactor.set(bb.getFirstInt('cf'));
  const height = bb.exists('height') ? bb.getFirstInt('height') : 1;
  if (!Number.isSafeInteger(height) || height < 1) ctx.error('height', 'Building height must be a positive whole number.');
  entity.height.set(Number.isSafeInteger(height) && height > 0 ? height : 1);
  const hexes = new Map<string, BuildingHex>();
  for (const line of bb.getDataAsString('coords')) {
    if (!line.trim()) continue;
    const hex = parseBuildingHex(line);
    if (hex) hexes.set(buildingHexKey(hex), hex);
    else ctx.error('coords', 'Invalid building hex: ' + line + '. Expected whole cube coordinates q,r,s with q+r+s=0.');
  }
  if (!hexes.size) throw new Error('Building requires a non-empty coords block.');
  entity.coordinates.set([...hexes.values()]);
  if (bb.exists('motion_type')) entity.motiveType.set(decodeMotiveType(bb.getFirstString('motion_type')));
  if (bb.exists('cruiseMP')) entity.originalWalkMP.set(Number(bb.getFirstString('cruiseMP')));
  if (entity.isMobile()) {
    for (const field of ['motion_type', 'cruiseMP', 'power_system', 'operating_range'])
      if (!bb.exists(field)) ctx.error(field, 'Missing Mobile Structure ' + field + ' block.');
    const power = bb.getFirstString('power_system');
    if (Object.hasOwn(MOBILE_POWER_SYSTEMS, power)) entity.mobilePowerSystem.set(power as MobilePowerSystem);
    else ctx.error('power_system', 'Invalid Mobile Structure power system: ' + power);
    const range = Number(bb.getFirstString('operating_range'));
    if (Number.isFinite(range) && range >= 0) entity.operatingRange.set(range);
    else ctx.error('operating_range', 'Operating range must be a non-negative number of kilometers.');
    if (bb.exists('hex_heights')) {
      const heights = bb.getDataAsString('hex_heights').map(Number);
      if (heights.length !== entity.coordinates().length || heights.some(value => !Number.isSafeInteger(value) || value < 1 || value > height))
        ctx.error('hex_heights', 'Hex heights must be positive whole numbers no greater than maximum height, in coords order.');
      else entity.hexHeights.set(new Map(entity.coordinates().map((hex, index) => [buildingHexKey(hex), heights[index]])));
    }
    if (bb.exists('fuel_locations')) {
      const allocations = new Map<string, number>();
      for (const line of bb.getDataAsString('fuel_locations')) {
        const parts = line.split(';'), hex = parseBuildingHex(parts[0]), tons = Number(parts[1]);
        if (parts.length !== 2 || !hex || !Number.isFinite(tons) || tons < 0 || !hexes.has(buildingHexKey(hex)) || allocations.has(buildingHexKey(hex)))
          ctx.error('fuel_locations', 'Fuel allocation needs a unique occupied cube coordinate and non-negative tonnage: ' + line);
        else allocations.set(buildingHexKey(hex), tons);
      }
      entity.fuelLocations.set(allocations);
    }
  }

  if (bb.exists('armor')) {
    const armor = bb.getFirstInt('armor');
    if (Number.isFinite(armor)) {
      entity.armorValues.set(new Map(entity.locationOrder.map(location => [location, locationArmor(armor)])));
    }
  }

  parseBlkEquipment(bb, entity, ctx, equipmentTags, {
    includeTurretType: true,
  });
  // The generic equipment grammar stores VGL facings; buildings use clockwise 0=N.
  const buildingFacing = [5, 1, 0, 3, 4, 2];
  entity.updateEquipment(mounts => mounts.map(mount => mount.facing === undefined ? mount
    : mount.clone({ facing: buildingFacing[mount.facing] })));
  for (const mount of entity.equipment()) {
    if (mount.allocation.kind !== 'location' || !entity.validLocations.has(mount.location)) {
      ctx.error('equipment', 'Equipment location ' + mount.location + ' is outside the building footprint or height.');
      entity.removeEquipment(mount);
    }
  }
  readBuildingDesign(bb, entity, ctx);
  return entity;
}
