import { createEquipment, Equipment } from '../../../equipment.model';
import { EquipmentRegistry } from '../../../equipment-lookup';
import { EntityMountedEquipment } from '../../types';
import { LargeSupportTankEntity } from './large-support-tank-entity';
import { SupportTankEntity } from './support-tank-entity';
import { TankEntity } from './tank-entity';

describe('VehicleEntity movement', () => {
  it('applies hydrofoil, modular armor, and dune buggy modifiers', () => {
    const entity = new SupportTankEntity();
    entity.originalWalkMP.set(6);

    expect(entity.walkMP()).toBe(6);

    entity.equipment.set([mountWithFlag('F_HYDROFOIL')]);
    expect(entity.walkMP()).toBe(8);

    entity.equipment.set([mountWithFlag('F_MODULAR_ARMOR')]);
    expect(entity.walkMP()).toBe(5);
    expect(entity.maxWalkMP()).toBe(6);

    entity.equipment.set([mountWithFlag('F_DUNE_BUGGY')]);
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
    const entity = new TankEntity(new EquipmentRegistry({ SponsonTurret: sponsonTurret }));
    const sponsonMount = mountWithFlag('F_ENERGY');
    sponsonMount.turretType = 'sponson';

    entity.equipment.set([sponsonMount]);
    expect(entity.implicitSystemEquipment()).toEqual([sponsonTurret]);

    entity.equipment.set([]);
    expect(entity.implicitSystemEquipment()).toEqual([]);
  });
});

function mountWithFlag(flag: string): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: flag,
    equipmentId: flag,
    equipment: { hasFlag: (candidate: string) => candidate === flag } as Equipment,
    allocation: { kind: 'location', location: 'Body' },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
}