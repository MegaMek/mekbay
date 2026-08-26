// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';
import type { UnitInstanceId } from './runtime-state';

export function entityUnitLabel(entity: BaseEntity, fallback: UnitInstanceId): string {
    return [entity.chassis(), entity.model()].filter(Boolean).join(' ') || fallback;
}
