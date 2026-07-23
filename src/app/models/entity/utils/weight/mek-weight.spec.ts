import { ArmorEquipment, createEquipment, StructureEquipment } from '../../../equipment.model';
import { MountedArmor, MountedEngine, MountedStructure } from '../../components';
import { TestBipedMekEntity, TestTripodMekEntity } from '../../testing/test-entities';
import { addTestEquipment } from '../../testing/test-mounted-equipment';
import {
  calculateMekArmorWeight,
  calculateMekStructureWeight,
  calculateMekWeightBreakdown,
} from './mek-weight';

describe('Mek construction weight', () => {
  it('calculates standard system categories independently of declared capacity', () => {
    const entity = new TestBipedMekEntity();
    entity.setTonnage(100);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 300, techBase: 'IS' }));

    const result = calculateMekWeightBreakdown(entity);

    expect(result.engine).toBe(19);
    expect(result.structure).toBe(10);
    expect(result.cockpit).toBe(3);
    expect(result.gyro).toBe(3);
    expect(entity.tonnage()).toBe(100);
    expect(result.rounded).not.toBe(entity.tonnage());
  });

  it('applies structure material and tripod multipliers', () => {
    const entity = new TestTripodMekEntity();
    const endo = new StructureEquipment({
      id: 'Endo Steel', name: 'Endo Steel', type: 'structure', structure: { typeId: 2 },
    });
    entity.setTonnage(100);
    entity.setUniformStructure(new MountedStructure({ tonnage: 100, structure: endo }));

    expect(calculateMekStructureWeight(entity)).toBe(5.5);
  });

  it('calculates patchwork armor from the effective material at each location', () => {
    const entity = new TestBipedMekEntity();
    const standard = armor('Standard', 1);
    const hardened = armor('Hardened', 0.5);
    entity.setUniformArmor(new MountedArmor({ armor: standard, techBase: 'IS' }));
    entity.setArmorAt('HD', new MountedArmor({ armor: hardened, techBase: 'IS' }));
    entity.setArmorValue('HD', 'front', 8);
    entity.setArmorValue('CT', 'front', 16);

    expect(calculateMekArmorWeight(entity)).toBe(2);
  });

  it('reacts to installed armor without changing declared tonnage', () => {
    const entity = new TestBipedMekEntity();
    entity.setTonnage(50);
    const before = entity.effectiveTonnage();

    entity.setArmorValue('CT', 'front', 16);

    expect(entity.tonnage()).toBe(50);
    expect(entity.effectiveTonnage()).toBe(before + 1);
  });

  it('does not double the construction mass of an engine rated above 400', () => {
    const entity = new TestBipedMekEntity();
    entity.mountedEngine.set(new MountedEngine({ type: 'XXL', rating: 425, techBase: 'IS' }));

    expect(calculateMekWeightBreakdown(entity).engine).toBe(26.5);
  });

  it('does not round an exact half-ton upward due to floating-point noise', () => {
    const entity = new TestBipedMekEntity();
    entity.setTonnage(50);
    const partialWing = addTestEquipment(entity, createEquipment({
      id: 'IS Partial Wing', name: 'IS Partial Wing', type: 'misc',
      stats: { tonnage: 'variable' }, flags: ['F_PARTIAL_WING', 'F_MEK_EQUIPMENT'],
    }), { location: 'LT' });

    expect(partialWing.getTonnage(entity)).toBe(3.5);
  });
});

function armor(id: string, multiplier: number): ArmorEquipment {
  return new ArmorEquipment({
    id, name: id, type: 'armor', armor: { type: id, pptMultiplier: multiplier },
  });
}