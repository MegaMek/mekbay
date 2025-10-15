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

import { computed, inject, Injectable, signal, viewChild } from '@angular/core';
import { generateUUID } from './ws.service';
import { Options } from '../models/options.model';
import { DbService, UserData } from './db.service';

/*
 * Author: Drake
 */
@Injectable({ providedIn: 'root' })
export class UserStateService {
    public isRegistered = signal<boolean>(false);
    private dbService = inject(DbService);
    private userData = signal<UserData>({ uuid: '' });
    public uuid = computed<string>(() => this.userData().uuid);

    constructor() {
        this.initUserData();
    }
    
    async initUserData() {
        const userData = await this.dbService.getUserData();
        if (userData) {
            this.userData.set(userData);
            return;
        }
        // Fallback for older versions that didn't have a user table
        const options = await this.dbService.getOptions();
        if (options && options.uuid) {
            const newUserData = <UserData>{ uuid: options.uuid };
            this.userData.set(newUserData);
            await this.dbService.saveUserData(newUserData);
            return;
        }
        // No user data? We generate it anew
        await this.createNewUUID();
    }

    public async createNewUUID(): Promise<UserData> {
        const uuid = generateUUID();
        this.setUuid(uuid);
        return this.userData();
    }

    public async setUuid(newUuid: string) {
        const trimmed = newUuid.trim();
        if (trimmed.length < 10 || trimmed.length > 40) {
            throw new Error('User Identifier must be between 10 and 40 characters long.');
        }
        let userData = this.userData();
        if (!userData) {
            // Create new user data with the given UUID
            userData = <UserData>{ uuid: trimmed };
        } else {
            userData.uuid = trimmed;
        }
        this.userData.set({ ...userData });
        await this.dbService.saveUserData(userData);
    }

}