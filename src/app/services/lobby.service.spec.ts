// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { from, of } from 'rxjs';
import { DataService } from './data.service';
import { DialogsService } from './dialogs.service';
import { DisplayNameService } from './display-name.service';
import { ForceBuilderService } from './force-builder.service';
import { LobbyService } from './lobby.service';
import { ToastService } from './toast.service';
import { WsService } from './ws.service';

function createForce(instanceId: string, owned: boolean, units: any[] = []) {
    return {
        instanceId: signal<string | null>(instanceId),
        owned: signal(owned),
        units: signal<any[]>(units),
    } as any;
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
    let dataService: any;
    let dialogsService: any;
    let toastService: any;
    let displayNameService: any;

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
        forceBuilderService = {
            loadedForces: signal<any[]>([]),
            addLoadedForce: jasmine.createSpy('addLoadedForce').and.callFake((force: any, alignment: string, options: any) => {
                forceBuilderService.loadedForces.update((slots: any[]) => [
                    ...slots,
                    { force, alignment, changeSub: null, persistInUrl: options?.persistInUrl },
                ]);
            }),
            removeLoadedForce: jasmine.createSpy('removeLoadedForce').and.callFake(async (force: any) => {
                forceBuilderService.loadedForces.update((slots: any[]) => slots.filter(slot => slot.force !== force));
            }),
        };
        dataService = {
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

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                LobbyService,
                { provide: WsService, useValue: wsService },
                { provide: ForceBuilderService, useValue: forceBuilderService },
                { provide: DataService, useValue: dataService },
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
                    locked: false,
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
            { action: 'createLobby' },
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
                locked: false,
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
            { action: 'createLobby' },
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
            { action: 'createLobby' },
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
                        locked: false,
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
                        locked: false,
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
                locked: false,
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
        const remoteForce = createForce('remote-force', true);
        forceBuilderService.loadedForces.set([{ force: ownForce, alignment: 'friendly', changeSub: null }]);
        dataService.getForce.and.resolveTo(remoteForce);
        const service = TestBed.inject(LobbyService);

        handlers.get('lobbyState')?.({
            action: 'lobbyState',
            code: 'x7y8',
            locked: false,
            isHost: false,
            participants: [
                { publicId: 'self', self: true, host: false, connected: true, alignment: 'friendly', instanceIds: ['own-force'] },
                { publicId: 'host', self: false, host: true, connected: true, alignment: 'enemy', instanceIds: ['remote-force'] },
            ],
        });
        await settleEffects();

        expect(wsService.send).toHaveBeenCalledWith({ action: 'syncLobbyForces', instanceIds: ['own-force'] });
        expect(dataService.getForce).toHaveBeenCalledWith('remote-force', false, {
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
            locked: false,
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
        const remoteForce = createForce('remote-force', true);
        dataService.getForce.and.resolveTo(remoteForce);
        TestBed.inject(LobbyService);

        handlers.get('lobbyState')?.({
            action: 'lobbyState',
            code: 'room',
            locked: false,
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

    it('publishes friendly local forces regardless of cloud ownership', async () => {
        const sharedForce = createForce('shared-force', false);
        forceBuilderService.loadedForces.set([{
            force: sharedForce,
            alignment: 'friendly',
            changeSub: null,
        }]);
        TestBed.inject(LobbyService);

        handlers.get('lobbyState')?.({
            action: 'lobbyState',
            code: 'room',
            locked: false,
            isHost: true,
            participants: [
                { publicId: 'self', self: true, host: true, connected: true, alignment: 'friendly', instanceIds: [] },
            ],
        });
        await settleEffects();

        expect(wsService.send).toHaveBeenCalledWith({
            action: 'syncLobbyForces',
            instanceIds: ['shared-force'],
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
            locked: false,
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
            locked: false,
            isHost: true,
            participants: [
                { publicId: 'self', self: true, host: true, connected: true, alignment: 'friendly', instanceIds: ['hostile-force'] },
            ],
        });
        await settleEffects();

        expect(wsService.send).toHaveBeenCalledWith({ action: 'syncLobbyForces', instanceIds: [] });
        expect(dataService.saveForce).toHaveBeenCalledWith(hostileForce);
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
            locked: false,
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
            locked: false,
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
            locked: false,
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
            locked: false,
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

    it('keeps lobby state during transport loss and clears it only when resume fails', async () => {
        const service = TestBed.inject(LobbyService);
        handlers.get('lobbyState')?.({
            action: 'lobbyState',
            code: 'room',
            locked: false,
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
