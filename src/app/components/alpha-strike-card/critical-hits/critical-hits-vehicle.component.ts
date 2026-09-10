// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ChangeDetectionStrategy } from '@angular/core';
import { AsCriticalHitsBase, CRITICAL_HITS_TEMPLATE, CRITICAL_HITS_STYLES } from './critical-hits-base';
import { AsCritPipsComponent } from './crit-pips.component';

@Component({
    selector: 'g[as-critical-hits-vehicle]',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AsCritPipsComponent],
    template: CRITICAL_HITS_TEMPLATE,
    styles: [CRITICAL_HITS_STYLES],
})
export class AsCriticalHitsVehicleComponent extends AsCriticalHitsBase {
    protected override readonly variant = 'vehicle' as const;
}
