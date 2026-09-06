// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { calculateCBTForceBattleValues } from './cbt-force-battle-value';
import { adjustEntityBattleValueForSkills } from './entity/utils/battle-value/skill-facts';
import { createMekUnit } from './runtime/cbt-mek-unit';

import { calculateAdjustedBV } from '../utils/cbt-common.util';
import type { CBTUnit } from './runtime/cbt-unit';
import { createDirectElectronicSuiteRuntimeFixture,createDirectMekRuntimeFixture } from './runtime/testing/direct-mek-runtime-fixture';
import type { UnitSummary } from './unit-summary.model';

describe('CBT force battle value authority', () => {
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
