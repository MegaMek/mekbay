// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { MekRuntimeIndex } from './mek-runtime-index';
import { resolveMekUnitWaterState } from './mek-targeting-rules';
import type { MekUnitQueryPort } from './unit-instance';

export interface MekLifeSupportPilotDamage {
    readonly damaged: boolean;
    readonly heatHits: number;
    readonly oxygenHits: number;
    readonly headHitHits: number;
}

/** Life Support effects derived only from the Mek blueprint and sparse runtime state. */
export function projectMekLifeSupportPilotDamage(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    query: Pick<MekUnitQueryPort, 'componentStatus' | 'hasCondition' | 'turnState'>,
    heat: number,
): MekLifeSupportPilotDamage {
    const lifeSupport = [...index.components.values()].find(component =>
        component.kind === 'system' && component.systemType === 'Life Support');
    const damaged = lifeSupport !== undefined
        && query.componentStatus(lifeSupport.id, 'preview') !== 'available';
    const torsoMountedCockpit = entity.mountedCockpit().hasTorsoSlots;
    const submerged = resolveMekUnitWaterState(
        entity,
        query.turnState().cover,
        query.hasCondition('prone'),
    ).submerged;

    return Object.freeze({
        damaged,
        heatHits: damaged ? lifeSupportHeatHits(ruleset, torsoMountedCockpit, heat) : 0,
        oxygenHits: damaged && submerged ? 1 : 0,
        headHitHits: torsoMountedCockpit ? 0 : 1,
    });
}

function lifeSupportHeatHits(
    ruleset: CBTRuleset,
    torsoMountedCockpit: boolean,
    heat: number,
): number {
    if (heat <= 0) return 0;
    if (torsoMountedCockpit) return heat >= 15 ? 2 : 1;
    if (ruleset === 'total-warfare') return heat >= 26 ? 2 : heat >= 15 ? 1 : 0;
    return heat >= 20 ? 2 : heat >= 10 ? 1 : 0;
}
