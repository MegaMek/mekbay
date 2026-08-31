// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { calculateCBTForceBattleValues } from './cbt-force-battle-value';
import { adjustEntityBattleValueForSkills } from './entity/utils/battle-value/skill-facts';
import type { ReadyClassicUnit } from './runtime/ready-classic-unit';
import { asUnitInstanceId } from './runtime/runtime-state';
import { createDirectMekRuntimeFixture } from './runtime/testing/direct-mek-runtime-fixture';
import type { UnitSummary } from './unit-summary.model';
import { BVCalculatorUtil } from '../utils/bv-calculator.util';

describe('Classic force battle value authority', () => {
  it('uses Entity family facts when a presentation summary disagrees', () => {
    const fixture = createDirectMekRuntimeFixture();
    const positionId = [...fixture.index.crewPositions.keys()][0]!;
    const base = fixture.instance.query().currentBaseBattleValue()!;
    const instanceId = asUnitInstanceId('unit:bv-entity-authority');
    const unit = {
      instanceId,
      getUnit: () => fixture.entity,
      captureRuntime: () => ({ query: fixture.instance.query() }),
      getCrewAssignment: () => ({
        schemaVersion: 1,
        positions: [{ positionId, name: '', role: '', gunnery: 4, piloting: 2 }],
      }),
    } as unknown as ReadyClassicUnit;
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
    expect(result.adjusted).not.toBe(BVCalculatorUtil.calculateAdjustedBV(lyingSummary, base, 4, 2));
  });
});
