// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Component, input, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OptionsService } from '../../../services/options.service';
import { DataService } from '../../../services/data.service';
import { UnitFluffImageService } from '../../../services/catalogs/unit-fluff-image.service';
import { DialogsService } from '../../../services/dialogs.service';
import { PickerFactoryService } from '../../../services/picker-factory.service';
import { createEmptyUnit } from '../../../testing/unit-test-helpers';
import { SvgExportUtil } from '../../../utils/svg-export.util';
import { AlphaStrikeCardComponent } from '../../alpha-strike-card/alpha-strike-card.component';
import { UnitDetailsCardTabComponent } from './unit-details-card-tab.component';

@Component({
    selector: 'alpha-strike-card',
    styles: [`
        :host { position: relative; --card-text-color: #681c0c; }
        svg { display: block; width: 100%; height: auto; }
        .card-text { fill: var(--card-text-color); }
        button { position: absolute; bottom: 0; }
    `],
    template: `<svg class="card-svg" viewBox="0 0 1120 800">
        <text class="card-text">Card {{ cardIndex() }}</text>
        <g data-screen-only><text>ROLL CRITICAL</text></g>
        <g class="screen-only"><text>END TURN</text></g>
    </svg><button>COMMIT</button>`,
})
class TestCardComponent {
    readonly unit = input();
    readonly fluffImageUrl = input();
    readonly useHex = input();
    readonly cardIndex = input();
    readonly cardStyle = input();
}

