// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { nativeCapabilityForUnitTypeAlias } from '../../src/app/models/entity/codec-capabilities';
import { BuildingBlock } from '../../src/app/models/entity/parsers/building-block';

/** Explicit audit exclusions and the known legacy family outside the native codec. */
export function nativeVerificationSkip(
    relativePath: string,
    content: string,
    excludedPaths: readonly string[],
): { status: 'excluded' | 'unsupported'; reason: string } | undefined {
    const normalizedPath = relativePath.replace(/\\/gu, '/');
    if (excludedPaths.some(excluded => excluded.replace(/\\/gu, '/') === normalizedPath)) {
        return { status: 'excluded', reason: 'Explicit --exclude path' };
    }
    if (!normalizedPath.toLowerCase().endsWith('.blk')) return undefined;

    // Do not mask syntax errors or misspelled/new UnitTypes as unsupported families.
    let unitType: string;
    try {
        unitType = new BuildingBlock(content).getFirstString('UnitType').trim();
    } catch {
        return undefined;
    }
    if (unitType === 'GunEmplacement' && !nativeCapabilityForUnitTypeAlias(unitType)) {
        return { status: 'unsupported', reason: 'Legacy GunEmplacement has no native entity codec' };
    }
    return undefined;
}
