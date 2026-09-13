// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { BipedMekEntity } from '../../models/entity/entities/mek/biped-mek-entity';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { SpriteStorageService, type SpriteManifest } from '../../services/sprite-storage.service';
import { UnitNameService } from '../../services/unit-name.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { resolveUnitSpritePath } from '../../utils/unit-sprite-resolver';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { UnitIconPickerDialogComponent } from './unit-icon-picker-dialog.component';
import { createConstructionEntity, type ConstructionUnitKind } from '../../construction/domain/construction-factory';

describe('unit icon picker and display', () => {
  const info = { type: 'meks', x: 0, y: 0, w: 84, h: 72 };
  const manifest: SpriteManifest = {
    types: {},
    icons: {
      'meks/Atlas.png': info,
      'meks/Atlas2.png': info,
      'Color Archive/Meks/Atlas.png': { ...info, type: 'Color Archive' },
      'vehicles/Tank.png': { ...info, type: 'vehicles' },
      'protomeks/Proto.png': { ...info, type: 'protomeks' },
      'Infantry/Squad.png': { ...info, type: 'Infantry' },
      'battle armor/Suit.png': { ...info, type: 'battle armor' },
      'sea/Ship.png': { ...info, type: 'sea' },
      'fighter/Fighter.png': { ...info, type: 'fighter' },
      'convfighter/Fighter.png': { ...info, type: 'convfighter' },
      'dropships/Craft.png': { ...info, type: 'dropships' },
      'jumpships/Ship.png': { ...info, type: 'jumpships' },
      'warships/Ship.png': { ...info, type: 'warships' },
      'Space Stations/Station.png': { ...info, type: 'Space Stations' },
      'GunEmplacements/Turret.png': { ...info, type: 'GunEmplacements' },
      'defaults/medium.png': { ...info, type: 'defaults' },
      'defaults/quad.png': { ...info, type: 'defaults' },
      'wrecks/Atlas.png': { ...info, type: 'wrecks' },
      'DamageDecals/Atlas.png': { ...info, type: 'DamageDecals' },
    },
    assignments: {
      exact: {
        DEFAULT_MEDIUM: 'defaults/medium.png',
        DEFAULT_QUAD: 'defaults/quad.png',
      },
      chassis: { ATLAS: 'meks/Atlas.png', THUNDERBIRD: 'fighter/Fighter.png' },
    },
  };
  let entity: BipedMekEntity;
  let sprites: jasmine.SpyObj<SpriteStorageService>;
  let close: jasmine.Spy;

  beforeEach(() => {
    entity = new BipedMekEntity(createTestEquipmentRegistry());
    entity.chassis.set('Atlas');
    entity.setTonnage(50);
    sprites = jasmine.createSpyObj(
      'SpriteStorageService',
      ['getManifest', 'resolveIconPath', 'getCachedSpriteInfo', 'getSpriteInfo'],
      {
        loading: signal(false),
      },
    );
    sprites.getManifest.and.resolveTo(manifest);
    sprites.resolveIconPath.and.callFake((unit) =>
      resolveUnitSpritePath(unit, manifest.assignments, (path) => !!manifest.icons[path]),
    );
    sprites.getCachedSpriteInfo.and.callFake((path) => ({ url: path, info }));
    close = jasmine.createSpy('close');
    TestBed.configureTestingModule({
      providers: [
        { provide: SpriteStorageService, useValue: sprites },
        { provide: UnitNameService, useValue: { name: () => 'Atlas' } },
        { provide: DialogRef, useValue: { close } },
        { provide: DIALOG_DATA, useValue: { unit: entity } },
      ],
    });
  });

  it('groups tileset paths, searches across folders, and distinguishes automatic from dismiss', async () => {
    entity.iconPath.set('meks/Atlas.png');
    const fixture = TestBed.createComponent(UnitIconPickerDialogComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.picker-controls button')).toBeNull();
    expect(root.querySelector('.hint')).toBeNull();
    expect(
      [...root.querySelectorAll('.wide-dialog-actions button')].map((button) => button.textContent?.trim()),
    ).toEqual(['AUTOMATIC PICK', 'DISMISS']);
    expect(root.querySelector('[title="meks/Atlas.png"]')?.getAttribute('aria-pressed')).toBe('true');
    const search = root.querySelector('input')!;
    search.value = 'atlas';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect([...root.querySelectorAll('.icon-choice')].map((button) => button.getAttribute('title'))).toEqual([
      'meks/Atlas.png',
      'meks/Atlas2.png',
      'Color Archive/Meks/Atlas.png',
    ]);
    root.querySelector<HTMLButtonElement>('[title="meks/Atlas2.png"]')!.click();
    expect(close.calls.mostRecent().args).toEqual(['meks/Atlas2.png']);
    root.querySelector<HTMLButtonElement>('.automatic-choice')!.click();
    expect(close.calls.mostRecent().args).toEqual([null]);
    root.querySelector<HTMLButtonElement>('.wide-dialog-actions button:last-child')!.click();
    expect(close.calls.mostRecent().args).toEqual([]);
  });

  it('opens the unit category in automatic mode and excludes defaults, other unit types and non-unit sprites', async () => {
    entity.chassis.set('Custom');
    const fixture = TestBed.createComponent(UnitIconPickerDialogComponent);
    await fixture.whenStable();
    expect(fixture.componentInstance.categories().map((category) => category.name)).toEqual([
      'meks',
      'Color Archive/Meks',
    ]);
    expect(fixture.nativeElement.querySelector('[title="meks/Atlas.png"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.hint')?.textContent).toContain('selected automatically');
    for (const query of ['defaults', 'Tank', 'wrecks', 'DamageDecals']) {
      fixture.componentInstance.search.set(query);
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelectorAll('.icon-choice').length).toBe(0);
    }
  });

  for (const [kind, category] of [
    ['ProtoMek', 'protomeks'],
    ['Infantry', 'Infantry'],
    ['BattleArmor', 'battle armor'],
    ['Tank', 'vehicles'],
    ['SupportTank', 'vehicles'],
    ['VTOL', 'vehicles'],
    ['SupportVTOL', 'vehicles'],
    ['LargeSupportTank', 'vehicles'],
    ['Naval', 'sea'],
    ['SupportNaval', 'sea'],
    ['Aero', 'fighter'],
    ['ConvFighter', 'convfighter'],
    ['FixedWingSupport', 'convfighter'],
    ['SmallCraft', 'dropships'],
    ['DropShip', 'dropships'],
    ['JumpShip', 'jumpships'],
    ['WarShip', 'warships'],
    ['SpaceStation', 'Space Stations'],
    ['BuildingEntity', 'GunEmplacements'],
    ['MobileStructure', 'GunEmplacements'],
    ['HandheldWeapon', null],
  ] satisfies [ConstructionUnitKind, string | null][]) {
    it(`only offers the ${kind} sprite category`, async () => {
      const unit = createConstructionEntity(kind, createTestEquipmentRegistry());
      unit.iconPath.set('meks/Atlas.png');
      TestBed.overrideProvider(DIALOG_DATA, { useValue: { unit } });
      const fixture = TestBed.createComponent(UnitIconPickerDialogComponent);
      await fixture.whenStable();
      expect(fixture.componentInstance.categories().map((group) => group.name)).toEqual(category ? [category] : []);
      expect(fixture.nativeElement.querySelector('[title="meks/Atlas.png"]')).toBeNull();
    });
  }

  it('leaves automatic available if the catalog fails and recovers on retry', async () => {
    sprites.getManifest.and.resolveTo(null);
    const fixture = TestBed.createComponent(UnitIconPickerDialogComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    fixture.nativeElement.querySelector('.automatic-choice').click();
    expect(close).toHaveBeenCalledWith(null);
    sprites.getManifest.and.resolveTo(manifest);
    await fixture.componentInstance.load();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[title="meks/Atlas.png"]')).not.toBeNull();
  });

  it('reacts to name and explicit-icon edits on the same entity, including clearing and missing sprites', async () => {
    const fixture = TestBed.createComponent(UnitIconComponent);
    fixture.componentRef.setInput('unit', entity);
    await fixture.whenStable();
    expect(fixture.componentInstance.spriteData()?.url).toBe('meks/Atlas.png');
    entity.chassis.set('Custom');
    await fixture.whenStable();
    expect(fixture.componentInstance.spriteData()?.url).toBe('defaults/medium.png');
    entity.chassis.set('thunderbird');
    await fixture.whenStable();
    expect(fixture.componentInstance.spriteData()?.url).toBe('defaults/medium.png');
    entity.iconPath.set('vehicles/Tank.png');
    await fixture.whenStable();
    expect(fixture.componentInstance.spriteData()?.url).toBe('vehicles/Tank.png');
    for (const path of ['', 'missing.png']) {
      entity.iconPath.set(path);
      await fixture.whenStable();
      expect(fixture.componentInstance.spriteData()?.url).toBe('defaults/medium.png');
    }
  });

  it('provides unit-type fallback for summaries with no usable icon', async () => {
    const fixture = TestBed.createComponent(UnitIconComponent);
    fixture.componentRef.setInput(
      'unit',
      createEmptyUnit({
        icon: '',
        entityType: 'Mek',
        chassis: 'Custom',
        weightClass: 'Medium',
        moveType: 'Quad',
      }),
    );
    await fixture.whenStable();
    expect(fixture.componentInstance.spriteData()?.url).toBe('defaults/quad.png');
  });

  it('ignores an old asynchronous load after the selection changes', async () => {
    let finish!: (value: { url: string; info: typeof info }) => void;
    sprites.getCachedSpriteInfo.and.returnValue(null);
    sprites.getSpriteInfo.and.returnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const fixture = TestBed.createComponent(UnitIconComponent);
    fixture.componentRef.setInput('unit', entity);
    fixture.detectChanges();
    sprites.getCachedSpriteInfo.and.returnValue({ url: 'new', info });
    entity.iconPath.set('vehicles/Tank.png');
    fixture.detectChanges();
    finish({ url: 'old', info });
    await fixture.whenStable();
    expect(fixture.componentInstance.spriteData()?.url).toBe('new');
  });
});
