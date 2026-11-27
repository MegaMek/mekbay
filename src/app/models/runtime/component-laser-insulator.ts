// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ComponentId } from '../entity/entity-identifiers';
import type { EquipmentStatus } from '../equipment-status.model';
import {
    isLaserInsulatorPair,
    laserInsulatorWeakened,
} from '../laser-insulator.model';
import { equipmentForComponent, mountedEquipmentForComponent, type MekRuntimeIndex } from './mek-runtime-index';
import { componentIdForMount } from './unit-runtime-index';

export interface MekLaserInsulatorRuntimeView {
    componentStatus(componentId: ComponentId): EquipmentStatus;
}

export function isMekLaserInsulatorPair(
    index: MekRuntimeIndex,
    insulatorId: ComponentId,
    laserId: ComponentId,
): boolean {
    return index.relationships.linkedTargetBySource.get(insulatorId) === laserId
        && isLaserInsulatorPair(equipmentForComponent(index, insulatorId), equipmentForComponent(index, laserId));
}

export function mekLaserInsulatorWeakened(
    index: MekRuntimeIndex,
    runtime: MekLaserInsulatorRuntimeView,
    laserId: ComponentId,
): boolean | undefined {
    const sources = index.relationships.linkedSourcesByTarget.get(laserId) ?? [];
    return laserInsulatorWeakened(sources.map(id => mountedEquipmentForComponent(index, id)!),
        mount => runtime.componentStatus(componentIdForMount(mount)) === 'available');
}
