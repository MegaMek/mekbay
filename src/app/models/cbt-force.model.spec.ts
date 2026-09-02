// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Injector } from '@angular/core';
import type { DataService } from '../services/data.service';
import { LoggerService } from '../services/logger.service';
import { CBTUnitService, type CBTUnitRestoreWarning } from '../services/cbt-unit.service';
import { ToastService } from '../services/toast.service';
import { DialogsService } from '../services/dialogs.service';
import { ForceDialogsService } from '../services/force-dialogs.service';
import { EquipmentInteractionRegistry } from '../services/equipment-interaction-registry.service';
import { C3Handler } from './runtime/component-c3-configuration';
import { C3EmergencyMasterHandler } from './runtime/component-c3-emergency-master';
import { GameSystem } from './common.model';
import { CBTForce } from './cbt-force.model';
import type { SerializedCBTForce } from './force-serialization';
import {
    CBT_FORCE_MINIMUM_WRITER_VERSION,
    CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
    asForceId,
    emptyRuntimeHistory,
    encounterNetworkFactId,
    type SerializedCBTUnitV2,
    type SerializedCBTForceV2,
    type SerializedForceEncounterEntryV2,
} from './runtime/persistence-v2';
import { asEncounterNetworkId, asEncounterTargetId, type EncounterNetwork } from './runtime/encounter-runtime';
import { RUNTIME_HISTORY_MESSAGE } from './runtime/runtime-history';
import { CBTMekUnit } from './runtime/cbt-mek-unit';
import { decodeForceFromStorage, encodeForceForStorage } from './runtime/force-storage-codec';
import { CBTNonMekUnit } from './runtime/cbt-non-mek-unit';
import type { CBTUnit } from './runtime/cbt-unit';
import { isSerializedNonMekUnit, type SerializedNonMekUnit } from './runtime/non-mek-unit-persistence';
import {
    createDirectC3MasterRuntimeFixture,
    createDirectMekRuntimeFixture,
} from './runtime/testing/direct-mek-runtime-fixture';
import type { UnitSummary } from './unit-summary.model';
import { TestBattleArmorEntity, TestTankEntity } from './entity/testing/test-entities';
import { createTestEquipmentRegistry } from './entity/testing/test-equipment-registry';
import { EntityMountedEquipment } from './entity/types';
import { AmmoEquipment, MiscEquipment, WeaponEquipment } from './equipment.model';
import { asComponentId } from './entity/entity-identifiers';
import type { BaseEntity } from './entity/base-entity';
import { CORE_2026_RULESET } from './cbt-ruleset.model';
import { MM_DATA_UNIT_PROVIDER_ID, asUnitUuid } from '../services/unit-catalog/unit-catalog.types';
import type { UnitCover } from './unit-cover.model';
import { hasNonMekRuntime, hasMekRuntime } from './cbt-unit-snapshot';
import { OptionsService } from '../services/options.service';

const dataService = {
    getFactionById: () => null,
    getEraById: () => null,
} as unknown as DataService;

const optionsService = {
    options: () => ({
        CBTRules: CORE_2026_RULESET,
        CBTOptionalRules: { forcedWithdrawal: true, sprinting: false },
    }),
} as unknown as OptionsService;

const injector = {
    get: (token: unknown) => token === OptionsService
        ? optionsService
        : jasmine.createSpyObj<LoggerService>('LoggerService', ['error', 'warn']),
} as unknown as Injector;

function emptySerializedEncounterV2(): SerializedForceEncounterEntryV2 {
    return {
        encounterRevision: 0,
        state: { schemaVersion: 2, encounterRevision: 0, facts: [] },
    };
}

function directForceRecord(): SerializedCBTForce {
    const forceId = asForceId('force:encounter');
    const cbt: SerializedCBTForceV2 = {
        schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
        minimumWriterVersion: CBT_FORCE_MINIMUM_WRITER_VERSION,
        forceId,
        forceRevision: 0,
        history: emptyRuntimeHistory(),
        units: [],
        roster: { schemaVersion: 1, groups: [] },
        encounter: emptySerializedEncounterV2(),
    };
    return {
        version: 2,
        timestamp: '2026-01-01T00:00:00.000Z',
        instanceId: forceId,
        type: GameSystem.CBT,
        name: 'Encounter force',
        cbt,
    };
}

async function loadForce(record: SerializedCBTForce = directForceRecord()): Promise<CBTForce> {
    return CBTForce.deserialize(structuredClone(record), dataService, injector);
}

function mekRuntimeSnapshot(force: CBTForce, instanceId: string) {
    const snapshot = force.getUnitSnapshot(instanceId);
    if (!snapshot || !hasMekRuntime(snapshot)) throw new Error(`Missing Mek runtime ${instanceId}`);
    return snapshot;
}

function entityRuntimeSnapshot(force: CBTForce, instanceId: string) {
    const snapshot = force.getUnitSnapshot(instanceId);
    if (!snapshot || !hasNonMekRuntime(snapshot)) throw new Error(`Missing Non-Mek runtime ${instanceId}`);
    return snapshot;
}

async function readyCloneForce(): Promise<{
    readonly force: CBTForce;
    readonly armorFaceId: ReturnType<typeof createDirectMekRuntimeFixture>['index']['armorFaces'] extends ReadonlyMap<infer T, unknown> ? T : never;
    readonly createTargetForce: () => Promise<CBTForce>;
    readonly reload: (record: SerializedCBTForce) => Promise<CBTForce>;
}> {
    const fixture = createDirectC3MasterRuntimeFixture();
    const initializeOptions = {
        initializerRevision: 1,
        profileId: 'pristine',
        deployment: { id: 'default' },
        scenario: { id: 'megamek', ruleset: 'core-2026' as const },
    };
    const firstId = 'unit:clone:first';
    const secondId = 'unit:clone:second';
    const first = await CBTMekUnit.createFromEntity({
        uuid: fixture.identity,
        instanceId: firstId,
    }, fixture.entity, fixture.identity, initializeOptions);
    const second = await CBTMekUnit.createFromEntity({
        uuid: fixture.identity,
        instanceId: secondId,
    }, fixture.entity, fixture.identity, initializeOptions);
    const armorFaceId = [...fixture.index.armorFaces.keys()][0]!;
    const damaged = first.getInstance().dispatch({
        type: 'damage-armor',


        faceId: armorFaceId,
        amount: 1,
        target: 'committed',
    });
    if (!damaged.accepted) throw new Error('Ready clone fixture damage failed');
    const firstUnit = first.serialize();
    const secondUnit = second.serialize();
    const componentId = fixture.equipmentComponent('Test C3 Master').id;
    const forceId = asForceId('force:ready-clone');
    const cbt: SerializedCBTForceV2 = {
        schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
        minimumWriterVersion: CBT_FORCE_MINIMUM_WRITER_VERSION,
        forceId,
        forceRevision: 7,
        history: emptyRuntimeHistory(),
        units: [
            { instanceId: firstId, stateRevision: firstUnit.stateRevision, unit: firstUnit },
            { instanceId: secondId, stateRevision: secondUnit.stateRevision, unit: secondUnit },
        ],
        roster: {
            schemaVersion: 1,
            groups: [{
                groupId: 'group:clone-source',
                order: 0,
                name: 'Clone source',
                members: [
                    { instanceId: firstId, order: 0, commander: true },
                    { instanceId: secondId, order: 1 },
                ],
            }],
        },
        encounter: {
            encounterRevision: 3,
            state: {
                schemaVersion: 2,
                encounterRevision: 3,
                facts: [{
                    kind: 'network',
                    factId: encounterNetworkFactId('network:clone-source'),
                    network: {
                        id: 'network:clone-source',
                        networkType: 'c3',
                        color: '#123456',
                        endpoints: [
                            { instanceId: firstId, componentId, role: 'master' },
                            { instanceId: secondId, componentId, role: 'member' },
                        ],
                    },
                }],
            },
        },
    };
    const summary = {
        name: 'Direct Fixture DF-1',
        chassis: 'Direct Fixture',
        model: 'DF-1',
        provider: MM_DATA_UNIT_PROVIDER_ID,
        uuid: fixture.identity,
        entityType: 'Mek',
    } as unknown as UnitSummary;
    const localData = {
        getFactionById: () => null,
        getEraById: () => null,
        getUnitByUuid: () => summary,
    } as unknown as DataService;
    const cbtUnits = {
        restore: async (saved: SerializedCBTUnitV2) => ({
            unit: await CBTMekUnit.restoreFromEntity(
                saved,
                fixture.entity,
                fixture.identity,
                initializeOptions,
            ),
            warnings: [],
        }),
    } as unknown as CBTUnitService;
    const localInjector = {
        get: (token: unknown) => token === CBTUnitService
            ? cbtUnits
            : token === OptionsService
                ? optionsService
            : token === ToastService
                ? jasmine.createSpyObj<ToastService>('ToastService', ['showToast'])
                : jasmine.createSpyObj<LoggerService>('LoggerService', ['error', 'warn']),
    } as unknown as Injector;
    const record: SerializedCBTForce = {
        version: 2,
        timestamp: '2026-01-01T00:00:00.000Z',
        instanceId: forceId,
        type: GameSystem.CBT,
        name: 'Ready clone force',
        cbt,
    };
    const force = await CBTForce.deserialize(record, localData, localInjector);
    const createTargetForce = async (): Promise<CBTForce> => {
        const target = new CBTForce('Transfer target', localData, localInjector);
        await target.addGroup('Target lance');
        return target;
    };
    const reload = async (saved: SerializedCBTForce): Promise<CBTForce> => {
        return CBTForce.deserialize(saved, localData, localInjector);
    };
    return { force, armorFaceId, createTargetForce, reload };
}

async function readyEntityForce(options: Readonly<{
    readonly supportsAirborne?: boolean;
    readonly entity?: BaseEntity;
    readonly restoreWarning?: CBTUnitRestoreWarning;
}> = {}): Promise<{
    readonly force: CBTForce;
    readonly instanceId: string;
    readonly createTargetForce: () => Promise<CBTForce>;
    readonly reload: (record: SerializedCBTForce) => Promise<CBTForce>;
    readonly dialogs: jasmine.SpyObj<DialogsService>;
    readonly cbtUnits: jasmine.SpyObj<CBTUnitService>;
}> {
    const entity = options.entity ?? new TestTankEntity();
    if (options.supportsAirborne) entity.motiveType.set('WiGE');
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2');
    entity.uuid.set(uuid);
    entity.setTonnage(20);
    const identity = uuid;
    const instanceId = 'unit:entity:tank';
    const ready = CBTNonMekUnit.create(entity, {
        instanceId,
        uuid: identity,
        deployment: { id: 'default' },
        scenario: { id: 'megamek', ruleset: CORE_2026_RULESET },
        initialStateProfileId: 'pristine-non-mek-v1',
    });
    const serialized = ready.serialize();
    const forceId = asForceId('force:ready-entity');
    const cbt: SerializedCBTForceV2 = {
        schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
        minimumWriterVersion: CBT_FORCE_MINIMUM_WRITER_VERSION,
        forceId,
        forceRevision: 0,
        history: emptyRuntimeHistory(),
        units: [{ instanceId, stateRevision: serialized.stateRevision, unit: serialized }],
        roster: {
            schemaVersion: 1,
            groups: [{
                groupId: 'group:entity-source',
                order: 0,
                name: 'Vehicle source',
                members: [{ instanceId, order: 0 }],
            }],
        },
        encounter: emptySerializedEncounterV2(),
    };
    const summary = {
        name: entity.displayName(),
        chassis: entity.chassis(),
        model: '',
        provider: MM_DATA_UNIT_PROVIDER_ID,
        uuid,
        entityType: entity.entityType,
        bv: 0,
    } as unknown as UnitSummary;
    const localData = {
        getFactionById: () => null,
        getEraById: () => null,
        getUnitByUuid: () => summary,
    } as unknown as DataService;
    const cbtUnits = jasmine.createSpyObj<CBTUnitService>(
        'CBTUnitService',
        ['restore', 'create'],
    );
    cbtUnits.restore.and.callFake(
        (
            saved: SerializedCBTUnitV2 | SerializedNonMekUnit,
            _scenario: Parameters<CBTUnitService['restore']>[1],
        ) => {
            if (!isSerializedNonMekUnit(saved)) throw new Error('Expected a non-Mek fixture');
            return Promise.resolve({
                unit: CBTNonMekUnit.restore(saved, entity, identity, _scenario),
                warnings: options.restoreWarning === undefined
                    ? []
                    : [options.restoreWarning],
            });
        },
    );
    cbtUnits.create.and.callFake((
            request: Parameters<CBTUnitService['create']>[0],
        ) => Promise.resolve(CBTNonMekUnit.create(entity, {
            instanceId: request.instanceId,
            uuid: identity,
            deployment: request.deployment,
            scenario: request.scenario,
            initialStateProfileId: request.initialStateProfileId ?? 'pristine-non-mek-v1',
        })));
    const dialogs = jasmine.createSpyObj<DialogsService>('DialogsService', ['showNotice']);
    dialogs.showNotice.and.resolveTo();
    const localInjector = {
        get: (token: unknown) => token === CBTUnitService
            ? cbtUnits
            : token === OptionsService
                ? optionsService
            : token === DialogsService
                ? dialogs
                : jasmine.createSpyObj<LoggerService>('LoggerService', ['error', 'warn']),
    } as unknown as Injector;
    const record: SerializedCBTForce = {
        version: 2,
        timestamp: '2026-01-01T00:00:00.000Z',
        instanceId: forceId,
        type: GameSystem.CBT,
        name: 'Ready entity force',
        cbt,
    };
    const force = await CBTForce.deserialize(record, localData, localInjector);
    const createTargetForce = async (): Promise<CBTForce> => {
        const target = new CBTForce('Entity transfer target', localData, localInjector);
        await target.addGroup('Vehicle target');
        return target;
    };
    const reload = async (saved: SerializedCBTForce): Promise<CBTForce> => {
        return CBTForce.deserialize(saved, localData, localInjector);
    };
    return { force, instanceId, createTargetForce, reload, dialogs, cbtUnits };
}

