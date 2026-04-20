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
});