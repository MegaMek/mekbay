// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Pipe, type PipeTransform } from '@angular/core';

@Pipe({
    name: 'cleanModelString',
    pure: true
})
export class CleanModelStringPipe implements PipeTransform {
    transform(model: string | undefined): string {
        if (!model) return '';
        const cleanedModel = model.replace(/\s*\(.*?\)\s*/g, '').trim();
        if (cleanedModel.length === 0) return model;
        return cleanedModel;
    }
}
