// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { of, Subject } from 'rxjs';
import { GameSystem } from '../models/common.model';
import type { Faction } from '../models/factions.model';
import { Force, type UnitGroup } from '../models/force.model';
import type { ForceUnit } from '../models/force-unit.model';
import { LoadForceEntry } from '../models/load-force-entry.model';
import type { UnitSummary } from '../models/unit-summary.model';
import type { FormationTypeDefinition } from '../utils/formation-type.model';
import { createEmptyForceNameWords } from '../models/force-name-words.model';
import { LanceTypeIdentifierUtil } from '../utils/lance-type-identifier.util';
import { ForceBuilderService } from './force-builder.service';
import { ForceImportService } from './force-import.service';
import { ForceWorkspaceCommandsService } from './force-workspace-commands.service';
import { ForceUrlStateService } from './force-url-state.service';
import { ForceDialogsService } from './force-dialogs.service';
import { ForceRemoteSyncService } from './force-remote-sync.service';
import { ForceSlotLifecycleService } from './force-slot-lifecycle.service';
import { ForceUnitLoadingService } from './force-unit-loading.service';
import { ForceFormationService } from './force-formation.service';
import { ForceUnitAdmissionService } from './force-unit-admission.service';
import { CBTForce } from '../models/cbt-force.model';
import { CBTForceMember } from '../models/force-member.model';
import type { SerializedForce } from '../models/force-serialization';
import { asUnitInstanceId } from '../models/runtime/runtime-state';
import { C3NetworkEditor } from '../models/c3-network-editor';
import { createEmptyCBTForceForTest, createTestMekEntity } from '../testing/unit-test-helpers';

function createFaction(id: number, name: string): Faction {
    return {
        id,
        name,
        group: 'Inner Sphere',
        img: '',
        eras: {},
    };
}

function createFormation(id: string, exclusiveFaction?: string[]): FormationTypeDefinition {
    return {
        id,
        name: id,
        description: '',
        minUnits: 4,
        exclusiveFaction,
    };
}

function createUnit(): UnitSummary {
    return {
        id: 1,
        name: 'Test Mek',
        chassis: 'Test',
        model: 'Mek',
        type: 'BM',
    } as unknown as UnitSummary;
}

function createSerializedForce(overrides: Partial<SerializedForce> = {}): SerializedForce {
    return {
        version: 2,
        timestamp: '2026-08-06T20:00:00.000Z',
        instanceId: 'force-1',
        type: GameSystem.ALPHA_STRIKE,
        name: 'Test Force',
        groups: [],
        ...overrides,
    };
}

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createHarness(formation: FormationTypeDefinition, factions: Faction[]) {
    const service = Object.create(ForceWorkspaceCommandsService.prototype) as any;
    const selectedUnit = signal<ForceUnit | null>(null);
    const groupUnits = signal<ForceUnit[]>([]);
    const forceUnits: ForceUnit[] = [];
    const group = {
        formation: signal<FormationTypeDefinition | null>(null),
        formationLock: false,
        formationHistory: new Set<string>(['previous-automatic-match']),
        units: groupUnits,
        formationUnits: () => groupUnits(),
    } as unknown as UnitGroup;
    const force = {
        gameSystem: GameSystem.ALPHA_STRIKE,
        faction: signal<Faction | null>(null),
        factionLock: false,
        era: signal(null),
        eraLock: false,
        units: () => forceUnits,
        members: () => forceUnits,
        membersInGroup: (targetGroup: UnitGroup) => targetGroup.units(),
        groups: () => [group],
        updateGroup: jasmine.createSpy('updateGroup').and.callFake(async (targetGroup: UnitGroup, patch: any) => {
            if (Object.prototype.hasOwnProperty.call(patch, 'formation')) targetGroup.formation.set(patch.formation);
            if (Object.prototype.hasOwnProperty.call(patch, 'formationLock')) {
                targetGroup.formationLock = patch.formationLock || undefined;
            }
            return true;
        }),
        addUnit: jasmine.createSpy('addUnit').and.callFake((unit: UnitSummary, targetGroup: UnitGroup = group) => {
            const forceUnit = {
                id: `unit-${forceUnits.length + 1}`,
                force,
                getSummary: () => unit,
                getGroup: () => targetGroup,
            } as unknown as ForceUnit;
            forceUnits.push(forceUnit);
            targetGroup.units.set([...targetGroup.units(), forceUnit]);
            return forceUnit;
        }),
        setName: jasmine.createSpy('setName'),
    };
    group.force = force as any;

    const filtersService = {
        getActiveFormationTargetDefinition: jasmine.createSpy('getActiveFormationTargetDefinition').and.returnValue(formation),
    };

    service.dataService = {
        getFactions: () => factions,
        getForceNameWords: () => createEmptyForceNameWords(),
    };
    const formations = Object.create(ForceFormationService.prototype) as any;
    formations.dataService = service.dataService;
    formations.injector = {
        get: () => filtersService,
    };
    service.layoutService = {
        openMenu: jasmine.createSpy('openMenu'),
    };
    service.injector = {
        get: () => ({ requestClosePanels: jasmine.createSpy('requestClosePanels') }),
    };
    service.toastService = {
        showToast: jasmine.createSpy('showToast'),
    };
    formations.unitAvailabilitySource = {
        createForceAvailabilityContextForUnits: () => ({}) as any,
    };
    formations.dialogsService = { createDialog: jasmine.createSpy('createDialog') };
    formations.reconcileASFormationAssignments = jasmine.createSpy('reconcileASFormationAssignments');
    service.formations = formations;
    service.workspace = {
        selectedUnit,
        smartCurrentForce: () => force,
        selectUnit: (unit: ForceUnit | null) => selectedUnit.set(unit),
    };
    service.unitAdmission = {
        admit: ({ summary, group: targetGroup }: { summary: UnitSummary; group?: UnitGroup }) =>
            Promise.resolve(force.addUnit(summary, targetGroup)),
    };
    return { service, formations, force, group, filtersService };
}

