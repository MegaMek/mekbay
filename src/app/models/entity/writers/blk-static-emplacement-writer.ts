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
  writeTransporters,
  writeYearTechMeta,
} from './building-block-writer';
import { encodeEquipmentLine } from './equipment-encoder';
import { writeBuildingDesign } from '../parsers/building-design-codec';

/** Serialize a BuildingEntity using MegaMek's BLK order. */
export function writeBlkStaticEmplacement(entity: StaticEmplacementEntity): string {
  const writer = new BuildingBlockWriter();
  writeIdentity(writer, entity, entity.entityType);
  writeYearTechMeta(writer, entity);

  writer.addBlock('motion_type', entity.motiveType());
  writer.addBlock('cruiseMP', entity.originalWalkMP());
  if (entity.isMobile()) {
    writer.addBlock('power_system', entity.mobilePowerSystem());
    writer.addBlock('operating_range', entity.operatingRange());
    writer.addBlock('hex_heights', ...entity.coordinates().map(hex => entity.hexHeight(hex)));
    if (entity.fuelLocations().size) writer.addBlock('fuel_locations', ...entity.coordinates()
      .filter(hex => entity.fuelLocations().has(`${hex.q},${hex.r}`))
      .map(hex => `${buildingCubeText(hex)};${entity.fuelInHex(hex)}`));
  }
  writer.addBlock('armor', entity.armorValues().values().next().value?.front ?? 0);

  const equipmentTags: [string, string][] = entity.equipmentLocations().map(location => [
    `${location} Equipment`,
    location,
  ]);
  writeEquipmentByLocation(writer, entity, equipmentTags, encodeEquipmentLine, true,
    { blkMode: false, buildingFacing: true, shotsFormat: 'ba-handheld' });
  writeTransporters(writer, entity);

  writeFluffBlocks(writer, entity.fluff());
  writeSource(writer, entity);

  writer.addBlock('building_class', entity.buildingClass() ?? 0);
  writer.addBlock('building_type', entity.buildingType() ?? 0);
  writer.addBlock('height', entity.height() ?? 0);
  writer.addBlock('cf', entity.constructionFactor() ?? 0);
  if (entity.crewCount() !== null) writer.addBlock('crew', entity.crewCount()!);
  writer.addBlock('coords', ...entity.coordinates().map(buildingCubeText));
  writeBuildingDesign(writer, entity);

  writeManualBV(writer, entity);
  writeEmbeddedImages(writer, entity);
  return writer.toString(entity.nativeSourceTrailingNewlines || 2);
}
