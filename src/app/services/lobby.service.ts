// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DestroyRef, computed, effect, inject, Injectable, signal } from '@angular/core';
import type { ForceAlignment } from '../models/force-slot.model';
import type { Force } from '../models/force.model';
import type { LobbyParticipant, LobbyState } from '../models/lobby.model';
import { DataService } from './data.service';
import { DialogsService } from './dialogs.service';
import { ForceBuilderService } from './force-builder.service';
import { ToastService } from './toast.service';
import { WsService } from './ws.service';

const LOBBY_CODE_PATTERN = /^[a-z0-9]{4}$/;
const MAX_LOBBY_PARTICIPANTS = 16;
const MAX_LOBBY_FORCES = 8;
const MAX_REMOTE_LOAD_ATTEMPTS = 8;

@Injectable({ providedIn: 'root' })
export class LobbyService {
    private readonly wsService = inject(WsService);
    private readonly dataService = inject(DataService);
    private readonly dialogsService = inject(DialogsService);
    private readonly forceBuilderService = inject(ForceBuilderService);
    private readonly toastService = inject(ToastService);

    readonly state = signal<LobbyState | null>(null);
    readonly hasLobby = computed(() => this.state() !== null);
    readonly isHost = computed(() => this.state()?.isHost === true);
    readonly canCreateOrJoin = computed(() => (
        this.lobbyStateKnown()
        && !this.hasLobby()
        && this.wsService.wsConnected()
    ));

    private readonly lobbyStateKnown = signal(false);
    private readonly managedRemoteIds = new Set<string>();
    private readonly remoteLoadAttempts = new Map<string, number>();
    private readonly pendingDraftSaves = new WeakSet<Force>();
    private reconcileQueue = Promise.resolve();
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private lastOwnedForceKey: string | null = null;
    private forceLimitWarningShown = false;
    private restoreVersion = 0;

    constructor() {
        const unregisterState = this.wsService.registerMessageHandler('lobbyState', msg => {
            const state = this.parseState(msg);
            if (!state) return;
            this.invalidateRestore();
            this.applyState(state);
            this.lobbyStateKnown.set(true);
        });
        const unregisterClosed = this.wsService.registerMessageHandler('lobbyClosed', () => {
            this.invalidateRestore();
            this.lobbyStateKnown.set(true);
            void this.clearLobby('The lobby was closed.');
        });
        const unregisterKicked = this.wsService.registerMessageHandler('lobbyKicked', () => {
            this.invalidateRestore();
            this.lobbyStateKnown.set(true);
            void this.clearLobby('You were removed from the lobby.');
        });
        const unregisterResume = this.wsService.registerMessageHandler('lobbyResumeResult', msg => {
            if (msg.resumed !== true && this.state()) {
                this.invalidateRestore();
                this.lobbyStateKnown.set(true);
                void this.clearLobby('The lobby is no longer available.');
            } else if (msg.resumed !== true) {
                this.lobbyStateKnown.set(true);
            } else if (this.state()) {
                this.lobbyStateKnown.set(true);
            }
        });

        effect(() => {
            if (!this.wsService.wsConnected()) {
                this.lobbyStateKnown.set(false);
                return;
            }
            void this.restoreLobbyState();
        });

        effect(() => {
            const state = this.state();
            const connected = this.wsService.wsConnected();
            const slots = this.forceBuilderService.loadedForces();
            if (!state) return;

            this.queueReconcile();
            for (const slot of slots) {
                if (slot.alignment === 'friendly' && slot.force.owned()
                    && slot.force.units().length > 0 && !slot.force.instanceId()) {
                    this.saveDraftForLobby(slot.force);
                }
            }
            const ownedInstanceIds = slots
                .filter(slot => slot.alignment === 'friendly' && slot.force.owned())
                .map(slot => slot.force.instanceId())
                .filter((instanceId): instanceId is string => !!instanceId);
            if (ownedInstanceIds.length > MAX_LOBBY_FORCES && !this.forceLimitWarningShown) {
                this.forceLimitWarningShown = true;
                this.toastService.showToast(`A lobby supports up to ${MAX_LOBBY_FORCES} forces per participant.`, 'info');
            } else if (ownedInstanceIds.length <= MAX_LOBBY_FORCES) {
                this.forceLimitWarningShown = false;
            }
            if (!connected) return;

            const instanceIds = ownedInstanceIds.slice(0, MAX_LOBBY_FORCES).sort();
            const key = instanceIds.join('\n');
            if (key !== this.lastOwnedForceKey) {
                this.lastOwnedForceKey = key;
                this.wsService.send({ action: 'syncLobbyForces', instanceIds });
            }
        });

        inject(DestroyRef).onDestroy(() => {
            unregisterState();
            unregisterClosed();
            unregisterKicked();
            unregisterResume();
            if (this.retryTimer) clearTimeout(this.retryTimer);
        });
    }