describe('ForceBuilderService formation filter integration', () => {
    it('locks the first group to the active formation filter and prefers its exclusive faction', async () => {
        const freeWorldsLeague = createFaction(56, 'Free Worlds League');
        const draconisCombine = createFaction(27, 'Draconis Combine');
        const formation = createFormation('fw-lance', ['Free Worlds League']);
        const { service, force, group, filtersService } = createHarness(formation, [draconisCombine, freeWorldsLeague]);

        await service.addUnit(createUnit());

        expect(filtersService.getActiveFormationTargetDefinition).toHaveBeenCalledWith(GameSystem.ALPHA_STRIKE);
        expect(group.formation()).toBe(formation);
        expect(group.formationLock).toBeTrue();
        expect(group.formationHistory.size).toBe(0);
        expect(force.faction()).toBe(freeWorldsLeague);
        expect(force.setName).toHaveBeenCalled();
    });

    it('restores group formations from generated force preview entries', async () => {
        const lightFireFormation = createFormation('light-fire-lance');
        const automaticFormation = createFormation('automatic-lance');
        spyOn(LanceTypeIdentifierUtil, 'getDefinitionById').and.callFake((formationId: string) => (
            formationId === lightFireFormation.id ? lightFireFormation : null
        ));

        const service = Object.create(ForceImportService.prototype) as any;
        const groupsSignal = signal<UnitGroup[]>([]);
        const createdForceUnits: ForceUnit[] = [];
        const addUnitLoadingStates: boolean[] = [];
        const force = {
            name: 'Generated Test Force',
            gameSystem: GameSystem.ALPHA_STRIKE,
            loading: false,
            instanceId: signal<string | null>(null),
            faction: signal<Faction | null>(null),
            era: signal(null),
            groups: groupsSignal,
            units: () => createdForceUnits,
            members: () => createdForceUnits,
            membersInGroup: (group: UnitGroup) => group.units(),
            updateGroup: jasmine.createSpy('updateGroup').and.callFake(async (group: UnitGroup, patch: any) => {
                if (Object.prototype.hasOwnProperty.call(patch, 'formation')) group.formation.set(patch.formation);
                if (Object.prototype.hasOwnProperty.call(patch, 'formationLock')) {
                    group.formationLock = patch.formationLock || undefined;
                }
                return true;
            }),
            removeGroup: jasmine.createSpy('removeGroup').and.callFake(async (group: UnitGroup) => {
                groupsSignal.set(groupsSignal().filter(candidate => candidate !== group));
                return true;
            }),
            addGroup: jasmine.createSpy('addGroup').and.callFake((name: string | undefined) => {
                if (!force.loading) {
                    force.instanceId.set('saved-during-add-group');
                }
                const group = {
                    force,
                    name: signal(name),
                    formation: signal<FormationTypeDefinition | null>(automaticFormation),
                    formationLock: false,
                    formationHistory: new Set<string>([automaticFormation.id]),
                    units: signal<ForceUnit[]>([]),
                } as unknown as UnitGroup;
                groupsSignal.set([...groupsSignal(), group]);
                return group;
            }),
            removeEmptyGroups: jasmine.createSpy('removeEmptyGroups').and.callFake(() => {
                groupsSignal.set(groupsSignal().filter((group) => group.units().length > 0));
            }),
            setName: jasmine.createSpy('setName').and.callFake((name: string) => {
                force.name = name;
            }),
            factionLock: false,
            eraLock: false,
        };
        const faction = createFaction(1, 'Mercenary');
        const era = { id: 3151, name: 'ilClan', years: {} } as any;
        const firstUnit = createUnit();
        const secondUnit = { ...createUnit(), id: 2, name: 'Second Mek' } as UnitSummary;

        service.builder = {
            createNewForce: jasmine.createSpy('createNewForce').and.resolveTo(force),
        };
        service.workspace = { selectUnit: jasmine.createSpy('selectUnit') };
        service.admission = {
            admit: jasmine.createSpy('admit').and.callFake(async ({
                summary: unit,
                group: targetGroup,
            }: { summary: UnitSummary; group: UnitGroup }) => {
            addUnitLoadingStates.push(force.loading);
            if (!force.loading) {
                force.instanceId.set('saved-during-add-unit');
            }
            targetGroup.formation.set(automaticFormation);
            targetGroup.formationHistory.add(automaticFormation.id);
            const forceUnit = {
                id: `unit-${createdForceUnits.length + 1}`,
                getSummary: () => unit,
            } as ForceUnit;
            createdForceUnits.push(forceUnit);
            targetGroup.units.set([...targetGroup.units(), forceUnit]);
            return forceUnit;
            }),
        };
        service.crewTransfers = {
            applyGeneratedOverrides: jasmine.createSpy('applyGeneratedOverrides'),
        };
        service.formations = {
            reconcileASFormationAssignments: jasmine.createSpy('reconcileASFormationAssignments'),
        };

        const entry = new LoadForceEntry({
            name: 'Generated Test Force',
            type: GameSystem.ALPHA_STRIKE,
            faction,
            era,
            groups: [
                {
                    name: 'Light Fire',
                    formationId: lightFireFormation.id,
                    units: [{ unit: firstUnit, destroyed: false, skill: 4 }],
                },
                {
                    name: 'Unformed',
                    units: [{ unit: secondUnit, destroyed: false, skill: 4 }],
                },
            ],
        });

        const result = await service.createGeneratedForce(entry);

        expect(result).toBe(force);
        expect(force.faction()).toBe(faction);
        expect(force.era()).toBe(era);
        expect(force.loading).toBeFalse();
        expect(force.instanceId()).toBeNull();
        expect(addUnitLoadingStates).toEqual([true, true]);
        expect(groupsSignal().map((group) => group.name())).toEqual(['Light Fire', 'Unformed']);
        expect(groupsSignal().map((group) => group.formation())).toEqual([lightFireFormation, null]);
        expect(groupsSignal().map((group) => [...group.formationHistory])).toEqual([[lightFireFormation.id], []]);
        expect(groupsSignal().map((group) => group.formationLock)).toEqual([undefined, undefined]);
        expect(service.formations.reconcileASFormationAssignments).toHaveBeenCalledTimes(2);
    });
});

