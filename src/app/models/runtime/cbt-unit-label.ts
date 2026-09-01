// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../entity/base-entity';

export function entityUnitLabel(entity: BaseEntity, fallback: string): string {
    return [entity.chassis(), entity.model()].filter(Boolean).join(' ') || fallback;
}
