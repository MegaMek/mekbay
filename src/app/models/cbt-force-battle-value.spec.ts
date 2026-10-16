// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { calculateCBTForceBattleValues } from './cbt-force-battle-value';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';
import { TestAeroSpaceFighterEntity,TestBattleArmorEntity,TestInfantryEntity,TestTankEntity } from './entity/testing/test-entities';
import { createTestEquipmentRegistry } from './entity/testing/test-equipment-registry';
import { adjustEntityBattleValueForSkills } from './entity/utils/battle-value/skill-facts';
import { AmmoEquipment,WeaponEquipment } from './equipment.model';
import { createMekUnit } from './runtime/cbt-mek-unit';
import { createNonMekUnit } from './runtime/cbt-non-mek-unit';

import { calculateAdjustedBV } from '../utils/cbt-common.util';
import type { CBTUnit } from './runtime/cbt-unit';
import { createDirectElectronicSuiteRuntimeFixture,createDirectMekRuntimeFixture } from './runtime/testing/direct-mek-runtime-fixture';
import type { UnitSummary } from './unit-summary.model';

describe('CBT force battle value authority', () => {
  for (const ruleset of ['core-2026', 'total-warfare'] as const) {
    it(`uses exact manual BV before skill/network adjustments and preserves peers in ${ruleset}`, async () => {
      const fixtures = [createDirectElectronicSuiteRuntimeFixture(ruleset), createDirectElectronicSuiteRuntimeFixture(ruleset)];
      const units = await Promise.all(fixtures.map((fixture, index) => createMekUnit({
        uuid: fixture.identity, instanceId: `manual-network-${index}`, crewSkills: { gunnery: 2, piloting: 3 },
      }, fixture.entity, fixture.identity, { initializerRevision: 1, profileId: 'pristine',
        deployment: { id: 'default' }, scenario: { id: 'test', ruleset } })));
      const input = { units: units.map((unit, index) => ({ unit, baseBattleValue: index === 0 ? 1234 : 500 })),
        scenario: { id: 'test', ruleset }, networks: [], isC3EndpointIntact: () => true };
      const calculated = calculateCBTForceBattleValues(input);
      expect(calculated.get(units[0].instanceId)!.adjusted).not.toBe(1234);
      expect(calculated.get(units[1].instanceId)!.c3).toBeGreaterThan(0);

      fixtures[0].entity.manualBV.set(1234);
      const manual = calculateCBTForceBattleValues(input);
      expect(manual.get(units[0].instanceId)).toEqual({
        base: 1234, tag: 0, c3: 0, externalStores: 0, skills: 0, adjustedPreSkill: 1234, adjusted: 1234,
      });
      expect(manual.get(units[1].instanceId)).toEqual(calculated.get(units[1].instanceId));
    });

    it(`uses a manual value even before null runtime BV and vacant-crew handling in ${ruleset}`, () => {
      const fixture = createDirectMekRuntimeFixture(ruleset);
      fixture.entity.manualBV.set(432);
      const unit = { instanceId: 'manual-vacant', getUnit: () => fixture.entity,
        query: () => fixture.instance.query(),
        getCrewAssignment: () => ({ schemaVersion: 1, positions: [] }),
      } as unknown as CBTUnit;
      expect(calculateCBTForceBattleValues({ units: [{ unit, baseBattleValue: null }],
        scenario: { id: 'test', ruleset }, networks: [], isC3EndpointIntact: () => false,
      }).get(unit.instanceId)).toEqual({
        base: 432, tag: 0, c3: 0, externalStores: 0, skills: 0, adjustedPreSkill: 432, adjusted: 432,
      });
    });
  }

  describe('Core homing Arrow IV TAG surcharge', () => {
    const tag = new WeaponEquipment({ id: 'TestInfantryTAG', name: 'TAG (Light, Man-Portable)', type: 'weapon',
      flags: ['F_INFANTRY', 'F_TAG'], infantry: { damage: 0, range: 3 } });
    const rifle = new WeaponEquipment({ id: 'TestRifle', name: 'Rifle', type: 'weapon',
      flags: ['F_INFANTRY'], infantry: { damage: 0.2, range: 1 } });
    const launcher = new WeaponEquipment({ id: 'TestArrowIV', name: 'Arrow IV', type: 'weapon',
      flags: ['F_ARTILLERY'], weapon: { ammoType: 'ARROW_IV', rackSize: 20 } });
    const homing = new AmmoEquipment({ id: 'TestArrowIVHoming', name: 'Arrow IV Homing Ammo', type: 'ammo',
      ammo: { type: 'ARROW_IV', rackSize: 20, shots: 1, munitionType: ['M_HOMING'] } });
    const lightTag = new WeaponEquipment({ id: 'TestLightTAG', name: 'Light TAG', type: 'weapon', flags: ['F_TAG'] });
    const registry = createTestEquipmentRegistry({
      [tag.id]: tag, [rifle.id]: rifle, [launcher.id]: launcher, [homing.id]: homing, [lightTag.id]: lightTag,
    });
    if (!rifle.isInfantryWeapon() || !tag.isInfantryWeapon()) throw new Error('Expected infantry weapons');
    const scenario = { id: 'test', ruleset: 'core-2026' } as const;
    const mount = (entity: TestTankEntity | TestBattleArmorEntity, equipment: WeaponEquipment | AmmoEquipment, location: string) =>
      entity.addEquipment({ equipmentId: equipment.id, equipment, allocation: { kind: 'location', location },
        rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false });
    const tagSurcharge = (designator: TestTankEntity | TestInfantryEntity | TestBattleArmorEntity) => {
      const artillery = new TestTankEntity(registry);
      mount(artillery, launcher, 'Front');
      mount(artillery, homing, 'Front');
      const units = [artillery, designator].map((entity, index) => {
        const uuid = asUnitUuid(`019f6767-0dcb-7bb8-992f-aef08202f5e${index}`);
        entity.uuid.set(uuid);
        return createNonMekUnit(entity, { instanceId: `unit:tag-${index}`, uuid, deployment: { id: 'default' },
          scenario, initialStateProfileId: 'pristine-non-mek-v1' });
      });
      return calculateCBTForceBattleValues({
        units: units.map(unit => ({ unit, baseBattleValue: 100 })),
        scenario, networks: [], isC3EndpointIntact: () => true,
      }).get(units[1].instanceId)!.tag;
    };
    const platoon = (primary: typeof rifle, secondary: typeof tag | null) => {
      const entity = new TestInfantryEntity(registry);
      entity.squadSize.set(7);
      entity.squadCount.set(4);
      entity.setPlatoonWeapon('primary', primary);
      entity.setPlatoonWeapon('secondary', secondary);
      entity.secondaryCount.set(secondary ? 2 : 0);
      return entity;
    };

    it('counts a platoon TAG weapon as one mount however many troopers carry it', () => {
      expect(tagSurcharge(platoon(rifle, tag))).toBe(50);
      expect(tagSurcharge(platoon(rifle, null))).toBe(0);
    });

    it('counts each TAG mount, including each one on a battle armor suit regardless of troopers', () => {
      const tank = new TestTankEntity(registry);
      const suit = new TestBattleArmorEntity(registry);
      suit.squadSize.set(4);
      for (let i = 0; i < 3; i++) {
        mount(tank, lightTag, 'Front');
        mount(suit, lightTag, 'Squad');
      }
      expect(tagSurcharge(tank)).toBe(150);
      expect(tagSurcharge(suit)).toBe(150);
    });
  });

  it('counts carried TAG pods as TAG and carried homing Arrow IV bombs per TAG', () => {
    const tagPod = new AmmoEquipment({ id: 'TAGBomb', name: 'TAG Pod', type: 'ammo', stats: { bv: 0 },
      ammo: { type: 'BOMB', rackSize: 1, shots: 1 } });
    const homing = new AmmoEquipment({ id: 'ArrowIVHomingMissile Ammo', name: 'Arrow IV Homing Missile', type: 'ammo',
      stats: { bv: 30 }, ammo: { type: 'ARROW_IV_BOMB', rackSize: 20, shots: 1, munitionType: ['M_HOMING'] } });
    const fighter = new TestAeroSpaceFighterEntity(createTestEquipmentRegistry({ [tagPod.id]: tagPod, [homing.id]: homing }));
    fighter.setTonnage(50);
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5ea');
    fighter.uuid.set(uuid);
    const scenario = { id: 'test', ruleset: 'core-2026' } as const;
    const unit = createNonMekUnit(fighter, { instanceId: 'unit:bomber', uuid, deployment: { id: 'default' },
      scenario, initialStateProfileId: 'pristine-non-mek-v1' });
    unit.dispatch({ type: 'configure-bombs', loads: [
      { section: 'external', bombId: tagPod.id, count: 1 },
      { section: 'external', bombId: homing.id, count: 1 },
    ] });
    const breakdown = () => calculateCBTForceBattleValues({
      units: [{ unit, baseBattleValue: 100 }], scenario, networks: [], isC3EndpointIntact: () => true,
    }).get(unit.instanceId)!;

    expect(breakdown()).toEqual(jasmine.objectContaining({ tag: 30, externalStores: 30 }));
    unit.dispatch({ type: 'set-bombs-spent', section: 'external', bombId: tagPod.id, spent: 1 });
    expect(breakdown()).toEqual(jasmine.objectContaining({ tag: 0, externalStores: 30 }));
  });

  it('uses Entity family facts when a presentation summary disagrees', () => {
    const fixture = createDirectMekRuntimeFixture();
    const positionId = [...fixture.index.crewPositions.keys()][0]!;
    const base = fixture.instance.query().currentBaseBattleValue()!;
    const instanceId = 'unit:bv-entity-authority';
    const unit = {
      instanceId,
      getUnit: () => fixture.entity,
      query: () => fixture.instance.query(),
      captureRuntime: () => fixture.instance.captureRuntime(),
      getCrewAssignment: () => ({
        schemaVersion: 1,
        positions: [{ positionId, name: '', gunnery: 4, piloting: 2 }],
      }),
    } as unknown as CBTUnit;
    const lyingSummary = {
      type: 'ProtoMek',
      subtype: 'ProtoMek',
      canAntiMech: false,
    } as UnitSummary;

    const result = calculateCBTForceBattleValues({
      units: [{ unit, baseBattleValue: base }],
      scenario: { id: 'test', ruleset: 'core-2026' },
      networks: [],
      isC3EndpointIntact: () => false,
    }).get(unit.instanceId)!;

    expect(result.adjusted).toBe(adjustEntityBattleValueForSkills(fixture.entity, base, 4, 2));
    expect(result.adjusted).not.toBe(calculateAdjustedBV(lyingSummary, base, 4, 2));
  });

  it('keeps the skill adjustment fractional and rounds only the final BV', () => {
    const fixture = createDirectMekRuntimeFixture();
    const positionId = [...fixture.index.crewPositions.keys()][0]!;
    const instanceId = 'unit:bv-rounding-boundary';
    const unit = {
      instanceId,
      getUnit: () => fixture.entity,
      query: () => fixture.instance.query(),
      captureRuntime: () => fixture.instance.captureRuntime(),
      getCrewAssignment: () => ({
        schemaVersion: 1,
        positions: [{ positionId, name: '', gunnery: 4, piloting: 4 }],
      }),
    } as unknown as CBTUnit;

    const result = calculateCBTForceBattleValues({
      units: [{ unit, baseBattleValue: 677 }],
      scenario: { id: 'test', ruleset: 'core-2026' },
      networks: [],
      isC3EndpointIntact: () => false,
    }).get(instanceId)!;

    expect(result.base).toBe(677);
    expect(result.tag).toBe(0);
    expect(result.c3).toBe(0);
    expect(result.skills).toBeCloseTo(67.7, 10);
    expect(result.adjustedPreSkill).toBe(677);
    expect(result.adjusted).toBe(745);
  });

  it('rounds the BV without skills while preserving fractional C3 for the skill adjustment', async () => {
    const fixture = createDirectElectronicSuiteRuntimeFixture();
    const units = await Promise.all(['unit:bv-nova:first', 'unit:bv-nova:second'].map(instanceId =>
      createMekUnit({
        uuid: fixture.identity,
        instanceId,
        crewSkills: { gunnery: 4, piloting: 4 },
      }, fixture.entity, fixture.identity, {
        initializerRevision: 1,
        profileId: 'pristine',
        deployment: { id: 'default' },
        scenario: { id: 'test', ruleset: 'core-2026' },
      })));

    const results = calculateCBTForceBattleValues({
      units: units.map(unit => ({ unit, baseBattleValue: 677 })),
      scenario: { id: 'test', ruleset: 'core-2026' },
      networks: [],
      isC3EndpointIntact: () => true,
    });

    for (const unit of units) {
      const result = results.get(unit.instanceId)!;
      expect(result.base).toBe(677);
      expect(result.tag).toBe(0);
      expect(result.c3).toBeCloseTo(67.7, 10);
      expect(result.adjustedPreSkill).toBe(745);
      expect(result.skills).toBeCloseTo(74.47, 10);
      expect(result.adjusted).toBe(819);
      expect(adjustEntityBattleValueForSkills(fixture.entity, result.adjustedPreSkill, 4, 4)).toBe(820);
    }
  });
});
