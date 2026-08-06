// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Pipe, type PipeTransform } from "@angular/core";


@Pipe({
    name: 'formatTons',
    pure: true // Pure pipes are only called when the input changes
})
export class FormatTonsPipe implements PipeTransform {
    transform(tons: number | undefined): string {
        if (tons === undefined) return '';
        const format = (num: number) => Math.round(num * 100) / 100;
        if (tons < 1000) {
            return `${format(tons)}`;
        } else if (tons < 1000000) {
            return `${format(tons / 1000)}k`;
        } else {
            return `${format(tons / 1000000)}M`;
        }
    }
}