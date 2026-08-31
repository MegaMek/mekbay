// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TooltipDirective } from './tooltip.directive';

@Component({
    imports: [TooltipDirective],
    // Keep a real mouse pointer in the Karma page from affecting synthetic pointer tests.
    host: { style: 'pointer-events: none' },
    template: `
        <div class="parent" [tooltip]="'Parent tooltip'" [tooltipDelay]="0">
            <span class="parent-label">Parent</span>
            <button class="child" type="button" [tooltip]="'Child tooltip'" tooltipType="error" [tooltipDelay]="0">Child</button>
            <button class="weakened" type="button" [tooltip]="[{ label: 'Apollo Destroyed', value: '+0', weakened: true }]" [tooltipDelay]="0">Weakened</button>
            <button class="nested-line" type="button" [tooltip]="[{ label: 'Target A', value: '+1' }, { label: 'Moved 3-4', value: '+1', nested: true }]" [tooltipDelay]="0">Nested</button>
            <button class="ignored-line" type="button" [tooltip]="[{ label: 'Spotter Moved (Run)', value: '+2', nested: true, ignored: true }]" [tooltipDelay]="0">Ignored</button>
        </div>
        <label class="mode-label">
            <input class="mode-radio" type="radio">
            <span class="mode-text" [tooltip]="'Mode explanation'" [tooltipDelay]="0">Mode</span>
        </label>
    `,
})
class TestHostComponent {}

async function flushTooltipTasks(fixture: ComponentFixture<TestHostComponent>): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    fixture.detectChanges();
    await Promise.resolve();
}

function dispatchPointerOver(target: HTMLElement, relatedTarget: EventTarget | null = null): void {
    target.dispatchEvent(new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse',
        relatedTarget,
    }));
}

function dispatchPointerOut(target: HTMLElement, pointerType: 'mouse' | 'touch' = 'mouse'): void {
    target.dispatchEvent(new PointerEvent('pointerout', {
        bubbles: true,
        pointerType,
    }));
}

function dispatchTouchPointer(target: HTMLElement, type: 'pointerdown' | 'pointerup'): void {
    target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        pointerType: 'touch',
    }));
}

