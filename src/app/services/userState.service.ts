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

import { computed, inject, Injectable, signal } from '@angular/core';
import { generateUUID } from './ws.service';
import { DbService, type UserData } from './db.service';
import { LoggerService } from './logger.service';
import type { AvailableAuthProvider, LinkedOAuthProvider, UserStateSnapshot } from '../models/account-auth.model';

/*
 * Author: Drake
 */
@Injectable({ providedIn: 'root' })
export class UserStateService {
    public isRegistered = signal<boolean>(false);
    private dbService = inject(DbService);
    private logger = inject(LoggerService);
    private userData = signal<UserData>({ uuid: '' });
    private availableAuthProvidersState = signal<AvailableAuthProvider[]>([]);
    private readonly initPromise: Promise<void>;
    public uuid = computed<string>(() => this.userData().uuid);
    public publicId = computed<string | undefined>(() => this.userData().publicId);
    public hasOAuth = computed<boolean>(() => this.userData().hasOAuth ?? ((this.userData().oauthProviders?.length ?? 0) > 0));
    public oauthProviderCount = computed<number>(() => this.userData().oauthProviderCount ?? (this.userData().oauthProviders?.length ?? 0));
    public oauthProviders = computed<LinkedOAuthProvider[]>(() => this.userData().oauthProviders || []);
    public availableAuthProviders = computed<AvailableAuthProvider[]>(() => this.availableAuthProvidersState());

    constructor() {
        this.initPromise = this.initUserData();
    }

    private createResetUserData(uuid: string): UserData {
        const current = this.userData();
        const nextData: UserData = { uuid };
        if (current.tabSubs) {
            nextData.tabSubs = [...current.tabSubs];
        }
        return nextData;
    }

    private async persistUserData(nextData: UserData): Promise<void> {
        this.userData.set({ ...nextData });
        this.isRegistered.set(Boolean(nextData.publicId));
        await this.dbService.saveUserData(nextData);
    }
    
    async initUserData() {
        const userData = await this.dbService.getUserData();
        if (userData) {
            this.userData.set(userData);
            this.isRegistered.set(Boolean(userData.publicId));
            this.logger.info(`User publicId: ${userData.publicId ?? 'not set'}`);
            return;
        }
        // No user data? We generate it anew
        await this.createNewUUID();
    }

    public whenReady(): Promise<void> {
        return this.initPromise;
    }

    public async createNewUUID(): Promise<UserData> {
        const uuid = generateUUID();
        await this.setUuid(uuid);
        return this.userData();
    }

    public async createFreshSession(): Promise<UserData> {
        const nextUserData: UserData = { uuid: generateUUID() };
        this.availableAuthProvidersState.set([]);
        await this.persistUserData(nextUserData);
        return this.userData();
    }

    public async setUuid(newUuid: string) {
        const trimmed = newUuid.trim();
        if (trimmed.length < 10 || trimmed.length > 40) {
            throw new Error('User Identifier must be between 10 and 40 characters long.');
        }
        const currentUuid = this.userData().uuid;
        const nextUserData = currentUuid === trimmed
            ? { ...this.userData(), uuid: trimmed }
            : this.createResetUserData(trimmed);
        await this.persistUserData(nextUserData);
    }

    /**
     * Set the public ID received from the server.
     * This is called automatically when registering with the server.
     */
    public async setPublicId(publicId: string): Promise<void> {
        const userData = this.userData();
        if (userData.publicId === publicId) {
            return;
        }
        userData.publicId = publicId;
        await this.persistUserData(userData);
        this.logger.info(`User publicId updated: ${publicId}`);
    }

    public async applyServerState(snapshot: UserStateSnapshot): Promise<void> {
        const nextUserData = { ...this.userData() };

        if ('publicId' in snapshot) {
            if (snapshot.publicId) {
                nextUserData.publicId = snapshot.publicId;
            } else {
                delete nextUserData.publicId;
            }
        }

        if ('hasOAuth' in snapshot) {
            nextUserData.hasOAuth = snapshot.hasOAuth;
        }

        if ('oauthProviderCount' in snapshot) {
            nextUserData.oauthProviderCount = snapshot.oauthProviderCount;
        }

        if (Array.isArray(snapshot.oauthProviders)) {
            nextUserData.oauthProviders = snapshot.oauthProviders;
        }

        if (Array.isArray(snapshot.availableAuthProviders)) {
            this.availableAuthProvidersState.set(snapshot.availableAuthProviders);
        }

        await this.persistUserData(nextUserData);
    }

}