    async createLobby(): Promise<void> {
        this.invalidateRestore();
        this.lobbyStateKnown.set(false);
        try {
            const response = await this.request({ action: 'createLobby' });
            if (response.action !== 'lobbyCreated') {
                throw new Error('The lobby could not be created.');
            }
            const state = this.parseState(response.state);
            if (!state) throw new Error('The server returned an invalid lobby.');
            this.applyState(state);
        } finally {
            this.lobbyStateKnown.set(true);
        }
    }

    async joinLobby(rawCode: string): Promise<void> {
        const code = rawCode.trim().toLowerCase();
        if (!LOBBY_CODE_PATTERN.test(code)) {
            throw new Error('Enter a valid 4-character lobby code.');
        }

        this.invalidateRestore();
        this.lobbyStateKnown.set(false);
        try {
            const response = await this.request({ action: 'joinLobby', code });
            if (response.action !== 'lobbyJoined') {
                throw new Error('The lobby could not be joined.');
            }
            const state = this.parseState(response.state);
            if (!state) throw new Error('The server returned an invalid lobby.');
            this.applyState(state);
        } finally {
            this.lobbyStateKnown.set(true);
        }
    }

    leaveLobby(): void {
        if (!this.state()) return;
        this.invalidateRestore();
        this.wsService.send({ action: 'leaveLobby' });
        this.lobbyStateKnown.set(true);
        void this.clearLobby();
    }

    async confirmAndLeave(): Promise<boolean> {
        if (!this.state()) return false;
        const confirmed = await this.dialogsService.requestConfirmation(
            'Leave this lobby?',
            'Leave Lobby',
            'warning',
        );
        if (confirmed) this.leaveLobby();
        return confirmed;
    }

    setAlignment(publicId: string, alignment: ForceAlignment): void {
        const participant = this.state()?.participants.find(entry => entry.publicId === publicId);
        if (!participant || participant.self) return;
        this.wsService.send({ action: 'setLobbyAlignment', publicId, alignment });
    }

    setLocked(locked: boolean): void {
        if (!this.isHost()) return;
        this.wsService.send({ action: 'setLobbyLock', locked });
    }

    kick(publicId: string): void {
        const participant = this.state()?.participants.find(entry => entry.publicId === publicId);
        if (!this.isHost() || !participant || participant.self) return;
        this.wsService.send({ action: 'kickLobbyParticipant', publicId });
    }

    private async request(payload: object): Promise<any> {
        if (!this.wsService.wsConnected()) {
            throw new Error('The server is not connected.');
        }
        const response = await this.wsService.sendAndWaitForResponse(payload);
        if (!response) throw new Error('The server did not respond.');
        if (response.action === 'error') throw new Error(response.message || 'Lobby request failed.');
        return response;
    }

    private invalidateRestore(): void {
        this.restoreVersion += 1;
    }

    private async restoreLobbyState(): Promise<void> {
        const version = ++this.restoreVersion;
        this.lobbyStateKnown.set(false);
        const response = await this.wsService.sendAndWaitForResponse({ action: 'getLobbyState' });
        if (version !== this.restoreVersion || response?.action !== 'lobbyStateResult') return;

        if (response.state === null) {
            await this.clearLobby();
        } else {
            const state = this.parseState(response.state);
            if (!state) return;
            this.applyState(state);
        }
        if (version === this.restoreVersion) this.lobbyStateKnown.set(true);
    }

    private applyState(state: LobbyState): void {
        this.state.set(state);
        this.queueReconcile();
    }

    private saveDraftForLobby(force: Force): void {
        if (this.pendingDraftSaves.has(force)) return;
        this.pendingDraftSaves.add(force);
        void this.dataService.saveForce(force)
            .catch(() => this.toastService.showToast('A force could not be added to the lobby.', 'error'))
            .finally(() => this.pendingDraftSaves.delete(force));
    }

