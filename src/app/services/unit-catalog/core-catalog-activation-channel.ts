// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CatalogActivationId } from './unit-catalog.types';
import { uuidv4 } from '../../utils/uuid.util';

export const CORE_CATALOG_ACTIVATION_CHANNEL_NAME = 'mekbay-core-catalog-activation-v1';
export const CORE_CATALOG_ACTIVATION_HINT_SCHEMA_VERSION = 1;
export const CORE_CATALOG_ACTIVATION_POLL_INTERVAL_MS = 1_000;
export const CORE_CATALOG_ACTIVATION_MAX_POLL_ATTEMPTS = 300;
export const CORE_CATALOG_ACTIVATION_STEADY_POLL_INTERVAL_MS = 30_000;

export interface CoreCatalogActivationHintV1 {
    readonly kind: 'core-catalog-activated';
    readonly schemaVersion: typeof CORE_CATALOG_ACTIVATION_HINT_SCHEMA_VERSION;
    readonly senderId: string;
    readonly activationId: CatalogActivationId;
    readonly summaryVersion: number;
    readonly publishedAtEpochMs: number;
}

interface BroadcastChannelLike {
    postMessage(message: unknown): void;
    addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
    close(): void;
}

export interface CoreCatalogActivationRuntime {
    readonly createBroadcastChannel: (name: string) => BroadcastChannelLike | undefined;
    readonly addVisibilityListener: (listener: () => void) => () => void;
    readonly isVisible: () => boolean;
    readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
    readonly clearTimeout: (handle: unknown) => void;
    readonly now: () => number;
    readonly randomId: () => string;
}

export interface CoreCatalogActivationWatch {
    readonly summaryVersion: number;
    readonly signal: AbortSignal;
    /**
     * A hint never supplies catalog data. This callback must reread and verify
     * the fixed active-generation pointer in IndexedDB.
     */
    readonly checkActiveGeneration: () => void | Promise<void>;
}

/**
 * Cross-tab wake-up channel for a newly committed core generation.
 *
 * BroadcastChannel messages are deliberately treated as untrusted hints. The
 * receiver gets no payload from this class and can only react by rereading the
 * transactional active pointer. Visibility checks remain available even when
 * BroadcastChannel exists. A bounded fast-poll window covers startup races,
 * then a visible-only low-frequency reread guarantees eventual convergence
 * after any later missed message or leader death.
 */
export class CoreCatalogActivationChannel {
    private readonly runtime: CoreCatalogActivationRuntime;
    private readonly senderId: string;
    private broadcast?: BroadcastChannelLike;
    private messageListener?: (event: MessageEvent<unknown>) => void;
    private removeVisibilityListener?: () => void;
    private abortListener?: () => void;
    private pollTimer?: unknown;
    private pollAttempts = 0;
    private stopped = false;
    private checkRunning = false;
    private checkQueued = false;
    private watch?: CoreCatalogActivationWatch;

    public constructor(runtime: CoreCatalogActivationRuntime = browserActivationRuntime()) {
        this.runtime = runtime;
        this.senderId = runtime.randomId();
    }

    public start(watch: CoreCatalogActivationWatch): void {
        this.stop();
        if (watch.signal.aborted) return;

        this.stopped = false;
        this.watch = watch;
        this.abortListener = () => this.stop();
        watch.signal.addEventListener('abort', this.abortListener, { once: true });
        this.removeVisibilityListener = this.runtime.addVisibilityListener(() => {
            if (this.runtime.isVisible()) {
                this.requestVerifiedCheck();
                this.schedulePoll();
            } else {
                this.cancelPoll();
            }
        });

        this.broadcast = this.runtime.createBroadcastChannel(CORE_CATALOG_ACTIVATION_CHANNEL_NAME);
        if (this.broadcast) {
            this.messageListener = event => this.receive(event.data);
            this.broadcast.addEventListener('message', this.messageListener);
        }
        if (this.runtime.isVisible()) this.schedulePoll();
    }

    public announce(input: Omit<CoreCatalogActivationHintV1, 'kind' | 'schemaVersion' | 'senderId' | 'publishedAtEpochMs'>): void {
        if (this.stopped || !this.broadcast) return;
        const hint: CoreCatalogActivationHintV1 = Object.freeze({
            kind: 'core-catalog-activated',
            schemaVersion: CORE_CATALOG_ACTIVATION_HINT_SCHEMA_VERSION,
            senderId: this.senderId,
            activationId: input.activationId,
            summaryVersion: input.summaryVersion,
            publishedAtEpochMs: this.runtime.now(),
        });
        try {
            this.broadcast.postMessage(hint);
        } catch {
            // Best effort only. Visibility and polling still converge on IDB.
        }
    }

