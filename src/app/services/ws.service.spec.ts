// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LoggerService } from './logger.service';
import { UserStateService } from './userState.service';
import { WsService } from './ws.service';

function getPhase(service: WsService) {
    return service.connectionStatusPhase();
}

function showDisconnectedBadge(service: WsService): void {
    (service as any).showDisconnectedBadge();
}

function showReconnectedBadge(service: WsService): void {
    (service as any).showReconnectedBadge();
}

describe('WsService', () => {
    const uuid = signal('');
    const logger = {
        info: jasmine.createSpy('info'),
        warn: jasmine.createSpy('warn'),
        error: jasmine.createSpy('error'),
    };
    const userStateService = {
        uuid,
        applyServerState: jasmine.createSpy('applyServerState'),
    };

    beforeEach(() => {
        TestBed.resetTestingModule();
        uuid.set('');
        logger.info.calls.reset();
        logger.warn.calls.reset();
        logger.error.calls.reset();
        userStateService.applyServerState.calls.reset();

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                WsService,
                { provide: LoggerService, useValue: logger },
                { provide: UserStateService, useValue: userStateService },
            ],
        });
    });

    it('keeps the badge hidden until the first failure occurs', () => {
        const service = TestBed.inject(WsService);

        expect(getPhase(service)).toBe('hidden');

        showDisconnectedBadge(service);

        expect(getPhase(service)).toBe('offline');
    });

    it('does not show a recovery badge before any failure has occurred', () => {
        const service = TestBed.inject(WsService);

        service.wsConnected.set(true);
        showReconnectedBadge(service);

        expect(getPhase(service)).toBe('hidden');
    });

    it('shows back online after reconnecting and keeps future failures visible', () => {
        const service = TestBed.inject(WsService);
        const scheduledCallbacks: Array<() => void> = [];
        let nextTimerId = 100;

        const setTimeoutSpy = spyOn(window, 'setTimeout').and.callFake(((handler: TimerHandler) => {
            if (typeof handler !== 'function') {
                throw new Error('Expected function timer handler');
            }
            scheduledCallbacks.push(handler as () => void);
            return nextTimerId++ as unknown as number;
        }) as typeof window.setTimeout);
        const clearTimeoutSpy = spyOn(window, 'clearTimeout');

        showDisconnectedBadge(service);
        service.wsConnected.set(true);
        showReconnectedBadge(service);

        expect(getPhase(service)).toBe('online');
        expect(setTimeoutSpy).toHaveBeenCalled();

        showDisconnectedBadge(service);

        expect(clearTimeoutSpy).toHaveBeenCalledWith(100 as unknown as number);
        expect(getPhase(service)).toBe('offline');

        service.wsConnected.set(true);
        showReconnectedBadge(service);

        expect(getPhase(service)).toBe('online');

        scheduledCallbacks[1]?.();

        expect(getPhase(service)).toBe('hidden');

        showDisconnectedBadge(service);

        expect(getPhase(service)).toBe('offline');
    });

    it('resubscribes force updates on a replacement socket', async () => {
        const service = TestBed.inject(WsService);
        uuid.set('user-1');
        const oldSocket = createSocketMock();
        (service as any).ws = oldSocket;
        const onRemoteUpdate = jasmine.createSpy('onRemoteUpdate');

        await service.subscribeToForceUpdates('force-1', onRemoteUpdate);
        expect(sentActions(oldSocket)).toEqual(['subscribeToForceUpdates']);

        (service as any).shouldReconnect = false;
        (service as any).handleClose({ code: 1006, reason: 'restart' } as CloseEvent, oldSocket);

        const newSocket = createSocketMock();
        (service as any).ws = newSocket;
        (service as any).handleOpen();

        expect(sentActions(newSocket)).toEqual(['register', 'subscribeToForceUpdates']);
        expect(oldSocket.removeEventListener).toHaveBeenCalled();

        const messageHandler = newSocket.addEventListener.calls.mostRecent().args[1] as (event: MessageEvent) => void;
        const updatedForce = { instanceId: 'force-1' };
        messageHandler({
            data: JSON.stringify({ action: 'updatedForce', data: updatedForce }),
        } as MessageEvent);

        expect(onRemoteUpdate).toHaveBeenCalledWith(updatedForce);
    });
});

function createSocketMock(): WebSocket & {
    send: jasmine.Spy;
    addEventListener: jasmine.Spy;
    removeEventListener: jasmine.Spy;
} {
    return {
        readyState: WebSocket.OPEN,
        send: jasmine.createSpy('send'),
        addEventListener: jasmine.createSpy('addEventListener'),
        removeEventListener: jasmine.createSpy('removeEventListener'),
    } as unknown as WebSocket & {
        send: jasmine.Spy;
        addEventListener: jasmine.Spy;
        removeEventListener: jasmine.Spy;
    };
}

function sentActions(socket: WebSocket & { send: jasmine.Spy }): string[] {
    return socket.send.calls.allArgs().map(([payload]) => JSON.parse(payload as string).action);
}