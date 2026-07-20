import { createEquipment, type Equipment } from '../../equipment.model';
import { BaseEntity } from '../base-entity';
import {
  type EntityMountedEquipment,
  type EntityMountedEquipmentInput,
} from '../types';

/**
 * Utility for spec tests
 */

export interface TestEquipmentMountOptions
  extends Partial<Omit<EntityMountedEquipmentInput, 'equipmentId' | 'equipment' | 'allocation'>> {
  readonly location?: string;
}

/** Install resolved test equipment using the entity's production mount path. */
export function addTestEquipment(
  entity: BaseEntity,
  equipment: Equipment,
  options: TestEquipmentMountOptions = {},
): EntityMountedEquipment {
  const { location = 'Body', ...overrides } = options;
  return entity.addEquipment({
    equipmentId: equipment.id,
    equipment,
    allocation: { kind: 'location', location },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
    ...overrides,
  });
}

/** Install minimal miscellaneous equipment carrying the requested flags. */
export function addTestEquipmentWithFlags(
  entity: BaseEntity,
  flags: string | readonly string[],
  options: TestEquipmentMountOptions = {},
): EntityMountedEquipment {
  const flagList = typeof flags === 'string' ? [flags] : [...flags];
  const id = `Test ${flagList.join(':')}`;
  return addTestEquipment(entity, createEquipment({
    id,
    name: id,
    type: 'misc',
    flags: flagList,
  }), options);
}
