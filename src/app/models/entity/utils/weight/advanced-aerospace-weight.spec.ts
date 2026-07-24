import { TestJumpShipEntity, TestSpaceStationEntity, TestWarShipEntity } from '../../testing/test-entities';
import { calculateAdvancedAerospaceWeightBreakdown } from './advanced-aerospace-weight';

describe('advanced aerospace construction mass', () => {
  it('calculates JumpShip structure, transit engine, KF core, controls, and sail', () => {
    const entity = new TestJumpShipEntity();
    entity.setTonnage(100000);
    entity.originalWalkMP.set(1);
    entity.structuralIntegrity.set(10);
    const result = calculateAdvancedAerospaceWeightBreakdown(entity);
    expect(result.structure).toBe(667);
    expect(result.engine).toBe(6000);
    expect(result.jumpDrive).toBe(95000);
    expect(result.controls).toBe(250);
    expect(result.sail).toBe(44);
  });

  it('uses WarShip SI structure and compact KF core', () => {
    const entity = new TestWarShipEntity();
    entity.setTonnage(100000);
    entity.structuralIntegrity.set(40);
    entity.driveCoreType.set('Compact');
    const result = calculateAdvancedAerospaceWeightBreakdown(entity);
    expect(result.structure).toBe(4000);
    expect(result.jumpDrive).toBe(45250);
    expect(result.sail).toBe(35);
  });

  it('uses station structure, controls, and station-keeping drive', () => {
    const entity = new TestSpaceStationEntity();
    entity.setTonnage(50000);
    entity.originalWalkMP.set(0);
    const result = calculateAdvancedAerospaceWeightBreakdown(entity);
    expect(result.structure).toBe(500);
    expect(result.engine).toBe(600);
    expect(result.jumpDrive).toBe(0);
    expect(result.controls).toBe(50);
  });

  it('uses capital fuel density boundaries and pump allowance', () => {
    const entity = new TestJumpShipEntity();
    entity.setTonnage(110000);
    entity.fuel.set(500);
    expect(calculateAdvancedAerospaceWeightBreakdown(entity).fuel).toBe(102);
  });

  it('uses gravity-deck diameter boundaries', () => {
    const entity = new TestJumpShipEntity();
    entity.gravDecks.set([99, 100, 250, 251]);
    expect(calculateAdvancedAerospaceWeightBreakdown(entity).gravDecks).toBe(750);
  });
});