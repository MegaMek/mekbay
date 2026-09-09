// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ChangeDetectionStrategy, input, inject, computed, type ElementRef, viewChild } from '@angular/core';
import type { UnitSummary } from '../../models/unit-summary.model';
import type { UnitConditionComponent } from '../../utils/unit-component-metadata-builder';
import { getWeaponTypeCSSClass } from '../../utils/equipment.util';
import { FloatingOverlayService } from '../../services/floating-overlay.service';
import { LayoutService } from '../../services/layout.service';
import { TechBaseBadgeComponent } from '../tech-base-badge/tech-base-badge.component';

type ComponentDisplayStyle = 'normal' | 'small' | 'tiny' | 'text' | 'additional';

@Component({
    selector: 'unit-component-item',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TechBaseBadgeComponent],
    templateUrl: './unit-component-item.component.html',
    styleUrl: './unit-component-item.component.css',
    host: {
        '[style.display]': 'hostDisplay'
    }
})
export class UnitComponentItemComponent {
    public floatingOverlayService = inject(FloatingOverlayService);
    private layout = inject(LayoutService);
    unit = input.required<UnitSummary>();
    damaged = input<boolean>(false);
    comp = input<UnitConditionComponent | null>(null);
    displayStyle = input<ComponentDisplayStyle>('normal');
    componentEl = viewChild<ElementRef<HTMLElement>>('component');

    typeClass = computed(() => {
        const component = this.comp();
        return getWeaponTypeCSSClass(component?.t ?? '', component?.eq);
    });

    hostDisplay = computed(() => this.displayStyle() === 'text' ? 'inline' : 'block');
    isInteractive = computed(() => this.displayStyle() !== 'additional');

    constructor() {}

    onCompClick(event: Event) {
        if (!this.isInteractive()) return;
        event.stopPropagation();
        event.preventDefault();
        this.showFloatingOverlay();
    }

    onPointerEnter(event: PointerEvent) {
        if (event.pointerType !== 'mouse' || this.layout.isPhone()) return;
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
