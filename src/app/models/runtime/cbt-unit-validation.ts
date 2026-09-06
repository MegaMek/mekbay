// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { isCBTMekUnit,isCBTNonMekUnit,type CBTMekUnit,type CBTUnit } from './cbt-unit';
import {
evaluateMekRuntimeCapability,
requireSupportedMekHeatContext,
requireSupportedMekMechanicsContext,
type MekRuntimeCapabilityDecision,
} from './mek-runtime-capability';

export function cbtUnitMatchesEntity(unit: CBTUnit, entity: BaseEntity): boolean {
    if (isCBTMekUnit(unit)) {
        return entity.entityType === 'Mek' && unit.matchesEntity(entity as MekEntity);
    }
    return isCBTNonMekUnit(unit) && entity.entityType !== 'Mek' && unit.matchesEntity(entity);
}

export function evaluateCBTMekRuntimeCapability(unit: CBTMekUnit): MekRuntimeCapabilityDecision {
    const decision = evaluateMekRuntimeCapability(unit.getUnit());
    if (decision.readiness === 'deferred') return decision;
    const heat = requireSupportedMekHeatContext(
        decision,
        unit.query().heatCapability(),
    );
    return requireSupportedMekMechanicsContext(
        heat,
        unit.query().mekDestruction(),
    );
}
