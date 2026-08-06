// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Pipe, type PipeTransform } from "@angular/core";


@Pipe({
    name: 'formatNumber',
    pure: true // Pure pipes are only called when the input changes
})
export class FormatNumberPipe implements PipeTransform {
    transform(val: number | undefined, formatThousands: boolean = false, compress: boolean = true): string {
        return FormatNumberPipe.formatValue(val, formatThousands, compress);
    }

    static formatValue(val: number | undefined, formatThousands: boolean = false, compress: boolean = true): string {
        if (val === undefined) return '';
        let postfix = '';
        if (compress) {
            if (val >= 10_000_000_000) {
                postfix = 'B';
                val = Math.round(val / 1_000_000_000);
            } else if (val >= 10_000_000) {
                postfix = 'M';
                val = Math.round(val / 1_000_000);
            } else if (val >= 10_000) {
                postfix = 'K';
                val = Math.round(val / 1_000);
            }
        }
        const rounded = Math.round(val);
        if (formatThousands) {
            return rounded.toLocaleString() + postfix;
        }
        return rounded.toString() + postfix;
    }
}