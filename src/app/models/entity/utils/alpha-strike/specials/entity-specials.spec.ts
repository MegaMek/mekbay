import { WeaponEquipment } from '../../../../equipment.model';
import {
  TestDropShipEntity as DropShipEntity,
  TestLamEntity as LamEntity,
  TestSmallCraftEntity as SmallCraftEntity,
} from '../../../testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../../testing/test-mounted-equipment';
import { alphaStrikeEntitySpecials } from './entity-specials';

describe('Alpha Strike entity specials', () => {
  it('adds lifecycle-injected LECM to armed military Small Craft', () => {
    const entity = new SmallCraftEntity();
    addTestEquipment(entity, weapon(), { location: 'Nose' });

    expect(alphaStrikeEntitySpecials(entity, 'SC', 1)).toContain('LECM');
  });

  it('does not add lifecycle-injected LECM to unarmed Small Craft or DropShips', () => {
    expect(alphaStrikeEntitySpecials(new SmallCraftEntity(), 'SC', 1)).not.toContain('LECM');

    const dropShip = new DropShipEntity();
    addTestEquipment(dropShip, weapon(), { location: 'Nose' });
    expect(alphaStrikeEntitySpecials(dropShip, 'DS', 1)).not.toContain('LECM');
  });

  it('does not add lifecycle-injected LECM when an ECM suite is mounted', () => {
    const entity = new SmallCraftEntity();
    addTestEquipment(entity, weapon(), { location: 'Nose' });
    addTestEquipmentWithFlags(entity, 'F_ECM', { location: 'Hull' });

    expect(alphaStrikeEntitySpecials(entity, 'SC', 1)).not.toContain('LECM');
  });

  it('adds standard LAM movement and base fuel abilities', () => {
    const entity = new LamEntity();

    const specials = alphaStrikeEntitySpecials(
      entity,
      'BM',
      2,
      { values: { '': 10, a: 5, g: 30 }, primary: '' },
    );

    expect(specials).toContain('FUEL4');
    expect(specials).toContain('LAM(30"g/5a)');
    expect(specials.some(special => special.startsWith('BIM('))).toBeFalse();
    expect(specials.some(special => special.startsWith('BOMB'))).toBeFalse();
  });

  it('adds bimodal LAM movement without a ground conversion mode', () => {
    const entity = new LamEntity();
    entity.lamType.set('Bimodal');

    const specials = alphaStrikeEntitySpecials(
      entity,
      'BM',
      2,
      { values: { '': 8, a: 4 }, primary: '' },
    );

    expect(specials).toContain('BIM(4a)');
    expect(specials.some(special => special.startsWith('LAM('))).toBeFalse();
  });

  it('counts only canonical LAM fuel tanks', () => {
    const entity = new LamEntity();
    addTestEquipmentWithFlags(entity, 'F_LAM_FUEL_TANK');
    addTestEquipmentWithFlags(entity, 'F_FUEL');

    const specials = alphaStrikeEntitySpecials(
      entity,
      'BM',
      2,
      { values: { a: 4, g: 24 }, primary: '' },
    );

    expect(specials).toContain('FUEL8');
    expect(specials).not.toContain('FUEL12');
  });

  it('rounds each five LAM bomb bays up to one BOMB value', () => {
    const entity = new LamEntity();
    for (let i = 0; i < 6; i++) addTestEquipmentWithFlags(entity, 'F_BOMB_BAY');

    const specials = alphaStrikeEntitySpecials(
      entity,
      'BM',
      2,
      { values: { a: 4, g: 24 }, primary: '' },
    );

    expect(specials).toContain('BOMB2');
  });
});

function weapon(): WeaponEquipment {
  return new WeaponEquipment({
    id: 'military-weapon', name: 'Military Weapon', type: 'weapon',
    weapon: { damage: 5, ranges: [6, 12, 18, 24], ammoType: 'NA' },
  });
}