// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LoggerService } from './logger.service';
import { PlayerNamesService } from './player-names.service';
import { WsService } from './ws.service';

const SPECTER = '0a1b2c3d-0000-4000-8000-000000000001';
const NAMESAKE = '0a1b2c3d-0000-4000-8000-000000000002';
const NAMELESS = '9f8e7d6c-0000-4000-8000-000000000003';

describe('PlayerNamesService', () => {
    let connected: ReturnType<typeof signal<boolean>>;
    let onUserState: () => void;
    let send: jasmine.Spy;

    beforeEach(() => {
        connected = signal(true);
        send = jasmine.createSpy('sendAndWaitForResponse').and.callFake(async (msg: { publicIds: string[] }) => ({
            action: 'displayNames',
            names: Object.fromEntries(msg.publicIds.filter(id => id !== NAMELESS).map(id => [id, 'Specter'])),
        }));
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                { provide: LoggerService, useValue: { error: jasmine.createSpy('error') } },
                {
                    provide: WsService, useValue: {
                        wsConnected: connected,
                        sendAndWaitForResponse: send,
                        registerMessageHandler: (_action: string, handler: () => void) => { onUserState = handler; return () => {}; },
                    },
                },
            ],
        });
    });

    async function settle(): Promise<void> {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    }

    it('batches first-use lookups and keeps players with the same name distinct by publicId', async () => {
        const names = TestBed.inject(PlayerNamesService);

        expect(names.label(SPECTER)).toBe('@0a1b2c3d');
        names.label(NAMESAKE);
        names.label(NAMELESS);
        names.label(SPECTER);
        await settle();

        expect(send).toHaveBeenCalledOnceWith(
            { action: 'getDisplayNames', publicIds: [SPECTER, NAMESAKE, NAMELESS] },
            { suppressGlobalError: true },
        );
        expect(names.label(SPECTER)).toBe('@Specter');
        expect(names.label(NAMESAKE)).toBe('@Specter');
        expect(names.label(NAMELESS)).toBe('@9f8e7d6c');
        await settle();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('defers offline lookups and refreshes every known name on the next connection', async () => {
        const names = TestBed.inject(PlayerNamesService);
        names.label(SPECTER);
        await settle();
        connected.set(false);
        names.label(NAMELESS);
        await settle();
        expect(send).toHaveBeenCalledTimes(1);

        connected.set(true);
        onUserState();
        await settle();

        expect(send).toHaveBeenCalledTimes(2);
        expect(send.calls.mostRecent().args[0].publicIds).toEqual(jasmine.arrayWithExactContents([SPECTER, NAMELESS]));
        expect(names.label(NAMELESS)).toBe('@9f8e7d6c');
    });
});
