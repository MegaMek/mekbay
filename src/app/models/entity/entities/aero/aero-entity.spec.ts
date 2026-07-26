import {
  TestConvFighterEntity as ConvFighterEntity,
  TestFixedWingSupportEntity as FixedWingSupportEntity,
} from '../../testing/test-entities';
import { addTestEquipmentWithFlags } from '../../testing/test-mounted-equipment';
import { writeBlkAero } from '../../writers/blk-aero-writer';

describe('AeroEntity movement', () => {
  it('reduces safe thrust by one for modular armor', () => {
    const entity = new ConvFighterEntity();
    entity.originalWalkMP.set(6);

    expect(entity.walkMP()).toBe(6);
    expect(entity.runMP()).toBe(9);

    addTestEquipmentWithFlags(entity, 'F_MODULAR_ARMOR', { location: 'Nose' });
    expect(entity.walkMP()).toBe(5);
    expect(entity.runMP()).toBe(8);
    expect(entity.maxWalkMP()).toBe(6);
    expect(entity.maxRunMP()).toBe(9);
  });

  it('automatically derives fighter structural integrity from weight and thrust', () => {
    const entity = new ConvFighterEntity();
    entity.setTonnage(70);
    entity.originalWalkMP.set(5);

    entity.autoSetStructuralIntegrity();

    expect(entity.structuralIntegrity()).toBe(7);
    expect(entity.totalInternalPoints()).toBe(7);
  });

  it('uses safe thrust as fixed-wing support structural integrity', () => {
    const entity = new FixedWingSupportEntity();
    entity.setTonnage(100);
    entity.originalWalkMP.set(4);

    entity.autoSetStructuralIntegrity();

    expect(entity.structuralIntegrity()).toBe(4);
  });

  it('persists VSTOL only for conventional fighters', () => {
    const entity = new ConvFighterEntity();

    expect(entity.vstol()).toBeFalse();
    entity.vstol.set(true);
    expect(entity.vstol()).toBeTrue();
  });

  it('writes derived fixed-wing VSTOL chassis capability as a BLK VSTOL block', () => {
    const entity = new FixedWingSupportEntity();
    addTestEquipmentWithFlags(entity, 'F_VSTOL_CHASSIS', { location: 'Body' });

    expect(writeBlkAero(entity)).toContain('<vstol>\n1\n</vstol>');
  });

  it('does not write a BLK VSTOL block for STOL-only fixed-wing support', () => {
    const entity = new FixedWingSupportEntity();
    addTestEquipmentWithFlags(entity, 'F_STOL_CHASSIS', { location: 'Body' });

    expect(writeBlkAero(entity)).not.toContain('<vstol>');
  });

  it('derives fixed-wing bomb capacity from hardpoints and cargo bays', () => {
    const entity = new FixedWingSupportEntity();
    entity.transporters.set([
      cargoBay(2.9),
      { ...cargoBay(8), id: 'fighter-bay', configuration: { type: 'fighter', arts: false } },
    ]);
    addTestEquipmentWithFlags(entity, 'F_EXTERNAL_STORES_HARDPOINT', { location: 'Nose' });
    addTestEquipmentWithFlags(entity, 'F_EXTERNAL_STORES_HARDPOINT', { location: 'Left Wing' });

    expect(entity.maxBombPoints()).toBe(4);
  });

  it('reports zero bomb capacity without hardpoints or cargo space', () => {
    const entity = new FixedWingSupportEntity();

    expect(entity.maxBombPoints()).toBe(0);
  });
});

function cargoBay(capacity: number) {
  return {
    id: 'cargo-bay', kind: 'bay' as const, configuration: { type: 'cargo' as const },
    capacity, doors: 0, bayNumber: 0, omni: false,
  };
}