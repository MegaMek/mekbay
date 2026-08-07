// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, inject, Injectable, signal } from '@angular/core';
import { DbService, type UserData } from './db.service';
import { LoggerService } from './logger.service';
import type { AvailableAuthProvider, LinkedOAuthProvider, UserStateSnapshot } from '../models/account-auth.model';
import { uuidv4 } from '../utils/uuid.util';


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
    public accountProtectionPromptDismissed = computed<boolean>(() => this.userData().accountProtectionPromptDismissed === true);
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
        const uuid = uuidv4();
        await this.setUuid(uuid);
        return this.userData();
    }

    public async createFreshSession(): Promise<UserData> {
        const nextUserData: UserData = { uuid: uuidv4() };
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

    public async dismissAccountProtectionPrompt(): Promise<void> {
        if (this.accountProtectionPromptDismissed()) {
            return;
        }

        await this.persistUserData({
            ...this.userData(),
            accountProtectionPromptDismissed: true,
        });
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

        if (nextUserData.hasOAuth === true) {
            nextUserData.accountProtectionPromptDismissed = true;
        } else if ('accountProtectionPromptDismissed' in snapshot) {
            nextUserData.accountProtectionPromptDismissed = snapshot.accountProtectionPromptDismissed === true;
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