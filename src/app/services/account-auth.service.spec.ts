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
});