    public stop(): void {
        this.stopped = true;
        const watch = this.watch;
        if (watch && this.abortListener) {
            watch.signal.removeEventListener('abort', this.abortListener);
        }
        this.abortListener = undefined;
        this.watch = undefined;
        this.removeVisibilityListener?.();
        this.removeVisibilityListener = undefined;
        this.cancelPoll();
        if (this.broadcast && this.messageListener) {
            this.broadcast.removeEventListener('message', this.messageListener);
        }
        this.messageListener = undefined;
        this.broadcast?.close();
        this.broadcast = undefined;
        this.pollAttempts = 0;
        this.checkQueued = false;
    }

    private receive(value: unknown): void {
        const watch = this.watch;
        if (!watch || !isCoreCatalogActivationHintV1(value)) return;
        if (value.senderId === this.senderId
            || value.summaryVersion !== watch.summaryVersion) {
            return;
        }
        this.requestVerifiedCheck();
    }

    private schedulePoll(): void {
        if (this.stopped
            || this.pollTimer !== undefined
            || !this.runtime.isVisible()) {
            return;
        }
        const delayMs = this.pollAttempts < CORE_CATALOG_ACTIVATION_MAX_POLL_ATTEMPTS
            ? CORE_CATALOG_ACTIVATION_POLL_INTERVAL_MS
            : CORE_CATALOG_ACTIVATION_STEADY_POLL_INTERVAL_MS;
        this.pollTimer = this.runtime.setTimeout(() => {
            this.pollTimer = undefined;
            if (this.stopped || !this.runtime.isVisible()) return;
            if (this.pollAttempts < CORE_CATALOG_ACTIVATION_MAX_POLL_ATTEMPTS) {
                this.pollAttempts += 1;
            }
            this.requestVerifiedCheck();
            this.schedulePoll();
        }, delayMs);
    }

    private cancelPoll(): void {
        if (this.pollTimer === undefined) return;
        this.runtime.clearTimeout(this.pollTimer);
        this.pollTimer = undefined;
    }

    private requestVerifiedCheck(): void {
        const watch = this.watch;
        if (this.stopped || !watch || watch.signal.aborted) return;
        if (this.checkRunning) {
            this.checkQueued = true;
            return;
        }
        this.checkRunning = true;
        void Promise.resolve()
            .then(() => watch.checkActiveGeneration())
            .catch(() => undefined)
            .finally(() => {
                this.checkRunning = false;
                if (this.checkQueued) {
                    this.checkQueued = false;
                    this.requestVerifiedCheck();
                }
            });
    }
}

export function isCoreCatalogActivationHintV1(value: unknown): value is CoreCatalogActivationHintV1 {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Partial<CoreCatalogActivationHintV1>;
    return candidate.kind === 'core-catalog-activated'
        && candidate.schemaVersion === CORE_CATALOG_ACTIVATION_HINT_SCHEMA_VERSION
        && typeof candidate.senderId === 'string'
        && candidate.senderId.length > 0
        && typeof candidate.activationId === 'string'
        && candidate.activationId.length > 0
        && Number.isSafeInteger(candidate.summaryVersion)
        && (candidate.summaryVersion ?? 0) > 0
        && Number.isSafeInteger(candidate.publishedAtEpochMs)
        && (candidate.publishedAtEpochMs ?? -1) >= 0;
}

function browserActivationRuntime(): CoreCatalogActivationRuntime {
    return {
        createBroadcastChannel: name => {
            try {
                return typeof globalThis.BroadcastChannel === 'undefined'
                    ? undefined
                    : new globalThis.BroadcastChannel(name);
            } catch {
                return undefined;
            }
        },
        addVisibilityListener: listener => {
            if (typeof globalThis.document === 'undefined') return () => undefined;
            globalThis.document.addEventListener('visibilitychange', listener);
            return () => globalThis.document.removeEventListener('visibilitychange', listener);
        },
        isVisible: () => typeof globalThis.document === 'undefined'
            || globalThis.document.visibilityState !== 'hidden',
        setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
        clearTimeout: handle => globalThis.clearTimeout(
            handle as ReturnType<typeof globalThis.setTimeout>,
        ),
        now: () => Date.now(),
        randomId: uuidv4,
    };
}
