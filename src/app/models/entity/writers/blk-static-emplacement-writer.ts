// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { buildingCubeText } from '../types/building';
import { StaticEmplacementEntity } from '../entities/misc/static-emplacement-entity';
import {
  BuildingBlockWriter,
  writeEmbeddedImages,
  writeEquipmentByLocation,
  writeFluffBlocks,
  writeIdentity,
  writeManualBV,
  writeSource,
  writeYearTechMeta,
} from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';

/** Serialize a BuildingEntity using MegaMek's BLK order. */
export function writeBlkStaticEmplacement(entity: StaticEmplacementEntity): string {
  const writer = new BuildingBlockWriter();
  writeIdentity(writer, entity, entity.entityType);
  writeYearTechMeta(writer, entity);

  writer.addBlock('motion_type', entity.motiveType());
  writer.addBlock('cruiseMP', entity.originalWalkMP());
  writer.addBlock('armor', entity.armorValues().values().next().value?.front ?? 0);

  const equipmentTags: [string, string][] = entity.equipmentLocations().map(location => [
    `${location} Equipment`,
    location,
  ]);
  writeEquipmentByLocation(writer, entity, equipmentTags, encodeEquipmentLine, true, { blkMode: false, buildingFacing: true });

  writeFluffBlocks(writer, entity.fluff());
  writeSource(writer, entity);

  writer.addBlock('building_class', entity.buildingClass() ?? 0);
  writer.addBlock('building_type', entity.buildingType() ?? 0);
  writer.addBlock('height', entity.height() ?? 0);
  writer.addBlock('cf', entity.constructionFactor() ?? 0);
  writer.addBlock('coords', ...entity.coordinates().map(buildingCubeText));

  writeManualBV(writer, entity);
  writeEmbeddedImages(writer, entity);
  return writer.toString(entity.nativeSourceTrailingNewlines || 2);
}
