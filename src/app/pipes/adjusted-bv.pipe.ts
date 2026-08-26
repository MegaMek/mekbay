// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Pipe, type PipeTransform } from "@angular/core";
import { BVCalculatorUtil } from "../utils/bv-calculator.util";
import type { UnitSummary } from "../models/unit-summary.model";


@Pipe({
    name: 'adjustedBV',
    pure: true // Pure pipes are only called when the input changes
})
export class AdjustedBV implements PipeTransform {

    transform(unit: UnitSummary, gunnery: number, piloting: number): number {
        if (unit.bv === undefined) return 0;
        return BVCalculatorUtil.calculateAdjustedBV(unit, unit.bv, gunnery, piloting);
    }
}