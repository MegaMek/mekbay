// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { from, of } from 'rxjs';
import { DialogsService } from './dialogs.service';
import { DisplayNameService } from './display-name.service';
import { ForceBuilderService } from './force-builder.service';
import { ForcePersistenceService } from './force-persistence.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { LobbyService } from './lobby.service';
import { OptionsService } from './options.service';
import { ToastService } from './toast.service';
import { WsService } from './ws.service';

function createForce(instanceId: string, owned: boolean, units: any[] = []) {
    return {
        instanceId: signal<string | null>(instanceId),
        owned: signal(owned),
        units: signal<any[]>(units),
    } as any;
}

const LOBBY_SETTINGS = { ruleset: 'core-2026', initiativeOrder: 'rules', initiativeDie: false } as const;

function lobbyState(isHost: boolean, settings: object = LOBBY_SETTINGS) {
    return {
        action: 'lobbyState',
        code: 'room',
        locked: false,
        settings,
        initiative: null,
        isHost,
        participants: [
            { publicId: 'self', self: true, host: isHost, connected: true, alignment: 'friendly', away: false, instanceIds: [] },
        ],
    };
}

async function settleEffects(): Promise<void> {
    TestBed.flushEffects();
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    TestBed.flushEffects();
}

describe('LobbyService', () => {
    let handlers: Map<string, (message: any) => void>;
    let wsService: any;
    let forceBuilderService: any;
    let forceWorkspace: any;
    let forcePersistence: any;
    let dialogsService: any;
    let toastService: any;
    let displayNameService: any;
    let optionsService: any;

    beforeEach(() => {
        handlers = new Map();
        wsService = {
            wsConnected: signal(true),
            send: jasmine.createSpy('send'),
            sendAndWaitForResponse: jasmine.createSpy('sendAndWaitForResponse'),
            registerMessageHandler: jasmine.createSpy('registerMessageHandler').and.callFake(
                (action: string, handler: (message: any) => void) => {
                    handlers.set(action, handler);
                    return () => handlers.delete(action);
                },
            ),
        };
        forceWorkspace = { loadedForces: signal<any[]>([]) };
        forceBuilderService = {
            loadedForces: forceWorkspace.loadedForces,
            addLoadedForce: jasmine.createSpy('addLoadedForce').and.callFake((force: any, alignment: string, options: any) => {
                forceBuilderService.loadedForces.update((slots: any[]) => [
                    ...slots,
                    { force, alignment, changeSub: null, persistInUrl: options?.persistInUrl },
                ]);
            }),
            removeLoadedForce: jasmine.createSpy('removeLoadedForce').and.callFake(async (force: any) => {
                forceBuilderService.loadedForces.update((slots: any[]) => slots.filter(slot => slot.force !== force));
            }),
            switchCBTRules: jasmine.createSpy('switchCBTRules').and.callFake(async (ruleset: string) => {
                optionsService.options.update((options: any) => ({ ...options, CBTRules: ruleset }));
                return true;
            }),
        };
        forcePersistence = {
            getForce: jasmine.createSpy('getForce'),
            saveForce: jasmine.createSpy('saveForce').and.resolveTo(),
        };
        dialogsService = {
            requestConfirmation: jasmine.createSpy('requestConfirmation'),
            createDialog: jasmine.createSpy('createDialog'),
        };
        toastService = { showToast: jasmine.createSpy('showToast') };
        displayNameService = {
            current: jasmine.createSpy('current').and.resolveTo('Specter'),
            currentOrGenerated: jasmine.createSpy('currentOrGenerated').and.resolveTo('Specter'),
            generate: jasmine.createSpy('generate').and.resolveTo('Atlas'),
            save: jasmine.createSpy('save').and.resolveTo('Specter'),
        };

        optionsService = {
            initialized: signal(true),
            options: signal({ CBTRules: 'core-2026', initiativeOrder: 'rules', initiativeDie: false }),
        };

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                LobbyService,
                { provide: OptionsService, useValue: optionsService },
                { provide: WsService, useValue: wsService },
                { provide: ForceBuilderService, useValue: forceBuilderService },
                { provide: ForceWorkspaceStateService, useValue: forceWorkspace },
                { provide: ForcePersistenceService, useValue: forcePersistence },
                { provide: DialogsService, useValue: dialogsService },
                { provide: DisplayNameService, useValue: displayNameService },
                { provide: ToastService, useValue: toastService },
            ],
        });
    });

    it('creates a lobby without putting the private user UUID in its payload', async () => {
        wsService.sendAndWaitForResponse.and.resolveTo({
                action: 'lobbyCreated',
                state: {
                    action: 'lobbyState',
                    code: 'a1b2',
                    locked: false, settings: LOBBY_SETTINGS, initiative: null,
                    isHost: true,
                    participants: [{
                        publicId: 'public-host',
                        displayName: 'Specter',
                        self: true,
                        host: true,
                        connected: true,
                        alignment: 'friendly',
                        instanceIds: [],
                    }],
                },
            });
        const service = TestBed.inject(LobbyService);

        await service.createLobby();
        await settleEffects();

        expect(displayNameService.save).toHaveBeenCalledOnceWith('Specter');
        expect(wsService.sendAndWaitForResponse).toHaveBeenCalledWith(
            { action: 'createLobby', settings: LOBBY_SETTINGS },
            { suppressGlobalError: true },
        );
        expect(JSON.stringify(wsService.sendAndWaitForResponse.calls.allArgs())).not.toContain('uuid');
        expect(service.state()?.code).toBe('a1b2');
    });

    it('asks for a display name before creating the first lobby', async () => {
        displayNameService.current.and.resolveTo(null);
        dialogsService.createDialog.and.returnValue({ closed: of('Barn Owl') });
        wsService.sendAndWaitForResponse.and.resolveTo({
            action: 'lobbyCreated',
            state: {
                action: 'lobbyState',
                code: 'a1b2',
                locked: false, settings: LOBBY_SETTINGS, initiative: null,
                isHost: true,
                participants: [{
                    publicId: 'public-host',
                    displayName: 'Barn Owl',
                    self: true,
                    host: true,
                    connected: true,
                    alignment: 'friendly',
                    instanceIds: [],
                }],
            },
        });
        const service = TestBed.inject(LobbyService);

        await service.createLobby();

        expect(dialogsService.createDialog).toHaveBeenCalledWith(
            jasmine.any(Function),
            jasmine.objectContaining({
                disableClose: true,
                data: { displayName: 'Atlas' },
            }),
        );
        expect(displayNameService.save).toHaveBeenCalledOnceWith('Barn Owl');
        expect(wsService.sendAndWaitForResponse).toHaveBeenCalledWith(
            { action: 'createLobby', settings: LOBBY_SETTINGS },
            { suppressGlobalError: true },
        );
    });

    it('does not save a name or create a lobby when the first-use dialog is cancelled', async () => {
        displayNameService.current.and.resolveTo(null);
        dialogsService.createDialog.and.returnValue({ closed: of(null) });
        const service = TestBed.inject(LobbyService);

        await service.createLobby();

        expect(displayNameService.save).not.toHaveBeenCalled();
        expect(wsService.sendAndWaitForResponse).not.toHaveBeenCalledWith(
            jasmine.objectContaining({ action: 'createLobby' }),
            jasmine.anything(),
        );
    });

    it('normalizes lobby codes before joining', async () => {
        wsService.sendAndWaitForResponse.and.callFake(async (payload: { action: string }) => (
            payload.action === 'joinLobby'
                ? {
                    action: 'lobbyJoined',
                    state: {
                        action: 'lobbyState',
                        code: 'a1b2',
                        locked: false, settings: LOBBY_SETTINGS, initiative: null,
                        isHost: false,
                        participants: [{
                            publicId: 'self-public',
                            self: true,
                            host: false,
                            connected: true,
                            alignment: 'friendly',
                            instanceIds: [],
                        }],
                    },
                }
                : { action: 'lobbyStateResult', state: null }
        ));
        const service = TestBed.inject(LobbyService);

        await service.joinLobby(' A1B2 ');

        expect(wsService.sendAndWaitForResponse).toHaveBeenCalledWith(
            { action: 'joinLobby', code: 'a1b2' },
            { suppressGlobalError: true },
        );
        expect(service.state()?.code).toBe('a1b2');
        // The lobby plays this player's rules: nothing to ask.
        expect(dialogsService.requestConfirmation).not.toHaveBeenCalled();
    });

    it('joins as a spectator through the shared lobby prompt', async () => {
        dialogsService.createDialog.and.callFake((_component: unknown, options: any) => ({
            closed: from(options.data.attemptJoin('a1b2', 'Specter').then(() => true)),
        }));
        wsService.sendAndWaitForResponse.and.callFake(async (payload: { action: string }) => (
            payload.action === 'joinLobby'
                ? {
                    action: 'lobbyJoined',
                    state: {
                        action: 'lobbyState',
                        code: 'a1b2',
                        locked: false, settings: LOBBY_SETTINGS, initiative: null,
                        isHost: false,
                        participants: [{
                            publicId: 'public-spectator',
                            self: true,
                            host: false,
                            connected: true,
                            alignment: 'friendly',
                            instanceIds: [],
                        }],
                    },
                }
                : { action: 'lobbyStateResult', state: null }
        ));
        const service = TestBed.inject(LobbyService);
        const showLobbyDialog = spyOn(service, 'showLobbyDialog').and.resolveTo();

        await service.promptAndJoin();

        expect(dialogsService.createDialog).toHaveBeenCalledWith(
            jasmine.any(Function),
            jasmine.objectContaining({
                disableClose: true,
                data: jasmine.objectContaining({
                    displayName: 'Specter',
                    attemptJoin: jasmine.any(Function),
                }),
            }),
        );
        expect(displayNameService.save).toHaveBeenCalledOnceWith('Specter');
        expect(wsService.sendAndWaitForResponse).toHaveBeenCalledWith(
            { action: 'joinLobby', code: 'a1b2' },
            { suppressGlobalError: true },
        );
        expect(forceBuilderService.loadedForces()).toEqual([]);
        expect(showLobbyDialog).toHaveBeenCalled();
    });

    it('seeds the join dialog from the account display name service', async () => {
        dialogsService.createDialog.and.returnValue({ closed: of(null) });
        const service = TestBed.inject(LobbyService);

        await service.promptAndJoin();

        expect(displayNameService.currentOrGenerated).toHaveBeenCalled();
        expect(dialogsService.createDialog).toHaveBeenCalledWith(
            jasmine.any(Function),
            jasmine.objectContaining({
                data: jasmine.objectContaining({
                    displayName: 'Specter',
                    attemptJoin: jasmine.any(Function),
                }),
            }),
        );
    });

    it('restores a resumed lobby after late service initialization', async () => {
        let resolveState!: (response: any) => void;
        const stateResponse = new Promise<any>(resolve => {
            resolveState = resolve;
        });
        wsService.sendAndWaitForResponse.and.callFake(async (payload: { action: string }) => (
            payload.action === 'getLobbyState' ? stateResponse : null
        ));

        const service = TestBed.inject(LobbyService);
        TestBed.flushEffects();
        await Promise.resolve();

        expect(wsService.sendAndWaitForResponse).toHaveBeenCalledWith({ action: 'getLobbyState' });
        expect(service.hasLobby()).toBeFalse();
        expect(service.canCreateOrJoin()).toBeFalse();

        resolveState({
            action: 'lobbyStateResult',
            state: {
                action: 'lobbyState',
                code: 'a1b2',
                locked: false, settings: LOBBY_SETTINGS, initiative: null,
                isHost: true,
                participants: [{
                    publicId: 'public-host',
                    self: true,
                    host: true,
                    connected: true,
                    alignment: 'friendly',
                    instanceIds: [],
                }],
            },
        });
        await settleEffects();

        expect(service.state()?.code).toBe('a1b2');
        expect(service.isHost()).toBeTrue();
        expect(service.canCreateOrJoin()).toBeFalse();
    });

    it('publishes owned forces and reconciles remote forces only', async () => {
        const ownForce = createForce('own-force', true);
        const remoteForce = createForce('remote-force', false);
        forceBuilderService.loadedForces.set([{ force: ownForce, alignment: 'friendly', changeSub: null }]);
        forcePersistence.getForce.and.resolveTo(remoteForce);
        const service = TestBed.inject(LobbyService);

        handlers.get('lobbyState')?.({
            action: 'lobbyState',
            code: 'x7y8',
            locked: false, settings: LOBBY_SETTINGS, initiative: null,
            isHost: false,
            participants: [
                { publicId: 'self', self: true, host: false, connected: true, alignment: 'friendly', instanceIds: ['own-force'] },
                { publicId: 'host', self: false, host: true, connected: true, alignment: 'enemy', instanceIds: ['remote-force'] },
            ],
        });
        await settleEffects();

        expect(wsService.send).toHaveBeenCalledWith({ action: 'syncLobbyForces', instanceIds: ['own-force'] });
        expect(forcePersistence.getForce).toHaveBeenCalledWith('remote-force', false, {
            skipLocal: true,
            showLoading: false,
        });
        expect(remoteForce.owned()).toBeFalse();
        expect(forceBuilderService.addLoadedForce).toHaveBeenCalledWith(remoteForce, 'enemy', {
            activate: false,
            persistInUrl: false,
        });
        expect(forceBuilderService.loadedForces()[0].alignment).toBe('friendly');

        handlers.get('lobbyState')?.({
            action: 'lobbyState',
            code: 'x7y8',
            locked: false, settings: LOBBY_SETTINGS, initiative: null,
            isHost: false,
            participants: [
                { publicId: 'self', self: true, host: false, connected: true, alignment: 'friendly', instanceIds: ['own-force'] },
            ],
        });
        await settleEffects();

        expect(forceBuilderService.removeLoadedForce).toHaveBeenCalledWith(remoteForce, { skipPrompt: true });
        expect(forceBuilderService.loadedForces().map((slot: any) => slot.force)).toEqual([ownForce]);
    });

    it('activates the first remote force for a force-less spectator', async () => {
        const remoteForce = createForce('remote-force', false);
        forcePersistence.getForce.and.resolveTo(remoteForce);
        TestBed.inject(LobbyService);

        handlers.get('lobbyState')?.({
            action: 'lobbyState',
            code: 'room',
            locked: false, settings: LOBBY_SETTINGS, initiative: null,
            isHost: false,
            participants: [
                { publicId: 'spectator', self: true, host: false, connected: true, alignment: 'friendly', instanceIds: [] },
                { publicId: 'host', self: false, host: true, connected: true, alignment: 'enemy', instanceIds: ['remote-force'] },
            ],
        });
        await settleEffects();

        expect(forceBuilderService.addLoadedForce).toHaveBeenCalledWith(remoteForce, 'enemy', {
            activate: true,
            persistInUrl: false,
        });
    });

    it('shares only the friendly forces the player owns, not ones they merely opened', async () => {
        forceBuilderService.loadedForces.set([{
            force: createForce('owned-force', true),
            alignment: 'friendly',
            changeSub: null,
        }, {
            force: createForce('opened-force', false),
            alignment: 'friendly',
            changeSub: null,
        }]);
        TestBed.inject(LobbyService);

        handlers.get('lobbyState')?.({
            action: 'lobbyState',
            code: 'room',
            locked: false, settings: LOBBY_SETTINGS, initiative: null,
            isHost: true,
            participants: [
                { publicId: 'self', self: true, host: true, connected: true, alignment: 'friendly', instanceIds: [] },
            ],
        });
        await settleEffects();

        expect(wsService.send).toHaveBeenCalledWith({
            action: 'syncLobbyForces',
            instanceIds: ['owned-force'],
        });
    });

    it('does not republish forces downloaded from another lobby participant', async () => {
        const remoteForce = createForce('remote-force', false);
        forceBuilderService.loadedForces.set([{
            force: remoteForce,
            alignment: 'friendly',
            changeSub: null,
        }]);
        const service = TestBed.inject(LobbyService);

        handlers.get('lobbyState')?.({
            action: 'lobbyState',
            code: 'room',
            locked: false, settings: LOBBY_SETTINGS, initiative: null,
            isHost: false,
            participants: [
                { publicId: 'self', self: true, host: false, connected: true, alignment: 'friendly', instanceIds: [] },
                { publicId: 'ally', self: false, host: true, connected: true, alignment: 'friendly', instanceIds: ['remote-force'] },
            ],
        });
        await settleEffects();

        expect(service.hasLobby()).toBeTrue();
        expect(wsService.send).toHaveBeenCalledWith({ action: 'syncLobbyForces', instanceIds: [] });
        expect(wsService.send).not.toHaveBeenCalledWith({
            action: 'syncLobbyForces',
            instanceIds: ['remote-force'],
        });
    });

    it('never publishes locally hostile forces and unloads them in lobby mode', async () => {
        const hostileForce = createForce('hostile-force', true, [{}]);
        forceBuilderService.loadedForces.set([{ force: hostileForce, alignment: 'enemy', changeSub: null }]);
        TestBed.inject(LobbyService);

        handlers.get('lobbyState')?.({
            action: 'lobbyState',
            code: 'room',
            locked: false, settings: LOBBY_SETTINGS, initiative: null,
            isHost: true,
            participants: [
                { publicId: 'self', self: true, host: true, connected: true, alignment: 'friendly', instanceIds: ['hostile-force'] },
            ],
        });
        await settleEffects();

        expect(wsService.send).toHaveBeenCalledWith({ action: 'syncLobbyForces', instanceIds: [] });
        expect(forcePersistence.saveForce).toHaveBeenCalledWith(hostileForce);
        expect(forceBuilderService.removeLoadedForce).toHaveBeenCalledWith(hostileForce, { skipPrompt: true });
        expect(forceBuilderService.loadedForces()).toEqual([]);
        expect(toastService.showToast).toHaveBeenCalledWith(
            'Locally loaded hostile forces were unloaded in lobby mode.',
            'info',
        );

        const lateHostileForce = createForce('late-hostile-force', true);
        forceBuilderService.removeLoadedForce.calls.reset();
        forceBuilderService.loadedForces.set([{ force: lateHostileForce, alignment: 'enemy', changeSub: null }]);
        await settleEffects();

        expect(forceBuilderService.removeLoadedForce).toHaveBeenCalledWith(lateHostileForce, { skipPrompt: true });
        expect(forceBuilderService.loadedForces()).toEqual([]);
    });

    it('sends only public IDs when changing perspective or kicking', () => {
        const service = TestBed.inject(LobbyService);
        handlers.get('lobbyState')?.({
            action: 'lobbyState',
            code: 'room',
            locked: false, settings: LOBBY_SETTINGS, initiative: null,
            isHost: true,
            participants: [
                { publicId: 'self-public', self: true, host: true, connected: true, alignment: 'friendly', instanceIds: [] },
                { publicId: 'guest-public', self: false, host: false, connected: true, alignment: 'friendly', instanceIds: [] },
            ],
        });

        service.setAlignment('guest-public', 'enemy');
        service.kick('guest-public');

        expect(wsService.send).toHaveBeenCalledWith({
            action: 'setLobbyAlignment',
            publicId: 'guest-public',
            alignment: 'enemy',
        });
        expect(wsService.send).toHaveBeenCalledWith({ action: 'kickLobbyParticipant', publicId: 'guest-public' });
        expect(JSON.stringify(wsService.send.calls.allArgs())).not.toContain('uuid');
    });

    it('confirms before the host closes a lobby from the menu', async () => {
        dialogsService.requestConfirmation.and.resolveTo(true);
        const service = TestBed.inject(LobbyService);
        handlers.get('lobbyState')?.({
            action: 'lobbyState',
            code: 'room',
            locked: false, settings: LOBBY_SETTINGS, initiative: null,
            isHost: true,
            participants: [
                { publicId: 'self', self: true, host: true, connected: true, alignment: 'friendly', instanceIds: [] },
            ],
        });

        expect(await service.confirmAndLeave()).toBeTrue();

        expect(dialogsService.requestConfirmation).toHaveBeenCalledWith(
            'Leave this lobby?',
            'Leave Lobby',
            'warning',
        );
        expect(wsService.send).toHaveBeenCalledWith({ action: 'leaveLobby' });
        expect(service.state()).toBeNull();
    });

    it('shows the inactivity toast when the server closes an idle operation lobby', async () => {
        const service = TestBed.inject(LobbyService);
        handlers.get('lobbyState')?.({
            action: 'lobbyState',
            code: 'room',
            locked: false, settings: LOBBY_SETTINGS, initiative: null,
            isHost: true,
            participants: [
                { publicId: 'self', self: true, host: true, connected: true, alignment: 'friendly', instanceIds: [] },
            ],
        });

        handlers.get('lobbyClosed')?.({ action: 'lobbyClosed', reason: 'inactivity' });
        await settleEffects();

        expect(service.state()).toBeNull();
        expect(toastService.showToast).toHaveBeenCalledWith(
            'Operation lobby closed due to inactivity',
            'info',
        );
    });

    it('publishes at most eight locally loaded forces per participant', async () => {
        forceBuilderService.loadedForces.set(Array.from({ length: 9 }, (_, index) => ({
            force: createForce(`force-${index}`, true),
            alignment: 'friendly',
            changeSub: null,
        })));
        TestBed.inject(LobbyService);

        handlers.get('lobbyState')?.({
            action: 'lobbyState',
            code: 'room',
            locked: false, settings: LOBBY_SETTINGS, initiative: null,
            isHost: true,
            participants: [
                { publicId: 'self-public', self: true, host: true, connected: true, alignment: 'friendly', instanceIds: [] },
            ],
        });
        await settleEffects();

        expect(wsService.send).toHaveBeenCalledWith({
            action: 'syncLobbyForces',
            instanceIds: Array.from({ length: 8 }, (_, index) => `force-${index}`),
        });
        expect(toastService.showToast).toHaveBeenCalledWith(
            'A lobby supports up to 8 forces per participant.',
            'info',
        );
    });

    it('creates a lobby with the local rules and Initiative settings', async () => {
        optionsService.options.set({ CBTRules: 'total-warfare', initiativeOrder: 'spread', initiativeDie: true });
        wsService.sendAndWaitForResponse.and.resolveTo({ action: 'lobbyCreated', state: lobbyState(true) });
        const service = TestBed.inject(LobbyService);

        await service.createLobby();

        expect(wsService.sendAndWaitForResponse).toHaveBeenCalledWith(
            { action: 'createLobby', settings: { ruleset: 'total-warfare', initiativeOrder: 'spread', initiativeDie: true } },
            { suppressGlobalError: true },
        );
    });

    describe('with other rules than the player', () => {
        const TOTAL_WARFARE = { ...LOBBY_SETTINGS, ruleset: 'total-warfare' } as const;

        /** A started service whose resume check found no lobby, and a server that admits the join. */
        async function joinableService(settings: object): Promise<LobbyService> {
            wsService.sendAndWaitForResponse.and.callFake(async (payload: { action: string }) => payload.action === 'joinLobby'
                ? { action: 'lobbyJoined', state: lobbyState(false, settings) }
                : { action: 'lobbyStateResult', state: null });
            const service = TestBed.inject(LobbyService);
            await settleEffects();
            return service;
        }

        async function settle<T>(work: Promise<T>): Promise<T> {
            for (let index = 0; index < 4; index += 1) await settleEffects();
            return work;
        }

        it('asks before joining, switches the rules live, then joins', async () => {
            const owned = createForce('own-force', true, [{ id: 'unit' }]);
            forceWorkspace.loadedForces.set([{ force: owned, alignment: 'friendly' }]);
            dialogsService.requestConfirmation.and.resolveTo(true);
            const service = await joinableService(TOTAL_WARFARE);
            let joinedBeforeSwitch: unknown;
            forceBuilderService.switchCBTRules.and.callFake(async (ruleset: string) => {
                joinedBeforeSwitch = service.state();
                expect(wsService.send).not.toHaveBeenCalledWith(jasmine.objectContaining({ action: 'syncLobbyForces' }));
                optionsService.options.update((options: any) => ({ ...options, CBTRules: ruleset }));
                return true;
            });

            await settle(service.joinLobby('room'));

            expect(dialogsService.requestConfirmation).toHaveBeenCalledOnceWith(
                "This lobby plays Total Warfare rules; you're on Core 2026. Switch to Total Warfare and join?",
                'Switch Rules?',
                'warning',
            );
            expect(forceBuilderService.switchCBTRules).toHaveBeenCalledOnceWith('total-warfare');
            expect(joinedBeforeSwitch).toBeNull();
            expect(service.state()?.code).toBe('room');
            expect(wsService.send).toHaveBeenCalledWith({ action: 'syncLobbyForces', instanceIds: ['own-force'] });
        });

        it('does not join, and sends nothing of the player, when they keep their rules', async () => {
            const owned = createForce('own-force', true, [{ id: 'unit' }]);
            forceWorkspace.loadedForces.set([{ force: owned, alignment: 'friendly' }]);
            dialogsService.requestConfirmation.and.resolveTo(false);
            const service = await joinableService(TOTAL_WARFARE);

            await expectAsync(settle(service.joinLobby('room')))
                .toBeRejectedWithError('You kept your rules, so you did not join the lobby.');

            expect(forceBuilderService.switchCBTRules).not.toHaveBeenCalled();
            expect(service.state()).toBeNull();
            expect(wsService.send.calls.allArgs()).toEqual([[{ action: 'leaveLobby' }]]);
            // A broadcast the server sent before the player left changes nothing.
            handlers.get('lobbyState')?.(lobbyState(false, TOTAL_WARFARE));
            await settleEffects();
            expect(dialogsService.requestConfirmation).toHaveBeenCalledTimes(1);
            expect(service.state()).toBeNull();
        });

        it('follows the host to new rules in the lobby without asking, and says so', async () => {
            const service = TestBed.inject(LobbyService);
            handlers.get('lobbyState')?.(lobbyState(false));
            expect(service.state()?.settings).toEqual(LOBBY_SETTINGS);

            handlers.get('lobbyState')?.(lobbyState(false, TOTAL_WARFARE));
            await settle(Promise.resolve());

            expect(dialogsService.requestConfirmation).not.toHaveBeenCalled();
            expect(forceBuilderService.switchCBTRules).toHaveBeenCalledOnceWith('total-warfare');
            expect(service.state()?.settings).toEqual(TOTAL_WARFARE);
            expect(wsService.send).not.toHaveBeenCalledWith({ action: 'leaveLobby' });
            expect(toastService.showToast).toHaveBeenCalledWith('The host switched the lobby to Total Warfare rules.', 'info');
        });

        it('decides only once the local options have loaded', async () => {
            optionsService.initialized.set(false);
            dialogsService.requestConfirmation.and.resolveTo(true);
            const service = TestBed.inject(LobbyService);

            handlers.get('lobbyState')?.(lobbyState(false, TOTAL_WARFARE));
            await settle(Promise.resolve());
            expect(dialogsService.requestConfirmation).not.toHaveBeenCalled();
            expect(service.state()).toBeNull();

            optionsService.initialized.set(true);
            await settle(Promise.resolve());
            expect(forceBuilderService.switchCBTRules).toHaveBeenCalledOnceWith('total-warfare');
            expect(service.state()?.settings).toEqual(TOTAL_WARFARE);
        });

        it('ignores the answer when the host changes the rules back meanwhile', async () => {
            let answer!: (value: boolean) => void;
            dialogsService.requestConfirmation.and.returnValue(new Promise<boolean>(resolve => answer = resolve));
            const service = TestBed.inject(LobbyService);

            handlers.get('lobbyState')?.(lobbyState(false, TOTAL_WARFARE));
            await settle(Promise.resolve());
            handlers.get('lobbyState')?.(lobbyState(false));
            expect(service.state()?.settings).toEqual(LOBBY_SETTINGS);
            answer(true);
            await settle(Promise.resolve());

            expect(forceBuilderService.switchCBTRules).not.toHaveBeenCalled();
            expect(service.state()?.settings).toEqual(LOBBY_SETTINGS);
        });
    });

    it('sends lobby settings and Initiative only as the host', async () => {
        const service = TestBed.inject(LobbyService);
        const settings = { ruleset: 'total-warfare', initiativeOrder: 'front-loaded', initiativeDie: true } as const;
        const initiative = { turn: 1, rolls: [{ side: 'self', dice: [[6, 5] as const], modifier: 1 }], order: ['enemy', 'self'] };

        handlers.get('lobbyState')?.(lobbyState(false));
        await service.setSettings(settings);
        service.setInitiative(initiative);
        expect(wsService.send).not.toHaveBeenCalled();

        handlers.get('lobbyState')?.(lobbyState(true));
        await service.setSettings(settings);
        service.setInitiative(initiative);
        service.setInitiative(null);
        expect(wsService.send.calls.allArgs()).toEqual([
            [{ action: 'setLobbySettings', settings }],
            [{ action: 'setLobbyInitiative', initiative }],
            [{ action: 'setLobbyInitiative', initiative: null }],
        ]);
        // The host chose the rules, so switches to them without being asked.
        expect(forceBuilderService.switchCBTRules).toHaveBeenCalledOnceWith('total-warfare');
        expect(dialogsService.requestConfirmation).not.toHaveBeenCalled();
    });

    it('sends new rules only once the host plays them, and keeps the other settings when the host cannot switch', async () => {
        const service = TestBed.inject(LobbyService);
        handlers.get('lobbyState')?.(lobbyState(true));
        forceBuilderService.switchCBTRules.and.resolveTo(false);

        await service.setSettings({ ruleset: 'total-warfare', initiativeOrder: 'rules', initiativeDie: true });

        expect(wsService.send.calls.allArgs()).toEqual([
            [{ action: 'setLobbySettings', settings: { ...LOBBY_SETTINGS, initiativeDie: true } }],
        ]);
    });

    it('rolls Initiative for an own force as any lobby member', () => {
        const service = TestBed.inject(LobbyService);
        const roll = { turn: 2, side: 'own-force', dice: [3, 4] as const, modifier: 1, carriedDice: { 'own-force': 2 } };

        service.rollInitiative(roll);
        expect(wsService.send).not.toHaveBeenCalled();

        handlers.get('lobbyState')?.(lobbyState(false));
        service.rollInitiative(roll);
        expect(wsService.send).toHaveBeenCalledOnceWith({ action: 'rollLobbyInitiative', ...roll });
    });

    it('keeps lobby state during transport loss and clears it only when resume fails', async () => {
        const service = TestBed.inject(LobbyService);
        handlers.get('lobbyState')?.({
            action: 'lobbyState',
            code: 'room',
            locked: false, settings: LOBBY_SETTINGS, initiative: null,
            isHost: true,
            participants: [
                { publicId: 'self-public', self: true, host: true, connected: true, alignment: 'friendly', instanceIds: [] },
            ],
        });
        await settleEffects();

        wsService.wsConnected.set(false);
        await settleEffects();
        expect(service.state()?.code).toBe('room');

        handlers.get('lobbyResumeResult')?.({ action: 'lobbyResumeResult', resumed: false });
        await settleEffects();
        expect(service.state()).toBeNull();
    });
});
