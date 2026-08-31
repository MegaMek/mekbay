// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ECMMode } from '../common.model';
import { WeaponEquipment, type Equipment } from '../equipment.model';
import {
    resolveUnitTagEcmCapabilitySummary,
    type UnitEcmCapabilityFact,
    type UnitTagEcmCapabilitySummary,
} from '../unit-capability-summary.model';
import {
    electronicClaims,
    effectiveEcmMode,
    type ElectronicComponentFact,
} from './component-electronic-suite';
import type { ClassicUnitQueryPort, ClassicUnitRuntimeIndex } from './classic-unit-runtime';

interface ClassicCapabilitySource {
    readonly index: Pick<ClassicUnitRuntimeIndex, 'components'>;
    readonly query: Pick<
        ClassicUnitQueryPort,
        'componentMode' | 'componentStatus' | 'destroyed' | 'hasCondition'
    >;
}

/**
 * Projects force-card electronics directly from canonical Entity mounts and
 * their sparse runtime state. Search summaries never participate.
 */
export function projectClassicUnitTagEcmCapabilitySummary(
    source: ClassicCapabilitySource,
): UnitTagEcmCapabilitySummary {
    const unitOperational = !source.query.destroyed()
        && !source.query.hasCondition('shutdown')
        && !source.query.hasCondition('abandoned');
    const components = [...source.index.components.values()]
        .flatMap(component => component.kind === 'equipment'
            && component.mount?.equipment
            ? [Object.freeze({
                componentId: component.id,
                mount: component.mount,
                equipment: component.mount.equipment,
                available: unitOperational
                    && source.query.componentStatus(component.id) === 'available',
            })]
            : []);

    const tags = components
        .filter(component => component.equipment.hasFlag('F_TAG'))
        .map(component => Object.freeze({
            light: isLightTag(component.mount.displayName(), component.equipment),
            available: component.available,
        }));

    const electronicFacts: readonly ElectronicComponentFact[] = Object.freeze(components
        .filter(component => electronicClaims(component.equipment).ecm)
        .map(component => Object.freeze({
            componentId: component.componentId,
            equipment: component.equipment,
            mode: source.query.componentMode(component.componentId),
            operational: component.available,
        })));
    const ecms = preferActiveEcm(electronicFacts.map(fact => Object.freeze({
        mode: effectiveEcmMode(electronicFacts, fact.componentId),
        available: fact.operational,
    })));

    return resolveUnitTagEcmCapabilitySummary({ tags, ecms });
}

function isLightTag(
    mountName: string,
    equipment: Equipment,
): boolean {
    if (equipment instanceof WeaponEquipment && equipment.ranges[0] > 0) {
        return equipment.ranges[0] < 5;
    }
    return [mountName, equipment.name, equipment.shortName, equipment.sortingName]
        .some(name => /\blight\b/i.test(name));
}

/** Match the legacy presentation rule: show the active available suite first. */
function preferActiveEcm(
    ecms: readonly UnitEcmCapabilityFact[],
): readonly UnitEcmCapabilityFact[] {
    const active = ecms.find(ecm => ecm.available && ecm.mode !== ECMMode.OFF);
    return active === undefined
        ? ecms
        : Object.freeze([active, ...ecms.filter(ecm => ecm !== active)]);
}
