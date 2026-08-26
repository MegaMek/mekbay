// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export type RecordSheetPageFormat = 'letter' | 'a4';

export interface RecordSheetPageProfile {
    readonly format: RecordSheetPageFormat;
    readonly width: number;
    readonly height: number;
    readonly margin: number;
    readonly contentWidth: number;
    readonly contentHeight: number;
    readonly compactContentY: number;
    readonly compactAvailableHeight: number;
    readonly compactGap: number;
    readonly horizontalScale: number;
    readonly verticalScale: number;
}

const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;
const A4_WIDTH = 595.276;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN = 18;
const LETTER_CONTENT_WIDTH = LETTER_WIDTH - PAGE_MARGIN * 2;
const LETTER_CONTENT_HEIGHT = LETTER_HEIGHT - PAGE_MARGIN * 2;
// MML's compact-page templates place their first unit below the masthead at
// these physical page coordinates. The ISO layout is not a uniformly stretched
// US Letter layout, so keep the two values explicit.
const LETTER_COMPACT_CONTENT_Y = 74.357;
const A4_COMPACT_CONTENT_Y = 72.859;
const LETTER_COMPACT_GAP = 3;

function createPageProfile(
    format: RecordSheetPageFormat,
    width: number,
    height: number,
    compactContentY: number,
): RecordSheetPageProfile {
    const contentWidth = width - PAGE_MARGIN * 2;
    const contentHeight = height - PAGE_MARGIN * 2;
    const horizontalScale = contentWidth / LETTER_CONTENT_WIDTH;
    const verticalScale = contentHeight / LETTER_CONTENT_HEIGHT;
    const compactGap = LETTER_COMPACT_GAP * horizontalScale;
    return Object.freeze({
        format,
        width,
        height,
        margin: PAGE_MARGIN,
        contentWidth,
        contentHeight,
        compactContentY,
        compactAvailableHeight: height - PAGE_MARGIN - compactContentY,
        compactGap,
        horizontalScale,
        verticalScale,
    });
}

const PAGE_PROFILES: Readonly<Record<RecordSheetPageFormat, RecordSheetPageProfile>> = Object.freeze({
    letter: createPageProfile('letter', LETTER_WIDTH, LETTER_HEIGHT, LETTER_COMPACT_CONTENT_Y),
    a4: createPageProfile('a4', A4_WIDTH, A4_HEIGHT, A4_COMPACT_CONTENT_Y),
});

/** Physical page and content geometry used by both generation and pagination. */
export function recordSheetPageProfile(format: RecordSheetPageFormat = 'letter'): RecordSheetPageProfile {
    return PAGE_PROFILES[format];
}

// Letter aliases retained for consumers which only need the canonical reference canvas.
export const RECORD_SHEET_PAGE_WIDTH = LETTER_WIDTH;
export const RECORD_SHEET_PAGE_HEIGHT = LETTER_HEIGHT;
export const RECORD_SHEET_MARGIN = PAGE_MARGIN;
export const RECORD_SHEET_CONTENT_WIDTH = LETTER_CONTENT_WIDTH;
export const RECORD_SHEET_CONTENT_HEIGHT = LETTER_CONTENT_HEIGHT;
export const RECORD_SHEET_COMPACT_GAP = LETTER_COMPACT_GAP;
export const RECORD_SHEET_COMPACT_CONTENT_Y = LETTER_COMPACT_CONTENT_Y;
export const RECORD_SHEET_COMPACT_AVAILABLE_HEIGHT = PAGE_PROFILES.letter.compactAvailableHeight;

export type CompactRecordSheetKind = 'battle-armor' | 'infantry' | 'protomek' | 'vehicle';

export interface RecordSheetLayoutProfile {
    readonly kind: CompactRecordSheetKind | 'full';
    readonly compact: boolean;
    readonly width: number;
    readonly height: number;
    /** Start-to-start spacing when this compact block is followed by its family. */
    readonly stride?: number;
    /** Physical page Y at which this family's first compact block begins. */
    readonly pageContentY?: number;
}

export interface RecordSheetPagePlan<T> {
    readonly compact: boolean;
    readonly items: readonly T[];
}

/** Shared physical-page primitive. Unit-family layouts still own when it applies. */
export function fullRecordSheetLayoutProfile(
    pageFormat: RecordSheetPageFormat = 'letter',
): RecordSheetLayoutProfile {
    const page = recordSheetPageProfile(pageFormat);
    return Object.freeze({
        kind: 'full',
        compact: false,
        width: page.width,
        height: page.height,
    });
}

/**
 * Packs only contiguous compact-unit runs. A full sheet ends the current run,
 * and compact blocks retain their force order while filling the selected page.
 */
export function planRecordSheetPages<T>(
    items: readonly T[],
    profileFor: (item: T) => Pick<RecordSheetLayoutProfile, 'compact' | 'height'>
        & Partial<Pick<RecordSheetLayoutProfile, 'kind' | 'stride' | 'pageContentY'>>,
    pageFormat: RecordSheetPageFormat = 'letter',
): readonly RecordSheetPagePlan<T>[] {
    const page = recordSheetPageProfile(pageFormat);
    const pages: RecordSheetPagePlan<T>[] = [];
    let compactItems: T[] = [];
    let compactKinds: (CompactRecordSheetKind | undefined)[] = [];
    let compactContentYs: number[] = [];
    let lastStart = 0;
    let lastHeight = 0;
    let lastStride = 0;

    const flushCompact = (): void => {
        if (compactItems.length === 0) return;
        pages.push(Object.freeze({ compact: true, items: Object.freeze(compactItems) }));
        compactItems = [];
        compactKinds = [];
        compactContentYs = [];
        lastStart = 0;
        lastHeight = 0;
        lastStride = 0;
    };

    for (const item of items) {
        const profile = profileFor(item);
        if (!profile.compact) {
            flushCompact();
            pages.push(Object.freeze({ compact: false, items: Object.freeze([item]) }));
            continue;
        }

        const kind = profile.kind === undefined || profile.kind === 'full' ? undefined : profile.kind;
        const pageContentY = profile.pageContentY ?? page.compactContentY;
        const height = Math.min(Math.max(profile.height, 0), page.contentHeight);
        const previousKind = compactKinds[compactKinds.length - 1];
        const candidateStart = compactItems.length === 0
            ? 0
            : kind !== undefined && kind === previousKind
                ? lastStart + lastStride
                : lastStart + lastHeight + page.compactGap;
        const candidateBottom = candidateStart + height;
        const candidateContentY = Math.max(pageContentY, ...compactContentYs);
        const availableHeight = page.height - page.margin - candidateContentY;
        if (compactItems.length > 0 && candidateBottom > availableHeight + 0.001) {
            flushCompact();
        }

        const actualPreviousKind = compactKinds[compactKinds.length - 1];
        const actualStart = compactItems.length === 0
            ? 0
            : kind !== undefined && kind === actualPreviousKind
                ? lastStart + lastStride
                : lastStart + lastHeight + page.compactGap;
        compactItems.push(item);
        compactKinds.push(kind);
        compactContentYs.push(pageContentY);
        lastStart = actualStart;
        lastHeight = height;
        lastStride = profile.stride ?? height + page.compactGap;
    }

    flushCompact();
    return Object.freeze(pages);
}
