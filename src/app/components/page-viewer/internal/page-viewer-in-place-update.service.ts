import { Injectable } from '@angular/core';

import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import type { PageViewerInPlaceUpdatePlan } from './types';

@Injectable()
export class PageViewerInPlaceUpdateService {
    buildPlan(options: {
        expectedUnits: readonly CBTForceUnit[];
        currentWrapperUnitIds: readonly string[];
        preserveSelectedUnitId: string;
    }): PageViewerInPlaceUpdatePlan {
        const { expectedUnits, currentWrapperUnitIds, preserveSelectedUnitId } = options;

        if (expectedUnits.length !== currentWrapperUnitIds.length) {
            return {
                canPatchInPlace: false,
                slots: []
            };
        }

        const preservedSlotIndex = currentWrapperUnitIds.findIndex((unitId) => unitId === preserveSelectedUnitId);

        return {
            canPatchInPlace: true,
            slots: expectedUnits.map((unit, slotIndex) => ({
                slotIndex,
                unit,
                preserveExisting: slotIndex === preservedSlotIndex
                    && currentWrapperUnitIds[slotIndex] === preserveSelectedUnitId
                    && unit.id === preserveSelectedUnitId
            }))
        };
    }
}