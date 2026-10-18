// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DestroyRef, computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CBT_RULESET_LABELS, type CBTRuleset } from '../models/cbt-ruleset.model';
import type { ForceAlignment } from '../models/force-slot.model';
import type { Force } from '../models/force.model';
import type { LobbyGameSettings, LobbyParticipant, LobbyState } from '../models/lobby.model';
import type { InitiativeRecord } from '../models/rules/initiative-rules';
import { ForcePersistenceService } from './force-persistence.service';
import { DialogsService } from './dialogs.service';
import { DisplayNameService } from './display-name.service';
import { ForceBuilderService } from './force-builder.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { OptionsService } from './options.service';
import { ToastService } from './toast.service';
import { WsService, type WsMessage } from './ws.service';

const LOBBY_CODE_PATTERN = /^[a-z0-9]{4}$/;
const MAX_LOBBY_FORCES = 8;
const MAX_REMOTE_LOAD_ATTEMPTS = 8;

type LobbyWireState = WsMessage & LobbyState & { readonly action: 'lobbyState' };
type LobbyCreatedResponse = WsMessage & { readonly action: 'lobbyCreated'; readonly state: LobbyWireState };
type LobbyJoinedResponse = WsMessage & { readonly action: 'lobbyJoined'; readonly state: LobbyWireState };
type LobbyStateResponse = WsMessage & {
    readonly action: 'lobbyStateResult';
    readonly state: LobbyWireState | null;
};
type LobbyErrorResponse = WsMessage & { readonly action: 'error'; readonly message?: string };

@Injectable({ providedIn: 'root' })
export class LobbyService {
    private readonly wsService = inject(WsService);
    private readonly forcePersistence = inject(ForcePersistenceService);
    private readonly dialogsService = inject(DialogsService);
    private readonly displayNameService = inject(DisplayNameService);
    private readonly forceBuilderService = inject(ForceBuilderService);
    private readonly forceWorkspace = inject(ForceWorkspaceStateService);
    private readonly toastService = inject(ToastService);
    private readonly optionsService = inject(OptionsService);

    readonly state = signal<LobbyState | null>(null);
    readonly hasLobby = computed(() => this.state() !== null);
    readonly isHost = computed(() => this.state()?.isHost === true);
    /** The lobby's game settings, which take precedence over the local options while in a lobby. */
    readonly settings = computed(() => this.state()?.settings ?? null);
    /** The current turn's Initiative, decided by the host. */
    readonly initiative = computed(() => this.state()?.initiative ?? null);

    /** The other lobby participant who publishes a force, if any. */
    publisherOf(instanceId: string): LobbyParticipant | null {
        return this.state()?.participants.find(participant =>
            !participant.self && participant.instanceIds.includes(instanceId)) ?? null;
    }
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
    /**
     * The newest lobby state whose rules this player does not play yet. It waits, with nothing new
     * of theirs sent to the lobby, until they play those rules or decline and leave.
     */
    private readonly heldState = signal<LobbyState | null>(null);
    /** Joins waiting for the held state: true once it applies, false when the player did not join. */
    private heldStateWaiters: ((applied: boolean) => void)[] = [];
    private readonly adoptingRuleset = signal(false);
    private readonly hostSwitchingRuleset = signal(false);
    /** This player's forces are switching rules; the lobby settings wait until they play the new ones. */
    readonly switchingRuleset = computed(() => this.adoptingRuleset() || this.hostSwitchingRuleset());
    /** The lobby this player declined; its late broadcasts are ignored until they join or create again. */
    private declinedCode: string | null = null;

