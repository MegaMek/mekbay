import { Injectable } from '@angular/core';

import { PAGE_GAP, PAGE_HEIGHT, PAGE_WIDTH } from '../page-viewer-zoom-pan.service';

export interface PageViewerWrapperLayout {
    originalLeft: number;
    left: number;
    width: number;
    height: number;
}

@Injectable()
export class PageViewerWrapperLayoutService {
    isNeighborOffset(offset: number, visibleCount: number): boolean {
        return offset < 0 || offset >= visibleCount;
    }

    resolveOriginalLeft(baseLeft: number, offset: number): number {
        return baseLeft + offset * (PAGE_WIDTH + PAGE_GAP);
    }

    buildScaledLayout(originalLeft: number, scale: number): PageViewerWrapperLayout {
        return {
            originalLeft,
            left: originalLeft * scale,
            width: PAGE_WIDTH * scale,
            height: PAGE_HEIGHT * scale
        };
    }

    buildUnscaledLayout(originalLeft: number): PageViewerWrapperLayout {
        return {
            originalLeft,
            left: originalLeft,
            width: PAGE_WIDTH,
            height: PAGE_HEIGHT
        };
    }
}