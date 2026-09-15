// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { ConstructionQuirksComponent } from './construction-quirks.component';
import { createConstructionEntity } from '../domain/construction-factory';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { WeaponEquipment } from '../../models/equipment.model';
import { QuirksCatalogService } from '../../services/catalogs/quirks-catalog.service';
import type { MekWithArmsEntity } from '../../models/entity/entities/mek/mek-entity';
import type { Quirk } from '../../models/quirks.model';

describe('construction quirk editor', () => {
  const quirk: Quirk = { key: 'easy_pilot', name: 'Easy to Pilot', type: 'positive', description: 'Easier to pilot.' };
  const registry = createTestEquipmentRegistry();
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        {
          provide: QuirksCatalogService,
          useValue: {
            getQuirksByKey: () => new Map([[quirk.key, quirk]]),
            getQuirkByKey: (key: string) => (key === quirk.key ? quirk : undefined),
          },
        },
      ],
    }),
  );
  it('uses shared badges and routes design and individual weapon changes through undo', () => {
    const entity = createConstructionEntity('Biped', registry);
    const laser = new WeaponEquipment({
      id: 'Badge laser',
      name: 'Badge laser',
      type: 'weapon',
      flags: ['F_ENERGY'],
      weapon: { heat: 3 },
    });
    const first = addTestEquipment(entity, laser, {
      allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 0 }] },
    });
    const second = addTestEquipment(entity, laser, {
      allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 1 }] },
    });
    const fixture = TestBed.createComponent(ConstructionQuirksComponent);
    fixture.componentRef.setInput('entity', entity);
    const component = fixture.componentInstance;
    let pending!: () => void;
    component.editRequested.subscribe((action) => (pending = action));
    component.addQuirk(quirk.key);
    expect(entity.quirks()).toEqual([]);
    pending();
    component.selectedTargetId.set(second.mountId);
    component.addWeaponQuirk('accurate');
    pending();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('quirk-badge .positive').length).toBe(2);
    expect(component.selectedWeaponQuirks().length).toBe(1);
    component.selectedTargetId.set(first.mountId);
    expect(component.selectedWeaponQuirks().length).toBe(0);
    component.selectedTargetId.set(second.mountId);
    component.removeWeaponQuirk(component.selectedWeaponQuirks()[0]);
    pending();
    expect(entity.weaponQuirks()).toEqual([]);
  });
  it('shows and edits active and suppressed bay quirks through the same selector', () => {
    const entity = createConstructionEntity('DropShip', registry);
    const laser = new WeaponEquipment({
      id: 'Bay laser',
      name: 'Bay laser',
      type: 'weapon',
      flags: ['F_ENERGY'],
      weapon: { heat: 3, atClass: 'LASER' },
    });
    const mount = addTestEquipment(entity, laser, { location: 'Nose' });
    entity.addEquipmentBay('weapon-bay', { mounts: [mount] });
    const address = { weaponName: 'Laser Bay', location: 'NOS', slot: 1 };
    entity.weaponQuirks.set([
      { name: 'accurate', ...address },
      { name: 'stable_weapon', ...address },
    ]);
    const fixture = TestBed.createComponent(ConstructionQuirksComponent);
    fixture.componentRef.setInput('entity', entity);
    const component = fixture.componentInstance;
    component.editRequested.subscribe((action) => action());
    fixture.detectChanges();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('select');
    select.value = `bay:${mount.mountId}`;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(select.selectedOptions[0].textContent).toContain('Laser Bay');
    expect(component.selectedWeaponQuirks().map((entry) => entry.name)).toEqual(['accurate']);
    expect(component.suppressedWeaponQuirks().map((entry) => entry.name)).toEqual(['stable_weapon']);
    expect(fixture.nativeElement.querySelector('.suppressed-list .muted').textContent).toContain('Stabilized');
    fixture.nativeElement.querySelector('.suppressed-list button.remove').click();
    expect(entity.weaponQuirks()).toEqual([{ name: 'accurate', ...address }]);
    component.addWeaponQuirk('imp_cooling');
    component.addWeaponQuirk('imp_cooling');
    expect(entity.weaponQuirks()).toEqual([
      { name: 'accurate', ...address },
      { name: 'imp_cooling', ...address },
    ]);
  });
  it('moves a missing-hand quirk to the suppressed list and restores it when the hand returns, without changing assignments', () => {
    const entity = createConstructionEntity('Biped', registry) as MekWithArmsEntity;
    const fists: Quirk = { key: 'battle_fists_la', name: 'Battle Fists (LA)', type: 'positive', description: '' };
    entity.quirks.set([{ quirk: fists }]);
    const fixture = TestBed.createComponent(ConstructionQuirksComponent);
    fixture.componentRef.setInput('entity', entity);
    const selected = () => fixture.nativeElement.querySelector('.selected-quirks quirk-badge');
    const suppressed = () => fixture.nativeElement.querySelector('.suppressed-quirks quirk-badge .quirk.muted');
    for (const left of [true, false, true]) {
      entity.hasHandActuator.update((hands) => ({ ...hands, left }));
      fixture.detectChanges();
      expect(selected() !== null)
        .withContext(`selected left=${left}`)
        .toBe(left);
      expect(suppressed() !== null)
        .withContext(`suppressed left=${left}`)
        .toBe(!left);
      expect(entity.quirks()).toEqual([{ quirk: fists }]);
    }
  });
  it('removes a suppressed quirk through its own remove control', () => {
    const entity = createConstructionEntity('Biped', registry) as MekWithArmsEntity;
    const fists: Quirk = { key: 'battle_fists_la', name: 'Battle Fists (LA)', type: 'positive', description: '' };
    entity.quirks.set([{ quirk: fists }]);
    entity.hasHandActuator.update((hands) => ({ ...hands, left: false }));
    const fixture = TestBed.createComponent(ConstructionQuirksComponent);
    fixture.componentRef.setInput('entity', entity);
    let pending!: () => void;
    fixture.componentInstance.editRequested.subscribe((action) => (pending = action));
    fixture.detectChanges();
    const remove = fixture.nativeElement.querySelector('.suppressed-list button.remove') as HTMLButtonElement | null;
    expect(remove).withContext('suppressed remove control').not.toBeNull();
    remove!.click();
    pending();
    expect(entity.quirks()).toEqual([]);
  });
});