    private parseState(value: any): LobbyState | null {
        if (!value || !LOBBY_CODE_PATTERN.test(value.code) || typeof value.locked !== 'boolean'
            || typeof value.isHost !== 'boolean' || !Array.isArray(value.participants)
            || value.participants.length > MAX_LOBBY_PARTICIPANTS) {
            return null;
        }

        const participants: LobbyParticipant[] = [];
        for (const entry of value.participants) {
            if (!entry || typeof entry.publicId !== 'string' || entry.publicId.length === 0 || entry.publicId.length > 128
                || typeof entry.self !== 'boolean' || typeof entry.host !== 'boolean'
                || typeof entry.connected !== 'boolean'
                || (entry.alignment !== 'friendly' && entry.alignment !== 'enemy')
                || !Array.isArray(entry.instanceIds) || entry.instanceIds.length > MAX_LOBBY_FORCES
                || !entry.instanceIds.every((id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 128)) {
                return null;
            }
            participants.push({
                publicId: entry.publicId,
                self: entry.self,
                host: entry.host,
                connected: entry.connected,
                alignment: entry.alignment,
                instanceIds: [...new Set<string>(entry.instanceIds)],
            });
        }
        if (participants.filter(participant => participant.self).length !== 1) return null;

        return { code: value.code, locked: value.locked, isHost: value.isHost, participants };
    }

    private queueReconcile(): void {
        this.reconcileQueue = this.reconcileQueue
            .then(() => this.reconcileForces())
            .catch(() => undefined);
    }

    private async reconcileForces(): Promise<void> {
        const state = this.state();
        if (!state) return;

        const remoteAlignments = new Map<string, ForceAlignment>();
        for (const participant of state.participants) {
            if (participant.self) continue;
            for (const instanceId of participant.instanceIds) {
                remoteAlignments.set(instanceId, participant.alignment);
            }
        }

        let unloadedHostile = false;
        for (const slot of [...this.forceBuilderService.loadedForces()]) {
            if (slot.alignment !== 'enemy') continue;
            const instanceId = slot.force.instanceId();
            const isLobbyForce = !slot.force.owned() && !!instanceId && remoteAlignments.has(instanceId);
            if (isLobbyForce) continue;

            try {
                if (slot.force.owned() && slot.force.units().length > 0) {
                    await this.dataService.saveForce(slot.force);
                }
                await this.forceBuilderService.removeLoadedForce(slot.force, { skipPrompt: true });
                unloadedHostile = true;
            } catch {
                this.toastService.showToast('A hostile force could not be saved and unloaded.', 'error');
            }
        }
        if (unloadedHostile) {
            this.toastService.showToast('Locally loaded hostile forces were unloaded in lobby mode.', 'info');
        }

        for (const instanceId of [...this.managedRemoteIds]) {
            if (remoteAlignments.has(instanceId)) continue;
            const slot = this.forceBuilderService.loadedForces()
                .find(entry => entry.force.instanceId() === instanceId && !entry.force.owned());
            if (slot) {
                await this.forceBuilderService.removeLoadedForce(slot.force, { skipPrompt: true });
            }
            this.managedRemoteIds.delete(instanceId);
            this.remoteLoadAttempts.delete(instanceId);
        }

        this.forceBuilderService.loadedForces.update(slots => {
            let changed = false;
            const aligned = slots.map(slot => {
                const instanceId = slot.force.instanceId();
                const alignment = slot.force.owned()
                    ? 'friendly'
                    : instanceId ? remoteAlignments.get(instanceId) : undefined;
                if (!alignment || alignment === slot.alignment) return slot;
                changed = true;
                return { ...slot, alignment };
            });
            return changed ? aligned : slots;
        });

        let shouldRetry = false;
        for (const [instanceId, alignment] of remoteAlignments) {
            const existing = this.forceBuilderService.loadedForces()
                .find(entry => entry.force.instanceId() === instanceId);
            if (existing) {
                if (!existing.force.owned()) this.managedRemoteIds.add(instanceId);
                this.remoteLoadAttempts.delete(instanceId);
                continue;
            }

            const attempts = this.remoteLoadAttempts.get(instanceId) ?? 0;
            if (attempts >= MAX_REMOTE_LOAD_ATTEMPTS) continue;
            this.remoteLoadAttempts.set(instanceId, attempts + 1);
            const force = await this.dataService.getForce(instanceId);
            if (!force) {
                shouldRetry = true;
                continue;
            }
            force.owned.set(false);
            await this.forceBuilderService.addForce(force, alignment, { activate: false });
            this.managedRemoteIds.add(instanceId);
            this.remoteLoadAttempts.delete(instanceId);
        }

        if (shouldRetry && !this.retryTimer) {
            this.retryTimer = setTimeout(() => {
                this.retryTimer = null;
                this.queueReconcile();
            }, 1000);
        }
    }

    private async clearLobby(message?: string): Promise<void> {
        if (!this.state() && this.managedRemoteIds.size === 0) return;
        this.state.set(null);
        this.lastOwnedForceKey = null;
        this.forceLimitWarningShown = false;
        this.remoteLoadAttempts.clear();
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }

        for (const instanceId of [...this.managedRemoteIds]) {
            const slot = this.forceBuilderService.loadedForces()
                .find(entry => entry.force.instanceId() === instanceId && !entry.force.owned());
            if (slot) await this.forceBuilderService.removeLoadedForce(slot.force, { skipPrompt: true });
        }
        this.managedRemoteIds.clear();
        if (message) this.toastService.showToast(message, 'info');
    }
}
