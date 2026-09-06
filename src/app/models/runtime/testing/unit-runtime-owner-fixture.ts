// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../../cbt-ruleset.model';
import type { BaseEntity } from '../../entity/base-entity';
import type { MekEntity } from '../../entity/entities/mek/mek-entity';
import { isVehicleEntity } from '../../entity/utils/entity-type-guards';
import { projectVehicleRuntimeRules } from '../../rules/vehicle-runtime-rules';
import { CBTUnit,type CBTMekUnit,type CBTNonMekUnit } from '../cbt-unit';
import type { CrewAssignment } from '../crew-assignment';
import type { MekHeatRuntimeContextV2 } from '../mek-heat-state-v2';
import type { MekMechanicsContextV2 } from '../mek-mechanics-context-v2';
import type { MekRuntimeIndex } from '../mek-runtime-index';
import { createNonMekRuntimeBinding,type NonMekUnitRuntimeState } from '../non-mek-unit-instance';
import { restoreNonMekRuntime,type SerializedNonMekUnit } from '../non-mek-unit-persistence';
import type { InstanceBaselineRef,MekUnitRuntimeState } from '../runtime-state';
import { createMekRuntimeBinding } from '../unit-instance';
import { MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION } from '../unit-state-initializer';

/** Low-level owner construction for tests of bound mechanics and explicit sparse snapshots. */
export function createMekRuntimeForTest(
    instanceId: string, baselineRef: InstanceBaselineRef, entity: MekEntity, index: MekRuntimeIndex,
    ruleset: CBTRuleset, state: MekUnitRuntimeState, crewAssignment?: CrewAssignment,
    heatContext?: MekHeatRuntimeContextV2, mechanicsContext?: MekMechanicsContextV2,
): CBTMekUnit {
    const prepared = createMekRuntimeBinding(entity, index, ruleset, state, crewAssignment, heatContext, mechanicsContext);
    return new CBTUnit<'mek'>({ instanceId, uuid: entity.uuid(), baselineRef,
        runtime: { kind: 'mek', ...prepared, deployment: { schemaVersion: MEK_DEPLOYMENT_CONFIGURATION_SCHEMA_VERSION,
            values: { id: 'runtime-test', crewAssignment: prepared.binding.source.crewAssignment } } } });
}

export function restoreNonMekRuntimeForTest(saved: SerializedNonMekUnit, entity: BaseEntity,
    ruleset: CBTRuleset, forcedWithdrawal = true): CBTNonMekUnit {
    const prepared = restoreNonMekRuntime(saved, entity, ruleset, forcedWithdrawal);
    return new CBTUnit<'non-mek'>({ uuid: entity.uuid(), instanceId: saved.instanceId,
        baselineRef: prepared.baselineRef, runtime: { kind: 'non-mek', ...prepared, deployment: saved.deployment } });
}

export function vehicleRuntimeRulesForTest(unit: CBTNonMekUnit) {
    const entity = unit.getUnit();
    return isVehicleEntity(entity) ? projectVehicleRuntimeRules(entity, unit.getIndex(), unit.snapshot(),
        unit.ruleset(), unit.getCrewAssignment()) : null;
}

export function createNonMekRuntimeForTest(
    instanceId: string, baselineRef: InstanceBaselineRef, entity: BaseEntity, ruleset: CBTRuleset,
    state?: NonMekUnitRuntimeState, forcedWithdrawal = true, crewAssignment?: CrewAssignment,
): CBTNonMekUnit {
    const prepared = createNonMekRuntimeBinding(entity, ruleset, state, forcedWithdrawal, crewAssignment);
    return new CBTUnit<'non-mek'>({ instanceId, uuid: entity.uuid(), baselineRef,
        runtime: { kind: 'non-mek', ...prepared, deployment: { schemaVersion: 1,
            values: { id: 'runtime-test', crewAssignment: prepared.binding.crewAssignment } } } });
}
