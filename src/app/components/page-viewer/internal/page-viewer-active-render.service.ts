// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';

import type { PageViewerMember, PageViewerPageDescriptor } from './types';

export interface PageViewerActiveRenderFinalizePlan {
    shouldApplyCurrentTransform: boolean;
    shouldResetView: boolean;
    shouldRestoreViewState: boolean;
    fromSwipe: boolean;
    shouldFlushQueuedDirectionalNavigation: boolean;
    shouldMarkInitialRenderComplete: boolean;
}

@Injectable()
export class PageViewerActiveRenderService {
    pruneOverlappingShadows(options: {
        shadowPageElements: readonly HTMLDivElement[];
        activeUnitIds: ReadonlySet<string>;
        removeShadowPageElement: (element: HTMLDivElement) => void;
    }): HTMLDivElement[] {
        const { shadowPageElements, activeUnitIds, removeShadowPageElement } = options;

        return shadowPageElements.filter((element) => {
            const shadowUnitId = element.dataset['unitId'];
            if (!shadowUnitId || !activeUnitIds.has(shadowUnitId)) {
                return true;
            }

            if (element.dataset['renderMode'] !== 'declarative-shadow') {
                removeShadowPageElement(element);
                return false;
            }

            return true;
        });
    }

    bindActivePageWrapper(options: {
        unit: PageViewerMember;
        wrapper: HTMLDivElement;
        slotIndex: number;
        descriptor: PageViewerPageDescriptor | undefined;
        setWrapperSelectedState: (wrapper: HTMLDivElement, isSelected: boolean) => void;
        applyWrapperLayout: (wrapper: HTMLDivElement, options: { originalLeft: number; scale?: number }) => void;
        attachSvgToWrapper: (options: { wrapper: HTMLDivElement; svg: SVGSVGElement; scale?: number; setAsCurrent?: boolean }) => void;
        bindWrapperInteractiveLayers: (wrapper: HTMLDivElement, unit: PageViewerMember, svg: SVGSVGElement, overlayMode: 'fixed' | 'page') => void;
    }): boolean {
        const {
            unit,
            wrapper,
            slotIndex,
            descriptor,
            setWrapperSelectedState,
            applyWrapperLayout,
            attachSvgToWrapper,
            bindWrapperInteractiveLayers
        } = options;

        const svg = unit.recordSheet();
        if (!svg || !descriptor) {
            return false;
        }

        wrapper.dataset['unitId'] = unit.id;
        wrapper.dataset['unitIndex'] = String(descriptor.unitIndex);
        setWrapperSelectedState(wrapper, descriptor.isSelected);
        applyWrapperLayout(wrapper, { originalLeft: descriptor.originalLeft });
        attachSvgToWrapper({ wrapper, svg, setAsCurrent: slotIndex === 0 });
        bindWrapperInteractiveLayers(wrapper, unit, svg, descriptor.overlayMode);

        return true;
    }

    buildFinalizePlan(options: {
        applyCurrentTransform: boolean;
        initialRenderComplete: boolean;
        fromSwipe: boolean;
    }): PageViewerActiveRenderFinalizePlan {
        const { applyCurrentTransform, initialRenderComplete, fromSwipe } = options;

        if (applyCurrentTransform) {
            return {
                shouldApplyCurrentTransform: true,
                shouldResetView: false,
                shouldRestoreViewState: false,
                fromSwipe,
                shouldFlushQueuedDirectionalNavigation: false,
                shouldMarkInitialRenderComplete: false
            };
        }

        return {
            shouldApplyCurrentTransform: false,
            shouldResetView: !initialRenderComplete,
            shouldRestoreViewState: initialRenderComplete,
            fromSwipe,
            shouldFlushQueuedDirectionalNavigation: true,
            shouldMarkInitialRenderComplete: !initialRenderComplete
        };
    }
}