describe('UnitDetailsCardTabComponent', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [UnitDetailsCardTabComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: OptionsService, useValue: { options: signal({ ASUseHex: false, colorScheme: 'dark' }) } },
            ],
        }).overrideComponent(UnitDetailsCardTabComponent, {
            remove: { imports: [AlphaStrikeCardComponent] },
            add: { imports: [TestCardComponent] },
        });
    });

    function createComponent(width = 1000, height = 300) {
        const fixture = TestBed.createComponent(UnitDetailsCardTabComponent);
        (fixture.nativeElement as HTMLElement).style.cssText = `width: ${width}px; height: ${height}px;`;
        fixture.componentRef.setInput('unit', createEmptyUnit({ chassis: 'Astrolux', model: 'LC-100', as: { TP: 'SC' } }));
        fixture.detectChanges();
        return fixture;
    }

    async function settleLayout(): Promise<void> {
        for (let frame = 0; frame < 3; frame++) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
    }

    function viewport(fixture: ReturnType<typeof createComponent>): HTMLElement {
        return fixture.nativeElement.querySelector('.tab-content');
    }

    function cardRect(fixture: ReturnType<typeof createComponent>, index = 0): DOMRect {
        return fixture.nativeElement.querySelectorAll('svg.card-svg')[index].getBoundingClientRect();
    }

    it('fits both cards side by side at 100% in a wide viewport, centered with space on both sides', async () => {
        const fixture = createComponent();
        await settleLayout();
        const container = viewport(fixture);
        const bounds = container.getBoundingClientRect();
        const card = cardRect(fixture);
        const second = cardRect(fixture, 1);

        expect(fixture.componentInstance.zoomPercent()).toBe(100);
        expect(fixture.componentInstance.minZoomPercent).toBe(100);
        expect(card.height).toBeCloseTo(container.clientHeight, 0);
        expect(card.top).toBeCloseTo(bounds.top, 0);
        expect(card.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
        expect(card.left - bounds.left).toBeGreaterThan(0);
        expect(card.left - bounds.left).toBeCloseTo(bounds.left + container.clientWidth - second.right, 0);
        expect(second.top).toBeCloseTo(card.top, 0);
        expect(second.left).toBeCloseTo(card.right, 0);
        expect(container.scrollHeight).toBeCloseTo(card.height, 0);
        expect(fixture.componentInstance.isZoomPanActive()).toBeFalse();
    });

    it('stacks cards when that fits them larger and changes arrangement on resize without resetting zoom', async () => {
        const fixture = createComponent(320, 500);
        await settleLayout();
        expect(cardRect(fixture, 1).top).toBeCloseTo(cardRect(fixture).bottom, 0);
        expect(cardRect(fixture, 1).left).toBeCloseTo(cardRect(fixture).left, 0);
        expect(cardRect(fixture).width).toBeCloseTo(viewport(fixture).clientWidth, 0);

        fixture.componentInstance.setZoomPercent(150);
        await settleLayout();
        (fixture.nativeElement as HTMLElement).style.cssText = 'width: 1000px; height: 300px;';
        await settleLayout();
        expect(cardRect(fixture, 1).top).toBeCloseTo(cardRect(fixture).top, 0);
        expect(cardRect(fixture, 1).left).toBeCloseTo(cardRect(fixture).right, 0);
        expect(fixture.componentInstance.zoomPercent()).toBe(150);
        expect(cardRect(fixture).height).toBeCloseTo(viewport(fixture).clientHeight * 1.5, 0);
    });

    for (const [width, height, minimum] of [
        [900, 500, 64], [500, 500, 70], [500, 505, 71],
        [1000, 300, 100], [320, 500, 100], [900.25, 500.75, 64],
    ]) {
        it(`stops zooming out as soon as both cards fit in a ${width}x${height} viewport`, async () => {
            const fixture = createComponent(width, height);
            await settleLayout();
            const container = viewport(fixture);
            if (width > height * 1120 / 800) {
                expect(cardRect(fixture, 1).top).toBeCloseTo(cardRect(fixture).top, 0);
            } else {
                expect(cardRect(fixture, 1).top).toBeCloseTo(cardRect(fixture).bottom, 0);
            }
            expect(fixture.componentInstance.minZoomPercent).toBe(minimum);
            fixture.componentInstance.setZoomPercent(minimum);
            await settleLayout();
            const bounds = container.getBoundingClientRect();
            for (const index of [0, 1]) {
                const card = cardRect(fixture, index);
                expect(card.top).toBeGreaterThanOrEqual(bounds.top - 1);
                expect(card.left).toBeGreaterThanOrEqual(bounds.left - 1);
                expect(card.bottom).toBeLessThanOrEqual(bounds.top + container.clientHeight + 1);
                expect(card.right).toBeLessThanOrEqual(bounds.left + container.clientWidth + 1);
            }
            const first = cardRect(fixture);
            const second = cardRect(fixture, 1);
            expect(Math.min(
                Math.abs(second.right - first.left - bounds.width),
                Math.abs(second.bottom - first.top - bounds.height),
            )).toBeLessThan(0.1);
            expect(container.scrollWidth).toBe(container.clientWidth);
            expect(container.scrollHeight).toBe(container.clientHeight);
            expect(fixture.componentInstance.zoomPercent()).toBe(minimum);
            expect(fixture.componentInstance.isZoomPanActive()).toBeFalse();
        });
    }

    it('clamps the slider, wheel, and pinch to the full-card-set fit and resets to 100%', async () => {
        const fixture = createComponent(900, 500);
        await settleLayout();
        const component = fixture.componentInstance;
        const container = viewport(fixture);
        const originalWidth = cardRect(fixture).width;
        component.setZoomPercent(64.33);
        await settleLayout();
        component.setZoomPercent(0);
        await settleLayout();
        expect(cardRect(fixture).width).toBeCloseTo(container.clientWidth / 2, 0);
        expect(component.isZoomPanActive()).toBeFalse();

        container.dispatchEvent(new WheelEvent('wheel', { deltaY: 10000, cancelable: true }));
        expect(component.zoomPercent()).toBe(component.minZoomPercent);
        const pointer = (type: string, pointerId: number, clientX: number) => container.dispatchEvent(new PointerEvent(type, {
            pointerId, pointerType: 'touch', isPrimary: pointerId === 1, clientX, clientY: 250,
            bubbles: true, cancelable: true,
        }));
        pointer('pointerdown', 1, 100);
        pointer('pointerdown', 2, 800);
        pointer('pointermove', 2, 101);
        pointer('pointerup', 2, 101);
        pointer('pointerup', 1, 100);
        await settleLayout();
        expect(component.zoomPercent()).toBe(component.minZoomPercent);
        expect(cardRect(fixture).width).toBeCloseTo(container.clientWidth / 2, 0);

        component.resetZoom();
        await settleLayout();
        expect(component.zoomPercent()).toBe(100);
        expect(cardRect(fixture).width).toBeCloseTo(originalWidth, 0);
    });

    it('raises the zoom to the new minimum on resize and recalculates it when the unit changes', async () => {
        const fixture = createComponent(900, 500);
        const component = fixture.componentInstance;
        await settleLayout();
        component.setZoomPercent(0);
        await settleLayout();
        expect(component.zoomPercent()).toBe(64);

        (fixture.nativeElement as HTMLElement).style.cssText = 'width: 1000px; height: 300px;';
        await settleLayout();
        expect(component.minZoomPercent).toBe(100);
        expect(component.zoomPercent()).toBe(100);
        expect(cardRect(fixture).height).toBeCloseTo(viewport(fixture).clientHeight, 0);

        (fixture.nativeElement as HTMLElement).style.cssText = 'width: 900px; height: 500px;';
        await settleLayout();
        expect(component.minZoomPercent).toBe(64);
        expect(component.zoomPercent()).toBe(100);
        component.setZoomPercent(0);
        await settleLayout();

        fixture.componentRef.setInput('unit', createEmptyUnit({ as: { TP: 'BM' } }));
        fixture.detectChanges();
        await settleLayout();
        expect(component.minZoomPercent).toBe(100);
        expect(component.zoomPercent()).toBe(100);

        fixture.componentRef.setInput('unit', createEmptyUnit({ as: { TP: 'SC' } }));
        fixture.detectChanges();
        await settleLayout();
        expect(component.minZoomPercent).toBe(64);
        expect(component.zoomPercent()).toBe(100);
    });

    for (const [initialZoom, expectedZoom] of [
        [50, 100], [99, 100], [99.49, 100], [99.5, 250], [100, 250],
        [100.49304883483048304, 250], [100.51, 100], [101, 100], [250, 100],
    ]) {
        it(`double-click changes ${initialZoom}% zoom to ${expectedZoom}%`, async () => {
            const fixture = createComponent(900, 500);
            const component = fixture.componentInstance;
            // Start away from 100% so rounding is checked against the actual fractional scale.
            component.setZoomPercent(50);
            await settleLayout();
            component.setZoomPercent(initialZoom);
            await settleLayout();
            const container = viewport(fixture);
            container.dispatchEvent(new MouseEvent('dblclick', {
                clientX: 500, clientY: 150, bubbles: true, cancelable: true,
            }));

            expect(component.zoomPercent()).toBe(expectedZoom);
            if (expectedZoom === 100) {
                expect(container.scrollLeft).toBe(0);
                expect(container.scrollTop).toBe(0);
            }
        });
    }

    it('resets from the full-card-set fit on touch double-tap and ignores its synthetic double-click', async () => {
        const fixture = createComponent(900, 500);
        const component = fixture.componentInstance;
        component.setZoomPercent(50);
        await settleLayout();
        const container = viewport(fixture);
        for (const pointerId of [1, 2]) {
            for (const type of ['pointerdown', 'pointerup']) {
                container.dispatchEvent(new PointerEvent(type, {
                    pointerId, pointerType: 'touch', isPrimary: true, clientX: 500, clientY: 150,
                    bubbles: true, cancelable: true,
                }));
            }
        }
        expect(component.zoomPercent()).toBe(100);

        container.dispatchEvent(new MouseEvent('dblclick', { clientX: 500, clientY: 150, cancelable: true }));
        expect(component.zoomPercent()).toBe(100);
    });

    it('fits a single card in a narrow viewport and refits when the viewport changes', async () => {
        const fixture = createComponent();
        fixture.componentRef.setInput('unit', createEmptyUnit({ as: { TP: 'BM' } }));
        (fixture.nativeElement as HTMLElement).style.cssText = 'width: 320px; height: 500px;';
        fixture.detectChanges();
        await settleLayout();
        const container = viewport(fixture);
        expect(cardRect(fixture).width).toBeCloseTo(container.clientWidth, 0);
        expect(cardRect(fixture).height).toBeLessThan(container.clientHeight);
        expect(fixture.componentInstance.minZoomPercent).toBe(100);
        fixture.componentInstance.setZoomPercent(50);
        await settleLayout();
        container.dispatchEvent(new WheelEvent('wheel', { deltaY: 10000, cancelable: true }));
        expect(fixture.componentInstance.zoomPercent()).toBe(100);
        expect(cardRect(fixture).width).toBeCloseTo(container.clientWidth, 0);

        (fixture.nativeElement as HTMLElement).style.cssText = 'width: 1000px; height: 300px;';
        await settleLayout();
        expect(cardRect(fixture).height).toBeCloseTo(container.clientHeight, 0);
        expect(cardRect(fixture).width).toBeLessThan(container.clientWidth);
        expect(fixture.componentInstance.minZoomPercent).toBe(100);
        expect(fixture.componentInstance.zoomPercent()).toBe(100);
    });

    it('keeps the visible center anchored when the zoom slider changes', async () => {
        const fixture = createComponent();
        fixture.componentRef.setInput('unit', createEmptyUnit({ as: { TP: 'BM' } }));
        fixture.detectChanges();
        await settleLayout();
        const container = viewport(fixture);
        const bounds = container.getBoundingClientRect();
        const center = { x: bounds.left + container.clientWidth / 2, y: bounds.top + container.clientHeight / 2 };
        const before = cardRect(fixture);

        fixture.componentInstance.setZoomPercent(200);
        await settleLayout();
        const after = cardRect(fixture);

        expect(after.width).toBeCloseTo(before.width * 2, 0);
        expect((center.x - after.left) / after.width).toBeCloseTo((center.x - before.left) / before.width, 2);
        expect((center.y - after.top) / after.height).toBeCloseTo((center.y - before.top) / before.height, 2);
        expect(container.scrollTop).toBeGreaterThan(0);
    });

    it('zooms at the cursor with an unmodified wheel and resets to a full card', async () => {
        const fixture = createComponent();
        await settleLayout();
        const container = viewport(fixture);
        const bounds = container.getBoundingClientRect();
        const before = cardRect(fixture);
        const cursor = { clientX: bounds.left + container.clientWidth / 2, clientY: before.top + before.height * 0.7 };
        const wheel = new WheelEvent('wheel', { ...cursor, deltaY: -200, bubbles: true, cancelable: true });

        container.dispatchEvent(wheel);
        const after = cardRect(fixture);
        expect(wheel.defaultPrevented).toBeTrue();
        expect(fixture.componentInstance.zoomPercent()).toBeGreaterThan(100);
        expect((cursor.clientY - after.top) / after.height).toBeCloseTo(0.7, 2);

        fixture.componentInstance.resetZoom();
        await settleLayout();
        expect(fixture.componentInstance.zoomPercent()).toBe(100);
        expect(container.scrollTop).toBe(0);
        expect(container.scrollLeft).toBe(0);
        expect(cardRect(fixture).height).toBeCloseTo(container.clientHeight, 0);
    });

    it('drags enlarged cards in both directions and clamps at the content edges', async () => {
        const fixture = createComponent();
        await settleLayout();
        const container = viewport(fixture);
        fixture.componentInstance.setZoomPercent(300);
        await settleLayout();
        const startLeft = container.scrollLeft;
        const startTop = container.scrollTop;
        const pointer = (type: string, clientX: number, clientY: number) => container.dispatchEvent(new PointerEvent(type, {
            pointerId: 1, pointerType: 'mouse', button: 0, clientX, clientY, bubbles: true, cancelable: true,
        }));

        pointer('pointerdown', 500, 150);
        pointer('pointermove', 450, 100);
        expect(container.scrollLeft).toBeCloseTo(startLeft + 50, 0);
        expect(container.scrollTop).toBeCloseTo(startTop + 50, 0);
        pointer('pointermove', -10000, -10000);
        expect(container.scrollLeft).toBeGreaterThanOrEqual(container.scrollWidth - container.clientWidth - 1);
        expect(container.scrollLeft).toBeLessThanOrEqual(container.scrollWidth - container.clientWidth);
        expect(container.scrollTop).toBeGreaterThanOrEqual(container.scrollHeight - container.clientHeight - 1);
        expect(container.scrollTop).toBeLessThanOrEqual(container.scrollHeight - container.clientHeight);
        pointer('pointermove', 10000, 10000);
        pointer('pointerup', 10000, 10000);
        expect(container.scrollLeft).toBe(0);
        expect(container.scrollTop).toBe(0);
        expect(getComputedStyle(container).overflow).toBe('auto');
        expect(getComputedStyle(container).touchAction).toBe('none');
    });

    it('keeps the second card reachable at 100% with Ctrl+wheel', async () => {
        const fixture = createComponent(500, 500);
        await settleLayout();
        const container = viewport(fixture);
        container.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: 10000, cancelable: true }));

        const second = fixture.nativeElement.querySelectorAll('svg.card-svg')[1].getBoundingClientRect();
        expect(second.top).toBeGreaterThanOrEqual(container.getBoundingClientRect().top - 1);
        expect(second.bottom).toBeCloseTo(container.getBoundingClientRect().bottom, 0);
        expect(fixture.componentInstance.zoomPercent()).toBe(100);
    });

    it('pans overflowing side-by-side cards below 100% without starting a unit swipe', async () => {
        const fixture = createComponent(900, 500);
        await settleLayout();
        const component = fixture.componentInstance;
        const container = viewport(fixture);
        expect(component.isZoomPanActive()).toBeTrue();
        component.setZoomPercent(75);
        await settleLayout();
        expect(component.isZoomPanActive()).toBeTrue();

        const onParentPointerDown = jasmine.createSpy('parent pointerdown');
        fixture.nativeElement.addEventListener('pointerdown', onParentPointerDown);
        container.scrollLeft = 0;
        for (const [type, clientX] of [['pointerdown', 450], ['pointermove', 400], ['pointerup', 400]] as const) {
            container.dispatchEvent(new PointerEvent(type, {
                pointerId: 1, pointerType: 'touch', isPrimary: true, clientX, clientY: 250, bubbles: true, cancelable: true,
            }));
        }
        expect(onParentPointerDown).not.toHaveBeenCalled();
        expect(container.scrollLeft).toBeGreaterThan(0);

        component.setZoomPercent(50);
        await settleLayout();
        expect(component.isZoomPanActive()).toBeFalse();
        expect(container.scrollLeft).toBe(0);
    });

    it('exports both card sides with their displayed colors and without screen-only controls', async () => {
        const fixture = createComponent();
        const download = spyOn(SvgExportUtil, 'downloadPng').and.resolveTo();

        await fixture.componentInstance.downloadPng();

        const [cards, name] = download.calls.mostRecent().args;
        expect(cards.length).toBe(2);
        expect(name).toBe('Astrolux-LC-100-alpha-strike');
        cards.forEach((card, index) => {
            expect(card.textContent?.trim()).toBe(`Card ${index}`);
            expect(card.querySelector('button, [data-screen-only], .screen-only')).toBeNull();
            expect(card.querySelector<SVGTextElement>('.card-text')?.style.fill).toBe('rgb(104, 28, 12)');
            expect(card.getAttribute('width')).toBe('1120');
        });
        expect(fixture.nativeElement.querySelectorAll('[data-screen-only]').length).toBe(2);
    });

    it('blocks swipe navigation only while enlarged and resets when the unit changes', async () => {
        const fixture = createComponent();
        await settleLayout();
        const component = fixture.componentInstance;
        component.setZoomPercent(200);
        fixture.detectChanges();
        expect(component.isZoomPanActive()).toBeTrue();
        await settleLayout();
        expect(component.zoomPercent()).toBe(200);

        fixture.componentRef.setInput('unit', createEmptyUnit());
        fixture.detectChanges();
        expect(component.isZoomPanActive()).toBeFalse();
        expect(component.zoomPercent()).toBe(100);
    });

    it('starts activation-sensitive exports before awaiting the card snapshot', async () => {
        const fixture = createComponent();
        const open = spyOn(SvgExportUtil, 'openPng').and.resolveTo();
        const copy = spyOn(SvgExportUtil, 'copyPngToClipboard').and.resolveTo();

        const opening = fixture.componentInstance.openPng();
        const copying = fixture.componentInstance.copyPngToClipboard();

        expect(open).toHaveBeenCalledTimes(1);
        expect(copy).toHaveBeenCalledTimes(1);
        expect(open.calls.mostRecent().args[0]).toEqual(jasmine.any(Promise));
        expect(copy.calls.mostRecent().args[0]).toEqual(jasmine.any(Promise));
        const [openCards, copyCards] = await Promise.all([
            open.calls.mostRecent().args[0], copy.calls.mostRecent().args[0],
        ]);
        expect(openCards.length).toBe(2);
        expect(copyCards.length).toBe(2);
        await Promise.all([opening, copying]);
    });
});

