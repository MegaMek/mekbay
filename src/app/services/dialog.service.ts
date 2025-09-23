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

import { Injectable, Injector, ApplicationRef, ComponentRef, Type, createComponent, EnvironmentInjector, inject } from '@angular/core';
import { Subject } from 'rxjs';

/*
 * Author: Drake
 */
export interface DialogRef<T = any, R = any> {
    componentInstance: T;
    closed: Subject<R | undefined>;
    close: (result?: R) => void;
}

@Injectable({ providedIn: 'root' })
export class CustomDialogService {
    private appRef: ApplicationRef = inject(ApplicationRef);
    private injector: Injector = inject(Injector);
    private envInjector: EnvironmentInjector = inject(EnvironmentInjector);
    private dialogStack: Array<ComponentRef<any>> = [];

    constructor() {}

    open<T extends object, D = any, R = any>(
        component: Type<T>,
        config?: { data?: D; overlay?: boolean }
    ): DialogRef<T, R> {
        // Create overlay if needed
        let overlayEl: HTMLElement | null = null;
        if (config?.overlay !== false) {
            overlayEl = document.createElement('div');
            overlayEl.className = 'custom-dialog-overlay';
            Object.assign(overlayEl.style, {
                position: 'fixed',
                inset: '0',
                background: 'rgba(0,0,0,0.3)',
                zIndex: 1000 + this.dialogStack.length * 2,
            });
            document.body.appendChild(overlayEl);
        }

        // Create dialog component
        const compRef = createComponent(component, {
            environmentInjector: this.envInjector,
            elementInjector: this.injector,
        });

        if (config?.data && 'data' in compRef.instance) {
            (compRef.instance as any).data = config.data;
        }

        // Dialog close subject
        const closed$ = new Subject<R | undefined>();
        const close = (result?: R) => {
            closed$.next(result);
            closed$.complete();
            this.appRef.detachView(compRef.hostView);
            compRef.destroy();
            if (overlayEl) document.body.removeChild(overlayEl);
            this.dialogStack.pop();
        };

        // Attach close method to component instance
        (compRef.instance as any).close = close;

        // Attach to DOM
        this.appRef.attachView(compRef.hostView);
        const domElem = (compRef.hostView as any).rootNodes[0] as HTMLElement;
        domElem.style.zIndex = (1001 + this.dialogStack.length * 2).toString();
        domElem.classList.add('custom-dialog');
        document.body.appendChild(domElem);

        // Stack management
        this.dialogStack.push(compRef);

        return {
            componentInstance: compRef.instance,
            closed: closed$,
            close,
        };
    }
}