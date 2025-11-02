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

import { inject, Injectable, signal } from '@angular/core';
import { DbService } from './db.service';
import { Options } from '../models/options.model';

/*
 * Author: Drake
 */

const DEFAULT_OPTIONS: Options = {
    sheetsColor: 'normal',
    pickerStyle: 'default',
    quickActions: 'disabled',
    canvasInput: 'all',
    swipeToNextSheet: 'horizontal',
    unitDisplayName: 'chassisModel',
    gameSystem: 'cbt',
    fluffImageInSheet: true,
    syncZoomBetweenSheets: true,
};

@Injectable({ providedIn: 'root' })
export class OptionsService {
    private dbService = inject(DbService);

    public options = signal<Options>({
        sheetsColor: DEFAULT_OPTIONS.sheetsColor,
        pickerStyle: DEFAULT_OPTIONS.pickerStyle,
        quickActions: DEFAULT_OPTIONS.quickActions,
        canvasInput: DEFAULT_OPTIONS.canvasInput,
        swipeToNextSheet: DEFAULT_OPTIONS.swipeToNextSheet,
        syncZoomBetweenSheets: DEFAULT_OPTIONS.syncZoomBetweenSheets,
        unitDisplayName: DEFAULT_OPTIONS.unitDisplayName,
        gameSystem: DEFAULT_OPTIONS.gameSystem,
        fluffImageInSheet: DEFAULT_OPTIONS.fluffImageInSheet,
    });

    constructor() {
        this.initOptions();
    }

    async initOptions() {
        const saved = await this.dbService.getOptions();
        this.options.set({
            sheetsColor: saved?.sheetsColor ?? DEFAULT_OPTIONS.sheetsColor,
            pickerStyle: saved?.pickerStyle ?? DEFAULT_OPTIONS.pickerStyle,
            quickActions: saved?.quickActions ?? DEFAULT_OPTIONS.quickActions,
            canvasInput: saved?.canvasInput ?? DEFAULT_OPTIONS.canvasInput,
            swipeToNextSheet: saved?.swipeToNextSheet ?? DEFAULT_OPTIONS.swipeToNextSheet,
            syncZoomBetweenSheets: saved?.syncZoomBetweenSheets ?? DEFAULT_OPTIONS.syncZoomBetweenSheets,
            unitDisplayName: saved?.unitDisplayName ?? DEFAULT_OPTIONS.unitDisplayName,
            gameSystem: saved?.gameSystem ?? DEFAULT_OPTIONS.gameSystem,
            fluffImageInSheet: saved?.fluffImageInSheet ?? DEFAULT_OPTIONS.fluffImageInSheet,
            lastCanvasState: saved?.lastCanvasState,
            sidebarLipPosition: saved?.sidebarLipPosition,
        });
    }

    async setOption<K extends keyof Options>(key: K, value: Options[K]) {
        const updated = { ...this.options(), [key]: value };
        this.options.set(updated);
        await this.dbService.saveOptions(updated);
    }
}