// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AccountProtectionService } from './account-protection.service';
import { AccountAuthService } from './account-auth.service';
import { DialogsService } from './dialogs.service';
import { LoggerService } from './logger.service';
import { UserStateService } from './userState.service';
import { WsService } from './ws.service';

describe('AccountProtectionService', () => {
    const userStateService = {
        hasOAuth: jasmine.createSpy('hasOAuth').and.returnValue(false),
        accountProtectionPromptDismissed: jasmine.createSpy('accountProtectionPromptDismissed').and.returnValue(false),
        availableAuthProviders: jasmine.createSpy('availableAuthProviders').and.returnValue([
            { provider: 'google', label: 'Google', enabled: true },
        ]),
        whenReady: jasmine.createSpy('whenReady').and.resolveTo(),
        dismissAccountProtectionPrompt: jasmine.createSpy('dismissAccountProtectionPrompt').and.resolveTo(),
    };
    const dialogsService = {
        createDialog: jasmine.createSpy('createDialog'),
    };
    const accountAuthService = {
        linkProvider: jasmine.createSpy('linkProvider').and.resolveTo(),
    };
    const wsService = {
        registerMessageHandler: jasmine.createSpy('registerMessageHandler').and.returnValue(() => {}),
        registerServerMessageHandler: jasmine.createSpy('registerServerMessageHandler').and.returnValue(() => {}),
        waitForWebSocket: jasmine.createSpy('waitForWebSocket').and.resolveTo(),
        sendAndWaitForResponse: jasmine.createSpy('sendAndWaitForResponse').and.resolveTo({ success: true }),
    };
    const logger = {
        warn: jasmine.createSpy('warn'),
    };

    beforeEach(() => {
        TestBed.resetTestingModule();
        userStateService.hasOAuth.calls.reset();
        userStateService.hasOAuth.and.returnValue(false);
        userStateService.accountProtectionPromptDismissed.calls.reset();
        userStateService.accountProtectionPromptDismissed.and.returnValue(false);
        userStateService.availableAuthProviders.calls.reset();
        userStateService.availableAuthProviders.and.returnValue([
            { provider: 'google', label: 'Google', enabled: true },
        ]);
        userStateService.whenReady.calls.reset();
        userStateService.whenReady.and.resolveTo();
        userStateService.dismissAccountProtectionPrompt.calls.reset();
        dialogsService.createDialog.calls.reset();
        accountAuthService.linkProvider.calls.reset();
        wsService.waitForWebSocket.calls.reset();
        wsService.registerMessageHandler.calls.reset();
        wsService.registerMessageHandler.and.returnValue(() => {});
        wsService.registerServerMessageHandler.calls.reset();
        wsService.registerServerMessageHandler.and.returnValue(() => {});
        wsService.sendAndWaitForResponse.calls.reset();
        wsService.sendAndWaitForResponse.and.resolveTo({ success: true });
        logger.warn.calls.reset();

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                AccountProtectionService,
                { provide: AccountAuthService, useValue: accountAuthService },
                { provide: DialogsService, useValue: dialogsService },
                { provide: LoggerService, useValue: logger },
                { provide: UserStateService, useValue: userStateService },
                { provide: WsService, useValue: wsService },
            ],
        });
    });

    function emitAccountProtectionPrompt(): void {
        const handler = wsService.registerServerMessageHandler.calls.mostRecent().args[1] as (message: unknown) => void;
        handler({
            action: 'serverMessage',
            messageType: 'dialog',
            payload: { dialogType: 'accountProtection' },
        });
    }

    async function flushPrompt(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    }

    it('records a refusal locally and on the server', async () => {
        const dialogRef = { closed: of<'dismiss'>('dismiss') };
        dialogsService.createDialog.and.returnValue(dialogRef);
        TestBed.inject(AccountProtectionService);

        emitAccountProtectionPrompt();
        await flushPrompt();

        expect(dialogsService.createDialog).toHaveBeenCalledWith(
            jasmine.anything(),
            jasmine.objectContaining({
                data: jasmine.objectContaining({
                    title: 'Keep your MekBay data with you',
                    actionLabel: 'Link',
                    dismissLabel: 'NO THANKS',
                }),
            }),
        );
        expect(userStateService.dismissAccountProtectionPrompt).toHaveBeenCalledOnceWith();
        expect(wsService.sendAndWaitForResponse).toHaveBeenCalledOnceWith({
            action: 'dismissAccountProtectionPrompt',
        });
    });

    it('subscribes to the standardized dialog message channel', () => {
        TestBed.inject(AccountProtectionService);

        expect(wsService.registerServerMessageHandler).toHaveBeenCalledOnceWith('dialog', jasmine.any(Function));
    });

    it('queues a server prompt until the user state provides an enabled provider', async () => {
        userStateService.availableAuthProviders.and.returnValue([]);
        dialogsService.createDialog.and.returnValue({ closed: of<'google'>('google') });
        TestBed.inject(AccountProtectionService);

        const dialogHandler = wsService.registerServerMessageHandler.calls.mostRecent().args[1] as (message: unknown) => void;
        const userStateHandler = wsService.registerMessageHandler.calls.mostRecent().args[1] as () => void;

        dialogHandler({
            action: 'serverMessage',
            messageType: 'dialog',
            payload: { dialogType: 'accountProtection' },
        });
        await Promise.resolve();
        expect(dialogsService.createDialog).not.toHaveBeenCalled();

        userStateService.availableAuthProviders.and.returnValue([
            { provider: 'google', label: 'Google', enabled: true },
        ]);
        userStateHandler();
        await Promise.resolve();
        await Promise.resolve();

        expect(dialogsService.createDialog).toHaveBeenCalledOnceWith(
            jasmine.anything(),
            jasmine.objectContaining({ data: jasmine.objectContaining({ providers: jasmine.anything() }) }),
        );
        expect(accountAuthService.linkProvider).toHaveBeenCalledOnceWith('google', false);
    });

    it('links the selected provider without marking the prompt as refused', async () => {
        const dialogRef = { closed: of<'google'>('google') };
        dialogsService.createDialog.and.returnValue(dialogRef);
        TestBed.inject(AccountProtectionService);

        emitAccountProtectionPrompt();
        await flushPrompt();

        expect(accountAuthService.linkProvider).toHaveBeenCalledOnceWith('google', false);
        expect(userStateService.dismissAccountProtectionPrompt).not.toHaveBeenCalled();
    });
});
