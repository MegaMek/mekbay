import { setConstructionBuildingTopology } from './domain/construction-building-topology';
import { StaticEmplacementEntity } from '../models/entity/entities/misc/static-emplacement-entity';
import { MiscEquipment } from '../models/equipment.model';
// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { ToastService } from '../services/toast.service';
import { TestBed } from '@angular/core/testing';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { UnitConstructionComponent } from './unit-construction.component';
import { ConstructionForceService } from './construction-force.service';
import { createConstructionEntity, getConstructionFields } from './domain';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { BaseEntity } from '../models/entity/base-entity';
import { MekEntity } from '../models/entity/entities/mek/mek-entity';
import { parseEntity } from '../models/entity/parse-entity';
import { encodeNativeEntity } from '../models/entity/write-entity';
import { EquipmentCatalogService } from '../services/catalogs/equipment-catalog.service';
import { CustomUnitsService } from '../services/custom-units.service';
import { UnitArtworkService } from '../services/unit-artwork.service';
import { UnitFluffImageService } from '../services/catalogs/unit-fluff-image.service';
import type { UnitArtwork } from '../models/unit-artwork.model';
import { encodeUnitImage } from '../utils/unit-artwork.util';
import { CustomUnitSyncService } from '../services/custom-unit-sync.service';
import { ForceCustomDesignsService } from '../services/force-custom-designs.service';
import { ForcePersistenceService } from '../services/force-persistence.service';
import { DataService } from '../services/data.service';
import { DialogsService } from '../services/dialogs.service';
import { NativeEntityService } from '../services/native-entity.service';
import { UnitNameService } from '../services/unit-name.service';
import { LayoutService } from '../services/layout.service';
import { StatBarSpecsPipe } from '../pipes/stat-bar-specs.pipe';
import { UnitSearchIndexService } from '../services/unit-search-index.service';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { CBTForceMember } from '../models/force-member.model';
import type { CBTForce } from '../models/cbt-force.model';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import { matchNativeMounts } from '../models/entity/utils/native-mount-correspondence';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';
import type { UnitSummary } from '../models/unit-summary.model';
import {
  constructionRuntimeSource,
  prepareConstructionRuntime,
  type ConstructionRuntimeChanges,
} from '../models/runtime/construction-runtime';
import type { CBTUnitSnapshot } from '../models/cbt-unit-snapshot';
import type { CBTUnit } from '../models/runtime/cbt-unit';

