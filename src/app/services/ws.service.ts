/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MegaMek is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { effect, inject, Injectable, signal } from '@angular/core';
import { UserStateService } from './userState.service';
import { LoggerService } from './logger.service';
import { SerializedForce } from '../models/force-serialization';

/*
 * Author: Drake
 */

export function generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    // Fallback for non-secure contexts
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
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
    private readonly wsSessionId = generateUUID();
    private subscriptions = new Map<string, (event: MessageEvent) => void>();
    private actionHandlers = new Map<string, Set<(msg: any, event: MessageEvent) => void>>();
    
    // Connection state management
    private reconnectTimeoutId: number | null = null;
    private shouldReconnect = true;
    private isConnecting = false;
    private reconnectAttempt = 0;
    private readonly baseReconnectDelay = 1000;
    private readonly maxReconnectDelay = 15000;
    private readonly connectionTimeout = 3000;

    public wsConnected = signal<boolean>(false);
    private userStateService = inject(UserStateService);
    private globalErrorHandler: ((message: string) => void) | null = null;
    private lastRegisteredUuid = '';

    constructor() {
        this.initializeService();
        
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
        if (!this.wsConnected() && !this.isConnecting) {
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
    }

    /**
     * Connect to WebSocket server
     */
    private connect(): void {
        if (!this.wsUrl || this.isConnecting || (this.ws && this.ws.readyState === WebSocket.CONNECTING)) {
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
            this.scheduleReconnect();
        }
    }

    /**
     * Setup WebSocket event handlers
     */
    private setupWebSocketHandlers(): void {
        if (!this.ws) return;

        this.ws.onopen = () => this.handleOpen();
        this.ws.onclose = (event) => this.handleClose(event);
        this.ws.onerror = () => this.handleError();
        this.ws.onmessage = (event) => this.handleMessage(event);
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
        this.logger.info('WebSocket connected');
        this.isConnecting = false;
        this.reconnectAttempt = 0; // Reset backoff on successful connection
        this.wsConnected.set(true);
        this.resolveConnectionPromise();
        this.registerSession();
    }

    /**
     * Handle WebSocket close event
     */
    private handleClose(event: CloseEvent): void {
        this.logger.error(`WebSocket closed: ${event.code}, ${event.reason}`);
        this.isConnecting = false;
        this.wsConnected.set(false);

        // Only attempt reconnection if we should reconnect and network is online
        if (this.shouldReconnect && navigator.onLine) {
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
        const uuid = this.userStateService.uuid();
        this.lastRegisteredUuid = uuid;
        try {
            this.send({ action: 'register', sessionId: this.wsSessionId, uuid });
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
            requestId: generateUUID()
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
            console.warn('Cannot send: WebSocket not connected');
            return null;
        }

        const requestId = generateUUID();
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
    public async subscribeToForceUpdates(instanceId: string, onRemoteUpdate: (data: SerializedForce) => void): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('Cannot subscribe: WebSocket not connected');
            return;
        }

        // Unsubscribe from previous subscription if exists
        await this.unsubscribeFromForceUpdates(instanceId);

        // Setup message handler
        const handler = (event: MessageEvent) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.action === 'updatedForce' && msg.data?.instanceId === instanceId) {
                    onRemoteUpdate(msg.data as SerializedForce);
                }
            } catch {
                // Ignore parse errors
            }
        };

        this.ws.addEventListener('message', handler);
        this.subscriptions.set(instanceId, handler);

        // Send subscribe message
        this.send({
            action: 'subscribeToForceUpdates',
            instanceId
        });

    }

    /**
     * Unsubscribe from instance updates
     */
    public async unsubscribeFromForceUpdates(instanceId: string): Promise<void> {
        const handler = this.subscriptions.get(instanceId);
        if (!handler) return;

        this.subscriptions.delete(instanceId);

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

        if (this.ws) {
            this.ws.removeEventListener('message', handler);
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