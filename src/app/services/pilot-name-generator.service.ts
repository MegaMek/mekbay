// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import { PilotNameCatalogService } from './catalogs/pilot-name-catalog.service';
import { generatePilotName, pickWeighted, type PilotNameGenerationOptions } from '../utils/pilot-name-generator.util';

@Injectable({ providedIn: 'root' })
export class PilotNameGeneratorService {
    private readonly catalog = inject(PilotNameCatalogService);

    async generate(options: PilotNameGenerationOptions = {}): Promise<string | null> {
        await this.catalog.initialize();
        return generatePilotName(this.catalog.getCatalog(), options);
    }

    async generateCallsign(maxLength = Number.POSITIVE_INFINITY): Promise<string | null> {
        await this.catalog.initialize();
        const candidates = this.catalog.getCatalog().callsigns.filter(entry => entry.value.length <= maxLength);
        return pickWeighted(candidates) ?? null;
    }
}
