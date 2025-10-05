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
import { generateUUID, WsService } from './ws.service';

/*
 * Author: Drake
 */
@Injectable({ providedIn: 'root' })
export class OptionsService {
    private dbService = inject(DbService);
    private wsService = inject(WsService);

    public options = signal<Options>({
        uuid: '', // Will be set in constructor
        sheetsColor: 'normal',
        pickerStyle: 'default',
        quickActions: 'disabled'
    });

    constructor() {
        this.initOptions();
    }

    async initOptions() {
        const uuid = await this.getOrCreateUuid();
        const saved = await this.dbService.getOptions();
        this.options.set({
            uuid,
            sheetsColor: saved?.sheetsColor ?? 'normal',
            pickerStyle: saved?.pickerStyle ?? 'default',
            quickActions: saved?.quickActions ?? 'disabled'
        });
    }

    async setOption<K extends keyof Options>(key: K, value: Options[K]) {
        const updated = { ...this.options(), [key]: value };
        this.options.set(updated);
        await this.dbService.saveOptions(updated);
    }
    
    /**
     * Retrieves the current user UUID from options.
     * If missing, generates a new one, saves it, and returns it.
     */
    public async getOrCreateUuid(forceNew: boolean = false): Promise<string> {
        let options = await this.dbService.getOptions();
        if (forceNew || !options || !options.uuid || options.uuid.trim().length === 0) {
            const newUuid = generateUUID();
            if (!options) options = {};
            options.uuid = newUuid;
            await this.dbService.saveOptions(options as Options);
            return newUuid;
        }
        return options.uuid;
    }

}