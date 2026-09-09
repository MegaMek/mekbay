// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { StaticEmplacementEntity } from '../entities/misc/static-emplacement-entity';
import { BUILDING_ORIGIN, buildingHexKey, buildingLocationName, parseBuildingHex, parseBuildingLocation } from '../types/building';
import { locationArmor } from '../types';
import { parseBaseBlk, parseBlkEquipment } from './blk-base-parser';
import { BuildingBlock } from './building-block';
import { decodeMotiveType } from './motive-type-codec';
import { ParseContext } from './parse-context';

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
  const entity = new StaticEmplacementEntity(ctx.equipmentRegistry);
  parseBaseBlk(bb, entity, ctx);

  const equipmentTags = equipmentLocations(bb);

  if (bb.exists('building_class')) entity.buildingClass.set(bb.getFirstInt('building_class'));
  if (bb.exists('building_type')) entity.buildingType.set(bb.getFirstInt('building_type'));
  if (bb.exists('cf')) entity.constructionFactor.set(bb.getFirstInt('cf'));
  const height = bb.exists('height') ? bb.getFirstInt('height') : 1;
  if (!Number.isSafeInteger(height) || height < 1) ctx.error('height', 'Building height must be a positive whole number.');
  entity.height.set(Number.isSafeInteger(height) && height > 0 ? height : 1);
  const hexes = new Map([[buildingHexKey(BUILDING_ORIGIN), BUILDING_ORIGIN]]);
  for (const line of bb.getDataAsString('coords')) {
    if (!line.trim()) continue;
    const hex = parseBuildingHex(line);
    if (hex) hexes.set(buildingHexKey(hex), hex);
    else ctx.error('coords', 'Invalid building hex: ' + line + '. Expected whole cube coordinates q,r,s with q+r+s=0.');
  }
  entity.coordinates.set([...hexes.values()]);
  if (bb.exists('motion_type')) entity.motiveType.set(decodeMotiveType(bb.getFirstString('motion_type')));
  if (bb.exists('cruiseMP')) entity.originalWalkMP.set(bb.getFirstInt('cruiseMP'));

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
    if (mount.allocation.kind === 'location' && !entity.validLocations.has(mount.location)) {
      ctx.error('equipment', 'Equipment location ' + mount.location + ' is outside the building footprint or height.');
      entity.updateEquipment(mounts => mounts.map(item => item === mount ? item.clone({ allocation: { kind: 'unallocated' } }) : item));
    }
  }
  return entity;
}
