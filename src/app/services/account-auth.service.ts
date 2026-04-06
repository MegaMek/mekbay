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
import type { OAuthFlowResult, OAuthProvider } from '../models/account-auth.model';

/*
 * Author: Drake
 */

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
    google: 'Google',
    apple: 'Apple',
    discord: 'Discord',
};

const OAUTH_RESULT_PARAM = 'oauthResult';
const OAUTH_POPUP_FEATURES = 'popup=yes,width=640,height=760,resizable=yes,scrollbars=yes';

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

    private buildAuthStartUrl(
        provider: OAuthProvider,
        mode: 'link' | 'login',
        replaceExisting = false,
        transport: 'popup' | 'redirect' = 'popup',
        responseMode: 'redirect' | 'json' = 'redirect',
    ): string {
        const baseUrl = this.wsService.getHttpBaseUrl();
        const url = new URL(`/auth/${provider}/start`, `${baseUrl}/`);
        url.searchParams.set('mode', mode);
        url.searchParams.set('origin', window.location.origin);
        url.searchParams.set('transport', transport);
        url.searchParams.set('response', responseMode);

        if (transport === 'redirect') {
            url.searchParams.set('returnTo', window.location.href);
        }

        if (mode === 'link') {
            url.searchParams.set('uuid', this.userStateService.uuid());
            url.searchParams.set('sessionId', this.wsService.getSessionId());
            if (replaceExisting) {
                url.searchParams.set('replaceExisting', 'true');
            }
        }

        return url.toString();
    }

    private decodeBase64UrlJson<T>(value: string): T {
        const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
        const binary = window.atob(padded);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return JSON.parse(new TextDecoder().decode(bytes)) as T;
    }

    private getOAuthResultFromUrl(): OAuthFlowResult | null {
        const url = new URL(window.location.href);
        const encodedResult = url.searchParams.get(OAUTH_RESULT_PARAM);
        if (!encodedResult) {
            return null;
        }

        try {
            const result = this.decodeBase64UrlJson<OAuthFlowResult>(encodedResult);
            if (result?.source === 'mekbay-oauth') {
                return result;
            }

            this.clearOAuthResultFromUrl();
            return null;
        } catch (err) {
            this.logger.error(`Failed to decode OAuth redirect result: ${err}`);
            this.clearOAuthResultFromUrl();
            return null;
        }
    }

    private clearOAuthResultFromUrl(): void {
        const url = new URL(window.location.href);
        if (!url.searchParams.has(OAUTH_RESULT_PARAM)) {
            return;
        }

        url.searchParams.delete(OAUTH_RESULT_PARAM);
        const nextUrl = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState(null, '', nextUrl);
    }

    private isOAuthFlowResult(value: unknown): value is OAuthFlowResult {
        if (!value || typeof value !== 'object') {
            return false;
        }

        const payload = value as Partial<OAuthFlowResult>;
        return payload.source === 'mekbay-oauth' && typeof payload.ok === 'boolean';
    }

    private openPopupShell(provider: OAuthProvider, mode: 'link' | 'login'): Window {
        const popup = window.open('', '_blank', OAUTH_POPUP_FEATURES);
        if (!popup) {
            throw new Error('MekBay could not open the provider window. Allow popups for this site and try again.');
        }

        const providerLabel = this.getProviderLabel(provider);
        popup.document.open();
        popup.document.write(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MekBay OAuth</title>
  <style>
      html { height: 100%; }
      *, *::before, *::after { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #000; color: #fff; font-family: Arial, sans-serif; text-align: center; }
        p { margin: 0; color: #d0d0d0; line-height: 1.5; }
  </style>
</head>
<body>
    <p>Opening ${providerLabel} ${mode === 'link' ? 'link' : 'sign-in'}...</p>
</body>
</html>`);
        popup.document.close();
        popup.focus();
        return popup;
    }

    private waitForPopupResult(popup: Window): Promise<OAuthFlowResult> {
        return new Promise((resolve, reject) => {
            let settled = false;

            const cleanup = () => {
                window.removeEventListener('message', onMessage);
                window.clearInterval(closePollId);
            };

            const finish = (callback: () => void) => {
                if (settled) {
                    return;
                }

                settled = true;
                cleanup();
                callback();
            };

            const onMessage = (event: MessageEvent<unknown>) => {
                if (event.origin !== window.location.origin || !this.isOAuthFlowResult(event.data)) {
                    return;
                }

                const popupResult: OAuthFlowResult = event.data;
                finish(() => resolve(popupResult));
            };

            const closePollId = window.setInterval(() => {
                if (!popup.closed) {
                    return;
                }

                finish(() => reject(new Error('The provider window was closed before MekBay received a response.')));
            }, 250);

            window.addEventListener('message', onMessage);
        });
    }

    private async startPopupFlow(provider: OAuthProvider, mode: 'link' | 'login', replaceExisting = false): Promise<void> {
        const popup = this.openPopupShell(provider, mode);
        const resultPromise = this.waitForPopupResult(popup);

        try {
            if (mode === 'link') {
                await this.wsService.waitForWebSocket();
            }

            popup.location.replace(this.buildAuthStartUrl(provider, mode, replaceExisting, 'popup', 'redirect'));
            const result = await resultPromise;
            await this.applyOAuthResult(result, 'popup');
        } catch (err) {
            if (!popup.closed) {
                popup.close();
            }

            throw err;
        }
    }

    private async applyOAuthResult(result: OAuthFlowResult, flowKind: 'popup' | 'redirect'): Promise<boolean> {
        this.authInFlight.set(false);
        await this.userStateService.whenReady();

        if (!result.ok) {
            const message = result.error || 'Provider authentication failed.';
            this.logger.error(`OAuth ${flowKind} failed: ${message}`);
            this.toastService.showToast(message, 'error');
            return true;
        }

        const provider = result.provider;
        if (!provider || !result.mode) {
            this.logger.error(`OAuth ${flowKind} result was missing required metadata.`);
            this.toastService.showToast('Provider authentication completed, but the result was incomplete.', 'error');
            return true;
        }

        const providerLabel = this.getProviderLabel(provider);
        try {
            if (result.userState) {
                await this.userStateService.applyServerState(result.userState);
            }

            if (result.mode === 'login') {
                const targetUuid = result.uuid?.trim();
                if (!targetUuid) {
                    throw new Error(`${providerLabel} sign-in did not return a MekBay account.`);
                }

                if (targetUuid !== this.userStateService.uuid()) {
                    const confirmed = await this.dialogsService.requestConfirmation(
                        'Signing in with a provider will switch this device to the linked MekBay account UUID. Local data on this device remains local, but cloud sync will follow the linked account. Continue?',
                        'Confirm Provider Sign-In',
                        'info'
                    );

                    if (!confirmed) {
                        return true;
                    }

                    await this.userStateService.setUuid(targetUuid);
                    window.location.reload();
                    return true;
                }

                this.toastService.showToast(`Signed in with ${providerLabel}`, 'success');
                return true;
            }

            this.toastService.showToast(
                result.replaceExisting
                    ? `${providerLabel} was replaced successfully`
                    : `${providerLabel} linked successfully`,
                'success'
            );
            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Provider authentication failed.';
            this.logger.error(`Failed to apply OAuth ${flowKind} result: ${message}`);
            this.toastService.showToast(message, 'error');
            return true;
        }
    }

    public async handleOAuthRedirectReturn(): Promise<boolean> {
        const result = this.getOAuthResultFromUrl();
        if (!result) {
            return false;
        }

        this.clearOAuthResultFromUrl();
        return this.applyOAuthResult(result, 'redirect');
    }

    public async loginWithProvider(provider: OAuthProvider): Promise<void> {
        this.authInFlight.set(true);

        try {
            await this.startPopupFlow(provider, 'login');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Provider sign-in failed.';
            this.logger.error(`Provider login failed: ${message}`);
            this.toastService.showToast(message, 'error');
            this.authInFlight.set(false);
        }
    }

    public async linkProvider(provider: OAuthProvider, replaceExisting = false): Promise<void> {
        this.authInFlight.set(true);

        try {
            await this.startPopupFlow(provider, 'link', replaceExisting);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Provider linking failed.';
            this.logger.error(`Provider link failed: ${message}`);
            this.toastService.showToast(message, 'error');
            this.authInFlight.set(false);
        }
    }

    public async unlinkProvider(provider: OAuthProvider): Promise<void> {
        const label = this.getProviderLabel(provider);
        const confirmed = await this.dialogsService.requestConfirmation(
            `Are you sure you want to unlink ${label}? If this is your last linked provider, this device will fall back to UUID-only account access until you link or sign in with a provider again.`,
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