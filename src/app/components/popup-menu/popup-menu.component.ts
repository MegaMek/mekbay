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
import { Component, ElementRef, signal, effect, input, output, OnDestroy, inject, ChangeDetectionStrategy, afterNextRender, computed, viewChild } from '@angular/core';

/*
 * Author: Drake
 */
export interface PopupMenuOption {
    label?: string;
    value?: string;
    separator?: boolean;
    hidden?: boolean;
}

@Component({
    selector: 'popup-menu',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: './popup-menu.component.html',
    styleUrls: ['./popup-menu.component.css']
})
export class PopupMenuComponent implements OnDestroy {
    private _eref = inject(ElementRef);
    options = input<PopupMenuOption[]>([]);
    menuSelect = output<string>();

    isOpen = signal(false);
    
    showBelow = input<boolean>(false);
    
    constructor() {
        effect(() => {
            if (this.isOpen()) {
                document.addEventListener('click', this.documentClickHandler, true);
            } else {
                document.removeEventListener('click', this.documentClickHandler, true);
            }
        });
    }

    private documentClickHandler = (event: MouseEvent) => {
        if (this.isOpen() && !this._eref.nativeElement.contains(event.target)) {
            this.isOpen.set(false);
        }
    };

    ngOnDestroy() {
        document.removeEventListener('click', this.documentClickHandler, true);
    }

    select(option: string) {
        this.menuSelect.emit(option);
        this.isOpen.set(false);
    }

    toggleMenu() {
        this.isOpen.set(!this.isOpen());
    }
}