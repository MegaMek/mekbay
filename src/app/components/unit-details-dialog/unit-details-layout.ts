// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';

/** Prototype layouts of the unit details dialog, compared side by side before one replaces `classic`. */
export type UnitDetailsLayout = 'classic' | 'gauges' | 'sheet' | 'columns' | 'specs';

export const UNIT_DETAILS_LAYOUTS: readonly { readonly id: UnitDetailsLayout; readonly label: string }[] = [
    { id: 'classic', label: 'Classic' },
    { id: 'gauges', label: 'Gauges' },
    { id: 'sheet', label: 'Record Sheet' },
    { id: 'columns', label: 'Two Columns' },
    { id: 'specs', label: 'Spec Panel' },
];

/** These layouts list role and tonnage under Basic Info instead of in the header. */
export function unitFactsInSpecs(layout: UnitDetailsLayout): boolean {
    return layout === 'columns' || layout === 'sheet';
}

const STORAGE_KEY = 'mekbay.unitDetailsLayout';

function storedLayout(): UnitDetailsLayout {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        return UNIT_DETAILS_LAYOUTS.some(layout => layout.id === value) ? value as UnitDetailsLayout : 'classic';
    } catch {
        return 'classic';
    }
}

/** One choice for every dialog in this browser, so units can be compared in the same layout. */
export const unitDetailsLayout = signal<UnitDetailsLayout>(storedLayout());

export function setUnitDetailsLayout(layout: UnitDetailsLayout): void {
    unitDetailsLayout.set(layout);
    try {
        localStorage.setItem(STORAGE_KEY, layout);
    } catch {
        // The choice still applies to this session.
    }
}
