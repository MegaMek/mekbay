import { AmmoEquipment, WeaponEquipment } from '../../equipment.model';
import type { InfantryEntity } from '../entities/infantry/infantry-entity';

const COMBAT_ENGINEER_SPECIALIZATIONS = new Set([
  'bridge-engineers',
  'demo-engineers',
  'fire-engineers',
  'mine-engineers',
  'sensor-engineers',
  'trench-engineers',
]);

export function getInfantryTonnage(entity: InfantryEntity): number {
  const activeTroopers = Math.max(0, entity.squadSize() * entity.squadCount());
  const mount = entity.mount();
  let weight: number;

  if (mount) {
    const troopsPerCreature = mount.size === 'Large' ? 1 : mount.size === 'Very Large' ? 2 : 4;
    weight = troopsPerCreature > 1
      ? (mount.weight + 0.2 * entity.squadSize()) * entity.squadCount()
      : (mount.weight + 0.2) * activeTroopers;
  } else {
    let multiplier = getTrooperWeightMultiplier(entity);
    const specializations = entity.specializations();

    if ([...specializations].some(specialization => COMBAT_ENGINEER_SPECIALIZATIONS.has(specialization))) {
      multiplier += 0.1;
    }
    if (specializations.has('paratroops')) multiplier += 0.05;
    if (specializations.has('paramedics')) multiplier += 0.05;
    if (entity.hasAntiMekGear()) multiplier += 0.015;

    weight = activeTroopers * multiplier;
    for (const mounted of entity.equipment()) {
      if ((mounted.location === 'Field Guns' && mounted.equipment instanceof WeaponEquipment)
          || mounted.equipment instanceof AmmoEquipment) {
        weight += mounted.getTonnage(entity) ?? 0;
      }
    }
  }

  return Math.ceil(weight * 2) / 2;
}

function getTrooperWeightMultiplier(entity: InfantryEntity): number {
  switch (entity.motiveType()) {
    case 'Motorized': return 0.195;
    case 'Hover':
    case 'Tracked':
    case 'Wheeled': return 1;
    case 'VTOL': return entity.isMicrolite() ? 1.4 : 1.9;
    case 'Jump': return 0.165;
    case 'UMU': return entity.isMotorizedScuba() ? 0.295 : 0.135;
    case 'Submarine': return 0.9;
    default: return 0.085;
  }
}