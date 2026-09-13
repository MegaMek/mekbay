// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTUnitSnapshot } from '../cbt-unit-snapshot';
import type { BaseEntity } from '../entity/base-entity';
import { prepareConstructionRefit, type ConstructionMountOrigins } from './unit-construction-refit';
import { cloneMekForOwner, repairMekUnit } from './cbt-mek-unit';
import { cloneNonMekForOwner, repairNonMekUnit } from './cbt-non-mek-unit';
import { isCBTMekUnit, isCBTNonMekUnit, type CBTUnit } from './cbt-unit';
import type { CBTUnitCommand } from './unit-command';
import type { UnitEditContext } from './unit-edit-context';
import type { ScenarioRules } from './unit-state-initializer';

export type ConstructionRuntimeCommand = CBTUnitCommand | { readonly type: 'repair-all' };
export interface ConstructionRuntimeChanges {
    readonly context: UnitEditContext;
    readonly commands: readonly ConstructionRuntimeCommand[];
}
export interface ConstructionRuntimePreview {
    readonly changes: ConstructionRuntimeChanges;
    readonly snapshot: CBTUnitSnapshot;
    readonly changed: boolean;
}

/** Price both sides of a repair against the same draft, using the save path's damage mapping. */
export async function constructionRuntimeBattleValue(
    current: CBTUnit, draft: BaseEntity, origins: ConstructionMountOrigins,
    commands: readonly ConstructionRuntimeCommand[], scenario: ScenarioRules,
): Promise<{ beforeRepairs: number | null; effective: number | null }> {
    const before = await prepareConstructionRefit(current, draft, undefined, origins, scenario);
    const beforeRepairs = before.unit.query().currentBaseBattleValue();
    if (!commands.length) return { beforeRepairs, effective: beforeRepairs };
    const repaired = await prepareConstructionRuntime(current, commands, scenario);
    const after = await prepareConstructionRefit(repaired, draft, undefined, origins, scenario);
    return { beforeRepairs, effective: after.unit.query().currentBaseBattleValue() };
}

/** Replays editor choices on a detached runtime, never on the loaded force. */
export async function prepareConstructionRuntime(
    current: CBTUnit, commands: readonly ConstructionRuntimeCommand[], scenario: ScenarioRules,
): Promise<CBTUnit> {
    let candidate: CBTUnit;
    if (isCBTMekUnit(current)) candidate = await cloneMekForOwner(current, scenario);
    else if (isCBTNonMekUnit(current)) candidate = cloneNonMekForOwner(current, scenario);
    else throw new Error('The force runtime is not ready');
    for (const command of commands) {
        if (command.type === 'repair-all') {
            if (isCBTMekUnit(candidate)) candidate = await repairMekUnit(candidate, scenario);
            else if (isCBTNonMekUnit(candidate)) candidate = repairNonMekUnit(candidate);
        } else if (!candidate.dispatch(command).accepted) {
            throw new Error('The force could not accept this runtime edit.');
        }
    }
    return candidate;
}

/** Revisions record activity; only durable gameplay facts determine unsaved changes. */
export function constructionRuntimeSource(unit: CBTUnit): string {
    const { stateRevision, ...facts } = unit.serialize();
    return JSON.stringify(facts);
}
