// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { TacticalHeatScaleComponent } from './tactical-heat-scale.component';
import type { NonMekRecordSheetSnapshot } from '../../models/runtime/non-mek-record-sheet';

describe('TacticalHeatScaleComponent', () => {
    function setup(readOnly = false) {
        TestBed.configureTestingModule({ imports: [TacticalHeatScaleComponent] });
        const fixture = TestBed.createComponent(TacticalHeatScaleComponent);
        fixture.componentRef.setInput('entity', { entityUuid: 'heat-test', heat: {
            current: 4, pending: null, dissipation: 10, tracked: true,
        } } as unknown as NonMekRecordSheetSnapshot);
        fixture.componentRef.setInput('readOnly', readOnly);
        fixture.detectChanges();
        const track = fixture.nativeElement.querySelector('.heat-track') as HTMLElement;
        spyOn(track, 'setPointerCapture');
        const cells = [...track.querySelectorAll<HTMLElement>('[data-heat]')];
        cells.forEach((cell, heat) => spyOn(cell, 'getBoundingClientRect').and.returnValue(
            new DOMRect(heat * 20, 0, 20, 32)));
        spyOn(track, 'getBoundingClientRect').and.returnValue(new DOMRect(0, 0, 640, 80));
        const changed = jasmine.createSpy('heatChange');
        fixture.componentInstance.heatChange.subscribe(changed);
        const pointer = (element: HTMLElement, type: string, heat: number) => element.dispatchEvent(
            new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: heat * 20 + 10, clientY: 16 }));
        return { fixture, track, cells, changed, pointer };
    }

    it('previews heat and effects while dragging and commits only once on release', () => {
        const { fixture, track, cells, changed, pointer } = setup();
        pointer(cells[4], 'pointerdown', 4);
        pointer(track, 'pointermove', 18);
        fixture.detectChanges();
        expect(changed).not.toHaveBeenCalled();
        expect(fixture.componentInstance.preview()).toBe(18);
        expect(fixture.nativeElement.querySelector('.drag-feedback').textContent).toContain('+14');
        expect(fixture.nativeElement.querySelector('.drag-feedback').textContent).toContain('Shutdown');
        pointer(track, 'pointerup', 18);
        cells[18].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
        expect(changed).toHaveBeenCalledOnceWith(18);
        expect(fixture.componentInstance.preview()).toBeNull();
    });

    it('cancels a drag without changing heat', () => {
        const { fixture, track, cells, changed, pointer } = setup();
        pointer(cells[4], 'pointerdown', 4);
        pointer(track, 'pointermove', 25);
        pointer(track, 'pointercancel', 25);
        expect(changed).not.toHaveBeenCalled();
        expect(fixture.componentInstance.displayedHeat()).toBe(4);
    });

    it('supports keyboard and overflow entry and rejects invalid heat', () => {
        const { fixture, track, changed } = setup();
        track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(changed).toHaveBeenCalledWith(5);
        fixture.componentInstance.setHeat(42);
        expect(changed).toHaveBeenCalledWith(42);
        changed.calls.reset();
        fixture.componentInstance.setHeat(NaN);
        fixture.componentInstance.setHeat(-1);
        fixture.componentInstance.setHeat(2.5);
        expect(changed).not.toHaveBeenCalled();
    });

    it('blocks all heat edits in read-only mode', () => {
        const { fixture, track, cells, changed, pointer } = setup(true);
        pointer(cells[4], 'pointerdown', 4);
        pointer(track, 'pointerup', 18);
        track.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        fixture.componentInstance.setHeat(42);
        expect(changed).not.toHaveBeenCalled();
        expect(fixture.componentInstance.preview()).toBeNull();
    });

    it('follows the inventory selection projection, including zero, and removes it when cleared', () => {
        const { fixture } = setup();
        fixture.componentRef.setInput('selectedHeat', 0);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.legend-item[data-marker="selected"]').textContent).toContain('0');
        fixture.componentRef.setInput('selectedHeat', null);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.legend-item[data-marker="selected"]')).toBeNull();
    });
});
