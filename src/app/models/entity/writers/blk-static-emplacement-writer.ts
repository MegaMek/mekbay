// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

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

/** Serialize a GunEmplacement or BuildingEntity using MegaMek's BLK order. */
export function writeBlkStaticEmplacement(entity: StaticEmplacementEntity): string {
  const writer = new BuildingBlockWriter();
  writeIdentity(writer, entity, entity.staticKind);
  writeYearTechMeta(writer, entity);

  if (entity.staticKind === 'BuildingEntity') {
    writer.addBlock('motion_type', entity.motiveType());
    writer.addBlock('cruiseMP', entity.originalWalkMP());
    writer.addBlock('armor', entity.armorValues().values().next().value?.front ?? 0);
  }

  const equipmentTags: [string, string][] = entity.equipmentLocations().map(location => [
    entity.staticKind === 'GunEmplacement' ? 'GUNS Equipment' : `${location} Equipment`,
    location,
  ]);
  writeEquipmentByLocation(writer, entity, equipmentTags, encodeEquipmentLine, true);

  writeFluffBlocks(writer, entity.fluff());
  writeSource(writer, entity);

  if (entity.staticKind === 'GunEmplacement') {
    if (entity.turret()) writer.addBlock('turret', 1);
  } else {
    writer.addBlock('building_class', entity.buildingClass() ?? 0);
    writer.addBlock('building_type', entity.buildingType() ?? 0);
    writer.addBlock('height', entity.height() ?? 0);
    writer.addBlock('cf', entity.constructionFactor() ?? 0);
    writer.addBlock('coords', ...entity.coordinates());
  }

  writeManualBV(writer, entity);
  writeEmbeddedImages(writer, entity);
  return writer.toString(entity.nativeSourceTrailingNewlines || 2);
}
