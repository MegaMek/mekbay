// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DISPLAY_NAME_SAVE_DEBOUNCE_MS, DisplayNameService } from './display-name.service';
import { PilotNameGeneratorService } from './pilot-name-generator.service';
import { UserStateService } from './userState.service';
import { WsService } from './ws.service';

describe('DisplayNameService', () => {
    const displayName = signal<string | undefined>(undefined);
    const pilotNameGenerator = {
        generateCallsign: jasmine.createSpy('generateCallsign'),
    };
    const userStateService = {
        whenReady: jasmine.createSpy('whenReady'),
        displayName,
        setDisplayName: jasmine.createSpy('setDisplayName'),
    };
    const wsService = {
        wsConnected: signal(true),
        sendAndWaitForResponse: jasmine.createSpy('sendAndWaitForResponse'),
    };

    beforeEach(() => {
        jasmine.clock().install();
        displayName.set(undefined);
        pilotNameGenerator.generateCallsign.calls.reset();
        pilotNameGenerator.generateCallsign.and.resolveTo('Specter');
        userStateService.whenReady.calls.reset();
        userStateService.whenReady.and.resolveTo();
        userStateService.setDisplayName.calls.reset();
        userStateService.setDisplayName.and.resolveTo();
        wsService.wsConnected.set(true);
        wsService.sendAndWaitForResponse.calls.reset();
        wsService.sendAndWaitForResponse.and.resolveTo({
            action: 'displayNameUpdated',
            displayName: 'Specter',
        });

        TestBed.configureTestingModule({
            providers: [
                DisplayNameService,
                { provide: PilotNameGeneratorService, useValue: pilotNameGenerator },
                { provide: UserStateService, useValue: userStateService },
                { provide: WsService, useValue: wsService },
            ],
        });
    });

    afterEach(() => jasmine.clock().uninstall());

    it('uses the saved name or generates a bounded callsign', async () => {
        const service = TestBed.inject(DisplayNameService);

        await expectAsync(service.current()).toBeResolvedTo(null);
        await expectAsync(service.currentOrGenerated()).toBeResolvedTo('Specter');
        expect(pilotNameGenerator.generateCallsign).toHaveBeenCalledOnceWith(16);

        displayName.set('Atlas');
        await expectAsync(service.current()).toBeResolvedTo('Atlas');
        await expectAsync(service.currentOrGenerated()).toBeResolvedTo('Atlas');
        expect(pilotNameGenerator.generateCallsign).toHaveBeenCalledTimes(1);
    });

    it('debounces rapid saves and persists only the latest display name', async () => {
        const service = TestBed.inject(DisplayNameService);

        const first = service.save('Atlas');
        const latest = service.save('  Specter  ');

        expect(first).toBe(latest);
        expect(wsService.sendAndWaitForResponse).not.toHaveBeenCalled();
        jasmine.clock().tick(DISPLAY_NAME_SAVE_DEBOUNCE_MS);
        await expectAsync(latest).toBeResolvedTo('Specter');

        expect(wsService.sendAndWaitForResponse).toHaveBeenCalledOnceWith(
            { action: 'setDisplayName', displayName: 'Specter' },
            { suppressGlobalError: true },
        );
        expect(userStateService.setDisplayName).toHaveBeenCalledOnceWith('Specter');
    });

    it('waits for typing to settle before validating the final value', async () => {
        const service = TestBed.inject(DisplayNameService);

        const first = service.save('');
        const settled = service.save('Atlas');
        jasmine.clock().tick(DISPLAY_NAME_SAVE_DEBOUNCE_MS);

        expect(first).toBe(settled);
        await expectAsync(settled).toBeResolvedTo('Specter');
        expect(wsService.sendAndWaitForResponse).toHaveBeenCalledOnceWith(
            { action: 'setDisplayName', displayName: 'Atlas' },
            { suppressGlobalError: true },
        );
    });

    it('never sends the private uuid when saving a display name', async () => {
        const service = TestBed.inject(DisplayNameService);
        const saved = service.save('Specter');
        jasmine.clock().tick(DISPLAY_NAME_SAVE_DEBOUNCE_MS);

        await saved;

        expect(JSON.stringify(wsService.sendAndWaitForResponse.calls.allArgs())).not.toContain('uuid');
    });
});
