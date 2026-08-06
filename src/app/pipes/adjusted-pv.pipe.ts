// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Pipe, type PipeTransform } from "@angular/core";
import { adjustPointValueForSkill } from '../utils/pv-skill-adjustment.util';


@Pipe({
    name: 'adjustedPV',
    pure: true // Pure pipes are only called when the input changes
})
export class AdjustedPV implements PipeTransform {

    transform(pv: number, skill: number): number {
        if (pv === undefined) return 0;
        return adjustPointValueForSkill(pv, skill);
    }
}