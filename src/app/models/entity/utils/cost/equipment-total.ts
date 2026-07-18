import { AmmoEquipment, ArmorEquipment } from '../../../equipment.model';
import type { BaseEntity } from '../../base-entity';

/** Mirrors CostCalculator.getWeaponsAndEquipmentCost's mounted-item rules. */
export function calculateMountedEquipmentCost(entity: BaseEntity, ignoreAmmo = false): number {
  let total = 0;
  for (const mount of entity.equipment()) {
    const equipment = mount.equipment;
    if (!equipment || equipment instanceof ArmorEquipment) continue;
    if (ignoreAmmo && equipment instanceof AmmoEquipment && equipment.ammoType !== 'COOLANT_POD') continue;
    if (equipment.hasFlag('F_BA_MANIPULATOR')) continue;
    if (entity.entityType === 'ProtoMek' && equipment.hasFlag('F_EI_INTERFACE')) continue;

    const cost = mount.getCost(entity);
    if (cost === undefined) throw new Error(`Unable to calculate variable cost for ${equipment.id}`);
    total += Math.trunc(cost);
  }
  if (!entity.isLargeCraft()) total += calculateTransporterCost(entity);
  return total;
}

/** Prices transporter systems. Large-craft family calculators invoke this directly. */
export function calculateTransporterCost(entity: BaseEntity): number {
  let total = 0;
  for (const transporter of entity.transporters()) {
    if (transporter.kind !== 'bay') continue;
    const type = transporter.configuration.type;
    const capacity = Math.trunc(transporter.capacity);
    switch (type) {
      case 'standard-seats': total += 100 * capacity; break;
      case 'pillion-seats': total += 10 * capacity; break;
      case 'ejection-seats': total += 25000 * capacity; break;
      case 'crew-quarters':
      case 'second-class-quarters': total += 15000 * capacity; break;
      case 'steerage-quarters': total += 5000 * capacity; break;
      case 'first-class-quarters': total += 30000 * capacity; break;
      case 'mek': total += 20000 * capacity; break;
      case 'fighter': total += (20000 * capacity) + (transporter.configuration.arts ? 1000000 : 0); break;
      case 'small-craft': total += 20000 * capacity; break;
      case 'light-vehicle':
      case 'heavy-vehicle': total += 10000 * capacity; break;
      case 'super-heavy-vehicle': total += 20000 * capacity; break;
      case 'protomek': total += 10000 * Math.ceil(transporter.capacity); break;
      case 'infantry': total += 15000 * Math.ceil(transporter.capacity); break;
      case 'battle-armor': {
        const squadSize = transporter.configuration.techBase === 'Clan'
          ? 5 : transporter.configuration.comStar ? 6 : 4;
        total += 15000 * Math.ceil(transporter.capacity * 2 * squadSize);
        break;
      }
      case 'liquid-cargo': total += 100 * Math.ceil(transporter.constructionWeight ?? transporter.capacity); break;
      case 'insulated-cargo': total += 250 * Math.ceil(transporter.constructionWeight ?? transporter.capacity); break;
      case 'refrigerated-cargo': total += 200 * Math.ceil(transporter.constructionWeight ?? transporter.capacity); break;
      case 'livestock-cargo': total += 2500 * Math.ceil(transporter.constructionWeight ?? transporter.capacity); break;
    }
    const isSeatsOrQuarters = type === 'standard-seats' || type === 'pillion-seats'
      || type === 'ejection-seats' || type === 'crew-quarters' || type === 'steerage-quarters'
      || type === 'second-class-quarters' || type === 'first-class-quarters';
    if (!isSeatsOrQuarters) total += 1000 * transporter.doors;
  }
  return total;
}
