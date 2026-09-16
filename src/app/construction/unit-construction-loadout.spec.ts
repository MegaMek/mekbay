// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { of } from 'rxjs';
import { SetAmmoDialogComponent } from '../components/set-ammo-dialog/set-ammo.dialog.component';
import { hasMekRuntime } from '../models/cbt-unit-snapshot';
import { projectMekRecordSheet } from '../models/runtime/mek-record-sheet';
import { emptyCBTEncounterSnapshot } from '../models/runtime/testing/direct-mek-runtime-fixture';
import { buildUnitComponentMetadata } from '../utils/unit-component-metadata-builder';
import { ToastService } from '../services/toast.service';
import { TestBed } from '@angular/core/testing';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import type { CBTForce } from '../models/cbt-force.model';
import type { CBTRuleset } from '../models/cbt-ruleset.model';
import type { BaseEntity } from '../models/entity/base-entity';
import { MountedArmor, MountedEngine, MountedStructure } from '../models/entity/components';
import { STRUCTURE_TYPE } from '../models/entity/types/structure';
import type { GyroType } from '../models/entity/components/gyro-data';
import { MekEntity } from '../models/entity/entities/mek/mek-entity';
import type { MekLocation, MekSystemType } from '../models/entity/types';
import { parseEntity } from '../models/entity/parse-entity';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { encodeNativeEntity } from '../models/entity/write-entity';
import {
  AmmoEquipment,
  ArmorEquipment,
  MiscEquipment,
  StructureEquipment,
  WeaponEquipment,
} from '../models/equipment.model';
import { CBTForceMember } from '../models/force-member.model';
import { createMekUnit } from '../models/runtime/cbt-mek-unit';
import type { CBTUnitCommand } from '../models/runtime/unit-command';
import {
  constructionRuntimeBattleValue,
  constructionRuntimeSource,
  prepareConstructionRuntime,
  type ConstructionRuntimeChanges,
} from '../models/runtime/construction-runtime';
import { EquipmentCatalogService } from '../services/catalogs/equipment-catalog.service';
import { CustomUnitsService } from '../services/custom-units.service';
import { DataService } from '../services/data.service';
import { DialogsService } from '../services/dialogs.service';
import { LayoutService } from '../services/layout.service';
import { NativeEntityService } from '../services/native-entity.service';
import { UnitSearchIndexService } from '../services/unit-search-index.service';
import { mekCriticalSlotLabel } from '../utils/mek-critical-display.util';
import { createConstructionEntity, setConstructionArmorMaterial, setConstructionStructure } from './domain';
import { UnitConstructionComponent } from './unit-construction.component';
import type { ConstructionMountOrigins } from './construction-force.service';

