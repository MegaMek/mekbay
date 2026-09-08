// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { UnitConstructionComponent } from './unit-construction.component';
import { createConstructionEntity } from './domain';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { BaseEntity } from '../models/entity/base-entity';
import { parseEntity } from '../models/entity/parse-entity';
import { encodeNativeEntity } from '../models/entity/write-entity';
import { EquipmentCatalogService } from '../services/catalogs/equipment-catalog.service';
import { CustomUnitsService } from '../services/custom-units.service';
import { DataService } from '../services/data.service';
import { DialogsService } from '../services/dialogs.service';
import { NativeEntityService } from '../services/native-entity.service';
import { UnitNameService } from '../services/unit-name.service';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';
import type { UnitSummary } from '../models/unit-summary.model';

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

    beforeEach(() => {
        core = createConstructionEntity('Biped', registry);
        core.uuid.set(coreUuid);
        core.chassis.set('Hunchback');
        core.model.set('HBK-4G');
        save = jasmine.createSpy('save').and.callFake(async (_entity, options) => ({
            uuid: options.uuid ?? customUuid, originalUnitUuid: options.originalUnitUuid,
        }));
        refresh = jasmine.createSpy('refresh').and.resolveTo();
        confirm = jasmine.createSpy('confirm').and.resolveTo(true);
        const parseDraft = (source: string, format: string) => parseEntity(source, `draft.${format}`, registry).entity;
        TestBed.configureTestingModule({ providers: [
            { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
            { provide: Dialog, useValue: { openDialogs: [] } },
            { provide: EquipmentCatalogService, useValue: { getEquipmentRegistry: () => registry } },
            { provide: NativeEntityService, useValue: { load: async () => ({ entity: core }) } },
            { provide: DialogsService, useValue: { requestConfirmation: confirm } },
            { provide: DataService, useValue: { refreshCustomUnits: refresh, getUnitByUuid: () => undefined, searchCorpusVersion: signal(0) } },
            { provide: UnitNameService, useValue: { name: (unit: UnitSummary) => unit.name } },
            { provide: CustomUnitsService, useValue: { save, parseDraft, summaries: signal([]),
                detach: (entity: BaseEntity) => parseDraft(encodeNativeEntity(entity), 'mtf') } },
        ] });
        editor = TestBed.runInInjectionContext(() => new UnitConstructionComponent());
    });

    it('opens a core unit as an independent editable design with source lineage', async () => {
        const source = encodeNativeEntity(core);
        await editor.openUnit({ uuid: coreUuid, origin: 'megamek', name: 'Hunchback HBK-4G' } as UnitSummary);
        editor.setIdentity('chassis', 'Workshop Hunchback');
        expect(encodeNativeEntity(core)).toBe(source);
        expect(editor.savedUuid()).toBeUndefined();
        expect(editor.originalUuid()).toBe(coreUuid);
        expect(editor.dirty()).toBeTrue();
        await editor.save();
        expect(save.calls.mostRecent().args[1]).toEqual({ uuid: undefined, originalUnitUuid: coreUuid });
    });

    it('retains the first saved design as lineage across successive save-as copies', async () => {
        await editor.save();
        save.and.callFake(async (_entity, options) => ({ uuid: copyUuid, originalUnitUuid: options.originalUnitUuid }));
        await editor.save(true);
        expect(editor.originalUuid()).toBe(customUuid);
        await editor.save(true);
        expect(save.calls.mostRecent().args[1].originalUnitUuid).toBe(customUuid);
    });

    it('retries the same durable UUID after search publication fails', async () => {
        refresh.and.rejectWith(new Error('Search publication failed'));
        await editor.save();
        expect(editor.statusError()).toBeTrue();
        expect(editor.savedUuid()).toBe(customUuid);
        refresh.and.resolveTo();
        await editor.save();
        expect(save.calls.mostRecent().args[1].uuid).toBe(customUuid);
        expect(editor.statusError()).toBeFalse();
    });

    it('rolls back failed edits and keeps the previous undo history usable', () => {
        const initial = editor.entity().chassis();
        editor.setIdentity('chassis', 'Changed design');
        editor.change(() => { editor.entity().chassis.set('Partial edit'); throw new Error('Invalid placement'); });
        expect(editor.entity().chassis()).toBe('Changed design');
        expect(editor.status()).toBe('Invalid placement');
        editor.undo();
        expect(editor.entity().chassis()).toBe(initial);
        editor.redo();
        expect(editor.entity().chassis()).toBe('Changed design');
    });

    it('preserves changes when leaving is canceled and blocks undo during a save', async () => {
        editor.setIdentity('model', 'Unsaved');
        confirm.and.resolveTo(false);
        expect(await editor.canLeave()).toBeFalse();
        expect(editor.dirty()).toBeTrue();
        editor.busy.set(true);
        editor.undo();
        expect(editor.entity().model()).toBe('Unsaved');
        expect(await editor.canLeave()).toBeFalse();
    });

    it('locks the active document while a native import is being read', async () => {
        let finish!: (source: string) => void;
        const reading = new Promise<string>(resolve => { finish = resolve; });
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
    });

    it('maximizes the shared suit armor once rather than treating the squad as an extra trooper', () => {
        editor.entity.set(createConstructionEntity('BattleArmor', registry));
        editor.maxArmor();
        expect(editor.entity().totalArmorPoints()).toBe(editor.entity().maximumArmorPoints());
        editor.undo();
        expect(editor.entity().totalArmorPoints()).toBe(0);
    });
});
