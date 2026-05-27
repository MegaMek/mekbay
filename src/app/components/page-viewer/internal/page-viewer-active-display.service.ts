import { Injectable, inject } from '@angular/core';

import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import { PageViewerDisplayWindowService } from './page-viewer-display-window.service';
import { PageViewerInPlaceUpdateService } from './page-viewer-in-place-update.service';
import type { PageViewerInPlaceUpdatePlan } from './types';

export interface PageViewerActiveDisplayPreparation {
    canRender: boolean;
    displayedUnits: CBTForceUnit[];
    loadError: string | null;
}

export interface PageViewerActiveInPlacePreparation {
    expectedUnits: CBTForceUnit[];
    patchPlan: PageViewerInPlaceUpdatePlan;
}

@Injectable()
export class PageViewerActiveDisplayService {
    private readonly pageViewerDisplayWindow = inject(PageViewerDisplayWindowService);
    private readonly pageViewerInPlaceUpdate = inject(PageViewerInPlaceUpdateService);

    clearActivePageElements(content: HTMLDivElement, pageElements: readonly HTMLDivElement[]): HTMLDivElement[] {
        pageElements.forEach((element) => {
            if (element.dataset['renderMode'] !== 'declarative' && element.parentElement === content) {
                content.removeChild(element);
            }
            element.innerHTML = '';
        });

        return [];
    }

    prepareDisplay(options: {
        currentUnit: CBTForceUnit | null | undefined;
        allUnits: readonly CBTForceUnit[];
        visiblePages: number;
        viewStartIndex: number;
    }): PageViewerActiveDisplayPreparation {
        const { currentUnit, allUnits, visiblePages, viewStartIndex } = options;

        if (!currentUnit || typeof currentUnit.svg !== 'function') {
            return {
                canRender: false,
                displayedUnits: [],
                loadError: null
            };
        }

        if (!currentUnit.svg()) {
            return {
                canRender: false,
                displayedUnits: [],
                loadError: 'Loading record sheet...'
            };
        }

        return {
            canRender: true,
            displayedUnits: this.pageViewerDisplayWindow.resolveDisplayedUnits(allUnits, visiblePages, viewStartIndex).units,
            loadError: null
        };
    }

    prepareInPlaceUpdate(options: {
        allUnits: readonly CBTForceUnit[];
        visiblePages: number;
        viewStartIndex: number;
        currentWrapperUnitIds: readonly string[];
        preserveSelectedUnitId: string;
    }): PageViewerActiveInPlacePreparation {
        const { allUnits, visiblePages, viewStartIndex, currentWrapperUnitIds, preserveSelectedUnitId } = options;
        const expectedUnits = this.pageViewerDisplayWindow.resolveDisplayedUnits(allUnits, visiblePages, viewStartIndex).units;

        return {
            expectedUnits,
            patchPlan: this.pageViewerInPlaceUpdate.buildPlan({
                expectedUnits,
                currentWrapperUnitIds,
                preserveSelectedUnitId
            })
        };
    }
}