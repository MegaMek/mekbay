// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';

import type { PageViewerInPlaceUpdatePlan, PageViewerMember } from './types';

@Injectable()
export class PageViewerInPlaceUpdateService {
    buildPlan(options: {
        expectedUnits: readonly PageViewerMember[];
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
