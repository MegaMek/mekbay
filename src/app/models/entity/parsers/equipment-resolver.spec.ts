import { encodeEquipmentLine } from '../writers/equipment-encoder';
import { EntityMountedEquipment } from '../types/equipment';
import { parseEquipmentLine } from './equipment-resolver';

describe('parseEquipmentLine', () => {
  it('preserves numeric colon aliases in the generic grammar', () => {
    const parsed = parseEquipmentLine('CommsGear:10');

    expect(parsed.name).toBe('CommsGear:10');
    expect(parsed.shots).toBeUndefined();
  });

  it('parses canonical large-craft ammo quantities contextually', () => {
    const parsed = parseEquipmentLine('IS Ammo Extended LRM-20:60', {
      profile: 'large-craft',
    });

    expect(parsed.name).toBe('IS Ammo Extended LRM-20');
    expect(parsed.shots).toBe(60);
  });

  it('does not treat arbitrary large-craft numeric aliases as quantities', () => {
    const parsed = parseEquipmentLine('CommsGear:10', { profile: 'large-craft' });

    expect(parsed.name).toBe('CommsGear:10');
    expect(parsed.shots).toBeUndefined();
  });

  it('supports the DropShip pod quantity grammar only for DropShips', () => {
    expect(parseEquipmentLine('Coolant Pod:5', { profile: 'dropship' })).toEqual(
      jasmine.objectContaining({ name: 'Coolant Pod', shots: 5 }),
    );
    const largeCraft = parseEquipmentLine('Coolant Pod:5', { profile: 'large-craft' });
    expect(largeCraft.name).toBe('Coolant Pod:5');
    expect(largeCraft.shots).toBeUndefined();
  });

  it('consumes SIZE operands without interpreting them as shots', () => {
    const parsed = parseEquipmentLine('Cargo:SIZE:4', { profile: 'large-craft' });

    expect(parsed.name).toBe('Cargo');
    expect(parsed.size).toBe(4);
    expect(parsed.shots).toBeUndefined();
  });

  it('parses explicit Shots syntax independently of bay grammar', () => {
    const parsed = parseEquipmentLine('ISUltraAC2 Ammo:Shots6#');

    expect(parsed.name).toBe('ISUltraAC2 Ammo');
    expect(parsed.shots).toBe(6);
  });

  it('parses ProtoMek parenthesized ammo quantities contextually', () => {
    const examples = [
      ['Clan Ammo SRM-2 (10)', 'Clan Ammo SRM-2', 10],
      ['CLAPGaussRifle Ammo (13)', 'CLAPGaussRifle Ammo', 13],
      ['Clan Ammo ProtoMech LRM-3 (8)', 'Clan Ammo ProtoMech LRM-3', 8],
      ['Clan Machine Gun Ammo - Proto (20)', 'Clan Machine Gun Ammo - Proto', 20],
      ['CLMediumChemLaserAmmo (75)', 'CLMediumChemLaserAmmo', 75],
      ['CLPlasmaCannonAmmo (10)', 'CLPlasmaCannonAmmo', 10],
    ] as const;

    for (const [line, name, shots] of examples) {
      expect(parseEquipmentLine(line, { profile: 'protomek' })).toEqual(
        jasmine.objectContaining({ name, shots }),
      );
    }
  });

  it('preserves parenthesized integers outside the ProtoMek grammar', () => {
    const generic = parseEquipmentLine('Widget (10)');

    expect(generic.name).toBe('Widget (10)');
    expect(generic.shots).toBeUndefined();
  });

  it('parses Java rear-mounted weapon-bay prefixes in their wire order', () => {
    const parsed = parseEquipmentLine('(R) (B) ISGaussRifle', {
      profile: 'dropship',
    });

    expect(parsed.name).toBe('ISGaussRifle');
    expect(parsed.rearMounted).toBeTrue();
    expect(parsed.isNewBay).toBeTrue();
  });

  it('does not consume weapon-bay syntax for unsupported entity profiles', () => {
    const parsed = parseEquipmentLine('(B) Medium Laser');

    expect(parsed.name).toBe('(B) Medium Laser');
    expect(parsed.isNewBay).toBeFalse();
  });

  it('round trips a rear-mounted bay boundary emitted by the writer', () => {
    const line = encodeEquipmentLine(new EntityMountedEquipment({
      mountId: 'bay-weapon',
      equipmentId: 'ISGaussRifle',
      allocation: { kind: 'location', location: 'Aft' },
      rearMounted: true,
      turretMounted: false,
      omniPodMounted: false,
      isNewBay: true,
      armored: false,
    }), { blkMode: true });

    expect(line).toBe('(R) (B) ISGaussRifle');
    expect(parseEquipmentLine(line, { profile: 'dropship' })).toEqual(
      jasmine.objectContaining({
        name: 'ISGaussRifle',
        rearMounted: true,
        isNewBay: true,
      }),
    );
  });
});
