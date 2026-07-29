import {
  TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
  TestBattleArmorEntity as BattleArmorEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestDropShipEntity as DropShipEntity,
  TestFixedWingSupportEntity as FixedWingSupportEntity,
  TestInfantryEntity as InfantryEntity,
  TestSupportTankEntity as SupportTankEntity,
} from '../../../testing/test-entities';
import { alphaStrikeDamageFamily } from './damage-dispatch';

describe('Alpha Strike damage dispatch', () => {
  it('prioritizes infantry family converters', () => {
    expect(alphaStrikeDamageFamily(new BattleArmorEntity(), 'BA')).toBe('battle-armor');
    expect(alphaStrikeDamageFamily(new InfantryEntity(), 'CI')).toBe('conventional-infantry');
  });

  it('uses arced conversion for large aerospace', () => {
    expect(alphaStrikeDamageFamily(new DropShipEntity(), 'DS')).toBe('arced');
  });

  it('uses aerospace conversion for fighters and fixed-wing support', () => {
    expect(alphaStrikeDamageFamily(new AeroSpaceFighterEntity(), 'AF')).toBe('aerospace');
    expect(alphaStrikeDamageFamily(new FixedWingSupportEntity(), 'SV')).toBe('aerospace');
  });

  it('does not let final large-support abilities change damage dispatch', () => {
    const entity = new SupportTankEntity();
    entity.setTonnage(201);

    expect(alphaStrikeDamageFamily(entity, 'SV')).toBe('generic');
  });

  it('uses generic conversion for ordinary ground units', () => {
    expect(alphaStrikeDamageFamily(new BipedMekEntity(), 'BM')).toBe('generic');
  });
});
