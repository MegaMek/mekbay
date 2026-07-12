import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ForceBuilderService } from './force-builder.service';
import { LoggerService } from './logger.service';
import { WakeLockService } from './wake-lock.service';

interface MockWakeLockSentinel {
    released: boolean;
    release: jasmine.Spy<() => Promise<void>>;
}

function createSentinel(): MockWakeLockSentinel {
    const sentinel = {
        released: false,
        release: jasmine.createSpy('release').and.callFake(async () => {
            sentinel.released = true;
        }),
    };

    return sentinel;
}

async function flushWakeLockTasks(): Promise<void> {
    TestBed.tick();
    await Promise.resolve();
    TestBed.tick();
    await Promise.resolve();
    TestBed.tick();
    await Promise.resolve();
}

describe('WakeLockService', () => {
    const hasForces = signal(false);
    const logger = {
        info: jasmine.createSpy('info'),
        warn: jasmine.createSpy('warn'),
        error: jasmine.createSpy('error'),
    };

    let visibilityStateValue: DocumentVisibilityState;
    let originalWakeLockDescriptor: PropertyDescriptor | undefined;
    let originalVisibilityStateDescriptor: PropertyDescriptor | undefined;
    let requestSpy: jasmine.Spy;
    let sentinels: MockWakeLockSentinel[];

    beforeEach(() => {
        TestBed.resetTestingModule();

        hasForces.set(false);
        logger.info.calls.reset();
        logger.warn.calls.reset();
        logger.error.calls.reset();
        visibilityStateValue = 'visible';
        sentinels = [];

        requestSpy = jasmine.createSpy('request').and.callFake(async () => {
            const sentinel = createSentinel();
            sentinels.push(sentinel);
            return sentinel;
        });

        originalWakeLockDescriptor = Object.getOwnPropertyDescriptor(navigator, 'wakeLock');
        Object.defineProperty(navigator, 'wakeLock', {
            configurable: true,
            value: {
                request: requestSpy,
            },
        });

        originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => visibilityStateValue,
        });

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                WakeLockService,
                {
                    provide: ForceBuilderService,
                    useValue: { hasForces },
                },
                {
                    provide: LoggerService,
                    useValue: logger,
                },
            ],
        });
    });

    afterEach(() => {
        if (originalWakeLockDescriptor) {
            Object.defineProperty(navigator, 'wakeLock', originalWakeLockDescriptor);
        } else {
            const mutableNavigator = navigator as { wakeLock?: unknown };
            delete mutableNavigator.wakeLock;
        }

        if (originalVisibilityStateDescriptor) {
            Object.defineProperty(document, 'visibilityState', originalVisibilityStateDescriptor);
        } else {
            const mutableDocument = document as { visibilityState?: unknown };
            delete mutableDocument.visibilityState;
        }
    });

    it('acquires a wake lock when forces become loaded', async () => {
        TestBed.inject(WakeLockService);

        hasForces.set(true);
        await flushWakeLockTasks();

        expect(requestSpy).toHaveBeenCalledOnceWith('screen');
        expect(sentinels.length).toBe(1);
    });

    it('releases the wake lock when all forces are unloaded', async () => {
        TestBed.inject(WakeLockService);

        hasForces.set(true);
        await flushWakeLockTasks();
        hasForces.set(false);
        await flushWakeLockTasks();

        expect(sentinels.length).toBe(1);
        expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    });

    it('reacquires the wake lock when focus returns after it was released', async () => {
        TestBed.inject(WakeLockService);

        hasForces.set(true);
        await flushWakeLockTasks();

        expect(sentinels.length).toBe(1);

        visibilityStateValue = 'hidden';
        sentinels[0].released = true;

        visibilityStateValue = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
        await flushWakeLockTasks();

        expect(requestSpy).toHaveBeenCalledTimes(2);
        expect(sentinels.length).toBe(2);

        sentinels[1].released = true;
        window.dispatchEvent(new Event('focus'));
        await flushWakeLockTasks();

        expect(requestSpy).toHaveBeenCalledTimes(3);
        expect(sentinels.length).toBe(3);
    });
});