async function readyEntityC3Force(
    system: 'c3i' | 'nova' = 'c3i',
): Promise<Readonly<{
    force: CBTForce;
    firstId: string;
    secondId: string;
    componentId: ReturnType<typeof asComponentId>;
    dialogs: jasmine.SpyObj<DialogsService>;
}>> {
    const c3 = new MiscEquipment({
        id: system === 'nova' ? 'TestNovaCEWS' : 'TestC3i',
        name: system === 'nova' ? 'Nova CEWS' : 'C3i Computer',
        type: 'misc',
        flags: system === 'nova' ? ['F_NOVA', 'F_ECM', 'F_BAP'] : ['F_C3I'],
    });
    const entity = new TestTankEntity(createTestEquipmentRegistry({ [c3.id]: c3 }));
    const componentId = asComponentId(system);
    entity.setEquipment([new EntityMountedEquipment({
        mountId: componentId,
        equipmentId: c3.id,
        equipment: c3,
        allocation: { kind: 'location', location: 'Front' },
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored: false,
    })]);
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e3');
    entity.uuid.set(uuid);
    entity.setTonnage(20);
    const identity = uuid;
    const firstId = 'unit:entity:c3:first';
    const secondId = 'unit:entity:c3:second';
    const create = (instanceId: string) => CBTNonMekUnit.create(entity, {
        instanceId,
        uuid: identity,
        deployment: { id: 'default' },
        scenario: { id: 'megamek', ruleset: CORE_2026_RULESET },
        initialStateProfileId: 'pristine-non-mek-v1',
    });
    const first = create(firstId).serialize();
    const second = create(secondId).serialize();
    const forceId = asForceId('force:ready-entity-c3');
    const cbt: SerializedCBTForceV2 = {
        schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
        minimumWriterVersion: CBT_FORCE_MINIMUM_WRITER_VERSION,
        forceId,
        forceRevision: 0,
        history: emptyRuntimeHistory(),
        units: [
            { instanceId: firstId, stateRevision: first.stateRevision, unit: first },
            { instanceId: secondId, stateRevision: second.stateRevision, unit: second },
        ],
        roster: {
            schemaVersion: 1,
            groups: [{
                groupId: 'group:entity-c3',
                order: 0,
                name: system === 'nova' ? 'Vehicle Nova' : 'Vehicle C3i',
                members: [
                    { instanceId: firstId, order: 0 },
                    { instanceId: secondId, order: 1 },
                ],
            }],
        },
        encounter: emptySerializedEncounterV2(),
    };
    const summary = {
        name: entity.displayName(), chassis: entity.chassis(), model: '',
        provider: MM_DATA_UNIT_PROVIDER_ID, uuid, entityType: entity.entityType, bv: 0,
    } as unknown as UnitSummary;
    const localData = {
        getFactionById: () => null,
        getEraById: () => null,
        getUnitByUuid: () => summary,
    } as unknown as DataService;
    const cbtUnits = {
        restore: (saved: SerializedNonMekUnit, scenario: Parameters<CBTUnitService['restore']>[1]) =>
            Promise.resolve({
                unit: CBTNonMekUnit.restore(saved, entity, identity, scenario),
                warnings: [],
            }),
    } as unknown as CBTUnitService;
    const dialogs = jasmine.createSpyObj<DialogsService>('DialogsService', ['showNotice']);
    dialogs.showNotice.and.resolveTo();
    const localInjector = {
        get: (token: unknown) => token === CBTUnitService
            ? cbtUnits
            : token === OptionsService
                ? optionsService
            : token === DialogsService
                ? dialogs
            : token === ToastService
                ? jasmine.createSpyObj<ToastService>('ToastService', ['showToast'])
                : jasmine.createSpyObj<LoggerService>('runtime service', ['error', 'warn']),
    } as unknown as Injector;
    const record: SerializedCBTForce = {
        version: 2,
        timestamp: '2026-01-01T00:00:00.000Z',
        instanceId: forceId,
        type: GameSystem.CBT,
        name: 'Ready Entity C3 force',
        cbt,
    };
    const force = await CBTForce.deserialize(record, localData, localInjector);
    return Object.freeze({ force, firstId, secondId, componentId, dialogs });
}

async function readyC3Force(owned = true): Promise<{
    readonly force: CBTForce;
    readonly masterId: string;
    readonly emergencyId: string;
    readonly masterComponentId: ReturnType<typeof createDirectMekRuntimeFixture>['index']['components'] extends ReadonlyMap<infer T, unknown> ? T : never;
    readonly emergencyComponentId: ReturnType<typeof createDirectMekRuntimeFixture>['index']['components'] extends ReadonlyMap<infer T, unknown> ? T : never;
    readonly toast: jasmine.SpyObj<ToastService>;
    readonly forceDialogs: jasmine.SpyObj<ForceDialogsService>;
    readonly c3DialogOpened: Promise<void>;
}> {
    const masterFixture = createDirectC3MasterRuntimeFixture(undefined, 'unit:c3-force-master');
    const emergencyFixture = createDirectMekRuntimeFixture(undefined, 'unit:c3-force-emergency');
    const memberFixture = createDirectMekRuntimeFixture(undefined, 'unit:c3-force-member');
    const masterId = 'unit:c3-force-master';
    const emergencyId = 'unit:c3-force-emergency';
    const memberId = 'unit:c3-force-member';
    const initializeOptions = {
        initializerRevision: 1,
        profileId: 'pristine',
        deployment: { id: 'default' },
        scenario: { id: 'megamek', ruleset: 'core-2026' as const },
    };
    const master = await CBTMekUnit.createFromEntity(
        { uuid: masterFixture.identity, instanceId: masterId },
        masterFixture.entity,
        masterFixture.identity,
        initializeOptions,
    );
    const emergency = await CBTMekUnit.createFromEntity(
        { uuid: emergencyFixture.identity, instanceId: emergencyId },
        emergencyFixture.entity,
        emergencyFixture.identity,
        initializeOptions,
    );
    const member = await CBTMekUnit.createFromEntity(
        { uuid: memberFixture.identity, instanceId: memberId },
        memberFixture.entity,
        memberFixture.identity,
        initializeOptions,
    );
    const masterComponentId = masterFixture.equipmentComponent('Test C3 Master').id;
    const emergencyComponentId = emergencyFixture.equipmentComponent('Test C3 Emergency Master').id;
    const memberComponentId = memberFixture.equipmentComponent('Test C3 Emergency Master').id;
    const memberOff = member.getInstance().dispatch({
        type: 'edit-c3-emergency-master',


        componentId: memberComponentId,
        edit: { kind: 'toggle-requested', turningOn: false },
    });
    if (!memberOff.accepted) throw new Error('C3 member setup failed');
    const readyById = new Map<string, {
        ready: CBTMekUnit;
        fixture: ReturnType<typeof createDirectMekRuntimeFixture>;
    }>([
        [masterId, { ready: master, fixture: masterFixture }],
        [emergencyId, { ready: emergency, fixture: emergencyFixture }],
        [memberId, { ready: member, fixture: memberFixture }],
    ] as const);
    const forceId = asForceId('force:c3-runtime');
    const units = [...readyById].map(([instanceId, entry]) => {
        const unit = entry.ready.serialize();
        return { instanceId, stateRevision: unit.stateRevision, unit };
    });
    const cbt: SerializedCBTForceV2 = {
        schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
        minimumWriterVersion: CBT_FORCE_MINIMUM_WRITER_VERSION,
        forceId,
        forceRevision: 0,
        history: emptyRuntimeHistory(),
        units,
        roster: {
            schemaVersion: 1,
            groups: [{
                groupId: 'group:c3-runtime',
                order: 0,
                name: 'C3 Lance',
                members: units.map((unit, order) => ({
                    instanceId: unit.instanceId,
                    order,
                })),
            }],
        },
        encounter: {
            encounterRevision: 0,
            state: {
                schemaVersion: 2,
                encounterRevision: 0,
                facts: [{
                    kind: 'network',
                    factId: encounterNetworkFactId('network:c3-runtime'),
                    network: {
                        id: 'network:c3-runtime',
                        networkType: 'c3',
                        color: '#123456',
                        endpoints: [
                            { instanceId: emergencyId, componentId: emergencyComponentId, role: 'member' },
                            { instanceId: masterId, componentId: masterComponentId, role: 'master' },
                            { instanceId: memberId, componentId: memberComponentId, role: 'member' },
                        ],
                    },
                }],
            },
        },
    };
    const summary = {
        name: 'Direct Fixture DF-1',
        chassis: 'Direct Fixture',
        model: 'DF-1',
        provider: MM_DATA_UNIT_PROVIDER_ID,
        uuid: masterFixture.identity,
    } as unknown as UnitSummary;
    const localData = {
        getFactionById: () => null,
        getEraById: () => null,
        getUnitByUuid: () => summary,
        getEquipmentRegistry: () => emergencyFixture.equipment,
    } as unknown as DataService;
    const cbtUnits = {
        restore: async (saved: SerializedCBTUnitV2) => {
            const entry = readyById.get(saved.instanceId);
            if (!entry) throw new Error(`Unknown C3 fixture ${saved.instanceId}`);
            return {
                unit: await CBTMekUnit.restoreFromEntity(
                    saved,
                    entry.fixture.entity,
                    entry.fixture.identity,
                    initializeOptions,
                ),
                warnings: [],
            };
        },
    } as unknown as CBTUnitService;
    const toast = jasmine.createSpyObj<ToastService>('ToastService', ['showToast']);
    const dialogs = jasmine.createSpyObj<DialogsService>(
        'DialogsService',
        ['createDialog', 'showError', 'showNoticeHtml'],
    );
    const equipmentInteractions = new EquipmentInteractionRegistry();
    equipmentInteractions.register(new C3Handler());
    equipmentInteractions.register(new C3EmergencyMasterHandler());
    let notifyC3DialogOpened!: () => void;
    const c3DialogOpened = new Promise<void>(resolve => { notifyC3DialogOpened = resolve; });
    const forceDialogs = jasmine.createSpyObj<ForceDialogsService>('ForceDialogsService', ['openC3Network']);
    forceDialogs.openC3Network.and.callFake(async () => { notifyC3DialogOpened(); });
    const localInjector = {
        get: (token: unknown) => token === CBTUnitService
            ? cbtUnits
            : token === OptionsService
                ? optionsService
            : token === ToastService
                ? toast
                : token === DialogsService
                    ? dialogs
                    : token === EquipmentInteractionRegistry
                        ? equipmentInteractions
                        : token === ForceDialogsService
                            ? forceDialogs
                            : jasmine.createSpyObj<LoggerService>('LoggerService', ['error', 'warn']),
    } as unknown as Injector;
    const record: SerializedCBTForce = {
        version: 2,
        timestamp: '2026-01-01T00:00:00.000Z',
        instanceId: forceId,
        type: GameSystem.CBT,
        name: 'C3 runtime force',
        owned,
        cbt,
    };
    const force = await CBTForce.deserialize(record, localData, localInjector);
    return {
        force,
        masterId,
        emergencyId,
        masterComponentId,
        emergencyComponentId,
        toast,
        forceDialogs,
        c3DialogOpened,
    };
}

