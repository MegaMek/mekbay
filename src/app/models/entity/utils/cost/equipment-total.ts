import { AmmoEquipment, ArmorEquipment, WeaponEquipment } from '../../../equipment.model';
import type { BaseEntity } from '../../base-entity';
import { getEquipmentCost } from './equipment-pricing';
import { amount } from './cost-report';
import type { EntityCostEntry } from './cost-report';

export interface MountedEquipmentCostBreakdown {
  readonly total: number;
  readonly entries: readonly EntityCostEntry[];
}

/** Mirrors CostCalculator.getWeaponsAndEquipmentCost's mounted-item rules. */
export function calculateMountedEquipmentCost(entity: BaseEntity, ignoreAmmo = false): number {
  return calculateMountedEquipmentCostBreakdown(entity, ignoreAmmo).total;
}

/** Mirrors CostCalculator.getWeaponsAndEquipmentCost's mounted-item rules with report entries. */
export function calculateMountedEquipmentCostBreakdown(
  entity: BaseEntity,
  ignoreAmmo = false,
): MountedEquipmentCostBreakdown {
  let total = 0;
  const grouped = new Map<string, { count: number; cost: number }>();
  const extraEntries: EntityCostEntry[] = [];
  const addGrouped = (name: string, cost: number, count = 1): void => {
    total += cost;
    if (cost <= 0) return;
    const current = grouped.get(name);
    grouped.set(name, {
      count: (current?.count ?? 0) + count,
      cost: (current?.cost ?? 0) + cost,
    });
  };
  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment || equipment instanceof ArmorEquipment) continue;
    if (ignoreAmmo && equipment instanceof AmmoEquipment && equipment.ammoType !== 'COOLANT_POD') continue;
    if (equipment.hasFlag('F_BA_MANIPULATOR')) continue;
    if (entity.entityType === 'ProtoMek' && equipment.hasFlag('F_EI_INTERFACE')) continue;

    const cost = mount.getCost(entity);
    if (cost === undefined) throw new Error(`Unable to calculate variable cost for ${equipment.id}`);
    let itemCost = cost;
    if (!ignoreAmmo && entity.isSupportVehicle() && (mount.size ?? 1) > 1
      && equipment instanceof WeaponEquipment && equipment.isInfantryWeapon()) {
      itemCost += ((mount.size ?? 1) - 1) * equipment.infantry.ammoCost;
    }
    // Java casts the complete mounted-item price to long once, after adding
    // support-vehicle infantry ammunition.
    addGrouped(equipment.name, Math.trunc(itemCost));
    if (mount.secondEquipment && !(mount.secondEquipment instanceof ArmorEquipment)
      && !(ignoreAmmo && mount.secondEquipment instanceof AmmoEquipment
        && mount.secondEquipment.ammoType !== 'COOLANT_POD')) {
      const secondMount = mount.clone({
        equipmentId: mount.secondEquipmentId ?? mount.secondEquipment.id,
        equipment: mount.secondEquipment,
        secondEquipmentId: undefined,
        secondEquipment: undefined,
      });
      const secondCost = getEquipmentCost(entity, secondMount);
      if (secondCost === undefined) {
        throw new Error(`Unable to calculate variable cost for ${mount.secondEquipment.id}`);
      }
      addGrouped(mount.secondEquipment.name, Math.trunc(secondCost));
    }
  }
  if (entity.entityType === 'SmallCraft') {
    for (const equipment of entity.implicitSystemEquipment().filter(item => item.hasFlag('F_ECM'))) {
      if (equipment.cost === 'variable') {
        throw new Error(`Unable to calculate variable cost for ${equipment.id}`);
      }
      addGrouped(equipment.name, Math.trunc(equipment.cost));
    }
  }
  const equipmentEntries = [...grouped.entries()].sort(([left], [right]) =>
    compareJavaHashMapKeys(left, right)).map(([name, value]) =>
    amount(`${value.count} ${name}`, value.cost));
  const implicitCaseCost = calculateImplicitClanCaseCost(entity);
  if (implicitCaseCost > 0) {
    total += implicitCaseCost;
    extraEntries.push(amount('CASE', implicitCaseCost));
  }
  const hasSeparateLargeCraftBayCost = ['DropShip', 'JumpShip', 'WarShip', 'SpaceStation']
    .includes(entity.entityType);
  if (!hasSeparateLargeCraftBayCost) {
    const transporterEntries = calculateTransporterCostBreakdown(entity);
    for (const entry of transporterEntries) {
      total += entry.amount ?? 0;
    }
    extraEntries.push(...transporterEntries);
  }
  return { total, entries: [...equipmentEntries, ...extraEntries] };
}

