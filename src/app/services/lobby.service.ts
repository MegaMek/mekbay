// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DestroyRef, computed, effect, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ForceAlignment } from '../models/force-slot.model';
import type { Force } from '../models/force.model';
import type { LobbyParticipant, LobbyState } from '../models/lobby.model';
import { DataService } from './data.service';
import { DialogsService } from './dialogs.service';
import { DisplayNameService } from './display-name.service';
import { ForceBuilderService } from './force-builder.service';
import { ToastService } from './toast.service';
import { WsService } from './ws.service';
import { normalizeDisplayName } from '../utils/display-name.util';

const LOBBY_CODE_PATTERN = /^[a-z0-9]{4}$/;
const MAX_LOBBY_PARTICIPANTS = 32;
const MAX_LOBBY_FORCES = 8;
const MAX_REMOTE_LOAD_ATTEMPTS = 8;

@Injectable({ providedIn: 'root' })
export class LobbyService {
    private readonly wsService = inject(WsService);
    private readonly dataService = inject(DataService);
    private readonly dialogsService = inject(DialogsService);
    private readonly displayNameService = inject(DisplayNameService);
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
    private lastPublishedForceKey: string | null = null;
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
        const unregisterClosed = this.wsService.registerMessageHandler('lobbyClosed', msg => {
            this.invalidateRestore();
            this.lobbyStateKnown.set(true);
            const message = msg.reason === 'inactivity'
                ? 'Operation lobby closed due to inactivity'
                : 'The lobby was closed.';
            void this.clearLobby(message);
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
            const remoteInstanceIds = new Set(
                state.participants
                    .filter(participant => !participant.self)
                    .flatMap(participant => participant.instanceIds),
            );
            for (const slot of slots) {
                if (slot.alignment === 'friendly' && slot.force.owned()
                    && slot.force.units().length > 0 && !slot.force.instanceId()) {
                    this.saveDraftForLobby(slot.force);
                }
            }
            const publishedInstanceIds = slots
                .filter(slot => slot.alignment === 'friendly')
                .map(slot => slot.force.instanceId())
                .filter((instanceId): instanceId is string => !!instanceId && !remoteInstanceIds.has(instanceId));
            if (publishedInstanceIds.length > MAX_LOBBY_FORCES && !this.forceLimitWarningShown) {
                this.forceLimitWarningShown = true;
                this.toastService.showToast(`A lobby supports up to ${MAX_LOBBY_FORCES} forces per participant.`, 'info');
            } else if (publishedInstanceIds.length <= MAX_LOBBY_FORCES) {
                this.forceLimitWarningShown = false;
            }
            if (!connected) return;

            const instanceIds = publishedInstanceIds.slice(0, MAX_LOBBY_FORCES).sort();
            const key = instanceIds.join('\n');
            if (key !== this.lastPublishedForceKey) {
                this.lastPublishedForceKey = key;
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
        let displayName = await this.displayNameService.current();
        if (!displayName) {
            const { CreateLobbyDialogComponent } = await import('../components/create-lobby-dialog/create-lobby-dialog.component');
            const ref = this.dialogsService.createDialog<string | null>(
                CreateLobbyDialogComponent,
                {
                    disableClose: true,
                    autoFocus: 'first-tabbable',
                    data: { displayName: await this.displayNameService.generate() },
                },
            );
            displayName = await firstValueFrom(ref.closed) ?? null;
            if (!displayName) return;
        }
        await this.displayNameService.save(displayName);
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

    async joinLobby(rawCode: string, requestedDisplayName?: string): Promise<void> {
        const code = rawCode.trim().toLowerCase();
        if (!LOBBY_CODE_PATTERN.test(code)) {
            throw new Error('Enter a valid 4-character lobby code.');
        }
        await this.displayNameService.save(requestedDisplayName ?? await this.displayNameService.currentOrGenerated());

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

    async promptAndJoin(): Promise<void> {
        if (this.hasLobby()) {
            await this.showLobbyDialog();
            return;
        }

        const { JoinLobbyDialogComponent } = await import('../components/join-lobby-dialog/join-lobby-dialog.component');
        const ref = this.dialogsService.createDialog<boolean | null>(
            JoinLobbyDialogComponent,
            {
                disableClose: true,
                autoFocus: 'first-tabbable',
                data: {
                    displayName: await this.displayNameService.currentOrGenerated(),
                    attemptJoin: (code: string, displayName: string) => this.joinLobby(code, displayName),
                },
            },
        );
        const joined = await firstValueFrom(ref.closed);
        if (joined) await this.showLobbyDialog();
    }

    async showLobbyDialog(): Promise<void> {
        if (!this.hasLobby()) return;
        const { LobbyDialogComponent } = await import('../components/lobby-dialog/lobby-dialog.component');
        this.dialogsService.createDialog(LobbyDialogComponent);
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
        const response = await this.wsService.sendAndWaitForResponse(payload, {
            suppressGlobalError: true,
        });
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
            const displayName = normalizeDisplayName(entry.displayName) ?? `Player ${entry.publicId.slice(0, 8)}`;
            participants.push({
                publicId: entry.publicId,
                displayName,
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
            const force = await this.dataService.getForce(instanceId, false, {
                skipLocal: true,
                showLoading: false,
            });
            if (!force) {
                shouldRetry = true;
                continue;
            }
            force.owned.set(false);
            const activate = this.forceBuilderService.loadedForces().length === 0;
            this.forceBuilderService.addLoadedForce(force, alignment, { activate, persistInUrl: false });
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
        this.lastPublishedForceKey = null;
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
