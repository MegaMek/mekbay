import { Injectable } from '@angular/core';

import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';

export interface PageViewerSelectionChangePlan {
    unitToSave: CBTForceUnit | null;
    nextPreviousUnit: CBTForceUnit | null;
    shouldUpdateHighlight: boolean;
    shouldDisplay: boolean;
    nextViewStartIndex: number | null;
    fromSwipe: boolean;
    selectedUnitId: string | null;
}

@Injectable()
export class PageViewerSelectionChangeService {
    buildPlan(options: {
        previousUnit: CBTForceUnit | null;
        currentUnit: CBTForceUnit | null;
        displayedUnits: readonly CBTForceUnit[];
        allUnits: readonly CBTForceUnit[];
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