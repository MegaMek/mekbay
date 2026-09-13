// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { StaticEmplacementEntity } from '../../models/entity/entities/misc/static-emplacement-entity';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { BUILDING_DIRECTIONS, BUILDING_ORIGIN, buildingLocationName } from '../../models/entity/types/building';
import { createConstructionEntity } from '../domain/construction-factory';
import { setConstructionBuildingTopology } from '../domain/construction-building-topology';
import { ConstructionTopologyComponent } from './construction-topology.component';
import { DialogsService } from '../../services/dialogs.service';
import { of } from 'rxjs';

describe('building map elevator doors', () => {
  let fixture: ComponentFixture<ConstructionTopologyComponent>;
  let entity: StaticEmplacementEntity;
  const markers = (parent: ParentNode) =>
    [...parent.querySelectorAll<SVGPolygonElement>('.map-decorations [data-building-symbol="elevator-door"]')];
  const facings = (parent: ParentNode) => markers(parent).map(marker => Number(marker.getAttribute('data-building-facing')));

  beforeEach(() => {
    entity = createConstructionEntity('BuildingEntity', createTestEquipmentRegistry()) as StaticEmplacementEntity;
    setConstructionBuildingTopology(entity, [BUILDING_ORIGIN, ...BUILDING_DIRECTIONS], 3);
    entity.elevators.set([{ hex: BUILDING_ORIGIN, capacity: 20, exits: new Map([[0, 5], [1, 0], [2, 32]]) }]);
    entity.doors.set([{ position: { hex: BUILDING_DIRECTIONS[0], floor: 0 }, facing: 0, height: 2 }]);
    fixture = TestBed.createComponent(ConstructionTopologyComponent);
    fixture.componentRef.setInput('entity', entity);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('scrolls a zoomed map on both axes and supports switching back to wheel zoom', () => {
    const component = fixture.componentInstance;
    component.zoom.set(400);
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg.map-svg, svg') as SVGSVGElement;
    const wheel = (init: WheelEventInit) => svg.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, ...init,
    }));
    wheel({ deltaX: 20, deltaY: 30 });
    expect(component.zoom()).toBe(400);
    expect(component.pan().x).toBeGreaterThan(0);
    expect(component.pan().y).toBeGreaterThan(0);
    wheel({ ctrlKey: true, deltaY: 60 });
    expect(component.zoom()).toBeLessThan(400);
    component.optionsService.options.update(value => ({ ...value, mouseWheelAction: 'zoom' }));
    const zoom = component.zoom();
    wheel({ deltaY: 60 });
    expect(component.zoom()).toBeLessThan(zoom);
    const nextZoom = component.zoom();
    wheel({ ctrlKey: true, deltaY: 20 });
    expect(component.zoom()).toBe(nextZoom);
  });

  it('offers cleanup on footprint edits and applies either answer with the geometry change', async () => {
    fixture.componentInstance.editRequested.subscribe(edit => edit());
    const dialog = spyOn(TestBed.inject(DialogsService), 'createDialog');
    for (const remove of [true, false]) {
      setConstructionBuildingTopology(entity, [BUILDING_ORIGIN], 2);
      entity.doors.set([{ position: { hex: BUILDING_ORIGIN, floor: 0 }, facing: 1, height: 1 }]);
      dialog.and.returnValue({ closed: of(remove) } as ReturnType<DialogsService['createDialog']>);
      await fixture.componentInstance.activate(BUILDING_DIRECTIONS[1], false);
      expect(dialog).toHaveBeenCalled();
      expect(entity.coordinates().length).toBe(2);
      expect(entity.doors().length).toBe(remove ? 0 : 1);
    }
    entity.doors.set([]);
    entity.elevators.set([{ hex: BUILDING_ORIGIN, capacity: 20, exits: new Map([[0, 2], [1, 2]]) }]);
    fixture.componentInstance.select(BUILDING_DIRECTIONS[1]);
    dialog.and.returnValue({ closed: of(true) } as ReturnType<DialogsService['createDialog']>);
    await fixture.componentInstance.removeHex();
    expect(entity.coordinates().length).toBe(1);
    expect(entity.elevators().length).toBe(1);
    expect([...entity.elevators()[0].exits.values()]).toEqual([0, 0]);
  });

  it('draws linked opening lines in both top and pancake views', () => {
    setConstructionBuildingTopology(entity, [BUILDING_ORIGIN], 2);
    entity.doors.set([1, 2].map(facing => ({ position: { hex: BUILDING_ORIGIN, floor: 0 }, facing, height: 2, linkGroup: 1 })));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.linked-door-opening').length).toBe(2);
    const largeDoor = fixture.nativeElement.querySelector('.topology-key [data-building-symbol="large-door"]');
    expect(largeDoor.parentElement.textContent).toContain('Large Door');
    expect(largeDoor.querySelectorAll('polygon').length).toBe(2);
    expect(largeDoor.querySelectorAll('line').length).toBe(1);
    fixture.componentInstance.setViewMode('pancake');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.linked-door-opening').length).toBe(4);
    expect(fixture.nativeElement.querySelector('.topology-key [data-building-symbol="large-door"]')).not.toBeNull();
    entity.doors.update(doors => doors.map(door => ({ ...door, linkGroup: undefined })));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.topology-key [data-building-symbol="large-door"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.topology-key [data-building-symbol="door"]')).not.toBeNull();
  });

  it('shows distinct elevator access triangles for the selected floor and updates after an edit', () => {
    expect(facings(fixture.nativeElement)).toEqual([0, 2]);
    for (const marker of markers(fixture.nativeElement)) {
      expect(marker.points.numberOfItems).toBe(3);
      expect(getComputedStyle(marker).fill).toBe('rgb(239, 203, 141)');
    }
    const exterior = fixture.nativeElement.querySelector('.map-decorations [data-building-symbol="door"]');
    expect(getComputedStyle(exterior).fill).toBe('rgb(255, 255, 255)');
    expect(fixture.nativeElement.querySelector('.topology-key').textContent).toContain('Elevator door');

    fixture.componentRef.setInput('location', buildingLocationName(BUILDING_ORIGIN, 1));
    fixture.detectChanges();
    expect(facings(fixture.nativeElement)).toEqual([]);
    expect(fixture.nativeElement.querySelector('.hex-map [data-building-symbol="elevator"]')).not.toBeNull();

    fixture.componentRef.setInput('location', buildingLocationName(BUILDING_ORIGIN, 2));
    fixture.detectChanges();
    expect(facings(fixture.nativeElement)).toEqual([5]);
    entity.elevators.set([{ ...entity.elevators()[0], exits: new Map([[0, 5], [1, 0], [2, 8]]) }]);
    fixture.detectChanges();
    expect(facings(fixture.nativeElement)).toEqual([3]);
  });

  it('draws each pancake layer with its own access sides and keeps roof exits off interior floors', () => {
    entity.elevators.set([{ ...entity.elevators()[0], exits: new Map([[0, 63], [2, 32], [3, 8]]) }]);
    fixture.componentInstance.setViewMode('pancake');
    fixture.detectChanges();
    for (const [floor, sides] of [[0, [0, 1, 2, 3, 4, 5]], [1, []], [2, [5]]] as const) {
      const layer = fixture.nativeElement.querySelector(`.pancake-layer[data-floor="${floor}"]`);
      expect(facings(layer)).toEqual([...sides]);
      for (const marker of markers(layer)) {
        expect(marker.getAttribute('transform')).toBe('matrix(1 0 -0.35 0.38 0 0)');
      }
    }
  });
});
