// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { OptionsService } from '../../../services/options.service';
import { DbService } from '../../../services/db.service';
import { LoggerService } from '../../../services/logger.service';
import { PageCanvasOverlayComponent } from './page-canvas-overlay.component';
import { PageViewerCanvasService } from './page-viewer-canvas.service';

describe('PageCanvasOverlayComponent pixel lifecycle', () => {
    let fixture: ComponentFixture<PageCanvasOverlayComponent>;
    let component: PageCanvasOverlayComponent;
    let canvas: HTMLCanvasElement;
    let drawing: PageViewerCanvasService;
    let db: { getCanvasData: jasmine.Spy; saveCanvasData: jasmine.Spy; deleteCanvasData: jasmine.Spy };

    beforeEach(async () => {
        db = { getCanvasData: jasmine.createSpy('getCanvasData').and.resolveTo(null),
            saveCanvasData: jasmine.createSpy('saveCanvasData').and.resolveTo(),
            deleteCanvasData: jasmine.createSpy('deleteCanvasData').and.resolveTo() };
        TestBed.configureTestingModule({ providers: [
            PageViewerCanvasService,
            { provide: OptionsService, useValue: { options: () => ({ canvasInput: 'all' }) } },
            { provide: DbService, useValue: db },
            { provide: LoggerService, useValue: { error: jasmine.createSpy('error') } },
        ] });
        fixture = TestBed.createComponent(PageCanvasOverlayComponent);
        fixture.componentRef.setInput('unit', { id: 'a', modified: true });
        component = fixture.componentInstance;
        drawing = TestBed.inject(PageViewerCanvasService);
        fixture.detectChanges();
        await fixture.whenStable();
        canvas = fixture.nativeElement.querySelector('canvas');
        spyOn(canvas, 'getBoundingClientRect').and.returnValue(new DOMRect(0, 0, 612, 792));
    });

    function pointer(type: string, id = 1, pointerType = 'mouse', x = 10): PointerEvent {
        return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id,
            pointerType, clientX: x, clientY: 10, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    }

    function startStroke(id = 1, pointerType = 'mouse'): void {
        drawing.mode.set('brush');
        component.canvasContainer().nativeElement.dispatchEvent(pointer('pointerdown', id, pointerType));
    }

    it('keeps a blank sheet at zero pixel capacity and exports no blank PNG', async () => {
        expect([canvas.width, canvas.height]).toEqual([0, 0]);
        expect(await component.exportImageData()).toBeNull();
        expect(db.getCanvasData).toHaveBeenCalledOnceWith('a');
    });

    it('allocates at full resolution on the first stroke and preserves it through Angular renders', async () => {
        startStroke();
        expect([canvas.width, canvas.height]).toEqual([1224, 1584]);
        const ctx = canvas.getContext('2d')!;
        expect(ctx.getImageData(20, 20, 1, 1).data[3]).toBeGreaterThan(0);
        fixture.detectChanges();
        expect(ctx.getImageData(20, 20, 1, 1).data[3]).toBeGreaterThan(0);
        await component['onPointerUp'](pointer('pointerup'));
        expect(db.saveCanvasData).toHaveBeenCalledWith('a', jasmine.any(Blob));
        component.clearCanvas();
        expect([canvas.width, canvas.height]).toEqual([0, 0]);
    });

    it('preserves earlier ink on repeated strokes with fractional A4 page dimensions', async () => {
        fixture.componentRef.setInput('width', 595.276);
        fixture.componentRef.setInput('height', 841.89);
        fixture.detectChanges();
        await fixture.whenStable();
        startStroke();
        const ctx = canvas.getContext('2d')!;
        const before = Array.from(ctx.getImageData(16, 16, 10, 10).data);
        expect(before.some(value => value > 0)).toBeTrue();
        await component['onPointerUp'](pointer('pointerup'));
        component.canvasContainer().nativeElement.dispatchEvent(pointer('pointerdown', 2, 'mouse', 200));
        window.dispatchEvent(pointer('pointermove', 2, 'mouse', 240));
        expect([canvas.width, canvas.height]).toEqual([1190, 1683]);
        expect(Array.from(ctx.getImageData(16, 16, 10, 10).data)).toEqual(before);
        await component['onPointerUp'](pointer('pointerup', 2));
    });

    it('keeps touch-to-zoom handoff free of ink and full-size canvas buffers', () => {
        startStroke(1, 'touch');
        expect(canvas.width).toBe(0);
        component.canvasContainer().nativeElement.dispatchEvent(pointer('pointerdown', 2, 'touch'));
        expect(drawing.isMultitouchActive()).toBeTrue();
        expect(canvas.width).toBe(0);
        window.dispatchEvent(pointer('pointerup', 1, 'touch'));
        window.dispatchEvent(pointer('pointerup', 2, 'touch'));
        expect(drawing.isMultitouchActive()).toBeFalse();
    });

    it('allocates saved ink in viewing mode after image decoding', () => {
        const decoded = new Image();
        spyOnProperty(decoded, 'src', 'set').and.stub();
        spyOn(window, 'Image').and.returnValue(decoded);
        const paint = spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
        component.importImageData(new Blob());
        expect(canvas.width).toBe(0);
        decoded.onload!(new Event('load'));
        expect(drawing.mode()).toBe('none');
        expect([canvas.width, canvas.height]).toEqual([1224, 1584]);
        expect(paint as jasmine.Spy).toHaveBeenCalledOnceWith(decoded, 0, 0, 1224, 1584);
    });

    it('ignores decoded ink after clearing or destroying its canvas', () => {
        const decoded = new Image();
        spyOnProperty(decoded, 'src', 'set').and.stub();
        spyOn(window, 'Image').and.returnValue(decoded);
        const paint = spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
        component.importImageData(new Blob());
        component.clearCanvas();
        decoded.onload!(new Event('load'));
        expect(canvas.width).toBe(0);
        expect(paint).not.toHaveBeenCalled();
        component.importImageData(new Blob());
        fixture.destroy();
        decoded.onload!(new Event('load'));
        expect(paint).not.toHaveBeenCalled();
    });

    it('does not restore saved ink when a database read finishes after clear', async () => {
        let complete!: (blob: Blob) => void;
        db.getCanvasData.and.returnValue(new Promise<Blob>(resolve => { complete = resolve; }));
        fixture.componentRef.setInput('unit', { id: 'b', modified: true });
        fixture.detectChanges();
        TestBed.tick();
        const loadImage = spyOn(component, 'importImageData');
        component.clearCanvas();
        complete(new Blob());
        await Promise.resolve();
        expect(loadImage).not.toHaveBeenCalled();
        expect(canvas.width).toBe(0);
    });

    it('keeps a slow older PNG export from overwriting a newer stroke or undoing clear', async () => {
        const complete: Array<(blob: Blob) => void> = [];
        spyOn(component, 'exportImageData').and.callFake(() => new Promise<Blob>(resolve => complete.push(resolve)));
        startStroke(1);
        const first = component['onPointerUp'](pointer('pointerup', 1));
        startStroke(2);
        const second = component['onPointerUp'](pointer('pointerup', 2));
        const latest = new Blob(['latest']);
        complete[1](latest);
        await second;
        complete[0](new Blob(['old']));
        await first;
        expect(db.saveCanvasData).toHaveBeenCalledOnceWith('a', latest);
        startStroke(3);
        const third = component['onPointerUp'](pointer('pointerup', 3));
        component.clearCanvas();
        complete[2](new Blob(['cleared']));
        await third;
        expect(db.saveCanvasData).toHaveBeenCalledTimes(1);
    });
});
