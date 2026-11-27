// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    crewStateDefinitions,
    getUnitConditionDefinition,
    NARC_CONDITION_COLOR,
    unitConditionSortIndex,
} from '../models/unit-status-presentation';
import { MEK_CREW_STATE_DISPLAYS } from '../models/mek-record-sheet-controls';
import { isCBTForceMember, isCBTMekForceMember, type ForceMember } from '../models/force-member.model';
import type { UnitConditionKey } from '../models/unit-condition.model';

export interface UnitConditionDisplay {
    readonly key: string;
    readonly label: string;
    readonly color: string;
}

const NON_MEK_CREW_STATE_DISPLAYS = crewStateDefinitions(['killed', 'stunned']);

/** Unit conditions, then crew states, then location markers, as one ordered list of labelled chips. */
export function forceMemberConditionDisplays(member: ForceMember): UnitConditionDisplay[] {
    const conditionKeys = new Set<UnitConditionKey>();
    let crewConditions: UnitConditionDisplay[] = [];
    let locationConditions: UnitConditionDisplay[] = [];
    if (isCBTMekForceMember(member)) {
        const status = member.force.getMekUnitStatusSnapshot(member.id);
        status?.conditions.forEach(condition => conditionKeys.add(condition));
        const crewStates = new Set(status?.crew.map(position => position.effectiveState) ?? []);
        crewConditions = [...crewStates].flatMap(state => {
            if (state === 'healthy') return [];
            const definition = MEK_CREW_STATE_DISPLAYS.find(candidate => candidate.key === state);
            return definition ? [{
                key: `crew-${definition.key}`,
                label: definition.bannerLabel,
                color: definition.color,
            }] : [];
        });
        if (status?.hasNarc) {
            locationConditions = [{ key: 'location-narc', label: 'NARC', color: NARC_CONDITION_COLOR }];
        }
    } else if (isCBTForceMember(member)) {
        member.force.getUnitConditions(member.id)?.forEach(condition => conditionKeys.add(condition));
        const sheet = member.force.getNonMekRecordSheetSnapshot(member.id);
        const definitions = sheet !== null
            && ['ProtoMek', 'Tank', 'VTOL', 'Naval'].includes(sheet.unitType)
            ? NON_MEK_CREW_STATE_DISPLAYS
            : [];
        const crewStates = new Set(sheet?.crew.map(position => position.effectiveState) ?? []);
        crewConditions = [...crewStates].flatMap(state => {
            const definition = definitions.find(candidate => candidate.key === state);
            return definition ? [{
                key: `crew-${definition.key}`,
                label: definition.bannerLabel,
                color: definition.color,
            }] : [];
        });
    } else {
        for (const condition of member.getConditions().keys()) conditionKeys.add(condition);
    }

    const unitConditions = Array.from(conditionKeys)
        .map(key => {
            const condition = getUnitConditionDefinition(key);
            return {
                key,
                label: condition?.bannerLabel ?? condition?.label ?? key.toUpperCase(),
                color: condition?.color ?? '#666',
            };
        })
        .sort((left, right) => unitConditionSortIndex(left.key) - unitConditionSortIndex(right.key) || left.label.localeCompare(right.label));
    return [...unitConditions, ...crewConditions, ...locationConditions];
}