describe('construction component blocks', () => {
  const ac = new WeaponEquipment({
    id: 'Test AC',
    name: 'Test AC',
    type: 'weapon',
    tech: { base: 'IS', level: 'Introductory', advancement: { is: { common: '2000' } } },
    flags: ['F_AC', 'F_BALLISTIC', 'F_MEK_WEAPON'],
    stats: { criticalSlots: 3, tonnage: 5, bv: 50 },
    weapon: { ammoType: 'AC', rackSize: 5, damage: 5, heat: 1, ranges: [6, 12, 18, 24] },
  });
  const sinks = new MiscEquipment({
    id: 'ISDoubleHeatSink',
    name: 'Double Heat Sink',
    type: 'misc',
    flags: ['F_DOUBLE_HEAT_SINK', 'F_MEK_EQUIPMENT'],
    stats: { criticalSlots: 3, tonnage: 1 },
  });
  const laser = new WeaponEquipment({
    id: 'Test Medium Laser',
    name: 'Test Medium Laser',
    type: 'weapon',
    tech: { base: 'IS', level: 'Introductory', advancement: { is: { common: '2000' } } },
    flags: ['F_ENERGY', 'F_MEK_WEAPON'],
    stats: { criticalSlots: 1, tonnage: 1 },
    weapon: { damage: 5, heat: 3, ranges: [3, 6, 9, 12] },
  });
  const srm = new WeaponEquipment({
    id: 'SRM 6',
    name: 'SRM 6',
    type: 'weapon',
    tech: { base: 'IS', level: 'Introductory', advancement: { is: { common: '2000' } } },
    flags: ['F_MEK_WEAPON', 'F_MISSILE'],
    stats: { criticalSlots: 2, tonnage: 3 },
    weapon: { ammoType: 'SRM', rackSize: 6, heat: 4 },
  });
  const ammo = new AmmoEquipment({
    id: 'Test AC Ammo',
    name: 'Test AC Ammo',
    shortName: 'Test AC',
    type: 'ammo',
    stats: { criticalSlots: 1, tonnage: 1 },
    ammo: { type: 'AC', rackSize: 5, shots: 20 },
    tech: { base: 'IS', level: 'Introductory', advancement: { is: { common: '2000' } } },
  });
  const splitAc = new WeaponEquipment({
    id: 'Test Split AC',
    name: 'Test Split AC',
    type: 'weapon',
    tech: { base: 'IS', level: 'Introductory', advancement: { is: { common: '2000' } } },
    flags: ['F_AC', 'F_BALLISTIC', 'F_MEK_WEAPON'],
    stats: { criticalSlots: 10, tonnage: 14 },
    weapon: { ammoType: 'AC', rackSize: 20, damage: 20, heat: 7, ranges: [3, 6, 9, 12] },
  });
  const flak = new AmmoEquipment({
    id: 'Test Flak AC Ammo',
    name: 'Flak Test AC Ammo',
    shortName: 'Flak Test AC',
    type: 'ammo',
    stats: { criticalSlots: 1, tonnage: 1 },
    ammo: { type: 'AC', rackSize: 5, shots: 20, munitionType: ['M_FLAK'] },
    tech: { base: 'IS', level: 'Standard', advancement: { is: { common: '2000' } } },
  });
  const endo = new StructureEquipment({
    id: 'IS Endo Steel',
    name: 'Endo Steel',
    type: 'structure',
    aliases: ['Endo Steel'],
    tech: { base: 'IS', level: 'Standard', advancement: { is: { common: '2000' } } },
    flags: ['F_ENDO_STEEL', 'F_MEK_EQUIPMENT'],
    stats: { criticalSlots: 14, spreadable: true, tonnage: 'variable' },
    structure: { typeId: 1 },
  });
  const stealth = new ArmorEquipment({
    id: 'IS Stealth',
    name: 'Stealth',
    type: 'armor',
    aliases: ['IS Stealth Armor'],
    tech: { base: 'IS', level: 'Standard', advancement: { is: { common: '2000' } } },
    flags: ['F_STEALTH', 'F_MEK_EQUIPMENT'],
    stats: { criticalSlots: 12, spreadable: true, tonnage: 'variable' },
    armor: { type: 'STEALTH' },
  });
  const hardened = new ArmorEquipment({
    id: 'Hardened Armor',
    name: 'Hardened',
    type: 'armor',
    flags: ['F_HARDENED_ARMOR', 'F_MEK_EQUIPMENT'],
    armor: { type: 'HARDENED' },
  });
  const reinforced = new StructureEquipment({
    id: 'Reinforced Structure',
    name: 'Reinforced',
    type: 'structure',
    flags: ['F_REINFORCED', 'F_MEK_EQUIPMENT'],
    structure: { typeId: STRUCTURE_TYPE.REINFORCED },
  });
  const registry = createTestEquipmentRegistry({
    [ac.id]: ac,
    [splitAc.id]: splitAc,
    [sinks.id]: sinks,
    [laser.id]: laser,
    [ammo.id]: ammo,
    [flak.id]: flak,
    [endo.id]: endo,
    [stealth.id]: stealth,
    [srm.id]: srm,
    [hardened.id]: hardened,
    [reinforced.id]: reinforced,
  });

  async function create(
    options: {
      ammo?: boolean;
      ruleset?: CBTRuleset;
      gyro?: GyroType;
      armored?: boolean;
      custom?: boolean;
      editDesign?: boolean;
      originalBuildYear?: number;
      armor?: boolean;
      doubleDamageProtection?: boolean;
      material?: 'endo' | 'stealth';
      missingMaterial?: boolean;
      materialAlias?: boolean;
    } = {},
  ) {
    const entity = createConstructionEntity('Biped', registry) as MekEntity;
    if (options.originalBuildYear !== undefined) entity.originalBuildYear.set(options.originalBuildYear);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 250, techBase: 'IS' }));
    entity.originalWalkMP.set(5);
    entity.gyroType.set(options.gyro ?? 'Standard');
    entity.configureHeatSinks(sinks, 10);
    entity.addEquipment({
      equipmentId: ac.id,
      equipment: ac,
      allocation: {
        kind: 'location',
        location: 'LT',
        placements: [0, 1, 2].map((slotIndex) => ({ location: 'LT', slotIndex })),
      },
      rearMounted: false,
      turretMounted: false,
      omniPodMounted: false,
      armored: false,
    });
    if (options.ammo)
      entity.addEquipment({
        equipmentId: ammo.id,
        equipment: ammo,
        allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 0 }] },
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored: false,
      });
    if (options.armored) entity.armoredSystemSlots.set(new Set(['CT:1']));
    if (options.material === 'endo') setConstructionStructure(entity, endo);
    if (options.material === 'stealth') setConstructionArmorMaterial(entity, stealth);
    if (options.materialAlias)
      entity.updateEquipment((mounts) =>
        mounts.map((mount) => (mount.equipmentId === endo.id ? mount.clone({ equipmentId: endo.name }) : mount)),
      );
    if (options.missingMaterial) {
      for (const mount of entity
        .equipment()
        .filter((mount) => mount.equipmentId === endo.id || mount.equipmentId === stealth.id))
        entity.removeEquipment(mount);
    }
    if (options.armor) {
      entity.setArmorValue('LT', 'front', 12);
      entity.setArmorValue('LT', 'rear', 6);
    }
    if (options.doubleDamageProtection) {
      entity.setArmorAt('LT', new MountedArmor({ armor: hardened }));
      entity.setStructureAt('LT', new MountedStructure({ structure: reinforced, tonnage: entity.tonnage() }));
    }
    const instance = await createMekUnit(
      { uuid: entity.uuid(), instanceId: 'unit:construction-blocks' },
      entity,
      entity.uuid(),
      {
        initializerRevision: 1,
        profileId: 'pristine',
        deployment: { id: 'test' },
        scenario: { id: 'construction-blocks', ruleset: options.ruleset ?? 'core-2026' },
      },
    );
    const force = {
      readOnly: () => false,
      getMekRecordSheetSnapshot: () => ({ revision: instance.revision() }),
      getUnitSnapshot: () => ({ entity, ruleset: instance.ruleset(), ...instance.captureRuntime() }),
      previewConstructionBattleValue: (
        _member: CBTForceMember,
        draft: BaseEntity,
        origins: ConstructionMountOrigins,
        changes?: ConstructionRuntimeChanges,
      ) =>
        constructionRuntimeBattleValue(instance, draft, origins, changes?.commands ?? [], {
          id: 'construction-blocks',
          ruleset: options.ruleset ?? 'core-2026',
        }),
      dispatchUnitCommand: async (_id: string, command: CBTUnitCommand) => {
        const result = instance.dispatch(command);
        member.bindRuntime(instance, instance.revision());
        return result;
      },
      repairMember: jasmine.createSpy('repairMember').and.resolveTo({ accepted: true, changed: true }),
      previewConstructionRuntime: jasmine
        .createSpy('previewConstructionRuntime')
        .and.callFake(async (_member, changes: ConstructionRuntimeChanges) => {
          const candidate = await prepareConstructionRuntime(instance, changes.commands, {
            id: 'construction-blocks',
            ruleset: options.ruleset ?? 'core-2026',
          });
          return {
            changes,
            snapshot: { entity, ruleset: instance.ruleset(), ...candidate.captureRuntime() },
            changed: constructionRuntimeSource(candidate) !== constructionRuntimeSource(instance),
          };
        }),
    } as unknown as CBTForce;
    const member = new CBTForceMember(instance.instanceId, force, entity);
    member.bindRuntime(instance, instance.revision());
    const parseDraft = (source: string) => parseEntity(source, 'construction.mtf', registry).entity;
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
            get: async () => (options.custom ? { uuid: entity.uuid() } : undefined),
            summaries: signal([]),
            parseDraft,
            detach: (source: BaseEntity) => parseDraft(encodeNativeEntity(source)),
          },
        },
        { provide: DataService, useValue: { getUnitByUuid: () => undefined, searchCorpusVersion: signal(0) } },
        {
          provide: DialogsService,
          useValue: {
            requestConfirmation: jasmine.createSpy('requestConfirmation').and.resolveTo(false),
            createDialog: jasmine.createSpy('createDialog'),
          },
        },
        { provide: NativeEntityService, useValue: {} },
        { provide: UnitSearchIndexService, useValue: new UnitSearchIndexService() },
      ],
    });
    const view = TestBed.createComponent(UnitConstructionComponent);
    const editor = view.componentInstance;
    await editor.openForceMember(member);
    editor.setDesignEditing(options.editDesign ?? true);
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
    view.detectChanges();
    await view.whenStable();
    const root = view.nativeElement as HTMLElement;
    const systems = (system: MekSystemType, location = 'CT') =>
      [...root.querySelectorAll<HTMLElement>(`[data-location="${location}"] .system-slot`)].filter(
        (block) =>
          block.querySelector('.system-name .equipment-label')?.textContent?.trim() === editor.systemLabel(system),
      );
    const hit = async (location: string, slotIndex: number, target: 'committed' | 'pending' = 'committed') => {
      const slot = [...instance.getIndex().slots.values()].find(
        (slot) => slot.slotIndex === slotIndex && instance.getIndex().locations.get(slot.locationId)?.code === location,
      )!;
      expect(instance.dispatch({ type: 'hit-critical', slotId: slot.id, hits: 1, target }).changed).toBeTrue();
      member.bindRuntime(instance, instance.revision());
      await view.whenStable();
    };
    return { entity, instance, view, editor, root, systems, hit, force };
  }

  async function drag(f: Awaited<ReturnType<typeof create>>, source: HTMLElement, target: HTMLElement) {
    const start = source.getBoundingClientRect(),
      end = target.getBoundingClientRect();
    const x = start.left + Math.min(20, start.width / 2),
      y = start.top + Math.min(10, start.height / 2);
    const targetX = end.left + end.width / 2,
      targetY = end.top + end.height / 2;
    expect(document.elementFromPoint(x, y)?.closest('.cdk-drag'))
      .withContext(`Source at ${x},${y}; target at ${targetX},${targetY}`)
      .toBe(source);
    const handle = source.querySelector<HTMLElement>('.equipment-name') ?? source;
    handle.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y }),
    );
    handle.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        detail: 1,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
      }),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: x + 10, clientY: y + 10 }),
    );
    f.view.detectChanges();
    expect(f.editor.dragging()).withContext('Drag started').not.toBeNull();
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: targetX, clientY: targetY }),
    );
    f.view.detectChanges();
    const warehouseZone = target.closest('.warehouse')?.querySelector('.warehouse-drop-zone');
    expect(
      warehouseZone?.classList.contains('cdk-drop-list-dragging') ||
        target.closest('.cdk-drop-list')?.classList.contains('cdk-drop-list-dragging'),
    )
      .withContext(
        `Drop at ${targetX},${targetY}; hit ${document.elementFromPoint(targetX, targetY)?.outerHTML.slice(0, 300)}; warehouse ${warehouseZone?.className} ${JSON.stringify(warehouseZone?.getBoundingClientRect())}`,
      )
      .toBeTrue();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: targetX, clientY: targetY }));
    await f.view.whenStable();
    f.view.detectChanges();
  }

  it('uninstalls mounted equipment, installs the same component, and removes it through REMOVE', async () => {
    const f = await create();
    const gun = f.editor
      .entity()
      .equipment()
      .find((mount) => mount.equipmentId === ac.id)!;
    f.editor.updateMount(gun, { rearMounted: true, armored: true });
    f.view.detectChanges();
    const installed = f.root.querySelector<HTMLElement>('[data-location="LT"] .installed-equipment')!;
    expect(installed.querySelector('.remove-mount')).toBeNull();
    installed.querySelector<HTMLButtonElement>('.mounted-name')!.click();
    f.view.detectChanges();
    expect(f.root.querySelector('.equipment-actions')?.textContent).toContain('UNINSTALL');
    expect(f.root.querySelector('.equipment-actions')?.textContent).toContain('REMOVE');
    f.root.querySelector<HTMLButtonElement>('.uninstall-equipment')!.click();
    f.view.detectChanges();
    expect(f.editor.canPlaceSelectedEquipment()).toBeFalse();
    expect(f.root.querySelector('.placement-ready, .placement-hint, .placement-selected')).toBeNull();
    const unallocated = f.editor.unallocated().find((mount) => mount.mountId === gun.mountId)!;
    expect(unallocated.allocation.kind).toBe('unallocated');
    expect(unallocated.placements).toBeUndefined();
    expect(unallocated.rearMounted).toBeTrue();
    expect(unallocated.armored).toBeTrue();
    expect(f.root.querySelector('[data-location="LT"] .installed-equipment')).toBeNull();
    const chip = f.root.querySelector<HTMLElement>('.unallocated-equipment')!;
    expect(chip.querySelector('.remove-mount')).not.toBeNull();
    chip.querySelector<HTMLButtonElement>('.unallocated-name')!.click();
    f.view.detectChanges();
    expect(f.root.querySelector('.inspector-title .muted')?.textContent).toContain('Unallocated');
    expect(f.root.querySelector('.uninstall-equipment')).toBeNull();
    expect(f.root.querySelector('.install-equipment')).not.toBeNull();
    f.editor.selectedLocation.set('RA');
    f.view.detectChanges();
    f.root.querySelector<HTMLButtonElement>('.install-equipment')!.click();
    f.view.detectChanges();
    expect(f.editor.selectedMount()?.mountId).toBe(gun.mountId);
    expect(f.editor.selectedMount()?.location).toBe('RA');
    expect(f.editor.selectedMount()?.rearMounted).toBeTrue();
    expect(f.editor.unallocated()).toEqual([]);
    expect(f.root.querySelector('.unallocated-empty')).not.toBeNull();
    f.root.querySelector<HTMLButtonElement>('.remove-equipment')!.click();
    expect(
      f.editor
        .entity()
        .equipment()
        .some((mount) => mount.mountId === gun.mountId),
    ).toBeFalse();
    expect(f.editor.unallocated()).toEqual([]);
  });

  it('switches the loadout uninstall button to direct removal while Ctrl or Cmd is held', async () => {
    const f = await create();
    const gun = f.editor
      .entity()
      .equipment()
      .find((mount) => mount.equipmentId === ac.id)!;
    const button = () =>
      f.root.querySelector<HTMLButtonElement>('[data-location="LT"] .installed-equipment .uninstall-mount')!;
    expect(button().getAttribute('title')).toContain('Uninstall');
    expect(button().classList.contains('direct-remove')).toBeFalse();

    for (const modifier of [
      { key: 'Control', ctrlKey: true },
      { key: 'Meta', metaKey: true },
    ] as const) {
      document.dispatchEvent(new KeyboardEvent('keydown', modifier));
      f.view.detectChanges();
      expect(button().getAttribute('title')).withContext(modifier.key).toContain('Remove');
      expect(button().getAttribute('aria-label')).withContext(modifier.key).toContain('Remove');
      expect(button().classList.contains('direct-remove')).withContext(modifier.key).toBeTrue();

      document.dispatchEvent(new KeyboardEvent('keyup', { key: modifier.key }));
      f.view.detectChanges();
      expect(button().getAttribute('title')).withContext(modifier.key).toContain('Uninstall');
      expect(button().classList.contains('direct-remove')).withContext(modifier.key).toBeFalse();
    }

    // Cmd+click (macOS) deletes the mount outright instead of moving it to unallocated equipment.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
    f.view.detectChanges();
    button().dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    f.view.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
    expect(
      f.editor
        .entity()
        .equipment()
        .some((mount) => mount.mountId === gun.mountId),
    ).toBeFalse();
    expect(f.editor.unallocated()).toEqual([]);
  });

  it('leaves an uninstalled mount unselected until its tray item is clicked, then preserves that choice during inspection', async () => {
    const f = await create();
    const gun = f.editor
      .entity()
      .equipment()
      .find((mount) => mount.equipmentId === ac.id)!;
    f.root.querySelector<HTMLButtonElement>('[data-location="LT"] .installed-equipment .uninstall-mount')!.click();
    f.view.detectChanges();
    const source = f.root.querySelector<HTMLButtonElement>('.unallocated-name')!;
    expect(f.editor.unallocated().map((mount) => mount.mountId)).toEqual([gun.mountId]);
    expect(source.getAttribute('aria-pressed')).toBe('false');
    expect(f.editor.canPlaceSelectedEquipment()).toBeFalse();
    expect(f.root.querySelector('.placement-ready, .placement-hint, .placement-selected')).toBeNull();
    const emptySlot = f.root.querySelector<HTMLButtonElement>('[data-location="RA"] .empty-slot')!;
    expect(emptySlot.disabled).toBeTrue();
    emptySlot.click();
    expect(f.editor.unallocated().map((mount) => mount.mountId)).toEqual([gun.mountId]);
    source.click();
    f.view.detectChanges();
    expect(source.getAttribute('aria-pressed')).toBe('true');
    expect(source.closest('.unallocated-equipment')?.classList.contains('placement-selected')).toBeTrue();
    expect(f.root.querySelector('.warehouse-item.selected')).toBeNull();
    f.editor.cancelPlacement();
    f.view.detectChanges();
    expect(source.getAttribute('aria-pressed')).toBe('false');
    expect(f.root.querySelector('.placement-ready')).toBeNull();
    expect(f.editor.unallocated().map((mount) => mount.mountId)).toEqual([gun.mountId]);
    source.click();
    f.editor.closeInstalledInspector();
    f.editor.inspectEquipment(ammo, f.root, true);
    f.view.detectChanges();
    f.root.querySelector<HTMLButtonElement>('[data-location="RA"] .empty-slot')!.click();
    f.view.detectChanges();
    expect(f.editor.selectedMount()?.mountId).toBe(gun.mountId);
    expect(f.editor.selectedMount()?.location).toBe('RA');
    expect(f.editor.unallocated()).toEqual([]);
    expect(f.root.querySelector('.placement-ready')).toBeNull();
  });

  it('uses drop prompts only during dragging and leaves no placement selection after a cancelled drag', async () => {
    const f = await create();
    f.editor.selectEquipment(ac);
    f.editor.startDrag({ equipmentId: ac.id });
    f.view.detectChanges();
    const slot = f.root.querySelector<HTMLButtonElement>('[data-location="RT"] .empty-slot')!;
    expect(slot.textContent).toContain('DROP HERE');
    expect(slot.classList.contains('placement-ready')).toBeTrue();
    expect(f.editor.placementSourceSelected(ac.id)).toBeTrue();
    const before = f.editor.entity().equipment().length;
    slot.click();
    expect(f.editor.entity().equipment().length).toBe(before);
    f.editor.endDrag();
    f.view.detectChanges();
    expect(f.editor.placementSourceSelected(ac.id)).toBeFalse();
    expect(slot.textContent).toContain('EMPTY SLOT');
    expect(slot.disabled).toBeTrue();
    f.editor.startDrag({ equipmentId: ammo.id });
    f.editor.dragTarget.set({ location: 'RT' });
    f.root.querySelector<HTMLElement>('.construction-shell')!.style.setProperty('--slot-height', '18px');
    f.view.detectChanges();
    const preview = f.root.querySelector<HTMLElement>('.slot-drop-preview')!;
    expect(preview.textContent).toContain('DROP HERE');
    expect(preview.querySelector('small')).toBeNull();
    expect(preview.scrollHeight).toBeLessThanOrEqual(preview.clientHeight);
    f.editor.endDrag();
  });

  it('supports moves in both directions through the unallocated drop zone and clicking an empty slot', async () => {
    const f = await create();
    const gun = f.editor
      .entity()
      .equipment()
      .find((mount) => mount.equipmentId === ac.id)!;
    const data = { equipmentId: ac.id, mountId: gun.mountId, sourceLocation: 'LT' };
    f.editor.onUnallocatedDrop({ item: { data }, isPointerOverContainer: false });
    expect(f.editor.unallocated()).toEqual([]);
    f.editor.onUnallocatedDrop({ item: { data }, isPointerOverContainer: true });
    f.view.detectChanges();
    expect(f.editor.unallocated().map((mount) => mount.mountId)).toEqual([gun.mountId]);
    expect(f.editor.canPlaceSelectedEquipment()).toBeFalse();
    expect(f.root.querySelector('.placement-ready, .placement-selected')).toBeNull();
    const trayItem = f.root.querySelector<HTMLButtonElement>('.unallocated-name')!;
    expect(trayItem.getAttribute('aria-pressed')).toBe('false');
    const emptySlot = f.root.querySelector<HTMLButtonElement>('[data-location="RT"] .empty-slot')!;
    expect(emptySlot.disabled).toBeTrue();
    emptySlot.click();
    expect(f.editor.unallocated().map((mount) => mount.mountId)).toEqual([gun.mountId]);
    trayItem.click();
    f.view.detectChanges();
    f.root.querySelector<HTMLButtonElement>('[data-location="RT"] .empty-slot')!.click();
    expect(f.editor.selectedMount()?.mountId).toBe(gun.mountId);
    expect(f.editor.selectedMount()?.location).toBe('RT');
    f.editor.uninstall(f.editor.selectedMount()!);
    f.editor.onDrop({
      item: { data: { equipmentId: ac.id, mountId: gun.mountId } },
      container: { data: { location: 'RA' } },
      isPointerOverContainer: true,
    });
    expect(f.editor.selectedMount()?.location).toBe('RA');
    expect(
      f.editor
        .entity()
        .equipment()
        .filter((mount) => mount.equipmentId === ac.id).length,
    ).toBe(1);
  });

  it('opens the empty drop zone and moves equipment in both directions with pointer dragging', async () => {
    const f = await create();
    Object.assign(f.root.style, { position: 'fixed', inset: '0', zIndex: '1000' });
    TestBed.inject(LayoutService).windowWidth.set(window.innerWidth);
    f.root.querySelector<HTMLElement>('.unallocated-panel summary')!.click();
    f.view.detectChanges();
    await f.view.whenStable();
    const gun = f.editor
      .entity()
      .equipment()
      .find((mount) => mount.equipmentId === ac.id)!;
    const workspace = f.root.querySelector<HTMLElement>('.construction-workspace')!;
    const zone = f.root.querySelector<HTMLElement>('.unallocated-drop-zone')!;
    const received = spyOn(f.editor, 'onUnallocatedDrop').and.callThrough();
    try {
      const source = f.root.querySelector<HTMLElement>('[data-location="LT"] .installed-equipment')!;
      source.scrollIntoView({ block: 'center' });
      expect(zone.getBoundingClientRect().bottom).toBeLessThanOrEqual(workspace.getBoundingClientRect().bottom);
      expect(zone.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        f.root.querySelector('.workshop-footer')!.getBoundingClientRect().top,
      );
      await drag(f, source, zone);
      expect(received).toHaveBeenCalled();
      expect(f.editor.unallocated().map((mount) => mount.mountId)).toEqual([gun.mountId]);
      expect(f.editor.canPlaceSelectedEquipment()).toBeFalse();
      expect(f.root.querySelector('.placement-ready, .placement-selected')).toBeNull();
      const target = f.root.querySelector<HTMLElement>('[data-location="RA"] .empty-slot')!;
      target.scrollIntoView({ block: 'center' });
      await drag(f, f.root.querySelector<HTMLElement>('.unallocated-equipment')!, target);
      expect(f.editor.unallocated()).toEqual([]);
      expect(
        f.editor
          .entity()
          .equipment()
          .find((mount) => mount.mountId === gun.mountId)?.location,
      ).toBe('RA');
      expect(f.root.querySelector('.unallocated-empty')).not.toBeNull();
    } finally {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      f.root.removeAttribute('style');
    }
  });

  it('drags warehouse equipment into the unallocated tray and removes both staged and installed equipment through the warehouse', async () => {
    const f = await create();
    Object.assign(f.root.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh' });
    // Keep the desktop surfaces side by side even in a small headless viewport.
    Object.assign(f.root.querySelector<HTMLElement>('.workshop-body')!.style, {
      display: 'grid',
      gridTemplateColumns: '290px minmax(0, 1fr)',
      gridTemplateRows: 'minmax(0, 1fr)',
      flex: '1',
      overflow: 'hidden',
    });
    f.root.querySelector<HTMLElement>('.construction-shell')!.style.overflow = 'hidden';
    f.root.querySelector<HTMLElement>('.workshop-sidebar')!.style.overflow = 'hidden';
    f.root.querySelector<HTMLElement>('.construction-workspace')!.style.overflow = 'auto';
    for (const element of f.root.querySelectorAll<HTMLElement>('.workshop-header, .workshop-footer, .design-summary')) {
      element.style.display = 'none';
    }
    f.editor.query.set(ac.name);
    f.root.querySelector<HTMLElement>('.unallocated-panel summary')!.click();
    f.view.detectChanges();
    await f.view.whenStable();
    try {
      const warehouse = f.root.querySelector<HTMLElement>('.warehouse')!;
      const catalogRow = () =>
        [...f.root.querySelectorAll<HTMLElement>('.warehouse-item')].find(
          (row) => row.querySelector('.equipment-label')?.textContent?.trim() === ac.name,
        )!;
      catalogRow().scrollIntoView({ block: 'center' });
      await drag(f, catalogRow(), f.root.querySelector<HTMLElement>('.unallocated-drop-zone')!);
      const staged = f.editor.unallocated()[0];
      expect(f.editor.canPlaceSelectedEquipment()).toBeFalse();
      expect(f.root.querySelector('.placement-ready, .placement-selected')).toBeNull();
      expect(staged.equipmentId).toBe(ac.id);
      expect(staged.allocation.kind).toBe('unallocated');
      expect(
        f.editor
          .entity()
          .equipment()
          .filter((mount) => mount.equipmentId === ac.id).length,
      ).toBe(2);
      expect(catalogRow()).toBeDefined();
      await drag(
        f,
        f.root.querySelector<HTMLElement>('.unallocated-equipment')!,
        warehouse.querySelector<HTMLElement>('.warehouse-heading')!,
      );
      expect(f.editor.unallocated()).toEqual([]);
      expect(
        f.editor
          .entity()
          .equipment()
          .filter((mount) => mount.equipmentId === ac.id).length,
      ).toBe(1);
      f.editor.undo();
      expect(f.editor.unallocated().map((mount) => mount.equipmentId)).toEqual([ac.id]);
      f.editor.redo();
      f.editor.query.set('No matching equipment');
      f.view.detectChanges();
      await f.view.whenStable();
      expect(f.editor.filteredEquipment()).toEqual([]);
      const installed = f.root.querySelector<HTMLElement>('[data-location="LT"] .installed-equipment')!;
      installed.scrollIntoView({ block: 'center' });
      await drag(f, installed, warehouse.querySelector<HTMLElement>('.equipment-list')!);
      expect(
        f.editor
          .entity()
          .equipment()
          .some((mount) => mount.equipmentId === ac.id),
      ).toBeFalse();
      expect(f.root.querySelector('[data-location="LT"] .installed-equipment')).toBeNull();
      expect(f.editor.selectedMount()).toBeNull();
      f.editor.undo();
      expect(
        f.editor
          .entity()
          .equipment()
          .find((mount) => mount.equipmentId === ac.id)?.location,
      ).toBe('LT');
      expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
    } finally {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      f.root.removeAttribute('style');
    }
  });

  it('stages equipment without requiring space in the selected location and records one undo step', async () => {
    const f = await create();
    f.editor.selectedLocation.set('HD');
    const item = { data: { equipmentId: splitAc.id } };
    f.editor.onUnallocatedDrop({ item, isPointerOverContainer: false });
    expect(f.editor.unallocated()).toEqual([]);
    f.editor.onUnallocatedDrop({ item, isPointerOverContainer: true });
    expect(f.editor.unallocated().map((mount) => mount.equipmentId)).toEqual([splitAc.id]);
    expect(f.editor.canPlaceSelectedEquipment()).toBeFalse();
    expect(f.editor.selectedMount()?.allocation.kind).toBe('unallocated');
    expect(f.editor.selectedMount()?.placements).toBeUndefined();
    f.editor.undo();
    expect(f.editor.unallocated()).toEqual([]);
    f.editor.redo();
    expect(f.editor.unallocated().map((mount) => mount.equipmentId)).toEqual([splitAc.id]);
    const staged = f.editor.unallocated()[0];
    f.editor.onWarehouseDrop({
      item: { data: { equipmentId: splitAc.id, mountId: staged.mountId } },
      isPointerOverContainer: false,
    });
    f.editor.onWarehouseDrop({ item });
    expect(f.editor.unallocated()).toEqual([staged]);
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
  });

  it('keeps optional unallocated inventory in session history but omits it from the saved draft', async () => {
    const f = await create();
    f.editor.uninstall(
      f.editor
        .entity()
        .equipment()
        .find((mount) => mount.equipmentId === ac.id)!,
    );
    const draft = encodeNativeEntity(f.editor.entity());
    expect(
      parseEntity(draft, 'draft.mtf', registry)
        .entity.equipment()
        .some((mount) => mount.equipmentId === ac.id),
    ).toBeFalse();
    f.editor.undo();
    expect(
      f.editor
        .entity()
        .equipment()
        .find((mount) => mount.equipmentId === ac.id)?.location,
    ).toBe('LT');
    f.editor.redo();
    expect(f.editor.unallocated().map((mount) => mount.equipmentId)).toEqual([ac.id]);
    f.view.detectChanges();
    f.root.querySelector<HTMLButtonElement>('.unallocated-equipment .remove-mount')!.click();
    expect(f.editor.unallocated()).toEqual([]);
    f.editor.undo();
    expect(f.editor.unallocated().map((mount) => mount.equipmentId)).toEqual([ac.id]);
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
  });

  it('removes all removable unallocated equipment in one undo step while preserving required and installed mounts', async () => {
    const f = await create({ ammo: true, material: 'endo', missingMaterial: true });
    const button = () => f.root.querySelector<HTMLButtonElement>('.unallocated-panel summary .remove-all-unallocated');
    const required = f.editor.unallocated().find((mount) => mount.equipmentId === endo.id)!;
    const installedAmmo = f.editor
      .entity()
      .equipment()
      .find((mount) => mount.equipmentId === ammo.id)!;
    expect(button()).toBeNull();
    f.editor.uninstall(
      f.editor
        .entity()
        .equipment()
        .find((mount) => mount.equipmentId === ac.id)!,
    );
    f.editor.onUnallocatedDrop({ item: { data: { equipmentId: srm.id } }, isPointerOverContainer: true });
    f.editor.onUnallocatedDrop({ item: { data: { equipmentId: srm.id } }, isPointerOverContainer: true });
    const stagedIds = f.editor.removableUnallocated().map((mount) => mount.mountId);
    expect(stagedIds.length).toBe(3);
    f.view.detectChanges();
    expect(button()?.textContent?.trim()).toBe('Remove all');
    f.root.querySelector<HTMLButtonElement>('.unallocated-equipment:last-child .unallocated-name')!.click();
    f.view.detectChanges();
    expect(f.editor.selectedMount()).not.toBeNull();
    const panel = f.root.querySelector<HTMLDetailsElement>('.unallocated-panel')!;
    expect(panel.open).toBeTrue();
    button()!.click();
    f.view.detectChanges();
    expect(panel.open).toBeTrue();
    expect(f.editor.unallocated()).toEqual([required]);
    expect(f.editor.entity().equipment()).toContain(installedAmmo);
    expect(
      f.editor
        .entity()
        .equipment()
        .some((mount) => stagedIds.includes(mount.mountId)),
    ).toBeFalse();
    expect(f.editor.selectedMountId()).toBeNull();
    expect(f.root.querySelector('.installed-inspector')).toBeNull();
    expect(button()).toBeNull();
    f.editor.undo();
    f.view.detectChanges();
    expect(f.editor.removableUnallocated().map((mount) => mount.equipmentId)).toEqual([ac.id, srm.id, srm.id]);
    expect(button()).not.toBeNull();
    f.editor.redo();
    f.view.detectChanges();
    expect(f.editor.unallocated().map((mount) => mount.equipmentId)).toEqual([endo.id]);
    expect(button()).toBeNull();
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
  });

  it('hides bulk removal for empty or locked unallocated equipment and keeps a collapsed tray collapsed', async () => {
    const f = await create();
    const button = () => f.root.querySelector<HTMLButtonElement>('.remove-all-unallocated');
    expect(button()).toBeNull();
    f.editor.uninstall(
      f.editor
        .entity()
        .equipment()
        .find((mount) => mount.equipmentId === ac.id)!,
    );
    const staged = f.editor.unallocated()[0];
    f.editor.setDesignEditing(false);
    f.view.detectChanges();
    expect(button()).toBeNull();
    f.editor.removeAllUnallocated();
    expect(f.editor.unallocated()).toEqual([staged]);
    f.editor.setDesignEditing(true);
    f.editor.unallocatedOpen.set(false);
    f.view.detectChanges();
    expect(button()).not.toBeNull();
    button()!.click();
    f.view.detectChanges();
    expect(f.editor.unallocated()).toEqual([]);
    expect(button()).toBeNull();
    expect(f.root.querySelector<HTMLDetailsElement>('.unallocated-panel')!.open).toBeFalse();
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
  });

  for (const material of ['endo', 'stealth'] as const) {
    it(`restores missing ${material} reservations from the chassis and protects them from removal`, async () => {
      const f = await create({ material, missingMaterial: true });
      const equipment = material === 'endo' ? endo : stealth;
      const mount = f.editor.unallocated().find((mount) => mount.equipmentId === equipment.id)!;
      expect(mount).toBeDefined();
      expect(f.editor.requiredMount(mount)).toBeTrue();
      const chip = f.root.querySelector<HTMLElement>('.unallocated-equipment')!;
      expect(chip.querySelector('.remove-mount')).toBeNull();
      expect(f.root.querySelector('.remove-all-unallocated')).toBeNull();
      chip.querySelector<HTMLButtonElement>('.unallocated-name')!.click();
      f.view.detectChanges();
      expect(f.root.querySelector<HTMLButtonElement>('.remove-equipment')?.disabled).toBeTrue();
      expect(f.root.querySelector<HTMLButtonElement>('.install-equipment')?.disabled).toBeFalse();
      f.editor.remove(mount);
      f.editor.removeAllUnallocated();
      f.editor.onWarehouseDrop({ item: { data: { equipmentId: equipment.id, mountId: mount.mountId } } });
      expect(f.editor.unallocated().length).toBe(1);
      f.root.querySelector<HTMLButtonElement>('.install-equipment')!.click();
      expect(f.editor.status()).toBe('');
      const installed = f.editor.selectedMount()!;
      expect(installed.mountId).toBe(mount.mountId);
      expect(installed.placements?.length).toBe(material === 'endo' ? 14 : 12);
      if (material === 'stealth') {
        for (const location of ['LA', 'RA', 'LL', 'RL', 'LT', 'RT']) {
          expect(installed.placements?.filter((placement) => placement.location === location).length).toBe(2);
        }
      }
      f.editor.uninstall(installed);
      expect(f.editor.unallocated().length).toBe(1);
      expect(
        f.editor
          .entity()
          .equipment()
          .filter((mount) => mount.equipmentId === equipment.id).length,
      ).toBe(1);
      f.editor.undo();
      expect(
        f.editor
          .entity()
          .equipment()
          .find((mount) => mount.equipmentId === equipment.id)?.placements?.length,
      ).toBe(material === 'endo' ? 14 : 12);
      f.editor.redo();
      expect(f.editor.unallocated().map((mount) => mount.equipmentId)).toEqual([equipment.id]);
    });
  }

  it('recognizes material aliases in loaded critical slots without duplicating the required component', async () => {
    const f = await create({ material: 'endo', materialAlias: true });
    const mount = f.editor
      .entity()
      .equipment()
      .find((mount) => mount.equipmentId === endo.name)!;
    expect(mount).toBeDefined();
    expect(f.editor.unallocated()).toEqual([]);
    expect(f.editor.requiredMount(mount)).toBeTrue();
    expect(f.editor.validation().messages.some((message) => message.code === 'MATERIAL_CRITICALS')).toBeFalse();
    f.editor.uninstall(mount);
    expect(f.editor.unallocated().map((mount) => mount.mountId)).toEqual([mount.mountId]);
    f.editor.onDrop({
      item: { data: { equipmentId: endo.name, mountId: mount.mountId } },
      container: { data: { location: 'RT' } },
      isPointerOverContainer: true,
    });
    expect(
      f.editor
        .entity()
        .equipment()
        .filter((mount) => mount.equipment?.id === endo.id).length,
    ).toBe(1);
    expect(f.editor.selectedMount()?.placements?.length).toBe(12);
    expect(f.editor.selectedSpread()?.remaining).toBe(2);
    expect(f.editor.status()).toBe('');
  });

  it('edits spreadable slots by location, exposes the remainder, and keeps one component identity', async () => {
    const f = await create({ material: 'endo', missingMaterial: true });
    f.root.querySelector<HTMLButtonElement>('.unallocated-name')!.click();
    f.view.detectChanges();
    const mountId = f.editor.selectedMount()!.mountId;
    const inspector = f.root.querySelector<HTMLElement>('.installed-inspector')!;
    expect(inspector.querySelector('[aria-label="Equipment location"]')).toBeNull();
    expect(
      [...inspector.querySelectorAll('.mount-controls label')].some((label) =>
        label.textContent?.trim().startsWith('Size'),
      ),
    ).toBeFalse();
    expect(inspector.querySelector('.spread-heading')?.textContent).toContain('/ 14 assigned');
    expect(inspector.querySelectorAll('.spread-location').length).toBe(8);
    const count = inspector.querySelector<HTMLInputElement>('#spread-slots-LT')!;
    count.value = '3';
    count.dispatchEvent(new Event('change'));
    f.view.detectChanges();
    expect(f.editor.selectedMount()?.mountId).toBe(mountId);
    expect(f.editor.selectedSpread()?.remaining).toBe(11);
    expect(f.editor.isMountUnallocated(f.editor.selectedMount()!)).toBeFalse();
    expect(f.root.querySelector('.unallocated-slot-count')?.textContent).toContain('11 slots unallocated');
    expect(inspector.querySelector('.uninstall-equipment')?.textContent?.trim()).toBe('UNINSTALL ALL');
    inspector.querySelector<HTMLButtonElement>('[aria-label="Unallocate one slot from Left Torso"]')!.click();
    f.view.detectChanges();
    inspector.querySelector<HTMLButtonElement>('[aria-label="Allocate one slot to Right Arm"]')!.click();
    f.view.detectChanges();
    expect(f.editor.selectedSpread()?.locations.find((location) => location.id === 'LT')?.count).toBe(2);
    expect(f.editor.selectedSpread()?.locations.find((location) => location.id === 'RA')?.count).toBe(1);
    expect(
      f.editor
        .entity()
        .equipment()
        .filter((mount) => mount.equipment?.id === endo.id).length,
    ).toBe(1);
    count.value = '';
    count.dispatchEvent(new Event('change'));
    expect(count.value).toBe('2');
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
    // The counts remain usable inside the narrow desktop inspector as well as its mobile dialog.
    inspector.style.width = '300px';
    expect(inspector.scrollWidth).toBeLessThanOrEqual(inspector.clientWidth);
    for (const row of inspector.querySelectorAll<HTMLElement>('.spread-location')) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
    }
  });

  it('keeps placement explicit through allocation edits and history changes', async () => {
    const f = await create({ material: 'endo', missingMaterial: true });
    f.editor.inspectMount(f.editor.unallocated()[0]);
    f.editor.setSpreadSlots('LT', 2);
    expect(f.editor.canPlaceSelectedEquipment()).toBeFalse();
    f.editor.selectMount(f.editor.selectedMount()!);
    f.editor.clickSlot('RA', 10);
    expect(f.editor.canPlaceSelectedEquipment()).toBeFalse();
    f.editor.undo();
    expect(f.editor.canPlaceSelectedEquipment()).toBeFalse();
    f.editor.redo();
    expect(f.editor.canPlaceSelectedEquipment()).toBeFalse();
    const mount = f.editor
      .entity()
      .equipment()
      .find((item) => item.equipment?.id === endo.id)!;
    f.editor.selectMount(mount);
    expect(f.editor.canPlaceSelectedEquipment()).toBeTrue();
    f.editor.uninstall(mount);
    expect(f.editor.canPlaceSelectedEquipment()).toBeFalse();
    f.editor.setSpreadSlots('RT', 2);
    expect(f.editor.canPlaceSelectedEquipment()).toBeFalse();
  });

  it('allocates a single slot when clicking an empty slot and auto-fills without moving manual assignments', async () => {
    const f = await create({ material: 'endo', missingMaterial: true });
    f.editor.selectMount(f.editor.unallocated()[0]);
    f.editor.clickSlot('RA', 10);
    expect(f.editor.selectedMount()?.placements).toEqual([{ location: 'RA', slotIndex: 10 }]);
    expect(f.editor.canPlaceSelectedEquipment()).toBeFalse();
    f.editor.selectMount(f.editor.unallocated()[0]);
    f.editor.clickSlot('LT', 8);
    const manual = [...f.editor.selectedMount()!.placements!];
    expect(f.editor.selectedSpread()?.remaining).toBe(12);
    f.editor.autoAllocateSpread();
    expect(f.editor.selectedMount()?.placements?.length).toBe(14);
    for (const placement of manual) expect(f.editor.selectedMount()?.placements).toContain(placement);
    expect(f.editor.unallocated()).toEqual([]);
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
  });

  it('uninstalls only the clicked spread block, including a fragment separated by system slots', async () => {
    const f = await create({ material: 'endo', missingMaterial: true, gyro: 'Compact' });
    f.editor.selectMount(f.editor.unallocated()[0]);
    f.editor.setSpreadSlots('LT', 3);
    for (const slotIndex of [10, 11, 5]) {
      f.editor.selectMount(f.editor.unallocated()[0]);
      f.editor.clickSlot('CT', slotIndex);
    }
    f.view.detectChanges();
    const mountId = f.editor.selectedMount()!.mountId;
    const torso = f.editor.selectedMount()!.placements!.filter((p) => p.location === 'LT');
    const block = f.root.querySelector<HTMLElement>(
      `[data-location="CT"] [data-slot-index="10"] [data-mount-id="${mountId}"]`,
    )!;
    expect(block.querySelector('.spread-block-count')?.textContent).toContain('2 slots');
    block.querySelector<HTMLButtonElement>('.uninstall-mount')!.click();
    f.view.detectChanges();
    expect(f.editor.canPlaceSelectedEquipment()).toBeFalse();
    expect(f.root.querySelector('.placement-ready, .placement-hint, .placement-selected')).toBeNull();
    expect(f.root.querySelector('.unallocated-name')?.getAttribute('aria-pressed')).toBe('false');
    expect(f.editor.selectedMount()?.mountId).toBe(mountId);
    expect(f.editor.selectedMount()?.placements?.filter((p) => p.location === 'CT').length).toBe(1);
    expect(f.editor.selectedMount()?.placements?.filter((p) => p.location === 'LT')).toEqual(torso);
    expect(f.editor.selectedSpread()?.remaining).toBe(10);
    expect(f.root.querySelector('.unallocated-slot-count')?.textContent).toContain('10 slots unallocated');
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
  });

  it('moves one spread block between locations and between the grid and its partial pool', async () => {
    const f = await create({ material: 'endo', missingMaterial: true });
    const mountId = f.editor.unallocated()[0].mountId;
    f.editor.selectMount(f.editor.unallocated()[0]);
    f.editor.setSpreadSlots('LT', 3);
    f.editor.setSpreadSlots('RA', 4);
    const arm = f.editor.selectedMount()!.placements!.filter((p) => p.location === 'RA');
    const start = f.editor.selectedMount()!.placements!.find((p) => p.location === 'LT')!.slotIndex;
    const data = { equipmentId: endo.id, mountId, sourceLocation: 'LT', sourceSlotIndex: start, slotCount: 3 };
    f.editor.startDrag(data);
    f.editor.dragTarget.set({ location: 'RT' });
    expect(f.editor.dropPlans().get('RT')?.issue).toBe('');
    expect(f.editor.dropPreview().every((row) => row.location === 'RT')).toBeTrue();
    expect(f.editor.dropPreview().reduce((count, row) => count + row.span, 0)).toBe(3);
    f.editor.onDrop({ item: { data }, container: { data: { location: 'RT' } } });
    f.editor.endDrag();
    expect(f.editor.selectedMount()?.placements?.filter((p) => p.location === 'RA')).toEqual(arm);
    expect(f.editor.selectedMount()?.placements?.some((p) => p.location === 'LT')).toBeFalse();
    expect(f.editor.selectedSpread()?.remaining).toBe(7);
    f.editor.onUnallocatedDrop({ item: { data: { ...data, sourceLocation: 'RT', sourceSlotIndex: 0 } } });
    expect(f.editor.selectedMount()?.placements).toEqual(arm);
    expect(f.editor.selectedSpread()?.remaining).toBe(10);
    expect(f.editor.canPlaceSelectedEquipment()).toBeFalse();
    // Dropping a partial pool back onto itself must not uninstall its mounted slots.
    f.editor.onUnallocatedDrop({ item: { data: { equipmentId: endo.id, mountId } } });
    expect(f.editor.selectedMount()?.placements).toEqual(arm);
    f.editor.onDrop({ item: { data: { equipmentId: endo.id, mountId } }, container: { data: { location: 'RA' } } });
    expect(f.editor.selectedSpread()?.locations.find((location) => location.id === 'RA')?.count).toBe(8);
    expect(f.editor.selectedSpread()?.remaining).toBe(6);
    expect(f.editor.selectedMount()?.placements?.every((p) => p.location === 'RA')).toBeTrue();
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
  });

  it('shows prescribed Stealth shares and accepts only the remaining slots that fit a location', async () => {
    const f = await create({ material: 'stealth', missingMaterial: true });
    f.root.querySelector<HTMLButtonElement>('.unallocated-name')!.click();
    f.view.detectChanges();
    const mountId = f.editor.selectedMount()!.mountId;
    expect(f.root.querySelectorAll('.spread-location').length).toBe(6);
    expect(f.root.querySelector('[data-spread-location="HD"]')).toBeNull();
    expect(f.root.querySelector('[data-spread-location="CT"]')).toBeNull();
    expect(
      [...f.root.querySelectorAll('.spread-location small')].every((label) => label.textContent === '2 required'),
    ).toBeTrue();
    f.editor.onDrop({ item: { data: { equipmentId: stealth.id, mountId } }, container: { data: { location: 'LT' } } });
    f.view.detectChanges();
    expect(f.editor.selectedSpread()?.allocated).toBe(2);
    expect(f.editor.selectedSpread()?.remaining).toBe(10);
    expect(
      f.root.querySelector<HTMLButtonElement>('[aria-label="Allocate one slot to Left Torso"]')?.disabled,
    ).toBeTrue();
    const torso = [...f.editor.selectedMount()!.placements!];
    f.editor.startDrag({ equipmentId: stealth.id, mountId });
    expect(f.editor.dropPlans().get('LT')?.issue).toContain('0 more');
    expect(f.editor.dropPlans().get('HD')?.issue).toContain('cannot allocate');
    f.editor.endDrag();
    f.root.querySelector<HTMLButtonElement>('.spread-auto')!.click();
    f.view.detectChanges();
    expect(f.editor.selectedSpread()?.remaining).toBe(0);
    for (const placement of torso) expect(f.editor.selectedMount()?.placements).toContain(placement);
    expect(
      f.editor
        .selectedSpread()
        ?.locations.filter((location) => location.limit)
        .every((location) => location.count === 2),
    ).toBeTrue();
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
  });

  it('reconstructs the remainder of a partially allocated required system when reopening its native draft', async () => {
    const f = await create({ material: 'endo', missingMaterial: true });
    f.editor.selectMount(f.editor.unallocated()[0]);
    f.editor.setSpreadSlots('LT', 3);
    f.editor.setSpreadSlots('RA', 2);
    const source = encodeNativeEntity(f.editor.entity());
    const reopened = parseEntity(source, 'partial.mtf', registry).entity;
    f.editor.entity.set(reopened);
    f.view.detectChanges();
    const mount = f.editor.unallocated().find((mount) => mount.equipment?.id === endo.id)!;
    expect(mount.placements?.length).toBe(5);
    expect(f.editor.spreadAllocation(mount)?.remaining).toBe(9);
    expect(f.root.querySelector('.unallocated-slot-count')?.textContent).toContain('9 slots unallocated');
    f.editor.selectMount(mount);
    f.editor.setSpreadSlots('RA', 3);
    f.editor.undo();
    expect(f.editor.spreadAllocation(f.editor.unallocated()[0])?.remaining).toBe(9);
    f.editor.redo();
    expect(f.editor.spreadAllocation(f.editor.unallocated()[0])?.remaining).toBe(8);
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
  });

  it('locks allocation controls on fixed designs while retaining authored size controls for ordinary equipment', async () => {
    const f = await create({ material: 'endo', editDesign: false });
    const mount = f.editor
      .entity()
      .equipment()
      .find((mount) => mount.equipment?.id === endo.id)!;
    f.editor.selectMount(mount);
    f.editor.inspector.open(f.root);
    f.view.detectChanges();
    expect(
      [...f.root.querySelectorAll<HTMLInputElement>('.spread-stepper input')].every((input) => input.disabled),
    ).toBeTrue();
    expect(
      [...f.root.querySelectorAll<HTMLButtonElement>('.spread-stepper button')].every((button) => button.disabled),
    ).toBeTrue();
    const placements = mount.placements;
    f.editor.setSpreadSlots('LT', 0);
    expect(f.editor.selectedMount()?.placements).toEqual(placements);
    const cargo = new MiscEquipment({
      id: 'Cargo',
      name: 'Cargo',
      type: 'misc',
      stats: { tonnage: 'variable', criticalSlots: 1 },
      flags: ['F_CARGO'],
    });
    expect(f.editor.hasEditableSize(cargo)).toBeTrue();
    expect(f.editor.hasEditableSize(endo)).toBeFalse();
    expect(f.editor.hasEditableSize(stealth)).toBeFalse();
  });

  it('uninstalls a complete split weapon and keeps required materials when stripping equipment', async () => {
    const f = await create({ material: 'endo', missingMaterial: true });
    f.editor.install(splitAc, 'RA');
    const split = f.editor.selectedMount()!;
    expect(new Set(split.placements?.map((placement) => placement.location)).size).toBe(2);
    f.editor.uninstall(split);
    expect(f.editor.unallocated().find((mount) => mount.mountId === split.mountId)?.placements).toBeUndefined();
    expect(
      f.editor.locations().every((location) => location.slots.every((slot) => slot.mount?.mountId !== split.mountId)),
    ).toBeTrue();
    f.editor.stripEquipment();
    expect(f.editor.unallocated().map((mount) => mount.equipmentId)).toEqual([endo.id]);
    expect(
      f.editor
        .entity()
        .equipment()
        .filter((mount) => mount.allocation.kind === 'engine').length,
    ).toBe(10);
  });

  it('protects fixed designs and integral equipment from uninstallation', async () => {
    const f = await create({ editDesign: false });
    const gun = f.editor
      .entity()
      .equipment()
      .find((mount) => mount.equipmentId === ac.id)!;
    f.editor.onUnallocatedDrop({
      item: { data: { equipmentId: ac.id, mountId: gun.mountId } },
      isPointerOverContainer: true,
    });
    f.editor.onUnallocatedDrop({ item: { data: { equipmentId: ac.id } }, isPointerOverContainer: true });
    f.editor.onWarehouseDrop({
      item: { data: { equipmentId: ac.id, mountId: gun.mountId } },
      isPointerOverContainer: true,
    });
    expect(f.editor.unallocated()).toEqual([]);
    expect(
      f.editor
        .entity()
        .equipment()
        .find((mount) => mount.mountId === gun.mountId),
    ).toBe(gun);
    expect(f.root.querySelector('[data-location="LT"] .uninstall-mount')).toBeNull();
    f.editor.setDesignEditing(true);
    const integral = f.editor
      .entity()
      .equipment()
      .find((mount) => mount.allocation.kind === 'engine')!;
    f.editor.uninstall(integral);
    f.editor.remove(integral);
    f.editor.onWarehouseDrop({ item: { data: { equipmentId: integral.equipmentId, mountId: integral.mountId } } });
    expect(
      f.editor
        .entity()
        .equipment()
        .find((mount) => mount.mountId === integral.mountId),
    ).toBe(integral);
    expect(f.editor.unallocated()).toEqual([]);
  });

  it('shows a staged custom ammo name, marker and primary color, then clears them for the original loadout', async () => {
    const f = await create({ ammo: true, editDesign: false });
    const mountedName = () => f.root.querySelector<HTMLButtonElement>('[data-location="RT"] .mounted-name')!;
    mountedName().click();
    f.view.detectChanges();
    const dialogs = TestBed.inject(DialogsService);
    for (const [equipment, quantity, name] of [
      [flak, 7, '*Flak Test AC Ammo (7)'],
      [ammo, 20, 'Test AC Ammo (20)'],
    ] as const) {
      (dialogs.createDialog as jasmine.Spy).and.returnValue({ closed: of({ name: equipment.id, quantity }) });
      await f.editor.setRuntimeAmmo();
      f.view.detectChanges();
      expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
      expect(dialogs.createDialog).toHaveBeenCalledWith(
        SetAmmoDialogComponent,
        jasmine.objectContaining({
          data: jasmine.objectContaining({ originalAmmo: ammo, originalTotalAmmo: 20 }),
        }),
      );
      expect(mountedName().textContent).toContain(name);
      expect(mountedName().title).toContain(name);
      const customLabel = mountedName().querySelector('.customAmmoLoadout');
      expect(!!customLabel).toBe(equipment === flak);
      if (customLabel) expect(getComputedStyle(customLabel).color).toBe('rgb(154, 154, 255)');
      const source = f.editor.repairSnapshot()!;
      if (!hasMekRuntime(source)) throw new Error('Expected a Mek runtime');
      const sheet = projectMekRecordSheet(
        source.entity,
        source.index,
        source.ruleset,
        source.state,
        source.query,
        emptyCBTEncounterSnapshot(),
        null,
      );
      const sheetAmmo = sheet.criticalSlots
        .flatMap((slot) => slot.components)
        .find((component) => component.ammo)?.ammo;
      expect(sheetAmmo).toEqual(
        jasmine.objectContaining({
          displayName: equipment === flak ? 'Flak Test AC Ammo' : 'Test AC Ammo',
          custom: equipment === flak,
          remaining: quantity,
        }),
      );
      const detailsAmmo = buildUnitComponentMetadata(source.entity, source.query).find(
        (component) => component.t === 'X',
      )!;
      expect(detailsAmmo.n).toBe(sheetAmmo!.displayName);
      expect(!!detailsAmmo.customAmmo).toBe(sheetAmmo!.custom);
      expect(detailsAmmo.q2).toBe(quantity);
    }
    expect(f.entity.equipment().find((mount) => mount.equipmentId === ammo.id)?.equipment).toBe(ammo);
  });

  for (const custom of [false, true]) {
    it(`renders the correct disabled and edited save actions for a ${custom ? 'custom' : 'core'} force unit`, async () => {
      const f = await create({ custom, editDesign: false });
      const primary = () => f.root.querySelector<HTMLButtonElement>('.save-actions .save-button')!;
      expect(primary().textContent?.trim()).toBe('CONFIRM');
      expect(primary().disabled).toBeTrue();
      expect(f.root.querySelector('.save-actions')?.textContent?.includes('DELETE')).toBe(custom);
      expect(f.root.querySelector('.save-actions')?.textContent).not.toContain('SAVE AS NEW');
      f.editor.setField(
        f.editor.fields().find((field) => field.id === 'model')!,
        'Locked change',
      );
      expect(f.editor.dirty()).toBeFalse();
      f.editor.setDesignEditing(true);
      f.editor.setField(
        f.editor.fields().find((field) => field.id === 'model')!,
        'A changed design',
      );
      f.view.detectChanges();
      await f.view.whenStable();
      expect(f.editor.effectiveBV()).not.toBeNull();
      expect(primary().textContent?.trim()).toBe(custom ? 'UPDATE REFIT' : 'SAVE NEW REFIT');
      expect(primary().disabled).toBeFalse();
      expect(f.root.querySelector('.save-actions')?.textContent?.includes('SAVE AS NEW')).toBe(custom);
      f.editor.undo();
      f.view.detectChanges();
      expect(primary().disabled).toBeTrue();
      expect(f.root.querySelector('.save-actions')?.textContent).not.toContain('SAVE AS NEW');
    });
  }

  it('keeps optional OEM year beside introduction year and aligns chassis checkboxes with select controls', async () => {
    const f = await create();
    f.editor.panel.set('systems');
    f.view.detectChanges();
    expect(f.root.querySelector('#construction-oem-year')).toBeNull();
    const toggle = f.root.querySelector<HTMLButtonElement>('.oem-year-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('OEM year');
    expect(toggle.querySelector('.chevron.collapsed')).not.toBeNull();
    toggle.closest<HTMLElement>('.system-panel')!.style.width = '280px';
    const column = toggle.closest<HTMLElement>('.year-fields')!.getBoundingClientRect();
    const heading = toggle.closest<HTMLElement>('.year-heading')!;
    for (const child of heading.children) {
      const bounds = child.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(column.left);
      expect(bounds.right).toBeLessThanOrEqual(column.right + 1);
    }
    toggle.click();
    f.view.detectChanges();
    await f.view.whenStable();
    expect(toggle.querySelector('.chevron.collapsed')).toBeNull();
    const input = () => f.root.querySelector<HTMLInputElement>('#construction-oem-year')!;
    expect(input().placeholder).toBe(String(f.editor.entity().year()));
    expect(input().value).toBe('');
    f.editor.setOemYear(3025);
    f.view.detectChanges();
    await f.view.whenStable();
    expect(input().value).toBe('3025');
    f.editor.setOemYear(f.editor.entity().year());
    f.view.detectChanges();
    await f.view.whenStable();
    expect(input().value).toBe('');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const select = f.root.querySelector<HTMLSelectElement>('select[aria-label="Tech base"]')!.getBoundingClientRect();
    const checkbox = f.root
      .querySelector<HTMLInputElement>('input[aria-label="Mixed technology"]')!
      .getBoundingClientRect();
    expect(Math.abs(checkbox.top + checkbox.height / 2 - select.top - select.height / 2)).toBeLessThan(1);
  });

  it('opens populated OEM years by default while keeping the force design input locked', async () => {
    const f = await create({ originalBuildYear: 3025, editDesign: false });
    f.editor.panel.set('systems');
    f.view.detectChanges();
    await f.view.whenStable();
    const input = f.root.querySelector<HTMLInputElement>('#construction-oem-year')!;
    expect(input.value).toBe('3025');
    expect(input.disabled).toBeTrue();
    expect(f.root.querySelector('.oem-year-toggle')!.getAttribute('aria-expanded')).toBe('true');
  });

  for (const ruleset of ['core-2026', 'total-warfare'] as const) {
    it(`shows construction points and repair gains for hardened armor and reinforced structure in ${ruleset}`, async () => {
      const f = await create({ editDesign: false, armor: true, doubleDamageProtection: true, ruleset });
      const index = f.instance.getIndex();
      const location = [...index.locations.values()].find((location) => location.code === 'LT')!;
      const other = [...index.locations.values()].find((location) => location.code === 'RT')!;
      const front = location.armorFaceIds.map((id) => index.armorFaces.get(id)!).find((face) => face.face === 'front')!;
      const rear = location.armorFaceIds.map((id) => index.armorFaces.get(id)!).find((face) => face.face === 'rear')!;
      const member = f.editor.forceMember()!;
      const structure = f.entity.structureValues().get('LT')!;
      const totalStructure = f.entity.totalInternalPoints();
      const totalArmor = f.entity.totalArmorPoints();
      const searchIndex = TestBed.inject(UnitSearchIndexService);
      const reference = { ...f.editor.designSummary(), origin: 'megamek' as const, isCustom: false };
      searchIndex.commitPreparedCatalogIndexes(searchIndex.prepareCatalogIndexes([reference], [], []));
      for (const command of [
        { type: 'damage-internal', locationId: location.id, amount: 2, target: 'committed' },
        { type: 'damage-internal', locationId: other.id, amount: 1, target: 'committed' },
        { type: 'damage-armor', faceId: front.id, amount: 3, target: 'committed' },
        { type: 'damage-armor', faceId: rear.id, amount: 1, target: 'pending' },
      ] satisfies CBTUnitCommand[]) {
        expect((await f.force.dispatchUnitCommand(member.id, command)).accepted).toBeTrue();
      }
      f.view.detectChanges();
      await f.view.whenStable();
      expect(f.editor.internalRemaining('LT', structure)).toBe(structure - 1);
      expect(f.editor.internalRemaining('RT', f.entity.structureValues().get('RT')!)).toBe(
        f.entity.structureValues().get('RT')! - 1,
      );
      expect(f.editor.armorDamage('LT')).toBe(1.5);
      expect(f.editor.armorDamage('LT', 'rear')).toBe(0.5);
      const defense = f.root.querySelector<HTMLElement>('[data-location="LT"] .location-defense')!;
      expect([...defense.querySelectorAll('.armor-condition')].map((row) => row.textContent!.trim())).toEqual([
        '10.5 intact · 1.5 damaged',
        '5.5 intact · 0.5 damaged',
      ]);
      expect(f.editor.summaryStats().find((stat) => stat.label === 'Armor')?.value).toBe(totalArmor - 2);
      expect(f.editor.summaryStats().find((stat) => stat.label === 'Structure')?.value).toBe(totalStructure - 2);

      await f.force.dispatchUnitCommand(member.id, {
        type: 'damage-internal',
        locationId: location.id,
        amount: 1,
        target: 'pending',
      });
      expect(f.editor.internalRemaining('LT', structure)).toBe(structure - 1.5);
      await f.editor.repairDefense('LT', 'internal');
      await f.editor.repairDefense('LT', 'front');
      f.view.detectChanges();
      await f.view.whenStable();
      expect(f.editor.internalRemaining('LT', structure)).toBe(structure);
      expect(f.editor.internalRepair('LT', structure)).toBe(1.5);
      expect(f.editor.armorDamage('LT')).toBe(0);
      expect(f.editor.armorRepair('LT')).toBe(1.5);
      expect(f.editor.armorDamage('LT', 'rear')).toBe(0.5);
      expect(defense.querySelector('.structure-label .repair-gain')?.textContent).toBe('+1.5');
      expect(f.editor.summaryStats().find((stat) => stat.label === 'Armor')).toEqual(
        jasmine.objectContaining({
          value: totalArmor - 0.5,
          pendingRepair: 1.5,
        }),
      );
      expect(f.editor.summaryStats().find((stat) => stat.label === 'Structure')).toEqual(
        jasmine.objectContaining({
          value: totalStructure - 1,
          pendingRepair: 1.5,
        }),
      );
      f.editor.undo();
      expect(f.editor.armorDamage('LT')).toBe(1.5);
      expect(f.editor.armorRepair('LT')).toBe(0);
      f.editor.redo();
      expect(f.editor.armorRepair('LT')).toBe(1.5);
      expect(f.instance.query().remainingInternal(location.id, 'preview')).toBe(structure * 2 - 3);
      expect(f.instance.query().remainingArmor(front.id, 'preview')).toBe(21);
    });
  }

  it('repairs individual armor facings and structure while locked, retaining other damage and undo history', async () => {
    const f = await create({ editDesign: false, armor: true });
    const index = f.instance.getIndex();
    const location = [...index.locations.values()].find((location) => location.code === 'LT')!;
    const otherLocation = [...index.locations.values()].find((location) => location.code === 'RT')!;
    const front = [...index.armorFaces.values()].find(
      (face) => face.locationId === location.id && face.face === 'front',
    )!;
    const rear = [...index.armorFaces.values()].find(
      (face) => face.locationId === location.id && face.face === 'rear',
    )!;
    const member = f.editor.forceMember()!;
    for (const command of [
      { type: 'damage-armor', faceId: front.id, amount: 4, target: 'committed' },
      { type: 'damage-armor', faceId: front.id, amount: 2, target: 'pending' },
      { type: 'damage-armor', faceId: rear.id, amount: 2, target: 'committed' },
      { type: 'damage-internal', locationId: location.id, amount: 3, target: 'committed' },
      { type: 'damage-internal', locationId: otherLocation.id, amount: 2, target: 'pending' },
    ] satisfies CBTUnitCommand[])
      await f.force.dispatchUnitCommand(member.id, command);
    f.view.detectChanges();
    await f.view.whenStable();
    const defense = f.root.querySelector<HTMLElement>('[data-location="LT"] .location-defense')!;
    expect(defense.querySelector('[aria-label^="Increase "]')).toBeNull();
    expect(defense.querySelector('[aria-label^="Decrease "]')).toBeNull();
    expect(defense.querySelectorAll('.armor-repair-button').length).toBe(2);
    const damage = defense.querySelector<HTMLElement>('.structure-damage')!;
    expect(parseFloat(damage.style.width)).toBeCloseTo((3 / location.internalPoints) * 100);
    const config = defense.querySelector<HTMLDetailsElement>('.location-config')!;
    const expectAlignedDisclosure = () => {
      const heading = defense.querySelector<HTMLElement>('.structure-label')!.getBoundingClientRect();
      const disclosure = defense.querySelector<HTMLElement>('.structure-disclosure')!.getBoundingClientRect();
      expect(Math.abs(disclosure.top + disclosure.height / 2 - heading.top - heading.height / 2)).toBeLessThan(2);
    };
    expectAlignedDisclosure();
    config.querySelector<HTMLElement>('summary')!.click();
    expect(config.open).toBeTrue();
    expectAlignedDisclosure();
    defense.querySelector<HTMLButtonElement>('.armor-repair-button')!.click();
    await f.view.whenStable();
    f.view.detectChanges();
    expect(f.editor.armorDamage('LT')).toBe(0);
    expect(f.editor.armorRepair('LT')).toBe(6);
    expect(f.editor.armorDamage('LT', 'rear')).toBe(2);
    expect(f.editor.internalRemaining('LT', location.internalPoints)).toBe(location.internalPoints - 3);
    expect(f.editor.pendingRepairQuote()?.spCost).toBe(f.entity.tonnage() * 2);
    expect(f.instance.query().remainingArmor(front.id, 'preview')).toBe(front.maximumPoints - 6);
    f.editor.undo();
    expect(f.editor.armorDamage('LT')).toBe(6);
    expect(f.editor.pendingRepairQuote()).toBeNull();
    f.editor.redo();
    f.view.detectChanges();
    expect(f.editor.armorRepair('LT')).toBe(6);
    defense.querySelector<HTMLButtonElement>('.structure-repair-button')!.click();
    await f.view.whenStable();
    f.view.detectChanges();
    expect(config.open).toBeTrue();
    expectAlignedDisclosure();
    expect(f.editor.internalRemaining('LT', location.internalPoints)).toBe(location.internalPoints);
    expect(f.editor.internalRepair('LT', location.internalPoints)).toBe(3);
    expect(defense.querySelector('.structure-label .repair-gain')?.textContent).toBe('+3');
    expect(defense.querySelector('.structure-repair-button')).toBeNull();
    expect(f.editor.internalRemaining('RT', otherLocation.internalPoints)).toBe(otherLocation.internalPoints - 2);
    defense.querySelector<HTMLButtonElement>('.armor-repair-button')!.click();
    await f.view.whenStable();
    f.view.detectChanges();
    expect(f.editor.armorDamage('LT', 'rear')).toBe(0);
    expect(f.editor.armorRepair('LT', 'rear')).toBe(2);
    expect(defense.querySelector('.armor-repair-button')).toBeNull();
    expect(f.editor.entity().getArmorValue('LT', 'front')).toBe(12);
    expect(f.editor.entity().getArmorValue('LT', 'rear')).toBe(6);
    expect(f.force.repairMember).not.toHaveBeenCalled();
    expect(f.instance.query().remainingInternal(location.id, 'preview')).toBe(location.internalPoints - 3);
  });

  it('denies read-only defense repairs and hides runtime structure bars for standalone designs', async () => {
    const f = await create({ editDesign: false, armor: true });
    const index = f.instance.getIndex();
    const location = [...index.locations.values()].find((location) => location.code === 'LT')!;
    const face = [...index.armorFaces.values()].find(
      (face) => face.locationId === location.id && face.face === 'front',
    )!;
    await f.force.dispatchUnitCommand(f.editor.forceMember()!.id, {
      type: 'damage-armor',
      faceId: face.id,
      amount: 2,
      target: 'committed',
    });
    await f.force.dispatchUnitCommand(f.editor.forceMember()!.id, {
      type: 'damage-internal',
      locationId: location.id,
      amount: 1,
      target: 'committed',
    });
    spyOn(f.force, 'readOnly').and.returnValue(true);
    f.view.detectChanges();
    await f.view.whenStable();
    expect(f.root.querySelector<HTMLButtonElement>('.armor-repair-button')!.disabled).toBeTrue();
    expect(f.root.querySelector<HTMLButtonElement>('.structure-repair-button')!.disabled).toBeTrue();
    await f.editor.repairDefense('LT', 'front');
    await f.editor.repairDefense('LT', 'internal');
    expect(f.force.previewConstructionRuntime).not.toHaveBeenCalled();
    expect(f.editor.runtimeChanged()).toBeFalse();
    expect(f.root.querySelector('.structure-track')).not.toBeNull();
    f.editor.forceMember.set(null);
    f.view.detectChanges();
    await f.view.whenStable();
    expect(f.root.querySelector('.structure-track')).toBeNull();
    expect(f.root.querySelector('.armor-repair-button')).toBeNull();
    expect(f.root.querySelector('.structure-repair-button')).toBeNull();
  });

  it('repairs all critical hits of the selected component after it moves in the draft', async () => {
    const f = await create();
    await f.hit('LT', 0);
    await f.hit('LT', 1, 'pending');
    await f.hit('CT', 0);
    const gun = f.editor
      .entity()
      .equipment()
      .find((mount) => mount.equipmentId === ac.id)!;
    f.root.querySelector<HTMLButtonElement>('[data-location="LT"] .mounted-name')!.click();
    f.editor.moveSelected('RT');
    f.view.detectChanges();
    expect(f.editor.selectedRepairQuote()?.cost).toBe(40000);
    expect(f.root.querySelector('.component-repair')?.textContent).toContain('40,000 C-Bills');
    await f.editor.repairSelected();
    f.view.detectChanges();
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
    expect(f.editor.mountCondition(f.editor.selectedMount()!.mountId)).toBe('');
    expect([...f.instance.snapshot().slots.values()].reduce((sum, slot) => sum + slot.hits, 0)).toBe(2);
    expect(f.instance.snapshot().pendingCombat.criticalHits.size).toBe(1);
    expect(f.editor.runtimeChanged()).toBeTrue();
    f.editor.undo();
    expect(f.editor.runtimeChanged()).toBeFalse();
    expect(f.editor.mountCondition(f.editor.selectedMount()?.mountId ?? gun.mountId)).not.toBe('');
  });

  it('requires confirmation for repair all and stages it only for the loaded unit', async () => {
    const f = await create();
    const confirmation = TestBed.inject(DialogsService).requestConfirmation as jasmine.Spy;
    await f.hit('LT', 0);
    await f.editor.repairAll();
    expect(confirmation.calls.mostRecent().args[0]).toContain('C-Bills');
    expect(f.force.repairMember).not.toHaveBeenCalled();
    confirmation.and.resolveTo(true);
    await f.editor.repairAll();
    expect(f.force.repairMember).not.toHaveBeenCalled();
    expect(f.force.previewConstructionRuntime).toHaveBeenCalledTimes(1);
    expect(f.editor.runtimeChanged()).toBeTrue();
    expect(f.editor.saveLabel()).toBe('SAVE');
    expect([...f.instance.snapshot().slots.values()].some((slot) => slot.hits > 0)).toBeTrue();
  });

  it('opens the canonical metric breakdowns from the header and weight summary', async () => {
    const f = await create();
    const dialog = TestBed.inject(DialogsService).createDialog as jasmine.Spy;
    for (const [kind, total] of [
      ['bv', f.editor.entity().battleValue()],
      ['cost', f.editor.entity().cost()],
      ['weight', f.editor.mass()],
    ] as const) {
      f.editor.showBreakdown(kind);
      f.view.detectChanges();
      expect(f.editor.breakdown()?.total).toBe(total!);
      expect(f.root.querySelector('#construction-details construction-breakdown')).not.toBeNull();
    }
    expect(dialog).not.toHaveBeenCalled();
    expect(f.root.querySelector('.workshop-header .workspace-tabs')).not.toBeNull();
  });

  it('overlays a slot-sized drop preview without moving the empty slots, and rejects insufficient space', async () => {
    const f = await create();
    const grid = f.root.querySelector<HTMLElement>('[data-location="RT"] .critical-grid')!;
    const empty = grid.querySelector<HTMLElement>('.empty-slot')!;
    const before = empty.getBoundingClientRect();
    const height = grid.getBoundingClientRect().height;
    f.editor.startDrag({ equipmentId: ac.id });
    f.editor.dragTarget.set({ location: 'RT' });
    f.view.detectChanges();
    const preview = grid.querySelector<HTMLElement>('.slot-drop-preview')!;
    expect(preview).not.toBeNull();
    expect(preview.style.gridRow).toBe('1 / span 3');
    expect(getComputedStyle(preview).position).toBe('absolute');
    expect(empty.getBoundingClientRect().top).toBe(before.top);
    expect(grid.getBoundingClientRect().height).toBe(height);
    f.editor.dragTarget.set({ location: 'HD' });
    f.view.detectChanges();
    expect(f.editor.dropPreview()).toEqual([]);
    expect(f.root.querySelector('[data-location="HD"] .drop-reason')?.textContent).toContain('contiguous');
    const count = f.editor.entity().equipment().length;
    f.editor.onDrop({ item: { data: { equipmentId: ac.id } }, container: { data: { location: 'HD' } } });
    expect(f.editor.entity().equipment().length).toBe(count);
    f.editor.endDrag();
  });

  it('previews the surrounding blocks in their committed order when dragging a block downward', async () => {
    const f = await create();
    f.editor.install(ammo, 'LT');
    const bin = f.editor.selectedMount()!;
    const gun = f.editor
      .entity()
      .equipment()
      .find((mount) => mount.equipmentId === ac.id)!;
    f.view.detectChanges();
    const binBlock = f.root.querySelector<HTMLElement>(`[data-mount-id="${bin.mountId}"]`)!.parentElement!;
    const before = binBlock.getBoundingClientRect().top;
    f.editor.startDrag({ equipmentId: ac.id, mountId: gun.mountId, sourceLocation: 'LT' });
    f.editor.dragTarget.set({ location: 'LT' });
    f.view.detectChanges();
    expect(binBlock.style.gridRow).toBe('1 / span 1');
    expect(binBlock.getBoundingClientRect().top).toBeLessThan(before);
    expect(f.editor.dropPreview()).toEqual([{ location: 'LT', index: 1, span: 3 }]);
    expect(gun.placements![0].slotIndex).toBe(0);
    f.editor.onDrop({
      item: { data: { equipmentId: ac.id, mountId: gun.mountId, sourceLocation: 'LT' } },
      container: { data: { location: 'LT' } },
    });
    f.editor.endDrag();
    f.view.detectChanges();
    expect(
      f.editor
        .entity()
        .equipment()
        .find((m) => m.mountId === bin.mountId)!.placements![0].slotIndex,
    ).toBe(0);
    expect(
      f.editor
        .entity()
        .equipment()
        .find((m) => m.mountId === gun.mountId)!.placements![0].slotIndex,
    ).toBe(1);
  });

  for (const source of ['warehouse', 'another location'] as const) {
    for (const position of ['top', 'middle'] as const) {
      it(`inserts equipment from ${source} at the ${position}, matching the preview and undoing as one edit`, async () => {
        const f = await create();
        f.editor.install(ammo, 'RT');
        const first = f.editor.selectedMount()!;
        f.editor.install(ammo, 'RT');
        const second = f.editor.selectedMount()!;
        if (source === 'another location') f.editor.install(ac, 'RA');
        const incoming = source === 'another location' ? f.editor.selectedMount()! : undefined;
        const count = f.editor.entity().equipment().length;
        const before = encodeNativeEntity(f.editor.entity());
        const beforeMountId = position === 'top' ? first.mountId : second.mountId;
        const data = { equipmentId: ac.id, mountId: incoming?.mountId, sourceLocation: incoming ? 'RA' : undefined };
        f.view.detectChanges();
        f.editor.startDrag(data);
        f.editor.dragTarget.set({ location: 'RT', beforeMountId });
        f.view.detectChanges();
        expect(f.editor.dropPreview()).toEqual([{ location: 'RT', index: position === 'top' ? 0 : 1, span: 3 }]);
        const secondBlock = f.root.querySelector<HTMLElement>(`[data-mount-id="${second.mountId}"]`)!.parentElement!;
        expect(secondBlock.style.gridRow).toBe('5 / span 1');
        expect(encodeNativeEntity(f.editor.entity())).toBe(before);
        f.editor.dragEnded();
        f.editor.onDrop({ item: { data }, container: { data: { location: 'RT' } }, isPointerOverContainer: true });
        f.editor.endDrag();
        f.view.detectChanges();
        expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
        const placed = f.editor.selectedMount()!;
        expect(placed.placements?.map((p) => p.slotIndex)).toEqual(position === 'top' ? [0, 1, 2] : [1, 2, 3]);
        expect(
          f.editor
            .entity()
            .equipment()
            .find((m) => m.mountId === second.mountId)!.placements![0].slotIndex,
        ).toBe(4);
        expect(f.editor.entity().equipment().length).toBe(count + (incoming ? 0 : 1));
        f.editor.undo();
        expect(encodeNativeEntity(f.editor.entity())).toBe(before);
      });
    }
  }

  it('preserves warehouse insertion through the actual CDK mouse-release event sequence', async () => {
    const f = await create();
    Object.assign(f.root.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh' });
    f.editor.install(ammo, 'RT');
    const bin = f.editor.selectedMount()!;
    f.editor.query.set(ac.name);
    f.view.detectChanges();
    await f.view.whenStable();
    const source = [...f.root.querySelectorAll<HTMLElement>('.warehouse-item')].find(
      (row) => row.querySelector('.equipment-label')?.textContent?.trim() === ac.name,
    )!;
    const destination = f.root.querySelector<HTMLElement>(`[data-mount-id="${bin.mountId}"]`)!;
    destination.scrollIntoView({ block: 'center' });
    const from = source.getBoundingClientRect();
    const x = from.left + 20,
      y = from.top + 10;
    source.querySelector('.equipment-name')!.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        detail: 1,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
      }),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: x + 15, clientY: y + 15 }),
    );
    f.view.detectChanges();
    await f.view.whenStable();
    const preview = document.querySelector<HTMLElement>(
      '.construction-drag-preview.cdk-drag-preview .installed-equipment',
    )!;
    const installed = f.root.querySelector<HTMLElement>('[data-location="LT"] .installed-equipment')!;
    expect(preview).not.toBeNull();
    expect(preview.querySelectorAll('.critical-ticks i').length).toBe(3);
    expect(getComputedStyle(preview).backgroundImage).toBe(getComputedStyle(installed).backgroundImage);
    expect(getComputedStyle(preview).backgroundColor).toBe(getComputedStyle(installed).backgroundColor);
    expect(preview.getBoundingClientRect().height).toBeCloseTo(installed.getBoundingClientRect().height, 0);
    const to = destination.getBoundingClientRect();
    const endX = to.left + 10,
      endY = to.top + 2;
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: endX, clientY: endY }));
    f.view.detectChanges();
    try {
      expect(f.editor.dragTarget()).toEqual({ location: 'RT', beforeMountId: bin.mountId });
      expect(f.editor.dropPreview()).toEqual([{ location: 'RT', index: 0, span: 3 }]);
    } finally {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: endX, clientY: endY }));
      await f.view.whenStable();
    }
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
    expect(f.editor.selectedMount()?.placements?.map((p) => p.slotIndex)).toEqual([0, 1, 2]);
    expect(
      f.editor
        .entity()
        .equipment()
        .find((m) => m.mountId === bin.mountId)!.placements![0].slotIndex,
    ).toBe(3);
    expect(f.editor.dragTarget()).toBeNull();
    expect(source.closest('.equipment-list')).not.toBeNull();
    expect(source.style.transform).toBe('');
    expect(source.getBoundingClientRect().left).toBeCloseTo(from.left, 0);
    expect(document.querySelector('.cdk-drag-preview')).toBeNull();
  });

  it('joins a transferred split block ahead of existing equipment when the whole weapon fits', async () => {
    const f = await create();
    f.editor.install(ammo, 'RT');
    const bin = f.editor.selectedMount()!;
    f.editor.install(splitAc, 'RA');
    const gun = f.editor.selectedMount()!;
    const data = { equipmentId: splitAc.id, mountId: gun.mountId, sourceLocation: 'RA' };
    f.editor.startDrag(data);
    f.editor.dragTarget.set({ location: 'RT', beforeMountId: bin.mountId });
    f.view.detectChanges();
    expect(f.editor.dropPreview()).toEqual([{ location: 'RT', index: 0, span: 10 }]);
    expect(f.root.querySelector<HTMLElement>(`[data-mount-id="${bin.mountId}"]`)!.parentElement!.style.gridRow).toBe(
      '11 / span 1',
    );
    f.editor.onDrop({ item: { data }, container: { data: { location: 'RT' } } });
    f.editor.endDrag();
    expect(f.editor.selectedMount()?.placements).toEqual(
      Array.from({ length: 10 }, (_, slotIndex) => ({ location: 'RT', slotIndex })),
    );
    expect(
      f.editor
        .entity()
        .equipment()
        .find((m) => m.mountId === bin.mountId)!.placements![0].slotIndex,
    ).toBe(10);
  });

  it('keeps the docked block dimensions, style and bottom-right grab point in the floating preview', async () => {
    const f = await create();
    const block = f.root.querySelector<HTMLElement>('[data-location="LT"] .installed-equipment')!;
    const rect = block.getBoundingClientRect();
    const background = getComputedStyle(block).backgroundImage;
    const x = Math.round(rect.right - 8),
      y = Math.round(rect.bottom - 8);
    block.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        detail: 1,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
      }),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: x + 15, clientY: y + 15 }),
    );
    f.view.detectChanges();
    await f.view.whenStable();
    const preview = document.querySelector<HTMLElement>(
      '.construction-drag-preview.cdk-drag-preview .installed-equipment',
    );
    try {
      expect(preview).not.toBeNull();
      expect(preview?.querySelectorAll('.critical-ticks i').length).toBe(3);
      expect(preview?.getBoundingClientRect().width).toBeCloseTo(rect.width, 0);
      expect(preview?.getBoundingClientRect().height).toBeCloseTo(rect.height, 0);
      expect(preview && getComputedStyle(preview).backgroundImage).toBe(background);
      expect(preview!.getBoundingClientRect().left).toBeCloseTo(rect.left, 0);
      expect(preview!.getBoundingClientRect().top).toBeCloseTo(rect.top, 0);
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: x + 30, clientY: y + 30 }),
      );
      expect(preview!.getBoundingClientRect().left).toBeCloseTo(rect.left + 30, 0);
      expect(preview!.getBoundingClientRect().top).toBeCloseTo(rect.top + 30, 0);
    } finally {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: x + 15, clientY: y + 15 }));
      await f.view.whenStable();
    }
  });

  it('uses the installed block appearance and relative grab point when dragging unallocated equipment', async () => {
    const f = await create();
    f.editor.entity().addEquipment({
      equipmentId: ac.id,
      equipment: ac,
      allocation: { kind: 'unallocated' },
      rearMounted: false,
      turretMounted: false,
      omniPodMounted: false,
      armored: false,
    });
    f.view.detectChanges();
    await f.view.whenStable();
    const source = f.root.querySelector<HTMLElement>('.unallocated-panel .cdk-drag')!;
    const installed = f.root.querySelector<HTMLElement>('[data-location="LT"] .installed-equipment')!;
    const rect = source.getBoundingClientRect();
    const x = Math.round(rect.right - 8),
      y = Math.round(rect.bottom - 8);
    const grabX = (x - rect.left) / rect.width,
      grabY = (y - rect.top) / rect.height;
    source.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y }),
    );
    source.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        detail: 1,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
      }),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: x + 15, clientY: y + 15 }),
    );
    f.view.detectChanges();
    await f.view.whenStable();
    try {
      const preview = document.querySelector<HTMLElement>(
        '.construction-drag-preview.cdk-drag-preview .installed-equipment',
      )!;
      expect(preview).not.toBeNull();
      expect(preview.querySelectorAll('.critical-ticks i').length).toBe(3);
      expect(getComputedStyle(preview).backgroundImage).toBe(getComputedStyle(installed).backgroundImage);
      expect(getComputedStyle(preview).backgroundColor).toBe(getComputedStyle(installed).backgroundColor);
      expect(preview.getBoundingClientRect().height).toBeCloseTo(installed.getBoundingClientRect().height, 0);
      const previewRect = preview.getBoundingClientRect();
      expect(previewRect.left).toBeCloseTo(x - previewRect.width * grabX, 0);
      expect(previewRect.top).toBeCloseTo(y - previewRect.height * grabY, 0);
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: x + 30, clientY: y + 30 }),
      );
      expect(preview.getBoundingClientRect().left).toBeCloseTo(x + 30 - previewRect.width * grabX, 0);
      expect(preview.getBoundingClientRect().top).toBeCloseTo(y + 30 - previewRect.height * grabY, 0);
    } finally {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: x + 15, clientY: y + 15 }));
      await f.view.whenStable();
    }
    expect(source.closest('.unallocated-panel')).not.toBeNull();
    expect(source.style.transform).toBe('');
    expect(document.querySelector('.cdk-drag-preview')).toBeNull();
  });

  it('puts ordering arrows in the inspector heading and avoids duplicate actuator controls', async () => {
    const f = await create();
    f.root.querySelector<HTMLButtonElement>('[data-location="LT"] .mounted-name')!.click();
    f.view.detectChanges();
    expect(
      f.root.querySelector('.installed-inspector .equipment-details')?.textContent?.replace(/\s+/g, ' '),
    ).toContain('BV:50');
    const arrows = f.root.querySelector('.installed-inspector .inspector-heading .mount-order-controls')!;
    expect(arrows.querySelectorAll('button').length).toBe(2);
    expect(
      arrows.compareDocumentPosition(f.root.querySelector('.equipment-details')!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    f.editor.closeInstalledInspector();
    f.systems('Lower Arm Actuator', 'RA')[0].querySelector<HTMLButtonElement>('.system-name')!.click();
    f.view.detectChanges();
    expect(f.editor.systemFields()).toEqual([]);
    expect(f.root.querySelector('.installed-inspector [title="Disable this actuator"]')?.textContent?.trim()).toBe(
      'UNINSTALL',
    );
  });

  it('orders only the inspected location of split equipment and shows compact occupied locations', async () => {
    const f = await create();
    f.editor.install(splitAc, 'RA');
    const gun = f.editor.selectedMount()!;
    f.editor.install(ammo, 'RT');
    const bin = f.editor.selectedMount()!;
    f.view.detectChanges();
    f.root
      .querySelector<HTMLButtonElement>(`[data-location="RA"] [data-mount-id="${gun.mountId}"] .mounted-name`)!
      .click();
    f.view.detectChanges();
    expect(f.root.querySelector('.installed-inspector .muted')?.textContent?.replace(/\s+/g, ' ')).toContain(
      'Installed · RT/RA ·',
    );
    const armArrows = [...f.root.querySelectorAll<HTMLButtonElement>('.mount-order-controls button')];
    expect(armArrows.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Move up in Right Arm',
      'Move down in Right Arm',
    ]);
    expect(armArrows.every((button) => button.disabled)).toBeTrue();
    f.editor.closeInstalledInspector();
    f.view.detectChanges();
    f.root
      .querySelector<HTMLButtonElement>(`[data-location="RT"] [data-mount-id="${gun.mountId}"] .mounted-name`)!
      .click();
    f.view.detectChanges();
    const [up, down] = f.root.querySelectorAll<HTMLButtonElement>('.mount-order-controls button');
    expect(up.getAttribute('aria-label')).toBe('Move up in Right Torso');
    expect(down.getAttribute('aria-label')).toBe('Move down in Right Torso');
    expect(up.disabled).toBeTrue();
    expect(down.disabled).toBeFalse();
    const armPlacements = gun.placements!.filter((placement) => placement.location === 'RA');
    down.click();
    f.view.detectChanges();
    expect(f.editor.locationMounts('RT')).toEqual([bin.mountId, gun.mountId]);
    expect(f.editor.selectedMount()!.placements!.filter((placement) => placement.location === 'RA')).toEqual(
      armPlacements,
    );
    expect(up.disabled).toBeFalse();
    expect(down.disabled).toBeTrue();
    up.click();
    f.view.detectChanges();
    expect(f.editor.locationMounts('RT')).toEqual([gun.mountId, bin.mountId]);
    expect(f.editor.selectedMount()!.placements!.filter((placement) => placement.location === 'RA')).toEqual(
      armPlacements,
    );
  });

  it('reorders a fixed Omni split block within its secondary body location and rejects moving it elsewhere', async () => {
    const f = await create();
    f.editor.setField(
      f.editor.fields().find((field) => field.id === 'omni')!,
      true,
    );
    f.editor.install(splitAc, 'RA');
    f.editor.splitLocation.set('RA');
    f.editor.splitSecondLocation.set('RT');
    f.editor.splitCount.set(6);
    f.editor.applySplit();
    f.editor.updateMount(f.editor.selectedMount()!, { omniPodMounted: false });
    const gun = f.editor.selectedMount()!;
    const torso = gun.placements!.filter((placement) => placement.location === 'RT');
    f.editor.install(ammo, 'RA');
    const bin = f.editor.selectedMount()!;
    f.editor.setDesignEditing(false);
    expect(f.editor.canEditMount(gun)).toBeFalse();
    const data = { equipmentId: splitAc.id, mountId: gun.mountId, sourceLocation: 'RA' };
    f.editor.startDrag(data);
    f.editor.dragTarget.set({ location: 'RA' });
    expect(f.editor.dropPlans().get('RA')?.issue).toBe('');
    expect(f.editor.dropPlans().get('RT')?.issue).toContain('Fixed design');
    f.editor.onDrop({ item: { data }, container: { data: { location: 'RA' } } });
    f.editor.endDrag();
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
    expect(f.editor.locationMounts('RA')).toEqual([bin.mountId, gun.mountId]);
    expect(f.editor.selectedMount()!.placements!.filter((placement) => placement.location === 'RT')).toEqual(torso);
  });

  // TechManual errata v8.0, p. 3 (TM pp. 47, 55): fixed material slots may shift within a location only.
  it('reorders Omni material slots within a location while locking each location count', async () => {
    const f = await create({ material: 'endo', missingMaterial: true });
    f.editor.setField(
      f.editor.fields().find((field) => field.id === 'omni')!,
      true,
    );
    f.editor.selectMount(f.editor.unallocated()[0]);
    f.editor.setSpreadSlots('LT', 3);
    f.editor.setSpreadSlots('RA', 2);
    const mount = f.editor.selectedMount()!;
    const arm = mount.placements!.filter((p) => p.location === 'RA');
    f.editor.install(ammo, 'LT');
    const bin = f.editor.selectedMount()!;
    f.editor.setDesignEditing(false);
    f.editor.selectMount(mount);
    expect(f.editor.canEditMount(mount)).toBeFalse();
    expect(f.editor.canReorderMount(mount)).toBeTrue();
    f.editor.setSpreadSlots('LT', 2);
    expect(f.editor.selectedSpread()?.locations.find((location) => location.id === 'LT')?.count).toBe(3);
    const data = {
      equipmentId: endo.id,
      mountId: mount.mountId,
      sourceLocation: 'LT',
      sourceSlotIndex: 3,
      slotCount: 3,
    };
    f.editor.startDrag(data);
    f.editor.dragTarget.set({ location: 'LT' });
    expect(f.editor.dropPlans().get('LT')?.issue).toBe('');
    expect(f.editor.dropPlans().get('RA')?.issue).toContain('Fixed design');
    f.editor.onDrop({ item: { data }, container: { data: { location: 'LT' } } });
    f.editor.endDrag();
    expect(f.editor.locationMounts('LT').at(-2)).toBe(bin.mountId);
    expect(f.editor.locationMounts('LT').at(-1)).toBe(mount.mountId);
    expect(f.editor.selectedMount()?.placements?.filter((p) => p.location === 'RA')).toEqual(arm);
    expect(f.editor.selectedSpread()?.locations.find((location) => location.id === 'LT')?.count).toBe(3);
    expect(TestBed.inject(ToastService).showToast).not.toHaveBeenCalledWith(jasmine.any(String), 'error');
  });

  it('expands split allocation on demand and keeps the inspected location after applying edits', async () => {
    const f = await create();
    f.editor.install(splitAc, 'RA');
    f.view.detectChanges();
    const armMount = f.root.querySelector<HTMLButtonElement>('[data-location="RA"] .mounted-name')!;
    armMount.click();
    f.view.detectChanges();
    const split = f.root.querySelector<HTMLDetailsElement>('.split-controls')!;
    expect(split.open).toBeFalse();
    split.querySelector('summary')!.click();
    expect(split.open).toBeTrue();
    const count = split.querySelector('input')!;
    count.value = '7';
    count.dispatchEvent(new Event('input', { bubbles: true }));
    f.view.detectChanges();
    await f.view.whenStable();
    split.querySelector('button')!.click();
    f.view.detectChanges();
    expect(f.editor.status()).toBe('');
    expect(f.editor.selectedMount()!.placements!.filter((placement) => placement.location === 'RA').length).toBe(7);
    expect(f.editor.selectedMount()!.placements!.filter((placement) => placement.location === 'RT').length).toBe(3);
    expect(f.root.querySelector('.mount-order-controls button')?.getAttribute('aria-label')).toBe(
      'Move up in Right Arm',
    );
    expect(split.open).toBeTrue();
    split.querySelector('summary')!.click();
    expect(split.open).toBeFalse();
    split.querySelector('summary')!.click();
    f.editor.closeInstalledInspector();
    f.view.detectChanges();
    f.root.querySelector<HTMLButtonElement>('[data-location="RA"] .mounted-name')!.click();
    f.view.detectChanges();
    expect(f.root.querySelector<HTMLDetailsElement>('.split-controls')!.open).toBeFalse();
  });

  it('joins a dragged eight-slot arm block with its two-slot torso block only when all ten slots fit', async () => {
    const f = await create();
    f.editor.install(splitAc, 'RA');
    expect(f.editor.status()).toBe('');
    const gun = f.editor.selectedMount()!;
    expect(gun.placements?.filter((p) => p.location === 'RA').length).toBe(8);
    expect(gun.placements?.filter((p) => p.location === 'RT').length).toBe(2);
    const data = { equipmentId: splitAc.id, mountId: gun.mountId, sourceLocation: 'RA' };
    f.editor.startDrag(data);
    f.editor.dragTarget.set({ location: 'RT', beforeMountId: gun.mountId });
    expect(f.editor.dropPreview()).toEqual([{ location: 'RT', index: 0, span: 10 }]);
    f.editor.onDrop({ item: { data }, container: { data: { location: 'RT' } }, isPointerOverContainer: true });
    f.editor.endDrag();
    expect(f.editor.status()).toBe('');
    const joined = f.editor
      .entity()
      .equipment()
      .find((m) => m.mountId === gun.mountId)!;
    expect(joined.placements?.map((p) => p.location)).toEqual(Array(10).fill('RT'));
    f.editor.undo();
    f.editor.install(ac, 'RT');
    const restored = f.editor
      .entity()
      .equipment()
      .find((m) => m.equipmentId === splitAc.id)!;
    const blocked = { ...data, mountId: restored.mountId };
    f.editor.startDrag(blocked);
    f.editor.dragTarget.set({ location: 'RT' });
    expect(f.editor.dropPreview()).toEqual([]);
    expect(f.editor.dropPlans().get('RT')?.issue).toContain('10');
    f.editor.onDrop({ item: { data: blocked }, container: { data: { location: 'RT' } }, isPointerOverContainer: true });
    f.editor.endDrag();
    expect(
      f.editor
        .entity()
        .equipment()
        .find((m) => m.mountId === restored.mountId)?.placements,
    ).toEqual(restored.placements);
  });

  for (const material of ['endo', 'stealth'] as const) {
    it(`hides and rejects component armor for ${material}, ammunition, and integral heat sinks`, async () => {
      const f = await create({ material, ammo: true });
      const entity = f.editor.entity();
      for (const id of [material === 'endo' ? endo.id : stealth.id, ammo.id, sinks.id]) {
        const mount = entity.equipment().find((item) => item.equipmentId === id)!;
        f.editor.selectMount(mount);
        f.editor.inspector.open(f.root);
        f.view.detectChanges();
        expect(
          [...f.root.querySelectorAll('.mount-controls label')].some((label) =>
            label.textContent?.includes('Armored component'),
          ),
        ).toBeFalse();
        f.editor.updateMount(mount, { armored: true });
        expect(entity.equipment().find((item) => item.mountId === mount.mountId)?.armored).toBeFalse();
      }
    });
  }

  it('lets an illegal armored material be corrected without allowing armor to be added', async () => {
    const f = await create({ material: 'endo' });
    const entity = f.editor.entity();
    entity.updateEquipment((mounts) =>
      mounts.map((mount) => (mount.equipmentId === endo.id ? mount.clone({ armored: true }) : mount)),
    );
    f.editor.selectMount(entity.equipment().find((mount) => mount.equipmentId === endo.id)!);
    f.editor.inspector.open(f.root);
    f.view.detectChanges();
    await f.view.whenStable();
    const label = [...f.root.querySelectorAll('.mount-controls label')].find((item) =>
      item.textContent?.includes('Armored component'),
    )!;
    const input = label.querySelector<HTMLInputElement>('input')!;
    expect(input.checked).toBeTrue();
    expect(input.disabled).toBeFalse();
    expect(f.root.querySelector('.installed-inspector')?.textContent).toContain('cannot take critical hits');
    input.click();
    f.view.detectChanges();
    expect(f.editor.selectedMount()?.armored).toBeFalse();
    expect(
      [...f.root.querySelectorAll('.mount-controls label')].some((item) =>
        item.textContent?.includes('Armored component'),
      ),
    ).toBeFalse();
  });

  it('blocks Interface Cockpit armor while permitting its removal and armor on the sensors', async () => {
    const f = await create();
    const entity = f.editor.entity() as MekEntity;
    entity.cockpitType.set('Interface');
    f.view.detectChanges();
    const head = entity.criticalSlotGrid().get('HD')!;
    const cockpit = head.findIndex((slot) => slot.type === 'system' && slot.systemType === 'Cockpit');
    const sensor = head.findIndex((slot) => slot.type === 'system' && slot.systemType === 'Sensors');
    f.systems('Cockpit', 'HD')[0].querySelector<HTMLButtonElement>('.system-name')!.click();
    f.view.detectChanges();
    expect(f.root.querySelectorAll('.system-armor-controls input').length).toBe(0);
    expect(f.root.querySelector('.system-armor-controls')?.textContent).toContain('Interface cockpits cannot');
    f.editor.setSystemArmored('HD', cockpit, true);
    expect(entity.armoredSystemSlots().size).toBe(0);
    entity.armoredSystemSlots.set(new Set([`HD:${cockpit}`]));
    f.view.detectChanges();
    await f.view.whenStable();
    f.root.querySelector<HTMLInputElement>('.system-armor-controls input')!.click();
    f.view.detectChanges();
    expect(entity.armoredSystemSlots().size).toBe(0);
    f.editor.setSystemArmored('HD', sensor, true);
    expect(entity.armoredSystemSlots().has(`HD:${sensor}`)).toBeTrue();
  });

  it('blocks armor on superheavy equipment and systems and never armors an empty or equipment slot as a system', async () => {
    const f = await create();
    const entity = f.editor.entity() as MekEntity;
    f.editor.setSystemArmored('LT', 0, true);
    f.editor.setSystemArmored('RT', 11, true);
    expect(entity.armoredSystemSlots().size).toBe(0);
    entity.setTonnage(105);
    const gun = entity.equipment().find((mount) => mount.equipmentId === ac.id)!;
    f.editor.updateMount(gun, { armored: true });
    f.editor.setSystemArmored('CT', 0, true);
    expect(entity.equipment().find((mount) => mount.mountId === gun.mountId)?.armored).toBeFalse();
    expect(entity.armoredSystemSlots().size).toBe(0);
    f.systems('Engine')[0].querySelector<HTMLButtonElement>('.system-name')!.click();
    f.view.detectChanges();
    expect(f.root.querySelectorAll('.system-armor-controls input').length).toBe(0);
    expect(f.root.querySelector('.system-armor-controls')?.textContent).toContain('Superheavy Meks cannot');
  });

  for (const [fieldId, value, equipmentId, location] of [
    ['gyro', 'XL', srm.id, 'CT'],
    ['engineType', 'XL', ac.id, 'LT'],
  ] as const) {
    it(`unallocates equipment displaced by ${fieldId} changes and restores the layout on undo`, async () => {
      const f = await create();
      f.editor.setField(
        f.editor.fields().find((field) => field.id === 'walkMP')!,
        6,
      );
      f.editor.install(srm, 'CT');
      const mount = f.editor
        .entity()
        .equipment()
        .find((item) => item.equipmentId === equipmentId)!;
      const placements = mount.placements!;
      expect(placements.every((placement) => placement.location === location)).toBeTrue();
      f.editor.setField(
        f.editor.fields().find((field) => field.id === fieldId)!,
        value,
      );
      f.view.detectChanges();
      await f.view.whenStable();
      expect(f.editor.entity().mountedEngine().rating).toBe(300);
      expect(f.editor.unallocated().find((item) => item.mountId === mount.mountId)?.equipmentId).toBe(equipmentId);
      expect(f.root.querySelector('.unallocated-equipment')?.textContent).toContain(mount.equipment!.name);
      expect(f.root.querySelector(`[data-location="${location}"] .mounted-name`)).toBeNull();
      expect(
        placements.every(
          (placement) =>
            (f.editor.entity() as MekEntity).criticalSlotGrid().get(placement.location as MekLocation)![
              placement.slotIndex
            ].type === 'system',
        ),
      ).toBeTrue();
      expect(
        f.editor
          .entity()
          .validationResult()
          .messages.some((message) => message.code === 'CRIT_PLACEMENT_CONFLICT'),
      ).toBeFalse();
      f.editor.undo();
      expect(f.editor.entity().mountedEngine().rating).toBe(300);
      expect(
        f.editor
          .entity()
          .equipment()
          .find((item) => item.equipmentId === equipmentId)?.placements,
      ).toEqual(placements);
      expect(f.editor.unallocated()).toEqual([]);
      f.editor.redo();
      expect(f.editor.unallocated().map((item) => item.equipmentId)).toContain(equipmentId);
    });
  }

  it('links the engine selector to Walk MP and undoes both values together', async () => {
    const f = await create();
    f.systems('Engine')[0].querySelector<HTMLButtonElement>('.system-name')!.click();
    f.view.detectChanges();
    await f.view.whenStable();
    const selector = f.root.querySelector<HTMLSelectElement>(
      '.installed-inspector select[aria-label="Engine rating / Walk MP"]',
    )!;
    expect(selector).not.toBeNull();
    const option = Array.from(selector.options).find((option) => option.textContent?.trim() === '350 · 7 Walk MP')!;
    selector.value = option.value;
    selector.dispatchEvent(new Event('change'));
    f.view.detectChanges();
    await f.view.whenStable();
    expect(f.editor.entity().mountedEngine().rating).toBe(350);
    expect(f.editor.entity().originalWalkMP()).toBe(7);
    f.editor.undo();
    expect(f.editor.entity().mountedEngine().rating).toBe(250);
    expect(f.editor.entity().originalWalkMP()).toBe(5);
    f.editor.redo();
    expect(f.editor.entity().mountedEngine().rating).toBe(350);
    expect(f.editor.entity().originalWalkMP()).toBe(7);
    f.editor.setField(
      f.editor.fields().find((field) => field.id === 'walkMP')!,
      6,
    );
    expect(f.editor.entity().mountedEngine().rating).toBe(300);
    expect(f.editor.entity().originalWalkMP()).toBe(6);
    f.editor.undo();
    expect(f.editor.entity().mountedEngine().rating).toBe(350);
    expect(f.editor.entity().originalWalkMP()).toBe(7);
  });

  it('aligns the armored badge after a single-slot name without changing the multi-slot badge layout', async () => {
    const f = await create();
    f.editor.install(laser, 'RT', 0);
    for (const id of [ac.id, laser.id]) {
      f.editor.updateMount(
        f.editor
          .entity()
          .equipment()
          .find((mount) => mount.equipmentId === id)!,
        { armored: true },
      );
    }
    f.view.detectChanges();
    await f.view.whenStable();
    const single = f.root.querySelector<HTMLElement>('[data-location="RT"] .slot-target:has(.installed-equipment)')!;
    const name = single.querySelector<HTMLElement>('.equipment-title')!;
    const badge = single.querySelector<HTMLElement>('.armored-badge')!;
    const button = single.querySelector<HTMLElement>('.mounted-name')!;
    for (const width of [280, 160, 120]) {
      single.style.width = `${width}px`;
      const b = badge.getBoundingClientRect(),
        n = name.getBoundingClientRect(),
        bounds = button.getBoundingClientRect();
      expect(b.left)
        .withContext(`${width}px: badge follows name`)
        .toBeGreaterThanOrEqual(n.right - 1);
      expect(b.top + b.height / 2)
        .withContext(`${width}px: badge is vertically centered`)
        .toBeCloseTo(bounds.top + bounds.height / 2, 0);
      expect(n.width).withContext(`${width}px: name retains space`).toBeGreaterThan(0);
      expect(b.right).toBeLessThanOrEqual(bounds.right - parseFloat(getComputedStyle(button).paddingRight) + 1);
      expect(single.scrollWidth).toBeLessThanOrEqual(single.clientWidth);
    }
    const multi = f.root.querySelector<HTMLElement>('[data-location="LT"] .mounted-name')!;
    expect(getComputedStyle(multi).flexDirection).toBe('column');
    expect(multi.querySelector('.armored-badge')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      multi.querySelector('.equipment-title')!.getBoundingClientRect().top,
    );
  });

  it('opens a separate installed inspector, marks armor, and exposes system-slot armor and actuator removal', async () => {
    const f = await create();
    f.editor.selectEquipment(ammo);
    f.root.querySelector<HTMLButtonElement>('[data-location="LT"] .mounted-name')!.click();
    f.view.detectChanges();
    expect(f.root.querySelector('.installed-inspector')?.textContent).toContain('Test AC');
    expect(f.root.querySelector('[data-location="LT"] .selected-equipment')).not.toBeNull();
    expect(f.editor.selectedEquipment()).toBe(ammo);
    const mount = f.editor.selectedMount()!;
    f.editor.updateMount(mount, { armored: true });
    f.view.detectChanges();
    expect(f.root.querySelector('[data-location="LT"] .armored-badge')?.textContent).toBe('ARMORED');
    f.editor.closeInstalledInspector();
    f.view.detectChanges();
    await f.view.whenStable();
    expect(f.root.querySelector('.selected-equipment')).toBeNull();
    f.root.querySelector<HTMLButtonElement>('[data-location="LT"] .mounted-name')!.click();
    f.view.detectChanges();
    expect(f.root.querySelector('[data-location="LT"] .selected-equipment')).not.toBeNull();
    f.root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    f.view.detectChanges();
    expect(f.editor.inspectorOpen()).toBeFalse();
    expect(f.root.querySelector('.selected-equipment')).toBeNull();
    const engine = f.systems('Engine')[0];
    engine.scrollIntoView({ block: 'center', inline: 'center' });
    const engineBounds = engine.getBoundingClientRect();
    const systemHit = document.elementFromPoint(engineBounds.left + 2, engineBounds.top + 2) as HTMLElement;
    expect(systemHit).toBe(engine.querySelector<HTMLElement>('.system-name')!);
    systemHit.click();
    f.view.detectChanges();
    expect(f.root.querySelector('.installed-inspector')?.textContent).toContain('Engine rating');
    expect(f.root.querySelectorAll('.system-armor-controls input').length).toBe(6);
    f.editor.setSystemArmored('CT', 0, true);
    f.view.detectChanges();
    expect(f.systems('Engine')[0].querySelector('.armored-badge')?.textContent).toContain('1/3');
    f.editor.closeInstalledInspector();
    f.view.detectChanges();
    await f.view.whenStable();
    const remove = f.root.querySelector<HTMLButtonElement>(
      '[aria-label="Uninstall Lower Arm Actuator from Right Arm"]',
    )!;
    expect(remove).not.toBeNull();
    remove.scrollIntoView({ block: 'center', inline: 'center' });
    const removeBounds = remove.getBoundingClientRect();
    const removeHit = document.elementFromPoint(
      removeBounds.left + removeBounds.width / 2,
      removeBounds.top + removeBounds.height / 2,
    ) as HTMLElement;
    expect(removeHit.closest('button')).toBe(remove);
    removeHit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    f.view.detectChanges();
    expect(f.systems('Lower Arm Actuator', 'RA').length).toBe(0);
    expect(f.editor.inspectorOpen()).toBeFalse();
    f.editor.undo();
    f.view.detectChanges();
    expect(f.systems('Lower Arm Actuator', 'RA').length).toBe(1);
  });

  it('uses a modal installed inspector on mobile without opening the warehouse', async () => {
    const f = await create();
    (TestBed.inject(LayoutService).windowWidth as ReturnType<typeof signal<number>>).set(600);
    f.view.detectChanges();
    f.root.querySelector<HTMLButtonElement>('[data-location="LT"] .mounted-name')!.click();
    f.view.detectChanges();
    expect(f.root.querySelector('.installed-inspector')?.getAttribute('aria-modal')).toBe('true');
    expect(f.editor.equipmentDrawerOpen()).toBeFalse();
    expect(f.root.querySelector('.equipment-drawer')).toBeNull();
  });

  it('delays equipment and system hover, allows crossing to the panel, pins on click, and closes on CDK drag', async () => {
    const f = await create();
    const pointer = (target: HTMLElement, type: string) =>
      target.dispatchEvent(new PointerEvent(type, { pointerType: 'mouse' }));
    const mount = f.root.querySelector<HTMLButtonElement>('[data-location="LT"] .mounted-name')!;
    const block = f.systems('Engine')[0];
    block.scrollIntoView({ block: 'center', inline: 'center' });
    const bounds = block.getBoundingClientRect();
    const system = document.elementFromPoint(bounds.right - 2, bounds.bottom - 2) as HTMLElement;
    expect(system).toBe(block.querySelector<HTMLElement>('.system-name')!);
    for (const trigger of [mount, system]) {
      const focused = document.activeElement;
      jasmine.clock().withMock(() => {
        pointer(trigger, 'pointerenter');
        jasmine.clock().tick(299);
        expect(f.editor.inspectorOpen()).toBeFalse();
        pointer(trigger, 'pointerleave');
        jasmine.clock().tick(300);
        expect(f.editor.inspectorOpen()).toBeFalse();
        pointer(trigger, 'pointerenter');
        jasmine.clock().tick(300);
        expect(f.editor.inspectorOpen()).toBeTrue();
      });
      f.view.detectChanges();
      await f.view.whenStable();
      const panel = f.root.querySelector<HTMLElement>('.installed-inspector')!;
      expect(panel).not.toBeNull();
      expect(trigger.classList.contains('inspector-active')).toBeTrue();
      if (trigger === mount) expect(mount.closest('.selected-equipment')).not.toBeNull();
      if (trigger === system) expect(getComputedStyle(block).outlineStyle).toBe('solid');
      expect(f.root.querySelector('.installed-inspector-backdrop')).toBeNull();
      expect(document.activeElement).toBe(focused);
      jasmine.clock().withMock(() => {
        pointer(trigger, 'pointerleave');
        jasmine.clock().tick(299);
        expect(f.editor.inspectorOpen()).toBeTrue();
        pointer(panel, 'pointerenter');
        jasmine.clock().tick(300);
        expect(f.editor.inspectorOpen()).toBeTrue();
        f.view.detectChanges();
        expect(trigger.classList.contains('inspector-active')).toBeTrue();
        if (trigger === system) expect(getComputedStyle(block).backgroundColor).toBe('rgb(52, 56, 59)');
        pointer(panel, 'pointerleave');
        jasmine.clock().tick(200);
        pointer(trigger, 'pointerenter');
        jasmine.clock().tick(300);
        expect(f.editor.inspectorOpen()).toBeTrue();
        pointer(trigger, 'pointerleave');
        jasmine.clock().tick(299);
        expect(f.editor.inspectorOpen()).toBeTrue();
        jasmine.clock().tick(1);
        expect(f.editor.inspectorOpen()).toBeFalse();
      });
      f.view.detectChanges();
      expect(trigger.classList.contains('inspector-active')).toBeFalse();
      expect(f.root.querySelector('.selected-equipment')).toBeNull();
      if (trigger === system) expect(getComputedStyle(block).outlineStyle).toBe('none');
    }
    jasmine.clock().withMock(() => {
      pointer(mount, 'pointerenter');
      jasmine.clock().tick(300);
      pointer(mount, 'pointerleave');
      pointer(system, 'pointerenter');
      jasmine.clock().tick(100);
      pointer(system, 'pointerleave');
      jasmine.clock().tick(300);
      expect(f.editor.inspectorOpen()).toBeFalse();
    });
    jasmine.clock().withMock(() => {
      pointer(mount, 'pointerenter');
      jasmine.clock().tick(300);
      pointer(mount, 'pointerleave');
      mount.click();
      jasmine.clock().tick(600);
      expect(f.editor.inspector.isPinned()).toBeTrue();
      pointer(system, 'pointerenter');
      jasmine.clock().tick(300);
      expect(f.editor.selectedSystem()).toBeNull();
    });
    f.view.detectChanges();
    expect(f.root.querySelector('.installed-inspector-backdrop')).toBeNull();
    expect(mount.classList.contains('inspector-active')).toBeTrue();
    expect(system.classList.contains('inspector-active')).toBeFalse();
    mount.scrollIntoView({ block: 'center' });
    const rect = mount.getBoundingClientRect();
    const x = rect.left + 20,
      y = rect.top + 10;
    mount.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerType: 'mouse',
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
      }),
    );
    mount.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        detail: 1,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
      }),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: x + 10, clientY: y + 10 }),
    );
    f.view.detectChanges();
    expect(f.editor.dragging()).not.toBeNull();
    expect(f.editor.inspectorOpen()).toBeFalse();
    expect(f.root.querySelector('.installed-inspector')).toBeNull();
    expect(mount.classList.contains('inspector-active')).toBeFalse();
    expect(f.root.querySelector('.selected-equipment')).toBeNull();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: x + 10, clientY: y + 10 }));
    await f.view.whenStable();
    expect(f.editor.inspectorOpen()).toBeFalse();
  });

  it('shows default shots in the equipment list and configured shots in installed ammo slots', async () => {
    const f = await create();
    f.editor.category.set('ammo');
    f.editor.filterByLocation.set(false);
    f.view.detectChanges();
    expect(
      [...f.root.querySelectorAll('.warehouse-item .equipment-name span')].map((element) => element.textContent),
    ).toContain('Test AC Ammo (20)');

    f.editor.install(ammo, 'RT', 0);
    expect(f.editor.status()).toBe('');
    const mount = f.editor.selectedMount()!;
    expect(mount).not.toBeNull();
    for (const shotsCount of [7, 0]) {
      f.editor.updateMount(mount, { shotsCount });
      f.view.detectChanges();
      const slot = f.root.querySelector<HTMLButtonElement>('[data-location="RT"] .mounted-name');
      expect(slot?.textContent).toContain(`Test AC Ammo (${shotsCount})`);
      expect(slot?.title).toContain(`Test AC Ammo (${shotsCount})`);
      expect(
        [...f.root.querySelectorAll('.warehouse-item .equipment-name span')].map((element) => element.textContent),
      ).toContain('Test AC Ammo (20)');
    }
  });

  it('keeps loadout labels, inspector titles and record-sheet names in sync when systems change', async () => {
    const f = await create();
    for (const [system, location, fieldId, value, label] of [
      ['Gyro', 'CT', 'gyro', 'Heavy Duty', 'Heavy Duty Gyro'],
      ['Engine', 'CT', 'engineType', 'XL', 'XL Fusion Engine'],
      ['Cockpit', 'HD', 'cockpit', 'Small', 'Small Cockpit'],
    ] as const) {
      f.systems(system, location)[0].querySelector<HTMLButtonElement>('.system-name')!.click();
      f.view.detectChanges();
      f.editor.setField(
        f.editor.systemFields().find((field) => field.id === fieldId)!,
        value,
      );
      f.view.detectChanges();
      await f.view.whenStable();
      expect(f.editor.status()).toBe('');
      expect(f.root.querySelector('.installed-inspector h3 > span')?.textContent).toBe(label);
      const buttons = [...f.root.querySelectorAll<HTMLButtonElement>('.system-name')].filter(
        (button) => button.querySelector('.equipment-label')?.textContent === label,
      );
      expect(buttons.length).toBeGreaterThan(0);
      expect(buttons.every((button) => button.title === `Inspect ${label}`)).toBeTrue();
      const entity = f.editor.entity() as MekEntity;
      const slot = entity
        .criticalSlotGrid()
        .get(location)!
        .find((slot) => slot.type === 'system' && slot.systemType === system);
      expect(mekCriticalSlotLabel(slot, entity)).toBe(label);
      f.editor.closeInstalledInspector();
      f.view.detectChanges();
      await f.view.whenStable();
    }
    expect(f.systems('Sensors', 'HD').length).toBeGreaterThan(0);
    expect(f.systems('Life Support', 'HD').length).toBeGreaterThan(0);
  });

  it('keeps engine sections separate around a four-slot gyro and embeds integral sinks once', async () => {
    const f = await create();
    const rows = f.editor.locations().find((location) => location.id === 'CT')!.rows;
    expect(rows.slice(0, 3).map((row) => [row.system, row.index, row.span])).toEqual([
      ['Engine', 0, 3],
      ['Gyro', 3, 4],
      ['Engine', 7, 3],
    ]);
    expect(rows[0].componentId).toBe(rows[2].componentId);
    expect(f.systems('Engine').map((block) => block.querySelectorAll('.critical-ticks i').length)).toEqual([3, 3]);
    expect(f.systems('Gyro')[0].querySelectorAll('.critical-ticks i').length).toBe(4);
    const badges = f.root.querySelectorAll<HTMLButtonElement>('.integral-equipment button');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toContain('10×Double Heat Sink');
    expect(f.systems('Engine')[0].contains(badges[0])).toBeTrue();
    expect(f.root.querySelector('.unallocated-panel')).not.toBeNull();
    expect(f.root.querySelector('.unallocated-empty')).not.toBeNull();
    badges[0].scrollIntoView({ block: 'center', inline: 'center' });
    const badgeBounds = badges[0].getBoundingClientRect();
    const badgeHit = document.elementFromPoint(
      badgeBounds.left + badgeBounds.width / 2,
      badgeBounds.top + badgeBounds.height / 2,
    ) as HTMLElement;
    expect(badgeHit.closest('button')).toBe(badges[0]);
    badgeHit.click();
    expect(f.editor.selectedMount()?.allocation.kind).toBe('engine');
    expect(f.editor.selectedSystem()).toBeNull();
    const head = f.editor.locations().find((location) => location.id === 'HD')!.rows;
    for (const system of ['Sensors', 'Life Support']) {
      const sections = head.filter((row) => row.system === system);
      expect(sections.length).toBe(2);
      expect(sections[0].componentId).toBe(sections[1].componentId);
    }
  });

  it('marks only hit ticks and destroys every engine block on the third hit, including preview damage', async () => {
    const f = await create();
    await f.hit('CT', 1);
    expect(f.systems('Engine').some((block) => block.classList.contains('destroyed-equipment'))).toBeFalse();
    expect(
      [...f.systems('Engine')[0].querySelectorAll('i')].map((tick) => tick.classList.contains('destroyed-tick')),
    ).toEqual([false, true, false]);
    await f.hit('CT', 7, 'pending');
    expect(f.systems('Engine').some((block) => block.classList.contains('destroyed-equipment'))).toBeFalse();
    expect(
      [...f.systems('Engine')[1].querySelectorAll('i')].map((tick) => tick.classList.contains('destroyed-tick')),
    ).toEqual([true, false, false]);
    await f.hit('CT', 9, 'pending');
    expect(f.systems('Engine').every((block) => block.classList.contains('destroyed-equipment'))).toBeTrue();
    expect(f.root.querySelectorAll('.system-slot .destroyed-tick').length).toBe(3);
    expect(f.systems('Gyro')[0].classList.contains('destroyed-equipment')).toBeFalse();
  });

  for (const ruleset of ['core-2026', 'total-warfare'] as const) {
    it(`uses ${ruleset} autocannon failure rules without changing per-slot ticks`, async () => {
      const f = await create({ ruleset });
      const block = () => f.root.querySelector<HTMLElement>('[data-location="LT"] .installed-equipment')!;
      expect(block().querySelector<HTMLButtonElement>('.mounted-name')?.title).toBe(`${ac.name} · 5 t`);
      await f.hit('LT', 1);
      expect(block().classList.contains('destroyed-equipment')).toBe(ruleset === 'total-warfare');
      expect([...block().querySelectorAll('i')].map((tick) => tick.classList.contains('destroyed-tick'))).toEqual([
        false,
        true,
        false,
      ]);
      if (ruleset === 'core-2026') {
        await f.hit('LT', 2, 'pending');
        expect(block().classList.contains('destroyed-equipment')).toBeTrue();
        expect(block().querySelectorAll('.destroyed-tick').length).toBe(2);
      }
      expect(block().querySelector<HTMLButtonElement>('.mounted-name')?.title).toBe(`${ac.name} · 5 t`);
    });
    it(`uses ${ruleset} heavy-duty gyro thresholds`, async () => {
      const f = await create({ ruleset, gyro: 'Heavy Duty' });
      const gyro = f.editor
        .locations()
        .find((location) => location.id === 'CT')!
        .rows.find((row) => row.system === 'Gyro')!;
      const threshold = ruleset === 'core-2026' ? 4 : 3;
      for (let hit = 0; hit < threshold; hit++) {
        await f.hit('CT', gyro.index + hit);
        expect(f.systems('Gyro')[0].classList.contains('destroyed-equipment')).toBe(hit + 1 === threshold);
      }
    });
  }

  it('omits mass already accounted for by armor from critical-slot material entries', async () => {
    const f = await create();
    const ferro = new MiscEquipment({
      id: 'ISHeavyFerroFibrous',
      name: 'Heavy Ferro-Fibrous',
      type: 'misc',
      flags: ['F_HEAVY_FERRO', 'F_MEK_EQUIPMENT'],
      stats: { criticalSlots: 21, tonnage: 0 },
    });
    const mount = f.editor.entity().addEquipment({
      equipmentId: ferro.id,
      equipment: ferro,
      allocation: {
        kind: 'location',
        location: 'LA',
        placements: [4, 5, 6, 7].map((slotIndex) => ({ location: 'LA', slotIndex })),
      },
      rearMounted: false,
      turretMounted: false,
      omniPodMounted: false,
      armored: false,
    });
    expect(mount.getTonnage(f.editor.entity())).toBe(0);
    expect(f.editor.mountedMass(mount)).toBe('');
    f.view.detectChanges();
    const button = f.root.querySelector<HTMLButtonElement>('[data-location="LA"] .mounted-name')!;
    expect(button.querySelector('small')).toBeNull();
    expect(button.title).toBe('Heavy Ferro-Fibrous');
  });

  it('keeps noncontiguous equipment blocks separate and follows the hit slot when a mount moves', async () => {
    const f = await create();
    const mount = f.editor
      .entity()
      .equipment()
      .find((mount) => mount.equipmentId === ac.id)!;
    f.editor.entity().moveEquipment(
      mount,
      'LT',
      [0, 1, 4].map((slotIndex) => ({ location: 'LT', slotIndex })),
    );
    await f.hit('LT', 2);
    const blocks = () => [...f.root.querySelectorAll<HTMLElement>('[data-location="LT"] .installed-equipment')];
    expect(blocks().map((block) => block.querySelectorAll('i').length)).toEqual([2, 1]);
    expect(blocks().map((block) => block.querySelectorAll('.destroyed-tick').length)).toEqual([0, 1]);
    f.editor.entity().moveEquipment(
      mount,
      'LT',
      [7, 8, 9].map((slotIndex) => ({ location: 'LT', slotIndex })),
    );
    await f.view.whenStable();
    expect(blocks().length).toBe(1);
    expect([...blocks()[0].querySelectorAll('i')].map((tick) => tick.classList.contains('destroyed-tick'))).toEqual([
      false,
      false,
      true,
    ]);
    expect(blocks()[0].classList.contains('destroyed-equipment')).toBeFalse();
  });

  it('does not turn a tick red when a hit only removes critical-slot armor', async () => {
    const f = await create({ armored: true });
    await f.hit('CT', 1);
    expect(f.systems('Engine')[0].querySelectorAll('.destroyed-tick').length).toBe(0);
    await f.hit('CT', 1);
    expect(f.systems('Engine')[0].querySelectorAll('.destroyed-tick').length).toBe(1);
    expect(f.systems('Engine')[0].classList.contains('destroyed-equipment')).toBeFalse();
  });
});