/** Reproduces the stable bucket order used by MegaMek's small HashMap report aggregation. */
function compareJavaHashMapKeys(left: string, right: string): number {
  const leftHash = javaSpreadHash(left);
  const rightHash = javaSpreadHash(right);
  const bucketDifference = (leftHash & 15) - (rightHash & 15);
  return bucketDifference || ((rightHash >>> 0) - (leftHash >>> 0));
}

function javaSpreadHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0;
  }
  return (hash ^ (hash >>> 16)) | 0;
}

function calculateImplicitClanCaseCost(entity: BaseEntity): number {
  const family = entity.entityType;
  const isMek = family === 'Mek';
  const isVehicle = family === 'Tank' || family === 'Naval' || family === 'VTOL'
    || family === 'SupportTank' || family === 'SupportNaval' || family === 'SupportVTOL'
    || family === 'LargeSupportTank';
  if (!isMek && !isVehicle) return 0;
  const hasClanCase = entity.equipment().some(mount =>
    mount.equipment?.hasFlag('F_CASE') && mount.equipment.id.toLowerCase().includes('clan'));
  if (entity.techBase() !== 'Clan' && !hasClanCase) return 0;
  const explicitCase = entity.equipment().filter(mount => mount.equipment?.hasFlag('F_CASE')).length;
  return Math.max(0, entity.implicitClanCaseLocations().size - explicitCase) * 50000;
}

/** Prices transporter systems. Large-craft family calculators invoke this directly. */
export function calculateTransporterCost(entity: BaseEntity): number {
  return calculateTransporterCostBreakdown(entity).reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
}

function calculateTransporterCostBreakdown(entity: BaseEntity): EntityCostEntry[] {
  let total = 0;
  let seating = 0;
  let quarters = 0;
  let bays = 0;
  for (const transporter of entity.transporters()) {
    if (transporter.kind !== 'bay') continue;
    const type = transporter.configuration.type;
    const capacity = Math.trunc(transporter.capacity);
    let itemCost = 0;
    switch (type) {
      case 'standard-seats': itemCost = 100 * capacity; break;
      case 'pillion-seats': itemCost = 10 * capacity; break;
      case 'ejection-seats': itemCost = 25000 * capacity; break;
      case 'crew-quarters':
      case 'second-class-quarters': itemCost = 15000 * capacity; break;
      case 'steerage-quarters': itemCost = 5000 * capacity; break;
      case 'first-class-quarters': itemCost = 30000 * capacity; break;
      case 'mek': itemCost = 20000 * capacity; break;
      case 'fighter': itemCost = (20000 * capacity) + (transporter.configuration.arts ? 1000000 : 0); break;
      case 'small-craft': itemCost = 20000 * capacity; break;
      case 'light-vehicle':
      case 'heavy-vehicle': itemCost = 10000 * capacity; break;
      case 'super-heavy-vehicle': itemCost = 20000 * capacity; break;
      case 'protomek': itemCost = 10000 * Math.ceil(transporter.capacity); break;
      case 'infantry': itemCost = 15000 * Math.ceil(transporter.capacity); break;
      case 'battle-armor': {
        const squadSize = transporter.configuration.techBase === 'Clan'
          ? 5 : transporter.configuration.comStar ? 6 : 4;
        itemCost = 15000 * Math.ceil(transporter.capacity * 2 * squadSize);
        break;
      }
      case 'liquid-cargo': itemCost = 100 * Math.ceil(transporter.constructionWeight ?? transporter.capacity); break;
      case 'insulated-cargo': itemCost = 250 * Math.ceil(transporter.constructionWeight ?? transporter.capacity); break;
      case 'refrigerated-cargo': itemCost = 200 * Math.ceil(transporter.constructionWeight ?? transporter.capacity); break;
      case 'livestock-cargo': itemCost = 2500 * Math.ceil(transporter.constructionWeight ?? transporter.capacity); break;
    }
    const isSeatsOrQuarters = type === 'standard-seats' || type === 'pillion-seats'
      || type === 'ejection-seats' || type === 'crew-quarters' || type === 'steerage-quarters'
      || type === 'second-class-quarters' || type === 'first-class-quarters';
    if (type === 'standard-seats') seating += itemCost;
    else if (isSeatsOrQuarters) quarters += itemCost;
    else bays += itemCost + 1000 * transporter.doors;
    total += itemCost + (isSeatsOrQuarters ? 0 : 1000 * transporter.doors);
  }
  return [amount('Seating', seating), amount('Quarters', quarters), amount('Bays', bays)]
    .filter(entry => (entry.amount ?? 0) > 0);
}
