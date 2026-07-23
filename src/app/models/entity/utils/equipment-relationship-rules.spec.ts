import { MiscEquipment, WeaponEquipment } from '../../equipment.model';
import { TestTankEntity } from '../testing/test-entities';
import { EntityMountedEquipment } from '../types';
import { reconcileEquipmentRelationships } from './equipment-relationship-rules';

function mount(equipment: WeaponEquipment | MiscEquipment, id: string): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: id, equipmentId: equipment.id, equipment,
    allocation: { kind: 'location', location: 'Front' }, rearMounted: false,
    turretMounted: false, omniPodMounted: false, armored: false,
  });
}

describe('reconcileEquipmentRelationships', () => {
  it('claims compatible Artemis launchers in deterministic mount order', () => {
    const entity = new TestTankEntity();
    const launcher = new WeaponEquipment({
      id: 'launcher', name: 'Launcher', type: 'weapon', stats: { bv: 100 },
      weapon: { ammoType: 'LRM', rackSize: 10 }, flags: ['F_ARTEMIS_COMPATIBLE'],
    });
    const artemis = new MiscEquipment({
      id: 'artemis', name: 'Artemis', type: 'misc', flags: ['F_ARTEMIS'],
    });
    entity.setEquipment([
      mount(launcher, 'w1'), mount(launcher, 'w2'), mount(artemis, 'a1'), mount(artemis, 'a2'),
    ]);

    reconcileEquipmentRelationships(entity);

    const firstArtemis = entity.equipment().find(m => m.mountId === 'a1')!;
    const secondArtemis = entity.equipment().find(m => m.mountId === 'a2')!;
    const firstWeapon = entity.equipment().find(m => m.mountId === 'w1')!;
    const secondWeapon = entity.equipment().find(m => m.mountId === 'w2')!;
    expect(entity.getLinkedMount(firstArtemis)).toBe(firstWeapon);
    expect(entity.getLinkedMount(secondArtemis)).toBe(secondWeapon);

    const movedWeapon = entity.moveEquipment(firstWeapon, 'Rear');

    expect(movedWeapon.location).toBe('Rear');
    expect(entity.getLinkedMount(firstArtemis)).toBeUndefined();

    entity.removeEquipment(movedWeapon);

    expect(entity.getLinkedMount(firstArtemis)).toBeUndefined();
  });

  it('prefers the immediate predecessor for laser modules', () => {
    const entity = new TestTankEntity();
    const laser = new WeaponEquipment({
      id: 'laser', name: 'Laser', type: 'weapon', stats: { bv: 50 },
      weapon: { ammoType: 'NA' }, flags: ['F_LASER'],
    });
    const insulator = new MiscEquipment({
      id: 'insulator', name: 'Insulator', type: 'misc', flags: ['F_LASER_INSULATOR'],
    });
    entity.setEquipment([mount(laser, 'w1'), mount(laser, 'w2'), mount(insulator, 'i1')]);

    reconcileEquipmentRelationships(entity);

    const insulatorMount = entity.equipment().find(m => m.mountId === 'i1')!;
    expect(entity.getLinkedMount(insulatorMount)).toBe(entity.equipment().find(m => m.mountId === 'w2'));
  });

  it('links canonical Heavy PPC mounts to capacitors one-to-one', () => {
    const entity = new TestTankEntity();
    const heavyPpc = new WeaponEquipment({
      id: 'Heavy PPC', name: 'Heavy PPC', type: 'weapon', stats: { bv: 317 },
      weapon: { heat: 15 }, flags: ['F_PPC', 'F_PPC_CAPACITOR_COMPATIBLE'],
    });
    const capacitor = new MiscEquipment({
      id: 'PPC Capacitor', name: 'PPC Capacitor', type: 'misc', flags: ['F_PPC_CAPACITOR'],
    });
    entity.setEquipment([
      mount(heavyPpc, 'w1'), mount(capacitor, 'c1'),
      mount(heavyPpc, 'w2'), mount(capacitor, 'c2'),
    ]);

    reconcileEquipmentRelationships(entity);

    expect(entity.getLinkedMount(entity.equipment()[1])).toBe(entity.equipment()[0]);
    expect(entity.getLinkedMount(entity.equipment()[3])).toBe(entity.equipment()[2]);
  });

  it('groups machine guns in an explicit bay owned by their array', () => {
    const entity = new TestTankEntity();
    const machineGun = new WeaponEquipment({
      id: 'mg', name: 'Machine Gun', type: 'weapon', stats: { bv: 5 },
      weapon: { rackSize: 2 }, flags: ['F_MG'],
    });
    const array = new WeaponEquipment({
      id: 'mga', name: 'Machine Gun Array', type: 'weapon',
      weapon: { rackSize: 2 }, flags: ['F_MGA'],
    });
    entity.setEquipment([mount(array, 'array'), mount(machineGun, 'mg1'), mount(machineGun, 'mg2')]);

    reconcileEquipmentRelationships(entity);

    const bay = entity.equipmentBays()[0];
    expect(bay.kind).toBe('machine-gun-array');
    expect(bay.controller).toBe(entity.equipment()[0]);
    expect(bay.mounts).toEqual(entity.equipment().slice(1));

    const firstMachineGun = entity.equipment().find(m => m.mountId === 'mg1')!;
    const movedMachineGun = entity.moveEquipment(firstMachineGun, 'Rear');

    expect(entity.equipmentBays()[0].mounts[0]).toBe(movedMachineGun);
    expect(entity.equipmentBays()[0].mounts[0].location).toBe('Rear');

    entity.removeEquipment(movedMachineGun);

    const secondMachineGun = entity.equipment().find(m => m.mountId === 'mg2')!;
    expect(entity.equipmentBays()[0].mounts).toEqual([secondMachineGun]);

    entity.removeEquipment(entity.equipment().find(m => m.mountId === 'array')!);

    expect(entity.equipmentBays()).toEqual([]);
  });

  it('installs enhancements with domain-validated enhancement-to-weapon links', () => {
    const entity = new TestTankEntity();
    const launcher = new WeaponEquipment({
      id: 'launcher', name: 'Launcher', type: 'weapon',
      weapon: { ammoType: 'LRM', rackSize: 10 }, flags: ['F_ARTEMIS_COMPATIBLE'],
    });
    const artemis = new MiscEquipment({
      id: 'artemis', name: 'Artemis', type: 'misc', flags: ['F_ARTEMIS'],
    });
    const weaponMount = entity.addEquipment({
      equipmentId: launcher.id, equipment: launcher,
      allocation: { kind: 'location', location: 'Front' }, rearMounted: false,
      turretMounted: false, omniPodMounted: false, armored: false,
    });
    const artemisMount = entity.addEquipment({
      equipmentId: artemis.id, equipment: artemis,
      allocation: { kind: 'location', location: 'Front' }, rearMounted: false,
      turretMounted: false, omniPodMounted: false, armored: false,
    }, { linkedTo: weaponMount });

    expect(entity.getLinkedMount(artemisMount)).toBe(weaponMount);
    expect(entity.getLinkingMount(weaponMount)).toBe(artemisMount);
    expect(entity.canLinkEquipment(weaponMount, artemisMount)).toBeFalse();
    expect(() => entity.linkEquipment(weaponMount, artemisMount)).toThrowError(/enhancement/);
  });

  it('allocates entity-local mount IDs without colliding with hydrated mounts', () => {
    const entity = new TestTankEntity();
    const existing = new MiscEquipment({ id: 'existing', name: 'Existing', type: 'misc' });
    entity.setEquipment([mount(existing, 'm1')]);

    const added = entity.addEquipment({
      equipmentId: existing.id,
      equipment: existing,
      allocation: { kind: 'location', location: 'Front' },
      rearMounted: false,
      turretMounted: false,
      omniPodMounted: false,
      armored: false,
    });

    expect(added.mountId).toBe('m2');
  });
});