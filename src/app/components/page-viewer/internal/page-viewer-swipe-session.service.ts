import { Injectable } from '@angular/core';

import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import type { PageViewerSwipeInitialRangePlan, PageViewerSwipeVisibleOffsetWindow } from './page-viewer-swipe-slot.service';

export interface PageViewerSwipeSessionStartState {
    baseDisplayStartIndex: number;
    swipeAllUnits: CBTForceUnit[];
    swipeLeftmostOffset: number;
    swipeRightmostOffset: number;
    lastSwipeVisibleOffsets: PageViewerSwipeVisibleOffsetWindow;
}

export interface PageViewerSwipeSessionResetState {
    baseDisplayStartIndex: number;
    swipeDirection: 'left' | 'right' | 'none';
    lastSwipeTranslateX: number;
    lastSwipeVisibleOffsets: null;
    swipeLeftmostOffset: number;
    swipeRightmostOffset: number;
    swipeAllUnits: CBTForceUnit[];
}

@Injectable()
export class PageViewerSwipeSessionService {
    buildStartState(options: {
        viewStartIndex: number;
        units: CBTForceUnit[];
        initialRangePlan: PageViewerSwipeInitialRangePlan;
        initialVisibleOffsets: PageViewerSwipeVisibleOffsetWindow;
    }): PageViewerSwipeSessionStartState {
        return {
            baseDisplayStartIndex: options.viewStartIndex,
            swipeAllUnits: options.units,
            swipeLeftmostOffset: options.initialRangePlan.leftmostOffset,
            swipeRightmostOffset: options.initialRangePlan.rightmostOffset,
            lastSwipeVisibleOffsets: options.initialVisibleOffsets
        };
    }

    buildResetState(): PageViewerSwipeSessionResetState {
        return {
            baseDisplayStartIndex: 0,
            swipeDirection: 'none',
            lastSwipeTranslateX: 0,
            lastSwipeVisibleOffsets: null,
            swipeLeftmostOffset: 0,
            swipeRightmostOffset: 0,
            swipeAllUnits: []
        };
    }
}