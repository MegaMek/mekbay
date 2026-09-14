// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import type { EquipmentRegistry } from '../models/equipment-lookup';
import { caseEquipmentKind } from '../models/case-equipment.model';
import { parseEntity } from '../models/entity/parse-entity';
import { encodeNativeEntity } from '../models/entity/write-entity';
import { EquipmentCatalogService } from '../services/catalogs/equipment-catalog.service';
import { buildEquipmentRegistry } from '../services/catalogs/equipment-catalog-builder';
import { CustomUnitsService } from '../services/custom-units.service';
import { DataService } from '../services/data.service';
import { DialogsService } from '../services/dialogs.service';
import { LayoutService } from '../services/layout.service';
import { NativeEntityService } from '../services/native-entity.service';
import { ToastService } from '../services/toast.service';
import { UnitNameService } from '../services/unit-name.service';
import { formatUnitChassis, formatUnitName } from '../utils/unit-display-name.util';
import { UnitSearchIndexService } from '../services/unit-search-index.service';
import { ConstructionForceService } from './construction-force.service';
import { UnitConstructionComponent } from './unit-construction.component';
import { MekEntity } from '../models/entity/entities';
import { CONSTRUCTION_VALIDATE_EXTINCTION } from './domain/construction-config';
import {
  applyConstructionSpreadPlacements,
  constructionSpreadAllocation,
  constructionSpreadMovePlacements,
  installConstructionEquipment,
} from './domain/construction-rules';