describe('TooltipDirective', () => {
    let overlayContainer: OverlayContainer;
    let overlayContainerElement: HTMLElement;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [TestHostComponent],
            providers: [provideZonelessChangeDetection()],
        }).compileComponents();

        overlayContainer = TestBed.inject(OverlayContainer);
        overlayContainerElement = overlayContainer.getContainerElement();
        overlayContainerElement.innerHTML = '';
    });

    it('shows only the nested tooltip when hovering a nested tooltip host', async () => {
        const fixture = TestBed.createComponent(TestHostComponent);
        fixture.detectChanges();

        const element = fixture.nativeElement as HTMLElement;
        const parent = element.querySelector('.parent') as HTMLElement | null;
        const child = element.querySelector('.child') as HTMLElement | null;

        expect(parent).withContext('parent tooltip host').not.toBeNull();
        expect(child).withContext('child tooltip host').not.toBeNull();

        dispatchPointerOver(parent!);
        await flushTooltipTasks(fixture);

        expect(getTooltipTexts()).toEqual(['Parent tooltip']);

        dispatchPointerOver(child!, parent);
        await flushTooltipTasks(fixture);

        expect(getTooltipTexts()).toEqual(['Child tooltip']);
    });

    it('shows a tooltip on touch tap and dismisses it on an outside tap', async () => {
        const fixture = TestBed.createComponent(TestHostComponent);
        fixture.detectChanges();

        const element = fixture.nativeElement as HTMLElement;
        const child = element.querySelector('.child') as HTMLElement;
        const outside = element.querySelector('.mode-radio') as HTMLElement;

        dispatchTouchPointer(child, 'pointerdown');
        dispatchTouchPointer(child, 'pointerup');
        dispatchPointerOut(child, 'touch');
        await flushTooltipTasks(fixture);

        expect(getTooltipTexts()).toEqual(['Child tooltip']);
        expect(overlayContainerElement.querySelector('.tooltip-lock-progress')).toBeNull();

        const tooltip = overlayContainerElement.querySelector('.tooltip-content') as HTMLElement;
        dispatchTouchPointer(tooltip, 'pointerdown');
        expect(getTooltipTexts()).toEqual(['Child tooltip']);

        dispatchTouchPointer(outside, 'pointerdown');
        expect(getTooltipTexts()).toEqual([]);
    });

    it('shows a tooltip while touch is held', () => {
        jasmine.clock().install();
        try {
            const fixture = TestBed.createComponent(TestHostComponent);
            fixture.detectChanges();

            const child = fixture.nativeElement.querySelector('.child') as HTMLElement;
            dispatchTouchPointer(child, 'pointerdown');
            jasmine.clock().tick(300);
            TestBed.tick();

            expect(getTooltipTexts()).toEqual(['Child tooltip']);
            expect(overlayContainerElement.querySelector('.tooltip-lock-progress')).toBeNull();
        } finally {
            jasmine.clock().uninstall();
        }
    });

    it('locks a mouse tooltip after its progress bar completes', () => {
        jasmine.clock().install();
        try {
            const fixture = TestBed.createComponent(TestHostComponent);
            fixture.detectChanges();

            const element = fixture.nativeElement as HTMLElement;
            const child = element.querySelector('.child') as HTMLElement;
            const outside = element.querySelector('.mode-radio') as HTMLElement;

            dispatchPointerOver(child);
            jasmine.clock().tick(0);
            TestBed.tick();

            const progress = overlayContainerElement.querySelector('.tooltip-lock-progress') as HTMLElement | null;
            expect(progress).not.toBeNull();

            dispatchPointerOut(child);
            expect(getTooltipTexts()).toEqual([]);

            dispatchPointerOver(child);
            jasmine.clock().tick(0);
            TestBed.tick();
            jasmine.clock().tick(2000);
            TestBed.tick();

            dispatchPointerOut(child);
            expect(getTooltipTexts()).toEqual(['Child tooltip']);

            outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
            expect(getTooltipTexts()).toEqual([]);
        } finally {
            jasmine.clock().uninstall();
        }
    });

    it('applies the error frame class when tooltipType is error', async () => {
        const fixture = TestBed.createComponent(TestHostComponent);
        fixture.detectChanges();

        const child = fixture.nativeElement.querySelector('.child') as HTMLElement | null;

        expect(child).withContext('child tooltip host').not.toBeNull();

        dispatchPointerOver(child!);
        await flushTooltipTasks(fixture);

        const tooltip = overlayContainerElement.querySelector('.tooltip-content');
        expect(tooltip?.classList.contains('error')).toBeTrue();
    });

    it('marks weakened breakdown lines for red styling', async () => {
        const fixture = TestBed.createComponent(TestHostComponent);
        fixture.detectChanges();

        const weakened = fixture.nativeElement.querySelector('.weakened') as HTMLElement;
        dispatchPointerOver(weakened);
        await flushTooltipTasks(fixture);

        const row = overlayContainerElement.querySelector('.tooltip-row');
        expect(row?.classList.contains('weakened')).toBeTrue();
        expect(row?.textContent).toContain('Apollo Destroyed');
        expect(row?.textContent).toContain('+0');
    });

    it('indents nested breakdown lines', async () => {
        const fixture = TestBed.createComponent(TestHostComponent);
        fixture.detectChanges();

        dispatchPointerOver(fixture.nativeElement.querySelector('.nested-line') as HTMLElement);
        await flushTooltipTasks(fixture);

        const row = overlayContainerElement.querySelector('.tooltip-row.nested');
        expect(row?.textContent).toContain('Moved 3-4');
        expect(row?.textContent).toContain('+1');
    });

    it('strikes through ignored breakdown lines', async () => {
        const fixture = TestBed.createComponent(TestHostComponent);
        fixture.detectChanges();

        dispatchPointerOver(fixture.nativeElement.querySelector('.ignored-line') as HTMLElement);
        await flushTooltipTasks(fixture);

        const row = overlayContainerElement.querySelector('.tooltip-row.nested.ignored');
        const label = row?.querySelector('.label');
        expect(row?.textContent).toContain('Spotter Moved (Run)');
        expect(row?.textContent).toContain('+2');
        expect(getComputedStyle(label!).textDecorationLine).toContain('line-through');
    });

    it('triggers from tooltip label text but not its adjacent radio input', async () => {
        const fixture = TestBed.createComponent(TestHostComponent);
        fixture.detectChanges();

        const element = fixture.nativeElement as HTMLElement;
        const radio = element.querySelector('.mode-radio') as HTMLElement;
        const text = element.querySelector('.mode-text') as HTMLElement;

        dispatchPointerOver(radio);
        await flushTooltipTasks(fixture);
        expect(getTooltipTexts()).toEqual([]);

        dispatchPointerOver(text);
        await flushTooltipTasks(fixture);
        expect(getTooltipTexts()).toEqual(['Mode explanation']);
    });

    function getTooltipTexts(): string[] {
        return Array.from(overlayContainerElement.querySelectorAll('.tooltip-content'))
            .map((tooltip) => tooltip.textContent?.trim() ?? '')
            .filter((tooltip) => tooltip.length > 0);
    }
});
