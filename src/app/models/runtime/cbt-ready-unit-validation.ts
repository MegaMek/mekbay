// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import {
    evaluateMekRuntimeCapability,
    requireSupportedMekHeatContext,
    requireSupportedMekMechanicsContext,
    type MekRuntimeCapabilityDecision,
} from './mek-runtime-capability';
import {
    isReadyNonMekUnit,
    isReadyMekUnit,
    type ReadyClassicUnit,
} from './ready-classic-unit';
import type { ReadyMekUnit } from './ready-unit-factory';

export function readyUnitMatchesEntity(unit: ReadyClassicUnit, entity: BaseEntity): boolean {
    if (isReadyMekUnit(unit)) {
        return entity.entityType === 'Mek' && unit.matchesEntity(entity as MekEntity);
    }
    return isReadyNonMekUnit(unit) && entity.entityType !== 'Mek' && unit.matchesEntity(entity);
}

export function evaluateReadyMekRuntimeCapability(unit: ReadyMekUnit): MekRuntimeCapabilityDecision {
    const decision = evaluateMekRuntimeCapability(unit.getUnit());
    if (decision.readiness === 'deferred') return decision;
    const heat = requireSupportedMekHeatContext(
        decision,
        unit.getInstance().query().heatCapability(),
    );
    return requireSupportedMekMechanicsContext(
        heat,
        unit.getInstance().query().mekDestruction(),
    );
}
