// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { effect, inject, Injectable, signal } from '@angular/core';
import { UserStateService } from './userState.service';
import { LoggerService } from './logger.service';
import type { SerializedForce } from '../models/force-serialization';
import { APP_VERSION, BUILD_BRANCH, BUILD_COMMIT_NUMBER } from '../build-meta';
import { uuidv7 } from '../utils/uuid.util';

/** Client protocol version - increment when breaking changes are made */
export const PROTOCOL_VERSION = 2;

export type ConnectionStatusPhase = 'hidden' | 'offline' | 'online';
export type ForceUpdateSource = 'live' | 'reconnect';

interface ForceSubscription {
    onRemoteUpdate: (data: SerializedForce, source: ForceUpdateSource) => void | Promise<void>;
    handler: ((event: MessageEvent) => void) | null;
    socket: WebSocket | null;
    updateQueue: Promise<void>;
}

@Injectable({
    providedIn: 'root'
})
export class WsService {
    private logger = inject(LoggerService);
    private ws: WebSocket | null = null;
    private readonly wsUrl = 'wss://mekbay.com/ws';
    private wsReady?: Promise<void>;
    private wsReadyResolver: (() => void) | null = null;
    private readonly wsSessionId = uuidv7();
    private subscriptions = new Map<string, ForceSubscription>();
    private actionHandlers = new Map<string, Set<(msg: any, event: MessageEvent) => void>>();
    
    // Connection state management
    private reconnectTimeoutId: number | null = null;
    private shouldReconnect = true;
    private isConnecting = false;
    private reconnectAttempt = 0;
    private readonly baseReconnectDelay = 1000;
    private readonly maxReconnectDelay = 15000;
    private readonly connectionTimeout = 3000;
    private readonly connectionStatusHideDelay = 3500;
    private connectionStatusHideTimeoutId: number | null = null;
    private connectionStatusHasFailed = false;
    public readonly connectionStatusPhase = signal<ConnectionStatusPhase>('hidden');

    public wsConnected = signal<boolean>(false);
    private userStateService = inject(UserStateService);
    private globalErrorHandler: ((message: string) => void) | null = null;
    private lastRegisteredUuid = '';

    private getCurrentUuid(): string {
        return this.userStateService.uuid().trim();
    }

    constructor() {
        this.initializeService();
        this.setupUserStateHandler();
        
        // Watch for uuid - connect when available, re-register if uuid changes
        effect(() => {
            const uuid = this.userStateService.uuid();
            if (!uuid) return;
            
            if (!this.wsConnected() && !this.isConnecting) {
                // UUID available, not connected yet - connect now
                this.connect();
            } else if (uuid !== this.lastRegisteredUuid && this.wsConnected()) {
                // UUID changed while connected - re-register
                this.registerSession();
            }
        });
    }

    /**
     * Setup handler for userState responses from server
     */
    private setupUserStateHandler(): void {
        this.registerMessageHandler('userState', (msg) => {
            void this.userStateService.applyServerState({
                publicId: msg.publicId ?? null,
                hasOAuth: msg.hasOAuth,
                oauthProviderCount: msg.oauthProviderCount,
                oauthProviders: Array.isArray(msg.oauthProviders) ? msg.oauthProviders : undefined,
                availableAuthProviders: Array.isArray(msg.availableAuthProviders) ? msg.availableAuthProviders : undefined,
            });
        });
    }

    /**
     * Initialize the WebSocket service
     */
    private initializeService(): void {
        this.setupNetworkMonitoring();
        // Connection is triggered by the effect when uuid becomes available
    }

    /**
     * Setup network status monitoring
     */
    private setupNetworkMonitoring(): void {
        window.addEventListener('online', () => {
            this.handleNetworkOnline();
        });

        window.addEventListener('offline', () => {
            this.handleNetworkOffline();
        });
    }

    /**
     * Handle network coming back online
     */
    private handleNetworkOnline(): void {
        this.shouldReconnect = true;
        this.reconnectAttempt = 0; // Reset backoff when network returns
        if (!this.wsConnected() && !this.isConnecting && this.getCurrentUuid()) {
            this.clearReconnectTimer();
            this.scheduleReconnect();
        }
    }

