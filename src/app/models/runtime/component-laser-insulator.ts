// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from '../entity/entity-identifiers';
import type { EquipmentStatus } from '../equipment-status.model';
import {
    isLaserInsulatorPair,
    laserInsulatorAdjustedHeat,
} from '../laser-insulator.model';
import { equipmentForComponent, type MekRuntimeIndex } from './mek-runtime-index';

export interface MekLaserInsulatorLink {
    readonly insulatorId: ComponentId;
    readonly laserId: ComponentId;
}

export interface MekLaserInsulatorRuntimeView {
    componentStatus(componentId: ComponentId): EquipmentStatus;
}

/** Returns the one exact entity-owned Laser Insulator-to-laser relation, if present. */
export function mekLaserInsulatorLink(
    index: MekRuntimeIndex,
    laserId: ComponentId,
): MekLaserInsulatorLink | null {
    const insulatorId = index.relationships.linkedSourceByTarget.get(laserId);
    if (insulatorId === undefined
        || index.relationships.linkedTargetBySource.get(insulatorId) !== laserId) return null;
    const insulator = equipmentForComponent(index, insulatorId);
    const laser = equipmentForComponent(index, laserId);
    return isLaserInsulatorPair(insulator, laser)
        ? Object.freeze({ insulatorId, laserId })
        : null;
}

export function isMekLaserInsulatorPair(
    index: MekRuntimeIndex,
    insulatorId: ComponentId,
    laserId: ComponentId,
): boolean {
    return mekLaserInsulatorLink(index, laserId)?.insulatorId === insulatorId;
}

export function mekLaserInsulatorAdjustedHeat(
    index: MekRuntimeIndex,
    runtime: MekLaserInsulatorRuntimeView,
    laserId: ComponentId,
    baseHeat: number,
): number {
    const link = mekLaserInsulatorLink(index, laserId);
    if (link === null) return baseHeat;
    return laserInsulatorAdjustedHeat(
        baseHeat,
        equipmentForComponent(index, link.insulatorId),
        equipmentForComponent(index, laserId),
        runtime.componentStatus(link.insulatorId) === 'available',
    );
}

export function mekLaserInsulatorWeakened(
    index: MekRuntimeIndex,
    runtime: MekLaserInsulatorRuntimeView,
    laserId: ComponentId,
): boolean | null {
    const link = mekLaserInsulatorLink(index, laserId);
    return link === null ? null : runtime.componentStatus(link.insulatorId) !== 'available';
}
