/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { Injectable, inject, signal } from '@angular/core';
import { DialogsService } from './dialogs.service';
import { LoggerService } from './logger.service';
import { ToastService } from './toast.service';
import { UserStateService } from './userState.service';
import { WsService } from './ws.service';
import type { OAuthPopupResult, OAuthProvider } from '../models/account-auth.model';

/*
 * Author: Drake
 */

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
    google: 'Google',
    apple: 'Apple',
    discord: 'Discord',
};

@Injectable({
    providedIn: 'root'
})
export class AccountAuthService {
    private dialogsService = inject(DialogsService);
    private logger = inject(LoggerService);
    private toastService = inject(ToastService);
    private userStateService = inject(UserStateService);
    private wsService = inject(WsService);

    public authInFlight = signal(false);

    public getProviderLabel(provider: OAuthProvider): string {
        return PROVIDER_LABELS[provider];
    }

    private buildAuthStartUrl(provider: OAuthProvider, mode: 'link' | 'login', replaceExisting = false): string {
        const baseUrl = this.wsService.getHttpBaseUrl();
        const url = new URL(`/auth/${provider}/start`, `${baseUrl}/`);
        url.searchParams.set('mode', mode);
        url.searchParams.set('origin', window.location.origin);

        if (mode === 'link') {
            url.searchParams.set('uuid', this.userStateService.uuid());
            url.searchParams.set('sessionId', this.wsService.getSessionId());
            if (replaceExisting) {
                url.searchParams.set('replaceExisting', 'true');
            }
        }

        return url.toString();
    }

    private openPopupWindow(): Window {
        const width = 540;
        const height = 720;
        const left = Math.max(0, Math.round((window.screen.width - width) / 2));
        const top = Math.max(0, Math.round((window.screen.height - height) / 2));
        const popup = window.open(
            '',
            'mekbay-oauth',
            `popup=yes,width=${width},height=${height},left=${left},top=${top}`
        );

        if (!popup) {
            throw new Error('The sign-in popup was blocked by your browser.');
        }

        popup.document.write('<title>MekBay OAuth</title><body style="font-family:Arial,sans-serif;padding:16px;">Connecting to provider...</body>');
        return popup;
    }

    private waitForPopupResult(popup: Window): Promise<OAuthPopupResult> {
        const allowedOrigin = this.wsService.getHttpBaseUrl();

        return new Promise<OAuthPopupResult>((resolve, reject) => {
            const closePollId = window.setInterval(() => {
                if (popup.closed) {
                    cleanup();
                    reject(new Error('The sign-in popup was closed before the flow completed.'));
                }
            }, 250);

            const onMessage = (event: MessageEvent) => {
                if (event.origin !== allowedOrigin) {
                    return;
                }

                const data = event.data as OAuthPopupResult | undefined;
                if (!data || data.source !== 'mekbay-oauth') {
                    return;
                }

                cleanup();
                resolve(data);
            };

            const cleanup = () => {
                window.clearInterval(closePollId);
                window.removeEventListener('message', onMessage);
            };

            window.addEventListener('message', onMessage);
        });
    }

    private async runOAuthPopup(provider: OAuthProvider, mode: 'link' | 'login', replaceExisting = false): Promise<OAuthPopupResult> {
        const popup = this.openPopupWindow();

        try {
            if (mode === 'link') {
                await this.wsService.waitForWebSocket();
            }

            popup.location.href = this.buildAuthStartUrl(provider, mode, replaceExisting);
            return await this.waitForPopupResult(popup);
        } catch (err) {
            try {
                popup.close();
            } catch {
                // Ignore popup close errors
            }
            throw err;
        }
    }

    public async loginWithProvider(provider: OAuthProvider): Promise<void> {
        this.authInFlight.set(true);

        try {
            const result = await this.runOAuthPopup(provider, 'login');
            if (!result.ok) {
                throw new Error(result.error || `${this.getProviderLabel(provider)} sign-in failed.`);
            }

            const targetUuid = result.uuid?.trim();
            if (targetUuid && targetUuid !== this.userStateService.uuid()) {
                const confirmed = await this.dialogsService.requestConfirmation(
                    'Signing in with a provider will switch this device to the linked MekBay account UUID. Local data on this device remains local, but cloud sync will follow the linked account. Continue?',
                    'Confirm Provider Sign-In',
                    'info'
                );

                if (!confirmed) {
                    return;
                }

                await this.userStateService.setUuid(targetUuid);
                window.location.reload();
                return;
            }

            if (result.userState) {
                await this.userStateService.applyServerState(result.userState);
            }

            this.toastService.showToast(`Signed in with ${this.getProviderLabel(provider)}`, 'success');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Provider sign-in failed.';
            this.logger.error(`Provider login failed: ${message}`);
            this.toastService.showToast(message, 'error');
        } finally {
            this.authInFlight.set(false);
        }
    }

    public async linkProvider(provider: OAuthProvider, replaceExisting = false): Promise<void> {
        this.authInFlight.set(true);

        try {
            const result = await this.runOAuthPopup(provider, 'link', replaceExisting);
            if (!result.ok) {
                throw new Error(result.error || `${this.getProviderLabel(provider)} linking failed.`);
            }

            if (result.userState) {
                await this.userStateService.applyServerState(result.userState);
            }

            this.toastService.showToast(
                replaceExisting
                    ? `${this.getProviderLabel(provider)} was replaced successfully`
                    : `${this.getProviderLabel(provider)} linked successfully`,
                'success'
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Provider linking failed.';
            this.logger.error(`Provider link failed: ${message}`);
            this.toastService.showToast(message, 'error');
        } finally {
            this.authInFlight.set(false);
        }
    }

    public async unlinkProvider(provider: OAuthProvider): Promise<void> {
        const label = this.getProviderLabel(provider);
        const confirmed = await this.dialogsService.requestConfirmation(
            `Are you sure you want to unlink ${label}? MekBay requires at least one OAuth provider to remain attached after an account is connected.`,
            'Unlink OAuth Provider',
            'danger'
        );
        if (!confirmed) {
            return;
        }

        this.authInFlight.set(true);

        try {
            await this.wsService.waitForWebSocket();
            const result = await this.wsService.sendAndWaitForResponse({
                action: 'unlinkOAuthProvider',
                provider,
            });

            if (!result?.success) {
                throw new Error(result?.error || `Failed to unlink ${label}.`);
            }

            this.toastService.showToast(`${label} unlinked`, 'success');
        } catch (err) {
            const message = err instanceof Error ? err.message : `Failed to unlink ${label}.`;
            this.logger.error(`Provider unlink failed: ${message}`);
            this.toastService.showToast(message, 'error');
        } finally {
            this.authInFlight.set(false);
        }
    }
}