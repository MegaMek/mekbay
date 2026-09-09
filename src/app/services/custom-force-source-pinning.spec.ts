// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { Injector, provideZonelessChangeDetection } from '@angular/core';
import { CBTForce } from '../models/cbt-force.model';
import { encodeForceForStorage } from '../models/runtime/force-storage-codec';
import { decompressEmbeddedCustomDesigns, MAX_EMBEDDED_CUSTOM_DESIGNS } from '../models/custom-design-policy';
import { ForceUnitAdmissionService } from './force-unit-admission.service';
import { DialogsService } from './dialogs.service';
import { TestBed } from '@angular/core/testing';
import { createConstructionEntity, type ConstructionUnitKind } from '../construction/domain/construction-factory';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { encodeNativeEntity } from '../models/entity/write-entity';
import { decodePinnedCustomUnitSource } from '../models/pinned-custom-unit-source';
import { pinnedCustomSourceForHandle } from '../models/native-unit-source-handle';
import { CBTUnitStore } from '../models/cbt-unit-store';
import { CBT_FORCE_PERSISTENCE_SCHEMA_VERSION, asForceId, emptyRuntimeHistory, type SerializedCBTForceV2, type SerializedCBTUnitV2 } from '../models/runtime/persistence-v2';
import type { SerializedNonMekUnit } from '../models/runtime/non-mek-unit-persistence';
import { sha1Base64Url } from '../utils/sha1.util';
import { CBTUnitService } from './cbt-unit.service';
import { NativeEntityService } from './native-entity.service';
import { CustomUnitSyncService } from './custom-unit-sync.service';
import { CoreUnitCatalogService } from './unit-catalog/core-unit-catalog.service';
import { MAX_UNIT_SOURCE_BYTES } from './unit-catalog/core-unit-manifest';
import { EquipmentCatalogService } from './catalogs/equipment-catalog.service';
import { SourcebooksCatalogService } from './catalogs/sourcebooks-catalog.service';
import { QuirksCatalogService } from './catalogs/quirks-catalog.service';
import { UnitsCatalogService } from './catalogs/units-catalog.service';
import { DataService } from './data.service';
import { OptionsService } from './options.service';
import { asSourceHash, asUnitUuid, makeUnitFileName, type StoredCoreContent } from './unit-catalog/unit-catalog.types';

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
const SCENARIO = { id: 'pinning', ruleset: 'core-2026' as const };

async function setup(kind: ConstructionUnitKind, custom = true) {
    const registry = createTestEquipmentRegistry();
    const entity = createConstructionEntity(kind, registry);
    entity.uuid.set(UUID);
    entity.model.set('Original revision');
    const location = kind === 'Biped' ? 'CT' : 'Front';
    entity.armorValues.update(values => new Map(values).set(location, { front: 20, rear: 0 }));
    const format = kind === 'Biped' ? 'mtf' : 'blk';
    const file = makeUnitFileName(UUID, format);
    const makeSource = async (): Promise<StoredCoreContent> => {
        const bytes = new TextEncoder().encode(encodeNativeEntity(entity)).buffer;
        return { bytes, file, format, hash: asSourceHash(await sha1Base64Url(bytes)) };
    };
    let current: StoredCoreContent | undefined = await makeSource();
    const revisions = new Map([[current.hash, { uuid: UUID, format, source: new TextDecoder().decode(current.bytes) }]]);
    const fetch = jasmine.createSpy('fetchCustomRevision').and.callFake(async (_uuid, hash) => revisions.get(hash));
    const read = jasmine.createSpy('readNativeUnitSource').and.callFake(async () => current);
    const notice = jasmine.createSpy('notice').and.resolveTo();
    TestBed.configureTestingModule({ providers: [
        provideZonelessChangeDetection(), CBTUnitService, NativeEntityService,
        { provide: CustomUnitSyncService, useValue: { fetch } },
        { provide: DialogsService, useValue: { showNotice: notice } },
        { provide: OptionsService, useValue: { options: () => ({ displayUnitNameFormat: 'innerSphereClan', CBTRules: 'core-2026', CBTOptionalRules: { forcedWithdrawal: true, sprinting: false } }) } },
        { provide: CoreUnitCatalogService, useValue: { getPublishedGeneration: () => ({
            activationId: 'test-generation', manifest: { manifest: { units: custom ? {} : { [UUID]: { hash: current?.hash } } } },
        }) } },
        { provide: UnitsCatalogService, useValue: { hasCustomUnit: () => custom && !!current, readNativeUnitSource: read } },
        { provide: EquipmentCatalogService, useValue: { getCatalogRevision: () => 'equipment', getEquipmentRegistry: () => registry } },
        { provide: SourcebooksCatalogService, useValue: { getCatalogRevision: () => 'sourcebooks', getSourcebooks: () => new Map() } },
        { provide: QuirksCatalogService, useValue: { getCatalogRevision: () => 'quirks', getQuirksByKey: () => new Map() } },
        { provide: DataService, useValue: { requireApplicationCatalogReady: async () => undefined, getFactionById: () => null, getEraById: () => null } },
    ] });
    return { service: TestBed.inject(CBTUnitService), entities: TestBed.inject(NativeEntityService), entity, read,
        fetch, notice, clearLocal: () => { current = undefined; (TestBed.inject(NativeEntityService) as unknown as { cachedRepository?: unknown }).cachedRepository = undefined; },
        revise: async () => { entity.model.set('New catalog revision'); entity.armorValues.update(values => new Map(values).set(location, { front: 40, rear: 0 })); current = await makeSource(); revisions.set(current.hash, { uuid: UUID, format, source: new TextDecoder().decode(current.bytes) }); },
        delete: () => { current = undefined; },
    };
}

