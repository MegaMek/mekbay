// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Pipe, type PipeTransform } from '@angular/core';

const BV_FORMATTERS = {
    grouped: new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }),
    ungrouped: new Intl.NumberFormat('en-US', {
        useGrouping: false,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }),
};

/** Formats BV without hiding fractional intermediate adjustments. */
@Pipe({
    name: 'formatBv',
    pure: true,
})
export class FormatBvPipe implements PipeTransform {
    transform(value: number | undefined, formatThousands: boolean = false): string {
        return FormatBvPipe.formatValue(value, formatThousands);
    }

    static formatValue(value: number | undefined, formatThousands: boolean = false): string {
        if (value === undefined) return '';
        const displayValue = Math.abs(value) < 0.005 ? 0 : value;
        return BV_FORMATTERS[formatThousands ? 'grouped' : 'ungrouped'].format(displayValue);
    }
}
