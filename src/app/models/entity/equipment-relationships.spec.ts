import { EquipmentRelationships } from './equipment-relationships';
import { EntityMountedEquipment } from './types';

describe('EquipmentRelationships', () => {
  it('resolves links against replacement mount instances', () => {
    const source = mount('source');
    const target = mount('target');
    const relationships = new EquipmentRelationships().withLink(source, target);
    const replacement = target.clone({ allocation: { kind: 'location', location: 'Rear' } });

    const mounts = index(source, replacement);
    expect(relationships.linkedMount(source, mounts)).toBe(replacement);
    expect(relationships.linkingMount(replacement, mounts)).toBe(source);
  });

  it('rejects ambiguous or cyclic links', () => {
    const first = mount('first');
    const second = mount('second');
    const third = mount('third');
    const relationships = new EquipmentRelationships().withLink(first, second);

    expect(() => relationships.withLink(third, second)).toThrowError(/already linked/);
    expect(() => relationships.withLink(second, first)).toThrowError(/cycle/);
    expect(() => relationships.withLink(first, first)).toThrowError(/itself/);
  });

  it('rejects cyclic links supplied to the constructor', () => {
    const first = mount('first');
    const second = mount('second');
    const links = new Map([
      [first.mountId, second.mountId],
      [second.mountId, first.mountId],
    ]);

    expect(() => new EquipmentRelationships(links)).toThrowError(/cycle/);
  });

  it('removes incoming links and bay membership with a mount', () => {
    const controller = mount('controller');
    const source = mount('source');
    const target = mount('target');
    const relationships = new EquipmentRelationships()
      .withLink(source, target)
      .withBay('machine-gun-array', { controller, mounts: [target] })
      .withoutMount(target);

    const mounts = index(controller, source);
    expect(relationships.linkedMount(source, mounts)).toBeUndefined();
    expect(relationships.resolveBays(mounts)).toEqual([]);
  });

  it('rejects duplicate membership within a bay kind', () => {
    const member = mount('member');
    const relationships = new EquipmentRelationships()
      .withBay('weapon-bay', { mounts: [member] });

    expect(() => relationships.withBay('weapon-bay', { mounts: [member] }))
      .toThrowError(/multiple weapon-bay bays/);
  });
});

function mount(mountId: string): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId,
    equipmentId: mountId,
    allocation: { kind: 'location', location: 'Front' },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
}

function index(...mounts: EntityMountedEquipment[]) {
  return new Map(mounts.map(mount => [mount.mountId, mount]));
}