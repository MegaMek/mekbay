// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed, inject, Injectable } from '@angular/core';
import type { ClassicUnitViewMode } from '../models/options.model';
import { OptionsService } from './options.service';

export type { ClassicUnitViewMode } from '../models/options.model';

/** Changes the persisted Classic unit presentation; unit state remains force-owned. */
@Injectable({ providedIn: 'root' })
export class ClassicUnitViewModeService {
    private readonly optionsService = inject(OptionsService);
    readonly mode = computed<ClassicUnitViewMode>(() => this.optionsService.options().classicUnitViewMode);

    showSheet(): void {
        this.setMode('sheet');
    }

    showTactical(): void {
        this.setMode('tactical');
    }

    toggle(): void {
        this.setMode(this.mode() === 'sheet' ? 'tactical' : 'sheet');
    }

    private setMode(mode: ClassicUnitViewMode): void {
        if (this.mode() === mode) return;
        void this.optionsService.setOption('classicUnitViewMode', mode);
    }
}
