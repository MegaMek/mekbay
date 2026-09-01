// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed, inject, Injectable } from '@angular/core';
import type { CBTUnitViewMode } from '../models/options.model';
import { OptionsService } from './options.service';

export type { CBTUnitViewMode } from '../models/options.model';

/** Changes the persisted CBT unit presentation; unit state remains force-owned. */
@Injectable({ providedIn: 'root' })
export class CBTUnitViewModeService {
    private readonly optionsService = inject(OptionsService);
    readonly mode = computed<CBTUnitViewMode>(() => this.optionsService.options().cbtUnitViewMode);

    showSheet(): void {
        this.setMode('sheet');
    }

    showTactical(): void {
        this.setMode('tactical');
    }

    toggle(): void {
        this.setMode(this.mode() === 'sheet' ? 'tactical' : 'sheet');
    }

    private setMode(mode: CBTUnitViewMode): void {
        if (this.mode() === mode) return;
        void this.optionsService.setOption('cbtUnitViewMode', mode);
    }
}
