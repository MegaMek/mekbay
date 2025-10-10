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
 * MekBay is distributed in the hope that it will be useful,
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

import { inject, Injectable, signal } from '@angular/core';
import { UserStateService } from './userState.service';

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
    private ws: WebSocket | null = null;
    private wsUrl = 'wss://mekbay.com/ws';
    private wsReady?: Promise<void>;
    private wsReadyResolver: (() => void) | null = null;
    private wsSessionId = generateUUID();
    private subscriptions: Map<string, (data: any) => void> = new Map();

    public wsConnected = signal<boolean>(false);
    private userStateService = inject(UserStateService);

    private globalErrorHandler: ((message: string) => void) | null = null;

    public setGlobalErrorHandler(handler: (message: string) => void) {
        this.globalErrorHandler = handler;
    }

    constructor() {
        this.initWebSocket();
    }

    private initWebSocket() {
        if (!this.wsUrl) {
            this.cleanupWebSocket();
            return;
        }
        this.wsReady = new Promise((resolve) => {
            this.wsReadyResolver = resolve;
            this.connectWebSocket();
        });
    }

    private connectWebSocket() {
        if (!this.wsUrl) {
            this.cleanupWebSocket();
            return;
        }
        if (this.ws) this.ws.close();
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = async () => {
            this.wsConnected.set(true);
            this.resolveWsReady();
            const uuid = this.userStateService.uuid();
            this.send({ action: 'register', sessionId: this.wsSessionId, uuid });
        };

        this.ws.onclose = () => {
            this.wsConnected.set(false);
            setTimeout(() => this.connectWebSocket(), 3000);
        };

        this.ws.onerror = () => {
            this.wsConnected.set(false);
            if (this.ws) this.ws.close();
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.action === 'error' && this.globalErrorHandler) {
                    this.globalErrorHandler(msg.message || 'Unknown error');
                }
            } catch {
                // Ignore parse errors
            }
        };
    }

    private cleanupWebSocket() {
        if (this.ws) this.ws.close();
        this.ws = null;
        this.wsConnected.set(false);
        this.wsReady = Promise.resolve();
    }

    private resolveWsReady() {
        if (this.wsReadyResolver) {
            this.wsReadyResolver();
            this.wsReadyResolver = null;
        }
    }

    public async waitForWebSocket(): Promise<void> {
        const wsConnectTimeout = new Promise<void>((_, reject) =>
            setTimeout(() => reject('WebSocket connect timeout'), 2000)
        );
        await Promise.race([
            (async () => {
                while (!this.wsConnected()) await new Promise(res => setTimeout(res, 100));
            })(),
            wsConnectTimeout
        ]);
    }

    public getWebSocket(): WebSocket | null {
        return this.ws;
    }

    public getSessionId(): string {
        return this.wsSessionId;
    }

    public getWsReady(): Promise<void> | undefined {
        return this.wsReady;
    }

    public disconnectWebSocket() {
        this.cleanupWebSocket();
    }

    public send(payload: object): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const requestId = generateUUID();
        const message = { ...payload, sessionId: this.getSessionId(), requestId };
        this.ws.send(JSON.stringify(message));
    }

    public async sendAndWaitForResponse(payload: object): Promise<any | null> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return null;
        const requestId = generateUUID();
        const message = { ...payload, sessionId: this.getSessionId(), requestId };
        const ws = this.ws;
        ws.send(JSON.stringify(message));
        return new Promise<any | null>((resolve) => {
            let timeoutId: number | null = null;
            const handler = (event: MessageEvent) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.requestId === requestId) {
                        ws.removeEventListener('message', handler);
                        if (timeoutId) clearTimeout(timeoutId);
                        resolve(msg.data || null);
                    }
                } catch {
                    resolve(null);
                }
            };
            ws.addEventListener('message', handler);
            timeoutId = setTimeout(() => {
                ws.removeEventListener('message', handler);
                resolve(null); // Timeout fallback
            }, 5000);
        });
    }

    public async subscribe(instanceId: string, onRemoteUpdate: (data: string) => void): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        await this.unsubscribe(instanceId);
        const subscribePayload = {
            action: 'subscribe',
            instanceId,
        };
        this.send(subscribePayload);

        const handler = (event: MessageEvent) => {
            try {
                const msg = JSON.parse(event.data);
                if (
                    msg.action === 'update' &&
                    msg.data?.instanceId === instanceId
                ) {
                    onRemoteUpdate(msg.data);
                }
            } catch (e) {
                // Ignore parse errors
            }
        };
        this.ws.addEventListener('message', handler);
        this.subscriptions.set(instanceId, handler);
    }
    
    /**
     * Unsubscribes from WebSocket notifications for a specific instance.
     * @param instanceId The instance ID to unsubscribe from.
     */
    public async unsubscribe(instanceId: string): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const handler = this.subscriptions.get(instanceId);
        if (handler && this.ws) {
            const unsubscribePayload = {
                action: 'unsubscribe',
                instanceId,
            };
            this.ws.send(JSON.stringify(unsubscribePayload));
            this.ws.removeEventListener('message', handler);
            this.subscriptions.delete(instanceId);
        }
    }

    /**
     * Unsubscribes from all WebSocket notifications.
     */
    public unsubscribeAll(): void {
        this.subscriptions.forEach((_handler, instanceId) => {
            this.unsubscribe(instanceId);
        });
    }

}