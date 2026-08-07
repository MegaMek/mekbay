// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { OAuthProviderPickerDialogComponent, type OAuthProviderPickerDialogResult } from '../components/oauth-provider-picker-dialog/oauth-provider-picker-dialog.component';
import { AccountAuthService } from './account-auth.service';
import { DialogsService } from './dialogs.service';
import { LoggerService } from './logger.service';
import { UserStateService } from './userState.service';
import { WsService } from './ws.service';
import type { ServerDialogMessagePayload } from '../models/server-message.model';

@Injectable({ providedIn: 'root' })
export class AccountProtectionService {
    private readonly accountAuthService = inject(AccountAuthService);
    private readonly dialogsService = inject(DialogsService);
    private readonly logger = inject(LoggerService);
    private readonly userStateService = inject(UserStateService);
    private readonly wsService = inject(WsService);
    private promptPending = false;
    private promptInFlight = false;

    constructor() {
        this.wsService.registerServerMessageHandler('dialog', (message) => {
            const payload = message.payload as ServerDialogMessagePayload;
            if (payload?.dialogType !== 'accountProtection') {
                return;
            }

            if (this.promptInFlight) {
                return;
            }

            this.promptPending = true;
            this.triggerPendingPrompt();
        });
        this.wsService.registerMessageHandler('userState', () => {
            if (this.promptPending) {
                this.triggerPendingPrompt();
            }
        });
    }

    private triggerPendingPrompt(): void {
        void this.flushPendingPrompt().catch(error => {
            this.logger.warn(`Account protection prompt failed: ${error}`);
        });
    }

    private async flushPendingPrompt(): Promise<void> {
        if (!this.promptPending || this.promptInFlight) {
            return;
        }

        await this.userStateService.whenReady();
        if (!this.promptPending || this.promptInFlight) {
            return;
        }

        if (this.userStateService.hasOAuth() || this.userStateService.accountProtectionPromptDismissed()) {
            this.promptPending = false;
            return;
        }

        const providers = this.userStateService.availableAuthProviders().filter(provider => provider.enabled);
        if (providers.length === 0) {
            return;
        }

        this.promptPending = false;
        this.promptInFlight = true;
        try {
            const ref = this.dialogsService.createDialog<OAuthProviderPickerDialogResult>(OAuthProviderPickerDialogComponent, {
                disableClose: true,
                data: {
                    title: 'Protect your MekBay account',
                    message: 'You have started saving enough data that losing this browser could mean losing your work. Link an OAuth provider to make this account recoverable on another device. OAuth is optional, and you can link it later from Options.',
                    providers,
                    actionLabel: 'Link',
                    dismissLabel: 'NO THANKS',
                },
            });
            const choice = (await firstValueFrom(ref.closed)) ?? 'dismiss';

            if (choice === 'dismiss') {
                await this.dismissPrompt();
                return;
            }

            await this.accountAuthService.linkProvider(choice, false);
        } finally {
            this.promptInFlight = false;
        }
    }

    private async dismissPrompt(): Promise<void> {
        await this.userStateService.dismissAccountProtectionPrompt();

        try {
            await this.wsService.waitForWebSocket();
            const response = await this.wsService.sendAndWaitForResponse({
                action: 'dismissAccountProtectionPrompt',
            });
            if (!response?.success) {
                this.logger.warn('Account protection dismissal was saved locally but not confirmed by the server.');
            }
        } catch (err) {
            this.logger.warn(`Account protection dismissal could not be saved to the server: ${err}`);
        }
    }
}
