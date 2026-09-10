// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ASForceUnit } from '../../../models/as-force-unit.model';
import { ASPrintUtil } from '../../../utils/asprint.util';
import {
    AsCriticalHitsAerofighterComponent, AsCriticalHitsAerospace1Component,
    AsCriticalHitsDropship1Component, AsCriticalHitsEmplacementComponent,
    AsCriticalHitsMekComponent, AsCriticalHitsProtomekComponent,
    AsCriticalHitsVehicleComponent,
} from './index';

@Component({
    imports: [AsCriticalHitsAerofighterComponent, AsCriticalHitsAerospace1Component,
        AsCriticalHitsDropship1Component, AsCriticalHitsEmplacementComponent,
        AsCriticalHitsMekComponent, AsCriticalHitsProtomekComponent, AsCriticalHitsVehicleComponent],
    template: `<svg viewBox="0 0 1120 800">
        <g as-critical-hits-mek />
        <g as-critical-hits-protomek />
        <g as-critical-hits-emplacement />
        <g as-critical-hits-aerofighter />
        <g as-critical-hits-aerospace-1 />
        <g as-critical-hits-vehicle [useHex]="hex()" [forceUnit]="forceUnit" />
        <g as-critical-hits-dropship-1 [width]="529.2" [height]="310" [forceUnit]="forceUnit"
            [interactive]="true" (rollCritical)="rolls = rolls + 1" />
    </svg>`,
})
class CriticalHitsTestHost {
    readonly committed = signal<Record<string, number>>({});
    readonly pending = signal<Record<string, number>>({});
    readonly hex = signal(false);
    rolls = 0;
    readonly forceUnit = {
        getState: () => ({
            getCommittedCritHits: (key: string) => this.committed()[key] ?? 0,
            getPendingCritChange: (key: string) => this.pending()[key] ?? 0,
        }),
    } as ASForceUnit;
}

describe('native SVG Alpha Strike critical hits', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [CriticalHitsTestHost],
            providers: [provideZonelessChangeDetection()],
        });
    });

    async function createFixture() {
        const fixture = TestBed.createComponent(CriticalHitsTestHost);
        fixture.detectChanges();
        await fixture.whenStable();
        return fixture;
    }

    it('renders every table entirely in the SVG namespace with usable hit targets', async () => {
        const fixture = await createFixture();
        const svg: SVGSVGElement = fixture.nativeElement.querySelector('svg');
        expect(svg.querySelectorAll('.critical-title').length).toBe(7);
        for (const element of Array.from(svg.querySelectorAll('*'))) {
            expect(element.namespaceURI).withContext(element.tagName).toBe('http://www.w3.org/2000/svg');
        }
        expect(svg.querySelector('foreignObject, table, div, span')).toBeNull();
        const crew = svg.querySelector('[as-critical-hits-dropship-1] [data-crit="crew"]')!;
        expect(crew.querySelectorAll('.critical-desc').length).toBe(2);
        expect(crew.querySelector('rect')?.getAttribute('fill')).toBe('transparent');
    });

    it('retains committed, pending damage and pending healing pips', async () => {
        const fixture = await createFixture();
        fixture.componentInstance.committed.set({ engine: 1, 'fire-control': 2 });
        fixture.componentInstance.pending.set({ engine: 1, 'fire-control': -1 });
        await fixture.whenStable();
        const table: SVGGElement = fixture.nativeElement.querySelector('[as-critical-hits-dropship-1]');
        expect(table.querySelectorAll('[data-crit="engine"] circle.damaged').length).toBe(1);
        expect(table.querySelectorAll('[data-crit="engine"] circle.pending-damage').length).toBe(1);
        expect(table.querySelectorAll('[data-crit="fire-control"] circle.pending-heal').length).toBe(1);
    });

    it('shows overflow counts without overlapping the description and keeps the motive picker groups', async () => {
        const fixture = await createFixture();
        fixture.componentInstance.committed.set({ 'fire-control': 5 });
        fixture.componentInstance.pending.set({ 'fire-control': 2 });
        fixture.componentInstance.hex.set(true);
        await fixture.whenStable();
        const row: SVGGElement = fixture.nativeElement.querySelector('[as-critical-hits-dropship-1] [data-crit="fire-control"]');
        expect(row.querySelector('.pip-count')?.textContent?.trim()).toBe('5+2');
        const pips = row.querySelector('[as-crit-pips]') as SVGGElement;
        const description = row.querySelector('.critical-desc') as SVGTextElement;
        expect(description.getBoundingClientRect().left).toBeGreaterThan(pips.getBoundingClientRect().right);
        const motive: SVGGElement = fixture.nativeElement.querySelector('[as-critical-hits-vehicle]');
        expect(motive.querySelectorAll('[data-crit^="motive"]').length).toBe(3);
        expect(motive.querySelector('[data-crit="motive1"] .critical-desc')?.textContent).toContain('⬢');
    });

    it('marks the working critical roller as screen-only for export', async () => {
        const fixture = await createFixture();
        const roller: SVGGElement = fixture.nativeElement.querySelector('[data-screen-only]');
        expect(roller.classList.contains('screen-only')).toBeTrue();
        roller.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        roller.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(fixture.componentInstance.rolls).toBe(2);
    });

    for (const styleMethod of ['getFixedPrintStyles', 'getFlexPrintStyles'] as const) {
        it(`lays out hidden print preparation using ${styleMethod}`, async () => {
            const fixture = TestBed.createComponent(CriticalHitsTestHost);
            // Print cells give the actual card host a fixed width.
            fixture.nativeElement.style.width = '1120px';
            fixture.nativeElement.style.display = 'block';
            const container = document.createElement('div');
            container.id = 'as-multipage-container';
            const style = document.createElement('style');
            const printStyles = ASPrintUtil as unknown as Record<typeof styleMethod,
                (margin: 'none', size: 'standard') => string>;
            style.textContent = printStyles[styleMethod]('none', 'standard');
            container.append(style, fixture.nativeElement);
            document.body.appendChild(container);
            try {
                fixture.componentInstance.committed.set({ 'fire-control': 5 });
                fixture.componentInstance.pending.set({ 'fire-control': 2 });
                fixture.componentInstance.hex.set(true);
                fixture.detectChanges();
                await document.fonts.ready;
                await fixture.whenStable();

                const svg = fixture.nativeElement.querySelector('svg') as SVGSVGElement;
                expect(getComputedStyle(container).visibility).toBe('hidden');
                expect(svg.getBoundingClientRect().width).toBeGreaterThan(0);

                // Print media drops the screen hiding rules without changing inputs.
                style.remove();
                const row: SVGGElement = fixture.nativeElement.querySelector('[as-critical-hits-dropship-1] [data-crit="fire-control"]');
                const count = row.querySelector('.pip-count') as SVGTextElement;
                const pip = row.querySelector('circle') as SVGCircleElement;
                expect(pip.getBoundingClientRect().left).toBeGreaterThan(count.getBoundingClientRect().right);
                const table: SVGGElement = fixture.nativeElement.querySelector('[as-critical-hits-vehicle]');
                for (let i = 1; i < 3; i++) {
                    const previous = table.querySelector(`[data-crit="motive${i}"] .critical-desc`) as SVGTextElement;
                    const next = table.querySelector(`[data-crit="motive${i + 1}"] circle`) as SVGCircleElement;
                    expect(next.getBoundingClientRect().left).toBeGreaterThan(previous.getBoundingClientRect().right);
                }
            } finally {
                container.remove();
            }
        });
    }
});
