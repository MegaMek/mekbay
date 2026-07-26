import { TestBattleArmorEntity as BattleArmorEntity } from '../../testing/test-entities';
import { addTestEquipmentWithFlags } from '../../testing/test-mounted-equipment';

describe('BattleArmorEntity movement', () => {
  it('uses one canonical signal for squad size and trooper count', () => {
    const entity = new BattleArmorEntity();

    expect(entity.squadCount()).toBe(1);
    expect(entity.squadSize()).toBe(5);
    expect(entity.squadSize).toBe(entity.trooperCount);
    entity.trooperCount.set(6);
    expect(entity.squadSize()).toBe(6);
  });

  it('derives jump and UMU movement from slotless propulsion equipment', () => {
    const entity = new BattleArmorEntity();
    entity.originalWalkMP.set(1);
    entity.propulsionMP.set(3);
    entity.motiveType.set('Jump');
    addTestEquipmentWithFlags(entity, 'F_JUMP_JET', { location: 'None' });

    expect(entity.walkMP()).toBe(1);
    expect(entity.runMP()).toBe(1);
    expect(entity.jumpMP()).toBe(3);
    expect(entity.umuMP()).toBe(0);
    expect(entity.equipment()[0].location).toBe('None');
    expect(entity.equipment()[0].placements).toBeUndefined();

    entity.motiveType.set('UMU');
    entity.propulsionMP.set(2);
    entity.setEquipment([]);
    addTestEquipmentWithFlags(entity, 'F_UMU', { location: 'None' });
    expect(entity.jumpMP()).toBe(0);
    expect(entity.umuMP()).toBe(2);
  });

  it('reacts to BA movement modifiers without changing source walk MP', () => {
    const entity = new BattleArmorEntity();
    entity.originalWalkMP.set(5);
    entity.declaredWeightClass.set('Light');
    addTestEquipmentWithFlags(entity, 'F_MASC', { location: 'None' });

    expect(entity.walkMP()).toBe(7);
    expect(entity.runMP()).toBe(7);
    expect(entity.originalWalkMP()).toBe(5);

    entity.motiveType.set('UMU');
    entity.setEquipment([]);
    addTestEquipmentWithFlags(entity, 'F_MECHANICAL_JUMP_BOOSTER', { location: 'None' });
    expect(entity.jumpMP()).toBe(1);
  });
});

describe('BattleArmorEntity mechanized capability', () => {
  it('rejects quad squads even when they mount magnetic clamps', () => {
    const entity = new BattleArmorEntity();
    entity.chassisType.set('Quad');
    addTestEquipmentWithFlags(entity, 'F_MAGNETIC_CLAMP');

    expect(entity.mechanizedCapable()).toBeFalse();
  });

  it('accepts a non-quad squad with magnetic clamps', () => {
    const entity = new BattleArmorEntity();
    addTestEquipmentWithFlags(entity, 'F_MAGNETIC_CLAMP');

    expect(entity.mechanizedCapable()).toBeTrue();
  });

  it('applies the light-class armored glove threshold', () => {
    const entity = new BattleArmorEntity();
    entity.declaredWeightClass.set('Light');
    addTestEquipmentWithFlags(entity, 'F_ARMORED_GLOVE');

    expect(entity.mechanizedCapable()).toBeFalse();

    addTestEquipmentWithFlags(entity, 'F_ARMORED_GLOVE');
    expect(entity.mechanizedCapable()).toBeTrue();
  });

  it('accepts basic manipulators and battle claws only through heavy weight', () => {
    const entity = new BattleArmorEntity();
    entity.declaredWeightClass.set('Medium');
    addTestEquipmentWithFlags(entity, 'F_BASIC_MANIPULATOR');
    expect(entity.mechanizedCapable()).toBeTrue();

    entity.declaredWeightClass.set('Heavy');
    entity.setEquipment([]);
    addTestEquipmentWithFlags(entity, 'F_BATTLE_CLAW');
    expect(entity.mechanizedCapable()).toBeTrue();

    entity.declaredWeightClass.set('Assault');
    expect(entity.mechanizedCapable()).toBeFalse();
  });

  it('rejects squads without qualifying equipment', () => {
    const entity = new BattleArmorEntity();

    expect(entity.mechanizedCapable()).toBeFalse();
  });
});