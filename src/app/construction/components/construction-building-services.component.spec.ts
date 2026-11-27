// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { StaticEmplacementEntity } from '../../models/entity/entities/misc/static-emplacement-entity';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { buildingHexKey, buildingLocationName } from '../../models/entity/types/building';
import { createConstructionEntity } from '../domain/construction-factory';
import { setConstructionBuildingTopology } from '../domain/construction-building-topology';
import { ConstructionBuildingServicesComponent } from './construction-building-services.component';

describe('building service hex side controls', () => {
  const origin = { q: 0, r: 0 },
    north = { q: 0, r: -1 },
    southeast = { q: 1, r: 0 };
  let fixture: ComponentFixture<ConstructionBuildingServicesComponent>;
  let entity: StaticEmplacementEntity;
  let edited: jasmine.Spy;
  const side = (label: string) => fixture.nativeElement.querySelector(`[aria-label="${label}"]`) as SVGGElement;
  const click = (label: string) => {
    side(label).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
  };

  beforeEach(() => {
    entity = createConstructionEntity('BuildingEntity', createTestEquipmentRegistry()) as StaticEmplacementEntity;
    setConstructionBuildingTopology(entity, [origin, north, southeast], 2);
    fixture = TestBed.createComponent(ConstructionBuildingServicesComponent);
    fixture.componentRef.setInput('entity', entity);
    fixture.componentRef.setInput('location', buildingLocationName(origin, 0));
    edited = jasmine.createSpy('edited');
    fixture.componentInstance.editRequested.subscribe((edit) => {
      edited();
      edit();
    });
  });

  afterEach(() => fixture.destroy());

  it('expands assigned sections on selection and collapses empty sections while allowing manual expansion', async () => {
    entity.doors.set([{ position: { hex: north, floor: 0 }, facing: 0, height: 1 }]);
    entity.elevators.set([{ hex: north, capacity: 20, exits: new Map([[0, 8], [1, 8]]) }]);
    fixture.detectChanges();
    const panels = () => [...fixture.nativeElement.querySelectorAll('details')] as HTMLDetailsElement[];
    expect(panels().map(panel => panel.open)).toEqual([false, false, false, false]);
    panels()[0].open = true;
    panels()[0].dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
    expect(panels()[0].open).toBeTrue();
    fixture.componentRef.setInput('location', buildingLocationName(north, 0));
    fixture.detectChanges();
    expect(panels().map(panel => panel.open)).toEqual([true, true, false, false]);
    fixture.componentRef.setInput('location', buildingLocationName(southeast, 0));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(panels().map(panel => panel.open)).toEqual([false, false, false, false]);
  });

  it('offers local and neighboring door links, synchronizes height and unlinks a segment', () => {
    setConstructionBuildingTopology(entity, [origin, { q: 0, r: 1 }], 2);
    entity.doors.set([
      { position: { hex: origin, floor: 0 }, facing: 1, height: 1 },
      { position: { hex: origin, floor: 0 }, facing: 2, height: 1 },
      { position: { hex: { q: 0, r: 1 }, floor: 0 }, facing: 1, height: 1 },
    ]);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.doorLinks().length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.door-link').length).toBe(2);
    component.toggleDoorLink(entity.doors()[0], entity.doors()[1]);
    component.toggleDoorLink(entity.doors()[1], entity.doors()[2]);
    component.changeDoorHeight(0, 2);
    fixture.detectChanges();
    expect(entity.doors().map(door => door.height)).toEqual([2, 2, 2]);
    expect(component.doorLinks().every(link => link.linked)).toBeTrue();
    component.toggleDoorLink(entity.doors()[1], entity.doors()[2]);
    fixture.detectChanges();
    expect(entity.doors().every(door => !door.linkGroup)).toBeTrue();
  });

  it('shows an empty diagram and toggles independent doors with mouse and keyboard', () => {
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('details');
    expect(panel.querySelectorAll('construction-hex-sides').length).toBe(1);
    expect(panel.querySelectorAll('button, select, input').length).toBe(0);
    expect(panel.querySelector('.door-marker')).toBeNull();

    click('Door side NW');
    side('Door side S').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(entity.doors()).toEqual([
      { position: { hex: origin, floor: 0 }, facing: 5, height: 1 },
      { position: { hex: origin, floor: 0 }, facing: 3, height: 1 },
    ]);
    expect(side('Door side NW').getAttribute('aria-pressed')).toBe('true');
    expect(side('Door side NW').querySelector('.door-marker')).not.toBeNull();
    expect(panel.querySelectorAll('input').length).toBe(2);
    expect(panel.querySelector('[aria-label="NE door height"]')).toBeNull();

    side('Door side NW').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    fixture.detectChanges();
    expect(entity.doors()).toEqual([{ position: { hex: origin, floor: 0 }, facing: 3, height: 1 }]);
    expect(side('Door side NW').getAttribute('aria-pressed')).toBe('false');
    expect(panel.querySelector('[aria-label="NW door height"]')).toBeNull();
    click('Door side S');
    expect(entity.doors()).toEqual([]);
    expect(panel.querySelectorAll('input').length).toBe(0);
    expect(edited).toHaveBeenCalledTimes(4);
  });

  it('scopes doors and edits to the selected hex and starting level', () => {
    const groundDoor = { position: { hex: origin, floor: 0 }, facing: 3, height: 2 };
    const otherHexDoor = { position: { hex: north, floor: 1 }, facing: 0, height: 1 };
    entity.doors.set([groundDoor, otherHexDoor, { position: { hex: origin, floor: 1 }, facing: 5, height: 1 }]);
    fixture.detectChanges();
    expect(side('Door side S').getAttribute('aria-pressed')).toBe('true');
    expect(side('Door side NW').getAttribute('aria-pressed')).toBe('false');
    expect(fixture.nativeElement.querySelectorAll('.door-height').length).toBe(1);

    fixture.componentRef.setInput('location', buildingLocationName(origin, 1));
    fixture.detectChanges();
    expect(side('Door side S').getAttribute('aria-pressed')).toBe('false');
    expect(side('Door side S').getAttribute('aria-disabled')).toBe('true');
    expect(side('Door side NW').getAttribute('aria-pressed')).toBe('true');
    click('Door side NW');
    click('Door side NE');
    click('Door side S');
    expect(entity.doors()).toEqual([
      groundDoor, otherHexDoor, { position: { hex: origin, floor: 1 }, facing: 1, height: 1 },
    ]);

    fixture.componentRef.setInput('location', buildingLocationName(north, 1));
    fixture.detectChanges();
    expect(side('Door side N').getAttribute('aria-pressed')).toBe('true');
    expect(side('Door side NE').getAttribute('aria-pressed')).toBe('false');
    click('Door side N');
    expect(entity.doors()).toEqual([
      groundDoor, { position: { hex: origin, floor: 1 }, facing: 1, height: 1 },
    ]);
    expect(edited).toHaveBeenCalledTimes(3);
  });

  it('edits only the matching direction height and keeps it within the remaining floors', async () => {
    entity.doors.set([
      { position: { hex: north, floor: 0 }, facing: 0, height: 1 },
      { position: { hex: origin, floor: 0 }, facing: 3, height: 1 },
      { position: { hex: origin, floor: 0 }, facing: 5, height: 1 },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('[aria-label="S door height"]') as HTMLInputElement;
    input.click();
    input.value = '2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(entity.doors().map(door => door.height)).toEqual([1, 2, 1]);
    expect(entity.doors().map(door => door.facing)).toEqual([0, 3, 5]);
    expect(input.max).toBe('2');
    for (const invalid of ['', '0', '1.5', '3']) {
      input.value = invalid;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
    }
    expect(entity.doors().map(door => door.height)).toEqual([1, 2, 1]);
    expect(edited).toHaveBeenCalledTimes(1);
  });

  it('rejects internal edges, read-only edits, roof doors and buildings without doors', () => {
    fixture.detectChanges();
    expect(side('Door side N').getAttribute('aria-disabled')).toBe('true');
    click('Door side N');
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    click('Door side S');
    fixture.componentRef.setInput('disabled', false);
    fixture.componentRef.setInput('location', buildingLocationName(origin, 2));
    fixture.detectChanges();
    click('Door side S');
    fixture.componentRef.setInput('location', buildingLocationName(origin, 0));
    for (const classification of [3, 5, 7, 8]) {
      entity.buildingClass.set(classification);
      fixture.detectChanges();
      click('Door side S');
    }
    expect(entity.doors()).toEqual([]);
    expect(edited).not.toHaveBeenCalled();
  });

  it('toggles elevator access independently at each level with mouse and keyboard', () => {
    entity.elevators.set([
      {
        hex: origin,
        capacity: 20,
        exits: new Map([
          [0, 5],
          [1, 1],
        ]),
      },
    ]);
    fixture.detectChanges();
    click('Elevator 1 level G access N');
    expect(entity.elevators()[0].exits.get(0)).toBe(4);
    expect(entity.elevators()[0].exits.get(1)).toBe(1);
    side('Elevator 1 level 1 access SE').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(entity.elevators()[0].exits.get(1)).toBe(5);
    side('Elevator 1 level 1 access N').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    fixture.detectChanges();
    expect(entity.elevators()[0].exits.get(1)).toBe(4);
    click('Elevator 1 level G access S');
    expect(edited).toHaveBeenCalledTimes(3);
    expect(side('Elevator 1 level 1 access SE').getAttribute('aria-pressed')).toBe('true');
  });

  it('starts a roof-selected elevator below the roof and derives each new stop from neighboring heights', () => {
    entity = createConstructionEntity('MobileStructure', createTestEquipmentRegistry()) as StaticEmplacementEntity;
    setConstructionBuildingTopology(entity, [origin, north, southeast], 3);
    entity.hexHeights.set(new Map([[buildingHexKey(north), 1], [buildingHexKey(southeast), 2]]));
    fixture.componentRef.setInput('entity', entity);
    fixture.componentRef.setInput('location', buildingLocationName(origin, 3));
    fixture.detectChanges();
    fixture.componentInstance.addLift();
    expect([...entity.elevators()[0].exits]).toEqual([[2, 4], [3, 0]]);

    fixture.componentInstance.setLiftRange(0, 0, 3);
    expect([...entity.elevators()[0].exits]).toEqual([[0, 5], [1, 5], [2, 4], [3, 0]]);
    fixture.componentInstance.setLiftSide(0, 0, 0, false);
    fixture.componentInstance.setLiftRange(0, 0, 2);
    expect([...entity.elevators()[0].exits]).toEqual([[0, 4], [1, 5], [2, 4]]);
  });

  it('moves a bay door without changing its bay or floor and rejects joined edges', () => {
    entity.transporters.set([
      { id: 'cargo', kind: 'bay', configuration: { type: 'cargo' }, capacity: 10, doors: 1, bayNumber: 1, omni: false },
    ]);
    entity.bayDoors.set([{ bayId: 'cargo', position: { hex: origin, floor: 1 }, facing: 3 }]);
    fixture.detectChanges();
    click('Bay door 1 side SW');
    expect(entity.bayDoors()[0]).toEqual({ bayId: 'cargo', position: { hex: origin, floor: 1 }, facing: 4 });
    expect(side('Bay door 1 side SW').getAttribute('aria-pressed')).toBe('true');
    click('Bay door 1 side SE');
    expect(edited).toHaveBeenCalledTimes(1);
  });
});