describe('portable custom force source pinning', () => {
    for (const kind of ['Biped', 'Tank'] as const) {
        it(`retains ${kind} source and damage after the same custom UUID is revised and deleted`, async () => {
            const fixture = await setup(kind);
            const unit = await fixture.service.create({ uuid: UUID, instanceId: `unit:pin:${kind}`, deployment: { id: 'test' }, scenario: SCENARIO });
            const face = [...unit.getIndex().armorFaces.values()].find(face => face.maximumPoints === 20)!;
            expect(unit.dispatch({ type: 'damage-armor', faceId: face.id, amount: 3, target: 'committed' }).changed).toBeTrue();
            const saved = JSON.parse(JSON.stringify(unit.serialize()));
            expect(saved.customSource.source).toBe(new TextDecoder().decode(unit.getNativeSource()!.bytes));
            await fixture.revise();
            const latest = await fixture.entities.load(UUID);
            expect(latest.entity.model()).toBe('New catalog revision');
            const restored = await fixture.service.restore(saved, SCENARIO);
            expect(restored.unit.getUnit().model()).toBe('Original revision');
            expect(restored.unit.query().remainingArmor(face.id)).toBe(17);
            expect(restored.warnings).toEqual([]);
            expect(restored.unit.serialize().customSource).toEqual(saved.customSource);
            fixture.delete();
            fixture.read.calls.reset();
            const portable = await fixture.service.restore(JSON.parse(JSON.stringify(restored.unit.serialize())), SCENARIO);
            expect(portable.unit.getUnit().model()).toBe('Original revision');
            expect(portable.unit.query().remainingArmor(face.id)).toBe(17);
            expect(fixture.read).not.toHaveBeenCalled();
        });
    }

    it('reuses the pinned revision already in memory without downloading or reading the catalog again', async () => {
        const fixture = await setup('Biped');
        const unit = await fixture.service.create({ uuid: UUID, instanceId: 'unit:memory', deployment: { id: 'test' }, scenario: SCENARIO });
        const saved = unit.serialize();
        fixture.delete(); fixture.read.calls.reset();
        const restored = await fixture.service.restore(saved, SCENARIO);
        expect(restored.unit.getUnit()).toBe(unit.getUnit());
        expect(restored.unit.serialize().customSource).toEqual(saved.customSource);
        expect(fixture.fetch).not.toHaveBeenCalled(); expect(fixture.read).not.toHaveBeenCalled();
    });

    it('clones the saved custom revision through real admission after the library entry is deleted', async () => {
        const fixture = await setup('Biped');
        const force = new CBTForce('Pinned clone', TestBed.inject(DataService), TestBed.inject(Injector));
        const admission = new ForceUnitAdmissionService();
        const original = await admission.admitCBT({ force, uuid: UUID });
        const pin = pinnedCustomSourceForHandle(force.getUnitSnapshot(original.id)?.nativeSource)!;
        fixture.clearLocal(); fixture.read.calls.reset();
        const clone = await admission.admitCBT({ force, uuid: UUID, customSource: pin });
        expect(clone.id).not.toBe(original.id);
        expect(clone.entity.model()).toBe('Original revision');
        expect(force.getUnitSnapshot(clone.id)?.nativeSource?.sourceHash).toBe(force.getUnitSnapshot(original.id)?.nativeSource?.sourceHash);
        expect(fixture.read).not.toHaveBeenCalled(); expect(fixture.fetch).not.toHaveBeenCalled();
        expect(decompressEmbeddedCustomDesigns((encodeForceForStorage(await force.serializeForPersistence()) as any).customDesigns).length).toBe(1);
    });

    it('blocks a drag at the cap without changing either force, then allows it after a design moves out', async () => {
        const fixture = await setup('Biped');
        const makeForce = (name: string) => new CBTForce(name, TestBed.inject(DataService), TestBed.inject(Injector));
        const source = makeForce('Source'), target = makeForce('Target'), recipient = makeForce('Recipient');
        const admission = new ForceUnitAdmissionService();
        const add = async (force: CBTForce, n: number) => {
            const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-' + String(n).padStart(12, '0'));
            fixture.entity.uuid.set(uuid);
            return admission.admitCBT({ force, uuid, customSource: { format: 'mtf', source: encodeNativeEntity(fixture.entity) } });
        };
        const moving = await add(source, 99);
        const members = [];
        for (let n = 1; n <= MAX_EMBEDDED_CUSTOM_DESIGNS; n++) members.push(await add(target, n));
        const beforeSource = await source.serializeForPersistence(), beforeTarget = await target.serializeForPersistence();
        const destination = target.groups()[0].id;
        expect((await source.transferMemberTo(target, moving.id, destination, 0)).accepted).toBeFalse();
        expect(fixture.notice).toHaveBeenCalledTimes(1);
        expect(await source.serializeForPersistence()).toEqual(beforeSource);
        expect(await target.serializeForPersistence()).toEqual(beforeTarget);
        const group = await recipient.addGroup();
        expect((await target.transferMemberTo(recipient, members[0].id, group.id, 0)).accepted).toBeTrue();
        fixture.notice.calls.reset();
        expect((await source.transferMemberTo(target, moving.id, destination, 0)).accepted).toBeTrue();
        const sourceSaved = encodeForceForStorage(await source.serializeForPersistence()) as any;
        const targetSaved = encodeForceForStorage(await target.serializeForPersistence()) as any;
        expect(sourceSaved.customDesigns).toBeUndefined();
        expect(decompressEmbeddedCustomDesigns(targetSaved.customDesigns).length).toBe(MAX_EMBEDDED_CUSTOM_DESIGNS);
        expect(targetSaved.units.every((u: any) => Number.isInteger(u.customDesign))).toBeTrue();
        expect(decompressEmbeddedCustomDesigns((encodeForceForStorage(await recipient.serializeForPersistence()) as any).customDesigns).length).toBe(1);
        expect(fixture.notice).not.toHaveBeenCalled(); expect(fixture.fetch).not.toHaveBeenCalled();
        const pin = pinnedCustomSourceForHandle(target.getUnitSnapshot(moving.id)?.nativeSource)!;
        await admission.admitCBT({ force: target, uuid: moving.entity.uuid(), customSource: pin });
        expect(decompressEmbeddedCustomDesigns((encodeForceForStorage(await target.serializeForPersistence()) as any).customDesigns).length).toBe(MAX_EMBEDDED_CUSTOM_DESIGNS);
    });

    it('never embeds source bytes for an ordinary core unit', async () => {
        const fixture = await setup('Tank', false);
        const unit = await fixture.service.create({ uuid: UUID, instanceId: 'unit:core', deployment: { id: 'test' }, scenario: SCENARIO });
        expect(unit.serialize().customSource).toBeUndefined();
        expect(unit.getNativeSource()?.isCustom).toBeUndefined();
    });

    it('recovers unreadable runtime state using its pinned source after the custom catalog entry is deleted', async () => {
        const fixture = await setup('Tank');
        const unit = await fixture.service.create({ uuid: UUID, instanceId: 'unit:recover-pin', deployment: { id: 'test' }, scenario: SCENARIO });
        const saved = unit.serialize();
        await fixture.revise();
        fixture.delete();
        fixture.read.calls.reset();
        spyOn(fixture.service, 'restore').and.rejectWith(new Error('Unreadable runtime state'));
        const restored = await new CBTUnitStore().restore(forceEnvelope(saved), fixture.service, SCENARIO);
        const recovered = restored.binding.units.get(unit.instanceId)!;
        expect(recovered.getUnit().model()).toBe('Original revision');
        expect(recovered.serialize().customSource).toEqual(saved.customSource);
        expect(restored.warnings).toEqual(['1 unit had unreadable saved state and was reset to pristine.']);
        expect(fixture.read).not.toHaveBeenCalled();
    });

    it('rejects an invalid force pin instead of recovering the instance from the latest catalog source', async () => {
        const fixture = await setup('Tank');
        const unit = await fixture.service.create({ uuid: UUID, instanceId: 'unit:invalid-pin', deployment: { id: 'test' }, scenario: SCENARIO });
        const saved = { ...unit.serialize(), customSource: { format: 'blk' as const,
            source: '<UnitType>Tank</UnitType><UUID>019f6767-0dcb-7bb8-992f-aef08202f5e2</UUID>' } };
        fixture.read.calls.reset();
        const restored = await new CBTUnitStore().restore(forceEnvelope(saved), fixture.service, SCENARIO);
        expect(restored.binding.units.size).toBe(0);
        expect(restored.warnings).toEqual(['1 unit had an unreadable saved custom source and was skipped.']);
        expect(fixture.read).not.toHaveBeenCalled();
    });

    it('rejects mismatched UUID, malformed grammar and oversized pins without falling back to the catalog', async () => {
        const fixture = await setup('Tank');
        fixture.read.calls.reset();
        await expectAsync(fixture.entities.loadPinnedCustom(UUID, { format: 'blk', source: '<UnitType>Tank</UnitType><UUID>019f6767-0dcb-7bb8-992f-aef08202f5e2</UUID>' })).toBeRejected();
        await expectAsync(fixture.entities.loadPinnedCustom(UUID, { format: 'mtf', source: '<UnitType>Tank</UnitType>' })).toBeRejected();
        expect(() => decodePinnedCustomUnitSource({ format: 'blk', source: 'x'.repeat(MAX_UNIT_SOURCE_BYTES + 1) })).toThrow();
        expect(() => decodePinnedCustomUnitSource({ format: 'json', source: '{}' })).toThrow();
        expect(fixture.read).not.toHaveBeenCalled();
    });

    it('preserves UTF-8 BOM, original line endings and the full source hash when loading a pin', async () => {
        const fixture = await setup('Tank');
        const text = '\uFEFF' + encodeNativeEntity(fixture.entity).replace(/\r?\n/g, '\r\n');
        const bytes = new TextEncoder().encode(text).buffer;
        const pin = pinnedCustomSourceForHandle({ file: makeUnitFileName(UUID, 'blk'), format: 'blk', bytes, isCustom: true })!;
        expect([...new TextEncoder().encode(pin.source)]).toEqual([...new Uint8Array(bytes)]);
        const loaded = await fixture.entities.loadPinnedCustom(UUID, pin);
        expect([...new Uint8Array(loaded.source.bytes)]).toEqual([...new Uint8Array(bytes)]);
        expect(loaded.source.sourceHash).toBe(await sha1Base64Url(bytes));
    });
});

function forceEnvelope(unit: SerializedCBTUnitV2 | SerializedNonMekUnit): SerializedCBTForceV2 {
    return { schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION, forceId: asForceId('force:source-pin'), forceRevision: unit.stateRevision,
        history: emptyRuntimeHistory(), units: [{ instanceId: unit.instanceId, stateRevision: unit.stateRevision, unit }],
        roster: { schemaVersion: 1, groups: [{ groupId: 'group:source-pin', order: 0,
            members: [{ instanceId: unit.instanceId, order: 0 }] }] }, encounter: { networks: [] } };
}
