// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AccountAuthService } from './account-auth.service';
import { DialogsService } from './dialogs.service';
import { LoggerService } from './logger.service';
import { ToastService } from './toast.service';
import { UserStateService } from './userState.service';
import { WsService } from './ws.service';
import type { OAuthFlowResult } from '../models/account-auth.model';

describe('AccountAuthService', () => {
    let currentUuid = 'local-uuid-12345';

    const dialogsService = {
        requestConfirmation: jasmine.createSpy('requestConfirmation'),
    };

    const logger = {
        error: jasmine.createSpy('error'),
    };

    const toastService = {
        showToast: jasmine.createSpy('showToast'),
    };

    const userStateService = {
        whenReady: jasmine.createSpy('whenReady'),
        applyServerState: jasmine.createSpy('applyServerState'),
        setUuid: jasmine.createSpy('setUuid'),
        uuid: jasmine.createSpy('uuid'),
    };

    const wsService = {
        getHttpBaseUrl: jasmine.createSpy('getHttpBaseUrl').and.returnValue('https://mekbay.example'),
        getSessionId: jasmine.createSpy('getSessionId').and.returnValue('session-12345'),
        waitForWebSocket: jasmine.createSpy('waitForWebSocket').and.resolveTo(),
    };

    function createLoginResult(overrides: Partial<OAuthFlowResult> = {}): OAuthFlowResult {
        return {
            source: 'mekbay-oauth',
            ok: true,
            mode: 'login',
            provider: 'google',
            uuid: 'linked-uuid-12345',
            userState: {
                publicId: 'public-id-12345',
                hasOAuth: true,
                oauthProviderCount: 1,
                oauthProviders: [{ provider: 'google', linkedAt: '2026-01-01T00:00:00.000Z' }],
                availableAuthProviders: [],
            },
            ...overrides,
        };
    }

    beforeEach(() => {
        TestBed.resetTestingModule();
        currentUuid = 'local-uuid-12345';

        dialogsService.requestConfirmation.calls.reset();
        logger.error.calls.reset();
        toastService.showToast.calls.reset();
        userStateService.whenReady.calls.reset();
        userStateService.applyServerState.calls.reset();
        userStateService.setUuid.calls.reset();
        userStateService.uuid.calls.reset();
        wsService.getHttpBaseUrl.calls.reset();
        wsService.getSessionId.calls.reset();
        wsService.waitForWebSocket.calls.reset();

        dialogsService.requestConfirmation.and.resolveTo(true);
        userStateService.whenReady.and.resolveTo();
        userStateService.applyServerState.and.resolveTo();
        userStateService.setUuid.and.resolveTo();
        userStateService.uuid.and.callFake(() => currentUuid);

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                AccountAuthService,
                { provide: DialogsService, useValue: dialogsService },
                { provide: LoggerService, useValue: logger },
                { provide: ToastService, useValue: toastService },
                { provide: UserStateService, useValue: userStateService },
                { provide: WsService, useValue: wsService },
            ],
        });
    });

    it('does not apply remote OAuth state when a UUID switch is declined', async () => {
        dialogsService.requestConfirmation.and.resolveTo(false);
        const service = TestBed.inject(AccountAuthService);

        const handled = await (service as any).applyOAuthResult(createLoginResult(), 'popup');

        expect(handled).toBeTrue();
        expect(dialogsService.requestConfirmation).toHaveBeenCalled();
        expect(userStateService.setUuid).not.toHaveBeenCalled();
        expect(userStateService.applyServerState).not.toHaveBeenCalled();
    });

    it('asks before switching when a linked provider conflicts with the current UUID', async () => {
        dialogsService.requestConfirmation.and.resolveTo(false);
        const service = TestBed.inject(AccountAuthService);
        const result = createLoginResult({
            ok: false,
            mode: 'link',
            uuid: 'linked-uuid-12345',
            conflict: 'provider-linked-to-another-account',
            error: 'This Google account is already linked to another MekBay account.',
        });

        const handled = await (service as any).applyOAuthResult(result, 'popup');

        expect(handled).toBeTrue();
        expect(dialogsService.requestConfirmation).toHaveBeenCalledWith(
            'This Google account is already linked to another MekBay account. Switch this device to that account? Local data on this device remains local, but cloud sync will follow the linked account.',
            'Provider Already Linked',
            'warning',
        );
        expect(userStateService.setUuid).not.toHaveBeenCalled();
        expect(userStateService.applyServerState).not.toHaveBeenCalled();
        expect(toastService.showToast).not.toHaveBeenCalled();
    });

    it('applies remote OAuth state when sign-in completes for the current UUID', async () => {
        currentUuid = 'linked-uuid-12345';
        const service = TestBed.inject(AccountAuthService);

        const handled = await (service as any).applyOAuthResult(createLoginResult(), 'popup');

        expect(handled).toBeTrue();
        expect(dialogsService.requestConfirmation).not.toHaveBeenCalled();
        expect(userStateService.setUuid).not.toHaveBeenCalled();
        expect(userStateService.applyServerState).toHaveBeenCalledOnceWith(createLoginResult().userState);
        expect(toastService.showToast).toHaveBeenCalledWith('Signed in with Google', 'success');
    });

    it('shows OAuth failures without waiting for local user state', async () => {
        const service = TestBed.inject(AccountAuthService);
        const handled = await (service as any).applyOAuthResult({
            source: 'mekbay-oauth',
            ok: false,
            error: 'This Discord account is already linked to another MekBay account. Sign in with Discord to use that account.',
        }, 'popup');

        expect(handled).toBeTrue();
        expect(userStateService.whenReady).not.toHaveBeenCalled();
        expect(toastService.showToast).toHaveBeenCalledWith(
            'This Discord account is already linked to another MekBay account. Sign in with Discord to use that account.',
            'error',
        );
    });

    it('cancels a popup flow when focus returns without reading popup.closed', async () => {
        jasmine.clock().install();
        try {
            const service = TestBed.inject(AccountAuthService);
            let closedRead = false;
            const popup = new Proxy({} as Window, {
                get: (_target, property) => {
                    if (property === 'closed') {
                        closedRead = true;
                    }
                    return undefined;
                },
            });

            const resultPromise = (service as any).waitForPopupResult(popup) as Promise<OAuthFlowResult>;
            window.dispatchEvent(new Event('blur'));
            window.dispatchEvent(new Event('focus'));
            jasmine.clock().tick(250);

            await expectAsync(resultPromise).toBeRejectedWithError('The provider window was closed before MekBay received a response.');
            expect(closedRead).toBeFalse();
        } finally {
            jasmine.clock().uninstall();
        }
    });

    it('clears an OAuth result stored in the URL hash', () => {
        const service = TestBed.inject(AccountAuthService);
        const originalUrl = window.location.href;
        const url = new URL(originalUrl);
        url.search = '';
        url.hash = '#oauthResult=encoded-result';
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);

        try {
            (service as any).clearOAuthResultFromUrl();

            const cleanedUrl = new URL(window.location.href);
            expect(cleanedUrl.searchParams.has('oauthResult')).toBeFalse();
            expect(cleanedUrl.hash).toBe('');
        } finally {
            window.history.replaceState(null, '', originalUrl);
        }
    });

    it('preserves an unrelated fragment while clearing a query OAuth result', () => {
        const service = TestBed.inject(AccountAuthService);
        const originalUrl = window.location.href;
        const url = new URL(originalUrl);
        url.search = '?oauthResult=encoded-result';
        url.hash = '#/options';
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);

        try {
            (service as any).clearOAuthResultFromUrl();

            const cleanedUrl = new URL(window.location.href);
            expect(cleanedUrl.searchParams.has('oauthResult')).toBeFalse();
            expect(cleanedUrl.hash).toBe('#/options');
        } finally {
            window.history.replaceState(null, '', originalUrl);
        }
    });
});