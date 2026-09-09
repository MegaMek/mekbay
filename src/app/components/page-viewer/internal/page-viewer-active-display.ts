// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { resolveDisplayedUnits } from './page-viewer-display-window';
import type { PageViewerMember } from './types';

export interface PageViewerActiveDisplayPreparation {
    canRender: boolean;
    displayedUnits: PageViewerMember[];
    loadError: string | null;
}

export function clearActivePageElements(content: HTMLDivElement, pageElements: readonly HTMLDivElement[]): HTMLDivElement[] {
    pageElements.forEach((element) => {
        if (element.dataset['renderMode'] !== 'declarative' && element.parentElement === content) {
            content.removeChild(element);
        }
        element.innerHTML = '';
    });

    return [];
}

export function prepareActiveDisplay(options: {
    currentUnit: PageViewerMember | null | undefined;
    allUnits: readonly PageViewerMember[];
    visiblePages: number;
    viewStartIndex: number;
}): PageViewerActiveDisplayPreparation {
    const { currentUnit, allUnits, visiblePages, viewStartIndex } = options;

    if (!currentUnit) {
        return {
            canRender: false,
            displayedUnits: [],
            loadError: null
        };
    }

    if (!currentUnit.recordSheet()) {
        return {
            canRender: false,
            displayedUnits: [],
            loadError: 'Loading record sheet...'
        };
    }

    return {
        canRender: true,
        displayedUnits: resolveDisplayedUnits(allUnits, visiblePages, viewStartIndex).units,
        loadError: null
    };
}
