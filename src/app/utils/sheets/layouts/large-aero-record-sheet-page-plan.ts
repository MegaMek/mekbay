// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export type LargeAeroRecordSheetBlock =
    | 'capital-weapons'
    | 'ar10-munitions'
    | 'standard-weapons'
    | 'grav-decks'
    | 'transport-bays'
    | 'footer';

export interface LargeAeroRecordSheetPagePlanInput {
    readonly capitalWeaponLines: number;
    readonly standardWeaponLines: number;
    readonly hasAr10: boolean;
    readonly gravDeckCount: number;
    readonly transportBayLines: number;
}

export interface LargeAeroRecordSheetPagePlan {
    readonly front: ReadonlySet<LargeAeroRecordSheetBlock>;
    readonly reverse: ReadonlySet<LargeAeroRecordSheetBlock>;
    readonly pageCount: 1 | 2;
}

const MAX_SINGLE_PAGE_LINES = 42;
const PREFERRED_FRONT_PAGE_LINES = 36;
const REVERSE_ORDER: readonly LargeAeroRecordSheetBlock[] = Object.freeze([
    'standard-weapons',
    'grav-decks',
    'transport-bays',
    'footer',
    'ar10-munitions',
]);

/** MegaMekLab's large-craft block distribution, detached from SVG composition. */
export function planLargeAeroRecordSheetPages(
    input: LargeAeroRecordSheetPagePlanInput,
): LargeAeroRecordSheetPagePlan {
    const lines = new Map<LargeAeroRecordSheetBlock, number>([
        ['capital-weapons', sectionLines(input.capitalWeaponLines)],
        ['ar10-munitions', input.hasAr10 ? 5 : 0],
        ['standard-weapons', sectionLines(input.standardWeaponLines)],
        ['grav-decks', input.gravDeckCount > 0 ? Math.ceil(input.gravDeckCount / 2) + 2 : 0],
        ['transport-bays', input.transportBayLines > 0 ? input.transportBayLines + 2 : 0],
        ['footer', 2],
    ]);
    const front = new Set<LargeAeroRecordSheetBlock>(
        [...lines].filter(([, count]) => count > 0).map(([block]) => block),
    );
    const reverse = new Set<LargeAeroRecordSheetBlock>();
    let frontLines = [...lines.values()].reduce((sum, count) => sum + count, 0);

    if (frontLines <= MAX_SINGLE_PAGE_LINES) {
        return freezePlan(front, reverse, 1);
    }

    const candidates = input.capitalWeaponLines === 0
        ? REVERSE_ORDER.filter(block => block !== 'standard-weapons')
        : REVERSE_ORDER;
    for (const block of candidates) {
        const count = lines.get(block) ?? 0;
        if (count === 0) continue;
        front.delete(block);
        reverse.add(block);
        frontLines -= count;
        if (block === 'standard-weapons') frontLines += 2;
        if (frontLines <= PREFERRED_FRONT_PAGE_LINES) break;
    }

    // Avoid a nearly blank reverse containing only one or two grav-deck lines.
    if (!reverse.has('standard-weapons')
        && !reverse.has('transport-bays')
        && reverse.has('grav-decks')
        && lines.get('transport-bays')! > 0) {
        front.delete('transport-bays');
        reverse.add('transport-bays');
    }

    return freezePlan(front, reverse, 2);
}

function sectionLines(contentLines: number): number {
    return contentLines > 0 ? contentLines + 3 : 0;
}

function freezePlan(
    front: Set<LargeAeroRecordSheetBlock>,
    reverse: Set<LargeAeroRecordSheetBlock>,
    pageCount: 1 | 2,
): LargeAeroRecordSheetPagePlan {
    return Object.freeze({
        front: Object.freeze(front),
        reverse: Object.freeze(reverse),
        pageCount,
    });
}