describe('construction CASE installation with the real equipment catalog', () => {
  let registry: EquipmentRegistry;
  let fixture: ComponentFixture<UnitConstructionComponent>;
  let editor: UnitConstructionComponent;

  beforeAll(async () => {
    registry = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } },
        { provide: DialogRef, useValue: { close: () => {} } },
        { provide: Dialog, useValue: { openDialogs: [] } },
        { provide: LayoutService, useValue: { windowWidth: signal(1440) } },
        { provide: EquipmentCatalogService, useValue: { getEquipmentRegistry: () => registry } },
        {
          provide: CustomUnitsService,
          useValue: {
            summaries: signal([]),
            parseDraft: (source: string, format: string) => parseEntity(source, `draft.${format}`, registry).entity,
          },
        },
        { provide: DataService, useValue: { getUnitByUuid: () => undefined, searchCorpusVersion: signal(0) } },
        { provide: DialogsService, useValue: {} },
        { provide: NativeEntityService, useValue: {} },
        { provide: UnitNameService, useValue: { chassis: formatUnitChassis, name: formatUnitName } },
        { provide: UnitSearchIndexService, useValue: new UnitSearchIndexService() },
        { provide: ConstructionForceService, useValue: { damage: () => null } },
      ],
    });
    fixture = TestBed.createComponent(UnitConstructionComponent);
    editor = fixture.componentInstance;
    editor.panel.set('loadout');
  });

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const card = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-location="RT"]')!;
  const select = () => card().querySelector<HTMLSelectElement>('select[aria-label="Right Torso CASE"]')!;
  const protection = () =>
    editor
      .entity()
      .getEquipmentAtLocation('RT')
      .filter((mount) => caseEquipmentKind(mount.equipment));

  async function prepare(techBase: 'IS' | 'Clan'): Promise<void> {
    editor.setField(
      editor.fields().find((field) => field.id === 'year')!,
      3151,
    );
    editor.setField(
      editor.fields().find((field) => field.id === 'techBase')!,
      techBase,
    );
    editor.install(registry.equipment[techBase === 'IS' ? 'ISGaussRifle' : 'CLGaussRifle'], 'RT');
    await render();
    expect(select()).not.toBeNull();
  }

  async function choose(value: 'none' | 'case' | 'case-ii'): Promise<void> {
    expect(select().querySelector<HTMLOptionElement>(`option[value="${value}"]`)?.disabled).toBeFalse();
    select().value = value;
    select().dispatchEvent(new Event('change', { bubbles: true }));
    await render();
    if (select()) expect(select().value).toBe(value);
    else expect(value).toBe('none');
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
  }

  function fillTorsoWithEndoSteel(): string {
    const entity = editor.entity() as MekEntity;
    const material = Object.values(registry.equipment).find(
      (equipment) =>
        equipment.type === 'structure' &&
        equipment.hasFlag('F_ENDO_STEEL') &&
        equipment.techBase === entity.techBase() &&
        !equipment.hasFlag('F_PROTOTYPE'),
    )!;
    editor.setStructure(material.id);
    editor.change(() => {
      let mount = entity.equipment().find((mount) => mount.equipmentId === material.id)!;
      while (constructionSpreadAllocation(entity, mount)!.locations.find((target) => target.id === 'RT')!.free) {
        const source = mount.placements!.find((placement) => placement.location !== 'RT')!.location;
        mount = applyConstructionSpreadPlacements(
          entity,
          mount,
          constructionSpreadMovePlacements(entity, mount, source, 'RT', 1),
        );
      }
    });
    return material.id;
  }

  it('honors rules level and configured extinction checks for CASE choices', async () => {
    await prepare('IS');
    editor.setField(
      editor.fields().find((field) => field.id === 'year')!,
      2954,
    );
    editor.setField(
      editor.fields().find((field) => field.id === 'rulesLevel')!,
      1,
    );
    await render();
    expect(select()).toBeNull();
    editor.setField(
      editor.fields().find((field) => field.id === 'rulesLevel')!,
      2,
    );
    await render();
    expect(select() === null).toBe(CONSTRUCTION_VALIDATE_EXTINCTION);
    editor.setField(
      editor.fields().find((field) => field.id === 'year')!,
      3151,
    );
    await render();
    expect(select()).not.toBeNull();
    await choose('case');
    expect(protection().map((mount) => mount.equipmentId)).toEqual(['ISCASE']);
  });

  it('keeps unavailable installed CASE removable after the design technology settings change', async () => {
    await prepare('IS');
    await choose('case');
    editor.setField(
      editor.fields().find((field) => field.id === 'year')!,
      2954,
    );
    editor.setField(
      editor.fields().find((field) => field.id === 'rulesLevel')!,
      1,
    );
    await render();
    expect(select().value).toBe('case');
    await choose('none');
    expect(protection()).toEqual([]);
    expect(select()).toBeNull();
  });

  for (const [techBase, value, id, tonnage] of [
    ['IS', 'case', 'ISCASE', 0.5],
    ['IS', 'case-ii', 'ISCASEII', 1],
    ['Clan', 'case-ii', 'CLCASEII', 0.5],
  ] as const) {
    it(`makes room for ${id} by moving one Endo Steel slot, with undo and redo covering both changes`, async () => {
      await prepare(techBase);
      const materialId = fillTorsoWithEndoSteel();
      const material = () =>
        editor
          .entity()
          .equipment()
          .find((mount) => mount.equipmentId === materialId)!;
      const before = encodeNativeEntity(editor.entity());
      const placements = material().placements!;
      const localCount = placements.filter((placement) => placement.location === 'RT').length;
      await render();
      expect(encodeNativeEntity(editor.entity())).toBe(before);
      expect(
        editor
          .locations()
          .find((location) => location.id === 'RT')!
          .slots.every((slot) => slot.mount || slot.system),
      ).toBeTrue();
      await choose(value);
      expect(protection().map((mount) => mount.equipmentId)).toEqual([id]);
      expect(protection()[0].placements?.length).toBe(1);
      expect(material().placements!.length).toBe(placements.length);
      expect(material().placements!.filter((placement) => placement.location === 'RT').length).toBe(localCount - 1);
      expect(material().placements!.filter((placement) => placement.location !== 'RT').length).toBe(
        placements.length - localCount + 1,
      );
      expect(editor.errors().filter((message) => message.category === 'crit')).toEqual([]);
      const after = encodeNativeEntity(editor.entity());
      editor.undo();
      await render();
      expect(encodeNativeEntity(editor.entity())).toBe(before);
      editor.redo();
      await render();
      expect(encodeNativeEntity(editor.entity())).toBe(after);
    });

    it(`adds ${id} to a critical slot and preserves the component through native save/reload`, async () => {
      await prepare(techBase);
      const initialMass = editor
        .entity()
        .equipment()
        .reduce((sum, mount) => sum + (mount.getTonnage(editor.entity()) ?? 0), 0);
      await choose(value);
      expect(protection().map((mount) => mount.equipmentId)).toEqual([id]);
      const mount = protection()[0];
      expect(mount.placements?.length).toBe(1);
      expect(mount.placements?.[0].location).toBe('RT');
      expect(mount.getTonnage(editor.entity())).toBe(tonnage);
      expect(
        editor
          .entity()
          .equipment()
          .reduce((sum, mount) => sum + (mount.getTonnage(editor.entity()) ?? 0), 0),
      ).toBe(initialMass + tonnage);
      expect(card().querySelector(`[data-mount-id="${mount.mountId}"]`)?.textContent).toContain(mount.equipment!.name);
      const restored = parseEntity(encodeNativeEntity(editor.entity()), 'case.mtf', registry).entity;
      expect(
        restored
          .getEquipmentAtLocation('RT')
          .filter((mount) => caseEquipmentKind(mount.equipment))
          .map((mount) => mount.equipmentId),
      ).toEqual([id]);
      expect(restored.automaticClanCaseLocations().has('RT')).toBeFalse();
      editor.undo();
      await render();
      expect(protection()).toEqual([]);
      editor.redo();
      await render();
      expect(protection().map((mount) => mount.equipmentId)).toEqual([id]);
    });

    it(`keeps unused ${id} selectable with a warning until it is removed`, async () => {
      await prepare(techBase);
      await choose(value);
      const weaponId = techBase === 'IS' ? 'ISGaussRifle' : 'CLGaussRifle';
      const removeWeapon = () =>
        editor.remove(
          editor
            .entity()
            .equipment()
            .find((mount) => mount.equipmentId === weaponId)!,
        );
      removeWeapon();
      await render();
      expect(select().value).toBe(value);
      expect(select().classList.contains('warning')).toBeTrue();
      expect(select().getAttribute('aria-invalid')).not.toBe('true');
      expect(select().getAttribute('aria-describedby')).toBe('case-warning-RT');
      const icon = card().querySelector('.installed-equipment .equipment-warning-icon');
      expect(icon?.previousElementSibling?.classList.contains('equipment-label')).toBeTrue();
      expect(icon?.getAttribute('aria-label')).toContain('no explosives');
      expect(card().querySelector('.location-title .equipment-warning-icon')).toBeNull();
      expect(card().querySelector('.case-warning')?.textContent).toContain('no explosives');
      expect(editor.warnings()).toContain(
        jasmine.objectContaining({ code: 'CASE_WITHOUT_EXPLOSIVES', location: 'RT' }),
      );
      expect(editor.errors().some((message) => message.code === 'CASE_WITHOUT_EXPLOSIVES')).toBeFalse();
      expect(editor.validation().valid).toBeTrue();

      editor.install(registry.equipment[weaponId], 'RT');
      await render();
      expect(select().value).toBe(value);
      expect(select().classList.contains('warning')).toBeFalse();
      expect(card().querySelector('.case-warning')).toBeNull();
      expect(card().querySelector('.equipment-warning-icon')).toBeNull();
      expect(editor.warnings().some((message) => message.code === 'CASE_WITHOUT_EXPLOSIVES')).toBeFalse();

      removeWeapon();
      await render();
      await choose('none');
      expect(protection()).toEqual([]);
      expect(select()).toBeNull();
      expect(card().querySelector('.case-warning')).toBeNull();
      expect(editor.warnings().some((message) => message.code === 'CASE_WITHOUT_EXPLOSIVES')).toBeFalse();
      editor.undo();
      await render();
      expect(select().value).toBe(value);
      expect(card().querySelector('.case-warning')).not.toBeNull();
    });
  }

  it('disables CASE when movable spread slots have no destination, and enables it when a slot becomes free', async () => {
    await prepare('IS');
    fillTorsoWithEndoSteel();
    const entity = editor.entity();
    for (const location of editor.locations()) {
      for (const slot of location.slots.filter((slot) => !slot.mount && !slot.system)) {
        installConstructionEquipment(entity, registry.equipment['Medium Laser'], location.id);
      }
    }
    await render();
    const before = encodeNativeEntity(entity);
    for (const value of ['case', 'case-ii']) {
      expect(select().querySelector<HTMLOptionElement>(`option[value="${value}"]`)!.disabled).toBeTrue();
      editor.setLocationCase('RT', value);
    }
    expect(encodeNativeEntity(entity)).toBe(before);
    editor.remove(entity.equipment().find((mount) => mount.location === 'LT' && mount.equipmentId === 'Medium Laser')!);
    await render();
    await choose('case');
    expect(protection().map((mount) => mount.equipmentId)).toEqual(['ISCASE']);
    // Replacing existing CASE reuses its slot even when the whole Mek is full again.
    await choose('case-ii');
    expect(protection().map((mount) => mount.equipmentId)).toEqual(['ISCASEII']);
  });

  for (const prescribed of [false, true])
    it(`does not move ${prescribed ? 'prescribed spread systems' : 'ordinary equipment'} out of a full location to make room for CASE`, async () => {
      await prepare('IS');
      if (prescribed) {
        editor.setArmorMaterial('IS Stealth');
        expect(
          editor
            .entity()
            .equipment()
            .some((mount) => mount.equipmentId === 'IS Stealth'),
        ).toBeTrue();
      }
      for (const slot of editor
        .locations()
        .find((location) => location.id === 'RT')!
        .slots.filter((slot) => !slot.mount && !slot.system)) {
        installConstructionEquipment(editor.entity(), registry.equipment['Medium Laser'], 'RT');
      }
      await render();
      expect(select().querySelector<HTMLOptionElement>('option[value="case"]')!.disabled).toBeTrue();
      expect(select().querySelector<HTMLOptionElement>('option[value="case-ii"]')!.disabled).toBeTrue();
    });

  it('keeps Clan CASE implicit and slotless, unless the location is explicitly opted out', async () => {
    await prepare('Clan');
    expect(select().value).toBe('case');
    expect(protection()).toEqual([]);
    expect(card().querySelector('.equipment-warning-icon')).toBeNull();
    expect(card().querySelector('.case-warning')).toBeNull();
    await choose('none');
    expect(editor.entity().automaticClanCaseLocations().has('RT')).toBeFalse();
    await choose('case');
    expect(editor.entity().automaticClanCaseLocations().has('RT')).toBeTrue();
    expect(editor.entity().clanCaseOptOutLocations().has('RT')).toBeFalse();
    expect(protection()).toEqual([]);
    await choose('case-ii');
    editor.uninstall(protection()[0]);
    await render();
    expect(select().value).toBe('case');
    expect(editor.entity().automaticClanCaseLocations().has('RT')).toBeTrue();
    await choose('none');
    const restored = parseEntity(encodeNativeEntity(editor.entity()), 'opted-out.mtf', registry).entity;
    expect(restored.clanCaseOptOutLocations().has('RT')).toBeTrue();
    expect(restored.automaticClanCaseLocations().has('RT')).toBeFalse();
    expect(editor.entity().automaticClanCaseLocations().has('RT')).toBeFalse();
    await choose('case');
    expect(editor.entity().automaticClanCaseLocations().has('RT')).toBeTrue();
    expect(editor.entity().clanCaseOptOutLocations().has('RT')).toBeFalse();
  });

  it('warns on a manually installed Clan CASE component without consuming a slot or warning on implicit CASE', async () => {
    await prepare('Clan');
    editor.remove(
      editor
        .entity()
        .equipment()
        .find((mount) => mount.equipmentId === 'CLGaussRifle')!,
    );
    await render();
    expect(select()).toBeNull();
    expect(card().querySelector('.equipment-warning-icon')).toBeNull();
    const slots = () => editor.locations().find((location) => location.id === 'RT')!.slots;
    const occupied = () => slots().filter((slot) => slot.mount || slot.system).length;
    const before = occupied();
    editor.install(registry.equipment['CLCASE'], 'RT');
    await render();
    const mount = protection()[0];
    expect(mount.equipmentId).toBe('CLCASE');
    expect(mount.getNumCriticalSlots(editor.entity())).toBe(0);
    expect(occupied()).toBe(before);
    expect(editor.isMountUnallocated(mount)).toBeFalse();
    expect(editor.unallocated()).not.toContain(mount);
    expect(select().value).toBe('case');
    expect(card().querySelector('.slotless-case .equipment-label')?.textContent).toBe('CASE');
    expect(card().querySelector('.slotless-case .equipment-warning-icon')).not.toBeNull();
    expect(card().querySelector('.location-title .equipment-warning-icon')).toBeNull();
    expect(editor.validation().valid).toBeTrue();
    await choose('none');
    expect(protection()).toEqual([]);
    expect(card().querySelector('.slotless-case')).toBeNull();
    expect(card().querySelector('.equipment-warning-icon')).toBeNull();
    expect(select()).toBeNull();
  });
});
