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

interface OAuthStartResponse {
    ok: boolean;
    authorizeUrl?: string;
    error?: string;
}

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

    private buildAuthStartUrl(provider: OAuthProvider, mode: 'link' | 'login', replaceExisting = false, responseMode: 'redirect' | 'json' = 'json'): string {
        const baseUrl = this.wsService.getHttpBaseUrl();
        const url = new URL(`/auth/${provider}/start`, `${baseUrl}/`);
        url.searchParams.set('mode', mode);
        url.searchParams.set('origin', window.location.origin);
        url.searchParams.set('transport', 'redirect');
        url.searchParams.set('returnTo', window.location.href);
        url.searchParams.set('response', responseMode);

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

    private async requestAuthorizationUrl(provider: OAuthProvider, mode: 'link' | 'login', replaceExisting = false): Promise<string> {
        const response = await fetch(this.buildAuthStartUrl(provider, mode, replaceExisting, 'json'));
        let payload: OAuthStartResponse | null = null;

        try {
            payload = await response.json() as OAuthStartResponse;
        } catch {
            payload = null;
        }

        if (!response.ok || !payload?.ok || !payload.authorizeUrl) {
            throw new Error(payload?.error || `Unable to start ${this.getProviderLabel(provider)} sign-in.`);
        }

        return payload.authorizeUrl;
    }

    private async startRedirectFlow(provider: OAuthProvider, mode: 'link' | 'login', replaceExisting = false): Promise<void> {
        if (mode === 'link') {
            await this.wsService.waitForWebSocket();
        }

        const authorizeUrl = await this.requestAuthorizationUrl(provider, mode, replaceExisting);
        window.location.assign(authorizeUrl);
    }

    public async handleOAuthRedirectReturn(): Promise<boolean> {
        const result = this.getOAuthResultFromUrl();
        if (!result) {
            return false;
        }

        this.clearOAuthResultFromUrl();
        this.authInFlight.set(false);
        await this.userStateService.whenReady();

        if (!result.ok) {
            const message = result.error || 'Provider authentication failed.';
            this.logger.error(`OAuth redirect failed: ${message}`);
            this.toastService.showToast(message, 'error');
            return true;
        }

        const provider = result.provider;
        if (!provider || !result.mode) {
            this.logger.error('OAuth redirect result was missing required metadata.');
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
            this.logger.error(`Failed to apply OAuth redirect result: ${message}`);
            this.toastService.showToast(message, 'error');
            return true;
        }
    }

    public async loginWithProvider(provider: OAuthProvider): Promise<void> {
        this.authInFlight.set(true);

        try {
            await this.startRedirectFlow(provider, 'login');
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
            await this.startRedirectFlow(provider, 'link', replaceExisting);
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