import { createEquipment } from '../../../equipment.model';
import { TestSupportNavalEntity, TestSupportTankEntity } from '../../testing/test-entities';
import { addTestEquipment } from '../../testing/test-mounted-equipment';
import { calculateSupportVehicleStructureWeight } from './support-vehicle-weight';
import { calculateSupportVehicleWeightBreakdown } from './support-vehicle-weight';

describe('support vehicle construction mass', () => {
  it('rounds small support chassis upward to kilograms', () => {
    const entity = new TestSupportTankEntity();
    entity.setTonnage(4);
    entity.motiveType.set('Wheeled');
    entity.structuralTechRating.set(3);
    expect(calculateSupportVehicleStructureWeight(entity)).toBe(0.48);
  });

  it('uses the large naval chassis factor', () => {
    const entity = new TestSupportNavalEntity();
    entity.setTonnage(5000);
    entity.motiveType.set('Naval');
    entity.structuralTechRating.set(3);
    expect(calculateSupportVehicleStructureWeight(entity)).toBe(850);
  });

  it('multiplies all installed chassis modifications', () => {
    const entity = new TestSupportTankEntity();
    entity.setTonnage(4);
    entity.motiveType.set('Wheeled');
    entity.structuralTechRating.set(3);
    addTestEquipment(entity, createEquipment({
      id: 'Off Road', name: 'Off Road', type: 'misc',
      flags: ['F_CHASSIS_MODIFICATION', 'F_OFF_ROAD'],
    }), { location: 'Body' });
    expect(calculateSupportVehicleStructureWeight(entity)).toBe(0.72);
  });

  it('includes fuel and per-seat crew accommodation mass', () => {
    const entity = new TestSupportTankEntity();
    entity.setTonnage(1);
    entity.fuel.set(0.029);
    entity.transporters.set([{
      id: 'seat', kind: 'bay', configuration: { type: 'standard-seats' },
      capacity: 1, doors: 0, bayNumber: 0, omni: false,
    }]);
    const result = calculateSupportVehicleWeightBreakdown(entity);
    expect(result.controls).toBe(0.075);
    expect(result.fuel).toBe(0.029);
  });

  it('charges small-support infantry ammunition after the free first clip', () => {
    const entity = new TestSupportTankEntity();
    entity.setTonnage(4);
    addTestEquipment(entity, createEquipment({
      id: 'Infantry Rifle', name: 'Infantry Rifle', type: 'weapon', flags: ['F_INFANTRY'],
      stats: { tonnage: 0.02 }, infantry: { ammoWeight: 0.004 },
    }), { location: 'Front', size: 3.5 });

    const result = calculateSupportVehicleWeightBreakdown(entity);
    expect(result.ammo).toBe(0.01);
  });

  it('does not charge the free first infantry-ammo clip', () => {
    const entity = new TestSupportTankEntity();
    entity.setTonnage(4);
    addTestEquipment(entity, createEquipment({
      id: 'Infantry Rifle', name: 'Infantry Rifle', type: 'weapon', flags: ['F_INFANTRY'],
      stats: { tonnage: 0.02 }, infantry: { ammoWeight: 0.004 },
    }), { location: 'Front', size: 1 });

    expect(calculateSupportVehicleWeightBreakdown(entity).ammo).toBe(0);
  });
});