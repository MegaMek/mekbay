// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConstructionExtrasComponent } from './construction-extras.component';
import { DropShipEntity } from '../../models/entity/entities/aero/dropship-entity';
import { BipedMekEntity } from '../../models/entity/entities/mek/biped-mek-entity';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { WeaponEquipment } from '../../models/equipment.model';
import { EquipmentBay } from '../../models/entity/types/equipment';
import { getBayConstructionWeight } from '../../models/entity/bays/bay-definitions';
import { serializeTransporterLines } from '../../models/entity/parsers/transporter-codec';
import { QuirksCatalogService } from '../../services/catalogs/quirks-catalog.service';

describe('construction extras', () => {
    beforeEach(() => TestBed.configureTestingModule({
        imports: [ConstructionExtrasComponent],
        providers: [provideZonelessChangeDetection(), { provide: QuirksCatalogService, useValue: {
            getQuirksByKey: () => new Map(), getQuirkByKey: () => undefined,
        } }],
    }));

    it('defers mutation to the editor so undo can capture the previous design', () => {
        const fixture = TestBed.createComponent(ConstructionExtrasComponent);
        const entity = new DropShipEntity(createTestEquipmentRegistry());
        fixture.componentRef.setInput('entity', entity);
        let mutation: (() => void) | undefined;
        fixture.componentInstance.change.subscribe(action => mutation = action);
        fixture.componentInstance.addTransport();
        expect(entity.transporters()).toEqual([]);
        mutation!();
        expect(entity.transporters().length).toBe(1);
    });

    it('keeps quarters as personnel in the UI and construction mass in native storage', () => {
        const fixture = TestBed.createComponent(ConstructionExtrasComponent);
        const entity = new DropShipEntity(createTestEquipmentRegistry());
        fixture.componentRef.setInput('entity', entity);
        const component = fixture.componentInstance;
        component.change.subscribe(action => action());
        component.newTransport.set('crew-quarters');
        component.addTransport();
        component.setCapacity(entity.transporters()[0], 12);
        const bay = entity.transporters()[0];
        if (bay.kind !== 'bay') throw new Error('Expected quarters bay');
        expect(bay.capacity).toBe(12);
        expect(getBayConstructionWeight(bay)).toBe(84);
        expect(serializeTransporterLines([bay])[0]).toMatch(/^crewquarters:84(?:\.0)?:/);
    });

    it('keeps Mek cargo in its native equipment representation', () => {
        const fixture = TestBed.createComponent(ConstructionExtrasComponent);
        fixture.componentRef.setInput('entity', new BipedMekEntity(createTestEquipmentRegistry()));
        const choices = fixture.componentInstance.transportChoices().map(choice => choice.value);
        expect(choices).toEqual([]);
    });

    it('rejects mixed firing arcs and over-capacity weapon bays', () => {
        const weapon = new WeaponEquipment({ id: 'Laser', name: 'Laser', type: 'weapon',
            weapon: { atClass: 'LASER', av: [400, 0, 0, 0], capital: false } });
        const entity = new DropShipEntity(createTestEquipmentRegistry({ Laser: weapon }));
        const nose = addTestEquipment(entity, weapon, { location: 'Nose' });
        const otherNose = addTestEquipment(entity, weapon, { location: 'Nose' });
        const aft = addTestEquipment(entity, weapon, { location: 'Aft' });
        const fixture = TestBed.createComponent(ConstructionExtrasComponent);
        fixture.componentRef.setInput('entity', entity);
        const component = fixture.componentInstance;
        const bay = new EquipmentBay('weapon-bay', [nose]);
        expect(component.canAssign(bay, nose)).toBeTrue();
        expect(component.canAssign(bay, otherNose)).toBeFalse();
        expect(component.canAssign(bay, aft)).toBeFalse();
    });
});
