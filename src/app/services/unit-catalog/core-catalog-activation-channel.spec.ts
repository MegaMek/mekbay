// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    CORE_CATALOG_ACTIVATION_CHANNEL_NAME,
    CORE_CATALOG_ACTIVATION_MAX_POLL_ATTEMPTS,
    CORE_CATALOG_ACTIVATION_POLL_INTERVAL_MS,
    CORE_CATALOG_ACTIVATION_STEADY_POLL_INTERVAL_MS,
    CoreCatalogActivationChannel,
    type CoreCatalogActivationHintV1,
    type CoreCatalogActivationRuntime,
} from './core-catalog-activation-channel';
import { asCatalogActivationId } from './unit-catalog.types';

const ACTIVATION_TWO = asCatalogActivationId('A'.repeat(43));
const ACTIVATION_THREE = asCatalogActivationId('Q'.repeat(43));

class FakeBroadcastChannel {
    public readonly posted: unknown[] = [];
    private listener?: (event: MessageEvent<unknown>) => void;

    public postMessage(value: unknown): void { this.posted.push(value); }
    public addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
        this.listener = listener;
    }
    public removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
        if (this.listener === listener) this.listener = undefined;
    }
    public close(): void { this.listener = undefined; }
    public emit(value: unknown): void { this.listener?.({ data: value } as MessageEvent<unknown>); }
}

interface FakeTimer {
    readonly callback: () => void;
    readonly delayMs: number;
}

interface FakeRuntimeState {
    readonly runtime: CoreCatalogActivationRuntime;
    readonly broadcast: FakeBroadcastChannel;
    readonly timers: Map<number, FakeTimer>;
    visibilityListener: (() => void) | undefined;
    visible: boolean;
}

function fakeRuntime(withBroadcast = true): FakeRuntimeState {
    const state = {
        broadcast: new FakeBroadcastChannel(),
        timers: new Map<number, FakeTimer>(),
        visibilityListener: undefined as (() => void) | undefined,
        visible: true,
        nextTimer: 1,
    };
    const runtime: CoreCatalogActivationRuntime = {
        createBroadcastChannel: name => {
            expect(name).toBe(CORE_CATALOG_ACTIVATION_CHANNEL_NAME);
            return withBroadcast ? state.broadcast : undefined;
        },
        addVisibilityListener: listener => {
            state.visibilityListener = listener;
            return () => { state.visibilityListener = undefined; };
        },
        isVisible: () => state.visible,
        setTimeout: (callback, delayMs) => {
            const handle = state.nextTimer++;
            state.timers.set(handle, { callback, delayMs });
            return handle;
        },
        clearTimeout: handle => {
            if (typeof handle === 'number') state.timers.delete(handle);
        },
        now: () => 1234,
        randomId: () => 'this-tab',
    };
    return Object.assign(state, { runtime });
}

function hint(overrides: Partial<CoreCatalogActivationHintV1> = {}): CoreCatalogActivationHintV1 {
    return {
        kind: 'core-catalog-activated',
        schemaVersion: 1,
        senderId: 'other-tab',
        activationId: ACTIVATION_TWO,
        summaryVersion: 2,
        publishedAtEpochMs: 1234,
        ...overrides,
    };
}

