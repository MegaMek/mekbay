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
});