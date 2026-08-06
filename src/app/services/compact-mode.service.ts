// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, type WritableSignal, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CompactModeService {
    compactMode: WritableSignal<boolean> = signal(false);

    toggle() {
        this.compactMode.set(!this.compactMode());
    }
}