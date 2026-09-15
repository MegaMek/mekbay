// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { By } from '@angular/platform-browser';
import { UnitConstructionComponent } from './unit-construction.component';
import { ConstructionForceService } from './construction-force.service';
import { ConstructionQuirksComponent } from './components/construction-quirks.component';
import { ConstructionFluffComponent } from './components/construction-fluff.component';
import { ConstructionTopologyComponent } from './components/construction-topology.component';
import { createConstructionEntity } from './domain/construction-factory';
import { setConstructionBuildingTopology } from './domain/construction-building-topology';
import { InfantryEntity, StaticEmplacementEntity } from '../models/entity/entities';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../models/entity/testing/test-mounted-equipment';
import { WeaponEquipment } from '../models/equipment.model';
import { parseEntity } from '../models/entity/parse-entity';
import { EquipmentCatalogService } from '../services/catalogs/equipment-catalog.service';
import { QuirksCatalogService } from '../services/catalogs/quirks-catalog.service';
import { UnitFluffImageService } from '../services/catalogs/unit-fluff-image.service';
import { CustomUnitsService } from '../services/custom-units.service';
import { DataService } from '../services/data.service';
import { DialogsService } from '../services/dialogs.service';
import { LayoutService } from '../services/layout.service';
import { NativeEntityService } from '../services/native-entity.service';
import { UnitArtworkService } from '../services/unit-artwork.service';
import { UnitNameService } from '../services/unit-name.service';
import { formatUnitChassis } from '../utils/unit-display-name.util';
import { UnitSearchIndexService } from '../services/unit-search-index.service';
import type { UnitSummary } from '../models/unit-summary.model';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';