describe('ForceBuilderService remote force updates', () => {
    beforeEach(() => {
        spyOn(Force, 'commitWholeOwnerRetirements').and.callFake((entries, prepare) => {
            const authorities = entries.map(() => Object.freeze({})) as any;
            const finalize = prepare?.(authorities) ?? (() => undefined);
            if (!finalize) return false;
            for (const entry of entries) {
                if (!entry.force.commitWholeOwnerRetirement(entry.token, () => () => undefined)) return false;
            }
            finalize();
            return true;
        });
    });

    function revisionFromSerialized(data: SerializedForce): number | undefined {
        return data.cbt?.forceRevision;
    }

    function createRemoteForce(
        data: SerializedForce,
        units: ForceUnit[] = [],
        groups: UnitGroup[] = [],
    ): Force {
        let lifecycle: 'active' | 'pending' | 'retired' = 'active';
        let pendingToken: object | null = null;
        let replacementAuthority: object | null = null;
        let replacementAuthorityConsumed = false;
        const fingerprintBindings = new WeakMap<object, {
            readonly timestamp: string | null;
            readonly name: string;
            readonly owned: boolean;
            readonly groups: readonly {
                readonly group: UnitGroup;
                readonly id: string;
                readonly units: readonly ForceUnit[];
            }[];
            readonly revision: number | undefined;
        }>();
        const force = {
            name: data.name,
            gameSystem: data.type,
            timestamp: data.timestamp,
            owned: signal(data.owned !== false),
            readOnly: () => lifecycle === 'retired' || !force.owned(),
            instanceId: signal(data.instanceId),
            groups: () => groups,
            units: () => units,
            members: () => units,
            membersInGroup: (group: UnitGroup) => group.units(),
            changed: new Subject<void>(),
            displayName: () => data.name,
            serialize: () => ({
                ...structuredClone(data),
                name: force.name,
                timestamp: force.timestamp ?? data.timestamp,
                owned: force.owned(),
            }),
            hasCBTForceV2: () => data.cbt !== undefined,
            getCBTForceV2Revision: () => revisionFromSerialized(data),
            getWholeOwnerPersistentAuthoritySnapshotJson: () => JSON.stringify({
                ...structuredClone(data),
                name: force.name,
                timestamp: force.timestamp,
                owned: force.owned(),
            }),
            isWholeOwnerActive: () => lifecycle === 'active',
            isWholeOwnerRetired: () => lifecycle === 'retired',
            captureWholeOwnerAuthorityFingerprint: () => {
                const fingerprint = Object.freeze({});
                fingerprintBindings.set(fingerprint, {
                    timestamp: force.timestamp,
                    name: force.name,
                    owned: force.owned(),
                    groups: groups.map(group => ({
                        group,
                        id: group.id,
                        units: [...group.units()],
                    })),
                    revision: revisionFromSerialized(data),
                });
                return fingerprint;
            },
            isWholeOwnerAuthorityFingerprintCurrent: (fingerprint: object) => {
                const binding = fingerprintBindings.get(fingerprint);
                return lifecycle !== 'retired'
                    && binding !== undefined
                    && binding.timestamp === force.timestamp
                    && binding.name === force.name
                    && binding.owned === force.owned()
                    && binding.revision === revisionFromSerialized(data)
                    && binding.groups.length === groups.length
                    && binding.groups.every((entry, index) => entry.group === groups[index]
                        && entry.id === groups[index].id
                        && entry.units.length === groups[index].units().length
                        && entry.units.every((unit, unitIndex) => unit === groups[index].units()[unitIndex]));
            },
            beginWholeOwnerRetirement: () => {
                if (lifecycle !== 'active') return null;
                lifecycle = 'pending';
                pendingToken = Object.freeze({});
                return Object.freeze({ token: pendingToken, ready: Promise.resolve(true) });
            },
            commitWholeOwnerRetirement: (
                token: object,
                prepareReplacement: (authority: object) => (() => void) | null = () => () => undefined,
            ) => {
                if (lifecycle !== 'pending' || token !== pendingToken) return false;
                replacementAuthority = Object.freeze({});
                replacementAuthorityConsumed = false;
                let finalize: (() => void) | null = null;
                try {
                    finalize = prepareReplacement(replacementAuthority);
                } finally {
                    replacementAuthority = null;
                }
                if (!finalize) return false;
                lifecycle = 'retired';
                pendingToken = null;
                finalize();
                return true;
            },
            consumeWholeOwnerReplacementCommitAuthority: (authority: object) => {
                if (authority !== replacementAuthority || replacementAuthorityConsumed) return false;
                replacementAuthorityConsumed = true;
                return true;
            },
            cancelWholeOwnerRetirement: (token: object) => {
                if (lifecycle !== 'pending' || token !== pendingToken) return;
                lifecycle = 'active';
                pendingToken = null;
            },
        } as unknown as Force;
        return force;
    }

    function createUpdateHarness(
        currentData: SerializedForce,
        units: ForceUnit[] = [],
        groups: UnitGroup[] = [],
    ) {
        const service = Object.create(ForceBuilderService.prototype) as any;
        const targetForce = createRemoteForce(currentData, units, groups);
        const expectedSlot = { force: targetForce, alignment: 'friendly', changeSub: null };
        const loadedForces = signal<any[]>([expectedSlot]);
        const selectedUnit = signal<ForceUnit | null>(null);
        service.forcePersistence = {
            saveForce: jasmine.createSpy('saveForce').and.resolveTo(),
            queueForceAutosave: jasmine.createSpy('queueForceAutosave'),
            saveForceAndWaitForCloud: jasmine.createSpy('saveForceAndWaitForCloud').and.resolveTo(),
            drainForceAuthorityPersistence: jasmine.createSpy('drainForceAuthorityPersistence').and.resolveTo(true),
            prepareForceAuthorityRemoval: jasmine.createSpy('prepareForceAuthorityRemoval')
                .and.returnValue(() => undefined),
            stageRemoteForceSnapshot: jasmine.createSpy('stageRemoteForceSnapshot').and.callFake(
                async (serialized: SerializedForce) => Object.freeze({ force: createRemoteForce(serialized) }),
            ),
            acceptRemoteForceSnapshot: jasmine.createSpy('acceptRemoteForceSnapshot').and.resolveTo(),
            prepareRemoteForceSnapshotAcceptance: jasmine.createSpy('prepareRemoteForceSnapshotAcceptance').and.callFake(
                (staged: { force: Force }) => Object.freeze({ force: staged.force }),
            ),
            commitPreparedRemoteForceReplacement: jasmine.createSpy('commitPreparedRemoteForceReplacement').and.callFake(
                (prepared: { force: Force }, predecessor: Force, authority: object) => {
                    if (!predecessor.consumeWholeOwnerReplacementCommitAuthority(authority as any)) {
                        return Object.freeze({ accepted: false, reason: 'PREDECESSOR_NOT_RETIRED' });
                    }
                    return Object.freeze({
                        accepted: true,
                        finalize: () => service.forcePersistence.acceptRemoteForceSnapshot(prepared),
                        persistence: () => Promise.resolve(),
                    });
                },
            ),
            discardPreparedRemoteForceAcceptance: jasmine.createSpy('discardPreparedRemoteForceAcceptance'),
            discardRemoteForceSnapshot: jasmine.createSpy('discardRemoteForceSnapshot'),
        };
        service.logger = {
            warn: jasmine.createSpy('warn'),
            error: jasmine.createSpy('error'),
        };
        service.optionsService = {
            options: () => ({ enableForceSyncConflictDialog: false }),
        };
        service.dialogsService = {
            createDialog: jasmine.createSpy('createDialog'),
        };
        service.forceUrl = {
            setSynchronizationEnabled: jasmine.createSpy('setSynchronizationEnabled'),
            clearQuery: jasmine.createSpy('clearQuery'),
        };
        service.forceDialogs = {
            promptSaveForceIfNeeded: jasmine.createSpy('promptSaveForceIfNeeded').and.resolveTo(true),
            promptSaveAll: jasmine.createSpy('promptSaveAll').and.resolveTo(true),
        };
        service.workspace = {
            loadedForces,
            alignmentFilter: signal<'friendly' | 'enemy' | 'all'>('friendly'),
            selectedUnit,
            followLastModifiedUnit: signal(false),
            getForceSlot: (force: Force) => loadedForces().find(slot => slot.force === force),
            selectUnit: jasmine.createSpy('selectUnit').and.callFake((unit: ForceUnit | null) => selectedUnit.set(unit)),
        };
        service.operations = {
            clearIfNoForces: jasmine.createSpy('clearIfNoForces'),
            promptSaveIfChanged: jasmine.createSpy('promptSaveIfChanged').and.resolveTo(true),
        };
        const slotLifecycle = Object.create(ForceSlotLifecycleService.prototype) as any;
        slotLifecycle.forcePersistence = service.forcePersistence;
        slotLifecycle.logger = service.logger;
        slotLifecycle.workspace = service.workspace;
        slotLifecycle.teardownForceSlot = jasmine.createSpy('teardownForceSlot');
        slotLifecycle.setupForceSlot = jasmine.createSpy('setupForceSlot').and.callFake(
            (force: Force, alignment: string) => ({ force, alignment, changeSub: null }),
        );
        slotLifecycle.activateForceSlot = jasmine.createSpy('activateForceSlot');
        slotLifecycle.disposeDetachedForceSlot = jasmine.createSpy('disposeDetachedForceSlot');
        service.slotLifecycle = slotLifecycle;
        service.unitLoading = { load: jasmine.createSpy('load').and.resolveTo() };
        const remoteSync = Object.create(ForceRemoteSyncService.prototype) as any;
        for (const dependency of ['forcePersistence', 'logger', 'optionsService', 'dialogsService', 'toastService', 'forceUrl']) {
            Object.defineProperty(remoteSync, dependency, {
                configurable: true,
                get: () => service[dependency],
                set: value => { service[dependency] = value; },
            });
        }
        remoteSync.configuredWorkspace = {
            loadedForces,
            selectedUnit,
            followLastModifiedUnit: () => service.workspace.followLastModifiedUnit(),
            getForceSlot: (force: Force) => service.workspace.getForceSlot(force),
            setupForceSlot: (force: Force, alignment: string, activate: boolean) => service.slotLifecycle.setupForceSlot(force, alignment, activate),
            activateForceSlot: (slot: any) => service.slotLifecycle.activateForceSlot(slot),
            teardownForceSlot: (slot: any) => service.slotLifecycle.teardownForceSlot(slot),
            disposeDetachedForceSlot: (slot: any) => service.slotLifecycle.disposeDetachedForceSlot(slot),
            selectUnit: (unit: ForceUnit | null) => service.workspace.selectUnit(unit),
        };
        remoteSync.remoteForceReceiptGeneration = new Map<string, number>();
        remoteSync.remoteForcePublicationQueue = new Map<string, Promise<void>>();
        remoteSync.remoteForceUpdated$ = { next: jasmine.createSpy('next') };
        remoteSync.remoteConflictQueue = Promise.resolve();
        return { service, remoteSync, targetForce, expectedSlot, loadedForces, selectedUnit };
    }

    it('skips a same-timestamp remote snapshot', async () => {
        const currentData = createSerializedForce();
        const { service, remoteSync, targetForce } = createUpdateHarness(currentData);

        await remoteSync.reconcileRemoteForce(targetForce, createSerializedForce());

        expect(service.forcePersistence.acceptRemoteForceSnapshot).not.toHaveBeenCalled();
        expect(service.forcePersistence.discardRemoteForceSnapshot).toHaveBeenCalledTimes(1);
    });

    it('skips an older remote snapshot', async () => {
        const currentData = createSerializedForce();
        const { service, remoteSync, targetForce } = createUpdateHarness(currentData);

        await remoteSync.reconcileRemoteForce(targetForce, createSerializedForce({
            timestamp: '2026-08-06T19:59:00.000Z',
            name: 'Older Force',
        }));

        expect(service.forcePersistence.acceptRemoteForceSnapshot).not.toHaveBeenCalled();
    });

    it('ignores a remote snapshot when its timestamp cannot be compared', async () => {
        const currentData = createSerializedForce();
        const { service, remoteSync, targetForce } = createUpdateHarness(currentData);

        targetForce.timestamp = null;
        await remoteSync.reconcileRemoteForce(targetForce, createSerializedForce());

        targetForce.timestamp = currentData.timestamp;
        await remoteSync.reconcileRemoteForce(targetForce, createSerializedForce({
            timestamp: 'not-a-timestamp',
            name: 'Invalid Remote Force',
        }));

        expect(service.forcePersistence.acceptRemoteForceSnapshot).not.toHaveBeenCalled();
        expect(service.forcePersistence.saveForce).not.toHaveBeenCalled();
        expect(service.forcePersistence.saveForceAndWaitForCloud).not.toHaveBeenCalled();
        expect(service.forcePersistence.discardRemoteForceSnapshot).toHaveBeenCalledTimes(2);
    });

    it('serializes reconnect conflict dialogs across forces', async () => {
        const currentData = createSerializedForce();
        const { service, remoteSync, targetForce: firstForce } = createUpdateHarness(currentData);
        const secondForce = createRemoteForce(createSerializedForce({ instanceId: 'force-2' }));
        service.workspace.loadedForces.update((slots: any[]) => [
            ...slots,
            { force: secondForce, alignment: 'hostile', changeSub: null },
        ]);
        service.optionsService.options = () => ({ enableForceSyncConflictDialog: true });

        let releaseFirstConflict!: () => void;
        const firstConflictReleased = new Promise<void>(resolve => {
            releaseFirstConflict = resolve;
        });
        const conflictSpy = spyOn(remoteSync, 'handleRemoteForceConflict').and.callFake(async (force: Force) => {
            if (force === firstForce) {
                await firstConflictReleased;
            }
        });

        const firstPromise = remoteSync.reconcileRemoteForce(firstForce, createSerializedForce({
            timestamp: '2026-08-06T20:01:00.000Z',
        }), 'reconnect');
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        expect(conflictSpy).toHaveBeenCalledOnceWith(firstForce, jasmine.anything(), jasmine.any(Number));

        const secondPromise = remoteSync.reconcileRemoteForce(secondForce, createSerializedForce({
            instanceId: 'force-2',
            timestamp: '2026-08-06T20:02:00.000Z',
        }), 'reconnect');
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        expect(conflictSpy).toHaveBeenCalledTimes(1);

        releaseFirstConflict();
        await Promise.all([firstPromise, secondPromise]);

        expect(conflictSpy).toHaveBeenCalledTimes(2);
        expect(conflictSpy.calls.argsFor(1)[0]).toBe(secondForce);
    });

    it('pushes the local force when reconnect finds an older owned snapshot', async () => {
        const currentData = createSerializedForce();
        const { service, remoteSync, targetForce } = createUpdateHarness(currentData);

        await remoteSync.reconcileRemoteForce(targetForce, createSerializedForce({
            timestamp: '2026-08-06T19:59:00.000Z',
        }), 'reconnect');

        expect(service.forcePersistence.saveForceAndWaitForCloud).toHaveBeenCalledOnceWith(targetForce);
        expect(service.forcePersistence.acceptRemoteForceSnapshot).not.toHaveBeenCalled();
    });

    it('does not push a local-only force when reconnect finds an older snapshot', async () => {
        const currentData = createSerializedForce({ owned: false });
        const { service, remoteSync, targetForce } = createUpdateHarness(currentData);

        await remoteSync.reconcileRemoteForce(targetForce, createSerializedForce({
            timestamp: '2026-08-06T19:59:00.000Z',
        }), 'reconnect');

        expect(service.forcePersistence.saveForce).not.toHaveBeenCalled();
        expect(service.forcePersistence.acceptRemoteForceSnapshot).not.toHaveBeenCalled();
    });

    it('applies a newer reconnect snapshot without pushing local state', async () => {
        const currentData = createSerializedForce();
        const { service, remoteSync, targetForce } = createUpdateHarness(currentData);
        const incomingData = createSerializedForce({
            timestamp: '2026-08-06T20:01:00.000Z',
        });

        await remoteSync.reconcileRemoteForce(targetForce, incomingData, 'reconnect');

        const replacement = service.workspace.loadedForces()[0].force;
        expect(replacement).not.toBe(targetForce);
        expect(replacement.timestamp).toBe(incomingData.timestamp);
        expect(service.forcePersistence.acceptRemoteForceSnapshot).toHaveBeenCalledTimes(1);
        expect(service.slotLifecycle.teardownForceSlot).toHaveBeenCalledOnceWith(jasmine.objectContaining({ force: targetForce }));
        expect(remoteSync.remoteForceUpdated$.next).toHaveBeenCalledWith({ force: replacement, alignment: 'friendly' });
        expect(service.forcePersistence.saveForce).not.toHaveBeenCalled();
        expect(service.dialogsService.createDialog).not.toHaveBeenCalled();
    });

    it('opens the conflict dialog when the reconnect option is enabled', async () => {
        const currentData = createSerializedForce();
        const { service, remoteSync, targetForce } = createUpdateHarness(currentData);
        const incomingData = createSerializedForce({
            timestamp: '2026-08-06T20:01:00.000Z',
        });
        service.optionsService.options = () => ({ enableForceSyncConflictDialog: true });
        spyOn(remoteSync, 'handleRemoteForceConflict').and.resolveTo();

        await remoteSync.reconcileRemoteForce(targetForce, incomingData, 'reconnect');

        expect(remoteSync.handleRemoteForceConflict).toHaveBeenCalledOnceWith(
            targetForce,
            incomingData,
            jasmine.any(Number),
        );
        expect(service.forcePersistence.acceptRemoteForceSnapshot).not.toHaveBeenCalled();
        // The queue re-stages its retained bytes against the owner that is live
        // when the dialog actually executes; both detached tokens are released.
        expect(service.forcePersistence.discardRemoteForceSnapshot).toHaveBeenCalledTimes(2);
    });

    it('re-arbitrates after delayed staging and rejects a snapshot older than the current live slot', async () => {
        const currentData = createSerializedForce();
        const { service, remoteSync, targetForce } = createUpdateHarness(currentData);
        let releaseStage!: (staged: { force: Force }) => void;
        service.forcePersistence.stageRemoteForceSnapshot.and.returnValue(new Promise(resolve => {
            releaseStage = resolve;
        }));

        const incoming = createSerializedForce({ timestamp: '2026-08-06T20:03:00.000Z' });
        const reconciliation = remoteSync.reconcileRemoteForce(targetForce, incoming);
        targetForce.timestamp = '2026-08-06T20:02:00.000Z';
        releaseStage({ force: createRemoteForce(incoming) });
        await reconciliation;

        expect(service.forcePersistence.acceptRemoteForceSnapshot).not.toHaveBeenCalled();
        expect(service.workspace.loadedForces()[0].force).toBe(targetForce);
        expect(service.forcePersistence.discardRemoteForceSnapshot).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite an edit made while an explicit conflict snapshot is staging', async () => {
        const current = createSerializedForce();
        const incoming = createSerializedForce({ timestamp: '2026-08-06T20:03:00.000Z' });
        const { service, remoteSync, targetForce, expectedSlot } = createUpdateHarness(current);
        let releaseStage!: (staged: { force: Force }) => void;
        service.forcePersistence.stageRemoteForceSnapshot.and.returnValue(new Promise(resolve => {
            releaseStage = resolve;
        }));

        const application = remoteSync.applyRemotePersistenceSnapshot(targetForce, incoming);
        targetForce.timestamp = '2026-08-06T20:02:00.000Z';
        releaseStage({ force: createRemoteForce(incoming) });

        expect(await application).toBeNull();
        expect(service.workspace.loadedForces()[0]).toBe(expectedSlot);
        expect(service.forcePersistence.acceptRemoteForceSnapshot).not.toHaveBeenCalled();
        expect(service.forcePersistence.discardRemoteForceSnapshot).toHaveBeenCalledTimes(1);
    });

    it('treats equal-time divergent CBT revisions as a remote authority update', async () => {
        const timestamp = '2026-08-06T20:00:00.000Z';
        const local = createSerializedForce({
            type: GameSystem.CLASSIC,
            timestamp,
            cbt: createEmptyCBTForceForTest('force-1', 1),
        });
        const incoming = createSerializedForce({
            type: GameSystem.CLASSIC,
            timestamp,
            cbt: createEmptyCBTForceForTest('force-1', 2),
        });
        const { service, remoteSync, targetForce } = createUpdateHarness(local);

        await remoteSync.reconcileRemoteForce(targetForce, incoming);

        expect(service.forcePersistence.acceptRemoteForceSnapshot).toHaveBeenCalledTimes(1);
        expect(service.workspace.loadedForces()[0].force.getCBTForceV2Revision()).toBe(2);
    });

    it('compares equal-time CBT snapshots exactly', async () => {
        const timestamp = '2026-08-06T20:00:00.000Z';
        const envelope = (marker: string) => {
            const base = createEmptyCBTForceForTest('force-1');
            return {
                ...base,
                scenarioRules: { ...base.scenarioRules, values: { marker } },
            };
        };
        const local = createSerializedForce({
            type: GameSystem.CLASSIC,
            timestamp,
            cbt: envelope('local'),
        });
        const { service, remoteSync, targetForce } = createUpdateHarness(local);

        await remoteSync.reconcileRemoteForce(targetForce, structuredClone(local));
        expect(service.forcePersistence.acceptRemoteForceSnapshot).not.toHaveBeenCalled();

        const incoming = createSerializedForce({
            type: GameSystem.CLASSIC,
            timestamp,
            cbt: envelope('remote'),
        });
        await remoteSync.reconcileRemoteForce(targetForce, incoming);

        expect(service.forcePersistence.acceptRemoteForceSnapshot).toHaveBeenCalledTimes(1);
        expect(service.workspace.loadedForces()[0].force.serialize().cbt).toEqual(incoming.cbt);
    });

    it('keeps the later-observed equal-time publication when staging finishes out of order', async () => {
        const current = createSerializedForce();
        const first = createSerializedForce({
            timestamp: '2026-08-06T20:01:00.000Z',
            name: 'First Receipt',
        });
        const second = createSerializedForce({
            timestamp: first.timestamp,
            name: 'Second Receipt',
        });
        const { service, remoteSync, targetForce } = createUpdateHarness(current);
        const firstStage = deferred<{ force: Force }>();
        const secondStage = deferred<{ force: Force }>();
        service.forcePersistence.stageRemoteForceSnapshot.and.returnValues(
            firstStage.promise,
            secondStage.promise,
        );

        const firstReconciliation = remoteSync.reconcileRemoteForce(targetForce, first);
        const secondReconciliation = remoteSync.reconcileRemoteForce(targetForce, second);
        secondStage.resolve({ force: createRemoteForce(second) });
        await secondReconciliation;
        firstStage.resolve({ force: createRemoteForce(first) });
        await firstReconciliation;

        expect(service.workspace.loadedForces()[0].force.displayName()).toBe('Second Receipt');
        expect(service.forcePersistence.acceptRemoteForceSnapshot).toHaveBeenCalledTimes(1);
    });

    it('lets a later receipt publish after an older receipt releases retirement', async () => {
        const current = createSerializedForce();
        const first = createSerializedForce({
            timestamp: '2026-08-06T20:01:00.000Z',
            name: 'First Receipt',
        });
        const second = createSerializedForce({
            timestamp: first.timestamp,
            name: 'Second Receipt',
        });
        const { service, remoteSync, targetForce } = createUpdateHarness(current);
        const drain = deferred<boolean>();
        const beginRetirement = targetForce.beginWholeOwnerRetirement.bind(targetForce);
        let beginCount = 0;
        spyOn(targetForce, 'beginWholeOwnerRetirement').and.callFake(() => {
            const handle = beginRetirement();
            if (!handle) return null;
            beginCount += 1;
            return beginCount === 1
                ? { token: handle.token, ready: drain.promise }
                : handle;
        });

        const firstReconciliation = remoteSync.reconcileRemoteForce(targetForce, first);
        for (let index = 0; index < 12 && beginCount === 0; index += 1) await Promise.resolve();
        const secondReconciliation = remoteSync.reconcileRemoteForce(targetForce, second);
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
        drain.resolve(true);
        await Promise.all([firstReconciliation, secondReconciliation]);

        expect(service.workspace.loadedForces()[0].force.displayName()).toBe('Second Receipt');
        expect(service.forcePersistence.acceptRemoteForceSnapshot).toHaveBeenCalledTimes(1);
    });

    it('does not swap the slot when staged-token acceptance throws synchronously', async () => {
        const { service, remoteSync, targetForce, expectedSlot } = createUpdateHarness(createSerializedForce());
        service.forcePersistence.commitPreparedRemoteForceReplacement.and.callFake(() => {
            throw new Error('already consumed');
        });

        await expectAsync(remoteSync.reconcileRemoteForce(targetForce, createSerializedForce({
            timestamp: '2026-08-06T20:01:00.000Z',
        }))).toBeRejectedWithError('already consumed');

        expect(service.workspace.loadedForces()[0]).toBe(expectedSlot);
        expect(service.slotLifecycle.teardownForceSlot).not.toHaveBeenCalled();
        expect(service.slotLifecycle.setupForceSlot).toHaveBeenCalledTimes(1);
    });

    it('rejects replacement-slot setup failure before retirement or acceptance', async () => {
        const { service, remoteSync, targetForce, expectedSlot } = createUpdateHarness(createSerializedForce());
        const beginRetirement = spyOn(targetForce, 'beginWholeOwnerRetirement').and.callThrough();
        service.slotLifecycle.setupForceSlot.and.throwError('subscription setup failed');

        await remoteSync.reconcileRemoteForce(targetForce, createSerializedForce({
            timestamp: '2026-08-06T20:01:00.000Z',
        }));

        expect(beginRetirement).not.toHaveBeenCalled();
        expect(service.forcePersistence.prepareRemoteForceSnapshotAcceptance).not.toHaveBeenCalled();
        expect(service.workspace.loadedForces()[0]).toBe(expectedSlot);
        expect(service.slotLifecycle.teardownForceSlot).not.toHaveBeenCalled();
    });

    it('preserves exact-ID formation history in a detached Set across replacement', async () => {
        const previousHistory = new Set<string>(['old-formation']);
        const previousGroup = {
            id: 'group-1',
            formationHistory: previousHistory,
            units: signal<ForceUnit[]>([]),
        } as unknown as UnitGroup;
        const replacementGroup = {
            id: 'group-1',
            formationHistory: new Set<string>(['remote-transient']),
            units: signal<ForceUnit[]>([]),
        } as unknown as UnitGroup;
        const current = createSerializedForce();
        const incoming = createSerializedForce({ timestamp: '2026-08-06T20:01:00.000Z' });
        const { service, remoteSync, targetForce } = createUpdateHarness(current, [], [previousGroup]);
        const replacement = createRemoteForce(incoming, [], [replacementGroup]);
        service.forcePersistence.stageRemoteForceSnapshot.and.resolveTo(Object.freeze({ force: replacement }));

        await remoteSync.reconcileRemoteForce(targetForce, incoming);

        expect([...replacementGroup.formationHistory]).toEqual(['old-formation']);
        expect(replacementGroup.formationHistory).not.toBe(previousHistory);
        previousHistory.add('later-old-mutation');
        expect([...replacementGroup.formationHistory]).toEqual(['old-formation']);
    });

    it('waits for retirement drain and captures the final formation history before publication', async () => {
        const history = new Set<string>(['before-drain']);
        const previousGroup = {
            id: 'group-drain',
            formationHistory: history,
            units: signal<ForceUnit[]>([]),
        } as unknown as UnitGroup;
        const replacementGroup = {
            id: 'group-drain',
            formationHistory: new Set<string>(),
            units: signal<ForceUnit[]>([]),
        } as unknown as UnitGroup;
        const current = createSerializedForce();
        const incoming = createSerializedForce({ timestamp: '2026-08-06T20:01:00.000Z' });
        const { service, remoteSync, targetForce, expectedSlot } = createUpdateHarness(current, [], [previousGroup]);
        const replacement = createRemoteForce(incoming, [], [replacementGroup]);
        service.forcePersistence.stageRemoteForceSnapshot.and.resolveTo(Object.freeze({ force: replacement }));
        const drain = deferred<boolean>();
        const beginRetirement = targetForce.beginWholeOwnerRetirement.bind(targetForce);
        spyOn(targetForce, 'beginWholeOwnerRetirement').and.callFake(() => {
            const handle = beginRetirement();
            return handle ? { token: handle.token, ready: drain.promise } : null;
        });

        const reconciliation = remoteSync.reconcileRemoteForce(targetForce, incoming);
        for (let index = 0;
            index < 8 && service.forcePersistence.prepareRemoteForceSnapshotAcceptance.calls.count() === 0;
            index += 1) {
            await Promise.resolve();
        }
        expect(service.workspace.loadedForces()[0]).toBe(expectedSlot);
        expect(service.forcePersistence.commitPreparedRemoteForceReplacement).not.toHaveBeenCalled();

        history.add('during-drain');
        drain.resolve(true);
        await reconciliation;

        expect([...replacementGroup.formationHistory]).toEqual(['before-drain', 'during-drain']);
        expect(service.workspace.loadedForces()[0].force).toBe(replacement);
    });

    it('cancels retirement on cyclic formation history without publishing the replacement', async () => {
        const cyclicHistory = new Set<any>();
        cyclicHistory.add(cyclicHistory);
        const previousGroup = {
            id: 'group-cycle',
            formationHistory: cyclicHistory,
            units: signal<ForceUnit[]>([]),
        } as unknown as UnitGroup;
        const replacementGroup = {
            id: 'group-cycle',
            formationHistory: new Set<string>(),
            units: signal<ForceUnit[]>([]),
        } as unknown as UnitGroup;
        const current = createSerializedForce();
        const incoming = createSerializedForce({ timestamp: '2026-08-06T20:01:00.000Z' });
        const { service, remoteSync, targetForce, expectedSlot } = createUpdateHarness(current, [], [previousGroup]);
        const replacement = createRemoteForce(incoming, [], [replacementGroup]);
        service.forcePersistence.stageRemoteForceSnapshot.and.resolveTo(Object.freeze({ force: replacement }));
        const cancelRetirement = spyOn(targetForce, 'cancelWholeOwnerRetirement').and.callThrough();

        await remoteSync.reconcileRemoteForce(targetForce, incoming);

        expect(cancelRetirement).toHaveBeenCalledTimes(1);
        expect(service.forcePersistence.commitPreparedRemoteForceReplacement).not.toHaveBeenCalled();
        expect(service.workspace.loadedForces()[0]).toBe(expectedSlot);
        expect(service.logger.error).toHaveBeenCalledWith(jasmine.stringMatching(/transient force session state/u));
    });

    it('keeps the replacement published when retired-slot teardown throws', async () => {
        const current = createSerializedForce();
        const incoming = createSerializedForce({ timestamp: '2026-08-06T20:01:00.000Z' });
        const { service, remoteSync, targetForce } = createUpdateHarness(current);
        service.slotLifecycle.teardownForceSlot.and.throwError('hostile teardown');

        await remoteSync.reconcileRemoteForce(targetForce, incoming);

        expect(service.workspace.loadedForces()[0].force).not.toBe(targetForce);
        expect(service.logger.warn).toHaveBeenCalledWith(jasmine.stringMatching(/Could not tear down retired force slot/u));
        expect(remoteSync.remoteForceUpdated$.next).toHaveBeenCalledTimes(1);
    });

    it('remaps selection and subscriptions to the replacement object graph', async () => {
        const oldUnit = { id: 'unit-1' } as unknown as ForceUnit;
        const newUnit = { id: 'unit-1', updatedTs: 0 } as unknown as ForceUnit;
        const current = createSerializedForce();
        const incoming = createSerializedForce({ timestamp: '2026-08-06T20:01:00.000Z' });
        const { service, remoteSync, targetForce, selectedUnit } = createUpdateHarness(current, [oldUnit]);
        selectedUnit.set(oldUnit);
        const replacement = createRemoteForce(incoming, [newUnit]);
        service.forcePersistence.stageRemoteForceSnapshot.and.resolveTo(Object.freeze({ force: replacement }));

        await remoteSync.reconcileRemoteForce(targetForce, incoming);

        expect(selectedUnit()).toBe(newUnit);
        expect(service.workspace.selectUnit).toHaveBeenCalledOnceWith(newUnit);
        expect(service.slotLifecycle.setupForceSlot).toHaveBeenCalledOnceWith(replacement, 'friendly', false);
        expect(service.workspace.loadedForces()[0].force).toBe(replacement);
    });

    it('remaps a selected unit when follow-latest is enabled but every replacement timestamp is pristine', async () => {
        const oldUnit = { id: 'unit-pristine' } as unknown as ForceUnit;
        const newUnit = { id: 'unit-pristine', updatedTs: 0 } as unknown as ForceUnit;
        const current = createSerializedForce();
        const incoming = createSerializedForce({ timestamp: '2026-08-06T20:01:00.000Z' });
        const { service, remoteSync, targetForce, selectedUnit } = createUpdateHarness(current, [oldUnit]);
        selectedUnit.set(oldUnit);
        service.workspace.followLastModifiedUnit = () => true;
        const replacement = createRemoteForce(incoming, [newUnit]);
        service.forcePersistence.stageRemoteForceSnapshot.and.resolveTo(Object.freeze({ force: replacement }));

        await remoteSync.reconcileRemoteForce(targetForce, incoming);

        expect(selectedUnit()).toBe(newUnit);
        expect(service.workspace.selectUnit).toHaveBeenCalledOnceWith(newUnit);
    });

    it('prebuilds a dormant change subscription that cannot save before activation', () => {
        const service = Object.create(ForceSlotLifecycleService.prototype) as any;
        service.activationPlans = new WeakMap();
        service.forcePersistence = {
            saveForce: jasmine.createSpy('saveForce').and.resolveTo(),
            queueForceAutosave: jasmine.createSpy('queueForceAutosave'),
            activateForceAuthority: jasmine.createSpy('activateForceAuthority').and.returnValue(true),
        };
        service.wsService = {
            subscribeToForceUpdates: jasmine.createSpy('subscribeToForceUpdates').and.resolveTo(),
        };
        service.remoteSync = { reconcileRemoteForce: jasmine.createSpy('reconcileRemoteForce') };
        service.logger = {
            info: jasmine.createSpy('info'),
            warn: jasmine.createSpy('warn'),
            error: jasmine.createSpy('error'),
        };
        const changed = new Subject<void>();
        const force = {
            changed,
            owned: () => true,
            instanceId: signal('force-dormant'),
            displayName: () => 'Dormant Force',
        } as unknown as Force;

        const slot = service.setupForceSlot(force, 'friendly', false);
        changed.next();
        expect(service.forcePersistence.saveForce).not.toHaveBeenCalled();
        expect(service.forcePersistence.activateForceAuthority).not.toHaveBeenCalled();

        service.activateForceSlot(slot);
        expect(service.forcePersistence.activateForceAuthority).toHaveBeenCalledOnceWith(force);
        changed.next();
        expect(service.forcePersistence.activateForceAuthority).toHaveBeenCalledTimes(2);
        expect(service.forcePersistence.queueForceAutosave).toHaveBeenCalledOnceWith(force);
        expect(service.forcePersistence.saveForce).not.toHaveBeenCalled();
    });

    it('rejects duplicate durable live unit IDs before beginning retirement', async () => {
        const first = { id: 'duplicate-unit' } as ForceUnit;
        const second = { id: 'duplicate-unit' } as ForceUnit;
        const group = {
            id: 'group-1',
            formationHistory: new Set<string>(),
            units: signal<ForceUnit[]>([first, second]),
        } as unknown as UnitGroup;
        const { service, remoteSync, targetForce, expectedSlot } = createUpdateHarness(
            createSerializedForce(),
            [first, second],
            [group],
        );
        const beginRetirement = spyOn(targetForce, 'beginWholeOwnerRetirement').and.callThrough();

        await remoteSync.reconcileRemoteForce(targetForce, createSerializedForce({
            timestamp: '2026-08-06T20:01:00.000Z',
        }));

        expect(beginRetirement).not.toHaveBeenCalled();
        expect(service.forcePersistence.prepareRemoteForceSnapshotAcceptance).not.toHaveBeenCalled();
        expect(service.workspace.loadedForces()[0]).toBe(expectedSlot);
        expect(service.logger.error).toHaveBeenCalledWith(jasmine.stringMatching(/duplicate durable unit ID/u));
    });

    it('waits for an owner drain before removing and tearing down its exact slot', async () => {
        const { service, targetForce, expectedSlot } = createUpdateHarness(createSerializedForce());
        service.forceDialogs.promptSaveForceIfNeeded = jasmine.createSpy('prompt').and.resolveTo(true);
        const drain = deferred<boolean>();
        const beginRetirement = targetForce.beginWholeOwnerRetirement.bind(targetForce);
        spyOn(targetForce, 'beginWholeOwnerRetirement').and.callFake(() => {
            const handle = beginRetirement();
            return handle ? { token: handle.token, ready: drain.promise } : null;
        });

        const removal = service.removeLoadedForce(targetForce);
        await Promise.resolve();
        expect(service.workspace.loadedForces()[0]).toBe(expectedSlot);
        expect(service.slotLifecycle.teardownForceSlot).not.toHaveBeenCalled();

        drain.resolve(true);
        expect(await removal).toBeTrue();
        expect(service.workspace.loadedForces()).toEqual([]);
        expect(service.slotLifecycle.teardownForceSlot).toHaveBeenCalledOnceWith(expectedSlot);
    });

    it('retries removal with a fresh retirement after a drained CBT acknowledgement refreshes authority', async () => {
        const { service, targetForce, expectedSlot } = createUpdateHarness(createSerializedForce());
        service.forcePersistence.drainForceAuthorityPersistence.and.returnValues(
            Promise.resolve(false),
            Promise.resolve(true),
        );
        const beginRetirement = spyOn(targetForce, 'beginWholeOwnerRetirement').and.callThrough();

        expect(await service.removeLoadedForce(targetForce, { skipPrompt: true })).toBeTrue();

        expect(beginRetirement).toHaveBeenCalledTimes(2);
        expect(service.forcePersistence.drainForceAuthorityPersistence).toHaveBeenCalledTimes(2);
        expect(service.workspace.loadedForces()).toEqual([]);
        expect(service.slotLifecycle.teardownForceSlot).toHaveBeenCalledOnceWith(expectedSlot);
    });

    it('drains in-flight source persistence before publishing a conflict clone', async () => {
        const { service, remoteSync, targetForce, expectedSlot } = createUpdateHarness(createSerializedForce());
        const cloned = createRemoteForce(createSerializedForce({
            instanceId: 'force-conflict-clone',
            name: 'Conflict Clone',
        }));
        (cloned as any).setName = jasmine.createSpy('setCloneName');
        (targetForce as any).cloneForPersistence = jasmine.createSpy('cloneForPersistence').and.resolveTo(cloned);
        const drain = deferred<boolean>();
        service.forcePersistence.drainForceAuthorityPersistence.and.returnValue(drain.promise);
        const fingerprint = targetForce.captureWholeOwnerAuthorityFingerprint();

        const cloning = remoteSync.replaceConflictForceWithClone(
            targetForce,
            expectedSlot,
            'friendly',
            fingerprint,
            () => true,
        );
        for (let index = 0;
            index < 12 && service.forcePersistence.drainForceAuthorityPersistence.calls.count() === 0;
            index += 1) await Promise.resolve();
        expect(service.workspace.loadedForces()[0]).toBe(expectedSlot);
        expect(service.forcePersistence.prepareForceAuthorityRemoval).not.toHaveBeenCalled();

        drain.resolve(true);
        expect(await cloning).toBe(cloned);

        expect(service.forcePersistence.drainForceAuthorityPersistence).toHaveBeenCalledTimes(1);
        expect(service.forcePersistence.prepareForceAuthorityRemoval).toHaveBeenCalledTimes(1);
        expect(service.workspace.loadedForces()[0].force).toBe(cloned);
        expect(service.slotLifecycle.teardownForceSlot).toHaveBeenCalledOnceWith(expectedSlot);
    });

    it('preserves the exact existing owner when loadForce narrows multiple slots', async () => {
        const { service, targetForce, expectedSlot } = createUpdateHarness(createSerializedForce());
        const otherForce = createRemoteForce(createSerializedForce({ instanceId: 'force-other' }));
        const otherSlot = { force: otherForce, alignment: 'enemy', changeSub: null };
        service.workspace.loadedForces.set([expectedSlot, otherSlot]);
        service.addLoadedForce = jasmine.createSpy('addLoadedForce');

        expect(await service.loadForce(targetForce)).toBeTrue();

        expect(service.workspace.loadedForces()).toEqual([expectedSlot]);
        expect(targetForce.isWholeOwnerActive()).toBeTrue();
        expect(otherForce.isWholeOwnerRetired()).toBeTrue();
        expect(service.slotLifecycle.teardownForceSlot).toHaveBeenCalledOnceWith(otherSlot);
        expect(service.addLoadedForce).not.toHaveBeenCalled();
    });

    it('moves a selection from a retiring slot onto the preserved exact owner', async () => {
        const preservedUnit = { id: 'preserved-unit', isLoaded: () => true } as ForceUnit;
        const retiringUnit = { id: 'retiring-unit', isLoaded: () => true } as ForceUnit;
        const { service, targetForce, expectedSlot, selectedUnit } = createUpdateHarness(
            createSerializedForce(),
            [preservedUnit],
        );
        const retiringForce = createRemoteForce(
            createSerializedForce({ instanceId: 'force-retiring-selection' }),
            [retiringUnit],
        );
        const retiringSlot = { force: retiringForce, alignment: 'enemy', changeSub: null };
        service.workspace.loadedForces.set([expectedSlot, retiringSlot]);
        selectedUnit.set(retiringUnit);

        expect(await service.loadForce(targetForce)).toBeTrue();

        expect(service.workspace.loadedForces()).toEqual([expectedSlot]);
        expect(selectedUnit()).toBe(preservedUnit);
        expect(retiringForce.isWholeOwnerRetired()).toBeTrue();
    });

    it('rejects a permanently retired owner before slot setup', async () => {
        const { service } = createUpdateHarness(createSerializedForce());
        const retired = createRemoteForce(createSerializedForce({ instanceId: 'force-retired' }));
        const retirement = retired.beginWholeOwnerRetirement();
        expect(retirement).not.toBeNull();
        expect(await retirement!.ready).toBeTrue();
        expect(retired.commitWholeOwnerRetirement(retirement!.token, () => () => undefined)).toBeTrue();
        service.slotLifecycle.setupForceSlot.calls.reset();

        expect(service.addLoadedForce(retired)).toBeFalse();
        expect(service.slotLifecycle.setupForceSlot).not.toHaveBeenCalled();
        expect(service.workspace.loadedForces().some((slot: any) => slot.force === retired)).toBeFalse();
    });

    it('does not redirect an exact selection from another force that reuses the same unit ID', async () => {
        const removedUnit = { id: 'shared-unit-id' } as ForceUnit;
        const selectedOtherUnit = { id: 'shared-unit-id' } as ForceUnit;
        const { service, targetForce, expectedSlot, selectedUnit } = createUpdateHarness(
            createSerializedForce(),
            [removedUnit],
        );
        const otherForce = createRemoteForce(
            createSerializedForce({ instanceId: 'force-other' }),
            [selectedOtherUnit],
        );
        const otherSlot = { force: otherForce, alignment: 'enemy', changeSub: null };
        service.workspace.loadedForces.set([expectedSlot, otherSlot]);
        selectedUnit.set(selectedOtherUnit);

        expect(await service.removeLoadedForce(targetForce, { skipPrompt: true })).toBeTrue();

        expect(selectedUnit()).toBe(selectedOtherUnit);
        expect(service.workspace.loadedForces()).toEqual([otherSlot]);
    });

    it('blocks removal when a requested save rejects', async () => {
        const service = Object.create(ForceDialogsService.prototype) as any;
        const force = {
            instanceId: () => null,
            units: () => [{}],
            members: () => [{}],
        } as unknown as Force;
        service.dialogs = {
            createDialog: jasmine.createSpy('createDialog').and.returnValue({ closed: of('yes') }),
        };
        service.forcePersistence = {
            saveForce: jasmine.createSpy('saveForce'),
            hasDurableForceIdentity: jasmine.createSpy('hasDurableForceIdentity').and.returnValue(false),
            saveForceAndWaitForCloud: jasmine.createSpy('saveForceAndWaitForCloud')
                .and.rejectWith(new Error('storage unavailable')),
        };
        service.logger = { error: jasmine.createSpy('error') };
        service.toast = { showToast: jasmine.createSpy('showToast') };

        expect(await service.promptSaveForceIfNeeded(force)).toBeFalse();
        expect(service.forcePersistence.saveForce).not.toHaveBeenCalled();
        expect(service.forcePersistence.saveForceAndWaitForCloud).toHaveBeenCalledOnceWith(force);
        expect(service.toast.showToast).toHaveBeenCalledWith(
            'The force could not be saved. It was not removed.',
            'error',
        );
    });

    it('does not load URL force parameters when replacement clearing is cancelled', async () => {
        const service = Object.create(ForceUrlStateService.prototype) as any;
        service.workspace = { clear: jasmine.createSpy('clear').and.resolveTo(false) };
        service.loadForceParamsCore = jasmine.createSpy('loadForceParamsCore').and.resolveTo(true);

        expect(await service.loadForceFromUrlParams(
            new URLSearchParams('instance=force-from-url'),
            'replace',
        )).toBeFalse();

        expect(service.loadForceParamsCore).not.toHaveBeenCalled();
    });

    it('detaches URL force parameters before awaiting replacement clearing', async () => {
        const service = Object.create(ForceUrlStateService.prototype) as any;
        const clearGate = deferred<boolean>();
        service.workspace = { clear: jasmine.createSpy('clear').and.returnValue(clearGate.promise) };
        service.loadForceParamsCore = jasmine.createSpy('loadForceParamsCore').and.resolveTo(true);
        const params = new URLSearchParams('instance=submitted-force');

        const load = service.loadForceFromUrlParams(params, 'replace');
        params.set('instance', 'mutated-force');
        clearGate.resolve(true);
        expect(await load).toBeTrue();

        const submitted = service.loadForceParamsCore.calls.mostRecent().args[0] as URLSearchParams;
        expect(submitted.get('instance')).toBe('submitted-force');
    });

    function createOverlayOwner(instanceId: string, loadGate: ReturnType<typeof deferred<void>>) {
        const loaded = signal(false);
        const unit = {
            id: `${instanceId}-unit`,
            isLoaded: loaded,
            load: jasmine.createSpy('load').and.callFake(async () => {
                await loadGate.promise;
                loaded.set(true);
            }),
        } as unknown as ForceUnit;
        const fingerprint = Object.freeze({});
        const force = {
            instanceId: signal(instanceId),
            units: () => [unit],
            members: () => [unit],
            faction: () => null,
            displayName: () => instanceId,
            readOnly: () => false,
            isWholeOwnerActive: () => true,
            captureWholeOwnerAuthorityFingerprint: jasmine.createSpy('captureFingerprint').and.returnValue(fingerprint),
            isWholeOwnerAuthorityFingerprintCurrent: jasmine.createSpy('fingerprintCurrent').and.returnValue(true),
            c3Networks: () => [],
            setNetworkIfWholeOwnerAuthorityCurrent: jasmine.createSpy('setNetworkIfCurrent').and.returnValue(true),
        } as unknown as Force;
        return { force, unit, fingerprint };
    }

    function createOverlayHarness(forces: Force[]) {
        const service = Object.create(ForceUnitLoadingService.prototype) as any;
        const slots = signal(forces.map(force => ({ force, alignment: 'friendly', changeSub: null })));
        const dialogRef = { close: jasmine.createSpy('close') };
        service.workspace = {
            loadedForces: slots,
            getForceSlot: (force: Force) => slots().find(slot => slot.force === force),
        };
        service.dialogs = {
            createDialog: jasmine.createSpy('createDialog').and.returnValue(dialogRef),
        };
        return { service, slots, dialogRef };
    }

    it('does not expand an in-flight overlay to forces appended to the caller array', async () => {
        const firstGate = deferred<void>();
        const appendedGate = deferred<void>();
        const first = createOverlayOwner('first-overlay', firstGate);
        const appended = createOverlayOwner('appended-overlay', appendedGate);
        const callerForces = [first.force];
        const { service } = createOverlayHarness([first.force, appended.force]);

        const loading = service.load(callerForces);
        expect(first.unit.load).toHaveBeenCalledTimes(1);
        callerForces.push(appended.force);
        firstGate.resolve();
        await loading;

        expect(appended.unit.load).not.toHaveBeenCalled();
        expect(appended.force.captureWholeOwnerAuthorityFingerprint).not.toHaveBeenCalled();
        appendedGate.resolve();
    });

    it('does not clean networks on an owner replaced while its overlay load is pending', async () => {
        const gate = deferred<void>();
        const owner = createOverlayOwner('stale-overlay', gate);
        const { service, slots } = createOverlayHarness([owner.force]);
        const clean = spyOn(C3NetworkEditor, 'clean').and.returnValue([{ id: 'cleaned' }] as any);

        const loading = service.load([owner.force]);
        expect(owner.unit.load).toHaveBeenCalledTimes(1);
        slots.set([]);
        gate.resolve();
        await loading;

        expect(clean).not.toHaveBeenCalled();
        expect(owner.force.setNetworkIfWholeOwnerAuthorityCurrent).not.toHaveBeenCalled();
    });

});

