// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Pipe, type PipeTransform } from '@angular/core';
import { DataService } from '../services/data.service';
import { FactionId, getFactionImg } from '../models/factions.model';

/*
 *
 * Pure pipe that resolves a faction ID to its image URL.
 * Returns undefined when the faction ID is missing or has no image.
 */
@Pipe({
    name: 'factionImg',
    pure: true,
})
export class FactionImgPipe implements PipeTransform {
    private dataService = inject(DataService);

    transform(factionId: FactionId | undefined | null): string | undefined {
        if (factionId == null) return undefined;
        const faction = this.dataService.getFactionById(factionId);
        if (!faction) return undefined;
        return getFactionImg(faction);
    }
}