describe('UnitDetailsCardTabComponent rendered card fit', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [UnitDetailsCardTabComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: OptionsService, useValue: { options: signal({ ASUseHex: false, colorScheme: 'default' }) } },
                { provide: DataService, useValue: { getEras: () => [] } },
                { provide: UnitFluffImageService, useValue: { resolveUrl: () => null } },
                { provide: DialogsService, useValue: {} },
                { provide: PickerFactoryService, useValue: {} },
            ],
        });
    });

    for (const unitType of ['BM', 'SC'] as const) {
        it(`fits real ${unitType} cards without a vertical scrollbar at 100%, including fractional viewport heights`, async () => {
            const fixture = TestBed.createComponent(UnitDetailsCardTabComponent);
            fixture.componentRef.setInput('unit', createEmptyUnit({ as: { TP: unitType } }));
            for (const [width, height] of [[1000, 300], [1000, 699.59375], [1000, 315.5], [1000, 315.75], [900, 500], [320, 500]]) {
                (fixture.nativeElement as HTMLElement).style.cssText = `position: absolute; top: 167.953125px; width: ${width}px; height: ${height}px;`;
                fixture.detectChanges();
                for (let frame = 0; frame < 4; frame++) {
                    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
                }
                const container = fixture.nativeElement.querySelector('.tab-content') as HTMLElement;
                const cards = fixture.nativeElement.querySelector('.cards') as HTMLElement;
                const svg = cards.querySelector('svg.card-svg')!;
                const bounds = container.getBoundingClientRect();
                const card = svg.getBoundingClientRect();
                expect(container.offsetWidth - container.clientWidth)
                    .withContext(`${width}x${height}: content ${cards.getBoundingClientRect().width}x${cards.getBoundingClientRect().height}, viewport ${container.clientWidth}x${container.clientHeight}, card ${card.width}x${card.height}`)
                    .toBe(0);
                expect(card.bottom).toBeLessThanOrEqual(bounds.bottom - (container.offsetHeight - container.clientHeight) + 0.01);
                expect(fixture.componentInstance.zoomPercent()).toBe(100);
            }
        });
    }
});