    /**
     * Handle network going offline
     */
    private handleNetworkOffline(): void {
        this.wsConnected.set(false);
        this.clearReconnectTimer();
        this.showDisconnectedBadge();
    }

    /**
     * Connect to WebSocket server
     */
    private connect(): void {
        if (!this.wsUrl || !this.getCurrentUuid() || this.isConnecting || (this.ws && this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this.isConnecting = true;
        this.clearReconnectTimer();

        // Close existing connection if any
        if (this.ws) {
            this.closeWebSocket(false);
        }

        try {
            this.ws = new WebSocket(this.wsUrl);
            this.setupWebSocketHandlers();
            this.setupConnectionPromise();
        } catch (error) {
            this.logger.error(`Failed to create WebSocket: ${error}`);
            this.isConnecting = false;
            this.showDisconnectedBadge();
            this.scheduleReconnect();
        }
    }

    /**
     * Setup WebSocket event handlers
     */
    private setupWebSocketHandlers(): void {
        const socket = this.ws;
        if (!socket) return;

        socket.onopen = () => this.handleOpen();
        socket.onclose = (event) => this.handleClose(event, socket);
        socket.onerror = () => this.handleError();
        socket.onmessage = (event) => this.handleMessage(event);
    }

    /**
     * Setup connection promise
     */
    private setupConnectionPromise(): void {
        this.wsReady = new Promise((resolve) => {
            this.wsReadyResolver = resolve;
        });
    }

    /**
     * Handle WebSocket open event
     */
    private handleOpen(): void {
        const uuid = this.getCurrentUuid();
        if (!uuid) {
            this.logger.warn('WebSocket opened before uuid was available; closing and waiting for user state.');
            this.isConnecting = false;
            this.wsConnected.set(false);
            this.closeWebSocket(false);
            return;
        }

        this.logger.info('WebSocket connected');
        this.isConnecting = false;
        this.reconnectAttempt = 0; // Reset backoff on successful connection
        this.wsConnected.set(true);
        this.showReconnectedBadge();
        this.resolveConnectionPromise();
        this.registerSession();
        void this.resubscribeToForceUpdates();
    }

    /**
     * Handle WebSocket close event
     */
    private handleClose(event: CloseEvent, closedSocket: WebSocket | null = this.ws): void {
        this.logger.error(`WebSocket closed: ${event.code}, ${event.reason}`);
        if (closedSocket) {
            this.detachForceSubscriptions(closedSocket);
        }
        this.isConnecting = false;
        this.wsConnected.set(false);
        this.showDisconnectedBadge();

        // Only attempt reconnection if we should reconnect and network is online
        if (this.shouldReconnect && navigator.onLine && this.getCurrentUuid()) {
            this.scheduleReconnect();
        }
    }

    /**
     * Handle WebSocket error event
     */
    private handleError(): void {
        this.logger.error('WebSocket error occurred');
        this.isConnecting = false;
        this.wsConnected.set(false);
        this.showDisconnectedBadge();
    }

    /**
     * Handle incoming WebSocket messages
     */
    private handleMessage(event: MessageEvent): void {
        let msg: any;
        try {
            msg = JSON.parse(event.data);
        } catch {
            return;
        }

        if (msg?.action === 'error' && this.globalErrorHandler) {
            this.globalErrorHandler(msg.message || 'Unknown error');
        }

        const action = msg?.action;
        if (!action) {
            return;
        }
        // Dispatch to specific action handlers
        const handlers = this.actionHandlers.get(action);
        if (handlers) {
            handlers.forEach(h => {
                try {
                    h(msg, event);
                } catch (err) {
                    this.logger.error(`Action handler error for "${action}": ${err}`);
                }
            });
        }

        // Wildcard handlers (optional global listeners)
        const wildcardHandlers = this.actionHandlers.get('*');
        if (wildcardHandlers) {
            wildcardHandlers.forEach(h => {
                try {
                    h(msg, event);
                } catch (err) {
                    this.logger.error(`Wildcard handler error: ${err}`);
                }
            });
        }
    }

    /**
     * Register this session with the server
     */
    private registerSession(): void {
        const uuid = this.getCurrentUuid();
        if (!uuid) {
            this.logger.warn('Skipping WebSocket registration because uuid is not available.');
            return;
        }
        this.lastRegisteredUuid = uuid;
        try {
            this.send({
                action: 'register',
                sessionId: this.wsSessionId,
                uuid,
                version: PROTOCOL_VERSION,
                appVersion: APP_VERSION,
                buildBranch: BUILD_BRANCH,
                buildCommitNumber: BUILD_COMMIT_NUMBER,
            });
        } catch (error) {
            this.logger.error(`Failed to register session: ${error}`);
        }
    }

    /**
     * Calculate reconnect delay with exponential backoff and jitter
     */
    private getReconnectDelay(): number {
        // Exponential backoff: 1s, 1.8s, 3.24s, etc., capped at maxReconnectDelay
        const exponentialDelay = Math.min(
            this.baseReconnectDelay * Math.pow(1.8, this.reconnectAttempt),
            this.maxReconnectDelay
        );
        // Add random jitter (0-50% of delay) to prevent thundering herd
        const jitter = Math.random() * exponentialDelay * 0.5;
        return Math.floor(exponentialDelay + jitter);
    }

    /**
     * Schedule a reconnection attempt
     */
    private scheduleReconnect(): void {
        if (!this.getCurrentUuid()) {
            this.logger.info('Skipping reconnect scheduling because uuid is not available yet.');
            return;
        }
        this.clearReconnectTimer();
        const delay = this.getReconnectDelay();
        this.reconnectAttempt++;
        this.logger.info(`Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`);
        this.reconnectTimeoutId = window.setTimeout(() => {
            this.connect();
        }, delay);
    }

    /**
     * Clear reconnection timer
     */
    private clearReconnectTimer(): void {
        if (this.reconnectTimeoutId !== null) {
            clearTimeout(this.reconnectTimeoutId);
            this.reconnectTimeoutId = null;
        }
    }

    private showDisconnectedBadge(): void {
        this.connectionStatusHasFailed = true;
        this.clearConnectionStatusHideTimer();
        this.connectionStatusPhase.set('offline');
    }

    private showReconnectedBadge(): void {
        if (!this.connectionStatusHasFailed) {
            return;
        }

        this.clearConnectionStatusHideTimer();
        this.connectionStatusPhase.set('online');
        this.connectionStatusHideTimeoutId = window.setTimeout(() => {
            this.connectionStatusHideTimeoutId = null;
            if (this.wsConnected()) {
                this.connectionStatusPhase.set('hidden');
            }
        }, this.connectionStatusHideDelay);
    }

    private clearConnectionStatusHideTimer(): void {
        if (this.connectionStatusHideTimeoutId !== null) {
            clearTimeout(this.connectionStatusHideTimeoutId);
            this.connectionStatusHideTimeoutId = null;
        }
    }

    private hideConnectionStatusBadge(): void {
        this.clearConnectionStatusHideTimer();
        this.connectionStatusPhase.set('hidden');
    }

    /**
     * Close WebSocket connection
     */
    private closeWebSocket(permanent: boolean): void {
        if (!this.ws) {
            if (permanent) {
                this.shouldReconnect = false;
                this.clearReconnectTimer();
            }
            return;
        }
        this.detachForceSubscriptions(this.ws);
        // Remove event handlers to prevent them from firing
        this.ws.onopen = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;

        try {
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close();
            }
        } catch (error) {
            this.logger.error(`Error closing WebSocket: ${error}`);
        } finally {
            this.ws = null;
        }

        if (permanent) {
            this.shouldReconnect = false;
            this.clearReconnectTimer();
        }
    }

    /**
     * Resolve the connection promise
     */
    private resolveConnectionPromise(): void {
        if (this.wsReadyResolver) {
            this.wsReadyResolver();
            this.wsReadyResolver = null;
        }
    }

    /**
     * Wait for WebSocket to be connected
     */
    public async waitForWebSocket(): Promise<void> {
        const timeout = new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('WebSocket connect timeout')), this.connectionTimeout)
        );

        await Promise.race([
            (async () => {
                while (!this.wsConnected()) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            })(),
            timeout
        ]);
    }

    /**
     * Set global error handler
     */
    public setGlobalErrorHandler(handler: (message: string) => void): void {
        this.globalErrorHandler = handler;
    }

    /**
     * Get WebSocket instance
     */
    public getWebSocket(): WebSocket | null {
        return this.ws;
    }

    /**
     * Get session ID
     */
    public getSessionId(): string {
        return this.wsSessionId;
    }

    public getHttpBaseUrl(): string {
        const parsedUrl = new URL(this.wsUrl);
        parsedUrl.protocol = parsedUrl.protocol === 'wss:' ? 'https:' : 'http:';
        return parsedUrl.origin;
    }

    /**
     * Get connection ready promise
     */
    public getWsReady(): Promise<void> | undefined {
        return this.wsReady;
    }

    /**
     * Permanently disconnect WebSocket
     */
    public disconnectWebSocket(): void {
        this.closeWebSocket(true);
        this.wsConnected.set(false);
        this.wsReady = Promise.resolve();
        this.hideConnectionStatusBadge();
    }

    /**
     * Send a message through WebSocket
     */
    public send(payload: object): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.logger.warn('Cannot send: WebSocket not connected');
            return;
        }

        const message = {
            ...payload,
            sessionId: this.wsSessionId,
            requestId: uuidv7()
        };
        try {
            this.ws.send(JSON.stringify(message));
        } catch (error) {
            this.logger.error(`Failed to send message: ${error}`);
        }
    }

    /**
     * Send a message and wait for response
     */
    public async sendAndWaitForResponse(payload: object, timeout: number = 5000): Promise<any | null> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.logger.warn('Cannot send: WebSocket not connected');
            return null;
        }

        const requestId = uuidv7();
        const message = {
            ...payload,
            sessionId: this.wsSessionId,
            requestId
        };

        const ws = this.ws;

        return new Promise<any | null>((resolve) => {
            let timeoutId: number | null = null;

            const handler = (event: MessageEvent) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.requestId === requestId) {
                        cleanup();
                        resolve(msg);
                    }
                } catch {
                    // Ignore parse errors
                }
            };

            const cleanup = () => {
                ws.removeEventListener('message', handler);
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                }
            };

            ws.addEventListener('message', handler);

            timeoutId = window.setTimeout(() => {
                cleanup();
                resolve(null);
            }, timeout);

            try {
                ws.send(JSON.stringify(message));
            } catch (error) {
                this.logger.error(`Failed to send message: ${error}`);
                cleanup();
                resolve(null);
            }
        });
    }

    /**
     * Subscribe to instance updates
     */
    public async subscribeToForceUpdates(
        instanceId: string,
        onRemoteUpdate: (data: SerializedForce, source: ForceUpdateSource) => void | Promise<void>,
    ): Promise<void> {
        // Unsubscribe from previous subscription if exists
        await this.unsubscribeFromForceUpdates(instanceId);

        this.subscriptions.set(instanceId, {
            onRemoteUpdate,
            handler: null,
            socket: null,
            updateQueue: Promise.resolve(),
        });
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.logger.warn('Cannot subscribe: WebSocket not connected; will subscribe after reconnect');
            return;
        }

        this.attachForceSubscription(instanceId);
    }

    /**
     * Unsubscribe from instance updates
     */
    public async unsubscribeFromForceUpdates(instanceId: string): Promise<void> {
        const subscription = this.subscriptions.get(instanceId);
        if (!subscription) return;

        this.subscriptions.delete(instanceId);

        if (subscription.socket && subscription.handler) {
            subscription.socket.removeEventListener('message', subscription.handler);
        }

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.send({
                    action: 'unsubscribeFromForceUpdates',
                    instanceId
                });
            } catch (error) {
                this.logger.error(`Failed to send unsubscribe message: ${error}`);
            }
        }

    }

    /**
     * Unsubscribe from all instance updates
     */
    public unsubscribeAllForForceUpdates(): void {
        const instanceIds = Array.from(this.subscriptions.keys());
        instanceIds.forEach(instanceId => {
            this.unsubscribeFromForceUpdates(instanceId);
        });
    }

    private attachForceSubscription(instanceId: string): void {
        const subscription = this.subscriptions.get(instanceId);
        const socket = this.ws;
        if (!subscription || !socket || socket.readyState !== WebSocket.OPEN) {
            return;
        }

        if (subscription.socket === socket && subscription.handler) {
            return;
        }

        if (subscription.socket && subscription.handler) {
            subscription.socket.removeEventListener('message', subscription.handler);
        }

        const handler = (event: MessageEvent) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.action === 'updatedForce' && msg.data?.instanceId === instanceId) {
                    void this.notifyForceSubscription(subscription, msg.data as SerializedForce, 'live', instanceId);
                }
            } catch {
                // Ignore parse errors
            }
        };

        socket.addEventListener('message', handler);
        subscription.handler = handler;
        subscription.socket = socket;
        this.send({
            action: 'subscribeToForceUpdates',
            instanceId,
        });
    }

    private async resubscribeToForceUpdates(): Promise<void> {
        const socket = this.ws;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return;
        }

        const reconnectSubscriptions: Array<{
            instanceId: string;
            subscription: ForceSubscription;
        }> = [];

        for (const instanceId of this.subscriptions.keys()) {
            const subscription = this.subscriptions.get(instanceId);
            if (!subscription) {
                continue;
            }

            this.attachForceSubscription(instanceId);
            reconnectSubscriptions.push({ instanceId, subscription });
        }

        await Promise.all(reconnectSubscriptions.map(({ instanceId, subscription }) => {
            if (this.ws !== socket) {
                return Promise.resolve();
            }
            return this.refreshForceSubscription(instanceId, subscription, socket);
        }));
    }

    private async refreshForceSubscription(
        instanceId: string,
        subscription: ForceSubscription,
        socket: WebSocket,
    ): Promise<void> {
        try {
            const response = await this.sendAndWaitForResponse({
                action: 'getForce',
                instanceId,
            });

            if (this.ws !== socket || this.subscriptions.get(instanceId) !== subscription) {
                return;
            }

            const data = response?.data;
            if (data?.instanceId === instanceId) {
                await this.notifyForceSubscription(subscription, data as SerializedForce, 'reconnect', instanceId);
            }
        } catch (error) {
            this.logger.error(`Failed to refresh force subscription ${instanceId}: ${error}`);
        }
    }

    private notifyForceSubscription(
        subscription: ForceSubscription,
        data: SerializedForce,
        source: ForceUpdateSource,
        instanceId: string,
    ): Promise<void> {
        const update = subscription.updateQueue
            .then(() => subscription.onRemoteUpdate(data, source))
            .catch(error => {
                this.logger.error(`Force update handler error for ${instanceId}: ${error}`);
            });
        subscription.updateQueue = update;
        return update;
    }

    private detachForceSubscriptions(socket: WebSocket): void {
        for (const subscription of this.subscriptions.values()) {
            if (subscription.socket !== socket) {
                continue;
            }
            if (subscription.handler) {
                socket.removeEventListener('message', subscription.handler);
            }
            subscription.handler = null;
            subscription.socket = null;
        }
    }

    public registerMessageHandler(actions: string | string[], handler: (msg: any, event: MessageEvent) => void): () => void {
        const list = Array.isArray(actions) ? actions : [actions];
        list.forEach(action => {
            let set = this.actionHandlers.get(action);
            if (!set) {
                set = new Set();
                this.actionHandlers.set(action, set);
            }
            set.add(handler);
        });
        // Unsubscribe closure
        return () => {
            list.forEach(action => {
                const set = this.actionHandlers.get(action);
                if (set) {
                    set.delete(handler);
                    if (set.size === 0) {
                        this.actionHandlers.delete(action);
                    }
                }
            });
        };
    }

    public clearHandlersForAction(action: string): void {
        this.actionHandlers.delete(action);
    }

    public clearAllMessageHandlers(): void {
        this.actionHandlers.clear();
    }
}