async function settle(): Promise<void> {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe('CoreCatalogActivationChannel', () => {
    it('turns a compatible foreign message into a verified reread request only', async () => {
        const fake = fakeRuntime();
        const channel = new CoreCatalogActivationChannel(fake.runtime);
        const check = jasmine.createSpy('checkActiveGeneration');
        const abort = new AbortController();
        channel.start({
            summaryVersion: 2,
            signal: abort.signal,
            checkActiveGeneration: check,
        });

        fake.broadcast.emit(hint());
        await settle();

        expect(check).toHaveBeenCalledOnceWith();
        // The activation ID is deliberately not passed to the trusted callback.
        expect(check.calls.mostRecent().args).toEqual([]);
    });

    it('ignores malformed, same-tab, and incompatible-build hints', async () => {
        const fake = fakeRuntime();
        const channel = new CoreCatalogActivationChannel(fake.runtime);
        const check = jasmine.createSpy('checkActiveGeneration');
        channel.start({
            summaryVersion: 2,
            signal: new AbortController().signal,
            checkActiveGeneration: check,
        });

        fake.broadcast.emit({ kind: 'forged' });
        fake.broadcast.emit(hint({ senderId: 'this-tab' }));
        fake.broadcast.emit(hint({ summaryVersion: 3 }));
        await settle();

        expect(check).not.toHaveBeenCalled();
    });

    it('announces only activation metadata and stops on abort', async () => {
        const fake = fakeRuntime();
        const channel = new CoreCatalogActivationChannel(fake.runtime);
        const abort = new AbortController();
        const check = jasmine.createSpy('checkActiveGeneration');
        channel.start({
            summaryVersion: 2,
            signal: abort.signal,
            checkActiveGeneration: check,
        });

        channel.announce({
            activationId: ACTIVATION_THREE,
            summaryVersion: 2,
        });
        expect(fake.broadcast.posted).toEqual([jasmine.objectContaining({
            activationId: ACTIVATION_THREE, senderId: 'this-tab', publishedAtEpochMs: 1234,
        })]);

        abort.abort();
        fake.broadcast.emit(hint());
        await settle();
        expect(check).not.toHaveBeenCalled();
        expect(fake.visibilityListener).toBeUndefined();
    });

    it('uses bounded polling and visibility checks when BroadcastChannel is absent', async () => {
        const fake = fakeRuntime(false);
        const channel = new CoreCatalogActivationChannel(fake.runtime);
        const check = jasmine.createSpy('checkActiveGeneration');
        const abort = new AbortController();
        channel.start({
            summaryVersion: 2,
            signal: abort.signal,
            checkActiveGeneration: check,
        });

        expect(fake.timers.size).toBe(1);
        const timer = [...fake.timers.entries()][0];
        fake.timers.delete(timer[0]);
        timer[1].callback();
        await settle();
        expect(check).toHaveBeenCalledTimes(1);
        expect(fake.timers.size).toBe(1);

        fake.visible = false;
        fake.visibilityListener?.();
        await settle();
        expect(check).toHaveBeenCalledTimes(1);
        expect(fake.timers.size).toBe(0);
        fake.visible = true;
        fake.visibilityListener?.();
        await settle();
        expect(check).toHaveBeenCalledTimes(2);
        expect(fake.timers.size).toBe(1);

        abort.abort();
        expect(fake.timers.size).toBe(0);
    });

    it('reconciles a publication after the fast window without any BroadcastChannel announcement', async () => {
        const fake = fakeRuntime(true);
        const channel = new CoreCatalogActivationChannel(fake.runtime);
        let published = false;
        let adopted = false;
        const check = jasmine.createSpy('checkActiveGeneration').and.callFake(() => {
            if (published) adopted = true;
        });
        const abort = new AbortController();
        channel.start({
            summaryVersion: 2,
            signal: abort.signal,
            checkActiveGeneration: check,
        });

        let elapsedMs = 0;
        for (let attempt = 0; attempt < CORE_CATALOG_ACTIVATION_MAX_POLL_ATTEMPTS; attempt += 1) {
            const timer = [...fake.timers.entries()][0];
            expect(timer).toBeDefined();
            expect(timer[1].delayMs).toBe(CORE_CATALOG_ACTIVATION_POLL_INTERVAL_MS);
            fake.timers.delete(timer[0]);
            elapsedMs += timer[1].delayMs;
            timer[1].callback();
        }
        await settle();
        expect(elapsedMs).toBe(CORE_CATALOG_ACTIVATION_MAX_POLL_ATTEMPTS * CORE_CATALOG_ACTIVATION_POLL_INTERVAL_MS);
        expect(adopted).toBeFalse();

        // Advance once beyond 300 seconds, publish durably, but deliberately
        // emit no BroadcastChannel hint. The next steady reread must adopt it.
        const beforePublication = [...fake.timers.entries()][0];
        expect(beforePublication[1].delayMs).toBe(CORE_CATALOG_ACTIVATION_STEADY_POLL_INTERVAL_MS);
        fake.timers.delete(beforePublication[0]);
        elapsedMs += beforePublication[1].delayMs;
        beforePublication[1].callback();
        await settle();
        expect(elapsedMs).toBeGreaterThan(
            CORE_CATALOG_ACTIVATION_MAX_POLL_ATTEMPTS * CORE_CATALOG_ACTIVATION_POLL_INTERVAL_MS,
        );
        expect(adopted).toBeFalse();

        published = true;
        const afterPublication = [...fake.timers.entries()][0];
        expect(afterPublication[1].delayMs).toBe(CORE_CATALOG_ACTIVATION_STEADY_POLL_INTERVAL_MS);
        fake.timers.delete(afterPublication[0]);
        afterPublication[1].callback();
        await settle();
        expect(adopted).toBeTrue();
        expect(fake.broadcast.posted).toEqual([]);
        expect([...fake.timers.values()][0].delayMs).toBe(CORE_CATALOG_ACTIVATION_STEADY_POLL_INTERVAL_MS);

        // Hidden tabs create no periodic churn. Becoming visible reconciles
        // immediately and resumes the low-frequency lifetime timer.
        fake.visible = false;
        fake.visibilityListener?.();
        expect(fake.timers.size).toBe(0);
        fake.visible = true;
        fake.visibilityListener?.();
        await settle();
        expect(fake.timers.size).toBe(1);
        expect([...fake.timers.values()][0].delayMs).toBe(CORE_CATALOG_ACTIVATION_STEADY_POLL_INTERVAL_MS);

        abort.abort();
        expect(fake.timers.size).toBe(0);
        expect(fake.visibilityListener).toBeUndefined();
    });
});
