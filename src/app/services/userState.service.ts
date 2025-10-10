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
import { generateUUID } from './ws.service';
import { Options } from '../models/options.model';
import { DbService } from './db.service';

/*
 * Author: Drake
 */
@Injectable({ providedIn: 'root' })
export class UserStateService {
    public isRegistered = signal<boolean>(false);
    public uuid = signal<string>('');
    private dbService = inject(DbService);

    constructor() {
        this.initUserState();
    }
    
    async initUserState() {
        const uuid = await this.getOrCreateUuid();
        this.uuid.set(uuid);
    }
    
    public async getOrCreateUuid(forceNew: boolean = false): Promise<string> {
        let options = await this.dbService.getOptions();
        if (forceNew || !options || !options.uuid || options.uuid.trim().length === 0) {
            const newUuid = generateUUID();
            await this.setUuid(newUuid);
            return newUuid;
        }
        return options.uuid;
    }

    public async setUuid(newUuid: string) {
        const trimmed = newUuid.trim();
        if (trimmed.length < 10 || trimmed.length > 40) {
            throw new Error('User Identifier must be between 10 and 40 characters long.');
        }
        let options = await this.dbService.getOptions();
        options = { ...options, uuid: trimmed } as Options;
        await this.dbService.saveOptions(options);
        this.uuid.set(trimmed);
    }

}