    constructor() {
        const unregisterState = this.wsService.registerMessageHandler<LobbyWireState>('lobbyState', state => {
            this.invalidateRestore();
            this.applyState(state);
            this.lobbyStateKnown.set(true);
        });
        const unregisterClosed = this.wsService.registerMessageHandler('lobbyClosed', msg => {
            this.invalidateRestore();
            this.lobbyStateKnown.set(true);
            const message = msg['reason'] === 'inactivity'
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
            const failureMessage = typeof msg['message'] === 'string'
                ? msg['message']
                : 'The lobby is no longer available.';
            if (msg['resumed'] !== true && this.state()) {
                this.invalidateRestore();
                this.lobbyStateKnown.set(true);
                void this.clearLobby(failureMessage);
            } else if (msg['resumed'] !== true) {
                this.lobbyStateKnown.set(true);
                if (msg['code'] === 'lobby_force_revision_mismatch') {
                    this.toastService.showToast(failureMessage, 'error');
                }
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

        // Everyone in a lobby plays its rules. Once the local options are known, a held state with
        // other rules is adopted first; one with the same rules applies.
        effect(() => {
            const held = this.heldState();
            if (!held || !this.optionsService.initialized() || this.adoptingRuleset()) return;
            untracked(() => {
                const ruleset = this.rulesetToAdopt(held);
                if (ruleset) void this.adoptRuleset(ruleset);
                else this.applyState(held);
            });
        });

        effect(() => {
            const state = this.state();
            const connected = this.wsService.wsConnected();
            const slots = this.forceWorkspace.loadedForces();
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
            // A lobby shares only the forces this player owns; one they merely opened stays theirs to view.
            const publishedInstanceIds = slots
                .filter(slot => slot.alignment === 'friendly' && slot.force.owned())
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
        this.declinedCode = null;
        // The lobby starts with the host's own rules and Initiative settings.
        const { CBTRules, initiativeOrder, initiativeDie } = this.optionsService.options();
        const settings: LobbyGameSettings = { ruleset: CBTRules, initiativeOrder, initiativeDie };
        try {
            const response = await this.request<LobbyCreatedResponse>({ action: 'createLobby', settings });
            this.applyState(response.state);
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
        this.declinedCode = null;
        try {
            const response = await this.request<LobbyJoinedResponse>({ action: 'joinLobby', code });
            if (!await this.admitState(response.state)) {
                throw new Error(this.declinedCode === response.state.code
                    ? 'You kept your rules, so you did not join the lobby.'
                    : 'The lobby closed before you joined it.');
            }
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

    /** Host only: an away player's forces stop holding the shared turn until the host brings them back. */
    setAway(publicId: string, away: boolean): void {
        if (!this.isHost()) return;
        this.wsService.send({ action: 'setLobbyAway', publicId, away });
    }

    /**
     * Host only: the rules everyone plays by. New rules reach the lobby, and so every player, only
     * once the host's own forces play them; when they cannot switch, the lobby keeps its rules and
     * the other settings still apply.
     */
    async setSettings(settings: LobbyGameSettings): Promise<void> {
        const current = this.settings();
        if (!this.isHost() || !current) return;
        if (settings.ruleset !== current.ruleset) {
            this.hostSwitchingRuleset.set(true);
            try {
                if (!await this.forceBuilderService.switchCBTRules(settings.ruleset)) {
                    settings = { ...settings, ruleset: current.ruleset };
                }
            } finally {
                this.hostSwitchingRuleset.set(false);
            }
        }
        if (settings.ruleset !== current.ruleset
            || settings.initiativeOrder !== current.initiativeOrder
            || settings.initiativeDie !== current.initiativeDie) {
            this.wsService.send({ action: 'setLobbySettings', settings });
        }
    }

    /** Host only: the current turn's Initiative (a hand-set order, a reset turn), or null to clear it. */
    setInitiative(initiative: InitiativeRecord | null): void {
        if (!this.isHost()) return;
        this.wsService.send({ action: 'setLobbyInitiative', initiative });
    }

    /**
     * Rolls (or rerolls a tie) for one of this player's own published forces; the server accepts it only while
     * that force's roll is due. A new turn's first roll starts its record with the Initiative Die values carried in.
     */
    rollInitiative(roll: {
        turn: number;
        side: string;
        dice: readonly [number, number];
        modifier: number;
        carriedDice?: Readonly<Record<string, number>>;
    }): void {
        if (!this.hasLobby()) return;
        this.wsService.send({ action: 'rollLobbyInitiative', ...roll });
    }

    kick(publicId: string): void {
        const participant = this.state()?.participants.find(entry => entry.publicId === publicId);
        if (!this.isHost() || !participant || participant.self) return;
        this.wsService.send({ action: 'kickLobbyParticipant', publicId });
    }

    private async request<TResponse extends WsMessage>(payload: object): Promise<TResponse> {
        if (!this.wsService.wsConnected()) {
            throw new Error('The server is not connected.');
        }
        const response = await this.wsService.sendAndWaitForResponse<TResponse | LobbyErrorResponse>(payload, {
            suppressGlobalError: true,
        });
        if (!response) throw new Error('The server did not return a response.');
        if (response['action'] === 'error') {
            throw new Error(typeof response['message'] === 'string'
                ? response['message']
                : 'Lobby request failed.');
        }
        return response as TResponse;
    }

    private invalidateRestore(): void {
        this.restoreVersion += 1;
    }

    private async restoreLobbyState(): Promise<void> {
        const version = ++this.restoreVersion;
        this.lobbyStateKnown.set(false);
        const response = await this.wsService.sendAndWaitForResponse<LobbyStateResponse>({ action: 'getLobbyState' });
        if (version !== this.restoreVersion
            || !response) return;

        if (response.state === null) {
            await this.clearLobby();
        } else {
            this.applyState(response.state);
        }
        if (version === this.restoreVersion) this.lobbyStateKnown.set(true);
    }

    /** Applies a lobby state, or holds it while its rules are not this player's. */
    private applyState(state: LobbyState): void {
        if (state.code === this.declinedCode) return;
        if (this.rulesetToAdopt(state)) {
            this.heldState.set(state);
            return;
        }
        this.heldState.set(null);
        this.state.set(state);
        this.queueReconcile();
        this.settleHeldStateWaiters(true);
    }

    /** Applies a joined lobby's state; resolves false when the player did not join after all. */
    private admitState(state: LobbyState): Promise<boolean> {
        const applied = new Promise<boolean>(resolve => this.heldStateWaiters.push(resolve));
        this.applyState(state);
        return applied;
    }

    private settleHeldStateWaiters(applied: boolean): void {
        const waiters = this.heldStateWaiters;
        this.heldStateWaiters = [];
        for (const resolve of waiters) resolve(applied);
    }

    /** The lobby's rules when they are not this player's, which is unknown until the local options load. */
    private rulesetToAdopt(state: LobbyState): CBTRuleset | null {
        const ruleset = state.settings?.ruleset;
        return ruleset && (!this.optionsService.initialized() || ruleset !== this.optionsService.options().CBTRules)
            ? ruleset
            : null;
    }

    /**
     * Switches to the lobby's rules. Joining asks first, and declining does not join; in the lobby
     * the player follows the host's change at once and is told.
     */
    private async adoptRuleset(ruleset: CBTRuleset): Promise<void> {
        this.adoptingRuleset.set(true);
        try {
            const lobbyRules = CBT_RULESET_LABELS[ruleset];
            const inLobby = this.state() !== null;
            const switchRules = inLobby || await this.dialogsService.requestConfirmation(
                `This lobby plays ${lobbyRules} rules; you're on ${CBT_RULESET_LABELS[this.optionsService.options().CBTRules]}. Switch to ${lobbyRules} and join?`,
                'Switch Rules?',
                'warning',
            );
            // The lobby may have closed, or changed its rules again, while the player decided.
            const held = this.heldState();
            if (held?.settings.ruleset !== ruleset) return;
            // A switch that fails keeps every force on the player's rules, which this lobby does not play.
            if (!switchRules || !await this.forceBuilderService.switchCBTRules(ruleset)) {
                this.declineLobby();
            } else if (inLobby && !held.isHost) {
                this.toastService.showToast(`The host switched the lobby to ${lobbyRules} rules.`, 'info');
            }
        } finally {
            this.adoptingRuleset.set(false);
        }
    }

    /** The player keeps their rules: leave the lobby they joined or were in, without sending anything of theirs. */
    private declineLobby(): void {
        const inLobby = this.state() !== null;
        this.declinedCode = this.heldState()?.code ?? null;
        this.invalidateRestore();
        this.wsService.send({ action: 'leaveLobby' });
        this.lobbyStateKnown.set(true);
        void this.clearLobby(inLobby ? 'You left the lobby: your forces could not switch to its rules.' : undefined);
    }

    private saveDraftForLobby(force: Force): void {
        if (this.pendingDraftSaves.has(force)) return;
        this.pendingDraftSaves.add(force);
        void this.forcePersistence.saveForce(force)
            .catch(() => this.toastService.showToast('A force could not be added to the lobby.', 'error'))
            .finally(() => this.pendingDraftSaves.delete(force));
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
        for (const slot of [...this.forceWorkspace.loadedForces()]) {
            if (slot.alignment !== 'enemy') continue;
            const instanceId = slot.force.instanceId();
            const isLobbyForce = !slot.force.owned() && !!instanceId && remoteAlignments.has(instanceId);
            if (isLobbyForce) continue;

            try {
                if (slot.force.owned() && slot.force.units().length > 0) {
                    await this.forcePersistence.saveForce(slot.force);
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
            const slot = this.forceWorkspace.loadedForces()
                .find(entry => entry.force.instanceId() === instanceId && !entry.force.owned());
            if (slot) {
                await this.forceBuilderService.removeLoadedForce(slot.force, { skipPrompt: true });
            }
            this.managedRemoteIds.delete(instanceId);
            this.remoteLoadAttempts.delete(instanceId);
        }

        this.forceWorkspace.loadedForces.update(slots => {
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
            const existing = this.forceWorkspace.loadedForces()
                .find(entry => entry.force.instanceId() === instanceId);
            if (existing) {
                if (!existing.force.owned()) this.managedRemoteIds.add(instanceId);
                this.remoteLoadAttempts.delete(instanceId);
                continue;
            }

            const attempts = this.remoteLoadAttempts.get(instanceId) ?? 0;
            if (attempts >= MAX_REMOTE_LOAD_ATTEMPTS) continue;
            this.remoteLoadAttempts.set(instanceId, attempts + 1);
            const force = await this.forcePersistence.getForce(instanceId, false, {
                skipLocal: true,
                showLoading: false,
            });
            if (!force) {
                shouldRetry = true;
                continue;
            }
            const activate = this.forceWorkspace.loadedForces().length === 0;
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
        this.heldState.set(null);
        this.settleHeldStateWaiters(false);
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
            const slot = this.forceWorkspace.loadedForces()
                .find(entry => entry.force.instanceId() === instanceId && !entry.force.owned());
            if (slot) await this.forceBuilderService.removeLoadedForce(slot.force, { skipPrompt: true });
        }
        this.managedRemoteIds.clear();
        if (message) this.toastService.showToast(message, 'info');
    }
}
