// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Era } from '../models/eras.model';
import type { Faction } from '../models/factions.model';
import type { UnitSummary } from '../models/unit-summary.model';
import { GameSystem } from '../models/common.model';
import type { ASSerializedState, SerializedForce } from '../models/force-serialization';
import { ASForce } from '../models/as-force.model';
import { DataService } from './data.service';
import { ForcePersistenceService } from './force-persistence.service';
import { DbService } from './db.service';
import { LoggerService } from './logger.service';
import { PublicTagsService } from './public-tags.service';
import { TagsService } from './tags.service';
import { UnitRuntimeService } from './unit-runtime.service';
import { UserStateService } from './userState.service';
import { WsService } from './ws.service';
import { UnitSearchIndexService } from './unit-search-index.service';
import { UnitsCatalogService } from './catalogs/units-catalog.service';
import { EquipmentCatalogService } from './catalogs/equipment-catalog.service';
import { ErasCatalogService } from './catalogs/eras-catalog.service';
import { FactionsCatalogService } from './catalogs/mulfactions-catalog.service';
import { MegaMekAvailabilityCatalogService } from './catalogs/megamek-availability-catalog.service';
import { MegaMekFactionsCatalogService } from './catalogs/megamek-factions-catalog.service';
import { MegaMekRulesetsCatalogService } from './catalogs/megamek-rulesets-catalog.service';
import { QuirksCatalogService } from './catalogs/quirks-catalog.service';
import { SarnaPageTitlesCatalogService } from './catalogs/sarna-page-titles-catalog.service';
import { SourcebooksCatalogService } from './catalogs/sourcebooks-catalog.service';
import { ForceNameWordsCatalogService } from './catalogs/force-name-words-catalog.service';
import { createEmptyForceNameWords } from '../models/force-name-words.model';
import { createEmptyCBTForceForTest, createEmptyUnit } from '../testing/unit-test-helpers';
import { MULFACTION_NONE } from '../models/mulfactions.model';
import { EquipmentRegistry } from '../models/equipment-lookup';
import { MiscEquipment } from '../models/equipment.model';
import { PresentationCatalogSyncService } from './catalogs/presentation-catalog-sync.service';
import { CBT_FORCE_PERSISTENCE_SCHEMA_VERSION } from '../models/runtime/persistence-v2';
import { encodeForceForStorage } from '../models/runtime/force-storage-codec';

function createUnit(name: string): UnitSummary {
    return createEmptyUnit({ name });
}

function createSerializedForceForTest(overrides: Partial<SerializedForce> = {}): SerializedForce {
    return {
        version: 2,
        instanceId: 'force-test',
        timestamp: '2026-04-05T00:00:00Z',
        type: GameSystem.ALPHA_STRIKE,
        name: 'Test Force',
        groups: [],
        ...overrides,
    };
}

