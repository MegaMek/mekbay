import type { BattleArmorEntity } from '../../entities/infantry/battle-armor-entity';
import type { InfantryEntity } from '../../entities/infantry/infantry-entity';
import { calculateArmorCost } from './common';
import { getEquipmentCost } from './equipment-pricing';

/** Mirrors MegaMek's BattleArmorCostCalculator, including training costs. */
export function calculateBattleArmorCost(entity: BattleArmorEntity, equipmentCost: number): number {
  const weightClass = entity.weightClass();
  const propulsionMP = entity.propulsionMP();
  let chassisCost: number;
  let propulsionCost: number;
  switch (weightClass) {
    case 'Medium':
      chassisCost = 100000;
      propulsionCost = propulsionMP * (entity.motiveType() === 'VTOL' ? 100000 : 75000);
      break;
    case 'Heavy':
      chassisCost = 200000;
      propulsionCost = propulsionMP * (entity.motiveType() === 'UMU' ? 100000 : 150000);
      break;
    case 'Assault':
      chassisCost = 400000;
      propulsionCost = propulsionMP * (entity.motiveType() === 'UMU' ? 150000 : 300000);
      break;
    default:
      chassisCost = 50000;
      propulsionCost = propulsionMP * 50000;
  }
  const manipulatorCost = entity.equipment().reduce<number>((total, mount) =>
    total + (mount.equipment?.hasFlag('F_BA_MANIPULATOR')
      ? Math.trunc(getEquipmentCost(entity, mount) ?? 0)
      : 0), 0);
  const additiveCost = [
    chassisCost,
    propulsionCost,
    25000 * (entity.originalWalkMP() - 1),
    manipulatorCost,
    calculateArmorCost(entity),
    entity.techBase() === 'Clan' ? 200000 : 150000,
    equipmentCost,
  ].reduce((total, cost) => total + Math.max(0, cost), 0);
  const clanMultiplier = entity.techBase() === 'Clan' ? 1.1 : 1;
  return additiveCost * clanMultiplier * entity.trooperCount();
}

/** Mirrors MegaMek's InfantryCostCalculator. */
export function calculateInfantryCost(entity: InfantryEntity): number {
  const troopers = entity.squadSize() * entity.squadCount();
  const primaryCount = (entity.squadSize() - entity.secondaryCount()) * entity.squadCount();
  const secondaryCount = troopers - primaryCount;
  const primaryCost = entity.primaryWeapon()?.cost;
  const secondaryCost = entity.secondaryWeapon()?.cost;
  const weaponsCost = primaryCount * (typeof primaryCost === 'number' ? Math.sqrt(primaryCost) * 2000 : 0)
    + secondaryCount * (typeof secondaryCost === 'number' ? Math.sqrt(secondaryCost) * 2000 : 0);

  const armorKit = entity.armorKit();
  let armorCost = typeof armorKit?.cost === 'number' ? armorKit.cost : 0;
  if (!armorKit) {
    if (entity.armorDivisor() > 1) armorCost += entity.effectiveEncumberingArmor() ? 1600 : 4300;
    const sneakCount = Number(entity.effectiveSneakCamo())
      + Number(entity.effectiveSneakIR()) + Number(entity.effectiveSneakECM());
    if (entity.effectiveDEST()) armorCost += 50000;
    else if (sneakCount === 1) armorCost += 7000;
    else if (sneakCount === 2) armorCost += 21000;
    else if (sneakCount === 3) armorCost += 28000;
    if (entity.effectiveSpaceSuit()) armorCost += 5000;
  }

  const fieldGunCost = entity.equipment().reduce((total, mount) =>
    total + (mount.location === 'Field Guns' ? Math.max(0, getEquipmentCost(entity, mount) ?? 0) : 0), 0);
  const platoonCost = (Math.max(0, weaponsCost) + Math.max(0, armorCost * troopers))
    * calculateInfantryPriceMultiplier(entity);
  return platoonCost + Math.max(0, fieldGunCost) + (entity.mount() ? 5000 * entity.tonnage() : 0);
}

function calculateInfantryPriceMultiplier(entity: InfantryEntity): number {
  let multiplier = entity.hasAntiMekGear() ? 5 : 1;
  switch (entity.motiveType()) {
    case 'UMU': multiplier *= entity.umuMP() > 1 ? 2.5 : 2; break;
    case 'Motorized': multiplier *= 1.6; break;
    case 'Jump': multiplier *= 2.6; break;
    case 'Hover':
    case 'Wheeled':
    case 'Tracked':
    case 'Submarine': multiplier *= 3.2; break;
    case 'VTOL': multiplier *= entity.secondaryCount() > 0 ? 4 : 4.5; break;
  }
  const specializations = entity.specializations();
  const combatEngineers = ['bridge-engineers', 'demo-engineers', 'fire-engineers',
    'mine-engineers', 'sensor-engineers', 'trench-engineers'];
  if (combatEngineers.some(value => specializations.has(value as never))) multiplier *= 5;
  if (specializations.has('marines')) multiplier *= 3;
  if (specializations.has('mountain-troops')) multiplier *= 2;
  if (specializations.has('paratroops')) multiplier *= 3;
  if (specializations.has('xct')) multiplier *= 5;
  return multiplier;
}
