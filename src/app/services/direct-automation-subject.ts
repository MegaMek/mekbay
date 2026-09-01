// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTUnitSnapshot } from '../models/cbt-unit-snapshot';

/** Matches origin/next's unit notification label without loading catalog data. */
export function directAutomationSubject(snapshot: CBTUnitSnapshot): string {
    const unitName = snapshot.entity.displayName() || String(snapshot.instanceId);
    const primaryPosition = [...snapshot.index.crewPositions.values()]
        .sort((left, right) => left.occurrence - right.occurrence)[0];
    const crewName = primaryPosition
        ? snapshot.crewAssignment.positions
            .find(position => position.positionId === primaryPosition.id)?.name.trim()
        : undefined;
    return crewName ? `${unitName} (${crewName})` : unitName;
}
