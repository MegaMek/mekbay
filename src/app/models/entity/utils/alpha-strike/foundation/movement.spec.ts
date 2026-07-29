import {
  TestBipedMekEntity as BipedMekEntity,
  TestInfantryEntity as InfantryEntity,
  TestJumpShipEntity as JumpShipEntity,
  TestLamEntity as LamEntity,
  TestQuadVeeEntity as QuadVeeEntity,
  TestWarShipEntity as WarShipEntity,
} from '../../../testing/test-entities';
import {
  alphaStrikeMovement,
  movementCode,
  movementString,
  primaryTmmMovement,
  tmmForMovement,
} from './movement';

describe('Alpha Strike movement', () => {
  it('converts ordinary ground movement and preserves the empty movement code', () => {
    const entity = new BipedMekEntity();
    entity.originalWalkMP.set(5);

    const movement = alphaStrikeMovement(entity);

    expect(movement).toEqual({ values: { '': 10 }, primary: '' });
    expect(movementString('BM', movement.values)).toBe('10"');
    expect(primaryTmmMovement(entity, movement)).toBe(10);
  });

  it('uses minimum foot movement for immobile conventional infantry', () => {
    const entity = new InfantryEntity();
    entity.originalWalkMP.set(0);
    entity.motiveType.set('Leg');

    const movement = alphaStrikeMovement(entity);

    expect(movement).toEqual({ values: { f: 2 }, primary: 'f' });
    expect(movementString('CI', movement.values)).toBe('2"f');
  });

  it('formats capital movement modes without inch marks', () => {
    const warShip = new WarShipEntity();
    warShip.originalWalkMP.set(3);
    const jumpShip = new JumpShipEntity();

    expect(movementString('WS', alphaStrikeMovement(warShip).values)).toBe('3');
    expect(alphaStrikeMovement(jumpShip)).toEqual({ values: { k: 2 }, primary: 'k' });
    expect(movementString('JS', { k: 2 })).toBe('0.2k');
  });

  it('keeps LAM modes in the map but excludes them from BattleMek display movement', () => {
    const entity = new LamEntity();
    entity.originalWalkMP.set(5);
    entity.lamType.set('Standard');

    const movement = alphaStrikeMovement(entity);

    expect(movement.values).toEqual({ '': 10, a: 0, g: 0 });
    expect(movement.primary).toBe('');
    expect(movementString('BM', movement.values)).toBe('10"');
  });

  it('selects QuadVee movement codes', () => {
    const entity = new QuadVeeEntity();
    entity.motiveType.set('Track');
    expect(movementCode(entity)).toBe('qt');

    entity.motiveType.set('Wheel');
    expect(movementCode(entity)).toBe('qw');
  });

  it('converts every TMM boundary', () => {
    expect([4, 5, 8, 9, 12, 13, 18, 19, 34, 35].map(tmmForMovement))
      .toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });
});
