// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import { MAX_DISPLAY_NAME_LENGTH, normalizeDisplayName } from '../utils/display-name.util';
import { PilotNameGeneratorService } from './pilot-name-generator.service';
import { UserStateService } from './userState.service';
import { WsService } from './ws.service';

export const DISPLAY_NAME_SAVE_DEBOUNCE_MS = 300;

@Injectable({ providedIn: 'root' })
export class DisplayNameService {
    private readonly pilotNameGenerator = inject(PilotNameGeneratorService);
    private readonly userStateService = inject(UserStateService);
    private readonly wsService = inject(WsService);
    private pendingValue: string | null = null;
    private pendingPromise: Promise<string> | null = null;
    private pendingResolve: ((value: string) => void) | null = null;
    private pendingReject: ((reason: unknown) => void) | null = null;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private inFlightName: string | null = null;
    private inFlightPromise: Promise<string> | null = null;

    async current(): Promise<string | null> {
        await this.userStateService.whenReady();
        return normalizeDisplayName(this.userStateService.displayName());
    }

    async currentOrGenerated(): Promise<string> {
        return await this.current() ?? await this.generate();
    }

    async generate(): Promise<string> {
        try {
            return normalizeDisplayName(await this.pilotNameGenerator.generateCallsign(MAX_DISPLAY_NAME_LENGTH)) ?? 'Commander';
        } catch {
            return 'Commander';
        }
    }

    save(value: string): Promise<string> {
        if (this.pendingPromise) {
            this.pendingValue = value;
            this.scheduleSave();
            return this.pendingPromise;
        }
        const displayName = normalizeDisplayName(value);
        if (this.inFlightName === displayName && this.inFlightPromise) return this.inFlightPromise;

        this.pendingValue = value;
        this.pendingPromise = new Promise<string>((resolve, reject) => {
            this.pendingResolve = resolve;
            this.pendingReject = reject;
        });
        this.scheduleSave();
        return this.pendingPromise;
    }

    private scheduleSave(): void {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            void this.flushSave();
        }, DISPLAY_NAME_SAVE_DEBOUNCE_MS);
    }

    private async flushSave(): Promise<void> {
        if (this.inFlightPromise || this.pendingValue === null || !this.pendingPromise) return;

        const displayName = normalizeDisplayName(this.pendingValue);
        const resolve = this.pendingResolve!;
        const reject = this.pendingReject!;
        this.pendingValue = null;
        this.pendingPromise = null;
        this.pendingResolve = null;
        this.pendingReject = null;

        if (!displayName) {
            reject(new Error('Display name must be 1 to 16 characters.'));
            return;
        }

        this.inFlightName = displayName;
        this.inFlightPromise = this.persist(displayName);
        try {
            resolve(await this.inFlightPromise);
        } catch (error) {
            reject(error);
        } finally {
            this.inFlightName = null;
            this.inFlightPromise = null;
            if (this.pendingValue !== null) this.scheduleSave();
        }
    }

    private async persist(displayName: string): Promise<string> {
        if (!this.wsService.wsConnected()) throw new Error('The server is not connected.');

        const response = await this.wsService.sendAndWaitForResponse(
            { action: 'setDisplayName', displayName },
            { suppressGlobalError: true },
        );
        if (response?.action === 'error') throw new Error(response.message || 'Could not save the display name.');
        const savedName = normalizeDisplayName(response?.displayName);
        if (response?.action !== 'displayNameUpdated' || !savedName) {
            throw new Error('Could not save the display name.');
        }

        await this.userStateService.setDisplayName(savedName);
        return savedName;
    }
}
