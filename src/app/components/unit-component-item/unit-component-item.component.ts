/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { CommonModule } from '@angular/common';
import { Component, ChangeDetectionStrategy, input, signal, afterNextRender, Injector, inject, computed, ElementRef, viewChild, HostBinding } from '@angular/core';
import { Unit, UnitComponent } from '../../models/units.model';
import { getWeaponTypeCSSClass } from '../../utils/equipment.util';
import { FloatingOverlayService } from '../../services/floating-overlay.service';

type ComponentDisplayStyle = 'normal' | 'small' | 'tiny' | 'text';

/**
 * Author: Drake
 */
@Component({
    selector: 'unit-component-item',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: './unit-component-item.component.html',
    styleUrls: ['./unit-component-item.component.css']
})
export class UnitComponentItemComponent {
    injector = inject(Injector);
    public floatingOverlayService = inject(FloatingOverlayService);
    unit = input.required<Unit>();
    damaged = input<boolean>(false);
    comp = input<UnitComponent | null>(null);
    displayStyle = input<ComponentDisplayStyle>('normal');
    componentEl = viewChild<ElementRef<HTMLDivElement>>('component');

    typeClass = computed(() => {
        return getWeaponTypeCSSClass(this.comp()?.t ?? '');
    });

    @HostBinding('style.display') get hostDisplay() {
        return this.displayStyle?.() === 'text' ? 'inline' : 'block';
    }

    constructor() {}

    onCompClick(event: MouseEvent) {
        event.stopPropagation();
        event.preventDefault();
        this.showFloatingOverlay();
    }

    onPointerEnter(event: MouseEvent) {
        this.showFloatingOverlay();
    }

    showFloatingOverlay() {
        const el = this.componentEl()?.nativeElement;
        if (!el) return;
        this.floatingOverlayService.show(this.unit(), this.comp(), el);
    }

    onPointerLeave(event: PointerEvent) {
        if (event.pointerType !== 'mouse') return; // only care about mouse pointers
        this.floatingOverlayService.hideWithDelay();
    }
}