function createTarget(force: CBTForce): void {
    const snapshot = force.queryInventoryControlTargetRegistry();
    const letter = String.fromCharCode(65 + snapshot.targets.length);
    const result = force.dispatchInventoryControlTargetRegistry({
        kind: 'create-target',

        target: {
            id: asEncounterTargetId(`target:${letter}`),
            letter,
            name: `Target ${letter}`,
            color: '#123456',
            source: 'manual',
        },
    });
    if (!result.accepted) throw new Error('Target creation failed');
}

function updateTarget(
    force: CBTForce,
    targetId: ReturnType<typeof asEncounterTargetId>,
    patch: Readonly<Record<string, unknown>>,
): void {
    const snapshot = force.queryInventoryControlTargetRegistry();
    const result = force.dispatchInventoryControlTargetRegistry({
        kind: 'update-target',

        targetId,
        patch: patch as never,
    });
    if (!result.accepted) throw new Error('Target update failed');
}

describe('CBTForce V2 encounter persistence', () => {
    it('shows transient unit restoration warnings after loading succeeds', async () => {
        const warning: CBTUnitRestoreWarning = {
            unitName: 'Vedette',
            code: 'SOURCE_REVISION_CHANGED',
            message: 'The source file changed.',
        };
        const { dialogs } = await readyEntityForce({ restoreWarning: warning });

        expect(dialogs.showNotice).toHaveBeenCalledOnceWith(
            `• Unit "${warning.unitName}": ${warning.message}`,
            'Save Loaded with Warnings',
        );
    });

    it('loads V2 best effort and drops unsupported unit state without preserving its shape', async () => {
        const { force, instanceId, reload, dialogs } = await readyEntityForce();
        const unsupported = structuredClone(await force.serializeForPersistence()) as SerializedCBTForce;
        const envelope = unsupported.cbt;
        const entry = envelope.units[0]!;
        if (!isSerializedNonMekUnit(entry.unit)) throw new Error('Expected a non-Mek V2 fixture');
        const positionId = entry.unit.deployment.values.crewAssignment.positions[0]!.positionId;
        Reflect.set(entry.unit, 'conditions', ['not-a-condition']);
        Reflect.set(entry.unit, 'crewState', [{
            positionId,
            wounds: 1,
            unconscious: false,
            ejected: false,
            state: 'killed',
        }]);

        const restored = await reload(unsupported);
        const snapshot = entityRuntimeSnapshot(restored, instanceId);
        const rewritten = await restored.serializeForPersistence();

        expect(snapshot.state.conditions.size).toBe(0);
        expect(snapshot.state.crew.get(positionId)).toBeUndefined();
        expect(JSON.stringify(rewritten)).not.toContain('not-a-condition');
        expect(JSON.stringify(rewritten)).not.toContain('"state":"killed"');
        expect(dialogs.showNotice).toHaveBeenCalledOnceWith(
            '• 1 unit had unreadable saved state and was reset to pristine.',
            'Save Loaded with Warnings',
        );
    });

    it('skips an unavailable V2 catalog unit and removes its force references', async () => {
        const {
            force,
            instanceId,
            reload,
            dialogs,
            cbtUnits,
        } = await readyEntityForce();
        const saved = structuredClone(await force.serializeForPersistence()) as SerializedCBTForce;
        Reflect.set(saved.cbt!, 'history', { u: [instanceId], t: [] });
        dialogs.showNotice.calls.reset();
        cbtUnits.restore.and.rejectWith(new Error('Unit not found'));
        cbtUnits.create.and.rejectWith(new Error('Unit not found'));

        const restored = await reload(saved);
        const rewritten = await restored.serializeForPersistence();

        expect(restored.getUnitSnapshot(instanceId)).toBeNull();
        expect(rewritten.cbt!.units).toEqual([]);
        expect(rewritten.cbt!.roster.groups[0].members).toEqual([]);
        expect(rewritten.cbt!.history).toEqual({ u: [], t: [] });
        expect(dialogs.showNotice).toHaveBeenCalledOnceWith(
            '• 1 unit was not found in the catalog and was skipped.',
            'Save Loaded with Warnings',
        );
    });

    it('keeps a V2 catalog unit when its deployment data is unreadable', async () => {
        const { force, instanceId, reload, dialogs } = await readyEntityForce();
        const saved = structuredClone(await force.serializeForPersistence()) as SerializedCBTForce;
        const unit = saved.cbt!.units[0]!.unit;
        if (!isSerializedNonMekUnit(unit)) throw new Error('Expected a non-Mek V2 fixture');
        Reflect.set(unit.deployment, 'values', { id: 'broken', crewAssignment: 'garbage' });
        dialogs.showNotice.calls.reset();

        const restored = await reload(saved);
        const rewritten = await restored.serializeForPersistence();

        expect(restored.getUnitSnapshot(instanceId)).not.toBeNull();
        expect(rewritten.cbt!.units.map(entry => entry.instanceId)).toEqual([instanceId]);
        expect(dialogs.showNotice).toHaveBeenCalledOnceWith(
            '• 1 unit had unreadable saved state and was reset to pristine.',
            'Save Loaded with Warnings',
        );
    });

    it('owns new groups in the canonical roster and projects the same group handles', async () => {
        const force = new CBTForce('New force', dataService, injector);
        const alpha = await force.addGroup('Alpha Lance');
        const beta = await force.addGroup('Beta Lance');

        expect(force.groups()).toEqual([alpha, beta]);
        expect(force.groups().map(group => [group.id, group.name()])).toEqual([
            [alpha.id, 'Alpha Lance'],
            [beta.id, 'Beta Lance'],
        ]);

        const renamed = await force.updateRosterGroup(alpha, { name: 'Command Lance' });
        expect(renamed.accepted).toBeTrue();
        const reordered = await force.reorderRosterGroup(1, 0);
        expect(reordered.accepted).toBeTrue();
        const removed = await force.removeRosterGroup(alpha);
        expect(removed.accepted).toBeTrue();

        const saved = await force.serializeForPersistence();
        expect('scenarioRules' in saved.cbt!).toBeFalse();
        expect(saved.cbt?.roster.groups.map(group => [group.groupId, group.name])).toEqual([
            [beta.id, 'Beta Lance'],
        ]);
        expect(force.groups()).toEqual([beta]);
    });

    it('round-trips the typed target registry', async () => {
        const force = await loadForce();
        createTarget(force);
        const targetId = force.queryInventoryControlTargetRegistry().targets[0].id;
        updateTarget(force, targetId, { name: 'Primary' });

        const saved = await force.serializeForPersistence();
        expect(saved.cbt?.encounter.state.facts.map(fact => fact.kind)).toEqual(['target']);

        const reloaded = await loadForce(saved as SerializedCBTForce);
        expect(reloaded.queryInventoryControlTargetRegistry().targets
            .find(candidate => candidate.id === targetId)?.name).toBe('Primary');
        expect(reloaded.c3EncounterNetworks()).toEqual([]);
    });

    it('keeps target-registry editing outside runtime undo and semantic history', async () => {
        const force = await loadForce();
        createTarget(force);
        const targetId = force.queryInventoryControlTargetRegistry().targets[0].id;
        updateTarget(force, targetId, { name: 'Primary' });

        expect(force.getRuntimeUndoState()).toEqual({ canUndo: false, canRedo: false });
        expect(force.getRuntimeHistory()).toEqual([]);
        expect((await force.serializeForPersistence()).cbt!.history).toEqual({ u: [], t: [] });
        expect(force.queryInventoryControlTargetRegistry().targets[0].name).toBe('Primary');
    });

    it('does not invalidate an earlier load for an absent typed-C3 removal no-op', async () => {
        const force = await loadForce();
        const saved = await force.serializeForPersistence();
        let entered!: () => void;
        const preparationEntered = new Promise<void>(resolve => { entered = resolve; });
        let release!: () => void;
        const preparationGate = new Promise<void>(resolve => { release = resolve; });
        const seam = force as any;
        const originalPrepare = seam.restoreCBTForce.bind(force);
        spyOn(seam, 'restoreCBTForce').and.callFake(async (...args: unknown[]) => {
            entered();
            await preparationGate;
            return originalPrepare(...args);
        });

        const loading = force.loadCBTForceV2Persistence(saved);
        await preparationEntered;
        expect(force.replaceC3EncounterNetworksIfOwnerRevisionCurrent(
            force.captureForceOwnerRevisionFence(),
            [],
        )).toBeFalse();
        release();

        expect(await loading).toBeTrue();
    });

    it('derives the OPFOR-enabled session flag from restored registry facts', async () => {
        const force = await loadForce();
        const snapshot = force.queryInventoryControlTargetRegistry();
        const installed = force.dispatchInventoryControlTargetRegistry({
            kind: 'replace-targets',

            targets: [{
                id: asEncounterTargetId('opfor:v1:restored'),
                letter: 'A',
                name: 'Restored opponent',
                color: '#123456',
                source: 'opfor',
                readOnly: true,
            }],
        }, 'opfor-sync');
        expect(installed.accepted).toBeTrue();

        const reloaded = await loadForce(await force.serializeForPersistence() as SerializedCBTForce);
        expect(reloaded.inventoryControlOpforEnabled()).toBeTrue();
        expect(reloaded.queryInventoryControlTargetRegistry().targets.map(target => target.source))
            .toEqual(['opfor']);
    });

    it('retries an in-flight save so concurrent accepted edits are included', async () => {
        const force = await loadForce();
        createTarget(force);

        let entered!: () => void;
        const preparationEntered = new Promise<void>(resolve => entered = resolve);
        let release!: () => void;
        const preparationGate = new Promise<void>(resolve => release = resolve);
        const seam = force as any;
        const originalPrepare = seam.prepareCBTForcePersistenceV2.bind(force);
        let invocation = 0;
        spyOn(seam, 'prepareCBTForcePersistenceV2').and.callFake(async (input: any) => {
            invocation += 1;
            if (invocation === 1) {
                entered();
                await preparationGate;
            }
            return originalPrepare(input);
        });

        const saving = force.serializeForPersistence();
        await preparationEntered;
        createTarget(force);
        force._name.set('Edited during persistence');
        release();

        const saved = await saving;
        expect(invocation).toBeGreaterThan(1);
        expect(saved.name).toBe('Edited during persistence');
        expect(saved.cbt?.encounter.state.facts
            .filter(fact => fact.kind === 'target').map(fact => fact.target.letter).sort())
            .toEqual(['A', 'B']);
    });

    it('reuses validated persistence entries and serializes only changed runtimes', async () => {
        const { force, reload } = await readyCloneForce();
        const unitStore = (force as unknown as {
            readonly unitStore: { liveUnits(): readonly CBTUnit[] };
        }).unitStore;
        const [first, second] = unitStore.liveUnits();
        const readyPrototype = Object.getPrototypeOf(first) as Pick<CBTUnit, 'serialize'>;
        const serialize = spyOn(readyPrototype, 'serialize').and.callThrough();
        const serializationCount = (unit: CBTUnit) => serialize.calls.all()
            .filter(call => call.object === unit).length;

        const unchanged = await force.serializeForPersistence() as SerializedCBTForce;
        expect(serializationCount(first)).toBe(0);
        expect(serializationCount(second)).toBe(0);

        const before = mekRuntimeSnapshot(force, first.instanceId);
        const shutdown = await force.dispatchMekUnitCommand(first.instanceId, {
            type: 'declare-mek-action',


            action: { schemaVersion: 1, kind: 'shutdown' },
        });
        expect(shutdown.accepted).toBeTrue();
        serialize.calls.reset();

        const changed = await force.serializeForPersistence() as SerializedCBTForce;
        expect(serializationCount(first)).toBe(1);
        expect(serializationCount(second)).toBe(0);
        expect(Number(changed.cbt!.forceRevision)).toBe(Number(unchanged.cbt!.forceRevision) + 1);
        expect(mekRuntimeSnapshot(await reload(changed), first.instanceId).state.movementPsr.action)
            .toEqual({ schemaVersion: 1, kind: 'shutdown' });
    });

    it('detaches the target registry when cloning a non-owned force', async () => {
        const force = await loadForce();
        createTarget(force);
        const targetId = force.queryInventoryControlTargetRegistry().targets[0].id;
        updateTarget(force, targetId, {
            name: 'Primary',
            tnCalculator: { prone: true },
        });
        (force as any)._owned.set(false);
        const original = force.queryInventoryControlTargetRegistry();

        const cloned = await force.cloneForPersistence() as CBTForce;
        const copied = cloned.queryInventoryControlTargetRegistry();

        expect(cloned.instanceId()).not.toBe(force.instanceId());
        expect(cloned.owned()).toBeTrue();
        expect(copied).toEqual(original);
        expect(copied).not.toBe(original);
        expect(copied.targets[0]).not.toBe(original.targets[0]);

        const edited = cloned.dispatchInventoryControlTargetRegistry({
            kind: 'update-target',

            targetId: copied.targets[0].id,
            patch: { name: 'Clone only' },
        });
        expect(edited.accepted).toBeTrue();
        expect(cloned.queryInventoryControlTargetRegistry().targets[0].name).toBe('Clone only');
        expect(force.queryInventoryControlTargetRegistry().targets[0].name).toBe('Primary');
    });

    it('clones ready runtimes with fresh owner identities and remapped encounter endpoints', async () => {
        const { force, armorFaceId } = await readyCloneForce();
        const source = await force.serializeForPersistence();
        const clone = await force.cloneForPersistence();
        const copied = await clone.serializeForPersistence();
        const sourceIds = new Set(source.cbt!.units.map(entry => entry.instanceId));
        const copiedIds = copied.cbt!.units.map(entry => entry.instanceId);

        expect(clone.instanceId()).not.toBe(force.instanceId());
        expect(clone.owned()).toBeTrue();
        expect(Number(copied.cbt!.forceRevision)).toBe(0);
        expect(copied.cbt!.roster.groups[0].groupId)
            .not.toBe(source.cbt!.roster.groups[0].groupId);
        expect(copiedIds.every(instanceId => !sourceIds.has(instanceId))).toBeTrue();
        expect(copied.cbt!.roster.groups[0].members.map(member => member.instanceId))
            .toEqual(copiedIds);

        const network = copied.cbt!.encounter.state.facts.find(fact => fact.kind === 'network');
        if (network?.kind !== 'network') throw new Error('Cloned network is missing');
        expect(network.network.endpoints.map(endpoint => endpoint.instanceId).sort())
            .toEqual([...copiedIds].sort());
        expect(network.network.endpoints.some(endpoint => sourceIds.has(endpoint.instanceId))).toBeFalse();

        const copiedFirst = copied.cbt!.roster.groups[0].members[0].instanceId;
        const sourceFirst = source.cbt!.roster.groups[0].members[0].instanceId;
        const copiedSnapshot = mekRuntimeSnapshot(clone, copiedFirst);
        const sourceRemaining = mekRuntimeSnapshot(force, sourceFirst).query.remainingArmor(armorFaceId);
        expect(copiedSnapshot.query.remainingArmor(armorFaceId)).toBe(sourceRemaining);

        const changed = await clone.dispatchMekUnitCommand(copiedFirst, {
            type: 'damage-armor',


            faceId: armorFaceId,
            amount: 1,
            target: 'committed',
        });
        expect(changed.accepted).toBeTrue();
        expect(mekRuntimeSnapshot(force, sourceFirst).query.remainingArmor(armorFaceId))
            .toBe(sourceRemaining);
    });

    it('hydrates compact sparse Mek state from the exact Entity before installation', async () => {
        const { force, armorFaceId, reload } = await readyCloneForce();
        const source = await force.serializeForPersistence();
        const instanceId = source.cbt!.roster.groups[0].members[0].instanceId;
        const remaining = mekRuntimeSnapshot(force, instanceId).query.remainingArmor(armorFaceId);
        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(
            encodeForceForStorage(source),
        )));
        if (decoded.type !== GameSystem.CBT || decoded.version !== 2 || decoded.cbt === undefined) {
            throw new Error('Compact fixture did not decode as a current CBT force');
        }
        const decodedEntry = decoded.cbt.units.find(entry => entry.instanceId === instanceId);
        if (!decodedEntry || isSerializedNonMekUnit(decodedEntry.unit)) {
            throw new Error('Compact fixture Mek entry is missing');
        }
        expect(decodedEntry.unit.blueprintReferences.targets).toEqual({});

        const restored = await reload(decoded as SerializedCBTForce);
        expect(mekRuntimeSnapshot(restored, instanceId).query.remainingArmor(armorFaceId)).toBe(remaining);
        const hydrated = await restored.serializeForPersistence();
        const hydratedEntry = hydrated.cbt!.units.find(entry => entry.instanceId === instanceId);
        if (!hydratedEntry || isSerializedNonMekUnit(hydratedEntry.unit)) {
            throw new Error('Hydrated fixture Mek entry is missing');
        }
        expect(Object.keys(hydratedEntry.unit.blueprintReferences.targets).length).toBeGreaterThan(0);
    });

    it('projects the force-level adjusted BV into Mek record sheets', async () => {
        const { force } = await readyCloneForce();
        const saved = await force.serializeForPersistence();
        const instanceId = saved.cbt!.roster.groups[0].members[0].instanceId;
        spyOn(force, 'getUnitAdjustedBattleValue').and.returnValue(12_345);
        spyOn(force as any, 'currentHeatPolicy').and.returnValue('manual');

        const sheet = force.getMekRecordSheetSnapshot(instanceId);

        expect(sheet?.battleValue.adjusted).toBe(12_345);
        expect(sheet?.battleValue.current).toBe(force.getUnitCurrentBaseBattleValue(instanceId));
    });

    it('keeps base BV computed signals cold for transient Mek state changes', async () => {
        const { force, armorFaceId } = await readyCloneForce();
        spyOn(force as any, 'currentHeatPolicy').and.returnValue('manual');
        spyOn(force, 'getUnitAdjustedBattleValue').and.returnValue(0);
        const [firstMember, secondMember] = force.getCBTMembers();
        if (!firstMember || !secondMember) throw new Error('Ready Mek members are missing');
        const baseProjection = spyOn(force, 'getUnitCurrentBaseBattleValue').and.callThrough();
        const callsFor = (instanceId: string) => baseProjection.calls.allArgs()
            .filter(([candidate]) => candidate === instanceId).length;
        const sheetProjection = spyOn(force, 'getMekRecordSheetSnapshot').and.callThrough();
        const sheetCallsFor = (instanceId: string) => sheetProjection.calls.allArgs()
            .filter(([candidate]) => candidate === instanceId).length;

        firstMember.currentBaseBattleValue();
        secondMember.currentBaseBattleValue();
        firstMember.mekRecordSheetSnapshot();
        firstMember.mekRecordSheetSnapshot();
        secondMember.mekRecordSheetSnapshot();
        secondMember.mekRecordSheetSnapshot();
        const firstCallsBefore = callsFor(firstMember.id);
        const secondCallsBefore = callsFor(secondMember.id);
        const firstSheetCallsBefore = sheetCallsFor(firstMember.id);

        const transientCommands = [
            { type: 'set-heat' as const, heat: 5 },
            { type: 'set-mek-shutdown-state' as const, shutdown: true },
            { type: 'set-condition' as const, condition: 'prone', active: true },
            { type: 'set-condition' as const, condition: 'swarmed', active: true },
            { type: 'set-condition' as const, condition: 'jammed', active: true },
        ] as const;
        for (const [index, command] of transientCommands.entries()) {
            const before = mekRuntimeSnapshot(force, firstMember.id);
            const result = await force.dispatchMekUnitCommand(firstMember.id, {
                ...command,
            });
            expect(result.accepted).toBeTrue();
            firstMember.currentBaseBattleValue();
            secondMember.currentBaseBattleValue();
            firstMember.mekRecordSheetSnapshot();
            firstMember.mekRecordSheetSnapshot();
            secondMember.mekRecordSheetSnapshot();
        }

        expect(callsFor(firstMember.id)).toBe(firstCallsBefore);
        expect(callsFor(secondMember.id)).toBe(secondCallsBefore);
        expect(sheetCallsFor(firstMember.id)).toBe(firstSheetCallsBefore + transientCommands.length);

        const beforePendingDamage = mekRuntimeSnapshot(force, firstMember.id);
        const pendingDamage = await force.dispatchMekUnitCommand(firstMember.id, {
            type: 'damage-armor',


            faceId: armorFaceId,
            amount: 1,
            target: 'pending',
        });
        expect(pendingDamage.accepted).toBeTrue();
        firstMember.currentBaseBattleValue();
        secondMember.currentBaseBattleValue();
        expect(callsFor(firstMember.id)).toBe(firstCallsBefore);
        expect(callsFor(secondMember.id)).toBe(secondCallsBefore);

        const beforeCancel = mekRuntimeSnapshot(force, firstMember.id);
        expect((await force.dispatchMekUnitCommand(firstMember.id, {
            type: 'cancel-pending',


        })).accepted).toBeTrue();

        const beforeDamage = mekRuntimeSnapshot(force, firstMember.id);
        const damaged = await force.dispatchMekUnitCommand(firstMember.id, {
            type: 'damage-armor',


            faceId: armorFaceId,
            amount: 1,
            target: 'committed',
        });
        expect(damaged.accepted).toBeTrue();
        firstMember.currentBaseBattleValue();
        secondMember.currentBaseBattleValue();
        expect(callsFor(firstMember.id)).toBe(firstCallsBefore + 1);
        expect(callsFor(secondMember.id)).toBe(secondCallsBefore);
    });

    it('projects current damage and pristine Entity BV through the same force adjustments', async () => {
        const laser = new WeaponEquipment({
            id: 'DamagePolicyLaser',
            name: 'Damage Policy Laser',
            type: 'weapon',
            stats: { bv: 200 },
            weapon: { ammoType: 'NA', heat: 0, damage: 10 },
        });
        const entity = new TestTankEntity(createTestEquipmentRegistry({ [laser.id]: laser }));
        const componentId = asComponentId('damage-policy-laser');
        entity.setEquipment([new EntityMountedEquipment({
            mountId: componentId,
            equipmentId: laser.id,
            equipment: laser,
            allocation: { kind: 'location', location: 'Front' },
            rearMounted: false,
            turretMounted: false,
            omniPodMounted: false,
            armored: false,
        })]);
        const { force, instanceId } = await readyEntityForce({ entity });
        const member = force.getCBTMember(instanceId)!;
        const currentBefore = member.currentBaseBattleValue()!;
        const adjustedBefore = member.adjustedBattleValue()!;
        const pristineBefore = member.pristineBattleValue()!;
        const pristineAdjustedBefore = member.pristineAdjustedBattleValue()!;

        const snapshot = entityRuntimeSnapshot(force, instanceId);
        expect((await force.dispatchNonMekUnitCommand(instanceId, {
            kind: 'set-component-status',

            componentId,
            status: 'destroyed',
            target: 'committed',
        })).accepted).toBeTrue();

        expect(member.currentBaseBattleValue()!).toBeLessThan(currentBefore);
        expect(member.adjustedBattleValue()!).toBeLessThan(adjustedBefore);
        expect(member.pristineBattleValue()).toBe(pristineBefore);
        expect(member.pristineAdjustedBattleValue()).toBe(pristineAdjustedBefore);
    });

    it('dispatches a canonical turn state without corrupting its immutable map', async () => {
        const { force } = await readyCloneForce();
        const saved = await force.serializeForPersistence();
        const instanceId = saved.cbt!.roster.groups[0].members[0].instanceId;
        const before = mekRuntimeSnapshot(force, instanceId);

        const changed = await force.dispatchMekUnitCommand(instanceId, {
            type: 'replace-turn-state',


            turn: { ...before.query.turnState(), cover: 'light' },
        });

        expect(changed.accepted).toBeTrue();
        expect(mekRuntimeSnapshot(force, instanceId).query.turnState().cover).toBe('light');
    });

    it('logs only the final cover and spotting state selected in a phase', async () => {
        const { force } = await readyCloneForce();
        const saved = await force.serializeForPersistence();
        const instanceId = saved.cbt!.roster.groups[0].members[0].instanceId;
        let sequence = 0;
        const replaceTurn = async (patch: Readonly<{
            cover?: UnitCover | null;
            spotting?: boolean;
        }>) => {
            const snapshot = mekRuntimeSnapshot(force, instanceId);
            sequence += 1;
            return force.dispatchMekUnitCommand(instanceId, {
                type: 'replace-turn-state',


                turn: { ...snapshot.query.turnState(), ...patch },
            });
        };

        expect((await replaceTurn({ cover: 'light' })).accepted).toBeTrue();
        expect((await replaceTurn({ cover: 'underwater-depth-2' })).accepted).toBeTrue();
        expect((await replaceTurn({ cover: 'heavy' })).accepted).toBeTrue();
        const coverRows = force.getRuntimeHistory().filter(row =>
            row.event.message[0] === RUNTIME_HISTORY_MESSAGE.COVER_CHANGED);
        expect(JSON.stringify(coverRows.map(row => [...row.event.message]))).toBe(JSON.stringify([[
            RUNTIME_HISTORY_MESSAGE.COVER_CHANGED,
            instanceId,
            0,
            2,
        ]]));

        expect((await replaceTurn({ cover: null })).accepted).toBeTrue();
        expect(force.getRuntimeHistory().filter(row =>
            row.event.message[0] === RUNTIME_HISTORY_MESSAGE.COVER_CHANGED)).toEqual([]);

        expect((await replaceTurn({ spotting: true })).accepted).toBeTrue();
        expect((await replaceTurn({ spotting: false })).accepted).toBeTrue();
        expect(force.getRuntimeHistory().filter(row =>
            row.event.message[0] === RUNTIME_HISTORY_MESSAGE.SPOTTING_CHANGED)).toEqual([]);
        expect(force.getRuntimeHistory().filter(row =>
            row.event.message[0] === RUNTIME_HISTORY_MESSAGE.UNIT_ACTION)).toEqual([]);
    });

    it('promotes and settles a C3 emergency master through the force-owned encounter boundary', async () => {
        const {
            force,
            masterId,
            emergencyId,
            masterComponentId,
            emergencyComponentId,
            toast,
        } = await readyC3Force();

        const emergencyBefore = mekRuntimeSnapshot(force, emergencyId);
        expect((await force.dispatchMekUnitCommand(emergencyId, {
            type: 'set-condition',


            condition: 'tagged',
            active: true,
        })).accepted).toBeTrue();
        expect(mekRuntimeSnapshot(force, emergencyId).query
            .componentC3EmergencyMaster(emergencyComponentId)).toBeUndefined();

        const masterBefore = mekRuntimeSnapshot(force, masterId);
        const failed = await force.dispatchMekUnitCommand(masterId, {
            type: 'set-component-status',


            componentId: masterComponentId,
            status: 'destroyed',
            target: 'committed',
        });
        expect(failed.accepted).toBeTrue();
        expect(force.c3EncounterNetworks()[0]?.endpoints.map(endpoint => endpoint.role))
            .toEqual(['member', 'master', 'member']);
        expect(mekRuntimeSnapshot(force, emergencyId).query
            .componentC3EmergencyMaster(emergencyComponentId)?.operatingTurns).toBe(1);
        expect(force.getC3State(emergencyId)).toBe('operational');
        expect(toast.showToast).toHaveBeenCalledWith(
            'Direct Fixture DF-1: Test C3 Emergency Master EMERGENCY active',
            'info',
            jasmine.stringMatching(/^c3em-activation-/u),
        );

        const beforeEndTurn = mekRuntimeSnapshot(force, emergencyId);
        const ended = await force.dispatchMekUnitCommand(emergencyId, {
            type: 'end-turn',


            policy: 'automatic',
        });
        expect(ended.accepted).toBeTrue();
        if (!ended.accepted || !ended.state) return;
        const afterEndTurn = mekRuntimeSnapshot(force, emergencyId);
        expect(ended.state.stateRevision).toBe(afterEndTurn.state.stateRevision);
        expect(afterEndTurn.query.componentC3EmergencyMaster(emergencyComponentId)?.operatingTurns)
            .toBe(2);
        expect(toast.showToast).toHaveBeenCalledWith(
            'Direct Fixture DF-1: Test C3 Emergency Master active, 2/6 operating turns',
            'info',
            undefined,
        );

        const configuredNetwork = force.c3EncounterNetworks();
        expect((await force.undoRuntimeCommand()).accepted).toBeTrue();
        expect(mekRuntimeSnapshot(force, emergencyId).query
            .componentC3EmergencyMaster(emergencyComponentId)?.operatingTurns).toBe(1);
        expect(force.c3EncounterNetworks()).toEqual(configuredNetwork);

        expect((await force.redoRuntimeCommand()).accepted).toBeTrue();
        expect(mekRuntimeSnapshot(force, emergencyId).query
            .componentC3EmergencyMaster(emergencyComponentId)?.operatingTurns).toBe(2);
        expect(force.c3EncounterNetworks()).toEqual(configuredNetwork);
    });

    it('keeps transient C3 operation out of adjusted BV while refreshing live state', async () => {
        const { force, masterId } = await readyC3Force();
        const master = force.getCBTMember(masterId);
        if (!master) throw new Error('C3 master member is missing');
        const stateProjection = spyOn(force, 'getC3State').and.callThrough();
        const adjustedProjection = spyOn(force, 'getUnitAdjustedBattleValue').and.callThrough();

        expect(master.c3State()).toBe('operational');
        const adjustedBefore = master.adjustedBattleValue();
        const stateCallsBefore = stateProjection.calls.count();
        const adjustedCallsBefore = adjustedProjection.calls.count();
        const beforeProne = mekRuntimeSnapshot(force, masterId);
        const prone = await force.dispatchMekUnitCommand(masterId, {
            type: 'set-condition',


            condition: 'prone',
            active: true,
        });
        expect(prone.accepted).toBeTrue();
        expect(master.c3State()).toBe('operational');
        expect(stateProjection.calls.count()).toBe(stateCallsBefore);

        const beforeShutdown = mekRuntimeSnapshot(force, masterId);
        const shutdown = await force.dispatchMekUnitCommand(masterId, {
            type: 'set-mek-shutdown-state',


            shutdown: true,
        });
        expect(shutdown.accepted).toBeTrue();
        expect(master.c3State()).toBe('degraded');
        expect(stateProjection.calls.count()).toBe(stateCallsBefore + 1);
        expect(master.adjustedBattleValue()).toBe(adjustedBefore);
        expect(adjustedProjection.calls.count()).toBe(adjustedCallsBefore);

        const beforeStartup = mekRuntimeSnapshot(force, masterId);
        const startup = await force.dispatchMekUnitCommand(masterId, {
            type: 'set-mek-shutdown-state',


            shutdown: false,
        });
        expect(startup.accepted).toBeTrue();
        expect(master.c3State()).toBe('operational');
        expect(stateProjection.calls.count()).toBe(stateCallsBefore + 2);

        const beforeJam = mekRuntimeSnapshot(force, masterId);
        const jammed = await force.dispatchMekUnitCommand(masterId, {
            type: 'set-condition',


            condition: 'jammed',
            active: true,
        });

        expect(jammed.accepted).toBeTrue();
        expect(master.c3State()).toBe('none');
        expect(stateProjection.calls.count()).toBe(stateCallsBefore + 3);
        expect(master.adjustedBattleValue()).toBe(adjustedBefore);
        expect(adjustedProjection.calls.count()).toBe(adjustedCallsBefore);
    });

    it('charges intact Nova CEWS units without configured links and removes destroyed endpoints', async () => {
        const { force, firstId, secondId, componentId } = await readyEntityC3Force('nova');
        const first = force.getCBTMember(firstId)!;
        const second = force.getCBTMember(secondId)!;
        const forceBase = first.currentBaseBattleValue()! + second.currentBaseBattleValue()!;
        const expectedTax = Math.round(forceBase * 0.05);

        expect(force.c3EncounterNetworks()).toEqual([]);
        expect(first.c3BattleValue()).toBe(expectedTax);
        expect(second.c3BattleValue()).toBe(expectedTax);

        const secondRuntime = entityRuntimeSnapshot(force, secondId);
        expect((await force.dispatchNonMekUnitCommand(secondId, {
            kind: 'set-component-status',

            componentId,
            status: 'destroyed',
            target: 'committed',
        })).accepted).toBeTrue();

        expect(first.c3BattleValue()).toBe(0);
        expect(second.c3BattleValue()).toBe(0);
    });

    it('evaluates non-Mek Entity C3 endpoints from sparse runtime state', async () => {
        const { force, firstId, secondId, componentId } = await readyEntityC3Force();
        expect(force.replaceC3EncounterNetworksIfOwnerRevisionCurrent(
            force.captureForceOwnerRevisionFence(),
            [{
                id: asEncounterNetworkId('network:entity-c3i'),
                networkType: 'c3i',
                color: '#1565C0',
                endpoints: [
                    { instanceId: firstId, componentId, role: 'peer' },
                    { instanceId: secondId, componentId, role: 'peer' },
                ],
            }],
        )).toBeTrue();
        expect(force.getC3State(firstId)).toBe('operational');
        expect(force.getC3State(secondId)).toBe('operational');
        expect(force.isC3EndpointOperational(firstId, componentId)).toBeTrue();

        const firstMember = force.getCBTMember(firstId)!;
        const secondMember = force.getCBTMember(secondId)!;
        const baseProjection = spyOn(force, 'getUnitCurrentBaseBattleValue').and.callThrough();
        const callsFor = (instanceId: string) => baseProjection.calls.allArgs()
            .filter(([candidate]) => candidate === instanceId).length;
        const firstBaseBefore = firstMember.currentBaseBattleValue();
        const firstAdjustedBefore = firstMember.adjustedBattleValue();
        secondMember.adjustedBattleValue();
        const firstBaseCallsBefore = callsFor(firstId);
        const secondBaseCallsBefore = callsFor(secondId);
        expect(firstMember.c3BattleValue()).toBeGreaterThan(0);

        const second = entityRuntimeSnapshot(force, secondId);
        expect((await force.dispatchNonMekUnitCommand(secondId, {
            kind: 'set-component-status',

            componentId,
            status: 'destroyed',
            target: 'committed',
        })).accepted).toBeTrue();
        expect(force.getC3State(firstId)).toBe('degraded');
        expect(force.getC3State(secondId)).toBe('degraded');
        expect(force.isC3EndpointOperational(secondId, componentId)).toBeFalse();
        expect(firstMember.currentBaseBattleValue()).toBe(firstBaseBefore);
        expect(firstMember.adjustedBattleValue()).toBeLessThan(firstAdjustedBefore!);
        expect(firstMember.c3BattleValue()).toBe(0);
        secondMember.adjustedBattleValue();
        expect(callsFor(firstId)).toBe(firstBaseCallsBefore);
        expect(callsFor(secondId)).toBe(secondBaseCallsBefore + 1);

        const firstBaseCallsAfterDamage = callsFor(firstId);
        const secondBaseCallsAfterDamage = callsFor(secondId);
        expect((await force.undoRuntimeCommand()).accepted).toBeTrue();
        expect(force.getC3State(firstId)).toBe('operational');
        expect(firstMember.adjustedBattleValue()).toBe(firstAdjustedBefore);
        secondMember.adjustedBattleValue();
        expect(callsFor(firstId)).toBe(firstBaseCallsAfterDamage);
        expect(callsFor(secondId)).toBe(secondBaseCallsAfterDamage + 1);
    });

    it('rejects a non-canonical graph at the force commit boundary', async () => {
        const { force, firstId, componentId } = await readyEntityC3Force();
        const invalid: EncounterNetwork = {
            id: asEncounterNetworkId('network:single-peer'),
            networkType: 'c3i',
            color: '#1565C0',
            endpoints: [{ instanceId: firstId, componentId, role: 'peer' }],
        };

        expect(force.replaceC3EncounterNetworksIfOwnerRevisionCurrent(
            force.captureForceOwnerRevisionFence(),
            [invalid],
        )).toBeFalse();
        expect(force.c3EncounterNetworks()).toEqual([]);
    });

    it('validates encounter networks with the canonical utility before saving', async () => {
        const { force, firstId, componentId } = await readyEntityC3Force();
        const invalid: EncounterNetwork = {
            id: asEncounterNetworkId('network:invalid-save'),
            networkType: 'c3i',
            color: '#1565C0',
            endpoints: [{ instanceId: firstId, componentId, role: 'peer' }],
        };
        const seam = force as unknown as {
            encounterRuntime: { replaceNetworks(networks: readonly EncounterNetwork[]): void };
        };
        seam.encounterRuntime.replaceNetworks([invalid]);

        await expectAsync(force.serializeForPersistence())
            .toBeRejectedWithError(/Cannot persist non-canonical C3 network facts/u);
    });

    it('ignores invalid encounter networks while hydrating a V2 load', async () => {
        const { force, firstId, secondId, componentId, dialogs } = await readyEntityC3Force();
        expect(force.replaceC3EncounterNetworksIfOwnerRevisionCurrent(
            force.captureForceOwnerRevisionFence(),
            [{
                id: asEncounterNetworkId('network:invalid-load'),
                networkType: 'c3i',
                color: '#1565C0',
                endpoints: [
                    { instanceId: firstId, componentId, role: 'peer' },
                    { instanceId: secondId, componentId, role: 'peer' },
                ],
            }],
        )).toBeTrue();
        const tampered = structuredClone(await force.serializeForPersistence()) as any;
        const fact = tampered.cbt.encounter.state.facts.find((candidate: { kind: string }) =>
            candidate.kind === 'network');
        fact.network.endpoints = [fact.network.endpoints[0]];

        dialogs.showNotice.calls.reset();
        await expectAsync(force.loadCBTForceV2Persistence(tampered)).toBeResolvedTo(true);
        expect(force.c3EncounterNetworks()).toEqual([]);
        expect(dialogs.showNotice).toHaveBeenCalledOnceWith(
            '• C3 network data was invalid and was ignored.',
            'Save Loaded with Warnings',
        );
    });

    it('commits and persists a C3 editor linkage across a cloud-save acknowledgement', async () => {
        const { force, firstId, secondId, componentId } = await readyEntityC3Force();
        const baseline = await force.serializeForPersistence();
        const editorFence = force.captureForceOwnerRevisionFence();
        const persistenceFingerprint = force.captureWholeOwnerAuthorityFingerprint();
        let changedUnitIds: readonly string[] | null | undefined;
        const subscription = force.changed.subscribe(ids => { changedUnitIds = ids; });
        force.markCloudCBTForceV2Saved(baseline);

        expect(force.isWholeOwnerAuthorityFingerprintCurrent(persistenceFingerprint)).toBeFalse();
        expect(force.isForceOwnerRevisionFenceCurrent(editorFence)).toBeTrue();
        expect(force.replaceC3EncounterNetworksIfOwnerRevisionCurrent(editorFence, [{
            id: asEncounterNetworkId('network:cloud-ack'),
            networkType: 'c3i',
            color: '#1565C0',
            endpoints: [
                { instanceId: firstId, componentId, role: 'peer' },
                { instanceId: secondId, componentId, role: 'peer' },
            ],
        }])).toBeTrue();
        expect(changedUnitIds).toEqual([firstId, secondId]);

        const saved = await force.serializeForPersistence();
        expect(saved.cbt!.encounter.state.facts.some(fact =>
            fact.kind === 'network' && fact.network.id === 'network:cloud-ack')).toBeTrue();
        subscription.unsubscribe();
    });

    it('keeps C3 topology outside undo while preserving prior unit commands', async () => {
        const { force, firstId, secondId, componentId } = await readyEntityC3Force();
        const before = entityRuntimeSnapshot(force, firstId);
        expect((await force.dispatchNonMekUnitCommand(firstId, {
            kind: 'set-condition',

            condition: 'immobile',
            active: true,
        })).accepted).toBeTrue();
        const undoBeforeNetwork = force.getRuntimeUndoState();
        const historyBeforeNetwork = force.getRuntimeHistory();
        const network = {
            id: asEncounterNetworkId('network:undo-boundary'),
            networkType: 'c3i' as const,
            color: '#1565C0',
            endpoints: [
                { instanceId: firstId, componentId, role: 'peer' as const },
                { instanceId: secondId, componentId, role: 'peer' as const },
            ],
        };

        expect(force.replaceC3EncounterNetworksIfOwnerRevisionCurrent(
            force.captureForceOwnerRevisionFence(),
            [network],
        )).toBeTrue();
        expect(force.getRuntimeUndoState()).toEqual(undoBeforeNetwork);
        expect(force.getRuntimeHistory()).toEqual(historyBeforeNetwork);

        expect((await force.undoRuntimeCommand()).accepted).toBeTrue();
        expect(force.getUnitConditions(firstId)).toEqual([]);
        expect(force.c3EncounterNetworks()).toEqual([network]);
        expect(force.getC3State(firstId)).toBe('operational');
    });

    it('opens force-owned C3 configuration without mutating unit runtime or history', async () => {
        const {
            force,
            emergencyId,
            emergencyComponentId,
            forceDialogs,
            c3DialogOpened,
        } = await readyC3Force();
        const interaction = force.getEquipmentInteractions(emergencyId)
            .find(row => row.componentId === emergencyComponentId);
        const choice = interaction?.choices.find(candidate =>
            candidate.interactionKind === 'c3-configuration');
        if (!choice) throw new Error('C3 Configure choice is missing');
        const beforeRevision = mekRuntimeSnapshot(force, emergencyId).state.stateRevision;
        const beforeHistory = force.getRuntimeHistory();

        expect(choice).toEqual(jasmine.objectContaining({
            label: 'Configure',
            disabled: false,
            displayType: 'button',
        }));
        expect(choice.command.handlerId).toBe('c3-handler');
        expect(await force.dispatchEquipmentChoice(choice.command)).toEqual({
            accepted: true,
            changed: false,
        });
        await c3DialogOpened;

        expect(forceDialogs.openC3Network).toHaveBeenCalledOnceWith(force, false);
        expect(mekRuntimeSnapshot(force, emergencyId).state.stateRevision).toBe(beforeRevision);
        expect(force.getRuntimeHistory()).toEqual(beforeHistory);
    });

    it('keeps read-only C3 configuration navigable while leaving the force untouched', async () => {
        const {
            force,
            emergencyId,
            emergencyComponentId,
            forceDialogs,
            c3DialogOpened,
        } = await readyC3Force(false);
        expect(force.readOnly()).toBeTrue();
        const interaction = force.getEquipmentInteractions(emergencyId)
            .find(row => row.componentId === emergencyComponentId);
        const choice = interaction?.choices.find(candidate =>
            candidate.interactionKind === 'c3-configuration');
        if (!choice) throw new Error('Read-only C3 Configure choice is missing');
        const beforeRevision = mekRuntimeSnapshot(force, emergencyId).state.stateRevision;

        expect(choice.disabled).toBeFalse();
        expect(await force.dispatchEquipmentChoice(choice.command)).toEqual({
            accepted: true,
            changed: false,
        });
        await c3DialogOpened;

        expect(forceDialogs.openC3Network).toHaveBeenCalledOnceWith(force, true);
        expect(mekRuntimeSnapshot(force, emergencyId).state.stateRevision).toBe(beforeRevision);
    });

    it('repairs ready sparse state without replacing its blueprint or resetting its revision', async () => {
        const { force, armorFaceId } = await readyCloneForce();
        const before = await force.serializeForPersistence();
        const instanceId = before.cbt!.roster.groups[0].members[0].instanceId;
        const snapshot = mekRuntimeSnapshot(force, instanceId);
        const maximumArmor = snapshot.index.armorFaces.get(armorFaceId)!.maximumPoints;
        expect(snapshot.query.remainingArmor(armorFaceId)).toBe(maximumArmor - 1);

        const repaired = await force.repairMember(instanceId);
        expect(repaired.accepted).toBeTrue();
        expect(repaired.changed).toBeTrue();
        const after = mekRuntimeSnapshot(force, instanceId);
        expect(after.entity).toBe(snapshot.entity);
        expect(after.query.remainingArmor(armorFaceId)).toBe(maximumArmor);
        expect(Number(after.state.stateRevision)).toBe(Number(snapshot.state.stateRevision) + 1);

        const saved = await force.serializeForPersistence();
        const beforeUnit = before.cbt!.units.find(entry => entry.instanceId === instanceId);
        const afterUnit = saved.cbt!.units.find(entry => entry.instanceId === instanceId);
        if (!beforeUnit || !afterUnit) {
            throw new Error('Repair fixture ready entry is missing');
        }
        expect(afterUnit.unit.entity).toEqual(beforeUnit.unit.entity);
        expect(afterUnit.unit.deployment).toEqual(beforeUnit.unit.deployment);

        const noOp = await force.repairAllMembers();
        expect(noOp.accepted).toBeTrue();
        expect(noOp.changed).toBeFalse();
    });

    it('atomically rebinds optional rules and clears a Sprint invalidated by disabling the option', async () => {
        const { force } = await readyCloneForce();
        const before = await force.serializeForPersistence();
        const instanceId = before.cbt!.roster.groups[0].members[0].instanceId;
        const beforeMovement = mekRuntimeSnapshot(force, instanceId).query.mekMovementPsr();
        expect(beforeMovement.kind).toBe('supported');
        if (beforeMovement.kind !== 'supported') return;
        expect(beforeMovement.actions.find(action => action.kind === 'sprint')?.legal).toBeFalse();

        expect(await force.synchronizeOptionalRules({
            forcedWithdrawal: true,
            sprinting: true,
        })).toBeTrue();
        const enabled = mekRuntimeSnapshot(force, instanceId);
        const enabledMovement = enabled.query.mekMovementPsr();
        expect(enabledMovement.kind).toBe('supported');
        if (enabledMovement.kind !== 'supported') return;
        expect(enabledMovement.actions.find(action => action.kind === 'sprint')).toEqual(
            jasmine.objectContaining({ legal: true, ordinaryMaximumMp: 10 }),
        );
        expect(enabled.query.heatProjection('manual').kind).toBe('supported');
        expect('scenarioRules' in (await force.serializeForPersistence()).cbt!).toBeFalse();
        expect(await force.synchronizeOptionalRules({
            forcedWithdrawal: true,
            sprinting: true,
        })).toBeFalse();

        const declared = await force.dispatchMekUnitCommand(instanceId, {
            type: 'declare-mek-movement',


            declaration: {
                schemaVersion: 1,
                mode: 'sprint',
                distance: 10,
                boosterComponentIds: [],
            },
        });
        expect(declared.accepted).toBeTrue();
        const sprinting = mekRuntimeSnapshot(force, instanceId);
        expect(sprinting.state.movementPsr.movement?.mode).toBe('sprint');
        const sprintHeat = sprinting.query.heatProjection('manual');
        expect(sprintHeat.kind).toBe('supported');
        if (sprintHeat.kind === 'supported') {
            expect(sprintHeat.projection.sources.find(source => source.id === 'movement')?.value).toBe(3);
        }

        expect(await force.synchronizeOptionalRules({
            forcedWithdrawal: true,
            sprinting: false,
        })).toBeTrue();
        expect(mekRuntimeSnapshot(force, instanceId).state.movementPsr.movement).toBeNull();
        expect('scenarioRules' in (await force.serializeForPersistence()).cbt!).toBeFalse();
    });

    it('transfers a ready Mek between V2 owners in one paired transaction', async () => {
        const { force: source, armorFaceId, createTargetForce } = await readyCloneForce();
        const target = await createTargetForce();
        const sourceBefore = await source.serializeForPersistence();
        const targetBefore = await target.serializeForPersistence();
        const instanceId = sourceBefore.cbt!.roster.groups[0].members[0].instanceId;
        const sourceSnapshot = mekRuntimeSnapshot(source, instanceId);
        const remainingArmor = sourceSnapshot.query.remainingArmor(armorFaceId);
        const targetGroup = target.groups()[0];

        const transferred = await source.transferMemberTo(target, instanceId, targetGroup.id, 0);

        expect(transferred).toEqual({ accepted: true, changed: true, instanceId });
        expect(source.getCBTMember(instanceId)).toBeNull();
        expect(source.getUnitSnapshot(instanceId)).toBeNull();
        expect(target.getCBTMember(instanceId)).not.toBeNull();
        expect(mekRuntimeSnapshot(target, instanceId).query.remainingArmor(armorFaceId)).toBe(remainingArmor);
        expect(mekRuntimeSnapshot(target, instanceId).entity).toBe(sourceSnapshot.entity);
        const targetRoster = target.queryCanonicalRoster();
        expect(targetRoster.kind).toBe('available');
        expect(target.getFormationUnitsForGroup(targetGroup).map(member => member.id)).toEqual([instanceId]);
        expect(targetRoster.kind === 'available'
            && targetRoster.snapshot.members[0].commander).toBeTrue();
        expect(source.c3EncounterNetworks()).toEqual([]);

        const sourceAfter = await source.serializeForPersistence();
        const targetAfter = await target.serializeForPersistence();
        expect(Number(sourceAfter.cbt!.forceRevision)).toBe(Number(sourceBefore.cbt!.forceRevision) + 1);
        expect(Number(targetAfter.cbt!.forceRevision)).toBe(Number(targetBefore.cbt!.forceRevision) + 1);
    });

    it('loads and transfers a non-Mek through the same CBT owner', async () => {
        const { force: source, instanceId, createTargetForce } = await readyEntityForce();
        const target = await createTargetForce();

        expect(source.getCBTMember(instanceId)).not.toBeNull();
        expect(source.getCBTMember(instanceId)?.entity.entityType).not.toBe('Mek');

        const transferred = await source.transferMemberTo(
            target,
            instanceId,
            target.groups()[0].id,
            0,
        );

        expect(transferred).toEqual({ accepted: true, changed: true, instanceId });
        expect(source.getCBTMember(instanceId)).toBeNull();
        expect(target.getCBTMember(instanceId)).not.toBeNull();
        expect(target.getCBTMember(instanceId)?.entity.entityType).not.toBe('Mek');
        const crew = target.getUnitCrewProfile(instanceId)!;
        const crewChanged = await target.replaceUnitCrewProfile(
            instanceId,
            crew.positions.map((position, index) => index === 0
                ? { ...position, name: 'Vehicle Commander', gunnery: 3, piloting: 4 }
                : position),
        );
        expect(crewChanged).not.toBeNull();
        expect(target.getUnitCrewProfile(instanceId)?.positions[0]).toEqual(jasmine.objectContaining({
            name: 'Vehicle Commander', gunnery: 3, piloting: 4,
        }));
        expect((await target.undoRuntimeCommand()).accepted).toBeTrue();
        expect(target.getUnitCrewProfile(instanceId)?.positions[0]?.name)
            .not.toBe('Vehicle Commander');
        expect((await target.redoRuntimeCommand()).accepted).toBeTrue();
        expect(target.getUnitCrewProfile(instanceId)?.positions[0]).toEqual(jasmine.objectContaining({
            name: 'Vehicle Commander', gunnery: 3, piloting: 4,
        }));
        expect(target.getInventoryControlTargetRoster()).toEqual([
            jasmine.objectContaining({
                instanceId,
                unitType: 'vehicle',
                tnCalculator: jasmine.objectContaining({
                    targetMovementDistance: null,
                    targetHeight: 1,
                    largeTarget: false,
                }),
            }),
        ]);
        const snapshot = entityRuntimeSnapshot(target, instanceId);
        const changed = await target.dispatchNonMekUnitCommand(instanceId, {
            kind: 'set-condition',

            condition: 'immobile',
            active: true,
        });
        expect(changed.accepted).toBeTrue();
        expect(target.getUnitConditions(instanceId)).toEqual(['immobile']);
        const registry = target.queryInventoryControlTargetRegistry();
        const targetId = asEncounterTargetId('target:entity-force');
        expect(target.dispatchInventoryControlTargetRegistry({
            kind: 'create-target',

            target: {
                id: targetId,
                letter: 'A',
                name: 'Target A',
                color: '#ff0000',
                source: 'manual',
            },
        }).accepted).toBeTrue();
        const targeting = target.getAttackerTargeting(instanceId)!;
        expect((await target.dispatchAttackerTargeting(instanceId, {
            type: 'edit-attacker-targeting',



            edit: {
                kind: 'set-target-facts',
                targetId,
                facts: { distance: 6 },
            },
        })).accepted).toBeTrue();
        expect(target.getAttackerTargeting(instanceId)?.state.targets.get(targetId)?.distance).toBe(6);
        const entry = (await target.serializeForPersistence()).cbt!.units
            .find(unit => unit.instanceId === instanceId);
        expect(entry !== undefined
            && isSerializedNonMekUnit(entry.unit)
            && entry.unit.conditions?.includes('immobile')
            && entry.unit.attackerTargeting.targets[0]?.targetId === targetId).toBeTrue();
        const beforeDelete = target.queryInventoryControlTargetRegistry();
        expect(target.dispatchInventoryControlTargetRegistry({
            kind: 'delete-target',

            targetId,
        }).accepted).toBeTrue();
        expect(target.getAttackerTargeting(instanceId)?.state.targets.has(targetId)).toBeFalse();
    });

    it('identifies Omni Battle Armor targets from the canonical Entity type', async () => {
        const entity = new TestBattleArmorEntity();
        entity.omni.set(true);
        const { force, instanceId } = await readyEntityForce({ entity });

        expect(force.getInventoryControlTargetRoster()).toContain(
            jasmine.objectContaining({
                instanceId,
                unitType: 'battle-armor',
            }),
        );
    });

    it('derives Core homing-artillery TAG BV from operational Non-Mek runtime facts', async () => {
        const tag = new WeaponEquipment({
            id: 'TestTAG', name: 'TAG', type: 'weapon', flags: ['F_TAG'],
            weapon: { ammoType: 'NA' },
        });
        const launcher = new WeaponEquipment({
            id: 'TestArrowIV', name: 'Arrow IV', type: 'weapon', flags: ['F_ARTILLERY'],
            weapon: { ammoType: 'ARROW_IV', rackSize: 20 },
        });
        const homing = new AmmoEquipment({
            id: 'TestArrowIVHoming', name: 'Arrow IV Homing Ammo', type: 'ammo',
            ammo: {
                type: 'ARROW_IV', rackSize: 20, shots: 1,
                munitionType: ['M_HOMING'],
            },
        });
        const entity = new TestTankEntity(createTestEquipmentRegistry({
            [tag.id]: tag,
            [launcher.id]: launcher,
            [homing.id]: homing,
        }));
        const installed = (id: string, equipment: WeaponEquipment | AmmoEquipment) =>
            new EntityMountedEquipment({
                mountId: id,
                equipmentId: equipment.id,
                equipment,
                allocation: { kind: 'location', location: 'Front' },
                rearMounted: false,
                turretMounted: false,
                omniPodMounted: false,
                armored: false,
            });
        entity.setEquipment([
            installed('tag', tag),
            installed('launcher-1', launcher),
            installed('launcher-2', launcher),
            installed('ammo', homing),
        ]);
        const { force, instanceId } = await readyEntityForce({ entity });
        const base = force.getUnitCurrentBaseBattleValue(instanceId)!;

        expect(force.getUnitTagBattleValue(instanceId)).toBe(100);
        expect(force.getUnitAdjustedBattleValue(instanceId)).toBe(base + 100);

        const snapshot = entityRuntimeSnapshot(force, instanceId);
        const emptied = await force.dispatchNonMekUnitCommand(instanceId, {
            kind: 'set-ammo-spent',

            componentId: asComponentId('ammo'),
            shotsSpent: 1,
        });
        expect(emptied.accepted).toBeTrue();
        expect(force.getUnitTagBattleValue(instanceId)).toBe(0);
    });

    it('keeps Entity undo/redo in session memory and saves semantic history without checkpoints', async () => {
        const { force, instanceId } = await readyEntityForce();
        const before = entityRuntimeSnapshot(force, instanceId);

        const changed = await force.dispatchNonMekUnitCommand(instanceId, {
            kind: 'set-condition',

            condition: 'immobile',
            active: true,
        });

        expect(changed.accepted).toBeTrue();
        expect(force.getUnitConditions(instanceId)).toEqual(['immobile']);
        expect(force.getRuntimeUndoState()).toEqual({ canUndo: true, canRedo: false });
        expect([...force.getRuntimeHistory()[0].event.message] as unknown[]).toEqual([
            RUNTIME_HISTORY_MESSAGE.CONDITION_CHANGED,
            instanceId,
            'immobile',
            false,
            true,
        ] as unknown[]);

        const undo = await force.undoRuntimeCommand();
        expect(undo).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(force.getUnitConditions(instanceId)).toEqual([]);
        expect(force.getRuntimeUndoState()).toEqual({ canUndo: false, canRedo: true });

        const redo = await force.redoRuntimeCommand();
        expect(redo).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect(force.getUnitConditions(instanceId)).toEqual(['immobile']);
        expect(force.getRuntimeUndoState()).toEqual({ canUndo: true, canRedo: false });

        const serialized = await force.serializeForPersistence();
        expect(serialized.cbt!.history.u).toEqual([instanceId]);
        expect(serialized.cbt!.history.t).toEqual([jasmine.objectContaining({
            n: 1,
            p: [[[RUNTIME_HISTORY_MESSAGE.CONDITION_CHANGED, 0, 'immobile', false, true]]],
        })]);
        expect(JSON.stringify(serialized.cbt)).not.toContain('before');
        expect(JSON.stringify(serialized.cbt)).not.toContain('after');
    });

    it('records a semantic vehicle crew state instead of a generic non-Mek command', async () => {
        const { force, instanceId } = await readyEntityForce();
        const snapshot = entityRuntimeSnapshot(force, instanceId);
        const positionId = [...snapshot.index.crewPositions.keys()][0]!;

        const changed = await force.dispatchNonMekUnitCommand(instanceId, {
            kind: 'set-crew-state',

            positionId,
            wounds: 0,
            unconscious: true,
            ejected: false,
        });

        expect(changed.accepted).toBeTrue();
        const row = force.getRuntimeHistory().find(candidate =>
            candidate.event.message[0] === RUNTIME_HISTORY_MESSAGE.CREW_CHANGED)!;
        expect(JSON.stringify(row.event.message)).toBe(JSON.stringify([
            RUNTIME_HISTORY_MESSAGE.CREW_CHANGED,
            instanceId,
            0,
            0,
            0,
            0,
            5,
        ]));
    });

    it('exposes vehicle rules-derived conditions through the force read model', async () => {
        const { force, instanceId } = await readyEntityForce();
        const snapshot = entityRuntimeSnapshot(force, instanceId);
        const positionId = [...snapshot.index.crewPositions.keys()][0]!;

        expect((await force.dispatchNonMekUnitCommand(instanceId, {
            kind: 'set-crew-state',

            positionId,
            wounds: 0,
            unconscious: false,
            ejected: false,
            dead: true,
        })).accepted).toBeTrue();

        expect(force.getUnitConditions(instanceId)).toEqual(['abandoned', 'immobile']);
        expect(force.getUnitDestroyed(instanceId)).toBeFalse();
        expect(force.getInventoryControlTargetRoster()[0]?.tnCalculator.immobile).toBeTrue();
    });

    it('always persists current semantic history and starts reloaded undo empty', async () => {
        const { force, armorFaceId, reload } = await readyCloneForce();
        const beforeSave = await force.serializeForPersistence();
        const instanceId = beforeSave.cbt!.roster.groups[0].members[0].instanceId;
        const before = mekRuntimeSnapshot(force, instanceId);
        const damaged = await force.dispatchMekUnitCommand(instanceId, {
            type: 'damage-armor',


            faceId: armorFaceId,
            amount: 1,
            target: 'committed',
        });
        expect(damaged.accepted).toBeTrue();
        expect(force.getRuntimeUndoState()).toEqual({ canUndo: true, canRedo: false });
        const current = (await force.serializeForPersistence()).cbt!.history;
        expect(current.u).toEqual([instanceId]);
        expect(current.t[0].p.flat().map(message => message[0])).toEqual([
            RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
        ]);

        const beforeEndTurn = mekRuntimeSnapshot(force, instanceId);
        const ended = await force.dispatchMekUnitCommand(instanceId, {
            type: 'end-turn',


            policy: 'automatic',
        });
        expect(ended.accepted).toBeTrue();
        expect(force.getRuntimeUndoState()).toEqual({ canUndo: true, canRedo: false });
        const saved = await force.serializeForPersistence() as SerializedCBTForce;
        expect(saved.cbt.history.t.length).toBe(1);
        expect(saved.cbt.history.t[0].p.flat().map(message => message[0])).toEqual([
            RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
            RUNTIME_HISTORY_MESSAGE.TURN_ENDED,
        ]);
        const savedDamage = saved.cbt.history.t[0].p.flat()[0];
        expect(savedDamage?.[1] as number).toBe(0);
        expect(String(savedDamage?.[2])).toMatch(/^f:/);
        expect(saved.cbt.history.u).toEqual([instanceId]);
        expect(JSON.stringify(saved.cbt)).not.toContain('before');
        expect(JSON.stringify(saved.cbt)).not.toContain('after');

        const restored = await reload(saved);
        expect(restored.getRuntimeUndoState()).toEqual({ canUndo: false, canRedo: false });
        expect(restored.getRuntimeHistory().map(row => row.event.message[0])).toEqual([
            RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
            RUNTIME_HISTORY_MESSAGE.TURN_ENDED,
        ]);
    });

    it('replaces a committed pending marker instead of showing a commit log row', async () => {
        const { force, armorFaceId, reload } = await readyCloneForce();
        const saved = await force.serializeForPersistence();
        const instanceId = saved.cbt!.roster.groups[0].members[0]!.instanceId;
        let snapshot = mekRuntimeSnapshot(force, instanceId);
        expect((await force.dispatchMekUnitCommand(instanceId, {
            type: 'damage-armor',


            faceId: armorFaceId,
            amount: 1,
            target: 'pending',
        })).accepted).toBeTrue();
        let damage = force.getRuntimeHistory().find(row =>
            row.event.message[0] === RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR)!.event.message;
        expect(String(damage[damage.length - 1])).toBe('pending');

        snapshot = mekRuntimeSnapshot(force, instanceId);
        expect((await force.dispatchMekUnitCommand(instanceId, {
            type: 'end-phase',


        })).accepted).toBeTrue();

        const visible = force.getRuntimeHistory();
        expect(visible.map(row => row.event.message[0])).toEqual([
            RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
        ]);
        damage = visible[0].event.message;
        expect(String(damage[damage.length - 1])).not.toBe('pending');

        const restored = await reload(await force.serializeForPersistence() as SerializedCBTForce);
        expect(restored.getRuntimeHistory().map(row => row.event.message[0])).toEqual([
            RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR,
        ]);
    });

    it('groups independently advanced units by their matching numbered turns', async () => {
        const { force, armorFaceId } = await readyCloneForce();
        const saved = await force.serializeForPersistence();
        const firstId = saved.cbt!.roster.groups[0].members[0]!.instanceId;
        const secondId = saved.cbt!.roster.groups[0].members[1]!.instanceId;
        const damage = async (instanceId: typeof firstId, key: string) => {
            const snapshot = mekRuntimeSnapshot(force, instanceId);
            return force.dispatchMekUnitCommand(instanceId, {
                type: 'damage-armor',


                faceId: armorFaceId,
                amount: 1,
                target: 'committed',
            });
        };
        const endTurn = async (instanceId: typeof firstId, key: string) => {
            const snapshot = mekRuntimeSnapshot(force, instanceId);
            return force.dispatchMekUnitCommand(instanceId, {
                type: 'end-turn',


                policy: 'automatic',
            });
        };

        expect((await damage(firstId, 'independent:first:t1')).accepted).toBeTrue();
        expect((await endTurn(firstId, 'independent:first:t1')).accepted).toBeTrue();
        expect((await damage(secondId, 'independent:second:t1')).accepted).toBeTrue();
        expect((await damage(firstId, 'independent:first:t2')).accepted).toBeTrue();

        const damageRows = force.getRuntimeHistory().filter(row =>
            row.applied && row.event.message[0] === RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR);
        expect(damageRows.map(row => `${String(row.event.message[1])}@${row.event.turn}`)).toEqual([
            `${firstId}@1`,
            `${secondId}@1`,
            `${firstId}@2`,
        ]);
        expect((await force.serializeForPersistence()).cbt!.history.t.map(turn => turn.n)).toEqual([1, 2]);

        expect((await endTurn(firstId, 'independent:first:t2')).accepted).toBeTrue();
        const turnThree = mekRuntimeSnapshot(force, firstId);
        expect((await force.dispatchMekUnitCommand(firstId, {
            type: 'set-condition',


            condition: 'immobile',
            active: true,
        })).accepted).toBeTrue();
        expect((await force.serializeForPersistence()).cbt!.history.t.map(turn => turn.n)).toEqual([2, 3]);
    });

    it('drops Mek shutdown/startup button churn with no phase-level effect', async () => {
        const { force } = await readyCloneForce();
        const saved = await force.serializeForPersistence();
        const instanceId = saved.cbt!.roster.groups[0].members[0]!.instanceId;
        const declare = async (kind: 'shutdown' | 'startup', key: string) => {
            const snapshot = mekRuntimeSnapshot(force, instanceId);
            return force.dispatchMekUnitCommand(instanceId, {
                type: 'declare-mek-action',


                action: { schemaVersion: 1, kind },
            });
        };

        expect((await declare('shutdown', 'history:shutdown:1')).accepted).toBeTrue();
        expect((await declare('startup', 'history:startup:1')).accepted).toBeTrue();
        expect((await declare('shutdown', 'history:shutdown:2')).accepted).toBeTrue();
        expect((await declare('startup', 'history:startup:2')).accepted).toBeTrue();

        expect(force.getRuntimeHistory().filter(row =>
            row.event.message[0] === RUNTIME_HISTORY_MESSAGE.MEK_ACTION_CHANGED)).toHaveSize(0);
        const history = (await force.serializeForPersistence()).cbt!.history;
        expect(history.t.flatMap(turn => turn.p.flat()).filter(message =>
            message[0] === RUNTIME_HISTORY_MESSAGE.MEK_ACTION_CHANGED)).toHaveSize(0);
        expect(force.getRuntimeUndoState()).toEqual({ canUndo: true, canRedo: false });
    });

    it('keeps shutdown and startup when they happen in different phases', async () => {
        const { force } = await readyCloneForce();
        const saved = await force.serializeForPersistence();
        const instanceId = saved.cbt!.roster.groups[0].members[0]!.instanceId;
        const declare = async (kind: 'shutdown' | 'startup', key: string) => {
            const snapshot = mekRuntimeSnapshot(force, instanceId);
            return force.dispatchMekUnitCommand(instanceId, {
                type: 'declare-mek-action',


                action: { schemaVersion: 1, kind },
            });
        };

        expect((await declare('shutdown', 'history:phased:shutdown')).accepted).toBeTrue();
        const shutdown = mekRuntimeSnapshot(force, instanceId);
        const shutdownCheck = shutdown.query.mekPilotChecks()[0]!;
        expect((await force.dispatchMekUnitCommand(instanceId, {
            type: 'resolve-mek-pilot-check',


            checkId: shutdownCheck.checkId,
            evidence: { dice: [6, 6], claimedOutcome: 'success' },
        })).accepted).toBeTrue();
        const beforeBoundary = mekRuntimeSnapshot(force, instanceId);
        expect((await force.dispatchMekUnitCommand(instanceId, {
            type: 'end-phase',


        })).accepted).toBeTrue();
        expect((await declare('startup', 'history:phased:startup')).accepted).toBeTrue();

        const actions = force.getRuntimeHistory().filter(row =>
            row.event.message[0] === RUNTIME_HISTORY_MESSAGE.MEK_ACTION_CHANGED);
        expect(actions.map(row => row.event.phase)).toEqual([1, 2]);
        expect(JSON.stringify(actions.map(row => [...row.event.message]))).toBe(JSON.stringify([
            [RUNTIME_HISTORY_MESSAGE.MEK_ACTION_CHANGED, instanceId, 0, 1],
            [RUNTIME_HISTORY_MESSAGE.MEK_ACTION_CHANGED, instanceId, 1, 0],
        ]));
        const persisted = (await force.serializeForPersistence()).cbt!.history;
        expect(persisted.t[0].p).toHaveSize(2);
    });

    it('folds Entity movement churn and advances Entity turns through the force owner', async () => {
        const { force, instanceId } = await readyEntityForce();
        const setMovement = async (movement: {
            readonly mode: 'stationary';
            readonly distance: 0;
            readonly boosterComponentIds: readonly [];
        } | null) => {
            const snapshot = entityRuntimeSnapshot(force, instanceId);
            return force.dispatchNonMekUnitCommand(instanceId, {
                kind: 'set-movement',

                movement,
            });
        };

        expect((await setMovement({
            mode: 'stationary', distance: 0, boosterComponentIds: [],
        })).accepted).toBeTrue();
        expect((await setMovement(null)).accepted).toBeTrue();
        expect(force.getRuntimeHistory().filter(row =>
            row.event.message[0] === RUNTIME_HISTORY_MESSAGE.MOVEMENT_CHANGED)).toHaveSize(0);

        const phase = entityRuntimeSnapshot(force, instanceId);
        expect((await force.dispatchNonMekUnitCommand(instanceId, {
            kind: 'end-phase',

        }))).toEqual(jasmine.objectContaining({ accepted: true, changed: true }));
        expect((await setMovement({
            mode: 'stationary', distance: 0, boosterComponentIds: [],
        })).accepted).toBeTrue();
        const movementRows = force.getRuntimeHistory().filter(row =>
            row.event.message[0] === RUNTIME_HISTORY_MESSAGE.MOVEMENT_CHANGED);
        expect(movementRows).toHaveSize(1);
        expect(movementRows[0].event.phase).toBe(2);

        const result = await force.endTurnForAllUnits();
        expect(result.accepted).toBeTrue();
        expect(result.results).toContain(jasmine.objectContaining({ instanceId, accepted: true }));
        expect(entityRuntimeSnapshot(force, instanceId).state.turn).toEqual({
            turnCounter: 1,
            airborne: null,
            movement: null,
            weaponsHeat: 0,
            cover: null,
            spotting: false,
            phaseStateChanged: false,
        });
        const saved = await force.serializeForPersistence();
        const entity = saved.cbt!.units.find(row => row.instanceId === instanceId)!;
        expect(isSerializedNonMekUnit(entity.unit)
            ? entity.unit.turn?.turnCounter
            : null).toBe(1);
    });

    it('folds movement implicitly cleared by an Entity airborne change', async () => {
        const { force, instanceId } = await readyEntityForce({ supportsAirborne: true });
        let snapshot = entityRuntimeSnapshot(force, instanceId);
        expect((await force.dispatchNonMekUnitCommand(instanceId, {
            kind: 'set-movement',

            movement: { mode: 'stationary', distance: 0, boosterComponentIds: [] },
        })).accepted).toBeTrue();

        snapshot = entityRuntimeSnapshot(force, instanceId);
        expect((await force.dispatchNonMekUnitCommand(instanceId, {
            kind: 'set-airborne',

            airborne: true,
        })).accepted).toBeTrue();
        expect(entityRuntimeSnapshot(force, instanceId).state.turn.movement).toBeNull();
        expect(force.getRuntimeHistory().filter(row =>
            row.event.message[0] === RUNTIME_HISTORY_MESSAGE.MOVEMENT_CHANGED)).toEqual([]);
        expect(force.getRuntimeHistory().filter(row =>
            row.event.message[0] === RUNTIME_HISTORY_MESSAGE.AIRBORNE_CHANGED)).toHaveSize(1);

        snapshot = entityRuntimeSnapshot(force, instanceId);
        expect((await force.dispatchNonMekUnitCommand(instanceId, {
            kind: 'set-airborne',

            airborne: null,
        })).accepted).toBeTrue();
        expect(force.getRuntimeHistory().filter(row =>
            row.event.message[0] === RUNTIME_HISTORY_MESSAGE.MOVEMENT_CHANGED
            || row.event.message[0] === RUNTIME_HISTORY_MESSAGE.AIRBORNE_CHANGED)).toEqual([]);
    });

    it('keeps target editing and deletion outside runtime undo and semantic history', async () => {
        const { force, instanceId } = await readyEntityForce();
        const registry = force.queryInventoryControlTargetRegistry();
        const targetId = asEncounterTargetId('target:undo-entity');
        expect(force.dispatchInventoryControlTargetRegistry({
            kind: 'create-target',

            target: {
                id: targetId,
                letter: 'A',
                name: 'Undo target',
                color: '#123456',
            },
        }).accepted).toBeTrue();
        const targeting = force.getAttackerTargeting(instanceId)!;
        expect((await force.dispatchAttackerTargeting(instanceId, {
            type: 'edit-attacker-targeting',



            edit: { kind: 'set-target-facts', targetId, facts: { distance: 6 } },
        })).accepted).toBeTrue();
        expect(force.getRuntimeUndoState()).toEqual({ canUndo: false, canRedo: false });
        expect(force.getRuntimeHistory()).toEqual([]);
        const beforeDelete = force.queryInventoryControlTargetRegistry();
        expect(force.dispatchInventoryControlTargetRegistry({
            kind: 'delete-target',

            targetId,
        }).accepted).toBeTrue();
        expect(force.queryInventoryControlTargetRegistry().targets).toEqual([]);
        expect(force.getAttackerTargeting(instanceId)?.state.targets.has(targetId)).toBeFalse();
        expect(force.getRuntimeUndoState()).toEqual({ canUndo: false, canRedo: false });
        expect(force.getRuntimeHistory()).toEqual([]);
        expect((await force.undoRuntimeCommand()).accepted).toBeFalse();
    });

    it('does not roll operational targeting backward with an earlier unit undo', async () => {
        const { force, instanceId } = await readyEntityForce();
        const registry = force.queryInventoryControlTargetRegistry();
        const targetId = asEncounterTargetId('target:operational-undo');
        expect(force.dispatchInventoryControlTargetRegistry({
            kind: 'create-target',

            target: { id: targetId, letter: 'A', name: 'Target A', color: '#123456' },
        }).accepted).toBeTrue();
        const setDistance = async (distance: number, key: string) => {
            const targeting = force.getAttackerTargeting(instanceId)!;
            return force.dispatchAttackerTargeting(instanceId, {
                type: 'edit-attacker-targeting',



                edit: { kind: 'set-target-facts', targetId, facts: { distance } },
            });
        };
        expect((await setDistance(6, 'targeting:distance:6')).accepted).toBeTrue();

        let snapshot = entityRuntimeSnapshot(force, instanceId);
        expect((await force.dispatchNonMekUnitCommand(instanceId, {
            kind: 'set-condition',

            condition: 'immobile',
            active: true,
        })).accepted).toBeTrue();
        expect((await setDistance(7, 'targeting:distance:7')).accepted).toBeTrue();

        expect((await force.undoRuntimeCommand()).accepted).toBeTrue();
        expect(force.getUnitConditions(instanceId)).toEqual([]);
        expect(force.getAttackerTargeting(instanceId)?.state.targets.get(targetId)?.distance).toBe(7);

        expect((await force.redoRuntimeCommand()).accepted).toBeTrue();
        expect(force.getUnitConditions(instanceId)).toEqual(['immobile']);
        expect(force.getAttackerTargeting(instanceId)?.state.targets.get(targetId)?.distance).toBe(7);
        expect(force.getRuntimeHistory().map(row => row.event.message[0])).toEqual([
            RUNTIME_HISTORY_MESSAGE.CONDITION_CHANGED,
        ]);
    });

});