describe('ForceImportService load dialog', () => {
    it('loads a source force from the dialog without resolving its empty instanceId', async () => {
        const service = Object.create(ForceImportService.prototype) as any;
        const sourceForce = Object.create(Force.prototype) as Force;
        (sourceForce as any).instanceId = signal<string | null>(null);

        service.dialogs = {
            createDialog: jasmine.createSpy('createDialog').and.returnValue({
                closed: of({
                    result: sourceForce,
                    mode: 'load',
                    alignment: 'friendly',
                }),
            }),
        };
        service.forcePersistence = {
            getForce: jasmine.createSpy('getForce'),
        };
        service.builder = {
            loadForce: jasmine.createSpy('loadForce').and.resolveTo(true),
        };

        await service.showLoadForceDialog();

        expect(service.forcePersistence.getForce).not.toHaveBeenCalled();
        expect(service.builder.loadForce).toHaveBeenCalledOnceWith(sourceForce);
        expect(sourceForce.instanceId()).toBeNull();
    });
});

describe('ForceBuilderService production V2 unit selection', () => {
    it('admits an eligible native Mek as one retained V2 owner', async () => {
        const unit = {
            ...createUnit(),
            uuid: '019f6767-0dcb-7bb8-992f-aef08202f5e1',
            provider: 'mm-data',
            origin: 'megamek',
            entityType: 'Mek',
            type: 'Mek',
            subtype: 'BattleMek',
            hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
        } as unknown as UnitSummary;
        const instanceId = asUnitInstanceId('unit:production-v2');
        const force = new CBTForce('Force', {} as never, {} as never);
        const admit = spyOn(force, 'admitRetainedUnit').and.resolveTo({ kind: 'admitted', instanceId });
        const member = new CBTForceMember(instanceId, force, createTestMekEntity({
            uuid: unit.uuid,
            chassis: unit.chassis,
            model: unit.model,
        }));
        spyOn(force, 'getClassicMember').and.returnValue(member);
        spyOn(force, 'getRosterGroupId').and.callFake(() => force.groups()[0]?.id ?? null);
        spyOn(force, 'queryCanonicalRoster').and.returnValue({
            kind: 'available',
            snapshot: {
                structural: { members: [{ instanceId }] },
            },
        } as never);

        const service = Object.create(ForceWorkspaceCommandsService.prototype) as any;
        const selectedUnit = signal<any>(null);
        service.workspace = {
            smartCurrentForce: () => force,
            selectedUnit,
            selectUnit: (unit: unknown) => selectedUnit.set(unit),
        };
        service.layoutService = { openMenu: jasmine.createSpy('openMenu') };
        const requestClosePanels = jasmine.createSpy('requestClosePanels');
        service.injector = { get: () => ({ requestClosePanels }) };
        service.logger = jasmine.createSpyObj('LoggerService', ['info', 'error']);
        service.toastService = jasmine.createSpyObj('ToastService', ['showToast']);
        const unitAdmission = Object.create(ForceUnitAdmissionService.prototype) as any;
        unitAdmission.options = {
            options: () => ({
                CBTOptionalRules: { forcedWithdrawal: false, sprinting: false },
            }),
        };
        service.unitAdmission = unitAdmission;
        service.formations = {
            generateFactionAndForceNameIfNeeded: jasmine.createSpy('generateFactionAndForceNameIfNeeded'),
            applyFormationFilterToGroup: jasmine.createSpy('applyFormationFilterToGroup'),
            assignFormationIfNeeded: jasmine.createSpy('assignFormationIfNeeded'),
        };

        const result = await service.addUnit(unit, 3, 4, undefined, GameSystem.CLASSIC);

        expect(result).toEqual(jasmine.objectContaining({
            kind: 'cbt', id: instanceId, force, entity: member.entity,
        }));
        expect(admit).toHaveBeenCalledOnceWith(jasmine.objectContaining({
            identity: { provider: unit.provider, uuid: unit.uuid },
            deployment: { id: 'force-builder-default' },
            scenario: jasmine.objectContaining({
                id: 'megamek',
                ruleset: 'core-2026',
                options: { forcedWithdrawal: false, sprinting: false },
            }),
            crewSkills: { gunnery: 3, piloting: 4 },
        }));
        expect(selectedUnit()).toBe(result);
        expect(service.layoutService.openMenu).toHaveBeenCalledTimes(1);
        expect(requestClosePanels)
            .toHaveBeenCalledOnceWith({ exitExpandedView: true });
        expect(service.formations.generateFactionAndForceNameIfNeeded).toHaveBeenCalledOnceWith(force, true);
    });
});
