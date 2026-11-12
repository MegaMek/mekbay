// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { buildEquipmentRegistry } from '../../services/catalogs/equipment-catalog-builder';
import { CORE_2026_RULESET, TOTAL_WARFARE_RULESET, type CBTRuleset } from '../cbt-ruleset.model';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { ComponentId, LocationId } from '../entity/entity-identifiers';
import { parseEntity } from '../entity/parse-entity';
import type { EquipmentRegistry } from '../equipment-lookup';
import { projectMekCombatModifiers, type MekCombatModifierRuntimeFacts } from './mek-combat-modifiers';
import { kickTalonsIntact, selectMekKickingLeg } from './mek-kicking-leg';
import { canPerformMekAction } from './mek-action-availability';
import {
  createDirectQuadRuntimeFixture,
  createDirectTripodRuntimeFixture,
  type DirectMekRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';
import { compileMekMechanicsProfile, type MekActuatorKind, type MekMechanicsProfile } from './mek-mechanics-profile';
import { projectMekPhysicalAttacksV2, type MekPhysicalAttackRuntimeFactsV2 } from './mek-physical-attack-v2';
import { buildMekRuntimeIndex, type MekRuntimeIndex } from './mek-runtime-index';

// 50-ton Clan Meks with an ER medium laser in the first leg of each kick. A kick does 10, ×1.5 with talons.
const legs = (extra: string, talons = true) =>
  `Hip\nUpper Leg Actuator\nLower Leg Actuator\nFoot Actuator\n${talons ? 'Talons\nTalons\n' : ''}${extra}`;
const header = (config: string) => `chassis:Kick Test
model:KT-1
Config:${config}
techbase:Clan
era:3080
rules level:3
mass:50
engine:200 Fusion Engine
heat sinks:10 Single
walk mp:4
jump mp:0
armor:Standard(Clan)
`;
const arms = `Left Arm:
Shoulder
Upper Arm Actuator
Lower Arm Actuator
Hand Actuator
Right Arm:
Shoulder
Upper Arm Actuator
Lower Arm Actuator
Hand Actuator
`;
const MTF = `${header('Biped')}${arms}Left Leg:
${legs('CLERMediumLaser')}
Right Leg:
${legs('-Empty-')}
`;
// Inner Sphere TSM on the same Mek, three slots in each side torso.
const tsmSlots = 'Triple Strength Myomer\n'.repeat(3);
const TSM_MTF = MTF.replace('techbase:Clan', 'techbase:Mixed (Clan Chassis)')
  .replace('Left Leg:', `Left Torso:\n${tsmSlots}Right Torso:\n${tsmSlots}Left Leg:`);
const TRIPOD_MTF = `${header('Tripod')}${arms}Left Leg:
${legs('CLERMediumLaser', false)}
Right Leg:
${legs('CLERMediumLaser', false)}
Center Leg:
${legs('-Empty-', false)}
`;
const QUAD_MTF = `${header('Quad')}Front Left Leg:
${legs('CLERMediumLaser')}
Front Right Leg:
${legs('-Empty-')}
Rear Left Leg:
${legs('CLERMediumLaser')}
Rear Right Leg:
${legs('-Empty-')}
`;

describe('Mek kicking leg', () => {
  let registry: EquipmentRegistry;
  beforeAll(async () => {
    registry = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
  });

  interface Kick {
    readonly profile: MekMechanicsProfile;
    readonly index: MekRuntimeIndex;
    location(code: string): LocationId;
    actuator(code: string, kind: MekActuatorKind): ComponentId;
    readonly talons: ComponentId;
  }

  function kickTest(ruleset: CBTRuleset, source = MTF): Kick {
    const entity = parseEntity(source, 'kick.mtf', registry).entity as MekEntity;
    const index = buildMekRuntimeIndex(entity);
    const compiled = compileMekMechanicsProfile(entity, index, ruleset);
    if (compiled.kind !== 'supported') throw new Error('Unsupported test Mek');
    const profile = compiled.profile;
    const location = (code: string) => [...index.locations.values()].find(item => item.code === code)!.id;
    return {
      profile,
      index,
      location,
      actuator: (code, kind) => profile.limbs.find(limb => limb.locationId === location(code))!
        .actuators.find(actuator => actuator.kind === kind)!.componentId,
      talons: profile.physicalWeapons[0]?.componentId as ComponentId,
    };
  }

  /** Destroyed components, talons lost in one leg, and legs whose weapons fired this turn. */
  function facts(state: {
    readonly destroyed?: readonly ComponentId[];
    readonly lostAt?: readonly (readonly [ComponentId, LocationId])[];
    readonly fired?: readonly LocationId[];
  } = {}): MekPhysicalAttackRuntimeFactsV2 & MekCombatModifierRuntimeFacts {
    const destroyed = new Set(state.destroyed ?? []);
    const lostAt = new Set((state.lostAt ?? []).map(([id, location]) => `${id}@${location}`));
    const fired = new Set(state.fired ?? []);
    return {
      currentHeat: 0,
      movementMode: null,
      movementDistance: 0,
      conditions: new Set(),
      dedicatedPilotPresent: false,
      dedicatedPilotFunctional: false,
      dedicatedGunneryOfficerPresent: false,
      dedicatedGunneryOfficerFunctional: false,
      componentAvailable: id => !destroyed.has(id),
      componentDestroyed: id => destroyed.has(id),
      componentAvailableAt: (id, location) => !destroyed.has(id) && !lostAt.has(`${id}@${location}`),
      componentMode: () => undefined,
      criticalSlotDestroyedTurn: () => undefined,
      criticalSlotUnavailable: () => false,
      locationDestroyed: () => false,
      weaponFiredAt: location => fired.has(location),
      shieldDamage: () => 0,
    };
  }

  function kickRow(test: Kick, state: Parameters<typeof facts>[0], actionId = 'intrinsic:kick') {
    const projection = projectMekPhysicalAttacksV2(test.profile, test.index, facts(state));
    if (projection.kind !== 'supported') throw new Error('Unsupported projection');
    const row = projection.attacks.find(attack => attack.target.kind === 'intrinsic' && attack.target.actionId === actionId)!;
    const modifiers = projectMekCombatModifiers(test.profile, test.index, facts(state)).intrinsic.get(actionId) ?? [];
    return {
      label: row.label,
      damage: row.effect.kind === 'damage' ? row.effect.damage : null,
      maximum: row.effect.kind === 'damage' ? row.effect.maximumDamage : null,
      modifiers,
    };
  }

  it('kicks with a leg whose weapons did not fire, and with no leg once both have fired', () => {
    const test = kickTest(CORE_2026_RULESET);
    expect(kickRow(test, {}).label).toBe('Kick [Talons] (LL)');
    expect(kickRow(test, { fired: [test.location('LL')] }).label).toBe('Kick [Talons] (RL)');
    expect(selectMekKickingLeg(
      test.profile, test.index, facts({ fired: [test.location('LL'), test.location('RL')] }), 'kick',
    )).toBeNull();
  });

  it('counts only the kicking leg actuators under Total Warfare, and either leg under Core', () => {
    const tw = kickTest(TOTAL_WARFARE_RULESET);
    const twKick = kickRow(tw, { destroyed: [tw.actuator('LL', 'lower-leg')] });
    expect(twKick.label).toBe('Kick [Talons] (RL)');
    expect(twKick.damage).toBe(15);
    expect(twKick.modifiers.some(entry => entry.label.includes('Leg Actuator'))).toBeFalse();

    const core = kickTest(CORE_2026_RULESET);
    const coreKick = kickRow(core, { destroyed: [core.actuator('LL', 'lower-leg')] });
    // Talons first, then the destroyed leg actuator halves it, rounding down: 10 x 1.5 = 15, / 2 = 7.
    expect(coreKick.damage).toBe(7);
    expect(coreKick.modifiers).toContain(jasmine.objectContaining({ label: 'Leg Actuator Destroyed', modifier: 2 }));
  });

  it('applies talons, then TSM, then destroyed leg actuators', () => {
    // What adds to the base comes first (Core p. 88): 10 x 1.5 = 15 with talons, x2 = 30 with TSM, then the destroyed
    // lower leg actuator halves it to 15; without TSM it halves 15 to 7.
    const tsm = kickTest(CORE_2026_RULESET, TSM_MTF);
    const row = kickRow(tsm, { destroyed: [tsm.actuator('LL', 'lower-leg')] });
    expect([row.damage, row.maximum]).toEqual([7, 15]);
  });

  it('keeps the talon bonus by kicking with the leg whose talons are intact', () => {
    const core = kickTest(CORE_2026_RULESET);
    const coreKick = kickRow(core, { lostAt: [[core.talons, core.location('LL')]] });
    expect(coreKick.label).toBe('Kick [Talons] (RL)');
    expect(coreKick.damage).toBe(15);

    // A destroyed foot also destroys that leg's talons (TO:AUE), so neither leg adds talons; the intact foot wins.
    const tw = kickTest(TOTAL_WARFARE_RULESET);
    const twKick = kickRow(tw, {
      lostAt: [[tw.talons, tw.location('LL')]],
      destroyed: [tw.actuator('RL', 'foot')],
    });
    expect(twKick.label).toBe('Kick [Talons] (LL)');
    expect(twKick.damage).toBe(10);
    expect(twKick.modifiers.some(entry => entry.label.includes('Foot Actuator'))).toBeFalse();
  });

  it('lets a tripod kick with its center leg', () => {
    const test = kickTest(CORE_2026_RULESET, TRIPOD_MTF);
    expect(kickRow(test, {}).label).toBe('Kick (LL)');
    expect(kickRow(test, { fired: [test.location('LL'), test.location('RL')] }).label).toBe('Kick (CL)');
    expect(test.index.intrinsicActions.some(action => action.kind === 'mule-kick')).toBeFalse();
  });

  it('kicks forward with one front leg and mule kicks with the rear legs', () => {
    const test = kickTest(CORE_2026_RULESET, QUAD_MTF);
    expect(kickRow(test, {}).label).toBe('Kick [Talons] (FLL)');
    expect(kickRow(test, { fired: [test.location('FLL')] }).label).toBe('Kick [Talons] (FRL)');
    expect(kickRow(test, {}, 'intrinsic:mule-kick').label).toBe('Mule Kick [Talons]');
    // A weapon fired from either rear leg rules out the mule kick (TW p. 147).
    expect(selectMekKickingLeg(test.profile, test.index, facts({ fired: [test.location('RLL')] }), 'mule-kick'))
      .toBeNull();
  });

  it('weakens only the kicks of the damaged arc, and a mule kick by either rear leg in both rulesets', () => {
    const core = kickTest(CORE_2026_RULESET, QUAD_MTF);
    const coreDamage = { destroyed: [core.actuator('RLL', 'lower-leg')] };
    expect(kickRow(core, coreDamage).damage).toBe(15);
    expect(kickRow(core, coreDamage).modifiers.some(entry => entry.label.includes('Leg Actuator'))).toBeFalse();
    const coreMule = kickRow(core, coreDamage, 'intrinsic:mule-kick');
    expect(coreMule.damage).toBe(7);
    expect(coreMule.modifiers).toContain(jasmine.objectContaining({ label: 'Leg Actuator Destroyed', modifier: 2 }));

    const tw = kickTest(TOTAL_WARFARE_RULESET, QUAD_MTF);
    const twMule = kickRow(tw, { destroyed: [tw.actuator('RLL', 'lower-leg')] }, 'intrinsic:mule-kick');
    expect(twMule.label).toBe('Mule Kick [Talons]');
    expect(twMule.damage).toBe(7);
  });

  it('needs talons on both rear legs for a mule kick talon bonus', () => {
    const core = kickTest(CORE_2026_RULESET, QUAD_MTF);
    const lost = { lostAt: [[core.talons, core.location('RLL')]] as const };
    expect(kickRow(core, lost, 'intrinsic:mule-kick').damage).toBe(10);
    expect(kickRow(core, lost).damage).toBe(15);
  });

  it('adds talons to a death from above with either leg under Total Warfare, and two legs under Core', () => {
    const dfa = (test: Kick, state: Parameters<typeof facts>[0]) =>
      kickTalonsIntact(test.profile, test.index, facts(state), null);
    const tw = kickTest(TOTAL_WARFARE_RULESET);
    expect(dfa(tw, { lostAt: [[tw.talons, tw.location('LL')]] })).toBeTrue();
    // A destroyed foot destroys that leg's talons too (Core p. 196).
    expect(dfa(tw, { lostAt: [[tw.talons, tw.location('LL')]], destroyed: [tw.actuator('RL', 'foot')] })).toBeFalse();

    const core = kickTest(CORE_2026_RULESET);
    expect(dfa(core, {})).toBeTrue();
    expect(dfa(core, { destroyed: [core.actuator('RL', 'foot')] })).toBeFalse();
    const quad = kickTest(CORE_2026_RULESET, QUAD_MTF);
    const lost = (...codes: string[]) => ({ lostAt: codes.map(code => [quad.talons, quad.location(code)] as const) });
    expect(dfa(quad, lost('FLL', 'RRL'))).toBeTrue();
    expect(dfa(quad, lost('FLL', 'FRL', 'RRL'))).toBeFalse();
  });

  describe('availability', () => {
    function hitHip(fixture: DirectMekRuntimeFixture, code: string): void {
      const slot = [...fixture.index.slots.values()].find(candidate =>
        fixture.index.locations.get(candidate.locationId)?.code === code
        && candidate.componentIds.some(componentId => {
          const component = fixture.index.components.get(componentId);
          return component?.kind === 'system' && component.systemType === 'Hip';
        }))!;
      expect(fixture.instance.dispatch({ type: 'hit-critical', slotId: slot.id, hits: 1, target: 'committed' }).accepted)
        .toBeTrue();
    }
    const can = (fixture: DirectMekRuntimeFixture, actionId: string) => canPerformMekAction(
      fixture.entity,
      fixture.index,
      fixture.instance.query(),
      { kind: 'intrinsic', actionId },
      'physical-attack',
      fixture.instance.ruleset(),
    );

    it('blocks only the arc of one quad hip hit under Core, and every kick after a second', () => {
      const core = createDirectQuadRuntimeFixture(CORE_2026_RULESET, 'unit:kick-core-quad-hips');
      expect([can(core, 'intrinsic:kick'), can(core, 'intrinsic:mule-kick')]).toEqual([true, true]);
      hitHip(core, 'FLL');
      expect([can(core, 'intrinsic:kick'), can(core, 'intrinsic:mule-kick')]).toEqual([false, true]);
      hitHip(core, 'RRL');
      expect([can(core, 'intrinsic:kick'), can(core, 'intrinsic:mule-kick')]).toEqual([false, false]);
    });

    it('needs the hips of the kick arc under Total Warfare', () => {
      const tw = createDirectQuadRuntimeFixture(TOTAL_WARFARE_RULESET, 'unit:kick-tw-quad-hips');
      hitHip(tw, 'RRL');
      expect([can(tw, 'intrinsic:kick'), can(tw, 'intrinsic:mule-kick')]).toEqual([true, false]);
      hitHip(tw, 'FLL');
      expect([can(tw, 'intrinsic:kick'), can(tw, 'intrinsic:mule-kick')]).toEqual([false, false]);
    });

    it('gives tripods no mule kick', () => {
      const tripod = createDirectTripodRuntimeFixture(CORE_2026_RULESET, 'unit:kick-tripod');
      expect(tripod.index.intrinsicActions.map(action => action.kind)).not.toContain('mule-kick');
      expect(can(tripod, 'intrinsic:kick')).toBeTrue();
    });
  });
});
