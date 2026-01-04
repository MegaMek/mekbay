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

import {
    Component,
    ChangeDetectionStrategy,
    input,
    computed,
    inject,
    ElementRef
} from '@angular/core';
import { LayoutService } from '../../services/layout.service';

/*
 * Author: Drake
 * 
 * HeatDiffMarkerComponent - Visual feedback marker for heat drag interactions.
 * Shows the heat difference with an arrow pointing to the target element.
 */

export interface HeatDiffMarkerData {
    el: SVGElement | null;
    heat: number;
    currentHeat: number;
    containerRect: DOMRect;
}

@Component({
    selector: 'heat-diff-marker',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="heat-diff-marker" 
             [class.small]="!layoutService.isTouchInput()"
             [class.visible]="visible()"
             [style.transform]="transform()">
            <div class="heat-diff-text" 
                 [style.backgroundColor]="color()">{{ text() }}</div>
            <div class="heat-diff-arrow"
                 [style.borderLeftColor]="color()"></div>
        </div>
    `,
    styles: [`
        :host {
            position: absolute;
            top: 0;
            left: 0;
            pointer-events: none;
            z-index: 10;
        }

        .heat-diff-marker {
            display: flex;
            align-items: center;
            width: 150px;
            height: 44px;
            opacity: 0;
            transition: opacity 0.1s;
        }

        .heat-diff-marker.visible {
            opacity: 1;
        }

        .heat-diff-text {
            width: 122px;
            height: 44px;
            color: white;
            font-weight: bold;
            font-size: 24px;
            display: flex;
            justify-content: center;
            align-items: center;
            border-radius: 2px;
        }

        .heat-diff-arrow {
            width: 0;
            height: 0;
            margin-left: -1px;
            border-top: 22px solid transparent;
            border-bottom: 22px solid transparent;
            border-left: 28px solid;
        }

        /* Small marker for mouse input */
        .heat-diff-marker.small {
            width: 50px;
            height: 22px;
        }

        .heat-diff-marker.small .heat-diff-text {
            width: 41px;
            height: 22px;
            font-size: 14px;
        }

        .heat-diff-marker.small .heat-diff-arrow {
            border-top-width: 11px;
            border-bottom-width: 11px;
            border-left-width: 14px;
        }
    `]
})
export class HeatDiffMarkerComponent {
    layoutService = inject(LayoutService);

    // Inputs
    data = input<HeatDiffMarkerData | null>(null);
    visible = input(false);

    // Computed properties
    transform = computed(() => {
        const markerData = this.data();
        if (!markerData?.el) return 'translate(-9999px, -9999px)';

        const elRect = markerData.el.getBoundingClientRect();
        const containerRect = markerData.containerRect;

        const isMouse = !this.layoutService.isTouchInput();
        const markerWidth = isMouse ? 50 : 150;
        const markerHeight = isMouse ? 22 : 44;
        const spacing = 4;

        const x = elRect.left - containerRect.left - markerWidth - spacing;
        const y = elRect.top - containerRect.top + (elRect.height / 2) - (markerHeight / 2);

        return `translate(${x}px, ${y}px)`;
    });

    color = computed(() => {
        const markerData = this.data();
        if (!markerData) return '#666';

        const diff = markerData.heat - markerData.currentHeat;
        if (diff < 0) return 'var(--cold-color)';
        if (diff > 0) return 'var(--hot-color)';
        return '#666';
    });

    text = computed(() => {
        const markerData = this.data();
        if (!markerData) return '';

        const diff = markerData.heat - markerData.currentHeat;
        const diffText = (diff >= 0 ? '+' : '') + diff.toString();
        
        const isMouse = !this.layoutService.isTouchInput();
        if (!isMouse) {
            return `${markerData.heat} (${diffText})`;
        }
        return diffText;
    });
}
