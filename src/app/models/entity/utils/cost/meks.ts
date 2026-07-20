import type { MekEntity, MekWithArmsEntity } from '../../entities/mek/mek-entity';
import { calculateArmorCost } from './common';

/** Mirrors MegaMek's MekCostCalculator for common Mek construction systems. */
export function calculateMekCost(entity: MekEntity, equipmentCost: number): number {
  const tonnage = entity.tonnage();
  const engine = entity.mountedEngine();
  const structureCostPerTon = getMekStructureCostPerTon(entity);
  const structureCost = structureCostPerTon * tonnage * (entity.motiveType() === 'Tripod' ? 1.2 : 1);
  const gyro = entity.mountedGyro();
  const gyroTonnage = Math.ceil(entity.originalWalkMP() * tonnage / 100);
  const myomerCost = getMekMyomerCost(entity) * tonnage;
  const jumpJets = entity.installedJumpJetMP();
  const improvedJumpJets = entity.equipment().some(mount =>
    mount.equipment?.hasFlag('F_JUMP_JET') && mount.equipment.hasFlag('S_IMPROVED'));
  const primaryJumpMP = entity.installedUmuMP() > 0 ? entity.installedUmuMP() : jumpJets;
  const mechanicalJumpBoosterMP = Math.round(entity.equipment().find(
    mount => mount.equipment?.hasAnyFlag(['F_JUMP_BOOSTER', 'F_MECHANICAL_JUMP_BOOSTER']),
  )?.size ?? 0);
  const jumpCost = primaryJumpMP ** 2 * tonnage * (improvedJumpJets ? 500 : 200)
    + mechanicalJumpBoosterMP ** 2 * tonnage * 150;
  const heatSinkCost = (entity.heatSinkType() === 'Single' ? 2000 : 6000)
    * (entity.totalHeatSinks() - (entity.heatSinkType() === 'Single' ? 10 : 0));
  let additiveCost = [
    entity.mountedCockpit().cost,
    50000,
    tonnage * 2000,
    myomerCost,
    structureCost,
    calculateMekActuatorCost(entity),
    engine.installed ? (engine.baseCost * engine.rating * tonnage) / 75 : 0,
    gyro.baseCost * gyroTonnage * gyro.costMultiplier,
    jumpCost,
    heatSinkCost,
    entity.hasFullHeadEjectionSystem() ? 1725000 : 0,
    entity.armoredSystemSlots().size * 150000,
    calculateArmorCost(entity),
    equipmentCost,
  ].reduce((total, cost) => total + cost, 0);
  if (entity.chassisConfig === 'LAM') {
    const lamType = 'lamType' in entity
      ? (entity as MekEntity & { lamType(): string }).lamType().toLowerCase()
      : 'standard';
    additiveCost += (structureCost + equipmentCost)
      * (lamType === 'bimodal' ? 0.65 : 0.75);
  } else if (entity.chassisConfig === 'QuadVee') {
    additiveCost += (structureCost + equipmentCost) * 0.5;
  }
  const quirks = new Set(entity.quirks().map(({ quirk }) => quirk.key));
  const quirkMultiplier = quirks.has('good_rep_1')
    ? Math.fround(1.1)
    : quirks.has('good_rep_2') ? Math.fround(1.25) : 1;
  const omniMultiplier = entity.omni() ? 1.25 : 1;
  const weightMultiplier = 1 + tonnage / (entity.isIndustrial() ? 400 : 100);
  return Math.round(additiveCost * quirkMultiplier * omniMultiplier * weightMultiplier);
}

function getMekStructureCostPerTon(entity: MekEntity): number {
  const name = entity.structureAt('CT').structure.name.toLowerCase();
  const superHeavyMultiplier = entity.isSuperHeavy() ? 2 : 1;
  if (name.includes('industrial')) return entity.isSuperHeavy() ? 3000 : 300;
  if (name.includes('reinforced')) return entity.isSuperHeavy() ? 0 : 6400;
  if (name.includes('endo-composite') || name.includes('endo composite')) return 3200 * superHeavyMultiplier;
  if (name.includes('endo') && name.includes('prototype')) return entity.isSuperHeavy() ? 0 : 4800;
  if (name.includes('endo')) return entity.isSuperHeavy() ? 16000 : 1600;
  if (name.includes('composite')) return 1600;
  return entity.isSuperHeavy() ? 4000 : 400;
}

function getMekMyomerCost(entity: MekEntity): number {
  const type = entity.myomerType().toLowerCase();
  if (type.includes('super-cooled')) return 10000;
  if (type.includes('industrial triple')) return 12000;
  if (type.includes('triple') && type.includes('prototype')) return 32000;
  if (type.includes('triple')) return 16000;
  return entity.isSuperHeavy() ? 12000 : 2000;
}

function calculateMekActuatorCost(entity: MekEntity): number {
  const tonnage = entity.tonnage();
  const legs = entity.motiveType() === 'Tripod'
    ? 3
    : entity.chassisConfig === 'QuadVee' || entity.motiveType() === 'Quad' ? 4 : 2;
  let cost = tonnage * legs * (150 + 80 + 120);
  if ('hasLowerArmActuator' in entity) {
    const armed = entity as MekWithArmsEntity;
    cost += tonnage * 2 * 100;
    cost += tonnage * Object.values(armed.hasLowerArmActuator()).filter(Boolean).length * 50;
    cost += tonnage * Object.values(armed.hasHandActuator()).filter(Boolean).length * 80;
  }
  return cost * (entity.isSuperHeavy() ? 2 : 1);
}
