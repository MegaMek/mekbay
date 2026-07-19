import { createEquipment } from '../../../equipment.model';
import { EquipmentRegistry } from '../../../equipment-lookup';
import {
  TestLargeSupportTankEntity as LargeSupportTankEntity,
  TestSupportTankEntity as SupportTankEntity,
  TestTankEntity as TankEntity,
} from '../../testing/test-entities';
import { createTestEquipmentRegistry } from '../../testing/test-equipment-registry';
import { addTestEquipmentWithFlags } from '../../testing/test-mounted-equipment';

describe('VehicleEntity movement', () => {
  it('applies hydrofoil, modular armor, and dune buggy modifiers', () => {
    const entity = new SupportTankEntity();
    entity.originalWalkMP.set(6);

    expect(entity.walkMP()).toBe(6);

    addTestEquipmentWithFlags(entity, 'F_HYDROFOIL');
    expect(entity.walkMP()).toBe(8);

    entity.setEquipment([]);
    addTestEquipmentWithFlags(entity, 'F_MODULAR_ARMOR');
    expect(entity.walkMP()).toBe(5);
    expect(entity.maxWalkMP()).toBe(6);

    entity.setEquipment([]);
    addTestEquipmentWithFlags(entity, 'F_DUNE_BUGGY');
    expect(entity.walkMP()).toBe(5);
  });

  it('uses six hull locations for large support tanks', () => {
    const entity = new LargeSupportTankEntity();
    entity.setTonnage(120);

    expect(entity.locationOrder).toEqual([
      'Front', 'Front Right', 'Front Left', 'Rear Right', 'Rear Left', 'Rear',
    ]);
    expect(entity.totalInternalPoints()).toBe(72);
  });

  it('uses expanded locations for ordinary superheavy tanks', () => {
    const entity = new TankEntity();
    entity.motiveType.set('Tracked');
    entity.setTonnage(140);
    entity.hasTurret.set(true);

    expect(entity.locationOrder.length).toBe(7);
    expect(entity.totalInternalPoints()).toBe(98);
  });

  it('derives the sponson turret system from mounted equipment', () => {
    const sponsonTurret = createEquipment({
      id: 'SponsonTurret', name: 'Sponson Turret', type: 'misc', flags: ['F_SPONSON_TURRET'],
    });
    const entity = new TankEntity(createTestEquipmentRegistry({ SponsonTurret: sponsonTurret }));
    addTestEquipmentWithFlags(entity, 'F_ENERGY', { turretType: 'sponson' });
    expect(entity.implicitSystemEquipment()).toEqual([sponsonTurret]);

    entity.setEquipment([]);
    expect(entity.implicitSystemEquipment()).toEqual([]);
  });
});