describe('construction panel DOM events', () => {
  const laser = new WeaponEquipment({
    id: 'Event test laser',
    name: 'Event test laser',
    type: 'weapon',
    flags: ['F_MEK_WEAPON', 'F_ENERGY', 'F_LASER'],
    stats: { tonnage: 1, criticalSlots: 1 },
    weapon: { heat: 3, damage: 5, ammoType: 'NA' },
  });
  const registry = createTestEquipmentRegistry({ [laser.id]: laser });
  let fixture: ComponentFixture<UnitConstructionComponent>;
  let editor: UnitConstructionComponent;
  let change: jasmine.Spy;
  let confirm: jasmine.Spy;
  const root = () => fixture.nativeElement as HTMLElement;
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    confirm = jasmine.createSpy('confirm').and.resolveTo(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
        { provide: Dialog, useValue: { openDialogs: [] } },
        { provide: LayoutService, useValue: { windowWidth: signal(1440) } },
        { provide: EquipmentCatalogService, useValue: { getEquipmentRegistry: () => registry } },
        {
          provide: QuirksCatalogService,
          useValue: { getQuirksByKey: () => new Map(), getQuirkByKey: () => undefined },
        },
        {
          provide: CustomUnitsService,
          useValue: {
            summaries: signal([]),
            parseDraft: (source: string, format: string) => parseEntity(source, `draft.${format}`, registry).entity,
          },
        },
        { provide: DataService, useValue: { getUnitByUuid: () => undefined, searchCorpusVersion: signal(0) } },
        { provide: DialogsService, useValue: { requestConfirmation: confirm } },
        { provide: NativeEntityService, useValue: {} },
        { provide: UnitNameService, useValue: { chassis: formatUnitChassis, name: (unit: UnitSummary) => unit.name } },
        { provide: UnitSearchIndexService, useValue: new UnitSearchIndexService() },
        { provide: UnitArtworkService, useValue: { get: () => null, url: () => null } },
        {
          provide: UnitFluffImageService,
          useValue: { resolveEntityCatalogUrl: () => null, loadEntityCatalogUrl: async () => null },
        },
        { provide: ConstructionForceService, useValue: { damage: () => null } },
      ],
    });
    fixture = TestBed.createComponent(UnitConstructionComponent);
    editor = fixture.componentInstance;
    change = spyOn(editor, 'change').and.callThrough();
  });

  it('shows a native source in the summary and Chassis panel, and unlinks it through the X button', async () => {
    editor.panel.set('systems');
    await render();
    expect(root().querySelector('.provenance')).toBeNull();
    expect(root().querySelector('.refit-source')).toBeNull();
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-000000000001');
    spyOn(TestBed.inject(DataService), 'getUnitByUuid').and.returnValue({
      uuid,
      name: 'Source Hunchback',
    } as UnitSummary);
    editor.entity().refitFromUUID.set(uuid);
    await render();
    expect(root().querySelector('.provenance')?.textContent).toContain('Based on Source Hunchback');
    const reference = root().querySelector('.refit-source')!;
    expect(reference.closest('section')?.querySelector('h2')?.textContent).toBe('Chassis');
    expect(reference.textContent).toContain('Based on Source Hunchback');
    confirm.and.resolveTo(false);
    reference.querySelector<HTMLButtonElement>('button')!.click();
    await render();
    expect(editor.entity().refitFromUUID()).toBe(uuid);
    expect(change).not.toHaveBeenCalled();
    confirm.and.resolveTo(true);
    reference.querySelector<HTMLButtonElement>('button')!.click();
    await render();
    expect(change).toHaveBeenCalledTimes(1);
    expect(editor.entity().refitFromUUID()).toBeUndefined();
    expect(root().querySelector('.provenance')).toBeNull();
    expect(root().querySelector('.refit-source')).toBeNull();
  });

  it('selects the second weapon without editing the design, then assigns its quirk through one undoable action', async () => {
    const entity = editor.entity();
    addTestEquipment(entity, laser, {
      allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 0 }] },
    });
    const second = addTestEquipment(entity, laser, {
      allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 0 }] },
    });
    editor.panel.set('quirks');
    await render();
    const select = root().querySelector<HTMLSelectElement>('[aria-label="Weapon for quirks"]')!;
    select.value = second.mountId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await render();
    const quirks = fixture.debugElement.query(By.directive(ConstructionQuirksComponent))
      .componentInstance as ConstructionQuirksComponent;
    expect(quirks.selectedTarget()?.id).toBe(second.mountId);
    expect(editor.entity()).toBe(entity);
    expect(editor.status()).toBe('');
    expect(editor.canUndo()).toBeFalse();
    expect(change).not.toHaveBeenCalled();

    [...root().querySelectorAll<HTMLButtonElement>('.quirk-option')]
      .find((button) => button.textContent!.trim().endsWith('Accurate Weapon'))!
      .click();
    await render();
    expect(change).toHaveBeenCalledTimes(1);
    expect(editor.entity().weaponQuirks()).toEqual([
      { name: 'accurate', weaponName: laser.id, location: 'RT', slot: 0 },
    ]);
    editor.undo();
    await render();
    expect(editor.entity().weaponQuirks()).toEqual([]);
    expect(editor.canUndo()).toBeFalse();
    editor.redo();
    await render();
    expect(editor.entity().weaponQuirks()[0]?.location).toBe('RT');
  });

  it('commits fluff text once when input is followed by the native change event', async () => {
    editor.panel.set('fluff');
    await render();
    const entity = editor.entity(),
      before = entity.fluff().overview;
    const textarea = root().querySelector<HTMLTextAreaElement>('construction-fluff textarea')!;
    textarea.value = 'Updated overview';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    await render();
    expect(change).toHaveBeenCalledTimes(1);
    expect(editor.entity()).toBe(entity);
    expect(editor.entity().fluff().overview).toBe('Updated overview');
    expect(editor.status()).toBe('');
    editor.undo();
    await render();
    expect(editor.entity().fluff().overview).toBe(before);
    expect(editor.canUndo()).toBeFalse();
    editor.redo();
    await render();
    expect(editor.entity().fluff().overview).toBe('Updated overview');
  });

  it('delivers file input changes to the image handler without creating a design edit', async () => {
    editor.panel.set('fluff');
    await render();
    const fluff = fixture.debugElement.query(By.directive(ConstructionFluffComponent))
      .componentInstance as ConstructionFluffComponent;
    const chooseImage = spyOn(fluff, 'chooseImage').and.resolveTo();
    const event = new Event('change', { bubbles: true });
    root().querySelector<HTMLInputElement>('construction-fluff input[type="file"]')!.dispatchEvent(event);
    await render();
    expect(chooseImage).toHaveBeenCalledOnceWith(event);
    expect(change).not.toHaveBeenCalled();
    expect(editor.status()).toBe('');
    expect(editor.canUndo()).toBeFalse();
  });

  it('changes the transport picker without editing, then adds a bay through one undoable action', async () => {
    editor.entity.set(createConstructionEntity('Tank', registry));
    editor.panel.set('systems');
    await render();
    const select = root().querySelector<HTMLSelectElement>('[aria-label="Transport bay type"]')!;
    select.value = 'infantry';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await render();
    expect(change).not.toHaveBeenCalled();
    expect(editor.status()).toBe('');
    root().querySelector<HTMLButtonElement>('construction-extras .add-row button')!.click();
    await render();
    expect(change).toHaveBeenCalledTimes(1);
    expect(editor.entity().transporters()[0]).toEqual(
      jasmine.objectContaining({
        kind: 'bay',
        configuration: jasmine.objectContaining({ type: 'infantry' }),
      }),
    );
    editor.undo();
    await render();
    expect(editor.entity().transporters()).toEqual([]);
    expect(editor.canUndo()).toBeFalse();
    editor.redo();
    await render();
    expect(editor.entity().transporters().length).toBe(1);
  });

  it('forwards an infantry dropdown edit through extras exactly once', async () => {
    const entity = createConstructionEntity('Infantry', registry) as InfantryEntity;
    editor.entity.set(entity);
    editor.panel.set('systems');
    await render();
    const select = root().querySelector<HTMLSelectElement>('[aria-label="Beast mount"]')!;
    select.value = 'custom';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await render();
    expect(change).toHaveBeenCalledTimes(1);
    expect(editor.entity()).toBe(entity);
    expect(entity.mount()?.custom).toBeTrue();
    expect(editor.status()).toBe('');
    editor.undo();
    await render();
    expect((editor.entity() as InfantryEntity).mount()).toBeNull();
    expect(editor.canUndo()).toBeFalse();
    editor.redo();
    await render();
    expect((editor.entity() as InfantryEntity).mount()?.custom).toBeTrue();
  });

  it('keeps building view selection separate from undoable height edits', async () => {
    const entity = createConstructionEntity('BuildingEntity', registry) as StaticEmplacementEntity;
    setConstructionBuildingTopology(entity, [{ q: 0, r: 0 }], 2);
    editor.entity.set(entity);
    editor.panel.set('topology');
    await render();
    const select = root().querySelector<HTMLSelectElement>('construction-topology [aria-label="View floor"]')!;
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await render();
    const topology = fixture.debugElement.query(By.directive(ConstructionTopologyComponent))
      .componentInstance as ConstructionTopologyComponent;
    expect(topology.floor()).toBe(1);
    expect(change).not.toHaveBeenCalled();
    expect(editor.entity()).toBe(entity);
    editor.panel.set('systems');
    await render();
    const height = root().querySelector<HTMLInputElement>('construction-building-structure input[type="number"]')!;
    height.value = '3';
    height.dispatchEvent(new Event('input', { bubbles: true }));
    height.dispatchEvent(new Event('change', { bubbles: true }));
    await render();
    expect(change).toHaveBeenCalledTimes(1);
    expect((editor.entity() as StaticEmplacementEntity).height()).toBe(3);
    expect(editor.status()).toBe('');
    editor.undo();
    await render();
    expect((editor.entity() as StaticEmplacementEntity).height()).toBe(2);
    expect(editor.canUndo()).toBeFalse();
    editor.redo();
    await render();
    expect((editor.entity() as StaticEmplacementEntity).height()).toBe(3);
  });
});
