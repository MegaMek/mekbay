import { AmmoEquipment } from '../../../../equipment.model';
import type { BaseEntity } from '../../../base-entity';
import { alphaStrikeHeatCapacity } from './heat-adjustment';

/** Adds Alpha Strike conversion-only capacity bonuses to a family-provided base capacity. */
export function alphaStrikeHeatCapacityForEntity(entity: BaseEntity, baseCapacity: number): number {
  const equipment = entity.equipment();
  return alphaStrikeHeatCapacity({
    baseCapacity: Math.max(0, baseCapacity),
    coolantPodCount: equipment.filter(mount => mount.equipment instanceof AmmoEquipment
      && mount.equipment.ammoType === 'COOLANT_POD').length,
    partialWing: equipment.some(mount => mount.equipment?.hasFlag('F_PARTIAL_WING')),
    radicalHeatSink: equipment.some(mount => mount.equipment?.hasFlag('F_RADICAL_HEATSINK')),
    emergencyCoolantSystem: equipment.some(mount =>
      mount.equipment?.hasFlag('F_EMERGENCY_COOLANT_SYSTEM')),
  });
}