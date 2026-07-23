import { TestInfantryEntity, TestTankEntity } from '../../testing/test-entities';

describe('entity effective tonnage', () => {
  it('calculates infantry construction mass independently through loadoutTonnage', () => {
    const entity = new TestInfantryEntity();
    entity.squadSize.set(10);
    entity.squadCount.set(2);

    expect(entity.loadoutTonnage()).toBe(2);

    entity.squadSize.set(20);
    expect(entity.loadoutTonnage()).toBe(3.5);
  });

  it('does not substitute declared tonnage for an unimplemented family', () => {
    const entity = new TestTankEntity();
    entity.setTonnage(50);

    expect(entity.tonnage()).toBe(50);
    expect(() => entity.loadoutTonnage()).toThrowError(
      'Effective tonnage is not implemented for Tank',
    );
  });
});