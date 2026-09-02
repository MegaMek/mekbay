// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';

import { PageViewerDisplayWindowService } from './page-viewer-display-window.service';
import type { PageViewerInPlaceUpdatePlan, PageViewerMember } from './types';

export interface PageViewerActiveDisplayPreparation {
    canRender: boolean;
    displayedUnits: PageViewerMember[];
    loadError: string | null;
}

export interface PageViewerActiveInPlacePreparation {
    expectedUnits: PageViewerMember[];
    patchPlan: PageViewerInPlaceUpdatePlan;
}

@Injectable()
export class PageViewerActiveDisplayService {
    private readonly pageViewerDisplayWindow = inject(PageViewerDisplayWindowService);

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
            displayedUnits: this.pageViewerDisplayWindow.resolveDisplayedUnits(allUnits, visiblePages, viewStartIndex).units,
            loadError: null
        };
    }

    prepareInPlaceUpdate(options: {
        allUnits: readonly PageViewerMember[];
        visiblePages: number;
        viewStartIndex: number;
        currentWrapperUnitIds: readonly string[];
        preserveSelectedUnitId: string;
    }): PageViewerActiveInPlacePreparation {
        const { allUnits, visiblePages, viewStartIndex, currentWrapperUnitIds, preserveSelectedUnitId } = options;
        const expectedUnits = this.pageViewerDisplayWindow.resolveDisplayedUnits(allUnits, visiblePages, viewStartIndex).units;

        return {
            expectedUnits,
            patchPlan: this.buildInPlaceUpdatePlan({
                expectedUnits,
                currentWrapperUnitIds,
                preserveSelectedUnitId
            })
        };
    }

    private buildInPlaceUpdatePlan(options: {
        expectedUnits: readonly PageViewerMember[];
        currentWrapperUnitIds: readonly string[];
        preserveSelectedUnitId: string;
    }): PageViewerInPlaceUpdatePlan {
        const { expectedUnits, currentWrapperUnitIds, preserveSelectedUnitId } = options;
        if (expectedUnits.length !== currentWrapperUnitIds.length) {
            return { canPatchInPlace: false, slots: [] };
        }

        const preservedSlotIndex = currentWrapperUnitIds.indexOf(preserveSelectedUnitId);
        return {
            canPatchInPlace: true,
            slots: expectedUnits.map((unit, slotIndex) => ({
                slotIndex,
                unit,
                preserveExisting: slotIndex === preservedSlotIndex
                    && unit.id === preserveSelectedUnitId,
            })),
        };
    }
}
