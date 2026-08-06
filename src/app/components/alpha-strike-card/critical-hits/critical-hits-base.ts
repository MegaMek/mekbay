// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import type { ASForceUnit } from '../../../models/as-force-unit.model';
import type { ColorScheme } from '../../../models/options.model';

/*
 * 
 * Critical Hits base component.
 */
@Component({
    selector: 'as-critical-hits-base',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: ``,
})
export class AsCriticalHitsBase {
    forceUnit = input<ASForceUnit>();
    cardStyle = input<ColorScheme>('default');
    useHex = input<boolean>(false);
    interactive = input<boolean>(false);
    
    /** Emits when the random roll button is clicked */
    rollCritical = output<void>();
    
    onRollCriticalClick(event: MouseEvent): void {
        event.stopPropagation();
        this.rollCritical.emit();
    }
}
