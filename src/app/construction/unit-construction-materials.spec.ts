// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { ToastService } from '../services/toast.service';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { UnitConstructionComponent } from './unit-construction.component';
import { ConstructionForceService } from './construction-force.service';
import {
  MountedArmor,
  MountedEngine,
  MountedStructure,
  STANDARD_ARMOR_EQUIPMENT,
  STANDARD_STRUCTURE_EQUIPMENT,
} from '../models/entity/components';
import {
  AmmoEquipment,
  ArmorEquipment,
  MiscEquipment,
  StructureEquipment,
  WeaponEquipment,
} from '../models/equipment.model';
import { addTestEquipment } from '../models/entity/testing/test-mounted-equipment';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { parseEntity } from '../models/entity/parse-entity';
import { EquipmentCatalogService } from '../services/catalogs/equipment-catalog.service';
import { CustomUnitsService } from '../services/custom-units.service';
import { DataService } from '../services/data.service';
import { DialogsService } from '../services/dialogs.service';
import { LayoutService } from '../services/layout.service';
import { NativeEntityService } from '../services/native-entity.service';
import { UnitNameService } from '../services/unit-name.service';
import { formatUnitChassis } from '../utils/unit-display-name.util';
import { UnitSearchIndexService } from '../services/unit-search-index.service';
import type { UnitSummary } from '../models/unit-summary.model';
import { createConstructionEntity } from './domain';
import { MekEntity } from '../models/entity/entities/mek/mek-entity';

