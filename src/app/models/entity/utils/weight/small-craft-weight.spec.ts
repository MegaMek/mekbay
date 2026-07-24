import { ArmorEquipment, WeaponEquipment } from '../../../equipment.model';
import { MountedArmor } from '../../components';
import { TestDropShipEntity, TestSmallCraftEntity } from '../../testing/test-entities';
import { EntityMountedEquipment } from '../../types/equipment';
import { calculateSmallCraftWeightBreakdown } from './small-craft-weight';

describe('Small Craft and DropShip construction mass', () => {
  it('uses Small Craft chassis engine and half-ton control formulas', () => {
    const entity = new TestSmallCraftEntity();
    entity.setTonnage(200);
    entity.originalWalkMP.set(4);
    entity.structuralIntegrity.set(5);
    const result = calculateSmallCraftWeightBreakdown(entity);
    expect(result.structure).toBe(5);
    expect(result.engine).toBe(52);
    expect(result.controls).toBe(1.5);
  });

  it('uses whole-ton DropShip controls and tonnage-dependent fuel density', () => {
    const entity = new TestDropShipEntity();
    entity.setTonnage(1000);
    entity.originalWalkMP.set(3);
    entity.fuel.set(600);
    const result = calculateSmallCraftWeightBreakdown(entity);
    expect(result.controls).toBe(8);
    expect(result.fuel).toBe(10.5);
  });

  it('subtracts structural-integrity armor points before calculating armor mass', () => {
    const entity = new TestSmallCraftEntity();
    const armor = new ArmorEquipment({
      id: 'Standard', name: 'Standard', type: 'armor', armor: { type: 'AERO', pptMultiplier: 1 },
    });
    entity.setUniformArmor(new MountedArmor({ armor, techBase: 'IS' }));
    entity.structuralIntegrity.set(5);
    entity.armorValues.set(new Map([['Nose', { front: 36, rear: 0 }]]));
    expect(calculateSmallCraftWeightBreakdown(entity).armor).toBe(1);
  });

  it('adds rounded fire-control mass above twelve weapons in one arc', () => {
    const entity = new TestSmallCraftEntity();
    const weapon = new WeaponEquipment({ id: 'Test Laser', name: 'Test Laser', type: 'weapon',
      stats: { tonnage: 1 } });
    const mounts = Array.from({ length: 13 }, (_, index) => new EntityMountedEquipment({
      mountId: `weapon-${index}`, equipmentId: weapon.id, equipment: weapon,
      allocation: { kind: 'location', location: 'Nose' }, rearMounted: false,
      turretMounted: false, omniPodMounted: false, armored: false,
    }));
    entity.setEquipment(mounts.slice(0, 12));
    expect(calculateSmallCraftWeightBreakdown(entity).systems).toBe(0);
    entity.setEquipment(mounts);
    expect(calculateSmallCraftWeightBreakdown(entity).systems).toBe(1.5);
  });
});