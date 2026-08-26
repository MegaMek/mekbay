// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import type {
    RecordSheetLayoutProfile,
    RecordSheetPageFormat,
} from '../record-sheet-layout';
import { AeroFighterRecordSheetLayout } from './aero-fighter-record-sheet-layout';
import { BattleArmorRecordSheetLayout } from './battle-armor-record-sheet-layout';
import { CombatVehicleRecordSheetLayout } from './combat-vehicle-record-sheet-layout';
import { ConventionalInfantryRecordSheetLayout } from './conventional-infantry-record-sheet-layout';
import { GenericRecordSheetLayout } from './generic-record-sheet-layout';
import { LargeAeroRecordSheetLayout } from './large-aero-record-sheet-layout';
import { MekRecordSheetLayout } from './mek-record-sheet-layout';
import { NavalRecordSheetLayout } from './naval-record-sheet-layout';
import { ProtoMekRecordSheetLayout } from './protomek-record-sheet-layout';
import {
    CompactRecordSheetLayout,
    type RecordSheetLayout,
} from './record-sheet-layout';

// Order only matters where a broad family contains a more specific one.
const SPECIALIZED_LAYOUTS: readonly RecordSheetLayout[] = Object.freeze([
    new MekRecordSheetLayout(),
    new NavalRecordSheetLayout(),
    new CombatVehicleRecordSheetLayout(),
    new ProtoMekRecordSheetLayout(),
    new BattleArmorRecordSheetLayout(),
    new ConventionalInfantryRecordSheetLayout(),
    new AeroFighterRecordSheetLayout(),
    new LargeAeroRecordSheetLayout(),
]);
const GENERIC_LAYOUT = new GenericRecordSheetLayout();

export function resolveRecordSheetLayout(entity: BaseEntity): RecordSheetLayout {
    return SPECIALIZED_LAYOUTS.find(layout => layout.matches(entity)) ?? GENERIC_LAYOUT;
}

export function recordSheetLayoutId(entity: BaseEntity): string {
    return resolveRecordSheetLayout(entity).id;
}

/** Family-owned page geometry exposed through the same router as generation. */
export function recordSheetLayoutProfile(
    entity: BaseEntity,
    pageFormat: RecordSheetPageFormat = 'letter',
): RecordSheetLayoutProfile {
    return resolveRecordSheetLayout(entity).profile(entity, pageFormat);
}

/** Resolves the family owner for a homogeneous set of generated compact blocks. */
export function resolveCompactRecordSheetLayout(
    blocks: readonly SVGSVGElement[],
): CompactRecordSheetLayout | null {
    if (blocks.length === 0) return null;
    const kinds = new Set(blocks.map(block => block.getAttribute('data-mekbay-compact')));
    if (kinds.size !== 1 || kinds.has(null)) return null;

    const layoutIds = new Set(blocks.map(block => block.getAttribute('data-mekbay-layout')));
    if (layoutIds.size === 1) {
        const layoutId = blocks[0].getAttribute('data-mekbay-layout');
        const exact = SPECIALIZED_LAYOUTS.find(layout => layout.id === layoutId);
        if (exact instanceof CompactRecordSheetLayout) return exact;
    }

    const kind = blocks[0].getAttribute('data-mekbay-compact');
    return SPECIALIZED_LAYOUTS.find(layout =>
        layout instanceof CompactRecordSheetLayout && layout.compactKind === kind,
    ) as CompactRecordSheetLayout | undefined ?? null;
}
