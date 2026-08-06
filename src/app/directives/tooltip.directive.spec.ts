// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TooltipDirective } from './tooltip.directive';

@Component({
    standalone: true,
    imports: [TooltipDirective],
    template: `
        <div class="parent" [tooltip]="'Parent tooltip'" [tooltipDelay]="0">
            <span class="parent-label">Parent</span>
            <button class="child" type="button" [tooltip]="'Child tooltip'" tooltipType="error" [tooltipDelay]="0">Child</button>
            <button class="weakened" type="button" [tooltip]="[{ label: 'Apollo Destroyed', value: '+0', weakened: true }]" [tooltipDelay]="0">Weakened</button>
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