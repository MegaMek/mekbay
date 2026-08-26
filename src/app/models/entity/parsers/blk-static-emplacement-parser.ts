// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { StaticEmplacementEntity, type StaticEmplacementKind } from '../entities/misc/static-emplacement-entity';
import { locationArmor } from '../types';
import { parseBaseBlk, parseBlkEquipment } from './blk-base-parser';
import { BuildingBlock } from './building-block';
import { decodeMotiveType } from './motive-type-codec';
import { ParseContext } from './parse-context';

const EQUIPMENT_TAG_SUFFIX = ' equipment';

function equipmentLocations(bb: BuildingBlock, kind: StaticEmplacementKind): readonly [string, string][] {
  const tags = bb.sourceDocument.blocks
    .filter(block => block.normalizedTag.endsWith(EQUIPMENT_TAG_SUFFIX))
    .map(block => block.tag);

  return tags.map(tag => {
    const rawLocation = tag.slice(0, -EQUIPMENT_TAG_SUFFIX.length).trim();
    const location = kind === 'GunEmplacement' && rawLocation.toLowerCase() === 'guns'
      ? 'Guns'
      : rawLocation || (kind === 'GunEmplacement' ? 'Guns' : 'Building');
    return [tag, location] as const;
  });
}

/** Parse catalog-only GunEmplacement and BuildingEntity BLKs. */
export function parseBlkStaticEmplacement(
  bb: BuildingBlock,
  ctx: ParseContext,
  kind: StaticEmplacementKind,
): StaticEmplacementEntity {
  const entity = new StaticEmplacementEntity(kind, ctx.equipmentRegistry);
  parseBaseBlk(bb, entity, ctx);

  const equipmentTags = equipmentLocations(bb, kind);
  const locations = [...new Set(equipmentTags.map(([, location]) => location))];
  if (locations.length === 0) locations.push(kind === 'GunEmplacement' ? 'Guns' : 'Building');
  entity.equipmentLocations.set(locations);

  if (bb.exists('building_class')) entity.buildingClass.set(bb.getFirstInt('building_class'));
  if (bb.exists('building_type')) entity.buildingType.set(bb.getFirstInt('building_type'));
  if (bb.exists('cf')) entity.constructionFactor.set(bb.getFirstInt('cf'));
  if (bb.exists('height')) entity.height.set(bb.getFirstInt('height'));
  if (bb.exists('coords')) entity.coordinates.set(bb.getDataAsString('coords'));
  entity.turret.set(bb.exists('turret'));
  if (bb.exists('motion_type')) entity.motiveType.set(decodeMotiveType(bb.getFirstString('motion_type')));
  if (bb.exists('cruiseMP')) entity.originalWalkMP.set(bb.getFirstInt('cruiseMP'));

  if (bb.exists('armor')) {
    const armor = bb.getFirstInt('armor');
    if (Number.isFinite(armor)) {
      entity.armorValues.set(new Map([[locations[0]!, locationArmor(armor)]]));
    }
  }

  parseBlkEquipment(bb, entity, ctx, equipmentTags, {
    computeTurretMounted: () => kind === 'GunEmplacement',
    includeTurretType: true,
  });
  return entity;
}
