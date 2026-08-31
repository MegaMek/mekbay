// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LoggerService } from './logger.service';
import { UserStateService } from './userState.service';
import { PROTOCOL_VERSION, WsService } from './ws.service';
import { APP_VERSION, BUILD_BRANCH, BUILD_COMMIT_NUMBER } from '../build-meta';
import { GameSystem } from '../models/common.model';
import type { SerializedForce } from '../models/force-serialization';
import { encodeForceForStorage } from '../models/runtime/force-storage-codec';

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

    it('applies the display name returned in registration user state', () => {
        const service = TestBed.inject(WsService);

        (service as any).handleMessage({
            data: JSON.stringify({
                action: 'userState',
                publicId: 'public-1',
                displayName: 'Specter',
                hasOAuth: false,
                oauthProviderCount: 0,
            }),
        } as MessageEvent);

        expect(userStateService.applyServerState).toHaveBeenCalledWith(
            jasmine.objectContaining({ publicId: 'public-1', displayName: 'Specter' }),
        );
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

        expect(sentActions(newSocket)).toEqual(['register', 'subscribeToForceUpdates', 'getForce']);
        expect(sentMessages(newSocket).find(message => message.action === 'register')).toEqual(jasmine.objectContaining({
            version: PROTOCOL_VERSION,
            appVersion: APP_VERSION,
            buildBranch: BUILD_BRANCH,
            buildCommitNumber: BUILD_COMMIT_NUMBER,
        }));
        expect(oldSocket.removeEventListener).toHaveBeenCalled();

        const updatedForce: SerializedForce = {
            version: 2,
            instanceId: 'force-1',
            timestamp: '2026-08-31T00:00:00Z',
            type: GameSystem.ALPHA_STRIKE,
            name: 'Force 1',
            owned: true,
            groups: [],
        };
        const addEventListenerCalls = newSocket.addEventListener.calls.allArgs();
        const forceMessageHandler = addEventListenerCalls[0][1] as (event: MessageEvent) => void;
        const snapshotRequest = sentMessages(newSocket).find(message => message.action === 'getForce');
        expect(snapshotRequest?.requestId).toBeDefined();
        const snapshotEvent = {
            data: JSON.stringify({
                action: 'forceData',
                requestId: snapshotRequest!.requestId,
                data: encodeForceForStorage(updatedForce),
                instanceId: 'force-1',
            }),
        } as MessageEvent;
        for (const [, handler] of addEventListenerCalls) {
            (handler as (event: MessageEvent) => void)(snapshotEvent);
        }
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(onRemoteUpdate).toHaveBeenCalledWith(updatedForce, 'reconnect');

        const nextUpdatedForce: SerializedForce = { ...updatedForce, name: 'Updated' };
        forceMessageHandler({
            data: JSON.stringify({ action: 'updatedForce', data: encodeForceForStorage(nextUpdatedForce) }),
        } as MessageEvent);
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(onRemoteUpdate).toHaveBeenCalledWith(nextUpdatedForce, 'live');
    });

    it('serializes asynchronous force update callbacks', async () => {
        const service = TestBed.inject(WsService);
        let releaseReconnect!: () => void;
        const reconnectReleased = new Promise<void>(resolve => {
            releaseReconnect = resolve;
        });
        const onRemoteUpdate = jasmine.createSpy('onRemoteUpdate').and.callFake(async (
            _data: unknown,
            source: string,
        ) => {
            if (source === 'reconnect') {
                await reconnectReleased;
            }
        });
        const subscription = {
            onRemoteUpdate,
            handler: null,
            socket: null,
            updateQueue: Promise.resolve(),
        };

        const reconnect = (service as any).notifyForceSubscription(
            subscription,
            { instanceId: 'force-1' },
            'reconnect',
            'force-1',
        ) as Promise<void>;
        await Promise.resolve();

        const live = (service as any).notifyForceSubscription(
            subscription,
            { instanceId: 'force-1', name: 'Live' },
            'live',
            'force-1',
        ) as Promise<void>;
        await Promise.resolve();

        expect(onRemoteUpdate).toHaveBeenCalledTimes(1);

        releaseReconnect();
        await Promise.all([reconnect, live]);

        expect(onRemoteUpdate).toHaveBeenCalledTimes(2);
        expect(onRemoteUpdate.calls.argsFor(1)).toEqual([
            { instanceId: 'force-1', name: 'Live' },
            'live',
        ]);
    });

    it('probes an apparently open socket when the page resumes', async () => {
        const service = TestBed.inject(WsService);
        uuid.set('user-1');
        const socket = createSocketMock();
        (service as any).ws = socket;
        service.wsConnected.set(true);
        const probeSpy = spyOn(service, 'sendAndWaitForResponse').and.resolveTo({ action: 'pong' });

        (service as any).recoverConnection(true);
        await Promise.resolve();

        expect(probeSpy).toHaveBeenCalledWith({ action: 'ping' }, 2000);
        expect(socket.close).not.toHaveBeenCalled();
    });

    it('replaces an unresponsive socket when the page resumes', async () => {
        const service = TestBed.inject(WsService);
        uuid.set('user-1');
        const socket = createSocketMock();
        (service as any).ws = socket;
        service.wsConnected.set(true);
        spyOn(service, 'sendAndWaitForResponse').and.resolveTo(null);
        const connectSpy = spyOn<any>(service, 'connect');

        (service as any).recoverConnection(true);
        await Promise.resolve();
        await Promise.resolve();

        expect(socket.close).toHaveBeenCalled();
        expect(connectSpy).toHaveBeenCalled();
        expect(service.wsConnected()).toBeFalse();
    });

    it('reconnects immediately on resume when the socket is already closed', () => {
        const service = TestBed.inject(WsService);
        uuid.set('user-1');
        (service as any).ws = { ...createSocketMock(), readyState: WebSocket.CLOSED };
        const connectSpy = spyOn<any>(service, 'connect');

        (service as any).recoverConnection(true);

        expect(connectSpy).toHaveBeenCalled();
    });

    it('does not globally report an error owned by a pending request', async () => {
        const service = TestBed.inject(WsService);
        const socket = createSocketMock();
        const globalErrorHandler = jasmine.createSpy('globalErrorHandler');
        (service as any).ws = socket;
        service.setGlobalErrorHandler(globalErrorHandler);

        const responsePromise = service.sendAndWaitForResponse(
            { action: 'joinLobby' },
            { suppressGlobalError: true },
        );
        const request = sentMessages(socket)[0];
        const event = {
            data: JSON.stringify({
                action: 'error',
                requestId: request.requestId,
                message: 'Lobby not found',
            }),
        } as MessageEvent;

        (service as any).handleMessage(event);
        const requestHandler = socket.addEventListener.calls.mostRecent().args[1] as (event: MessageEvent) => void;
        requestHandler(event);

        expect((await responsePromise)?.['message']).toBe('Lobby not found');
        expect(globalErrorHandler).not.toHaveBeenCalled();
    });

    it('continues to globally report unsolicited server errors', () => {
        const service = TestBed.inject(WsService);
        const globalErrorHandler = jasmine.createSpy('globalErrorHandler');
        service.setGlobalErrorHandler(globalErrorHandler);

        (service as any).handleMessage({
            data: JSON.stringify({ action: 'error', message: 'Server error' }),
        } as MessageEvent);

        expect(globalErrorHandler).toHaveBeenCalledOnceWith('Server error');
    });
});

function createSocketMock(): WebSocket & {
    send: jasmine.Spy;
    close: jasmine.Spy;
    addEventListener: jasmine.Spy;
    removeEventListener: jasmine.Spy;
} {
    return {
        readyState: WebSocket.OPEN,
        send: jasmine.createSpy('send'),
        close: jasmine.createSpy('close'),
        addEventListener: jasmine.createSpy('addEventListener'),
        removeEventListener: jasmine.createSpy('removeEventListener'),
    } as unknown as WebSocket & {
        send: jasmine.Spy;
        close: jasmine.Spy;
        addEventListener: jasmine.Spy;
        removeEventListener: jasmine.Spy;
    };
}

function sentActions(socket: WebSocket & { send: jasmine.Spy }): string[] {
    return sentMessages(socket).map(message => message.action);
}

function sentMessages(socket: WebSocket & { send: jasmine.Spy }): Array<{ action: string; requestId?: string }> {
    return socket.send.calls.allArgs().map(([payload]) => JSON.parse(payload as string));
}