describe('construction material selections and CASE controls', () => {
  const ammo = new AmmoEquipment({
    id: 'Test CASE Ammo',
    name: 'Test CASE Ammo',
    type: 'ammo',
    stats: { explosive: true, criticalSlots: 1, tonnage: 1 },
    ammo: { shots: 10 },
  });
  const tech = { level: 'Standard', advancement: { is: { common: '2500' }, clan: { common: '2500' } } } as const;
  const caseII = new MiscEquipment({
    id: 'Test CASE II',
    name: 'CASE II',
    type: 'misc',
    flags: ['F_CASE_II', 'F_MEK_EQUIPMENT'],
    tech: { ...tech, base: 'All' },
    stats: { criticalSlots: 1, tonnage: 0.5 },
  });
  const isCase = new MiscEquipment({
    id: 'ISCASE',
    name: 'CASE',
    type: 'misc',
    flags: ['F_CASE', 'F_MEK_EQUIPMENT'],
    tech: { ...tech, base: 'IS' },
    stats: { criticalSlots: 1, tonnage: 0.5 },
  });
  const ferro = (base: 'IS' | 'Clan') =>
    new ArmorEquipment({
      id: `${base} Ferro-Fibrous`,
      name: 'Ferro-Fibrous',
      type: 'armor',
      aliases: [`${base} Ferro-Fibrous Armor`],
      tech: { ...tech, base },
      flags: ['F_MEK_EQUIPMENT'],
      armor: { type: 'FERRO_FIBROUS' },
    });
  const isFerro = ferro('IS'),
    clanFerro = ferro('Clan');
  const lightFerro = new ArmorEquipment({
    id: 'IS Light Ferro-Fibrous',
    name: 'Light Ferro-Fibrous',
    type: 'armor',
    aliases: ['IS Light Ferro-Fibrous Armor'],
    tech: { ...tech, base: 'IS' },
    flags: ['F_MEK_EQUIPMENT'],
    armor: { type: 'LIGHT_FERRO' },
  });
  const composite = new StructureEquipment({
    id: 'IS Composite',
    name: 'Composite',
    type: 'structure',
    tech: { ...tech, base: 'IS' },
    flags: ['F_COMPOSITE'],
    structure: { typeId: 4 },
  });
  const laser = (base: 'IS' | 'Clan') =>
    new WeaponEquipment({
      id: `${base} Test Laser`,
      name: 'Test Laser',
      type: 'weapon',
      tech: { ...tech, base },
      flags: ['F_MEK_WEAPON'],
      stats: { criticalSlots: 1 },
    });
  const isLaser = laser('IS'),
    clanLaser = laser('Clan');
  const doubleSink = new MiscEquipment({
    id: 'IS Double Heat Sink',
    name: 'Double Heat Sink',
    type: 'misc',
    tech: { ...tech, base: 'IS' },
    flags: ['F_DOUBLE_HEAT_SINK'],
    stats: { criticalSlots: 3, tonnage: 1 },
  });
  const registry = createTestEquipmentRegistry({
    [STANDARD_ARMOR_EQUIPMENT.id]: STANDARD_ARMOR_EQUIPMENT,
    [STANDARD_STRUCTURE_EQUIPMENT.id]: STANDARD_STRUCTURE_EQUIPMENT,
    [ammo.id]: ammo,
    [caseII.id]: caseII,
    [isCase.id]: isCase,
    ...Object.fromEntries(
      [isFerro, clanFerro, lightFerro, composite, isLaser, clanLaser, doubleSink].map((item) => [item.id, item]),
    ),
  });
  let fixture: ComponentFixture<UnitConstructionComponent>;
  let editor: UnitConstructionComponent;

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
        { provide: UnitNameService, useValue: { chassis: formatUnitChassis, name: (unit: UnitSummary) => unit.name } },
        { provide: UnitSearchIndexService, useValue: new UnitSearchIndexService() },
        { provide: ConstructionForceService, useValue: { damage: () => null } },
      ],
    });
    fixture = TestBed.createComponent(UnitConstructionComponent);
    editor = fixture.componentInstance;
    editor.panel.set('systems');
  });

  const root = () => fixture.nativeElement as HTMLElement;
  const select = (label: string) => root().querySelector<HTMLSelectElement>(`select[aria-label="${label} material"]`)!;
  const panel = () => select('Armor').closest('.system-panel')!;
  const hint = () => panel().querySelector('p');
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const choose = async (label: string, value: string) => {
    const control = select(label);
    expect([...control.options].find((option) => option.value === value)?.disabled).toBeFalse();
    control.value = value;
    control.dispatchEvent(new Event('change', { bubbles: true }));
    await render();
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
  };
  const card = (location = 'RT') => root().querySelector<HTMLElement>(`[data-location="${location}"]`)!;
  const caseSelect = (location = 'RT') =>
    card(location).querySelector<HTMLSelectElement>('.location-case-control select')!;
  const chooseCase = async (value: string, location = 'RT') => {
    const control = caseSelect(location);
    expect([...control.options].find((option) => option.value === value)?.disabled).toBeFalse();
    control.value = value;
    control.dispatchEvent(new Event('change', { bubbles: true }));
    await render();
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
    expect(caseSelect(location).value).toBe(value);
  };

  it('keeps masonry columns stable on expansion and repacks on width changes', async () => {
    await render();
    const container = root().querySelector<HTMLElement>('.configuration-panels')!;
    const materials = panel() as HTMLElement;
    const summary = root().querySelector<HTMLElement>('construction-summary')!.parentElement!;
    const settleLayout = async () => {
      for (let frame = 0; frame < 4; frame++)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    container.style.width = '1200px';
    container.style.gridTemplateColumns = 'repeat(4, 1fr)';
    await settleLayout();
    expect(summary.style.gridColumnStart).toBe(materials.style.gridColumnStart);
    const column = summary.style.gridColumnStart;
    const row = Number(summary.style.gridRowStart);
    await choose('Armor', 'patchwork');
    materials.style.minHeight = '400px';
    await settleLayout();
    expect(summary.style.gridColumnStart).toBe(column);
    expect(Number(summary.style.gridRowStart)).toBeGreaterThan(row);
    expect(summary.getBoundingClientRect().top).toBeGreaterThanOrEqual(materials.getBoundingClientRect().bottom);
    container.style.width = '320px';
    container.style.gridTemplateColumns = '1fr';
    await settleLayout();
    const panels = [...container.querySelectorAll<HTMLElement>('.systems-grid > .system-panel')];
    expect(panels.map((item) => item.dataset['systemGroup'])).toEqual([
      'Chassis',
      'Materials',
      'Systems',
      'Special',
      'Summary',
    ]);
    expect(panels.every((item) => item.style.gridColumnStart === '1')).toBeTrue();
    for (let index = 1; index < panels.length; index++)
      expect(panels[index].getBoundingClientRect().top).toBeGreaterThanOrEqual(
        panels[index - 1].getBoundingClientRect().bottom,
      );
  });

  it('selects patchwork without changing location materials and restores the selection and hint through undo', async () => {
    await render();
    const materials = [...editor.entity().armorByLocation().values()].map((mounted) => mounted.armor.id);
    expect(panel().querySelector('input[type="checkbox"]')).toBeNull();
    expect(select('Armor').value).toBe(STANDARD_ARMOR_EQUIPMENT.id);
    expect(hint()).toBeNull();

    await choose('Armor', 'patchwork');
    expect(editor.entity().hasPatchworkArmor()).toBeTrue();
    expect([...editor.entity().armorByLocation().values()].map((mounted) => mounted.armor.id)).toEqual(materials);
    expect(select('Armor').value).toBe('patchwork');
    expect(hint()?.textContent).toContain('chevron beside Structure');

    await choose('Armor', STANDARD_ARMOR_EQUIPMENT.id);
    expect(editor.entity().hasPatchworkArmor()).toBeFalse();
    expect(select('Armor').value).toBe(STANDARD_ARMOR_EQUIPMENT.id);
    expect(hint()).toBeNull();
    editor.undo();
    await render();
    expect(select('Armor').value).toBe('patchwork');
    expect(hint()).not.toBeNull();
    editor.redo();
    await render();
    expect(select('Armor').value).toBe(STANDARD_ARMOR_EQUIPMENT.id);
    expect(hint()).toBeNull();
  });

  it('selects hybrid even with matching materials and can return to uniform structure or undo donor removal', async () => {
    await render();
    await choose('Structure', 'hybrid');
    expect(editor.hybridStructure()).toBeTrue();
    expect(select('Structure').value).toBe('hybrid');
    expect(hint()).not.toBeNull();
    editor.setStructure(STANDARD_STRUCTURE_EQUIPMENT.id, 'RA', 55);
    editor.setDonor('RA', 'name', 'Shadow Hawk');
    await render();

    await choose('Structure', STANDARD_STRUCTURE_EQUIPMENT.id);
    expect(editor.hybridStructure()).toBeFalse();
    expect(select('Structure').value).toBe(STANDARD_STRUCTURE_EQUIPMENT.id);
    expect(editor.donorAt('RA')).toBeNull();
    expect(editor.entity().structureAt('RA').tonnage).toBe(editor.entity().tonnage());
    expect(hint()).toBeNull();
    editor.undo();
    await render();
    expect(select('Structure').value).toBe('hybrid');
    expect(editor.donorAt('RA')?.name).toBe('Shadow Hawk');
    expect(editor.entity().structureAt('RA').tonnage).toBe(55);
    expect(hint()).not.toBeNull();
  });

  it('keeps the hint until both materials have returned to uniform selections', async () => {
    await render();
    await choose('Armor', 'patchwork');
    await choose('Structure', 'hybrid');
    await choose('Armor', STANDARD_ARMOR_EQUIPMENT.id);
    expect(select('Structure').value).toBe('hybrid');
    expect(hint()).not.toBeNull();
    await choose('Structure', STANDARD_STRUCTURE_EQUIPMENT.id);
    expect(hint()).toBeNull();
  });

  it('shows automatic CASE in the header and makes its opt-out undoable without consuming slots', async () => {
    editor.panel.set('loadout');
    editor.setField(
      editor.fields().find((field) => field.id === 'techBase')!,
      'Clan',
    );
    addTestEquipment(editor.entity(), ammo, {
      allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 4 }] },
    });
    await render();
    const card = () => root().querySelector<HTMLElement>('[data-location="RT"]')!;
    const badge = () => card().querySelector('.case-badge');
    const slots = card().querySelectorAll('.system-slot, .empty-slot, .installed-equipment').length;
    expect(caseSelect().closest('details')).toBeNull();
    expect(root().querySelector('.case-opt-out')).toBeNull();
    expect([...caseSelect().options].map((option) => option.textContent?.trim())).toEqual([
      'Opt-Out CASE',
      'CASE',
      'CASE II',
    ]);
    expect(caseSelect().value).toBe('case');
    await chooseCase('none');
    expect(badge()).toBeNull();
    expect(editor.entity().clanCaseOptOutLocations().has('RT')).toBeTrue();
    expect(card().querySelectorAll('.system-slot, .empty-slot, .installed-equipment').length).toBe(slots);
    editor.undo();
    await render();
    expect(badge()?.textContent?.trim()).toBe('CASE');
    expect(badge()?.classList.contains('automatic')).toBeTrue();
    expect(caseSelect().value).toBe('case');
    editor.redo();
    await render();
    expect(badge()).toBeNull();
    expect(caseSelect().value).toBe('none');
    await chooseCase('case-ii');
    expect(badge()?.textContent?.trim()).toBe('CASE II');
    expect(
      editor
        .entity()
        .equipment()
        .filter((mount) => mount.equipmentId === caseII.id).length,
    ).toBe(1);
    await chooseCase('case');
    expect(badge()?.textContent?.trim()).toBe('CASE');
    expect(badge()?.classList.contains('automatic')).toBeTrue();
    expect(
      editor
        .entity()
        .equipment()
        .map((mount) => mount.equipmentId),
    ).toEqual([ammo.id]);
    expect(editor.entity().clanCaseOptOutLocations().has('RT')).toBeFalse();
  });

  it('shows installed CASE II independently of Clan opt-out and on an IS unit', async () => {
    editor.panel.set('loadout');
    const entity = editor.entity();
    addTestEquipment(entity, ammo, {
      allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 4 }] },
    });
    addTestEquipment(entity, caseII, {
      allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 5 }] },
    });
    await render();
    const card = () => root().querySelector<HTMLElement>('[data-location="RT"]')!;
    expect(card().querySelector('.case-badge')?.textContent?.trim()).toBe('CASE II');
    expect(card().querySelector('.case-opt-out')).toBeNull();
    editor.setField(
      editor.fields().find((field) => field.id === 'techBase')!,
      'Clan',
    );
    editor.setClanCaseOptOut('RT', true);
    await render();
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
    expect(editor.entity().clanCaseOptOutLocations().has('RT')).toBeTrue();
    expect(card().querySelector('.case-badge')?.textContent?.trim()).toBe('CASE II');
    expect(card().querySelector('.case-badge.automatic')).toBeNull();
  });

  it('uses the location structure technology for mixed-chassis opt-out labels', async () => {
    editor.panel.set('loadout');
    const entity = editor.entity();
    entity.mixedTech.set(true);
    addTestEquipment(entity, ammo, { location: 'RT' });
    addTestEquipment(entity, ammo, { location: 'LT' });
    await render();
    expect(caseSelect().options[0].textContent?.trim()).toBe('Not installed');
    (entity as MekEntity).enableHybridStructure();
    entity.setStructureAt(
      'RT',
      new MountedStructure({ structure: STANDARD_STRUCTURE_EQUIPMENT, tonnage: entity.tonnage(), techBase: 'Clan' }),
    );
    await render();
    expect(caseSelect().options[0].textContent?.trim()).toBe('Opt-Out CASE');
    expect(caseSelect('LT').options[0].textContent?.trim()).toBe('Not installed');
    expect(caseSelect().value).toBe('case');
    expect(caseSelect('LT').value).toBe('none');
    expect(root().querySelectorAll('.location-case-control').length).toBe(2);
  });

  it('installs, replaces and removes IS CASE in one undoable change, including in a full location', async () => {
    editor.panel.set('loadout');
    const entity = editor.entity();
    for (let slotIndex = 0; slotIndex < 11; slotIndex++) {
      addTestEquipment(entity, ammo, {
        allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex }] },
      });
    }
    await render();
    expect([...caseSelect().options].map((option) => option.textContent?.trim())).toEqual([
      'Not installed',
      'CASE',
      'CASE II',
    ]);
    await chooseCase('case');
    expect(
      editor
        .entity()
        .equipment()
        .filter((mount) => mount.equipmentId === isCase.id).length,
    ).toBe(1);
    await chooseCase('case-ii');
    expect(
      editor
        .entity()
        .equipment()
        .some((mount) => mount.equipmentId === isCase.id),
    ).toBeFalse();
    expect(
      editor
        .entity()
        .equipment()
        .filter((mount) => mount.equipmentId === caseII.id).length,
    ).toBe(1);
    editor.undo();
    await render();
    expect(caseSelect().value).toBe('case');
    editor.redo();
    await render();
    expect(caseSelect().value).toBe('case-ii');
    await chooseCase('none');
    expect(
      editor
        .entity()
        .equipment()
        .every((mount) => mount.equipmentId === ammo.id),
    ).toBeTrue();
    expect(editor.entity().clanCaseOptOutLocations().size).toBe(0);
  });

  it('shows CASE for explosives or installed protection and follows location changes', async () => {
    editor.panel.set('loadout');
    const entity = editor.entity();
    entity.techBase.set('Clan');
    addTestEquipment(entity, isLaser, { location: 'RT' });
    addTestEquipment(
      entity,
      new WeaponEquipment({
        id: 'Primitive AC',
        name: 'Primitive AC',
        type: 'weapon',
        weapon: { ammoType: 'AC_PRIMITIVE' },
        stats: { explosive: true },
      }),
      { location: 'LT' },
    );
    const unallocated = addTestEquipment(entity, ammo, { allocation: { kind: 'unallocated' } });
    await render();
    expect(root().querySelector('.location-case-control')).toBeNull();
    const mount = entity.moveEquipment(unallocated, 'RT', [{ location: 'RT', slotIndex: 4 }]);
    await render();
    expect(root().querySelectorAll('.location-case-control').length).toBe(1);
    expect(caseSelect()).not.toBeNull();
    const moved = entity.moveEquipment(mount, 'LT', [{ location: 'LT', slotIndex: 4 }]);
    await render();
    expect(caseSelect()).toBeNull();
    expect(caseSelect('LT')).not.toBeNull();
    entity.removeEquipment(moved);
    addTestEquipment(entity, caseII, { location: 'LT' });
    await render();
    expect(root().querySelectorAll('.location-case-control').length).toBe(1);
    expect(caseSelect('LT').value).toBe('case-ii');
    expect(card('LT').querySelector('.case-warning')?.textContent).toContain('no explosives');
    expect(card('LT').querySelector('.case-badge')?.textContent?.trim()).toBe('CASE II');
  });

  it('keeps unavailable CASE choices disabled and prevents changes to a locked design', async () => {
    editor.panel.set('loadout');
    addTestEquipment(editor.entity(), ammo, { location: 'LA' });
    await render();
    expect(caseSelect('LA').querySelector<HTMLOptionElement>('option[value="case"]')?.disabled).toBeTrue();
    await chooseCase('case-ii', 'LA');
    editor.foreignDesign.set(true);
    await render();
    expect(caseSelect('LA').disabled).toBeTrue();
    editor.setLocationCase('LA', 'none');
    expect(
      editor
        .entity()
        .equipment()
        .some((mount) => mount.equipmentId === caseII.id),
    ).toBeTrue();
  });

  it('offers CASE in every location occupied by a split explosive weapon', async () => {
    editor.panel.set('loadout');
    const gauss = new WeaponEquipment({
      id: 'Split Gauss',
      name: 'Split Gauss',
      type: 'weapon',
      flags: ['F_MEK_WEAPON'],
      weapon: { ammoType: 'GAUSS' },
      stats: { explosive: true, criticalSlots: 8 },
    });
    addTestEquipment(editor.entity(), gauss, {
      allocation: {
        kind: 'location',
        location: 'RT',
        placements: ['RT', 'RA'].flatMap((location) => [4, 5, 6, 7].map((slotIndex) => ({ location, slotIndex }))),
      },
    });
    await render();
    expect(root().querySelectorAll('.location-case-control').length).toBe(2);
    expect(caseSelect('RT')).not.toBeNull();
    expect(caseSelect('RA')).not.toBeNull();
  });

  it('offers missing arm actuators after structure and restores their dependencies with undo and redo', async () => {
    await render();
    expect(root().querySelector('input[aria-label="Left lower arm actuator"]')).toBeNull();
    expect(root().querySelector('input[aria-label="Right hand actuator"]')).toBeNull();
    editor.panel.set('loadout');
    await render();
    expect(root().querySelector('.location-actuator')).toBeNull();
    editor.removeSystem('LA', 'Lower Arm Actuator');
    await render();
    const checks = () => card('LA').querySelectorAll<HTMLInputElement>('.location-actuator input');
    expect(checks().length).toBe(2);
    expect(card('RA').querySelector('.location-actuator')).toBeNull();
    expect(checks()[0].closest('details')).toBeNull();
    expect(card('LA').querySelector('.location-defense')!.nextElementSibling?.className).toBe('location-controls');
    expect(checks()[0].getBoundingClientRect().width).toBeGreaterThanOrEqual(16);
    expect(checks()[0].getBoundingClientRect().height).toBeGreaterThanOrEqual(16);
    checks()[1].click();
    await render();
    expect(checks().length).toBe(0);
    expect(
      editor
        .fields()
        .find((field) => field.id === 'leftLowerArm')!
        .get(),
    ).toBeTrue();
    expect(
      editor
        .fields()
        .find((field) => field.id === 'leftHand')!
        .get(),
    ).toBeTrue();
    editor.undo();
    await render();
    expect(checks().length).toBe(2);
    editor.redo();
    await render();
    expect(checks().length).toBe(0);
    editor.removeSystem('LA', 'Hand Actuator');
    await render();
    expect(checks().length).toBe(1);
    expect(checks()[0].getAttribute('aria-label')).toBe('Left hand actuator');
  });

  it('offers a persistent CASE opt-out on a vehicle Body without armor controls', async () => {
    editor.panel.set('loadout');
    editor.entity.set(createConstructionEntity('Tank', registry));
    editor.entity().techBase.set('Clan');
    await render();
    const card = () => root().querySelector<HTMLElement>('[data-location="Body"]')!;
    expect(card().querySelector('construction-armor-control')).toBeNull();
    expect(card().querySelector('.case-opt-out')).not.toBeNull();
    editor.setClanCaseOptOut('Body', true);
    await render();
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
    expect(editor.entity().clanCaseOptOutLocations().has('Body')).toBeTrue();
    editor.undo();
    await render();
    expect(editor.entity().clanCaseOptOutLocations().has('Body')).toBeFalse();
    editor.redo();
    await render();
    expect(editor.entity().clanCaseOptOutLocations().has('Body')).toBeTrue();
  });

  it('offers patchwork only for supported families and structure selection only for Meks', async () => {
    for (const kind of ['Biped', 'Tank', 'SmallCraft'] as const) {
      editor.entity.set(createConstructionEntity(kind, registry));
      await render();
      expect(!!select('Armor').querySelector('option[value="patchwork"]'))
        .withContext(kind)
        .toBe(kind !== 'SmallCraft');
      expect(!!select('Structure'))
        .withContext(kind)
        .toBe(kind === 'Biped');
    }
  });

  it('converts matching armor through the tech control and restores it through undo and redo', async () => {
    await render();
    await choose('Armor', isFerro.id);
    editor.setField(
      editor.fields().find((field) => field.id === 'techBase')!,
      'Clan',
    );
    await render();
    expect(select('Armor').value).toBe(clanFerro.id);
    expect(select('Armor').classList.contains('danger')).toBeFalse();
    editor.undo();
    await render();
    expect(editor.entity().techBase()).toBe('IS');
    expect(select('Armor').value).toBe(isFerro.id);
    editor.redo();
    await render();
    expect(editor.entity().techBase()).toBe('Clan');
    expect(select('Armor').value).toBe(clanFerro.id);
  });

  it('marks unconvertible armor and structure controls as dangerous while leaving shared materials valid', async () => {
    editor.entity().setUniformArmor(new MountedArmor({ armor: lightFerro }));
    editor.entity().setUniformStructure(new MountedStructure({ structure: composite, tonnage: 50 }));
    editor.setField(
      editor.fields().find((field) => field.id === 'techBase')!,
      'Clan',
    );
    await render();
    for (const label of ['Armor', 'Structure']) {
      expect(select(label).classList.contains('danger')).withContext(label).toBeTrue();
      expect(select(label).getAttribute('aria-invalid')).toBe('true');
      expect(select(label).selectedOptions[0].textContent).toContain('incompatible');
    }
    expect(editor.materialInvalid(STANDARD_ARMOR_EQUIPMENT)).toBeFalse();
    expect(editor.materialInvalid(STANDARD_STRUCTURE_EQUIPMENT)).toBeFalse();
    editor.setField(
      editor.fields().find((field) => field.id === 'mixedTech')!,
      true,
    );
    await render();
    expect(select('Armor').classList.contains('danger')).toBeFalse();
    expect(select('Structure').classList.contains('danger')).toBeFalse();
  });

  it('marks opposite-tech installed and unallocated equipment and clears the warning for mixed technology', async () => {
    editor.panel.set('loadout');
    const entity = editor.entity();
    const own = addTestEquipment(entity, isLaser, {
      allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 4 }] },
    });
    const other = addTestEquipment(entity, clanLaser, {
      allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 4 }] },
    });
    addTestEquipment(entity, clanLaser, { allocation: { kind: 'unallocated' } });
    addTestEquipment(entity, caseII, {
      allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 5 }] },
    });
    const row = (id: string) => root().querySelector(`[data-mount-id="${id}"]`)!;
    await render();
    expect(row(own.mountId).classList.contains('tech-incompatible')).toBeFalse();
    expect(row(other.mountId).querySelector('.tech-warning')?.getAttribute('aria-label')).toContain(
      'Clan technology requires mixed technology',
    );
    expect(root().querySelector('.unallocated-equipment.tech-incompatible .tech-warning')).not.toBeNull();
    expect(editor.equipmentTechMismatch(caseII)).toBeFalse();
    entity.mixedTech.set(true);
    await render();
    expect(root().querySelector('.tech-incompatible')).toBeNull();
    entity.mixedTech.set(false);
    editor.setField(
      editor.fields().find((field) => field.id === 'techBase')!,
      'Clan',
    );
    await render();
    expect(row(own.mountId).classList.contains('tech-incompatible')).toBeTrue();
    expect(row(other.mountId).classList.contains('tech-incompatible')).toBeFalse();
  });

  it('also marks incompatible engine systems and their integral heat sinks', async () => {
    editor.panel.set('loadout');
    editor.setField(
      editor.fields().find((field) => field.id === 'techBase')!,
      'Clan',
    );
    editor.entity().mountedEngine.set(new MountedEngine({ type: 'XL', rating: 200, techBase: 'IS' }));
    addTestEquipment(editor.entity(), doubleSink, { allocation: { kind: 'engine' } });
    await render();
    expect(root().querySelector('.system-slot.tech-incompatible .tech-warning')).not.toBeNull();
    expect(root().querySelector('.integral-equipment .tech-incompatible .tech-warning')).not.toBeNull();
    editor.entity().mixedTech.set(true);
    await render();
    expect(root().querySelector('.tech-incompatible')).toBeNull();
  });
});