function createASStateForTest(overrides: Partial<ASSerializedState> = {}): ASSerializedState {
    return {
        modified: false,
        destroyed: false,
        heat: [0, 0],
        armor: [0, 0],
        internal: [0, 0],
        crits: [],
        pCrits: [],
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

function waitForUnitCatalogSettlement(service: DataService): Promise<void> {
    return (service as any).unitCatalogSettlement;
}

function withMockWholeOwnerAuthority<T extends Record<string, any>>(
    force: T,
    canonicalSerialization?: SerializedForce,
): T {
    const mock = force as any;
    const canonical = canonicalSerialization === undefined
        ? undefined
        : structuredClone(canonicalSerialization);
    if (canonical !== undefined) {
        mock.serialize ??= () => structuredClone(canonical);
    }
    mock.owned ??= signal(true);
    mock.readOnly ??= () => !mock.owned();
    mock.isWholeOwnerActive ??= () => true;
    mock.isWholeOwnerRetired ??= () => false;
    mock.markCloudCBTForceV2Saved ??= () => undefined;
    type AuthoritySnapshot = {
        readonly instanceId: unknown;
        readonly owned: unknown;
        readonly readOnly: unknown;
        readonly name: unknown;
        readonly timestamp: unknown;
        readonly expectedRevision: unknown;
        readonly groups: readonly { readonly group: unknown; readonly id: unknown; readonly units: readonly unknown[] }[];
    };
    const bindings = new WeakMap<object, AuthoritySnapshot>();
    const snapshot = () => ({
        instanceId: mock.instanceId?.(),
        owned: mock.owned(),
        readOnly: mock.readOnly(),
        name: mock.name,
        timestamp: mock.timestamp,
        expectedRevision: mock.getExpectedCloudCBTForceV2Revision?.(),
        groups: (mock.groups?.() ?? []).map((group: any) => ({
            group,
            id: group.id,
            units: [...(group.units?.() ?? [])],
        })),
    });
    const revisionBindings = new WeakMap<object, AuthoritySnapshot>();
    mock.captureWholeOwnerAuthorityFingerprint = () => {
        const fingerprint = Object.freeze({});
        bindings.set(fingerprint, snapshot());
        return fingerprint;
    };
    mock.isWholeOwnerAuthorityFingerprintCurrent = (fingerprint: object) => {
        const expected = bindings.get(fingerprint);
        if (!expected) return false;
        const current = snapshot();
        return mock.isWholeOwnerActive()
            && expected.instanceId === current.instanceId
            && expected.owned === current.owned
            && expected.readOnly === current.readOnly
            && expected.name === current.name
            && expected.timestamp === current.timestamp
            && expected.expectedRevision === current.expectedRevision
            && expected.groups.length === current.groups.length
            && expected.groups.every((entry, index) => entry.group === current.groups[index].group
                && entry.id === current.groups[index].id
                && entry.units.length === current.groups[index].units.length
                && entry.units.every((unit, unitIndex) => unit === current.groups[index].units[unitIndex]));
    };
    mock.captureForceOwnerRevisionFence = () => {
        const fence = Object.freeze({});
        revisionBindings.set(fence, snapshot());
        return fence;
    };
    mock.isForceOwnerRevisionFenceCurrent = (fence: object) => {
        const expected = revisionBindings.get(fence);
        if (!expected) return false;
        const current = snapshot();
        return mock.isWholeOwnerActive()
            && expected.instanceId === current.instanceId
            && expected.owned === current.owned
            && expected.readOnly === current.readOnly
            && expected.name === current.name
            && expected.timestamp === current.timestamp
            && expected.groups.length === current.groups.length
            && expected.groups.every((entry, index) => entry.group === current.groups[index].group
                && entry.id === current.groups[index].id
                && entry.units.length === current.groups[index].units.length
                && entry.units.every((unit, unitIndex) => unit === current.groups[index].units[unitIndex]));
    };
    mock.serializeForPersistenceWithAuthorityFence ??= async () => ({
        serialized: await mock.serializeForPersistence(),
        authorityFingerprint: mock.captureWholeOwnerAuthorityFingerprint(),
        revisionFence: mock.captureForceOwnerRevisionFence(),
    });
    mock.serializeForPersistenceWithRevisionFence ??= async () => {
        const prepared = await mock.serializeForPersistenceWithAuthorityFence();
        return {
            serialized: prepared.serialized,
            revisionFence: prepared.revisionFence,
            identityPromotionProof: prepared.identityPromotionProof,
        };
    };
    return force;
}

describe('DataService', () => {
    let service: DataService;
    let forcePersistence: ForcePersistenceService;
    const acceptStagedRemoteForce = (staged: Awaited<ReturnType<ForcePersistenceService['stageRemoteForceSnapshot']>>) => {
        const prepared = forcePersistence.prepareRemoteForceSnapshotAcceptance(staged);
        const activeAuthorities = (forcePersistence as any).activeForceAuthority as Map<string, any>;
        const instanceId = staged.force.instanceId();
        if (!instanceId) throw new Error('Staged test force has no instance ID.');
        let predecessor = activeAuthorities.get(instanceId);
        if (!predecessor) {
            predecessor = {
                instanceId: signal(instanceId),
                isWholeOwnerActive: () => true,
                consumeWholeOwnerReplacementCommitAuthority: () => true,
                isWholeOwnerRetired: () => true,
            };
            forcePersistence.activateForceAuthority(predecessor);
        } else if (!predecessor.consumeWholeOwnerReplacementCommitAuthority) {
            predecessor.consumeWholeOwnerReplacementCommitAuthority = () => true;
        }
        const result = forcePersistence.commitPreparedRemoteForceReplacement(
            prepared,
            predecessor,
            Object.freeze({}) as any,
        );
        if (!result.accepted) throw new Error(`Prepared acceptance rejected: ${result.reason}`);
        predecessor.isWholeOwnerRetired = () => true;
        result.finalize();
        return result.persistence();
    };
    const dbServiceMock = {
        getForce: jasmine.createSpy('getForce'),
        listForces: jasmine.createSpy('listForces'),
        countForces: jasmine.createSpy('countForces'),
        saveForce: jasmine.createSpy('saveForce'),
        deleteForce: jasmine.createSpy('deleteForce'),
        updateForceTags: jasmine.createSpy('updateForceTags'),
        waitForDbReady: jasmine.createSpy('waitForDbReady').and.resolveTo(undefined),
    };
    const wsServiceMock = {
        getWebSocket: jasmine.createSpy('getWebSocket').and.returnValue(null),
        getWsReady: jasmine.createSpy('getWsReady').and.resolveTo(undefined),
        sendAndWaitForResponse: jasmine.createSpy('sendAndWaitForResponse'),
        send: jasmine.createSpy('send'),
    };
    const userStateServiceMock = {
        uuid: jasmine.createSpy('uuid').and.returnValue('user-1'),
    };
    const unitRuntimeServiceMock = {
        getUnitByName: jasmine.createSpy('getUnitByName').and.returnValue(undefined),
        getUnitByUuid: jasmine.createSpy('getUnitByUuid').and.returnValue(undefined),
        getSavedEntityIdentity: jasmine.createSpy('getSavedEntityIdentity').and.returnValue(undefined),
        resolveUnitReference: jasmine.createSpy('resolveUnitReference'),
        resolvePersistedUnitIdentity: jasmine.createSpy('resolvePersistedUnitIdentity').and.callFake(
            (reference: { unit: string }) => ({
                kind: 'unresolved' as const,
                rawLegacyName: reference.unit,
                candidates: [],
                reason: 'catalog-not-ready' as const,
            }),
        ),
        prepareRuntimeCatalog: jasmine.createSpy('prepareRuntimeCatalog').and.returnValue({
            unitNameMap: new Map(),
            unitIdentityMap: new Map(),
        }),
        commitPreparedRuntimeCatalog: jasmine.createSpy('commitPreparedRuntimeCatalog'),
        applyTagDataToUnits: jasmine.createSpy('applyTagDataToUnits'),
        applyPreparedTagDataToUnits: jasmine.createSpy('applyPreparedTagDataToUnits'),
        applyPublicTagsToUnits: jasmine.createSpy('applyPublicTagsToUnits'),
        loadUnitTags: jasmine.createSpy('loadUnitTags').and.resolveTo(null),
        postprocessUnits: jasmine.createSpy('postprocessUnits'),
        linkEquipmentToUnits: jasmine.createSpy('linkEquipmentToUnits'),
    };
    const unitSearchIndexServiceMock = {
        rebuildIndexes: jasmine.createSpy('rebuildIndexes'),
        rebuildTagSearchIndex: jasmine.createSpy('rebuildTagSearchIndex'),
        prepareCatalogIndexes: jasmine.createSpy('prepareCatalogIndexes').and.returnValue({
            unitSubtypeMaxStats: {},
            unitAsTypeMaxStats: {},
            searchFilterIndex: new Map(),
            componentCountIndex: new Map(),
            searchFilterValues: new Map(),
            dropdownOptionUniverse: new Map(),
            factionEraSnapshot: {},
        }),
        commitPreparedCatalogIndexes: jasmine.createSpy('commitPreparedCatalogIndexes'),
    };
    const unitCatalogRevision = signal(0);
    const pendingUnitCatalogActivation = signal<any>(undefined);
    const unitsCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getUnits: jasmine.createSpy('getUnits').and.returnValue([]),
        coreState: signal({ status: 'idle', availableUnits: 0 } as const).asReadonly(),
        catalogRevision: unitCatalogRevision.asReadonly(),
        pendingActivation: pendingUnitCatalogActivation.asReadonly(),
        finalizePendingActivation: jasmine.createSpy('finalizePendingActivation').and.resolveTo(true),
        commitPendingActivation: jasmine.createSpy('commitPendingActivation'),
        rejectPendingActivation: jasmine.createSpy('rejectPendingActivation'),
        acknowledgeCatalogRevisionApplied: jasmine.createSpy('acknowledgeCatalogRevisionApplied').and.resolveTo(),
    };
    const presentationCatalogsMock = {
        initializeFluffImages: jasmine.createSpy('initializeFluffImages').and.resolveTo(undefined),
    };
    const equipmentCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getEquipmentRegistry: jasmine.createSpy('getEquipmentRegistry').and.returnValue(new EquipmentRegistry({})),
    };
    const erasCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getEras: jasmine.createSpy('getEras').and.returnValue([]),
        getEraByName: jasmine.createSpy('getEraByName').and.returnValue(undefined),
        getEraById: jasmine.createSpy('getEraById').and.returnValue(undefined),
    };
    const factionsCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getFactions: jasmine.createSpy('getFactions').and.returnValue([]),
        getFactionByName: jasmine.createSpy('getFactionByName').and.returnValue(undefined),
        getFactionById: jasmine.createSpy('getFactionById').and.returnValue(undefined),
    };
    const megaMekAvailabilityCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        hydrateFromCache: jasmine.createSpy('hydrateFromCache').and.resolveTo(false),
        getCatalogRevision: jasmine.createSpy('getCatalogRevision').and.returnValue('unversioned'),
        getRecords: jasmine.createSpy('getRecords').and.returnValue([]),
        getRecordForUnit: jasmine.createSpy('getRecordForUnit').and.returnValue(undefined),
    };
    const megaMekFactionsCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getFactions: jasmine.createSpy('getFactions').and.returnValue({}),
        getFactionByKey: jasmine.createSpy('getFactionByKey').and.returnValue(undefined),
        getFactionsByMulId: jasmine.createSpy('getFactionsByMulId').and.returnValue([]),
        getFactionAffiliation: jasmine.createSpy('getFactionAffiliation').and.returnValue('Other'),
    };
    const megaMekRulesetsCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getRulesets: jasmine.createSpy('getRulesets').and.returnValue([]),
        getRulesetByFactionKey: jasmine.createSpy('getRulesetByFactionKey').and.returnValue(undefined),
    };
    const quirksCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getQuirkByName: jasmine.createSpy('getQuirkByName').and.returnValue(undefined),
    };
    const sarnaPageTitlesCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getPageTitleForUnit: jasmine.createSpy('getPageTitleForUnit').and.returnValue(undefined),
    };
    const sourcebooksCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getSourcebookByAbbrev: jasmine.createSpy('getSourcebookByAbbrev').and.returnValue(undefined),
        getSourcebookTitle: jasmine.createSpy('getSourcebookTitle').and.callFake((abbrev: string) => abbrev),
    };
    const forceNameWordsCatalogMock = {
        initialize: jasmine.createSpy('initialize').and.resolveTo(undefined),
        getWords: jasmine.createSpy('getWords').and.callFake(() => createEmptyForceNameWords()),
    };
    const tagsServiceMock = {
        setRefreshUnitsCallback: jasmine.createSpy('setRefreshUnitsCallback'),
        setNotifyStoreUpdatedCallback: jasmine.createSpy('setNotifyStoreUpdatedCallback'),
        registerWsHandlers: jasmine.createSpy('registerWsHandlers'),
        syncFromCloud: jasmine.createSpy('syncFromCloud'),
    };
    const publicTagsServiceMock = {
        setRefreshUnitsCallback: jasmine.createSpy('setRefreshUnitsCallback'),
        initialize: jasmine.createSpy('initialize'),
        registerWsHandlers: jasmine.createSpy('registerWsHandlers'),
    };
    const loggerServiceMock = {
        info: jasmine.createSpy('info'),
        warn: jasmine.createSpy('warn'),
        error: jasmine.createSpy('error'),
    };

    let nextMockCatalogRevision = 1;
    const queueMockCatalogActivation = (units: UnitSummary[] = unitsCatalogMock.getUnits()): any => {
        const revision = nextMockCatalogRevision++;
        const pending = {
            revision,
            coreRevision: revision,
            snapshot: {
                revision,
                coreRevision: revision,
                summaries: [],
                units,
                summariesByIdentity: new Map(),
            },
            core: {
                revision,
                snapshot: { revision, summaries: [] },
                dependencies: {
                    equipment: { registry: equipmentCatalogMock.getEquipmentRegistry() },
                    eras: { eras: erasCatalogMock.getEras() },
                    factions: { factions: factionsCatalogMock.getFactions() },
                },
            },
        };
        pendingUnitCatalogActivation.set(pending);
        return pending;
    };
    beforeEach(() => {
        TestBed.resetTestingModule();
        dbServiceMock.getForce.calls.reset();
        dbServiceMock.getForce.and.resolveTo(null);
        dbServiceMock.listForces.calls.reset();
        dbServiceMock.listForces.and.resolveTo([]);
        dbServiceMock.countForces.calls.reset();
        dbServiceMock.countForces.and.resolveTo(1);
        dbServiceMock.saveForce.calls.reset();
        dbServiceMock.saveForce.and.resolveTo(undefined);
        dbServiceMock.deleteForce.calls.reset();
        dbServiceMock.deleteForce.and.resolveTo(undefined);
        dbServiceMock.updateForceTags.calls.reset();
        dbServiceMock.updateForceTags.and.resolveTo(null);
        dbServiceMock.waitForDbReady.calls.reset();
        dbServiceMock.waitForDbReady.and.resolveTo(undefined);
        wsServiceMock.sendAndWaitForResponse.calls.reset();
        wsServiceMock.send.calls.reset();
        wsServiceMock.getWebSocket.calls.reset();
        wsServiceMock.getWebSocket.and.returnValue(null);
        wsServiceMock.getWsReady.calls.reset();
        wsServiceMock.getWsReady.and.resolveTo(undefined);
        wsServiceMock.sendAndWaitForResponse.and.resolveTo(undefined);
        userStateServiceMock.uuid.calls.reset();
        userStateServiceMock.uuid.and.returnValue('user-1');
        unitRuntimeServiceMock.getUnitByName.calls.reset();
        unitRuntimeServiceMock.getUnitByName.and.returnValue(undefined);
        unitRuntimeServiceMock.getUnitByUuid.calls.reset();
        unitRuntimeServiceMock.getUnitByUuid.and.returnValue(undefined);
        unitRuntimeServiceMock.getSavedEntityIdentity.calls.reset();
        unitRuntimeServiceMock.getSavedEntityIdentity.and.returnValue(undefined);
        unitRuntimeServiceMock.resolveUnitReference.calls.reset();
        unitRuntimeServiceMock.resolvePersistedUnitIdentity.calls.reset();
        unitRuntimeServiceMock.prepareRuntimeCatalog.calls.reset();
        unitRuntimeServiceMock.prepareRuntimeCatalog.and.returnValue({
            unitNameMap: new Map(),
            unitIdentityMap: new Map(),
        });
        unitRuntimeServiceMock.commitPreparedRuntimeCatalog.calls.reset();
        unitRuntimeServiceMock.applyTagDataToUnits.calls.reset();
        unitRuntimeServiceMock.applyPreparedTagDataToUnits.calls.reset();
        unitRuntimeServiceMock.applyPublicTagsToUnits.calls.reset();
        unitRuntimeServiceMock.loadUnitTags.calls.reset();
        unitRuntimeServiceMock.loadUnitTags.and.resolveTo(null);
        unitRuntimeServiceMock.postprocessUnits.calls.reset();
        unitRuntimeServiceMock.linkEquipmentToUnits.calls.reset();
        unitSearchIndexServiceMock.rebuildIndexes.calls.reset();
        unitSearchIndexServiceMock.rebuildIndexes.and.stub();
        unitSearchIndexServiceMock.rebuildTagSearchIndex.calls.reset();
        unitSearchIndexServiceMock.prepareCatalogIndexes.calls.reset();
        unitSearchIndexServiceMock.prepareCatalogIndexes.and.returnValue({
            unitSubtypeMaxStats: {},
            unitAsTypeMaxStats: {},
            searchFilterIndex: new Map(),
            componentCountIndex: new Map(),
            searchFilterValues: new Map(),
            dropdownOptionUniverse: new Map(),
            factionEraSnapshot: {},
        });
        unitSearchIndexServiceMock.commitPreparedCatalogIndexes.calls.reset();
        unitsCatalogMock.initialize.calls.reset();
        unitsCatalogMock.initialize.and.callFake(async () => { queueMockCatalogActivation(); });
        unitsCatalogMock.getUnits.calls.reset();
        unitsCatalogMock.getUnits.and.returnValue([]);
        unitsCatalogMock.acknowledgeCatalogRevisionApplied.calls.reset();
        unitsCatalogMock.acknowledgeCatalogRevisionApplied.and.resolveTo();
        unitsCatalogMock.finalizePendingActivation.calls.reset();
        unitsCatalogMock.finalizePendingActivation.and.resolveTo(true);
        unitsCatalogMock.commitPendingActivation.calls.reset();
        unitsCatalogMock.commitPendingActivation.and.callFake((revision: number) => {
            const pending = pendingUnitCatalogActivation();
            if (!pending || pending.revision !== revision) return undefined;
            pendingUnitCatalogActivation.set(undefined);
            unitCatalogRevision.set(pending.snapshot.revision);
            unitsCatalogMock.getUnits.and.returnValue(pending.snapshot.units);
            return pending.snapshot;
        });
        unitsCatalogMock.rejectPendingActivation.calls.reset();
        unitsCatalogMock.rejectPendingActivation.and.callFake((revision: number) => {
            if (pendingUnitCatalogActivation()?.revision === revision) {
                pendingUnitCatalogActivation.set(undefined);
            }
        });
        nextMockCatalogRevision = 1;
        pendingUnitCatalogActivation.set(undefined);
        unitCatalogRevision.set(0);
        presentationCatalogsMock.initializeFluffImages.calls.reset();
        presentationCatalogsMock.initializeFluffImages.and.resolveTo(undefined);
        equipmentCatalogMock.initialize.calls.reset();
        equipmentCatalogMock.initialize.and.resolveTo(undefined);
        equipmentCatalogMock.getEquipmentRegistry.calls.reset();
        equipmentCatalogMock.getEquipmentRegistry.and.returnValue(new EquipmentRegistry({}));
        erasCatalogMock.initialize.calls.reset();
        erasCatalogMock.initialize.and.resolveTo(undefined);
        erasCatalogMock.getEras.calls.reset();
        erasCatalogMock.getEras.and.returnValue([]);
        erasCatalogMock.getEraByName.calls.reset();
        erasCatalogMock.getEraByName.and.returnValue(undefined);
        erasCatalogMock.getEraById.calls.reset();
        erasCatalogMock.getEraById.and.returnValue(undefined);
        factionsCatalogMock.initialize.calls.reset();
        factionsCatalogMock.initialize.and.resolveTo(undefined);
        factionsCatalogMock.getFactions.calls.reset();
        factionsCatalogMock.getFactions.and.returnValue([]);
        factionsCatalogMock.getFactionByName.calls.reset();
        factionsCatalogMock.getFactionByName.and.returnValue(undefined);
        factionsCatalogMock.getFactionById.calls.reset();
        factionsCatalogMock.getFactionById.and.returnValue(undefined);
        megaMekAvailabilityCatalogMock.initialize.calls.reset();
        megaMekAvailabilityCatalogMock.initialize.and.resolveTo(undefined);
        megaMekAvailabilityCatalogMock.hydrateFromCache.calls.reset();
        megaMekAvailabilityCatalogMock.hydrateFromCache.and.resolveTo(false);
        megaMekAvailabilityCatalogMock.getCatalogRevision.calls.reset();
        megaMekAvailabilityCatalogMock.getCatalogRevision.and.returnValue('unversioned');
        megaMekAvailabilityCatalogMock.getRecords.calls.reset();
        megaMekAvailabilityCatalogMock.getRecords.and.returnValue([]);
        megaMekAvailabilityCatalogMock.getRecordForUnit.calls.reset();
        megaMekAvailabilityCatalogMock.getRecordForUnit.and.returnValue(undefined);
        megaMekFactionsCatalogMock.initialize.calls.reset();
        megaMekFactionsCatalogMock.initialize.and.resolveTo(undefined);
        megaMekFactionsCatalogMock.getFactions.calls.reset();
        megaMekFactionsCatalogMock.getFactions.and.returnValue({});
        megaMekFactionsCatalogMock.getFactionByKey.calls.reset();
        megaMekFactionsCatalogMock.getFactionByKey.and.returnValue(undefined);
        megaMekFactionsCatalogMock.getFactionsByMulId.calls.reset();
        megaMekFactionsCatalogMock.getFactionsByMulId.and.returnValue([]);
        megaMekFactionsCatalogMock.getFactionAffiliation.calls.reset();
        megaMekFactionsCatalogMock.getFactionAffiliation.and.returnValue('Other');
        megaMekRulesetsCatalogMock.initialize.calls.reset();
        megaMekRulesetsCatalogMock.initialize.and.resolveTo(undefined);
        megaMekRulesetsCatalogMock.getRulesets.calls.reset();
        megaMekRulesetsCatalogMock.getRulesets.and.returnValue([]);
        megaMekRulesetsCatalogMock.getRulesetByFactionKey.calls.reset();
        megaMekRulesetsCatalogMock.getRulesetByFactionKey.and.returnValue(undefined);
        quirksCatalogMock.initialize.calls.reset();
        quirksCatalogMock.initialize.and.resolveTo(undefined);
        quirksCatalogMock.getQuirkByName.calls.reset();
        quirksCatalogMock.getQuirkByName.and.returnValue(undefined);
        sarnaPageTitlesCatalogMock.initialize.calls.reset();
        sarnaPageTitlesCatalogMock.initialize.and.resolveTo(undefined);
        sarnaPageTitlesCatalogMock.getPageTitleForUnit.calls.reset();
        sarnaPageTitlesCatalogMock.getPageTitleForUnit.and.returnValue(undefined);
        sourcebooksCatalogMock.initialize.calls.reset();
        sourcebooksCatalogMock.initialize.and.resolveTo(undefined);
        sourcebooksCatalogMock.getSourcebookByAbbrev.calls.reset();
        sourcebooksCatalogMock.getSourcebookByAbbrev.and.returnValue(undefined);
        sourcebooksCatalogMock.getSourcebookTitle.calls.reset();
        sourcebooksCatalogMock.getSourcebookTitle.and.callFake((abbrev: string) => abbrev);
        forceNameWordsCatalogMock.initialize.calls.reset();
        forceNameWordsCatalogMock.initialize.and.resolveTo(undefined);
        forceNameWordsCatalogMock.getWords.calls.reset();
        forceNameWordsCatalogMock.getWords.and.callFake(() => createEmptyForceNameWords());
        tagsServiceMock.setRefreshUnitsCallback.calls.reset();
        tagsServiceMock.setNotifyStoreUpdatedCallback.calls.reset();
        tagsServiceMock.registerWsHandlers.calls.reset();
        tagsServiceMock.syncFromCloud.calls.reset();
        publicTagsServiceMock.setRefreshUnitsCallback.calls.reset();
        publicTagsServiceMock.initialize.calls.reset();
        publicTagsServiceMock.registerWsHandlers.calls.reset();
        loggerServiceMock.info.calls.reset();
        loggerServiceMock.warn.calls.reset();
        loggerServiceMock.error.calls.reset();

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                DataService,
                ForcePersistenceService,
                { provide: DbService, useValue: dbServiceMock },
                { provide: WsService, useValue: wsServiceMock },
                { provide: UserStateService, useValue: userStateServiceMock },
                { provide: UnitRuntimeService, useValue: unitRuntimeServiceMock },
                { provide: UnitSearchIndexService, useValue: unitSearchIndexServiceMock },
                { provide: UnitsCatalogService, useValue: unitsCatalogMock },
                { provide: PresentationCatalogSyncService, useValue: presentationCatalogsMock },
                { provide: EquipmentCatalogService, useValue: equipmentCatalogMock },
                { provide: ErasCatalogService, useValue: erasCatalogMock },
                { provide: FactionsCatalogService, useValue: factionsCatalogMock },
                { provide: MegaMekAvailabilityCatalogService, useValue: megaMekAvailabilityCatalogMock },
                { provide: MegaMekFactionsCatalogService, useValue: megaMekFactionsCatalogMock },
                { provide: MegaMekRulesetsCatalogService, useValue: megaMekRulesetsCatalogMock },
                { provide: QuirksCatalogService, useValue: quirksCatalogMock },
                { provide: SarnaPageTitlesCatalogService, useValue: sarnaPageTitlesCatalogMock },
                { provide: SourcebooksCatalogService, useValue: sourcebooksCatalogMock },
                { provide: ForceNameWordsCatalogService, useValue: forceNameWordsCatalogMock },
                { provide: TagsService, useValue: tagsServiceMock },
                { provide: PublicTagsService, useValue: publicTagsServiceMock },
                { provide: LoggerService, useValue: loggerServiceMock },
            ],
        });

        service = TestBed.inject(DataService);
        forcePersistence = TestBed.inject(ForcePersistenceService);
    });

    it('delegates unit lookup to the runtime service', () => {
        service.getUnitByName('Mad Cat Prime');
        service.getUnitByUuid('unit-uuid');

        expect(unitRuntimeServiceMock.getUnitByName).toHaveBeenCalledOnceWith('Mad Cat Prime');
        expect(unitRuntimeServiceMock.getUnitByUuid).toHaveBeenCalledOnceWith('unit-uuid');
    });

    it('resolves equipment names through the catalog registry', () => {
        const equipment = new MiscEquipment({
            id: 'Canonical Equipment',
            name: 'Canonical Equipment',
            type: 'misc',
            aliases: ['Legacy Equipment'],
        });
        equipmentCatalogMock.getEquipmentRegistry.and.returnValue(new EquipmentRegistry({
            [equipment.internalName]: equipment,
        }));

        expect(service.findEquipment('  Legacy Equipment  ')).toBe(equipment);
        expect(service.findEquipment('Missing Equipment')).toBeUndefined();
    });

    it('delegates Sarna page-title lookup to the Sarna catalog', () => {
        const unit = createEmptyUnit({ chassis: 'Avatar', type: 'Mek', subtype: 'BattleMek Omni', omni: 1 });
        sarnaPageTitlesCatalogMock.getPageTitleForUnit.and.returnValue('Avatar (OmniMech)');

        expect(service.getSarnaPageTitleForUnit(unit)).toBe('Avatar (OmniMech)');
        expect(sarnaPageTitlesCatalogMock.getPageTitleForUnit).toHaveBeenCalledOnceWith(unit);
    });

    it('delegates faction and era ID lookups to their indexed catalogs before activation', () => {
        const era = { id: 42, name: 'Indexed Era' } as Era;
        const faction = { id: 17, name: 'Indexed Faction' } as Faction;
        erasCatalogMock.getEraById.and.returnValue(era);
        factionsCatalogMock.getFactionById.and.returnValue(faction);

        expect(service.getEraById(era.id)).toBe(era);
        expect(service.getFactionById(faction.id)).toBe(faction);
        expect(erasCatalogMock.getEraById).toHaveBeenCalledOnceWith(era.id);
        expect(factionsCatalogMock.getFactionById).toHaveBeenCalledOnceWith(faction.id);
    });

    it('adds units with no faction data to the synthetic None faction for valid eras', async () => {
        const earlyEra: Era = {
            id: 1,
            name: 'Early',
            years: { from: 2500, to: 2600 },
            factions: new Set<number>(),
            units: new Set<number>(),
        };
        const introEra: Era = {
            id: 2,
            name: 'Intro',
            years: { from: 2600, to: 2700 },
            factions: new Set<number>(),
            units: new Set<number>(),
        };
        const openEra: Era = {
            id: 3,
            name: 'Open',
            years: { from: 2701 },
            factions: new Set<number>(),
            units: new Set<number>(),
        };
        const noneFaction: Faction = {
            id: MULFACTION_NONE,
            name: 'None',
            group: 'Other' as const,
            img: '',
            eras: {},
        };
        const houseFaction: Faction = {
            id: 10,
            name: 'House Test',
            group: 'Inner Sphere' as const,
            img: '',
            eras: {
                [introEra.id]: new Set<number>([3]),
            },
        };
        const noFactionUnit = createEmptyUnit({ id: -1, name: 'No Faction', year: 2600 });
        const futureNoFactionUnit = createEmptyUnit({ id: -2, name: 'Future No Faction', year: 2701 });
        const houseUnit = createEmptyUnit({ id: 3, name: 'House Unit', year: 2600 });

        unitsCatalogMock.getUnits.and.returnValue([noFactionUnit, futureNoFactionUnit, houseUnit]);
        erasCatalogMock.getEras.and.returnValue([earlyEra, introEra, openEra]);
        factionsCatalogMock.getFactions.and.returnValue([noneFaction, houseFaction]);
        factionsCatalogMock.getFactionById.and.callFake((id: number) => {
            if (id === noneFaction.id) return noneFaction;
            if (id === houseFaction.id) return houseFaction;
            return undefined;
        });

        await service.initialize();
        await waitForUnitCatalogSettlement(service);

        const activeEras = service.getEras();
        const activeFactions = service.getFactions();
        const activeEarly = activeEras.find(era => era.id === earlyEra.id)!;
        const activeIntro = activeEras.find(era => era.id === introEra.id)!;
        const activeOpen = activeEras.find(era => era.id === openEra.id)!;
        const activeNone = activeFactions.find(faction => faction.id === MULFACTION_NONE)!;
        const activeHouse = activeFactions.find(faction => faction.id === houseFaction.id)!;
        erasCatalogMock.getEraById.calls.reset();
        factionsCatalogMock.getFactionById.calls.reset();
        expect(service.getEraById(activeIntro.id)).toBe(activeIntro);
        expect(service.getFactionById(activeHouse.id)).toBe(activeHouse);
        expect(erasCatalogMock.getEraById).not.toHaveBeenCalled();
        expect(factionsCatalogMock.getFactionById).not.toHaveBeenCalled();
        expect(activeNone.eras[introEra.id]).toEqual(new Set<number>([noFactionUnit.id]));
        expect(activeNone.eras[openEra.id]).toEqual(new Set<number>([noFactionUnit.id, futureNoFactionUnit.id]));
        expect(activeNone.eras[earlyEra.id]).toBeUndefined();
        expect((activeEarly.units as Set<number>).has(noFactionUnit.id)).toBeFalse();
        expect((activeEarly.units as Set<number>).has(futureNoFactionUnit.id)).toBeFalse();
        expect((activeIntro.units as Set<number>).has(noFactionUnit.id)).toBeTrue();
        expect((activeIntro.units as Set<number>).has(futureNoFactionUnit.id)).toBeFalse();
        expect((activeOpen.units as Set<number>).has(noFactionUnit.id)).toBeTrue();
        expect((activeOpen.units as Set<number>).has(futureNoFactionUnit.id)).toBeTrue();
        expect((activeIntro.factions as Set<number>).has(MULFACTION_NONE)).toBeTrue();
        expect((activeOpen.factions as Set<number>).has(MULFACTION_NONE)).toBeTrue();
        expect((activeEarly.factions as Set<number>).has(MULFACTION_NONE)).toBeFalse();
        expect(activeNone.eras[introEra.id].has(houseUnit.id)).toBeFalse();
        expect(noneFaction.eras).toEqual({});
        expect(introEra.units).toEqual(new Set<number>());
        expect(unitSearchIndexServiceMock.prepareCatalogIndexes).toHaveBeenCalledWith(
            [noFactionUnit, futureNoFactionUnit, houseUnit],
            activeEras,
            activeFactions,
            undefined,
            equipmentCatalogMock.getEquipmentRegistry(),
        );
        expect(unitSearchIndexServiceMock.commitPreparedCatalogIndexes).toHaveBeenCalledTimes(1);
    });

    it('merges local force entries with lightweight cloud bulk entries', async () => {
        const atlas = createUnit('Atlas');
        unitRuntimeServiceMock.getUnitByName.and.callFake((name: string) => name === 'Atlas' ? atlas : undefined);

        dbServiceMock.getForce.and.callFake(async (instanceId: string) => {
            if (instanceId !== 'force-1') return null;
            return {
                version: 2,
                instanceId: 'force-1',
                timestamp: '2026-04-01T00:00:00Z',
                type: GameSystem.ALPHA_STRIKE,
                name: 'Local Force',
                groups: [{
                    id: 'group-1',
                    units: [{
                        id: 'unit-1',
                        unit: 'Atlas',
                        state: {
                            modified: false,
                            destroyed: false,
                            shutdown: false,
                        },
                    }],
                }],
            };
        });
        wsServiceMock.sendAndWaitForResponse.and.resolveTo({
            data: [
                {
                    instanceId: 'force-1',
                    timestamp: '2026-04-02T00:00:00Z',
                    type: GameSystem.ALPHA_STRIKE,
                    name: 'Cloud Force',
                    owned: false,
                    groups: [{
                        name: 'Lance',
                        formationId: 'formation-1',
                        units: [{ unit: 'Atlas', alias: 'Skull', state: { destroyed: true } }],
                    }],
                },
                {
                    instanceId: 'force-2',
                    timestamp: '2026-04-03T00:00:00Z',
                    type: GameSystem.CLASSIC,
                    name: 'Cloud Only',
                    owned: true,
                    groups: [{
                        name: 'Star',
                        units: [{ unit: 'Atlas', state: { destroyed: false } }],
                    }],
                },
            ],
        });
        spyOn<any>(forcePersistence, 'canUseCloud').and.returnValue(Promise.resolve({} as WebSocket));

        const entries = await forcePersistence.getLoadForceEntriesByIds(['force-1', 'force-2']);

        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledWith({
            action: 'getForcesBulk',
            instanceIds: ['force-1', 'force-2'],
        });
        expect(entries.map((entry) => entry.instanceId)).toEqual(['force-1', 'force-2']);
        expect(entries[0].name).toBe('Cloud Force');
        expect(entries[0].local).toBeTrue();
        expect(entries[0].cloud).toBeTrue();
        expect(entries[0].owned).toBeFalse();
        expect(entries[0].groups[0].formationId).toBe('formation-1');
        expect(entries[0].groups[0].units[0]).toEqual(jasmine.objectContaining({
            unit: atlas,
            alias: 'Skull',
            destroyed: true,
            lockKey: jasmine.any(String),
        }));
        expect(entries[1].name).toBe('Cloud Only');
        expect(entries[1].local).toBeFalse();
        expect(entries[1].cloud).toBeTrue();
        expect(entries[1].groups[0].units[0].unit).toBe(atlas);
    });

    it('caches missing forces locally via full force fetches', async () => {
        dbServiceMock.getForce.and.callFake(async (instanceId: string) => (
            instanceId === 'force-local'
                ? {
                    version: 2,
                    instanceId,
                    timestamp: '2026-04-01T00:00:00Z',
                    type: GameSystem.ALPHA_STRIKE,
                    name: 'Local Only',
                    groups: [],
                }
                : null
        ));
        wsServiceMock.sendAndWaitForResponse.and.callFake(async (payload: { instanceId: string }) => {
            if (payload.instanceId === 'force-missing') {
                return {
                    data: encodeForceForStorage(createSerializedForceForTest({
                        instanceId: 'force-missing',
                        name: 'Fetched Force',
                    })),
                };
            }

            return { data: null };
        });
        spyOn<any>(forcePersistence, 'canUseCloud').and.returnValue(Promise.resolve({} as WebSocket));

        const cached = await forcePersistence.cacheForcesLocally(['force-local', 'force-missing', 'force-unknown', 'force-missing']);

        expect(cached).toBe(1);
        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledWith({
            action: 'getForce',
            uuid: 'user-1',
            instanceId: 'force-missing',
            ownedOnly: false,
        });
        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledWith({
            action: 'getForce',
            uuid: 'user-1',
            instanceId: 'force-unknown',
            ownedOnly: false,
        });
        expect(dbServiceMock.saveForce).toHaveBeenCalledTimes(1);
        expect(dbServiceMock.saveForce).toHaveBeenCalledWith(
            jasmine.objectContaining({ instanceId: 'force-missing' }),
        );
    });

    it('saves an owned cloud-only force locally when opened', async () => {
        const cloudRawForce: SerializedForce = {
            version: 2,
            instanceId: 'force-cloud-owned',
            timestamp: '2026-04-05T00:00:00Z',
            type: GameSystem.CLASSIC,
            name: 'Owned Cloud Force',
            owned: true,
            cbt: createEmptyCBTForceForTest('force-cloud-owned'),
        };
        dbServiceMock.getForce.and.resolveTo(null);
        wsServiceMock.sendAndWaitForResponse.and.resolveTo({ data: encodeForceForStorage(cloudRawForce) });
        spyOn<any>(forcePersistence, 'canUseCloud').and.returnValue(Promise.resolve({} as WebSocket));

        const force = await forcePersistence.getForce('force-cloud-owned', true);

        expect(force?.name).toBe('Owned Cloud Force');
        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledWith({
            action: 'getForce',
            uuid: 'user-1',
            instanceId: 'force-cloud-owned',
            ownedOnly: true,
        });
        expect(dbServiceMock.saveForce).toHaveBeenCalledOnceWith(
            jasmine.objectContaining({
                version: 2,
                instanceId: cloudRawForce.instanceId,
                type: GameSystem.CLASSIC,
                cbt: jasmine.objectContaining({ forceId: cloudRawForce.instanceId }),
            }),
        );
    });

    it('pushes a local-only force before returning it for idempotent activation', async () => {
        const local = createSerializedForceForTest({
            instanceId: 'force-local-only-push',
            name: 'Local Only Push',
        });
        dbServiceMock.getForce.and.resolveTo(local);
        wsServiceMock.sendAndWaitForResponse.and.callFake(async (payload: any) => payload.action === 'getForce'
            ? { data: null }
            : { action: 'forceSaved' });
        spyOn<any>(forcePersistence, 'canUseCloud').and.resolveTo({} as WebSocket);

        const force = await forcePersistence.getForce(local.instanceId);

        expect(force).not.toBeNull();
        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledWith(jasmine.objectContaining({
            action: 'saveForce',
            data: local,
        }));
        expect(forcePersistence.activateForceAuthority(force!)).toBeTrue();
        expect((forcePersistence as any).currentForceAuthorityGeneration(local.instanceId)).toBe(1);
    });

    it('keeps local authority when equal-time copies diverge', async () => {
        const local = createSerializedForceForTest({
            instanceId: 'force-equal-divergence',
            timestamp: '2026-04-05T00:00:00Z',
            name: 'Local Branch',
        });
        const cloud = {
            ...local,
            name: 'Cloud Branch',
        };
        dbServiceMock.getForce.and.resolveTo(local);
        wsServiceMock.sendAndWaitForResponse.and.resolveTo({ data: encodeForceForStorage(cloud) });
        spyOn<any>(forcePersistence, 'canUseCloud').and.resolveTo({} as WebSocket);

        expect((await forcePersistence.getForce(local.instanceId, false))?.name).toBe('Local Branch');
        expect(dbServiceMock.saveForce).not.toHaveBeenCalled();
    });

    it('loads a persisted V1 Classic force through the one-way storage converter', async () => {
        const legacy: SerializedForce = {
            version: 1,
            instanceId: 'force-v1-local',
            timestamp: '2026-04-05T00:00:00Z',
            type: GameSystem.CLASSIC,
            name: 'Legacy Local',
            owned: true,
            groups: [],
        };
        dbServiceMock.getForce.and.resolveTo(legacy);
        spyOn<any>(forcePersistence, 'canUseCloud').and.resolveTo(null);

        const loaded = await forcePersistence.getForce(legacy.instanceId);

        expect(loaded?.name).toBe('Legacy Local');
        expect(loaded?.gameSystem).toBe(GameSystem.CLASSIC);
        expect((await loaded!.serializeForPersistence()).version).toBe(2);
    });

    it('loads a persisted V1 Alpha Strike force with its units intact', async () => {
        const atlas = createUnit('Atlas');
        unitRuntimeServiceMock.resolveUnitReference.and.returnValue({
            kind: 'resolved',
            unit: atlas,
            usedLegacyNameFallback: true,
            sourceChanged: false,
            formatChanged: false,
        });
        const legacy: SerializedForce = {
            version: 1,
            instanceId: 'force-v1-as',
            timestamp: '2026-04-05T00:00:00Z',
            type: GameSystem.ALPHA_STRIKE,
            name: 'Legacy AS',
            groups: [{
                id: 'group-v1-as',
                name: 'Lance',
                units: [{
                    id: 'unit-v1-as',
                    unit: 'Atlas',
                    state: createASStateForTest(),
                }],
            }],
        };
        dbServiceMock.getForce.and.resolveTo(legacy);
        spyOn<any>(forcePersistence, 'canUseCloud').and.resolveTo(null);

        const loaded = await forcePersistence.getForce(legacy.instanceId);

        expect(loggerServiceMock.error.calls.allArgs()).toEqual([]);
        const asForce = loaded instanceof ASForce ? loaded : null;
        expect(asForce?.name).toBe('Legacy AS');
        expect(asForce?.units().length).toBe(1);
        expect(asForce?.units()[0].getSummary().name).toBe('Atlas');
        expect((await loaded!.serializeForPersistence()).version).toBe(2);
    });

    it('loads a current Alpha Strike cloud save without a second storage-parser pass', async () => {
        const atlas = createUnit('Atlas');
        unitRuntimeServiceMock.resolveUnitReference.and.returnValue({
            kind: 'resolved',
            unit: atlas,
            usedLegacyNameFallback: true,
            sourceChanged: false,
            formatChanged: false,
        });
        const current = createSerializedForceForTest({
            instanceId: 'force-current-as',
            name: 'Current AS',
            groups: [{
                id: 'group-current-as',
                name: 'Lance',
                units: [{
                    id: 'unit-current-as',
                    unit: 'Atlas',
                    state: createASStateForTest(),
                }],
            }],
        });
        dbServiceMock.getForce.and.resolveTo(null);
        wsServiceMock.sendAndWaitForResponse.and.resolveTo({ data: encodeForceForStorage(current) });
        spyOn<any>(forcePersistence, 'canUseCloud').and.resolveTo({} as WebSocket);

        const loaded = await forcePersistence.getForce(current.instanceId);

        expect(loggerServiceMock.error.calls.allArgs()).toEqual([]);
        const asForce = loaded instanceof ASForce ? loaded : null;
        expect(asForce?.name).toBe('Current AS');
        expect(asForce?.units().length).toBe(1);
        expect(asForce?.units()[0].getSummary().name).toBe('Atlas');
    });

    it('prefers current storage over V1 when equal-time local and cloud copies compete', async () => {
        const timestamp = '2026-04-05T00:00:00Z';
        const legacy: SerializedForce = {
            version: 1,
            instanceId: 'force-v1-v2-tie',
            timestamp,
            type: GameSystem.CLASSIC,
            name: 'Legacy Local',
            owned: true,
            groups: [],
        };
        const current: SerializedForce = {
            version: 2,
            instanceId: legacy.instanceId,
            timestamp,
            type: GameSystem.CLASSIC,
            name: 'Current Cloud',
            owned: true,
            cbt: createEmptyCBTForceForTest(legacy.instanceId),
        };
        dbServiceMock.getForce.and.resolveTo(legacy);
        wsServiceMock.sendAndWaitForResponse.and.resolveTo({ data: encodeForceForStorage(current) });
        spyOn<any>(forcePersistence, 'canUseCloud').and.resolveTo({} as WebSocket);

        expect((await forcePersistence.getForce(legacy.instanceId))?.name).toBe('Current Cloud');
    });

    it('loads a remote force without touching local storage when requested', async () => {
        wsServiceMock.sendAndWaitForResponse.and.resolveTo({
            data: {
                version: 2,
                instanceId: 'remote-force',
                timestamp: '2026-04-05T00:00:00Z',
                type: GameSystem.ALPHA_STRIKE,
                name: 'Remote Force',
                owned: false,
                groups: [],
            },
        });
        spyOn<any>(forcePersistence, 'canUseCloud').and.returnValue(Promise.resolve({} as WebSocket));

        forcePersistence.isCloudForceLoading.set(false);
        const force = await forcePersistence.getForce('remote-force', false, {
            skipLocal: true,
            showLoading: false,
        });

        expect(force?.name).toBe('Remote Force');
        expect(force?.owned()).toBeFalse();
        expect(dbServiceMock.getForce).not.toHaveBeenCalled();
        expect(dbServiceMock.saveForce).not.toHaveBeenCalled();
        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledWith({
            action: 'getForce',
            instanceId: 'remote-force',
            ownedOnly: false,
        });
        expect(JSON.stringify(wsServiceMock.sendAndWaitForResponse.calls.allArgs())).not.toContain('uuid');
        expect(forcePersistence.isCloudForceLoading()).toBeFalse();
    });

    it('flushes reconnect cloud saves immediately and waits for acknowledgement', async () => {
        const serializedForce: SerializedForce = {
            version: 2,
            instanceId: 'force-1',
            timestamp: '2026-04-05T00:00:00Z',
            type: GameSystem.ALPHA_STRIKE,
            name: 'Reconnect Force',
            groups: [],
        };
        const force = withMockWholeOwnerAuthority({
            name: 'Reconnect Force',
            gameSystem: GameSystem.ALPHA_STRIKE,
            readOnly: () => false,
            instanceId: () => 'force-1',
            serializeForPersistence: () => Promise.resolve(serializedForce),
            getExpectedCloudCBTForceV2Revision: () => undefined,
            markCloudCBTForceV2Saved: () => undefined,
        } as any);
        expect(forcePersistence.activateForceAuthority(force)).toBeTrue();
        spyOn<any>(forcePersistence, 'canUseCloud').and.returnValue(Promise.resolve({} as WebSocket));
        wsServiceMock.sendAndWaitForResponse.and.resolveTo({
            action: 'forceSaved',
            instanceId: 'force-1',
        });

        await forcePersistence.saveForce(force);
        await forcePersistence.saveForceAndWaitForCloud(force);

        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledOnceWith({
            action: 'saveForce',
            uuid: 'user-1',
            data: encodeForceForStorage(serializedForce),
            savedForceCount: 1,
        });
    });

    it('claims an ownerless active authority idempotently and releases only that retired owner', () => {
        let firstActive = true;
        let firstRetired = false;
        const first = {
            instanceId: signal('force-authority-lifecycle'),
            isWholeOwnerActive: () => firstActive,
            isWholeOwnerRetired: () => firstRetired,
        } as any;
        const second = {
            instanceId: signal('force-authority-lifecycle'),
            isWholeOwnerActive: () => true,
            isWholeOwnerRetired: () => false,
        } as any;

        expect(forcePersistence.activateForceAuthority(first)).toBeTrue();
        expect(forcePersistence.activateForceAuthority(first)).toBeTrue();
        expect(forcePersistence.activateForceAuthority(second)).toBeFalse();
        expect(forcePersistence.deactivateForceAuthority(first)).toBeFalse();
        expect((forcePersistence as any).activeForceAuthority.get('force-authority-lifecycle')).toBe(first);

        firstActive = false;
        firstRetired = true;
        expect(forcePersistence.deactivateForceAuthority(first)).toBeTrue();
        expect(forcePersistence.activateForceAuthority(second)).toBeTrue();
        expect((forcePersistence as any).activeForceAuthority.get('force-authority-lifecycle')).toBe(second);
    });

    it('keeps a provisionally activated owner object-keyed after its ID is minted until proven save promotion', async () => {
        const instanceId = signal<string | null>(null);
        const serialized = createSerializedForceForTest({ instanceId: 'force-provisional-promotion' });
        const proof = Object.freeze({});
        const force = withMockWholeOwnerAuthority({
            name: serialized.name,
            gameSystem: GameSystem.ALPHA_STRIKE,
            readOnly: () => false,
            instanceId,
            groups: () => [],
            units: () => [],
            serializeForPersistence: () => Promise.resolve(serialized),
            serializeForPersistenceWithAuthorityFence: jasmine.createSpy('serializePaired').and.callFake(async () => {
                instanceId.set(serialized.instanceId);
                return {
                    serialized,
                    authorityFingerprint: force.captureWholeOwnerAuthorityFingerprint(),
                    revisionFence: force.captureForceOwnerRevisionFence(),
                    identityPromotionProof: proof,
                };
            }),
            isPersistenceIdentityPromotion: (candidate: object) => candidate === proof,
            getExpectedCloudCBTForceV2Revision: () => undefined,
        } as any);
        expect(forcePersistence.activateForceAuthority(force)).toBeTrue();
        instanceId.set(serialized.instanceId);
        expect(forcePersistence.activateForceAuthority(force)).toBeFalse();

        await forcePersistence.saveForce(force, true);

        expect(dbServiceMock.saveForce).toHaveBeenCalledOnceWith(serialized);
        expect(forcePersistence.activateForceAuthority(force)).toBeTrue();
        expect(forcePersistence.hasDurableForceIdentity(force)).toBeTrue();
    });

    it('drains and prepares removal of a provisional owner whose Force-minted ID is not promoted', async () => {
        const instanceId = signal<string | null>(null);
        let retired = false;
        const force = withMockWholeOwnerAuthority({
            name: 'Discarded Provisional',
            instanceId,
            groups: () => [],
            units: () => [],
            isWholeOwnerActive: () => !retired,
            isWholeOwnerRetired: () => retired,
            consumeWholeOwnerReplacementCommitAuthority: jasmine.createSpy('consumeRemoval').and.returnValue(true),
        } as any);
        expect(forcePersistence.activateForceAuthority(force)).toBeTrue();
        instanceId.set('force-provisional-discard');
        const fingerprint = force.captureWholeOwnerAuthorityFingerprint();

        expect(await forcePersistence.drainForceAuthorityPersistence(force, fingerprint)).toBeTrue();
        const finalize = forcePersistence.prepareForceAuthorityRemoval(force, Object.freeze({}) as any);
        expect(finalize).not.toBeNull();
        retired = true;
        finalize!();

        expect((forcePersistence as any).provisionalForceAuthority.has(force)).toBeFalse();
        expect((forcePersistence as any).activeForceAuthority.has('force-provisional-discard')).toBeFalse();
    });

    it('retains a rejected local persistence outcome so a later retirement drain fails closed', async () => {
        const serialized = createSerializedForceForTest({
            instanceId: 'force-local-rejection',
            name: 'Rejected Local Save',
        });
        const force = withMockWholeOwnerAuthority({
            name: serialized.name,
            gameSystem: GameSystem.ALPHA_STRIKE,
            readOnly: () => false,
            instanceId: signal(serialized.instanceId),
            groups: () => [],
            units: () => [],
            serializeForPersistence: () => Promise.resolve(serialized),
            getExpectedCloudCBTForceV2Revision: () => undefined,
            markCloudCBTForceV2Saved: () => undefined,
        } as any);
        expect(forcePersistence.activateForceAuthority(force)).toBeTrue();
        const fingerprint = force.captureWholeOwnerAuthorityFingerprint();
        dbServiceMock.saveForce.and.rejectWith(new Error('IDB rejected the write'));

        await expectAsync(forcePersistence.saveForce(force, true)).toBeRejectedWithError('IDB rejected the write');

        expect(await forcePersistence.drainForceAuthorityPersistence(force, fingerprint)).toBeFalse();
    });

    it('rejects a local dispatch when the exact owner fingerprint changes in its queue', async () => {
        const serialized = createSerializedForceForTest({
            instanceId: 'force-local-fingerprint',
            name: 'Captured Name',
        });
        const force = withMockWholeOwnerAuthority({
            name: serialized.name,
            gameSystem: GameSystem.ALPHA_STRIKE,
            readOnly: () => false,
            instanceId: signal(serialized.instanceId),
            groups: () => [],
            units: () => [],
            serializeForPersistence: () => Promise.resolve(serialized),
            getExpectedCloudCBTForceV2Revision: () => undefined,
            markCloudCBTForceV2Saved: () => undefined,
        } as any);
        expect(forcePersistence.activateForceAuthority(force)).toBeTrue();
        const predecessor = deferred<void>();
        (forcePersistence as any).forceLocalSaveChain.set(serialized.instanceId, predecessor.promise);

        const save = forcePersistence.saveForce(force, true);
        for (let index = 0; index < 12
            && (forcePersistence as any).forceLocalSaveChain.get(serialized.instanceId) === predecessor.promise;
            index += 1) {
            await Promise.resolve();
        }
        expect((forcePersistence as any).forceLocalSaveChain.get(serialized.instanceId)).not.toBe(predecessor.promise);
        force.name = 'Changed Outside Save';
        predecessor.resolve();
        await save;

        expect(dbServiceMock.saveForce).not.toHaveBeenCalled();
    });

    it('rechecks the exact owner fingerprint after cloud preparation before transmitting', async () => {
        const serialized = createSerializedForceForTest({
            instanceId: 'force-cloud-fingerprint',
            name: 'Captured Cloud Name',
        });
        const force = withMockWholeOwnerAuthority({
            name: serialized.name,
            gameSystem: GameSystem.ALPHA_STRIKE,
            readOnly: () => false,
            instanceId: signal(serialized.instanceId),
            groups: () => [],
            units: () => [],
            serializeForPersistence: () => Promise.resolve(serialized),
            getExpectedCloudCBTForceV2Revision: () => undefined,
            markCloudCBTForceV2Saved: jasmine.createSpy('markFingerprintCloudSaved'),
        } as any);
        expect(forcePersistence.activateForceAuthority(force)).toBeTrue();
        const cloudReady = deferred<WebSocket>();
        spyOn<any>(forcePersistence, 'canUseCloud').and.returnValue(cloudReady.promise);

        const save = forcePersistence.saveForceAndWaitForCloud(force);
        for (let index = 0; index < 12 && !(forcePersistence as any).forceCloudSaveChain.size; index += 1) {
            await Promise.resolve();
        }
        force.name = 'Changed While Cloud Prepared';
        cloudReady.resolve({} as WebSocket);

        expect(await save).toBeFalse();
        expect(wsServiceMock.sendAndWaitForResponse).not.toHaveBeenCalled();
        expect(force.markCloudCBTForceV2Saved).not.toHaveBeenCalled();
    });

    it('sends the prepared V2 payload with the observed cloud revision instead of reserializing', async () => {
        const serializedForce: SerializedForce = {
            version: 2,
            instanceId: 'force-v2',
            timestamp: '2026-04-05T00:00:00Z',
            type: GameSystem.CLASSIC,
            name: 'Protected Force',
            cbt: createEmptyCBTForceForTest('force-v2'),
        };
        const force = withMockWholeOwnerAuthority({
            name: 'Protected Force',
            gameSystem: GameSystem.CLASSIC,
            readOnly: () => false,
            instanceId: () => 'force-v2',
            serializeForPersistence: jasmine.createSpy('serializeForPersistence').and.resolveTo(serializedForce),
            getExpectedCloudCBTForceV2Revision: () => 17,
            markCloudCBTForceV2Saved: jasmine.createSpy('markCloudCBTForceV2Saved'),
        } as any);
        expect(forcePersistence.activateForceAuthority(force)).toBeTrue();
        spyOn<any>(forcePersistence, 'canUseCloud').and.returnValue(Promise.resolve({} as WebSocket));
        wsServiceMock.sendAndWaitForResponse.and.resolveTo({ action: 'forceSaved', instanceId: 'force-v2' });

        await forcePersistence.saveForceAndWaitForCloud(force);

        expect(force.serializeForPersistence).toHaveBeenCalledTimes(1);
        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledWith({
            action: 'saveForce',
            uuid: 'user-1',
            data: encodeForceForStorage(serializedForce),
            cbtPersistence: {
                writerVersion: 2,
                expectedIntegrityDigest: 'revision:17',
            },
            savedForceCount: 1,
        });
        expect(force.markCloudCBTForceV2Saved).toHaveBeenCalledOnceWith(serializedForce);
    });

    it('flushes and awaits an admitted AS cloud save before reporting owner persistence drained', async () => {
        const serialized = createSerializedForceForTest({
            instanceId: 'force-as-retirement-drain',
            name: 'AS Retirement Drain',
        });
        const force = withMockWholeOwnerAuthority({
            name: serialized.name,
            gameSystem: GameSystem.ALPHA_STRIKE,
            readOnly: () => false,
            instanceId: signal(serialized.instanceId),
            groups: () => [],
            units: () => [],
            serializeForPersistence: jasmine.createSpy('serializeForPersistence').and.resolveTo(serialized),
            getExpectedCloudCBTForceV2Revision: () => undefined,
            markCloudCBTForceV2Saved: jasmine.createSpy('markCloudCBTForceV2Saved'),
        } as any);
        forcePersistence.activateForceAuthority(force);
        const fingerprint = force.captureWholeOwnerAuthorityFingerprint();
        const response = deferred<any>();
        spyOn<any>(forcePersistence, 'canUseCloud').and.resolveTo({} as WebSocket);
        wsServiceMock.sendAndWaitForResponse.and.returnValue(response.promise);

        await forcePersistence.saveForce(force);
        let drained = false;
        const drain = forcePersistence.drainForceAuthorityPersistence(force, fingerprint)
            .then(result => {
                drained = true;
                return result;
            });
        for (let index = 0; index < 16 && wsServiceMock.sendAndWaitForResponse.calls.count() === 0; index += 1) {
            await Promise.resolve();
        }

        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledTimes(1);
        expect(drained).toBeFalse();

        response.resolve({ action: 'forceSaved', instanceId: serialized.instanceId });
        expect(await drain).toBeTrue();
        expect(force.markCloudCBTForceV2Saved).toHaveBeenCalledOnceWith(serialized);
    });

    it('chains overlapping cloud saves so the second CAS uses the first acknowledged revision', async () => {
        const originalRevision = 4;
        const firstRevision = 5;
        const secondRevision = 6;
        const persisted = (timestamp: string, forceRevision: number) => ({
            version: 2,
            instanceId: 'force-chain',
            timestamp,
            type: GameSystem.CLASSIC,
            name: 'Chained Force',
            cbt: createEmptyCBTForceForTest('force-chain', forceRevision),
        });
        const first = persisted('2026-04-05T00:00:00Z', firstRevision);
        const second = persisted('2026-04-05T00:00:01Z', secondRevision);
        let expectedRevision: number | null | undefined = originalRevision;
        const force = withMockWholeOwnerAuthority({
            name: 'Chained Force',
            gameSystem: GameSystem.CLASSIC,
            readOnly: () => false,
            instanceId: () => 'force-chain',
            serializeForPersistence: jasmine.createSpy('serializeForPersistence').and.returnValues(
                Promise.resolve(first),
                Promise.resolve(second),
            ),
            getExpectedCloudCBTForceV2Revision: () => expectedRevision,
            markCloudCBTForceV2Saved: (saved: SerializedForce) => {
                expectedRevision = saved.cbt!.forceRevision;
            },
        } as any);
        expect(forcePersistence.activateForceAuthority(force)).toBeTrue();
        let acknowledgeFirst!: (value: unknown) => void;
        let requestCount = 0;
        spyOn<any>(forcePersistence, 'canUseCloud').and.returnValue(Promise.resolve({} as WebSocket));
        wsServiceMock.sendAndWaitForResponse.and.callFake(() => {
            requestCount += 1;
            return requestCount === 1
                ? new Promise(resolve => { acknowledgeFirst = resolve; })
                : Promise.resolve({ action: 'forceSaved', instanceId: 'force-chain' });
        });

        const firstSave = forcePersistence.saveForceAndWaitForCloud(force);
        const secondSave = forcePersistence.saveForceAndWaitForCloud(force);
        for (let index = 0;
            index < 12 && wsServiceMock.sendAndWaitForResponse.calls.count() === 0;
            index += 1) {
            await Promise.resolve();
        }
        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledTimes(1);

        acknowledgeFirst({ action: 'forceSaved', instanceId: 'force-chain' });
        await Promise.all([firstSave, secondSave]);

        const secondRequest = wsServiceMock.sendAndWaitForResponse.calls.argsFor(1)[0];
        expect(secondRequest.cbtPersistence.expectedIntegrityDigest).toBe(`revision:${firstRevision}`);
        expect(expectedRevision).toBe(secondRevision);
    });

    it('stages detached transport bytes and consumes the token synchronously on acceptance', async () => {
        const incoming: SerializedForce = {
            version: 2,
            instanceId: 'force-staged',
            timestamp: '2026-04-05T00:00:00Z',
            type: GameSystem.ALPHA_STRIKE,
            name: 'Trusted Remote Name',
            groups: [],
        };
        const stagedForce = withMockWholeOwnerAuthority({
            instanceId: signal('force-staged'),
            groups: () => [],
            units: () => [],
            markCloudCBTForceV2Saved: jasmine.createSpy('markCloudCBTForceV2Saved'),
        } as any, incoming);
        let deserializedBytes: SerializedForce | undefined;
        spyOn<any>(forcePersistence, 'deserializeCurrentForce').and.callFake(async (raw: SerializedForce) => {
            deserializedBytes = raw;
            return stagedForce;
        });

        const staged = await forcePersistence.stageRemoteForceSnapshot(incoming);
        incoming.name = 'Mutated After Stage';
        const persistence = acceptStagedRemoteForce(staged);

        expect(() => acceptStagedRemoteForce(staged)).toThrowError(/already consumed/u);
        await persistence;
        expect(deserializedBytes).not.toBe(incoming);
        expect(dbServiceMock.saveForce).toHaveBeenCalledOnceWith(
            jasmine.objectContaining({
                name: 'Trusted Remote Name',
            }),
        );
        expect(stagedForce.markCloudCBTForceV2Saved).toHaveBeenCalledWith(
            jasmine.objectContaining({ name: 'Trusted Remote Name' }),
        );
    });

    it('invalidates discarded and identity-mutated tokens before persistence', async () => {
        const incoming: SerializedForce = {
            version: 2,
            instanceId: 'force-discard',
            timestamp: '2026-04-05T00:00:00Z',
            type: GameSystem.ALPHA_STRIKE,
            name: 'Discarded Remote',
            groups: [],
        };
        const discardedForce = withMockWholeOwnerAuthority({
            instanceId: signal('force-discard'),
            groups: () => [],
            units: () => [],
            serialize: () => structuredClone(incoming),
        } as any);
        const identityForce = withMockWholeOwnerAuthority({
            instanceId: signal('force-discard'),
            groups: () => [],
            units: () => [],
            serialize: () => structuredClone(incoming),
        } as any);
        spyOn<any>(forcePersistence, 'deserializeCurrentForce').and.returnValues(
            Promise.resolve(discardedForce),
            Promise.resolve(identityForce),
        );

        const discarded = await forcePersistence.stageRemoteForceSnapshot(incoming);
        forcePersistence.discardRemoteForceSnapshot(discarded);
        expect(() => acceptStagedRemoteForce(discarded)).toThrowError(/already consumed/u);

        const identityChanged = await forcePersistence.stageRemoteForceSnapshot(incoming);
        identityForce.instanceId.set('different-force');
        expect(() => acceptStagedRemoteForce(identityChanged)).toThrowError(/authority changed/u);
        expect(dbServiceMock.saveForce).not.toHaveBeenCalled();
    });

    it('keeps prepared Data authority reversible until the predecessor is retired', async () => {
        const incoming = createSerializedForceForTest({ instanceId: 'force-two-phase-data' });
        const stagedForce = withMockWholeOwnerAuthority({
            instanceId: signal(incoming.instanceId),
            groups: () => [],
            units: () => [],
        } as any, incoming);
        spyOn<any>(forcePersistence, 'deserializeCurrentForce').and.resolveTo(stagedForce);
        let retired = false;
        const predecessor = {
            instanceId: signal(incoming.instanceId),
            isWholeOwnerActive: () => true,
            consumeWholeOwnerReplacementCommitAuthority: () => true,
            isWholeOwnerRetired: () => retired,
        } as any;
        forcePersistence.activateForceAuthority(predecessor);
        const staged = await forcePersistence.stageRemoteForceSnapshot(incoming);
        const prepared = forcePersistence.prepareRemoteForceSnapshotAcceptance(staged);
        const plan = forcePersistence.commitPreparedRemoteForceReplacement(
            prepared,
            predecessor,
            Object.freeze({}) as any,
        );
        if (!plan.accepted) {
            fail(`Unexpected preparation rejection: ${plan.reason}`);
            return;
        }

        plan.finalize();
        expect((forcePersistence as any).activeForceAuthority.get(incoming.instanceId)).toBe(predecessor);
        expect(dbServiceMock.saveForce).not.toHaveBeenCalled();

        retired = true;
        plan.finalize();
        expect((forcePersistence as any).activeForceAuthority.get(incoming.instanceId)).toBe(stagedForce);
        await plan.persistence();
        expect(dbServiceMock.saveForce).toHaveBeenCalledOnceWith(incoming);
    });

    it('keeps a finalized remote replacement in the retirement drain until its local write settles', async () => {
        const incoming = createSerializedForceForTest({ instanceId: 'force-replacement-write-drain' });
        const stagedForce = withMockWholeOwnerAuthority({
            instanceId: signal(incoming.instanceId),
            groups: () => [],
            units: () => [],
        } as any, incoming);
        spyOn<any>(forcePersistence, 'deserializeCurrentForce').and.resolveTo(stagedForce);
        const localWrite = deferred<void>();
        dbServiceMock.saveForce.and.returnValue(localWrite.promise);
        let retired = false;
        const predecessor = {
            instanceId: signal(incoming.instanceId),
            isWholeOwnerActive: () => !retired,
            consumeWholeOwnerReplacementCommitAuthority: () => true,
            isWholeOwnerRetired: () => retired,
        } as any;
        expect(forcePersistence.activateForceAuthority(predecessor)).toBeTrue();
        const staged = await forcePersistence.stageRemoteForceSnapshot(incoming);
        const prepared = forcePersistence.prepareRemoteForceSnapshotAcceptance(staged);
        const plan = forcePersistence.commitPreparedRemoteForceReplacement(
            prepared,
            predecessor,
            Object.freeze({}) as any,
        );
        if (!plan.accepted) {
            fail(`Unexpected preparation rejection: ${plan.reason}`);
            return;
        }

        retired = true;
        plan.finalize();
        const fingerprint = stagedForce.captureWholeOwnerAuthorityFingerprint();
        let drainSettled = false;
        const drain = forcePersistence.drainForceAuthorityPersistence(stagedForce, fingerprint)
            .then(result => {
                drainSettled = true;
                return result;
            });
        await Promise.resolve();
        await Promise.resolve();

        expect(dbServiceMock.saveForce).toHaveBeenCalledOnceWith(incoming);
        expect(drainSettled).toBeFalse();

        localWrite.resolve();
        await expectAsync(plan.persistence()).toBeResolved();
        await expectAsync(drain).toBeResolvedTo(true);
        expect(forcePersistence.hasDurableForceIdentity(stagedForce)).toBeTrue();
    });

    it('does not let a prepared candidate replace Data authority without retirement proof', async () => {
        const incoming = createSerializedForceForTest({ instanceId: 'force-proof-required' });
        const stagedForce = withMockWholeOwnerAuthority({
            instanceId: signal(incoming.instanceId),
            groups: () => [],
            units: () => [],
        } as any, incoming);
        spyOn<any>(forcePersistence, 'deserializeCurrentForce').and.resolveTo(stagedForce);
        const predecessor = {
            instanceId: signal(incoming.instanceId),
            isWholeOwnerActive: () => true,
            consumeWholeOwnerReplacementCommitAuthority: jasmine.createSpy('consumeAuthority').and.returnValue(false),
        } as any;
        forcePersistence.activateForceAuthority(predecessor);
        const staged = await forcePersistence.stageRemoteForceSnapshot(incoming);
        const prepared = forcePersistence.prepareRemoteForceSnapshotAcceptance(staged);
        const result = forcePersistence.commitPreparedRemoteForceReplacement(
            prepared,
            predecessor,
            Object.freeze({}) as any,
        );

        expect(result).toEqual({ accepted: false, reason: 'PREDECESSOR_NOT_RETIRED' });
        expect(predecessor.consumeWholeOwnerReplacementCommitAuthority).toHaveBeenCalledTimes(1);
        expect(dbServiceMock.saveForce).not.toHaveBeenCalled();
        forcePersistence.discardPreparedRemoteForceAcceptance(prepared);
    });

    it('fences delayed pre-remote serialization and keeps remote bytes until a post-remote edit', async () => {
        const oldBytes: SerializedForce = {
            version: 2,
            instanceId: 'force-generation',
            timestamp: '2026-04-05T00:00:00Z',
            type: GameSystem.ALPHA_STRIKE,
            name: 'Old Local',
            groups: [],
        };
        const remoteBytes: SerializedForce = {
            ...oldBytes,
            timestamp: '2026-04-05T00:00:01Z',
            name: 'Remote Authority',
        };
        const postRemoteBytes: SerializedForce = {
            ...oldBytes,
            timestamp: '2026-04-05T00:00:02Z',
            name: 'Genuine Post-Remote Edit',
        };
        const oldPreparation = deferred<SerializedForce>();
        const liveForce = withMockWholeOwnerAuthority({
            name: 'Live Force',
            gameSystem: GameSystem.ALPHA_STRIKE,
            readOnly: () => false,
            instanceId: signal('force-generation'),
            serializeForPersistence: jasmine.createSpy('serializeForPersistence').and.returnValue(oldPreparation.promise),
            getExpectedCloudCBTForceV2Revision: () => undefined,
        } as any);
        const remoteForce = withMockWholeOwnerAuthority({
            name: 'Remote Authority',
            gameSystem: GameSystem.ALPHA_STRIKE,
            readOnly: () => false,
            instanceId: signal('force-generation'),
            groups: () => [],
            units: () => [],
            serializeForPersistence: jasmine.createSpy('serializeReplacement').and.resolveTo(postRemoteBytes),
            getExpectedCloudCBTForceV2Revision: () => undefined,
            markCloudCBTForceV2Saved: jasmine.createSpy('markRemoteSaved'),
        } as any, remoteBytes);
        spyOn<any>(forcePersistence, 'deserializeCurrentForce').and.resolveTo(remoteForce);
        expect(forcePersistence.activateForceAuthority(liveForce)).toBeTrue();

        const oldSave = forcePersistence.saveForce(liveForce, true);
        expect(forcePersistence.hasPendingForceSaves()).toBeTrue();
        const staged = await forcePersistence.stageRemoteForceSnapshot(remoteBytes);
        await acceptStagedRemoteForce(staged);
        // ForceBuilder tears down the old slot after registering the staged
        // replacement; that must not unregister the new active object.
        expect(forcePersistence.deactivateForceAuthority(liveForce)).toBeFalse();
        oldPreparation.resolve(oldBytes);
        await oldSave;

        expect(dbServiceMock.saveForce).toHaveBeenCalledTimes(1);
        expect(dbServiceMock.saveForce).toHaveBeenCalledWith(remoteBytes);

        await forcePersistence.saveForce(liveForce, true);
        expect(liveForce.serializeForPersistence).toHaveBeenCalledTimes(1);
        await forcePersistence.saveForce(remoteForce, true);
        expect(dbServiceMock.saveForce.calls.allArgs().map(args => args[0])).toEqual([
            remoteBytes,
            postRemoteBytes,
        ]);
        expect(forcePersistence.hasPendingForceSaves()).toBeFalse();
    });

    it('orders an already-enqueued local write before remote authority so remote is the final IDB value', async () => {
        const localBytes: SerializedForce = {
            version: 2,
            instanceId: 'force-local-order',
            timestamp: '2026-04-05T00:00:00Z',
            type: GameSystem.ALPHA_STRIKE,
            name: 'Queued Local',
            groups: [],
        };
        const remoteBytes: SerializedForce = {
            ...localBytes,
            timestamp: '2026-04-05T00:00:01Z',
            name: 'Remote Last',
        };
        const firstDbWrite = deferred<void>();
        dbServiceMock.saveForce.and.callFake((raw: SerializedForce) => raw === localBytes
            ? firstDbWrite.promise
            : Promise.resolve());
        const liveForce = withMockWholeOwnerAuthority({
            name: 'Queued Local',
            gameSystem: GameSystem.ALPHA_STRIKE,
            readOnly: () => false,
            instanceId: signal('force-local-order'),
            serializeForPersistence: () => Promise.resolve(localBytes),
            getExpectedCloudCBTForceV2Revision: () => undefined,
        } as any);
        const remoteForce = withMockWholeOwnerAuthority({
            instanceId: signal('force-local-order'),
            groups: () => [],
            units: () => [],
            markCloudCBTForceV2Saved: jasmine.createSpy('markRemoteSaved'),
        } as any, remoteBytes);
        spyOn<any>(forcePersistence, 'deserializeCurrentForce').and.resolveTo(remoteForce);
        expect(forcePersistence.activateForceAuthority(liveForce)).toBeTrue();

        const localSave = forcePersistence.saveForce(liveForce, true);
        for (let index = 0; index < 12 && dbServiceMock.saveForce.calls.count() === 0; index += 1) {
            await Promise.resolve();
        }
        expect(dbServiceMock.saveForce).toHaveBeenCalledTimes(1);
        const staged = await forcePersistence.stageRemoteForceSnapshot(remoteBytes);
        const remoteSave = acceptStagedRemoteForce(staged);
        await Promise.resolve();
        expect(dbServiceMock.saveForce).toHaveBeenCalledTimes(1);

        firstDbWrite.resolve();
        await Promise.all([localSave, remoteSave]);
        expect(dbServiceMock.saveForce.calls.allArgs().map(args => args[0])).toEqual([
            localBytes,
            remoteBytes,
        ]);
    });

    it('tracks serialization and IndexedDB work synchronously for unload protection', async () => {
        const serialized: SerializedForce = {
            version: 2,
            instanceId: 'force-unload',
            timestamp: '2026-04-05T00:00:00Z',
            type: GameSystem.ALPHA_STRIKE,
            name: 'Pending Unload',
            groups: [],
        };
        const preparation = deferred<SerializedForce>();
        const dbWrite = deferred<void>();
        dbServiceMock.saveForce.and.returnValue(dbWrite.promise);
        const force = withMockWholeOwnerAuthority({
            name: 'Pending Unload',
            gameSystem: GameSystem.ALPHA_STRIKE,
            readOnly: () => false,
            instanceId: signal('force-unload'),
            serializeForPersistence: () => preparation.promise,
            getExpectedCloudCBTForceV2Revision: () => undefined,
        } as any);
        expect(forcePersistence.activateForceAuthority(force)).toBeTrue();

        const save = forcePersistence.saveForce(force, true);
        expect(forcePersistence.hasPendingForceSaves()).toBeTrue();
        preparation.resolve(serialized);
        for (let index = 0; index < 12 && dbServiceMock.saveForce.calls.count() === 0; index += 1) {
            await Promise.resolve();
        }
        expect(forcePersistence.hasPendingForceSaves()).toBeTrue();
        dbWrite.resolve();
        await save;
        expect(forcePersistence.hasPendingForceSaves()).toBeFalse();
    });

    it('defers and coalesces UI autosaves so the originating interaction can paint', async () => {
        const force = {
            name: 'Deferred Autosave',
            instanceId: () => 'force-deferred-autosave',
            isWholeOwnerActive: () => true,
        } as unknown as import('../models/force.model').Force;
        const save = spyOn(forcePersistence, 'saveForce').and.resolveTo();

        forcePersistence.queueForceAutosave(force);
        forcePersistence.queueForceAutosave(force);

        expect(save).not.toHaveBeenCalled();
        expect(forcePersistence.hasPendingForceSaves()).toBeTrue();

        await new Promise<void>(resolve => setTimeout(resolve, 0));
        for (let index = 0; index < 8 && save.calls.count() === 0; index += 1) {
            await Promise.resolve();
        }

        expect(save).toHaveBeenCalledOnceWith(force);
        await Promise.resolve();
        expect(forcePersistence.hasPendingForceSaves()).toBeFalse();
    });

    it('drops a deferred autosave after its force authority retires', async () => {
        const force = {
            name: 'Retired Autosave',
            instanceId: () => 'force-retired-autosave',
            isWholeOwnerActive: () => false,
        } as unknown as import('../models/force.model').Force;
        const save = spyOn(forcePersistence, 'saveForce').and.resolveTo();

        forcePersistence.queueForceAutosave(force);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        await Promise.resolve();

        expect(save).not.toHaveBeenCalled();
        expect(forcePersistence.hasPendingForceSaves()).toBeFalse();
    });

    it('detaches an in-flight old cloud generation and never sends its already-queued successor', async () => {
        const persisted = (timestamp: string, name: string): SerializedForce => ({
            version: 2,
            instanceId: 'force-cloud-generation',
            timestamp,
            type: GameSystem.ALPHA_STRIKE,
            name,
            groups: [],
        });
        const first = persisted('2026-04-05T00:00:00Z', 'First Local');
        const second = persisted('2026-04-05T00:00:01Z', 'Queued Successor');
        const remote = persisted('2026-04-05T00:00:02Z', 'Remote Authority');
        const force = withMockWholeOwnerAuthority({
            name: 'Old Live Force',
            gameSystem: GameSystem.ALPHA_STRIKE,
            readOnly: () => false,
            instanceId: signal('force-cloud-generation'),
            serializeForPersistence: jasmine.createSpy('serializeForPersistence').and.returnValues(
                Promise.resolve(first),
                Promise.resolve(second),
            ),
            getExpectedCloudCBTForceV2Revision: () => undefined,
            markCloudCBTForceV2Saved: jasmine.createSpy('markOldGenerationSaved'),
        } as any);
        expect(forcePersistence.activateForceAuthority(force)).toBeTrue();
        const response = deferred<any>();
        spyOn<any>(forcePersistence, 'canUseCloud').and.resolveTo({} as WebSocket);
        wsServiceMock.sendAndWaitForResponse.and.returnValue(response.promise);
        const adoption = jasmine.createSpy('adoption');
        forcePersistence.forceNeedsAdoption.subscribe(adoption);

        const firstSave = forcePersistence.saveForceAndWaitForCloud(force);
        for (let index = 0; index < 16 && wsServiceMock.sendAndWaitForResponse.calls.count() === 0; index += 1) {
            await Promise.resolve();
        }
        const firstChain = (forcePersistence as any).forceCloudSaveChain.get('force-cloud-generation');
        const secondSave = forcePersistence.saveForceAndWaitForCloud(force);
        for (let index = 0; index < 16
            && (forcePersistence as any).forceCloudSaveChain.get('force-cloud-generation') === firstChain;
            index += 1) {
            await Promise.resolve();
        }
        expect((forcePersistence as any).forceCloudSaveChain.get('force-cloud-generation')).not.toBe(firstChain);

        const remoteForce = withMockWholeOwnerAuthority({
            instanceId: signal('force-cloud-generation'),
            groups: () => [],
            units: () => [],
            markCloudCBTForceV2Saved: jasmine.createSpy('markRemoteSaved'),
        } as any, remote);
        spyOn<any>(forcePersistence, 'deserializeCurrentForce').and.resolveTo(remoteForce);
        const staged = await forcePersistence.stageRemoteForceSnapshot(remote);
        await acceptStagedRemoteForce(staged);
        expect(forcePersistence.hasPendingForceSaves()).toBeFalse();

        response.resolve({ code: 'not_owner', action: 'error' });
        await Promise.all([firstSave, secondSave]);
        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledTimes(1);
        expect(adoption).not.toHaveBeenCalled();
        expect(force.markCloudCBTForceV2Saved).not.toHaveBeenCalled();
    });

    it('rechecks generation after awaited cloud preparation and does not transmit stale bytes', async () => {
        const local: SerializedForce = {
            version: 2,
            instanceId: 'force-cloud-await',
            timestamp: '2026-04-05T00:00:00Z',
            type: GameSystem.ALPHA_STRIKE,
            name: 'Stale During canUseCloud',
            groups: [],
        };
        const remote: SerializedForce = {
            ...local,
            timestamp: '2026-04-05T00:00:01Z',
            name: 'Remote During canUseCloud',
        };
        const cloudReady = deferred<WebSocket>();
        spyOn<any>(forcePersistence, 'canUseCloud').and.returnValue(cloudReady.promise);
        const liveForce = withMockWholeOwnerAuthority({
            name: 'Stale During canUseCloud',
            gameSystem: GameSystem.ALPHA_STRIKE,
            readOnly: () => false,
            instanceId: signal('force-cloud-await'),
            serializeForPersistence: () => Promise.resolve(local),
            getExpectedCloudCBTForceV2Revision: () => undefined,
            markCloudCBTForceV2Saved: jasmine.createSpy('markStaleSaved'),
        } as any);
        const pendingSave = forcePersistence.saveForceAndWaitForCloud(liveForce);
        for (let index = 0; index < 12 && !(forcePersistence as any).forceCloudSaveChain.size; index += 1) {
            await Promise.resolve();
        }
        const remoteForce = withMockWholeOwnerAuthority({
            instanceId: signal('force-cloud-await'),
            groups: () => [],
            units: () => [],
            markCloudCBTForceV2Saved: jasmine.createSpy('markRemoteSaved'),
        } as any, remote);
        spyOn<any>(forcePersistence, 'deserializeCurrentForce').and.resolveTo(remoteForce);
        const staged = await forcePersistence.stageRemoteForceSnapshot(remote);
        await acceptStagedRemoteForce(staged);
        cloudReady.resolve({} as WebSocket);
        await pendingSave;

        expect(wsServiceMock.sendAndWaitForResponse).not.toHaveBeenCalled();
        expect(liveForce.markCloudCBTForceV2Saved).not.toHaveBeenCalled();
    });

    it('rebases a genuine post-remote cloud save on the accepted remote digest', async () => {
        const remoteRevision = 9;
        const postRevision = 10;
        const remote: SerializedForce = {
            version: 2,
            instanceId: 'force-rebase',
            timestamp: '2026-04-05T00:00:01Z',
            type: GameSystem.CLASSIC,
            name: 'Remote Base',
            cbt: createEmptyCBTForceForTest('force-rebase', remoteRevision),
        };
        const post: SerializedForce = {
            ...remote,
            timestamp: '2026-04-05T00:00:02Z',
            name: 'Post-Remote Edit',
            cbt: createEmptyCBTForceForTest('force-rebase', postRevision),
        };
        spyOn<any>(forcePersistence, 'canUseCloud').and.resolveTo({} as WebSocket);
        wsServiceMock.sendAndWaitForResponse.and.resolveTo({ action: 'forceSaved' });

        const staged = await forcePersistence.stageRemoteForceSnapshot(remote);
        const replacement = staged.force;
        const identityPromotionProof = (await replacement.serializeForPersistenceWithRevisionFence())
            .identityPromotionProof;
        spyOn(replacement, 'serializeForPersistenceWithRevisionFence').and.callFake(async () => ({
            serialized: post,
            revisionFence: replacement.captureForceOwnerRevisionFence(),
            identityPromotionProof,
        }));
        await acceptStagedRemoteForce(staged);
        await forcePersistence.saveForceAndWaitForCloud(replacement);

        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledOnceWith(jasmine.objectContaining({
            data: encodeForceForStorage(post),
            cbtPersistence: {
                writerVersion: 2,
                expectedIntegrityDigest: `revision:${remoteRevision}`,
            },
        }));
        expect(replacement.getExpectedCloudCBTForceV2Revision()).toBe(postRevision);
    });

    it('persists a valid V2 envelope but rejects a malformed one', async () => {
        const base = {
            version: 2,
            instanceId: 'force-wire',
            timestamp: '2026-04-05T00:00:00Z',
            type: GameSystem.CLASSIC,
            name: 'Wire Force',
        } as const;
        const valid = {
            ...base,
            cbt: createEmptyCBTForceForTest('force-wire'),
        };

        await forcePersistence.saveSerializedForceToLocalStorage(valid);
        expect(dbServiceMock.saveForce).toHaveBeenCalledOnceWith(valid);

        await expectAsync(forcePersistence.saveSerializedForceToLocalStorage({
            ...base,
            cbt: {
                schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION + 1,
                minimumWriterVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION + 1,
            } as any,
        })).toBeRejected();
        expect(dbServiceMock.saveForce).toHaveBeenCalledTimes(1);
    });

    it('detaches raw cache bytes synchronously and blocks activation until that write settles', async () => {
        const raw: SerializedForce = {
            version: 2,
            instanceId: 'force-raw-race',
            timestamp: '2026-04-05T00:00:00Z',
            type: GameSystem.CLASSIC,
            name: 'Original Raw',
            cbt: createEmptyCBTForceForTest('force-raw-race'),
        };
        // Delay the per-ID write queue and activate before its callback executes.
        const predecessor = deferred<void>();
        (forcePersistence as any).forceLocalSaveChain.set(raw.instanceId, predecessor.promise);
        const cache = forcePersistence.saveSerializedForceToLocalStorage(raw);
        raw.name = 'Mutated Caller Bytes';
        const active = { instanceId: signal(raw.instanceId), isWholeOwnerActive: () => true } as any;
        expect(forcePersistence.activateForceAuthority(active)).toBeFalse();
        predecessor.resolve();
        expect(await cache).toBeTrue();

        expect(dbServiceMock.saveForce).toHaveBeenCalledWith(
            jasmine.objectContaining({ name: 'Original Raw' }),
        );
        expect(forcePersistence.activateForceAuthority(active)).toBeTrue();
    });

    it('blocks activation for the complete ownerless IDB write window', async () => {
        const raw = createSerializedForceForTest({ instanceId: 'force-ownerless-idb-window' });
        const write = deferred<void>();
        dbServiceMock.saveForce.and.returnValue(write.promise);
        const cache = forcePersistence.saveSerializedForceToLocalStorage(raw);
        for (let index = 0; index < 12 && dbServiceMock.saveForce.calls.count() === 0; index += 1) {
            await Promise.resolve();
        }
        const active = { instanceId: signal(raw.instanceId), isWholeOwnerActive: () => true } as any;

        expect(forcePersistence.activateForceAuthority(active)).toBeFalse();
        write.resolve();
        expect(await cache).toBeTrue();
        expect(forcePersistence.activateForceAuthority(active)).toBeTrue();
    });

    it('preserves ownerless raw submission order while the operation lane is delayed', async () => {
        const older = createSerializedForceForTest({
            instanceId: 'force-ownerless-order',
            name: 'Older',
        });
        const newer = { ...older, name: 'Newer' };
        const lane = (forcePersistence as any).acquireOwnerlessForceOperation(older.instanceId);
        expect(lane).not.toBeNull();
        const first = forcePersistence.saveSerializedForceToLocalStorage(older);
        const second = forcePersistence.saveSerializedForceToLocalStorage(newer);
        await Promise.resolve();
        expect(dbServiceMock.saveForce).not.toHaveBeenCalled();
        (forcePersistence as any).releaseOwnerlessForceOperation(older.instanceId, lane);
        await Promise.all([first, second]);

        expect(dbServiceMock.saveForce.calls.allArgs().map(args => args[0].name)).toEqual(['Older', 'Newer']);
    });

    it('holds deletion authority through cloud dispatch before the same ID can reopen', async () => {
        const cloudReady = deferred<WebSocket>();
        spyOn<any>(forcePersistence, 'canUseCloud').and.returnValue(cloudReady.promise);
        const deletion = forcePersistence.deleteForce('force-delete-race');
        for (let index = 0; index < 8 && dbServiceMock.deleteForce.calls.count() === 0; index += 1) {
            await Promise.resolve();
        }
        const reopened = { instanceId: signal('force-delete-race'), isWholeOwnerActive: () => true } as any;
        expect(forcePersistence.activateForceAuthority(reopened)).toBeFalse();
        cloudReady.resolve({ readyState: WebSocket.OPEN } as WebSocket);
        await deletion;

        expect(dbServiceMock.deleteForce).toHaveBeenCalledOnceWith('force-delete-race', []);
        expect(wsServiceMock.send).toHaveBeenCalledWith(jasmine.objectContaining({
            action: 'delForce',
            instanceId: 'force-delete-race',
        }));
        expect(forcePersistence.activateForceAuthority(reopened)).toBeTrue();
    });

    it('orders a later get behind an in-flight delete for the same ID', async () => {
        const deleted = deferred<void>();
        dbServiceMock.deleteForce.and.returnValue(deleted.promise);
        spyOn<any>(forcePersistence, 'canUseCloud').and.resolveTo(null);
        const deletion = forcePersistence.deleteLocalForce('force-delete-before-get');
        for (let index = 0; index < 12 && dbServiceMock.deleteForce.calls.count() === 0; index += 1) {
            await Promise.resolve();
        }
        const get = forcePersistence.getForce('force-delete-before-get');
        await Promise.resolve();
        expect(dbServiceMock.getForce).toHaveBeenCalledOnceWith('force-delete-before-get');
        deleted.resolve();
        await deletion;
        expect(await get).toBeNull();
        expect(dbServiceMock.getForce).toHaveBeenCalledTimes(2);
    });

    it('orders a later delete behind an in-flight get for the same ID', async () => {
        const loaded = deferred<any>();
        dbServiceMock.getForce.and.returnValue(loaded.promise);
        spyOn<any>(forcePersistence, 'canUseCloud').and.resolveTo(null);
        const get = forcePersistence.getForce('force-get-before-delete');
        const deletion = forcePersistence.deleteLocalForce('force-get-before-delete');
        await Promise.resolve();
        expect(dbServiceMock.deleteForce).not.toHaveBeenCalled();
        loaded.resolve(null);
        expect(await get).toBeNull();
        await deletion;
        expect(dbServiceMock.deleteForce).toHaveBeenCalledOnceWith('force-get-before-delete', []);
    });

    it('uses current persisted topology when deleting unit canvases', async () => {
        dbServiceMock.getForce.and.resolveTo({
            version: 2,
            timestamp: '2026-08-22T00:00:00.000Z',
            instanceId: 'force-delete-current',
            type: GameSystem.ALPHA_STRIKE,
            name: 'AS force',
            groups: [{
                id: 'group:one',
                units: [{
                    id: 'unit:one',
                    unit: 'Atlas AS7-D',
                    state: { modified: false, destroyed: false },
                }],
            }],
        } satisfies SerializedForce);

        await forcePersistence.deleteLocalForce('force-delete-current');

        expect(dbServiceMock.deleteForce).toHaveBeenCalledOnceWith(
            'force-delete-current',
            ['unit:one'],
        );
    });

    it('rejects direct deletion of a loaded force owner', async () => {
        forcePersistence.activateForceAuthority({
            instanceId: signal('force-loaded-delete'),
            isWholeOwnerActive: () => true,
        } as any);

        await expectAsync(forcePersistence.deleteForce('force-loaded-delete'))
            .toBeRejectedWithError(/loaded force must be retired/u);
        expect(dbServiceMock.deleteForce).not.toHaveBeenCalled();
    });

    it('updates protected tags through the registered live authority instead of a stale twin', async () => {
        const persisted: SerializedForce = {
            version: 2,
            instanceId: 'force-live-tags',
            timestamp: '2026-04-05T00:00:00Z',
            type: GameSystem.CLASSIC,
            name: 'Live Tagged Force',
            tags: [],
            cbt: createEmptyCBTForceForTest('force-live-tags'),
        };
        dbServiceMock.getForce.and.resolveTo(persisted);
        const activeForce = withMockWholeOwnerAuthority({
            name: 'Live Tagged Force',
            gameSystem: GameSystem.CLASSIC,
            timestamp: persisted.timestamp,
            readOnly: () => false,
            isWholeOwnerActive: () => true,
            isWholeOwnerRetired: () => false,
            instanceId: signal('force-live-tags'),
            units: () => [],
            setTagsForExplicitPersistence: jasmine.createSpy('setTagsForExplicitPersistence').and.returnValue(true),
            serializeForPersistence: jasmine.createSpy('serializeForPersistence').and.resolveTo(persisted),
            getExpectedCloudCBTForceV2Revision: () => undefined,
        } as any);
        forcePersistence.activateForceAuthority(activeForce);
        const deserialize = spyOn<any>(forcePersistence, 'deserializeCurrentForce');

        const result = await forcePersistence.updateForceTags('force-live-tags', ['  Recon ', 'recon'], false);

        expect(activeForce.setTagsForExplicitPersistence).toHaveBeenCalledOnceWith(['Recon']);
        expect(activeForce.serializeForPersistence).toHaveBeenCalledTimes(1);
        expect(deserialize).not.toHaveBeenCalled();
        expect(dbServiceMock.saveForce).toHaveBeenCalledOnceWith(persisted);
        expect(result.tags).toEqual(['Recon']);
        expect(result.timestamp).toBe(activeForce.timestamp);
    });

    it('updates force tags through the lightweight local and cloud path', async () => {
        const local = {
            version: 2,
            instanceId: 'force-1',
            timestamp: '2026-04-01T00:00:00Z',
            type: GameSystem.ALPHA_STRIKE,
            name: 'Tagged Force',
            tags: ['Recon', 'Fire Support'],
            groups: [],
        } as SerializedForce;
        dbServiceMock.getForce.and.resolveTo(local);
        dbServiceMock.updateForceTags.and.resolveTo(local);
        wsServiceMock.sendAndWaitForResponse.and.resolveTo({
            action: 'forceTagsUpdated',
            instanceId: 'force-1',
            tags: ['Recon', 'Fire Support'],
            timestamp: '2026-04-02T00:00:00Z',
        });
        spyOn<any>(forcePersistence, 'canUseCloud').and.returnValue(Promise.resolve({} as WebSocket));

        const result = await forcePersistence.updateForceTags('force-1', ['  Recon ', 'recon', 'Fire   Support'], true);

        expect(result).toEqual({
            tags: ['Recon', 'Fire Support'],
            timestamp: '2026-04-02T00:00:00Z',
        });
        expect(dbServiceMock.updateForceTags).toHaveBeenCalledWith('force-1', ['Recon', 'Fire Support']);
        expect(wsServiceMock.sendAndWaitForResponse).toHaveBeenCalledWith({
            action: 'setForceTags',
            uuid: 'user-1',
            instanceId: 'force-1',
            tags: ['Recon', 'Fire Support'],
        });
    });

    it('holds inactive tag authority until every raw side effect settles', async () => {
        const write = deferred<any>();
        dbServiceMock.getForce.and.resolveTo(createSerializedForceForTest({
            instanceId: 'force-inactive-tag-lease',
        }));
        dbServiceMock.updateForceTags.and.returnValue(write.promise);
        const update = forcePersistence.updateForceTags('force-inactive-tag-lease', ['Recon'], false);
        for (let index = 0; index < 12 && dbServiceMock.updateForceTags.calls.count() === 0; index += 1) {
            await Promise.resolve();
        }
        const owner = {
            instanceId: signal('force-inactive-tag-lease'),
            isWholeOwnerActive: () => true,
        } as any;

        expect(forcePersistence.activateForceAuthority(owner)).toBeFalse();
        write.resolve(createSerializedForceForTest({
            instanceId: 'force-inactive-tag-lease',
            tags: ['Recon'],
        }));
        expect((await update).tags).toEqual(['Recon']);
        expect(forcePersistence.activateForceAuthority(owner)).toBeTrue();
    });

    it('persists inactive CBT tags through the ownerless byte transaction', async () => {
        const existing: SerializedForce = {
            version: 2,
            instanceId: 'force-inactive-cbt-tags',
            timestamp: '2026-04-05T00:00:00Z',
            type: GameSystem.CLASSIC,
            name: 'Inactive CBT Force',
            cbt: createEmptyCBTForceForTest('force-inactive-cbt-tags'),
        };
        const updated = { ...existing, tags: ['Recon'], timestamp: '2026-04-06T00:00:00Z' };
        dbServiceMock.getForce.and.resolveTo(existing);
        const detached = withMockWholeOwnerAuthority({
            name: existing.name,
            gameSystem: GameSystem.CLASSIC,
            timestamp: existing.timestamp,
            readOnly: () => false,
            instanceId: signal(existing.instanceId),
            groups: () => [],
            units: () => [],
            setExpectedCloudCBTForceV2Revision: jasmine.createSpy('setExpectedRevision'),
            setTagsForExplicitPersistence: jasmine.createSpy('setTagsExplicit').and.returnValue(true),
            serializeForPersistence: jasmine.createSpy('serialize').and.resolveTo(updated),
            getExpectedCloudCBTForceV2Revision: () => undefined,
        } as any);
        spyOn<any>(forcePersistence, 'deserializeCurrentForce').and.resolveTo(detached);

        const result = await forcePersistence.updateForceTags(existing.instanceId, [' Recon '], false);

        expect(result).toEqual({ tags: ['Recon'], timestamp: updated.timestamp });
        expect(dbServiceMock.updateForceTags).not.toHaveBeenCalled();
        expect(dbServiceMock.saveForce).toHaveBeenCalledWith(updated);
    });

    it('rejects lightweight tag updates when neither local nor cloud storage can be updated', async () => {
        spyOn<any>(forcePersistence, 'canUseCloud').and.returnValue(Promise.resolve(null));

        await expectAsync(forcePersistence.updateForceTags('force-missing', ['Recon'], true)).toBeRejectedWithError(
            'The selected force is missing, protected, or read-only and cannot be retagged.',
        );
    });

    it('commits the bundled catalog without waiting for auxiliary startup catalogs', async () => {
        const held = new Promise<void>(() => undefined);
        forceNameWordsCatalogMock.initialize.and.returnValue(held);
        megaMekAvailabilityCatalogMock.initialize.and.returnValue(held);
        sarnaPageTitlesCatalogMock.initialize.and.returnValue(held);
        presentationCatalogsMock.initializeFluffImages.and.returnValue(held);

        await service.initialize();

        expect(service.isDataReady()).toBeTrue();
        expect(unitsCatalogMock.commitPendingActivation).toHaveBeenCalledOnceWith(1);
        expect(equipmentCatalogMock.initialize).not.toHaveBeenCalled();
        expect(quirksCatalogMock.initialize).not.toHaveBeenCalled();
        expect(sourcebooksCatalogMock.initialize).not.toHaveBeenCalled();
        expect(presentationCatalogsMock.initializeFluffImages).toHaveBeenCalledTimes(1);
    });

    it('waits for local tags and runtime indexes before reporting local readiness', async () => {
        let releaseTags!: (value: null) => void;
        unitRuntimeServiceMock.loadUnitTags.and.returnValue(new Promise(resolve => {
            releaseTags = resolve;
        }));
        let resolved = false;
        const initialization = service.initialize().then(() => { resolved = true; });
        for (let index = 0; index < 20 && !releaseTags; index += 1) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        expect(resolved).toBeFalse();
        expect(service.isDataReady()).toBeFalse();
        expect(unitSearchIndexServiceMock.prepareCatalogIndexes).not.toHaveBeenCalled();

        releaseTags(null);
        await initialization;

        expect(service.isDataReady()).toBeTrue();
        expect(unitSearchIndexServiceMock.prepareCatalogIndexes).toHaveBeenCalledTimes(1);
        expect(loggerServiceMock.info).toHaveBeenCalledWith(
            jasmine.stringMatching(/^\[Startup\] Local data ready in \d+ ms\.$/u),
        );
    });

    it('hydrates saved availability before publishing the local search corpus', async () => {
        let releaseAvailability!: (value: boolean) => void;
        megaMekAvailabilityCatalogMock.hydrateFromCache.and.returnValue(new Promise(resolve => {
            releaseAvailability = resolve;
        }));
        let resolved = false;
        const initialization = service.initialize().then(() => { resolved = true; });
        for (let index = 0; index < 20 && !releaseAvailability; index += 1) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        expect(resolved).toBeFalse();
        expect(service.isDataReady()).toBeFalse();
        expect(unitRuntimeServiceMock.loadUnitTags).not.toHaveBeenCalled();

        releaseAvailability(true);
        await initialization;

        expect(service.isDataReady()).toBeTrue();
        expect(service.megaMekAvailabilityVersion()).toBe(1);
        expect(megaMekAvailabilityCatalogMock.initialize).toHaveBeenCalledTimes(1);
    });

    it('keeps cold startup blocked until a complete Units activation exists', async () => {
        let releaseUnits!: () => void;
        unitsCatalogMock.initialize.and.returnValue(new Promise<void>(resolve => {
            releaseUnits = () => {
                queueMockCatalogActivation();
                resolve();
            };
        }));
        let resolved = false;

        const initialization = service.initialize().then(() => { resolved = true; });
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
        expect(resolved).toBeFalse();
        expect(service.isDataReady()).toBeFalse();

        releaseUnits();
        await initialization;
        expect(service.isDataReady()).toBeTrue();
    });

    it('hot-swaps Units, runtime maps, search indexes, and corpus once', async () => {
        const initialUnits = [createUnit('A')];
        unitsCatalogMock.getUnits.and.returnValue(initialUnits);
        await service.initialize();
        await waitForUnitCatalogSettlement(service);

        const replacementUnits = [createUnit('B')];
        unitsCatalogMock.getUnits.and.returnValue(replacementUnits);
        queueMockCatalogActivation(replacementUnits);
        TestBed.tick();
        await waitForUnitCatalogSettlement(service);

        expect(unitsCatalogMock.commitPendingActivation.calls.allArgs()).toEqual([[1], [2]]);
        expect(unitRuntimeServiceMock.commitPreparedRuntimeCatalog).toHaveBeenCalledTimes(2);
        expect(unitSearchIndexServiceMock.commitPreparedCatalogIndexes).toHaveBeenCalledTimes(2);
        expect(unitSearchIndexServiceMock.prepareCatalogIndexes.calls.mostRecent().args[0]).toBe(replacementUnits);
        expect(service.searchCorpusVersion()).toBe(2);
    });

    it('settles user save and delete overlays through the same atomic runtime and search switch', async () => {
        const unit = createUnit('MM-Data');
        unitsCatalogMock.getUnits.and.returnValue([unit]);
        await service.initialize();
        await waitForUnitCatalogSettlement(service);

        const savedUser = createUnit('Saved User');
        const afterSave = [unit, savedUser];
        queueMockCatalogActivation(afterSave);
        TestBed.tick();
        await waitForUnitCatalogSettlement(service);

        expect(unitsCatalogMock.commitPendingActivation.calls.allArgs()).toEqual([[1], [2]]);
        expect(unitRuntimeServiceMock.prepareRuntimeCatalog.calls.mostRecent().args[0]).toBe(afterSave);
        expect(unitSearchIndexServiceMock.prepareCatalogIndexes.calls.mostRecent().args[0]).toBe(afterSave);
        expect(service.searchCorpusVersion()).toBe(2);

        const afterDelete = [unit];
        queueMockCatalogActivation(afterDelete);
        TestBed.tick();
        await waitForUnitCatalogSettlement(service);

        expect(unitsCatalogMock.commitPendingActivation.calls.allArgs()).toEqual([[1], [2], [3]]);
        expect(unitRuntimeServiceMock.prepareRuntimeCatalog.calls.mostRecent().args[0]).toBe(afterDelete);
        expect(unitSearchIndexServiceMock.prepareCatalogIndexes.calls.mostRecent().args[0]).toBe(afterDelete);
        expect(unitRuntimeServiceMock.commitPreparedRuntimeCatalog).toHaveBeenCalledTimes(3);
        expect(unitSearchIndexServiceMock.commitPreparedCatalogIndexes).toHaveBeenCalledTimes(3);
        expect(service.searchCorpusVersion()).toBe(3);
    });

    it('skips a superseded summary before the atomic publication boundary', async () => {
        const initialUnits = [createUnit('A')];
        unitsCatalogMock.getUnits.and.returnValue(initialUnits);
        await service.initialize();
        await waitForUnitCatalogSettlement(service);

        const unitsB = [createUnit('B')];
        const unitsC = [createUnit('C')];
        unitsCatalogMock.getUnits.and.returnValue(unitsB);
        queueMockCatalogActivation(unitsB);
        TestBed.tick();
        for (let index = 0; index < 4; index += 1) await Promise.resolve();

        unitsCatalogMock.getUnits.and.returnValue(unitsC);
        queueMockCatalogActivation(unitsC);
        TestBed.tick();
        await waitForUnitCatalogSettlement(service);

        expect(unitsCatalogMock.commitPendingActivation.calls.allArgs()).toEqual([[1], [3]]);
        expect(unitRuntimeServiceMock.postprocessUnits.calls.allArgs().some(args => args[0] === unitsB)).toBeFalse();
        expect(unitSearchIndexServiceMock.prepareCatalogIndexes.calls.mostRecent().args[0]).toBe(unitsC);
        expect(service.searchCorpusVersion()).toBe(2);
    });

    it('buffers local and public tag callbacks across all of B preparation and commits one B index', async () => {
        const unitsA = [createUnit('A')];
        unitsCatalogMock.getUnits.and.returnValue(unitsA);
        await service.initialize();
        await waitForUnitCatalogSettlement(service);
        unitRuntimeServiceMock.applyTagDataToUnits.calls.reset();
        unitRuntimeServiceMock.applyPreparedTagDataToUnits.calls.reset();
        unitRuntimeServiceMock.applyPublicTagsToUnits.calls.reset();
        unitSearchIndexServiceMock.prepareCatalogIndexes.calls.reset();

        const unitsB = [createUnit('B')];
        const localCallback = tagsServiceMock.setRefreshUnitsCallback.calls.mostRecent().args[0];
        const publicCallback = publicTagsServiceMock.setRefreshUnitsCallback.calls.mostRecent().args[0];
        const tagData = { tags: {} } as any;
        let injected = false;
        unitSearchIndexServiceMock.prepareCatalogIndexes.and.callFake((units: UnitSummary[]) => {
            if (units === unitsB && !injected) {
                injected = true;
                localCallback(tagData, { searchIndexChanged: true });
                publicCallback();
                expect(unitRuntimeServiceMock.applyTagDataToUnits).not.toHaveBeenCalled();
                expect(unitRuntimeServiceMock.applyPublicTagsToUnits.calls.allArgs()
                    .some(args => args[0] === unitsA)).toBeFalse();
            }
            return {
                unitSubtypeMaxStats: {}, unitAsTypeMaxStats: {}, searchFilterIndex: new Map(),
                componentCountIndex: new Map(), searchFilterValues: new Map(),
                dropdownOptionUniverse: new Map(), factionEraSnapshot: {},
            };
        });

        queueMockCatalogActivation(unitsB);
        TestBed.tick();
        await waitForUnitCatalogSettlement(service);

        expect(unitRuntimeServiceMock.applyPreparedTagDataToUnits)
            .toHaveBeenCalledWith(unitsB, tagData, { rebuildTagSearchIndex: false });
        expect(unitRuntimeServiceMock.applyPublicTagsToUnits.calls.allArgs()
            .every(args => args[0] === unitsB)).toBeTrue();
        expect(unitSearchIndexServiceMock.prepareCatalogIndexes.calls.allArgs()
            .filter(args => args[0] === unitsB).length).toBe(1);
        expect(unitSearchIndexServiceMock.rebuildTagSearchIndex).toHaveBeenCalledOnceWith(unitsB);
        expect(unitsCatalogMock.commitPendingActivation.calls.allArgs()).toEqual([[1], [2]]);
        expect(service.searchCorpusVersion()).toBe(3);
        expect(service.tagsVersion()).toBe(3);
    });

    it('keeps replacement era/faction membership detached until the same atomic Unit swap', async () => {
        const era: Era = {
            id: 1,
            name: 'Test era',
            years: { from: 3000, to: 4000 },
            factions: new Set<number>(),
            units: new Set<number>(),
        };
        const none: Faction = {
            id: MULFACTION_NONE,
            name: 'None',
            group: 'Other',
            img: '',
            eras: {},
        };
        erasCatalogMock.getEras.and.returnValue([era]);
        factionsCatalogMock.getFactions.and.returnValue([none]);
        const unitsA = [createEmptyUnit({ id: 101, name: 'A', year: 3100 })];
        unitsCatalogMock.getUnits.and.returnValue(unitsA);
        await service.initialize();
        await waitForUnitCatalogSettlement(service);
        const activeEra = service.getEras()[0]!;
        const activeFaction = service.getFactions()[0]!;
        expect(activeEra).not.toBe(era);
        expect(activeFaction).not.toBe(none);
        expect(activeEra.units).toEqual(new Set([101]));
        expect(activeFaction.eras[1]).toEqual(new Set([101]));
        expect(era.units).toEqual(new Set());
        expect(none.eras[1]).toBeUndefined();

        const unitsB = [
            ...unitsA,
            createEmptyUnit({ id: 202, name: 'B', year: 3200 }),
        ];
        let finishFinalize!: (value: boolean) => void;
        unitsCatalogMock.finalizePendingActivation.and.callFake((revision: number) => revision === 2
            ? new Promise<boolean>(resolve => { finishFinalize = resolve; })
            : Promise.resolve(true));
        queueMockCatalogActivation(unitsB);
        TestBed.tick();
        for (let index = 0;
            index < 12 && unitsCatalogMock.finalizePendingActivation.calls.count() < 2;
            index += 1) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(unitsCatalogMock.finalizePendingActivation).toHaveBeenCalledTimes(2);

        // A's exact object graph and index remain visible while the summary B
        // candidate waits at its durable pointer fence.
        expect(service.getEras()[0]).toBe(activeEra);
        expect(service.getFactions()[0]).toBe(activeFaction);
        expect(activeEra.units).toEqual(new Set([101]));
        expect(activeFaction.eras[1]).toEqual(new Set([101]));
        const preparedArgs = unitSearchIndexServiceMock.prepareCatalogIndexes.calls.mostRecent().args;
        expect(preparedArgs[1][0]).not.toBe(era);
        expect(preparedArgs[2][0]).not.toBe(none);
        expect(preparedArgs[1][0].units).toEqual(new Set([101, 202]));

        finishFinalize(true);
        await waitForUnitCatalogSettlement(service);
        expect(service.getEras()[0]).not.toBe(activeEra);
        expect(service.getFactions()[0]).not.toBe(activeFaction);
        expect(service.getEras()[0].units).toEqual(new Set([101, 202]));
        expect(service.getFactionById(MULFACTION_NONE)?.eras[1]).toEqual(new Set([101, 202]));
        expect(era.units).toEqual(new Set());
        expect(none.eras[1]).toBeUndefined();
    });

    it('retains the previous coherent catalog when replacement index preparation fails', async () => {
        const initialUnits = [createUnit('A')];
        unitsCatalogMock.getUnits.and.returnValue(initialUnits);
        await service.initialize();
        await waitForUnitCatalogSettlement(service);
        const replacementUnits = [createUnit('B')];
        unitSearchIndexServiceMock.prepareCatalogIndexes.and.callFake((units: UnitSummary[]) => {
            if (units === replacementUnits) throw new Error('index failed');
            return {
                unitSubtypeMaxStats: {}, unitAsTypeMaxStats: {}, searchFilterIndex: new Map(),
                componentCountIndex: new Map(), searchFilterValues: new Map(),
                dropdownOptionUniverse: new Map(), factionEraSnapshot: {},
            };
        });

        queueMockCatalogActivation(replacementUnits);
        TestBed.tick();
        await waitForUnitCatalogSettlement(service);

        expect(unitsCatalogMock.commitPendingActivation.calls.allArgs()).toEqual([[1]]);
        expect(unitsCatalogMock.rejectPendingActivation).toHaveBeenCalledWith(2, jasmine.any(Error));
        expect(unitsCatalogMock.getUnits()).toBe(initialUnits);
        expect(service.isDataReady()).toBeTrue();
        expect(service.searchCorpusVersion()).toBe(1);
        expect(service.runtimeCatalogProgress()).toEqual(jasmine.objectContaining({ status: 'error' }));
    });

    it('does not bump versions repeatedly when ensuring MegaMek availability', async () => {
        expect(service.searchCorpusVersion()).toBe(0);
        expect(service.megaMekAvailabilityVersion()).toBe(0);

        expect(await service.ensureMegaMekAvailabilityCatalogInitialized()).toBeTrue();
        expect(service.searchCorpusVersion()).toBe(0);
        expect(service.megaMekAvailabilityVersion()).toBe(1);
        expect(megaMekAvailabilityCatalogMock.initialize).toHaveBeenCalledTimes(1);

        expect(await service.ensureMegaMekAvailabilityCatalogInitialized()).toBeTrue();
        expect(service.searchCorpusVersion()).toBe(0);
        expect(service.megaMekAvailabilityVersion()).toBe(1);
        expect(megaMekAvailabilityCatalogMock.initialize).toHaveBeenCalledTimes(2);
    });

});
