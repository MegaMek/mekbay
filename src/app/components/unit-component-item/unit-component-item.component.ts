// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { CommonModule } from '@angular/common';
import { Component, ChangeDetectionStrategy, input, inject, computed, type ElementRef, viewChild } from '@angular/core';
import type { UnitSummary, UnitComponent } from '../../models/unit-summary.model';
import { getWeaponTypeCSSClass } from '../../utils/equipment.util';
import { FloatingOverlayService } from '../../services/floating-overlay.service';

type ComponentDisplayStyle = 'normal' | 'small' | 'tiny' | 'text' | 'additional';

@Component({
    selector: 'unit-component-item',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: './unit-component-item.component.html',
    styleUrls: ['./unit-component-item.component.css'],
    host: {
        '[style.display]': 'hostDisplay'
    }
})
export class UnitComponentItemComponent {
    public floatingOverlayService = inject(FloatingOverlayService);
    unit = input.required<UnitSummary>();
    damaged = input<boolean>(false);
    comp = input<UnitComponent | null>(null);
    displayStyle = input<ComponentDisplayStyle>('normal');
    componentEl = viewChild<ElementRef<HTMLElement>>('component');

    typeClass = computed(() => {
        const component = this.comp();
        return getWeaponTypeCSSClass(component?.t ?? '', component?.eq);
    });

    hostDisplay = computed(() => this.displayStyle() === 'text' ? 'inline' : 'block');
    isInteractive = computed(() => this.displayStyle() !== 'additional');

    constructor() {}

    onCompClick(event: MouseEvent) {
        if (!this.isInteractive()) return;
        event.stopPropagation();
        event.preventDefault();
        this.showFloatingOverlay();
    }

    onPointerEnter(event: PointerEvent) {
        this.showFloatingOverlay();
    }

    showFloatingOverlay() {
        if (!this.isInteractive()) return;
        const el = this.componentEl()?.nativeElement;
        if (!el) return;
        this.floatingOverlayService.show(this.unit(), this.comp(), el);
    }

    onPointerLeave(event: PointerEvent) {
        if (!this.isInteractive()) return;
        if (event.pointerType !== 'mouse') return; // only care about mouse pointers
        this.floatingOverlayService.hideWithDelay();
    }
}