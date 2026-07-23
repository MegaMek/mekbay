import { ArmorEquipment, StructureEquipment } from '../../../equipment.model';
import { MountedArmor, MountedStructure } from '../../components';
import { TestTankEntity } from '../../testing/test-entities';
import {
  calculateVehicleArmorWeight,
  calculateVehicleStructureWeight,
  calculateVehicleWeightBreakdown,
} from './vehicle-weight';

describe('combat vehicle construction mass', () => {
  it('rounds standard structure and controls upward to half tons', () => {
    const entity = new TestTankEntity();
    entity.setTonnage(27);
    const standard = new StructureEquipment({
      id: 'Standard', name: 'Standard', type: 'structure',
      structure: { typeId: 0 },
    });
    entity.setUniformStructure(new MountedStructure({ tonnage: 27, structure: standard }));

    expect(calculateVehicleStructureWeight(entity)).toBe(3);
    expect(calculateVehicleWeightBreakdown(entity).controls).toBe(1.5);
  });

  it('doubles superheavy structure except for naval and submarine vehicles', () => {
    const entity = new TestTankEntity();
    entity.setTonnage(120);
    expect(calculateVehicleStructureWeight(entity)).toBe(24);
    entity.motiveType.set('Naval');
    entity.setTonnage(350);
    expect(calculateVehicleStructureWeight(entity)).toBe(35);
  });

  it('calculates uniform and patchwork armor from points-per-ton multipliers', () => {
    const entity = new TestTankEntity();
    const standard = new ArmorEquipment({
      id: 'Standard Armor', name: 'Standard Armor', type: 'armor',
      stats: { tonnage: 'variable' }, armor: { type: 'Standard', pptMultiplier: 1 },
    });
    entity.setUniformArmor(new MountedArmor({ armor: standard, techBase: 'IS' }));
    entity.armorValues.set(new Map([
      ['Front', { front: 17, rear: 0 }],
      ['Rear', { front: 0, rear: 0 }],
    ]));
    expect(calculateVehicleArmorWeight(entity)).toBe(1.5);
  });

  it('omits controls when the chassis has no control systems', () => {
    const entity = new TestTankEntity();
    entity.setTonnage(100);
    entity.hasNoControlSystems.set(true);
    expect(calculateVehicleWeightBreakdown(entity).controls).toBe(0);
  });
});