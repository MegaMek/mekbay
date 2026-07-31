import type { ArmorEquipment } from '../../../equipment.model';
import type { BaseEntity } from '../../base-entity';
import type { MountedArmor } from '../../components';
import { resolveArmorEquipment } from '../../types/armor';

/**
 * Resolve the armor descriptor used by MegaMek's cached lab tonnage.
 * BLK loaders cache armor mass before unresolved armor technology is
 * normalized to the entity tech base for components and cost calculations.
 */
export function resolveLabArmorEquipment(
  entity: BaseEntity,
  mounted: MountedArmor,
): ArmorEquipment {
  if (mounted.technology.scope !== 'Unknown') return mounted.armor;
  return resolveArmorEquipment(mounted.type, false, entity.getEquipmentRegistry()) ?? mounted.armor;
}