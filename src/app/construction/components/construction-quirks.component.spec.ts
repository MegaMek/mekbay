// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { ConstructionQuirksComponent } from './construction-quirks.component';
import { createConstructionEntity } from '../domain/construction-factory';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { WeaponEquipment } from '../../models/equipment.model';
import { QuirksCatalogService } from '../../services/catalogs/quirks-catalog.service';
import type { Quirk } from '../../models/quirks.model';

describe('construction quirk editor', () => {
    const quirk: Quirk = { key: 'easy_pilot', name: 'Easy to Pilot', type: 'positive', description: 'Easier to pilot.' };
    const registry = createTestEquipmentRegistry();
    beforeEach(() => TestBed.configureTestingModule({ providers: [{ provide: QuirksCatalogService, useValue: {
        getQuirksByKey: () => new Map([[quirk.key, quirk]]), getQuirkByKey: (key: string) => key === quirk.key ? quirk : undefined,
    } }] }));
    it('uses shared badges and routes design and individual weapon changes through undo', () => {
        const entity = createConstructionEntity('Biped', registry);
        const laser = new WeaponEquipment({ id: 'Badge laser', name: 'Badge laser', type: 'weapon', flags: ['F_ENERGY'], weapon: { heat: 3 } });
        const first = addTestEquipment(entity, laser, { allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 0 }] } });
        const second = addTestEquipment(entity, laser, { allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex: 1 }] } });
        const fixture = TestBed.createComponent(ConstructionQuirksComponent);
        fixture.componentRef.setInput('entity', entity);
        const component = fixture.componentInstance;
        let pending!: () => void;
        component.editRequested.subscribe(action => pending = action);
        component.addQuirk(quirk.key);
        expect(entity.quirks()).toEqual([]);
        pending();
        component.selectedMountId.set(second.mountId);
        component.addWeaponQuirk('accurate'); pending();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('quirk-badge .positive').length).toBe(2);
        expect(component.selectedWeaponQuirks().length).toBe(1);
        component.selectedMountId.set(first.mountId);
        expect(component.selectedWeaponQuirks().length).toBe(0);
        component.selectedMountId.set(second.mountId);
        component.removeWeaponQuirk(component.selectedWeaponQuirks()[0]); pending();
        expect(entity.weaponQuirks()).toEqual([]);
    });
    it('keeps assigned quirks visible and removable when chassis changes make them incompatible', () => {
        const entity = createConstructionEntity('Tank', registry);
        entity.quirks.set([{ quirk }]);
        const fixture = TestBed.createComponent(ConstructionQuirksComponent);
        fixture.componentRef.setInput('entity', entity);
        fixture.componentInstance.editRequested.subscribe(action => action());
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('quirk-badge').textContent).toContain(quirk.name);
        fixture.componentInstance.removeQuirk(entity.quirks()[0]);
        expect(entity.quirks()).toEqual([]);
    });
});
