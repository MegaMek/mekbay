import { Injectable } from '@angular/core';

import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import type { PageViewerDisplayWindow, PageViewerForceChangePlan } from './types';

@Injectable()
export class PageViewerDisplayWindowService {
    resolveViewStartIndex(totalUnits: number, visiblePages: number, currentViewStartIndex: number): number {
        if (totalUnits <= visiblePages) {
            return 0;
        }

        return currentViewStartIndex;
    }

    resolveDisplayedUnits(
        allUnits: readonly CBTForceUnit[],
        visiblePages: number,
        currentViewStartIndex: number
    ): PageViewerDisplayWindow {
        const totalUnits = allUnits.length;
        const startIndex = this.resolveViewStartIndex(totalUnits, visiblePages, currentViewStartIndex);

        if (totalUnits <= visiblePages) {
            return {
                startIndex,
                units: allUnits.map((unit) => unit as CBTForceUnit)
            };
        }

        const units: CBTForceUnit[] = [];
        for (let slotIndex = 0; slotIndex < visiblePages; slotIndex++) {
            const unitIndex = (startIndex + slotIndex) % totalUnits;
            const unit = allUnits[unitIndex] as CBTForceUnit | undefined;
            if (unit && !units.includes(unit)) {
                units.push(unit);
            }
        }

        return { startIndex, units };
    }

    buildForceChangePlan(options: {
        allUnits: readonly CBTForceUnit[];
        displayedUnits: readonly CBTForceUnit[];
        selectedUnitId: string | null;
        visibleCount: number;
        previousUnitCount: number;
        currentViewStartIndex: number;
    }): PageViewerForceChangePlan {
        const { allUnits, displayedUnits, selectedUnitId, visibleCount, previousUnitCount, currentViewStartIndex } = options;
        const totalUnits = allUnits.length;
        let nextViewStartIndex = this.resolveViewStartIndex(totalUnits, visibleCount, currentViewStartIndex);
        let needsRedisplay = totalUnits !== previousUnitCount;
        let preserveSelectedSlot = false;

        if (selectedUnitId && displayedUnits.length > 0 && totalUnits > 0) {
            const previousSlotIndex = displayedUnits.findIndex((unit) => unit.id === selectedUnitId);
            preserveSelectedSlot = previousSlotIndex >= 0;

            if (previousSlotIndex >= 0 && totalUnits > visibleCount) {
                const newSelectedIndex = allUnits.findIndex((unit) => unit.id === selectedUnitId);
                if (newSelectedIndex >= 0) {
                    const rawStartIndex = newSelectedIndex - previousSlotIndex;
                    const normalizedStartIndex = ((rawStartIndex % totalUnits) + totalUnits) % totalUnits;
                    if (normalizedStartIndex !== nextViewStartIndex) {
                        nextViewStartIndex = normalizedStartIndex;
                        needsRedisplay = true;
                    }
                }
            }
        }

        for (let slotIndex = 0; slotIndex < displayedUnits.length; slotIndex++) {
            const displayedUnit = displayedUnits[slotIndex];
            const expectedIndex = (nextViewStartIndex + slotIndex) % totalUnits;
            const expectedUnit = allUnits[expectedIndex];
            if (!expectedUnit || displayedUnit.id !== expectedUnit.id) {
                needsRedisplay = true;
                break;
            }
        }

        const targetDisplayCount = this.resolveDisplayedUnits(allUnits, visibleCount, nextViewStartIndex).units.length;
        if (displayedUnits.length !== targetDisplayCount) {
            needsRedisplay = true;
        }

        if (nextViewStartIndex >= totalUnits && totalUnits > 0) {
            nextViewStartIndex = Math.max(0, totalUnits - 1);
            needsRedisplay = true;
        }

        const wasInPaginatedMode = previousUnitCount > visibleCount;
        const nowInPaginatedMode = totalUnits > visibleCount;

        return {
            nextViewStartIndex,
            needsRedisplay,
            preserveSelectedSlot,
            targetDisplayCount,
            modeChanged: wasInPaginatedMode !== nowInPaginatedMode
        };
    }
}