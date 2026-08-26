// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';

import type { PageViewerMember } from './types';

export interface PageViewerSelectionChangePlan {
    unitToSave: PageViewerMember | null;
    nextPreviousUnit: PageViewerMember | null;
    shouldUpdateHighlight: boolean;
    shouldDisplay: boolean;
    nextViewStartIndex: number | null;
    fromSwipe: boolean;
    selectedUnitId: string | null;
}

@Injectable()
export class PageViewerSelectionChangeService {
    buildPlan(options: {
        previousUnit: PageViewerMember | null;
        currentUnit: PageViewerMember | null;
        displayedUnits: readonly PageViewerMember[];
        allUnits: readonly PageViewerMember[];
        selectionRedisplaySuppressed: boolean;
    }): PageViewerSelectionChangePlan {
        const {
            previousUnit,
            currentUnit,
            displayedUnits,
            allUnits,
            selectionRedisplaySuppressed
        } = options;

        const unitToSave = previousUnit && previousUnit !== currentUnit ? previousUnit : null;

        if (selectionRedisplaySuppressed) {
            return {
                unitToSave,
                nextPreviousUnit: currentUnit,
                shouldUpdateHighlight: false,
                shouldDisplay: false,
                nextViewStartIndex: null,
                fromSwipe: previousUnit === null,
                selectedUnitId: currentUnit?.id ?? null
            };
        }

        const alreadyDisplayed = !!currentUnit && displayedUnits.some((unit) => unit.id === currentUnit.id);
        if (alreadyDisplayed) {
            return {
                unitToSave,
                nextPreviousUnit: currentUnit,
                shouldUpdateHighlight: true,
                shouldDisplay: false,
                nextViewStartIndex: null,
                fromSwipe: previousUnit === null,
                selectedUnitId: currentUnit?.id ?? null
            };
        }

        const nextViewStartIndex = currentUnit ? allUnits.indexOf(currentUnit) : -1;
        return {
            unitToSave,
            nextPreviousUnit: currentUnit,
            shouldUpdateHighlight: false,
            shouldDisplay: true,
            nextViewStartIndex: nextViewStartIndex >= 0 ? nextViewStartIndex : null,
            fromSwipe: previousUnit === null,
            selectedUnitId: currentUnit?.id ?? null
        };
    }
}
