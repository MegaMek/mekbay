import { Injectable, computed, inject } from '@angular/core';

import { PAGE_GAP, PAGE_WIDTH } from '../page-viewer-zoom-pan.service';
import { PageViewerStateService } from './page-viewer-state.service';
import { PageViewerShadowService } from './page-viewer-shadow.service';
import type { PageViewerOverlayMode, PageViewerPageDescriptor, PageViewerShadowDescriptor } from './types';
import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';

@Injectable()
export class PageViewerRenderModelService {
    private readonly state = inject(PageViewerStateService);
    private readonly shadow = inject(PageViewerShadowService);

    readonly activePages = computed<PageViewerPageDescriptor[]>(() => {
        const units = this.state.forceUnits();
        const totalUnits = units.length;
        const visibleCount = Math.min(this.state.effectiveVisiblePageCount(), totalUnits);
        const selectedUnitId = this.state.selectedUnitId();
        const isSinglePage = visibleCount <= 1;
        const pageStep = PAGE_WIDTH + PAGE_GAP;

        if (totalUnits === 0 || visibleCount === 0) {
            return [];
        }

        return Array.from({ length: visibleCount }, (_, slotIndex) => {
            const unitIndex = this.state.normalizeIndex(this.state.viewStartIndex() + slotIndex);
            const unit = units[unitIndex];
            const overlayMode: PageViewerOverlayMode = isSinglePage && slotIndex === 0 ? 'fixed' : 'page';
            const originalLeft = slotIndex * pageStep;

            return {
                key: `active:${unit.id}:${slotIndex}`,
                unit,
                unitId: unit.id,
                unitIndex,
                slotIndex,
                role: 'active',
                overlayMode,
                originalLeft,
                scaledLeft: originalLeft,
                isSelected: unit.id === selectedUnitId,
                isActive: slotIndex === 0,
                isDimmed: false
            };
        });
    });

    readonly shadowPages = computed<PageViewerShadowDescriptor[]>(() => {
        const steadyStateShadows = this.state.shadowPages();
        const transientShadows = this.state.transientShadowPages();
        const mergedShadows = [...steadyStateShadows, ...transientShadows];
        const seenKeys = new Set<string>();
        const transitionTargetUnitId = this.state.activeTransition().targetUnitId;

        return mergedShadows.filter((shadow) => {
            if (seenKeys.has(shadow.key)) {
                return false;
            }

            seenKeys.add(shadow.key);
            return true;
        }).map((shadow) => ({
            ...shadow,
            isDimmed: shadow.unitId === transitionTargetUnitId ? false : shadow.isDimmed
        }));
    });

    buildSteadyStateShadowPages(options: {
        units: readonly CBTForceUnit[];
        startIndex: number;
        visibleCount: number;
        scale: number;
        containerWidth: number;
        translateX: number;
        displayedPositions: readonly number[];
    }): PageViewerShadowDescriptor[] {
        const { units, startIndex, visibleCount, scale, containerWidth, translateX, displayedPositions } = options;
        const totalUnits = units.length;

        if (totalUnits <= visibleCount || totalUnits === 0 || visibleCount <= 0) {
            return [];
        }

        const scaledPageStep = (PAGE_WIDTH + PAGE_GAP) * scale;
        const scaledPageWidth = PAGE_WIDTH * scale;
        const visibleLeft = -translateX;
        const visibleRight = visibleLeft + containerWidth;
        const firstPageScaledLeft = (displayedPositions[0] ?? 0) * scale;
        const lastPageUnscaledLeft = displayedPositions[visibleCount - 1] ?? ((visibleCount - 1) * (PAGE_WIDTH + PAGE_GAP));
        const lastPageScaledRight = lastPageUnscaledLeft * scale + scaledPageWidth;
        const shadows: PageViewerShadowDescriptor[] = [];

        let leftPosition = firstPageScaledLeft - scaledPageStep;
        let leftUnitOffset = 1;
        while (leftPosition + scaledPageWidth > visibleLeft && leftUnitOffset < totalUnits) {
            const unitIndex = this.state.normalizeIndex(startIndex - leftUnitOffset);
            const unit = units[unitIndex];
            shadows.push({
                key: this.shadow.getShadowKey(unitIndex, 'left'),
                unit,
                unitId: unit.id,
                unitIndex,
                originalLeft: leftPosition / scale,
                scaledLeft: leftPosition,
                direction: 'left',
                isDimmed: true
            });
            leftPosition -= scaledPageStep;
            leftUnitOffset++;
        }

        let rightPosition = lastPageScaledRight + PAGE_GAP * scale;
        let rightUnitOffset = visibleCount;
        while (rightPosition < visibleRight && rightUnitOffset < totalUnits) {
            const unitIndex = this.state.normalizeIndex(startIndex + rightUnitOffset);
            const unit = units[unitIndex];
            shadows.push({
                key: this.shadow.getShadowKey(unitIndex, 'right'),
                unit,
                unitId: unit.id,
                unitIndex,
                originalLeft: rightPosition / scale,
                scaledLeft: rightPosition,
                direction: 'right',
                isDimmed: true
            });
            rightPosition += scaledPageStep;
            rightUnitOffset++;
        }

        return shadows;
    }
}
