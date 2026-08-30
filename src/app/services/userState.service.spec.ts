// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DbService, type UserData } from './db.service';
import { LoggerService } from './logger.service';
import { UserStateService } from './userState.service';

describe('UserStateService', () => {
    const existingUserData: UserData = {
        uuid: 'local-uuid-12345',
        publicId: 'public-id-12345',
        hasOAuth: true,
        oauthProviderCount: 1,
        oauthProviders: [{ provider: 'google', linkedAt: '2026-01-01T00:00:00.000Z' }],
    };

    const dbService = {
        getUserData: jasmine.createSpy('getUserData'),
        saveUserData: jasmine.createSpy('saveUserData'),
    };

    const logger = {
        info: jasmine.createSpy('info'),
    };

    beforeEach(() => {
        TestBed.resetTestingModule();

        dbService.getUserData.calls.reset();
        dbService.saveUserData.calls.reset();
        logger.info.calls.reset();

        dbService.getUserData.and.resolveTo({ ...existingUserData });
        dbService.saveUserData.and.resolveTo();

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                UserStateService,
                { provide: DbService, useValue: dbService },
                { provide: LoggerService, useValue: logger },
            ],
        });
    });

    it('clears linked providers when the server returns an empty list', async () => {
        const service = TestBed.inject(UserStateService);
        await service.whenReady();

        await service.applyServerState({
            hasOAuth: false,
            oauthProviderCount: 0,
            oauthProviders: [],
            availableAuthProviders: [],
        });

        expect(service.hasOAuth()).toBeFalse();
        expect(service.oauthProviderCount()).toBe(0);
        expect(service.oauthProviders()).toEqual([]);
        expect(service.availableAuthProviders()).toEqual([]);
    });

    it('persists an account protection refusal locally', async () => {
        const service = TestBed.inject(UserStateService);
        await service.whenReady();

        await service.dismissAccountProtectionPrompt();

        expect(service.accountProtectionPromptDismissed()).toBeTrue();
        expect(dbService.saveUserData).toHaveBeenCalledWith(
            jasmine.objectContaining({ accountProtectionPromptDismissed: true }),
        );
    });

    it('restores the prompt after the server reports a full OAuth unlink', async () => {
        const service = TestBed.inject(UserStateService);
        await service.whenReady();

        await service.dismissAccountProtectionPrompt();
        await service.applyServerState({ accountProtectionPromptDismissed: false, hasOAuth: false });

        expect(service.accountProtectionPromptDismissed()).toBeFalse();
    });

    it('automatically dismisses account protection when OAuth is linked', async () => {
        const service = TestBed.inject(UserStateService);
        await service.whenReady();

        await service.applyServerState({ hasOAuth: true, accountProtectionPromptDismissed: false });

        expect(service.accountProtectionPromptDismissed()).toBeTrue();
    });

    it('stores a normalized display name in the local user record', async () => {
        const service = TestBed.inject(UserStateService);
        await service.whenReady();

        await service.setDisplayName('  Specter  ');

        expect(service.displayName()).toBe('Specter');
        expect(dbService.saveUserData).toHaveBeenCalledWith(
            jasmine.objectContaining({ displayName: 'Specter' }),
        );
    });

    it('applies the remotely stored display name received at registration', async () => {
        const service = TestBed.inject(UserStateService);
        await service.whenReady();

        await service.applyServerState({ displayName: 'Atlas' });

        expect(service.displayName()).toBe('Atlas');
        expect(dbService.saveUserData).toHaveBeenCalledWith(
            jasmine.objectContaining({ displayName: 'Atlas' }),
        );
    });

    it('rejects display names longer than 16 characters', async () => {
        const service = TestBed.inject(UserStateService);
        await service.whenReady();

        await expectAsync(service.setDisplayName('12345678901234567'))
            .toBeRejectedWithError('Display name must be 1 to 16 characters.');
    });
});