describe('construction editor document lifecycle', () => {
  const registry = createTestEquipmentRegistry();
  const coreUuid = asUnitUuid('019f6767-0dcb-7bb8-992f-000000000001');
  const customUuid = asUnitUuid('019f6767-0dcb-7bb8-992f-000000000002');
  const copyUuid = asUnitUuid('019f6767-0dcb-7bb8-992f-000000000003');
  let editor: UnitConstructionComponent;
  let core: BaseEntity;
  let save: jasmine.Spy;
  let refresh: jasmine.Spy;
  let confirm: jasmine.Spy;
  let applyRefit: jasmine.Spy;
  let getCustom: jasmine.Spy;
  let searchIndex: UnitSearchIndexService;
  let searchCorpusVersion: ReturnType<typeof signal<number>>;
  let detach: jasmine.Spy;
  let remove: jasmine.Spy;
  let savedForces: { name: string; groups: { units: { unit: { uuid: string } }[] }[] }[];
  let scanForces: jasmine.Spy;
  let owned: boolean;
  let artworkRows: ReturnType<typeof signal<Map<string, UnitArtwork>>>;
  let artworkSave: jasmine.Spy;

  beforeEach(() => {
    owned = true;
    artworkRows = signal(new Map<string, UnitArtwork>());
    artworkSave = jasmine.createSpy('saveArtwork').and.callFake(async (uuid: string, value: UnitArtwork | null) => {
      artworkRows.update((rows) => {
        const next = new Map(rows);
        if (value) next.set(uuid, value);
        else next.delete(uuid);
        return next;
      });
    });
    core = createConstructionEntity('Biped', registry);
    core.uuid.set(coreUuid);
    core.chassis.set('Hunchback');
    core.model.set('HBK-4G');
    save = jasmine.createSpy('save').and.callFake(async (_entity, options) => ({
      uuid: options.uuid ?? customUuid,
      originalUnitUuid: options.uuid ? _entity.refitFromUUID() : (options.originalUnitUuid ?? _entity.refitFromUUID()),
    }));
    refresh = jasmine.createSpy('refresh').and.resolveTo();
    confirm = jasmine.createSpy('confirm').and.resolveTo(true);
    applyRefit = jasmine.createSpy('applyRefit').and.callFake(async (member) => member);
    getCustom = jasmine.createSpy('getCustom').and.resolveTo(undefined);
    remove = jasmine.createSpy('delete').and.resolveTo();
    savedForces = [];
    scanForces = jasmine.createSpy('loadAll').and.resolveTo();
    searchIndex = new UnitSearchIndexService();
    searchCorpusVersion = signal(0);
    const parseDraft = (source: string, format: string) =>
      parseEntity(source, `draft.${format}`, core.getEquipmentRegistry()).entity;
    detach = jasmine
      .createSpy('detach')
      .and.callFake((entity: BaseEntity) =>
        parseDraft(encodeNativeEntity(entity), entity instanceof MekEntity ? 'mtf' : 'blk'),
      );
    TestBed.configureTestingModule({
      providers: [
        { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } },
        {
          provide: UnitArtworkService,
          useValue: {
            initialize: async () => undefined,
            get: (uuid: string) => artworkRows().get(uuid) ?? null,
            url: () => null,
            set: artworkSave,
          },
        },
        {
          provide: UnitFluffImageService,
          useValue: { resolveEntityCatalogUrl: () => null, loadEntityCatalogUrl: async () => null },
        },
        { provide: LayoutService, useValue: { windowWidth: signal(1440) } },
        StatBarSpecsPipe,
        { provide: UnitSearchIndexService, useValue: searchIndex },
        {
          provide: ConstructionForceService,
          useValue: {
            applySavedConstruction: applyRefit,
            damage: () => null,
            captureOrigins: (member: CBTForceMember, draft: BaseEntity) => matchNativeMounts(member.entity, draft),
            remapOrigins: (before: BaseEntity, after: BaseEntity, origins: ReadonlyMap<string, string>) =>
              new Map(
                [...matchNativeMounts(before, after)].flatMap(([id, previous]) =>
                  origins.has(previous) ? [[id, origins.get(previous)]] : [],
                ),
              ),
          },
        },
        { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
        { provide: Dialog, useValue: { openDialogs: [] } },
        { provide: EquipmentCatalogService, useValue: { getEquipmentRegistry: () => registry } },
        { provide: ForceCustomDesignsService, useValue: { check: async () => true } },
        { provide: CustomUnitSyncService, useValue: { openShared: async () => undefined } },
        { provide: NativeEntityService, useValue: { load: async () => ({ entity: core }) } },
        { provide: DialogsService, useValue: { requestConfirmation: confirm } },
        {
          provide: DataService,
          useValue: { refreshCustomUnits: refresh, getUnitByUuid: () => undefined, searchCorpusVersion },
        },
        { provide: UnitNameService, useValue: { name: (unit: UnitSummary) => unit.name } },
        {
          provide: ForcePersistenceService,
          useValue: {
            openForceList: async () => ({
              loadAll: scanForces,
              getEntries: () => savedForces,
              dispose: () => {},
            }),
          },
        },
        {
          provide: CustomUnitsService,
          useValue: {
            save,
            get: getCustom,
            delete: remove,
            isOwned: () => owned,
            load: async (uuid: typeof coreUuid) => {
              const draft = detach(core);
              draft.uuid.set(uuid);
              return draft;
            },
            parseDraft,
            summaries: signal([]),
            detach,
          },
        },
      ],
    });
    editor = TestBed.runInInjectionContext(() => new UnitConstructionComponent());
  });

  it('opens a core design clean, disables saving and closes without an unsaved-changes prompt', async () => {
    await editor.openUnit({ uuid: coreUuid, origin: 'megamek', name: 'Hunchback HBK-4G' } as UnitSummary);
    expect(editor.entity().model()).toBe('HBK-4G');
    expect(editor.routeUuid()).toBe(coreUuid);
    expect(editor.dirty()).toBeFalse();
    expect(editor.saveLabel()).toBe('SAVE REFIT');
    expect(editor.canSave()).toBeFalse();
    expect(editor.refitReference()).toBeNull();
    await editor.save();
    expect(save).not.toHaveBeenCalled();
    await editor.close();
    expect(confirm).not.toHaveBeenCalled();
    expect(TestBed.inject(DialogRef).close).toHaveBeenCalled();
  });

  it('keeps sprite selection, automatic mode and dismissal in the normal undo and save flow', async () => {
    await editor.openUnit({ uuid: coreUuid, origin: 'megamek', name: 'Hunchback HBK-4G' } as UnitSummary);
    const createDialog = jasmine.createSpy('createDialog').and.returnValue({ closed: of('meks/Atlas.png') });
    Object.assign(TestBed.inject(DialogsService), { createDialog });
    const event = { currentTarget: document.createElement('button') } as unknown as Event;
    await editor.selectIcon(event);
    expect(editor.entity().iconPath()).toBe('meks/Atlas.png');
    expect(editor.dirty()).toBeTrue();
    editor.undo();
    expect(editor.entity().iconPath()).toBe('');
    editor.redo();
    expect(editor.entity().iconPath()).toBe('meks/Atlas.png');
    createDialog.and.returnValue({ closed: of(undefined) });
    await editor.selectIcon(event);
    expect(editor.entity().iconPath()).toBe('meks/Atlas.png');
    await editor.save();
    expect((save.calls.mostRecent().args[0] as BaseEntity).iconPath()).toBe('meks/Atlas.png');
    createDialog.and.returnValue({ closed: of(null) });
    await editor.selectIcon(event);
    expect(editor.entity().iconPath()).toBe('');
    expect(editor.dirty()).toBeTrue();
  });

  it('shows only native refit references and confirms unlinking before changing the draft', async () => {
    await editor.openUnit({ uuid: customUuid, origin: 'user', originalUnitUuid: coreUuid } as UnitSummary);
    expect(editor.refitReference()).toBeNull();
    core.uuid.set(customUuid);
    core.refitFromUUID.set(coreUuid);
    await editor.openUnit({ uuid: customUuid, origin: 'user' } as UnitSummary);
    expect(editor.refitReference()?.uuid).toBe(coreUuid);
    expect(editor.dirty()).toBeFalse();

    confirm.and.resolveTo(false);
    await editor.unlinkRefitSource();
    expect(editor.entity().refitFromUUID()).toBe(coreUuid);
    expect(editor.dirty()).toBeFalse();

    confirm.and.resolveTo(true);
    await editor.unlinkRefitSource();
    expect(confirm).toHaveBeenCalledWith(
      jasmine.stringContaining('There is no option to link it again.'),
      'Unlink source unit',
      'danger',
    );
    expect(editor.refitReference()).toBeNull();
    expect(editor.dirty()).toBeTrue();
    expect(encodeNativeEntity(editor.entity())).not.toContain('refitfromuuid:');
    await editor.save();
    expect(editor.entity().refitFromUUID()).toBeUndefined();
    expect(editor.refitReference()).toBeNull();
    expect(editor.dirty()).toBeFalse();
  });

  it('restores native refit lineage through unlink, undo, redo, and save-as', async () => {
    core.uuid.set(customUuid);
    core.refitFromUUID.set(coreUuid);
    await editor.openUnit({ uuid: customUuid, origin: 'user' } as UnitSummary);
    await editor.unlinkRefitSource();
    expect(editor.originalUuid()).toBeUndefined();
    editor.undo();
    expect(editor.originalUuid()).toBe(coreUuid);
    editor.redo();
    expect(editor.originalUuid()).toBeUndefined();
    editor.undo();
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Restored lineage');
    await editor.save(true);
    expect(save.calls.mostRecent().args[1].originalUnitUuid).toBe(coreUuid);
    expect(editor.entity().refitFromUUID()).toBe(coreUuid);
  });

  it('never displays a self-reference from a native source', async () => {
    core.refitFromUUID.set(coreUuid);
    await editor.openUnit({ uuid: coreUuid, origin: 'megamek' } as UnitSummary);
    expect(editor.refitReference()).toBeNull();
  });

  it('tracks effective changes, including no-op edits, undo, redo and manually restoring the original', async () => {
    await editor.openUnit({ uuid: coreUuid, origin: 'megamek' } as UnitSummary);
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'HBK-4G');
    expect(editor.canUndo()).toBeFalse();
    expect(editor.canSave()).toBeFalse();
    editor.setArmor('RA', 'front', 6);
    expect(editor.canSave()).toBeTrue();
    editor.undo();
    expect(editor.dirty()).toBeFalse();
    editor.redo();
    expect(editor.canSave()).toBeTrue();
    editor.setArmor('RA', 'front', 0);
    expect(editor.dirty()).toBeFalse();
  });

  it('records each Omni/hybrid transition as a single undoable design change', async () => {
    await editor.openUnit({ uuid: coreUuid, origin: 'megamek' } as UnitSummary);
    editor.setDesignEditing(true);
    editor.setField(
      getConstructionFields(editor.entity()).find((field) => field.id === 'omni')!,
      true,
    );
    expect(editor.entity().omni()).toBeTrue();
    editor.setStructure('hybrid');
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
    expect(editor.entity().omni()).toBeFalse();
    expect(editor.hybridStructure()).toBeTrue();
    editor.undo();
    expect(editor.entity().omni()).toBeTrue();
    expect(editor.hybridStructure()).toBeFalse();
    editor.redo();
    expect(editor.entity().omni()).toBeFalse();
    expect(editor.hybridStructure()).toBeTrue();
    editor.setField(
      editor.fields().find((field) => field.id === 'omni')!,
      true,
    );
    expect(editor.entity().omni()).toBeTrue();
    expect(editor.hybridStructure()).toBeFalse();
    editor.undo();
    expect(editor.entity().omni()).toBeFalse();
    expect(editor.hybridStructure()).toBeTrue();
  });

  it('opens a custom design clean and updates its UUID after an entity edit', async () => {
    core.uuid.set(customUuid);
    core.refitFromUUID.set(coreUuid);
    await editor.openUnit({ uuid: customUuid, origin: 'user', originalUnitUuid: coreUuid } as UnitSummary);
    expect(editor.routeUuid()).toBe(customUuid);
    expect(editor.saveLabel()).toBe('CONFIRM');
    expect(editor.canSave()).toBeFalse();
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Revised custom');
    expect(editor.saveLabel()).toBe('UPDATE REFIT');
    await editor.save();
    expect(save.calls.mostRecent().args[1]).toEqual({ uuid: customUuid, originalUnitUuid: coreUuid });
    expect(editor.canSave()).toBeFalse();
  });
  it('keeps a foreign design read-only and discards an unsaved Clone to Own draft', async () => {
    owned = false;
    const summary = { uuid: customUuid, origin: 'user' } as UnitSummary;
    await editor.openUnit(summary);
    expect(editor.routeUuid()).toBe(customUuid);
    const original = encodeNativeEntity(editor.entity());
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Forbidden edit');
    expect(encodeNativeEntity(editor.entity())).toBe(original);
    expect(editor.foreignDesign()).toBeTrue();
    editor.cloneToOwn();
    expect(editor.routeUuid()).toBeUndefined();
    const draftId = editor.entity().uuid();
    expect(draftId).not.toBe(customUuid);
    expect(editor.editDesign()).toBeFalse();
    expect(editor.designEditing()).toBeTrue();
    expect(save).not.toHaveBeenCalled();
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Abandoned copy');
    await editor.close();
    expect(save).not.toHaveBeenCalled();
    await editor.openUnit(summary);
    expect(editor.entity().uuid()).toBe(customUuid);
    expect(editor.foreignDesign()).toBeTrue();
    expect(encodeNativeEntity(editor.entity())).toBe(original);
  });
  it('saves a cloned foreign force design only on Save Refit without enabling Edit design', async () => {
    core.uuid.set(customUuid);
    getCustom.and.resolveTo({ uuid: customUuid, owned: false });
    await editor.openForceMember({
      entity: core,
      force: { readOnly: () => false, getUnitSnapshot: () => null },
    } as unknown as CBTForceMember);
    editor.cloneToOwn();
    const draftId = editor.entity().uuid();
    expect(draftId).not.toBe(customUuid);
    expect(editor.foreignDesign()).toBeFalse();
    expect(editor.editDesign()).toBeFalse();
    expect(editor.designEditing()).toBeFalse();
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Locked change');
    expect(editor.entity().model()).toBe('HBK-4G');
    expect(save).not.toHaveBeenCalled();
    await editor.save();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.calls.first().args[1]).toEqual({ uuid: undefined, newUuid: draftId, originalUnitUuid: customUuid });
    expect(applyRefit).toHaveBeenCalledTimes(1);
  });

  it('opens a core unit as an independent editable design with source lineage', async () => {
    const source = encodeNativeEntity(core);
    await editor.openUnit({ uuid: coreUuid, origin: 'megamek', name: 'Hunchback HBK-4G' } as UnitSummary);
    editor.setField(editor.fields().find(field => field.id === 'chassis')!, 'Workshop Hunchback');
    expect(editor.routeUuid()).toBe(coreUuid);
    expect(encodeNativeEntity(core)).toBe(source);
    expect(editor.savedUuid()).toBeUndefined();
    expect(editor.originalUuid()).toBe(coreUuid);
    expect(editor.dirty()).toBeTrue();
    await editor.save();
    expect(save.calls.mostRecent().args[1]).toEqual(
      jasmine.objectContaining({ uuid: undefined, originalUnitUuid: coreUuid }),
    );
    expect(editor.routeUuid()).toBe(customUuid);
  });

  it('clears the previous route identity when creating or copying an unsaved design', async () => {
    expect(editor.routeUuid()).toBeUndefined();
    await editor.openUnit({ uuid: coreUuid, origin: 'megamek' } as UnitSummary);
    confirm.and.resolveTo(false);
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Unsaved refit');
    await editor.createNew();
    expect(editor.routeUuid()).toBe(coreUuid);
    confirm.and.resolveTo(true);
    await editor.createNew();
    expect(editor.routeUuid()).toBeUndefined();
    await editor.save();
    expect(editor.routeUuid()).toBe(customUuid);
    await editor.openUnit({ uuid: coreUuid, origin: 'megamek' } as UnitSummary, true);
    expect(editor.routeUuid()).toBeUndefined();
  });

  it('lazily previews a detached unsaved design with custom identity instead of the core MUL id', async () => {
    core.mulId.set(1234);
    await editor.openUnit({ uuid: coreUuid, origin: 'megamek', name: 'Hunchback HBK-4G' } as UnitSummary);
    const draftMulId = editor.entity().mulId();
    detach.calls.reset();
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Unsaved preview');
    expect(editor.previewEntity()).toBeNull();
    expect(detach).not.toHaveBeenCalled();
    editor.panel.set('preview');
    const preview = editor.previewEntity()!;
    expect(preview).not.toBe(editor.entity());
    expect(preview).not.toBe(core);
    expect(preview.model()).toBe('Unsaved preview');
    expect(preview.mulId()).toBe(draftMulId);
    expect(editor.entity().mulId()).toBe(draftMulId);
    expect(core.mulId()).toBe(1234);
    expect(editor.designSummary()).toEqual(
      jasmine.objectContaining({
        mul1id: -1,
        origin: 'user',
        isCustom: true,
        canon: false,
      }),
    );
    expect(editor.savedUuid()).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
    preview.chassis.set('Renderer-local change');
    expect(editor.entity().chassis()).toBe('Hunchback');
    expect(core.chassis()).toBe('Hunchback');
  });

  it('refreshes a location-only preview edit with unchanged summary totals, then undo and redo', () => {
    editor.setArmor('RA', 'front', 6);
    editor.panel.set('preview');
    const before = editor.previewEntity()!;
    const summaryBefore = editor.designSummary();
    editor.change(() => {
      editor.entity().setArmorValue('RA', 'front', 0);
      editor.entity().setArmorValue('LA', 'front', 6);
    });
    const moved = editor.previewEntity()!;
    expect(editor.designSummary().armor).toBe(summaryBefore.armor);
    expect(editor.designSummary().as.Arm).toBe(summaryBefore.as.Arm);
    expect(moved).not.toBe(before);
    expect(moved.getArmorValue('RA')).toBe(0);
    expect(moved.getArmorValue('LA')).toBe(6);
    expect(before.getArmorValue('RA')).toBe(6);
    expect(before.getArmorValue('LA')).toBe(0);
    editor.undo();
    const undone = editor.previewEntity()!;
    expect(undone).not.toBe(moved);
    expect(undone.getArmorValue('RA')).toBe(6);
    expect(undone.getArmorValue('LA')).toBe(0);
    editor.redo();
    const redone = editor.previewEntity()!;
    expect(redone).not.toBe(undone);
    expect(redone.getArmorValue('LA')).toBe(6);
    editor.panel.set('loadout');
    expect(editor.previewEntity()).toBeNull();
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'A later edit');
    editor.panel.set('preview');
    expect(editor.previewEntity()!.model()).toBe('A later edit');
  });

  it('does not apply or damage a force instance while previewing and undoing its refit', async () => {
    const runtime = createDirectMekRuntimeFixture();
    core = runtime.entity;
    const face = [...runtime.index.armorFaces.values()].find((candidate) => candidate.maximumPoints >= 5)!;
    const location = runtime.index.locations.get(face.locationId)!;
    expect(
      runtime.instance.dispatch({ type: 'damage-armor', faceId: face.id, amount: 3, target: 'committed' }).changed,
    ).toBeTrue();
    expect(
      runtime.instance.dispatch({ type: 'damage-internal', locationId: location.id, amount: 1, target: 'pending' })
        .changed,
    ).toBeTrue();
    const original = runtime.instance.serialize();
    const native = encodeNativeEntity(core);
    const force = {
      readOnly: () => false,
      getUnitSnapshot: () => ({
        entity: core,
        ruleset: runtime.instance.ruleset(),
        ...runtime.instance.captureRuntime(),
      }),
    } as unknown as CBTForce;
    const member = new CBTForceMember(runtime.instance.instanceId, force, core);
    await editor.openForceMember(member);
    editor.setDesignEditing(true);
    const openedModel = editor.entity().model();
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Preview refit');
    editor.panel.set('preview');
    expect(editor.previewEntity()!.model()).toBe('Preview refit');
    expect(editor.previewEntity()!.getArmorValue(location.code, face.face)).toBe(
      core.getArmorValue(location.code, face.face),
    );
    editor.undo();
    expect(editor.previewEntity()!.model()).toBe(openedModel);
    editor.redo();
    expect(editor.previewEntity()!.model()).toBe('Preview refit');
    expect(runtime.instance.serialize()).toEqual(original);
    expect(encodeNativeEntity(core)).toBe(native);
    expect(editor.forceMember()).toBe(member);
    expect(applyRefit).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('updates live armor bars while keeping custom armor out of the core reference scale', () => {
    searchIndex.commitPreparedCatalogIndexes(
      searchIndex.prepareCatalogIndexes(
        [
          createEmptyUnit({ uuid: coreUuid, armor: 100 }),
          createEmptyUnit({ uuid: customUuid, origin: 'user', isCustom: true, armor: 10000 }),
        ],
        [],
        [],
      ),
    );
    expect(editor.summaryStats().find((stat) => stat.label === 'Armor')?.value).toBe(0);
    editor.setArmor('HD', 'front', 9);
    const armor = editor.summaryStats().find((stat) => stat.label === 'Armor')!;
    expect(armor.value).toBe(9);
    expect(armor.max).toBe(100);
    expect(armor.percent).toBe(9);
    editor.undo();
    expect(editor.summaryStats().find((stat) => stat.label === 'Armor')?.value).toBe(0);
  });

  it('refreshes live bar references when the core catalog finishes loading', () => {
    expect(editor.summaryStats()).toEqual([]);
    searchIndex.commitPreparedCatalogIndexes(
      searchIndex.prepareCatalogIndexes([createEmptyUnit({ uuid: coreUuid, armor: 200 })], [], []),
    );
    searchCorpusVersion.update((version) => version + 1);
    const armor = editor.summaryStats().find((stat) => stat.label === 'Armor')!;
    expect(armor.max).toBe(200);
    expect(armor.value).toBe(0);
  });

  it('applies a core runtime refit through a new custom UUID while leaving the source entity unchanged', async () => {
    const member = {
      entity: core,
      force: { readOnly: () => false, getUnitSnapshot: () => null },
    } as unknown as CBTForceMember;
    const source = encodeNativeEntity(core);
    await editor.openForceMember(member);
    expect(editor.saveLabel()).toBe('CONFIRM');
    expect(editor.canSave()).toBeFalse();
    editor.setDesignEditing(true);
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Field refit');
    expect(editor.saveLabel()).toBe('SAVE NEW REFIT');
    await editor.save();
    expect(save.calls.mostRecent().args[1]).toEqual(
      jasmine.objectContaining({ uuid: undefined, originalUnitUuid: coreUuid }),
    );
    expect(applyRefit).toHaveBeenCalledTimes(1);
    expect(applyRefit.calls.mostRecent().args[0]).toBe(member);
    expect(applyRefit.calls.mostRecent().args[1].uuid).toBe(customUuid);
    expect(encodeNativeEntity(core)).toBe(source);
    expect(editor.dirty()).toBeFalse();
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Next refit');
    expect(editor.saveLabel()).toBe('UPDATE REFIT');
  });

  it('updates the existing custom UUID when refitting its force member', async () => {
    core.uuid.set(customUuid);
    core.refitFromUUID.set(coreUuid);
    getCustom.and.resolveTo({ uuid: customUuid, originalUnitUuid: coreUuid });
    await editor.openForceMember({
      entity: core,
      force: { readOnly: () => false, getUnitSnapshot: () => null },
    } as unknown as CBTForceMember);
    editor.setDesignEditing(true);
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Revised custom');
    await editor.save();
    expect(save.calls.mostRecent().args[1]).toEqual({ uuid: customUuid, originalUnitUuid: coreUuid });
    expect(applyRefit).toHaveBeenCalledTimes(1);
  });

  it('locks all force design mutations until Edit design is enabled and prevents history bypasses', async () => {
    await editor.openForceMember({
      entity: core,
      force: { readOnly: () => false, getUnitSnapshot: () => null },
    } as unknown as CBTForceMember);
    const before = encodeNativeEntity(editor.entity());
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Locked change');
    editor.setArmor('HD', 'front', 9);
    editor.maxArmor();
    editor.stripArmor();
    editor.stripEquipment();
    editor.change(() => editor.entity().chassis.set('Extras bypass'));
    expect(encodeNativeEntity(editor.entity())).toBe(before);
    expect(editor.designEditing()).toBeFalse();
    expect(editor.canUndo()).toBeFalse();
    editor.setDesignEditing(true);
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Authorized refit');
    expect(editor.entity().model()).toBe('Authorized refit');
    editor.setDesignEditing(false);
    expect(editor.canUndo()).toBeFalse();
    editor.undo();
    expect(editor.entity().model()).toBe('Authorized refit');
    editor.setDesignEditing(true);
    editor.undo();
    expect(encodeNativeEntity(editor.entity())).toBe(before);
    editor.setDesignEditing(false);
    expect(editor.canRedo()).toBeFalse();
    editor.redo();
    expect(encodeNativeEntity(editor.entity())).toBe(before);
    await editor.openUnit({ uuid: coreUuid } as UnitSummary);
    expect(editor.designEditing()).toBeTrue();
  });

  it('keeps OEM year changes guarded, undoable and visible after clearing an equal introduction year', async () => {
    await editor.openForceMember({
      entity: core,
      force: { readOnly: () => false, getUnitSnapshot: () => null },
    } as unknown as CBTForceMember);
    editor.setOemYear(3025);
    expect(editor.entity().originalBuildYear()).toBe(-1);
    expect(editor.dirty()).toBeFalse();
    editor.setDesignEditing(true);
    editor.setOemYear(3025);
    expect(editor.entity().originalBuildYear()).toBe(3025);
    const introduction = editor.entity().year();
    editor.setField(
      editor.fields().find((field) => field.id === 'year')!,
      3025,
    );
    expect(editor.entity().originalBuildYear()).toBe(-1);
    expect(editor.oemYearVisible()).toBeTrue();
    expect(editor.oemYearField().get()).toBe('');
    editor.undo();
    expect(editor.entity().year()).toBe(introduction);
    expect(editor.entity().originalBuildYear()).toBe(3025);
    editor.undo();
    expect(editor.entity().originalBuildYear()).toBe(-1);
    editor.redo();
    expect(editor.entity().originalBuildYear()).toBe(3025);
    editor.setField(
      editor.fields().find((field) => field.id === 'year')!,
      3024,
    );
    expect(TestBed.inject(ToastService).showToast).toHaveBeenCalledOnceWith(
      'Introduction year cannot be earlier than the OEM year.',
      'error',
    );
    expect(editor.entity().year()).toBe(introduction);
    expect(editor.entity().originalBuildYear()).toBe(3025);
  });

  it('offers only pod reconfiguration on a fully repaired force Omni and preserves its fixed design', async () => {
    const runtime = createDirectMekRuntimeFixture();
    core = runtime.entity;
    core.omni.set(true);
    const force = {
      readOnly: () => false,
      getUnitSnapshot: () => ({
        entity: core,
        ruleset: runtime.instance.ruleset(),
        ...runtime.instance.captureRuntime(),
      }),
    } as unknown as CBTForce;
    await editor.openForceMember(new CBTForceMember(runtime.instance.instanceId, force, core));
    expect(editor.designEditing()).toBeFalse();
    expect(editor.reconfiguring()).toBeTrue();
    const fixed = editor
      .entity()
      .equipment()
      .find((mount) => mount.equipment && !mount.omniPodMounted)!;
    const before = encodeNativeEntity(editor.entity());
    expect(editor.canEditMount(fixed)).toBeFalse();
    editor.remove(fixed);
    editor.updateMount(fixed, { omniPodMounted: true });
    editor.setArmor('HD', 'front', 0);
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Unauthorized base change');
    expect(encodeNativeEntity(editor.entity())).toBe(before);
    const actuator = editor.fields().find((field) => field.id === 'leftHand')!;
    editor.setField(actuator, !actuator.get());
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
    expect(editor.pendingOmniReconfiguration()).toBeTrue();
    editor.setDesignEditing(true);
    expect(editor.pendingOmniReconfiguration()).toBeTrue();
    editor.undo();
    expect(editor.pendingOmniReconfiguration()).toBeFalse();
  });

  it('keeps a failed force apply dirty and retries the same saved custom UUID', async () => {
    await editor.openForceMember({
      entity: core,
      force: { readOnly: () => false, getUnitSnapshot: () => null },
    } as unknown as CBTForceMember);
    editor.setDesignEditing(true);
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Refit awaiting apply');
    applyRefit.and.rejectWith(new Error('Force update failed'));
    await editor.save();
    expect(editor.dirty()).toBeTrue();
    expect(editor.savedUuid()).toBe(customUuid);
    expect(TestBed.inject(ToastService).showToast).toHaveBeenCalledOnceWith(
      'Design saved locally. Force refit failed: Force update failed',
      'error',
    );
    applyRefit.and.callFake(async (member) => member);
    await editor.save();
    expect(save.calls.mostRecent().args[1].uuid).toBe(customUuid);
    expect(editor.dirty()).toBeFalse();
  });

  it('retains the first saved design as lineage across successive save-as copies', async () => {
    await editor.save();
    save.and.callFake(async (_entity, options) => ({ uuid: copyUuid, originalUnitUuid: options.originalUnitUuid }));
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'First copy');
    await editor.save(true);
    expect(editor.originalUuid()).toBe(customUuid);
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Second copy');
    await editor.save(true);
    expect(save.calls.mostRecent().args[1].originalUnitUuid).toBe(customUuid);
  });

  it('saves a custom force refit as new and switches to the new UUID without overwriting the original', async () => {
    core.uuid.set(customUuid);
    core.refitFromUUID.set(coreUuid);
    getCustom.and.resolveTo({ uuid: customUuid, originalUnitUuid: coreUuid });
    await editor.openForceMember({
      entity: core,
      force: { readOnly: () => false, getUnitSnapshot: () => null },
    } as unknown as CBTForceMember);
    editor.setDesignEditing(true);
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Separate variant');
    save.and.callFake(async (_entity, options) => ({ uuid: copyUuid, originalUnitUuid: options.originalUnitUuid }));
    await editor.save(true);
    expect(save.calls.mostRecent().args[1]).toEqual(
      jasmine.objectContaining({ uuid: undefined, originalUnitUuid: coreUuid }),
    );
    expect(applyRefit.calls.mostRecent().args[1].uuid).toBe(copyUuid);
    expect(editor.savedUuid()).toBe(copyUuid);
    expect(editor.routeUuid()).toBe(copyUuid);
    expect(core.uuid()).toBe(customUuid);
  });

  it('confirms library deletion while explaining that saved force copies are retained', async () => {
    core.uuid.set(customUuid);
    getCustom.and.resolveTo({ uuid: customUuid });
    await editor.openForceMember({
      entity: core,
      force: { readOnly: () => false, getUnitSnapshot: () => null },
    } as unknown as CBTForceMember);
    savedForces = [{ name: 'Copper Lance', groups: [{ units: [{ unit: { uuid: customUuid } }] }] }];
    confirm.and.resolveTo(false);
    await editor.deleteSaved();
    expect(scanForces).not.toHaveBeenCalled();
    expect(confirm.calls.mostRecent().args[0]).toContain('Copies included in saved forces are kept.');
    expect(confirm.calls.mostRecent().args[0]).not.toContain('missing-unit');
    expect(remove).not.toHaveBeenCalled();
    confirm.and.resolveTo(true);
    await editor.deleteSaved();
    expect(remove).toHaveBeenCalledOnceWith(customUuid);
    expect(editor.savedUuid()).toBeUndefined();
    expect(editor.saveLabel()).toBe('SAVE NEW REFIT');
    expect(editor.routeUuid()).toBeUndefined();
  });

  it('can delete from the library even when the saved force list is unavailable', async () => {
    getCustom.and.resolveTo({ uuid: customUuid });
    await editor.openUnit({ uuid: customUuid, origin: 'user' } as UnitSummary);
    scanForces.and.rejectWith(new Error('Could not check saved forces'));
    await editor.deleteSaved();
    expect(scanForces).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnceWith(customUuid);
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
  });

  it('stages repairs, supports undo and saves only runtime facts for a core unit', async () => {
    const fixture = createDirectMekRuntimeFixture();
    TestBed.inject(ConstructionForceService).damage = ConstructionForceService.prototype.damage;
    core = fixture.entity;
    let runtime: CBTUnit = fixture.instance;
    const face = [...fixture.index.armorFaces.values()].find((face) => face.maximumPoints >= 5)!;
    runtime.dispatch({ type: 'damage-armor', faceId: face.id, amount: 3, target: 'committed' });
    runtime.dispatch({ type: 'damage-internal', locationId: face.locationId, amount: 1, target: 'pending' });
    const location = fixture.index.locations.get(face.locationId)!;
    const damagedBV = runtime.query().currentBaseBattleValue();
    const before = runtime.serialize();
    const getUnitSnapshot = (): CBTUnitSnapshot => ({
      entity: core,
      ruleset: runtime.ruleset(),
      ...runtime.captureRuntime(),
      instanceId: runtime.instanceId,
      uuid: runtime.uuid,
      crewAssignment: runtime.getCrewAssignment(),
      editContext: { owner: runtime, state: runtime.snapshot() },
    });
    const applyRuntime = jasmine
      .createSpy('applyConstruction')
      .and.callFake(async (member, _refit, changes: ConstructionRuntimeChanges) => {
        runtime = await prepareConstructionRuntime(runtime, changes.commands, {
          id: 'megamek',
          ruleset: runtime.ruleset(),
        });
        return member;
      });
    const force = {
      readOnly: () => false,
      getUnitSnapshot,
      getMekRecordSheetSnapshot: () => null,
      applyConstruction: applyRuntime,
      previewConstructionRuntime: async (_member: CBTForceMember, changes: ConstructionRuntimeChanges) => {
        const candidate = await prepareConstructionRuntime(runtime, changes.commands, {
          id: 'megamek',
          ruleset: runtime.ruleset(),
        });
        return {
          changes,
          snapshot: { ...getUnitSnapshot(), ...candidate.captureRuntime() },
          changed: constructionRuntimeSource(candidate) !== constructionRuntimeSource(runtime),
        };
      },
    } as unknown as CBTForce;
    await editor.openForceMember(new CBTForceMember(runtime.instanceId, force, core));
    expect(editor.effectiveBV()).toBe(damagedBV);
    expect(editor.pendingRepairQuote()).toBeNull();
    await editor.repairAll();
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
    expect(editor.designChanged()).toBeFalse();
    expect(editor.runtimeChanged()).toBeTrue();
    expect(editor.saveLabel()).toBe('SAVE');
    expect(runtime.serialize()).toEqual(before);
    expect(editor.effectiveBV()).toBe(editor.unitBV());
    expect(editor.repairBVDelta()).toBe(editor.unitBV()! - damagedBV!);
    expect(editor.pendingSupportPoints()?.cost).toBe(core.tonnage() * 2);
    expect(editor.pendingRepairQuote()?.cost).toBe(Math.round(core.cost() * 0.2));
    expect(editor.armorRepair(location.code, face.face)).toBe(3);
    expect(editor.internalRepair(location.code, location.internalPoints)).toBe(1);
    editor.undo();
    expect(editor.canSave()).toBeFalse();
    expect(editor.pendingRepairQuote()).toBeNull();
    expect(editor.armorRepair(location.code, face.face)).toBe(0);
    expect(editor.internalRepair(location.code, location.internalPoints)).toBe(0);
    expect(editor.effectiveBV()).toBe(damagedBV);
    editor.redo();
    expect(editor.runtimeChanged()).toBeTrue();
    await editor.save();
    expect(save).not.toHaveBeenCalled();
    expect(applyRefit).not.toHaveBeenCalled();
    expect(applyRuntime).toHaveBeenCalledTimes(1);
    expect(runtime.query().remainingArmor(face.id)).toBe(face.maximumPoints);
    expect(editor.savedUuid()).toBeUndefined();
    expect(editor.dirty()).toBeFalse();
  });

  it('retries the same durable UUID after search publication fails', async () => {
    refresh.and.rejectWith(new Error('Search publication failed'));
    await editor.save();
    expect(TestBed.inject(ToastService).showToast).toHaveBeenCalledOnceWith(
      'Design saved locally. Search update failed: Search publication failed',
      'error',
    );
    expect(editor.savedUuid()).toBe(customUuid);
    expect(editor.routeUuid()).toBe(customUuid);
    refresh.and.resolveTo();
    await editor.save();
    expect(save.calls.mostRecent().args[1].uuid).toBe(customUuid);
    expect(TestBed.inject(ToastService).showToast).toHaveBeenCalledTimes(1);
  });

  it('rolls back failed edits and keeps the previous undo history usable', () => {
    const initial = editor.entity().chassis();
    editor.setField(editor.fields().find(field => field.id === 'chassis')!, 'Changed design');
    editor.change(() => {
      editor.entity().chassis.set('Partial edit');
      throw new Error('Invalid placement');
    });
    expect(editor.entity().chassis()).toBe('Changed design');
    expect(TestBed.inject(ToastService).showToast).toHaveBeenCalledOnceWith('Invalid placement', 'error');
    expect(editor.status()).toBe('');
    editor.undo();
    expect(editor.entity().chassis()).toBe(initial);
    editor.redo();
    expect(editor.entity().chassis()).toBe('Changed design');
  });

  it('round-trips authored Hybrid donor provenance through undo and redo', () => {
    editor.setStructure('hybrid');
    editor.setDonor('RA', 'name', ' Shadow Hawk ');
    editor.setDonor('RA', 'unitType', 'BattleMek');
    expect((editor.entity() as MekEntity).structureDonorAt('RA')).toEqual({
      name: 'Shadow Hawk',
      unitType: 'BattleMek',
    });
    editor.undo();
    expect(editor.donorAt('RA')?.name).toBe('Shadow Hawk');
    expect(editor.donorAt('RA')?.unitType).toBeNull();
    editor.redo();
    expect(editor.donorAt('RA')?.unitType).toBe('BattleMek');
    editor.setStructure(editor.structureAt('CT'));
    expect(editor.donorAt('RA')).toBeNull();
  });

  it('preserves changes when leaving is canceled and blocks undo during a save', async () => {
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Unsaved');
    confirm.and.resolveTo(false);
    expect(await editor.canLeave()).toBeFalse();
    expect(editor.dirty()).toBeTrue();
    editor.busy.set(true);
    editor.undo();
    expect(editor.entity().model()).toBe('Unsaved');
    expect(await editor.canLeave()).toBeFalse();
  });

  it('locks the active document while a native import is being read', async () => {
    await editor.openUnit({ uuid: coreUuid, origin: 'megamek' } as UnitSummary);
    let finish!: (source: string) => void;
    const reading = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const input = { files: [{ name: 'import.mtf', size: 100, text: () => reading }], value: 'import.mtf' };
    const importing = editor.importFile({ target: input } as unknown as Event);
    await Promise.resolve();
    expect(editor.busy()).toBeTrue();
    await editor.save();
    expect(save).not.toHaveBeenCalled();
    finish(encodeNativeEntity(core));
    await importing;
    expect(editor.entity().chassis()).toBe('Hunchback');
    expect(editor.savedUuid()).toBeUndefined();
    expect(editor.busy()).toBeFalse();
    expect(editor.routeUuid()).toBeUndefined();
  });

  it('maximizes the shared suit armor once rather than treating the squad as an extra trooper', () => {
    editor.entity.set(createConstructionEntity('BattleArmor', registry));
    editor.maxArmor();
    expect(editor.entity().totalArmorPoints()).toBe(editor.entity().maximumArmorPoints());
    editor.undo();
    expect(editor.entity().totalArmorPoints()).toBe(0);
  });

  for (const origin of ['megamek', 'user'] as const) {
    it(`saves only local artwork for a ${origin} design without creating a refit or syncing`, async () => {
      owned = false;
      await editor.openUnit({ uuid: coreUuid, origin } as UnitSummary);
      const source = encodeNativeEntity(editor.entity());
      const image = new Blob(['png'], { type: 'image/png' });
      editor.changeArtwork(image);
      expect(editor.designChanged()).toBeFalse();
      expect(editor.dirty()).toBeTrue();
      expect(editor.saveLabel()).toBe('SAVE');
      expect(editor.canSave()).toBeTrue();
      editor.undo();
      expect(editor.dirty()).toBeFalse();
      editor.redo();
      expect(editor.effectiveArtwork()?.fluff).toBe(image);
      await editor.save();
      expect(artworkSave).toHaveBeenCalledOnceWith(coreUuid, { fluff: image });
      expect(save).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(applyRefit).not.toHaveBeenCalled();
      expect(editor.dirty()).toBeFalse();
      expect(encodeNativeEntity(editor.entity())).toBe(source);
    });
  }
  it('discards image edits without changing storage and copies artwork to a newly saved UUID', async () => {
    const original = new Blob(['first'], { type: 'image/png' });
    artworkRows.set(new Map([[coreUuid, { fluff: original }]]));
    await editor.openUnit({ uuid: coreUuid, origin: 'megamek' } as UnitSummary);
    editor.changeArtwork(new Blob(['other'], { type: 'image/png' }));
    await editor.openUnit({ uuid: coreUuid, origin: 'megamek' } as UnitSummary);
    expect(artworkSave).not.toHaveBeenCalled();
    expect(editor.effectiveArtwork()?.fluff).toBe(original);
    editor.setField(editor.fields().find(field => field.id === 'model')!, 'Refit');
    await editor.save();
    expect(artworkSave).toHaveBeenCalledOnceWith(customUuid, { fluff: original });
    expect(artworkRows().get(coreUuid)?.fluff).toBe(original);
  });
  for (const kind of ['Biped', 'Tank'] as const) {
    it(`extracts a ${kind} import above 256 KB and embeds artwork only in its downloaded export`, async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const png = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!)));
      const imported = createConstructionEntity(kind, registry);
      imported.fluffImageEncoded.set((await encodeUnitImage(png)) + ' '.repeat(270 * 1024));
      const source = encodeNativeEntity(imported);
      const extension = kind === 'Biped' ? 'mtf' : 'blk';
      await editor.importFile({
        target: { files: [new File([source], `unit.${extension}`)], value: '' },
      } as unknown as Event);
      expect(editor.entity().entityType).toBe(imported.entityType);
      expect(editor.effectiveArtwork()?.fluff?.type).toBe('image/png');
      expect(editor.entity().fluffImageEncoded()).toBe('');
      expect(artworkSave).not.toHaveBeenCalled();
      const clean = encodeNativeEntity(editor.entity());
      let exported!: Blob;
      spyOn(URL, 'createObjectURL').and.callFake((blob) => {
        exported = blob as Blob;
        return 'blob:unit-export';
      });
      spyOn(HTMLAnchorElement.prototype, 'click');
      await editor.exportDesign();
      const parsed = parseEntity(await exported.text(), `download.${extension}`, registry).entity;
      expect(parsed.fluffImageEncoded()).not.toBe('');
      expect(encodeNativeEntity(editor.entity())).toBe(clean);
      expect(artworkSave).not.toHaveBeenCalled();
      await editor.save();
      expect(artworkSave.calls.mostRecent().args[0]).toBe(customUuid);
      expect(save.calls.mostRecent().args[0].fluffImageEncoded()).toBe('');
    });
  }
  it('applies the cleaned-source size limit after extraction and preserves the active document on rejection', async () => {
    const source = encodeNativeEntity(core) + `\nnotes:${'x'.repeat(260 * 1024)}\nfluffimage:bad\n`;
    const before = editor.entity();
    await editor.importFile({
      target: { files: [new File([source], 'oversized.mtf')], value: '' },
    } as unknown as Event);
    expect(editor.entity()).toBe(before);
    expect(TestBed.inject(ToastService).showToast).toHaveBeenCalledOnceWith(
      jasmine.stringContaining('without images'),
      'error',
    );
    expect(artworkSave).not.toHaveBeenCalled();
  });
  it('undoes and redoes footprint and floor edits through native history', () => {
    editor.entity.set(createConstructionEntity('BuildingEntity', registry));
    editor.change(() =>
      setConstructionBuildingTopology(
        editor.entity() as StaticEmplacementEntity,
        [
          { q: 0, r: 0 },
          { q: 1, r: 0 },
        ],
        3,
      ),
    );
    expect(editor.entity().locationOrder.length).toBe(6);
    editor.undo();
    expect(editor.entity().locationOrder.length).toBe(1);
    editor.redo();
    expect(editor.entity().locationOrder.length).toBe(6);
    expect((editor.entity() as StaticEmplacementEntity).coordinates()).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ]);
  });
  it('undo restores equipment removed with a building floor without keeping an unallocated copy', () => {
    const entity = createConstructionEntity('BuildingEntity', registry) as StaticEmplacementEntity;
    setConstructionBuildingTopology(entity, [{ q: 0, r: 0 }], 2);
    entity.addEquipment({
      equipmentId: 'Building test equipment',
      allocation: { kind: 'location', location: 'Level 1 0.0,0.0,0.0' },
      rearMounted: false,
      turretMounted: false,
      omniPodMounted: false,
      armored: false,
    });
    editor.entity.set(entity);
    editor.change(() => setConstructionBuildingTopology(entity, entity.coordinates(), 1));
    expect(editor.entity().equipment()).toEqual([]);
    editor.undo();
    expect(
      editor
        .entity()
        .equipment()
        .map((mount) => mount.location),
    ).toEqual(['Level 1 0.0,0.0,0.0']);
    expect(editor.unallocated()).toEqual([]);
    editor.redo();
    expect(editor.entity().equipment()).toEqual([]);
  });
  it('allows sizing building generators even though the native catalog marks them spreadable', () => {
    editor.entity.set(createConstructionEntity('BuildingEntity', registry));
    const generator = new MiscEquipment({
      id: 'FUSION PowerGenerator',
      name: 'Fusion generator',
      type: 'misc',
      flags: ['F_POWER_GENERATOR'],
      stats: { tonnage: 'variable', spreadable: true },
    });
    expect(editor.hasEditableSize(generator)).toBeTrue();
  });
  it('keeps uninstalled building equipment in the temporary tray with undo and redo', () => {
    const entity = createConstructionEntity('BuildingEntity', registry) as StaticEmplacementEntity;
    const mount = entity.addEquipment({
      equipmentId: 'Building test equipment',
      allocation: { kind: 'location', location: entity.locationOrder[0] },
      rearMounted: false,
      turretMounted: false,
      omniPodMounted: false,
      armored: false,
    });
    editor.entity.set(entity);
    editor.uninstall(mount);
    expect(
      editor
        .entity()
        .equipment()
        .map((item) => item.mountId),
    ).toEqual([mount.mountId]);
    expect(editor.unallocated().map((item) => item.mountId)).toEqual([mount.mountId]);
    expect(editor.unallocated()[0].allocation.kind).toBe('unallocated');
    expect(encodeNativeEntity(editor.entity())).not.toContain('Building test equipment');
    editor.undo();
    expect(
      editor
        .entity()
        .equipment()
        .map((item) => item.location),
    ).toEqual([entity.locationOrder[0]]);
    expect(editor.unallocated()).toEqual([]);
    editor.redo();
    expect(editor.unallocated().map((item) => item.mountId)).toEqual([mount.mountId]);
    editor.change(() =>
      setConstructionBuildingTopology(
        editor.building()!,
        [
          { q: 0, r: 0 },
          { q: 1, r: 0 },
        ],
        2,
      ),
    );
    expect(editor.unallocated().map((item) => item.mountId)).toEqual([mount.mountId]);
    editor.undo();
    expect(editor.unallocated().map((item) => item.mountId)).toEqual([mount.mountId]);
  });
  it('clears the optional MUL field through the editor binding', () => {
    const field = editor.fields().find((field) => field.id === 'mulId')!;
    editor.setField(field, 42);
    expect(editor.entity().mulId()).toBe(42);
    editor.setField(field, null);
    expect(editor.entity().mulId()).toBeNull();
    editor.setField(field, 0);
    expect(editor.entity().mulId()).toBeNull();
  });
});
