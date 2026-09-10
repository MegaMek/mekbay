// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Era } from '../../../models/eras.model';
import type { UnitSummary } from '../../../models/unit-summary.model';
import { AsAbilityLookupService } from '../../../services/as-ability-lookup.service';
import { DataService } from '../../../services/data.service';
import { UnitNameService } from '../../../services/unit-name.service';
import { createEmptyUnit, type TestUnitOverrides } from '../../../testing/unit-test-helpers';
import type { CardAbility } from './layout-base.component';
import { AsLayoutStandardComponent } from './layout-standard.component';
import { AsVesselHeaderComponent } from './vessel-header.component';

function ability(name: string): CardAbility {
    return { kind: 'pilot', selection: { name, cost: 1, summary: '' } };
}

describe('Alpha Strike standard SVG layout', () => {
    beforeEach(() => {
        const era: Era = { id: 1, name: 'Test era', years: {}, factions: [], units: [], icon: '/images/random-black.svg' };
        TestBed.configureTestingModule({
            imports: [AsLayoutStandardComponent, AsVesselHeaderComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DataService, useValue: { getEras: () => [era] } },
                { provide: AsAbilityLookupService, useValue: {} },
                { provide: UnitNameService, useValue: { chassis: (unit: UnitSummary) => unit.chassis } },
            ],
        });
    });

    async function createFixture(overrides: TestUnitOverrides = {}, abilities: CardAbility[] = []) {
        const fixture = TestBed.createComponent(AsLayoutStandardComponent);
        const unit = createEmptyUnit({ role: 'Brawler', ...overrides,
            as: { PV: 20, Arm: 5, Str: 3, MVm: { '': 8 }, usesOV: true, specials: ['CASE'], ...overrides.as } });
        fixture.componentRef.setInput('unit', unit);
        spyOn(fixture.componentInstance, 'abilities').and.returnValue(abilities);
        fixture.detectChanges();
        await fixture.whenStable();
        return { fixture, unit, svg: fixture.nativeElement.querySelector('svg.standard-layout-svg') as SVGSVGElement };
    }

    function frameBounds(svg: SVGSVGElement, selector: string) {
        const group = svg.querySelector<SVGGElement>(selector)!;
        const frame = group.querySelector<SVGRectElement>('.frame-background')!;
        const offset = group.transform.baseVal.consolidate()!.matrix.f;
        const bounds = frame.getBBox();
        const halfStroke = parseFloat(getComputedStyle(frame).strokeWidth) / 2;
        return { top: offset + bounds.y - halfStroke, bottom: offset + bounds.y + bounds.height + halfStroke };
    }

    it('places damage immediately above armor when the unit has no heat track', async () => {
        const { svg } = await createFixture({ as: { usesOV: false } });
        expect(svg.querySelector('.heat-box')).toBeNull();
        const gap = frameBounds(svg, '.armor-box').top - frameBounds(svg, '.damage-box').bottom;
        expect(gap).toBeCloseTo(5.6, 3);
    });

    it('removes an absent SPECIAL section and moves the remaining stack to its bottom edge', async () => {
        const { fixture, unit, svg } = await createFixture();
        expect(svg.querySelector('.specials-box')).not.toBeNull();
        const previousBottom = frameBounds(svg, '.armor-box').bottom;

        fixture.componentRef.setInput('unit', createEmptyUnit({ ...unit, as: { ...unit.as, specials: [] } }));
        fixture.detectChanges();
        await fixture.whenStable();

        expect(svg.querySelector('.specials-box')).toBeNull();
        const bottom = frameBounds(svg, '.armor-box').bottom;
        expect(bottom).toBeGreaterThan(previousBottom);
        expect(bottom).toBeCloseTo(704, 3);
    });

    it('gives separate short abilities their own lines even when both would fit on one line', async () => {
        const { svg } = await createFixture({}, [ability('Ace'), ability('Scout')]);
        const lines = Array.from(svg.querySelectorAll<SVGTextElement>('.pilot-ability'));
        expect(lines.map(line => line.textContent)).toEqual(['Ace (1)', 'Scout (1)']);
        expect(lines[1].y.baseVal.getItem(0).value).toBeGreaterThan(lines[0].y.baseVal.getItem(0).value);
    });

    it('wraps a long ability and emits the original ability from every continuation line', async () => {
        const name = 'Expert gunnery coordination across several distant combat formations';
        const cardAbility = ability(name);
        const { fixture, svg } = await createFixture({}, [cardAbility]);
        const lines = Array.from(svg.querySelectorAll<SVGTextElement>('.pilot-ability'));
        expect(lines.length).toBeGreaterThan(1);
        expect(lines.map(line => line.textContent).join(' ')).toBe(`${name} (1)`);
        const clicked = jasmine.createSpy('abilityClick');
        fixture.componentInstance.abilityClick.subscribe(clicked);

        for (const line of lines) line.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(clicked.calls.count()).toBe(lines.length);
        for (const call of clicked.calls.all()) expect(call.args[0]).toBe(cardAbility);
    });

    it('keeps all rendered content in the SVG namespace in normal and night modes', async () => {
        const { fixture, svg } = await createFixture({ isCustom: true }, [ability('Ace')]);
        for (const cardStyle of ['default', 'night']) {
            fixture.componentRef.setInput('cardStyle', cardStyle);
            fixture.detectChanges();
            await fixture.whenStable();
            expect(svg.querySelector('.critical-title')).not.toBeNull();
            expect(svg.querySelector('.specials-box')).not.toBeNull();
            expect(svg.querySelector('.custom-badge-frame')).not.toBeNull();
            const eraIcon = svg.querySelector('.era-icon')!;
            if (cardStyle === 'night') expect(getComputedStyle(eraIcon).mixBlendMode).toBe('lighten');
            else expect(getComputedStyle(eraIcon).mixBlendMode).not.toBe('lighten');
            expect(svg.querySelector('foreignObject, div, span, table')).toBeNull();
            for (const element of Array.from(svg.querySelectorAll('*'))) {
                expect(element.namespaceURI).withContext(element.tagName).toBe('http://www.w3.org/2000/svg');
            }
        }
    });

    function expectReadableBadge(svg: SVGSVGElement) {
        const frame = svg.querySelector<SVGRectElement>('.custom-badge-frame')!.getBoundingClientRect();
        const glyphs = svg.querySelector<SVGTextElement>('.custom-badge-text')!.getBoundingClientRect();
        expect(frame.height).toBeGreaterThan(12);
        expect(glyphs.height).toBeGreaterThan(8);
        expect(glyphs.left).toBeGreaterThan(frame.left);
        expect(glyphs.right).toBeLessThan(frame.right);
        expect(glyphs.top).toBeGreaterThanOrEqual(frame.top);
        expect(glyphs.bottom).toBeLessThanOrEqual(frame.bottom);
    }

    it('keeps a custom badge readable at catalog and print sizes without covering a long model or PV', async () => {
        const { svg } = await createFixture({ isCustom: true,
            model: 'Experimental custom model with an unusually long designation' });
        for (const width of ['386px', '88mm']) {
            svg.style.width = width;
            svg.style.height = 'auto';
            expectReadableBadge(svg);
            const model = svg.querySelector<SVGTextElement>('.model-text')!.getBoundingClientRect();
            const badge = svg.querySelector<SVGRectElement>('.custom-badge-frame')!.getBoundingClientRect();
            const pv = svg.querySelector<SVGPathElement>('.pv-background')!.getBoundingClientRect();
            expect(badge.left).toBeGreaterThan(model.right);
            expect(badge.right).toBeLessThan(pv.left);
        }
    });

    it('reserves space for a readable custom badge beside a long vessel back header', async () => {
        const fixture = TestBed.createComponent(AsVesselHeaderComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit({ isCustom: true,
            chassis: 'Experimental Long Range Transport Vessel',
            model: 'Custom production configuration with reinforced cargo compartments' }));
        fixture.componentRef.setInput('showPv', false);
        fixture.detectChanges();
        await fixture.whenStable();
        const svg = fixture.nativeElement.querySelector('svg') as SVGSVGElement;
        svg.style.width = '386px';
        svg.style.height = 'auto';
        expectReadableBadge(svg);
        const title = svg.querySelector<SVGTextElement>('.vessel-title')!.getBoundingClientRect();
        const subtitle = svg.querySelector<SVGTextElement>('.vessel-subtitle')!.getBoundingClientRect();
        const badge = svg.querySelector<SVGRectElement>('.custom-badge-frame')!.getBoundingClientRect();
        expect(subtitle.left).toBeGreaterThanOrEqual(title.right);
        expect(badge.left).toBeGreaterThan(subtitle.right);
        expect(badge.right).toBeLessThan(svg.getBoundingClientRect().right);
    });

    it('keeps a long custom vessel front header above the stats and outside the PV area', async () => {
        const fixture = TestBed.createComponent(AsVesselHeaderComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit({ isCustom: true,
            chassis: 'Experimental Long Range Transport Vessel',
            model: 'Custom production configuration with reinforced cargo compartments', as: { PV: 20 } }));
        fixture.componentRef.setInput('showPv', true);
        for (const cardStyle of ['default', 'night']) {
            fixture.componentRef.setInput('cardStyle', cardStyle);
            fixture.detectChanges();
            await fixture.whenStable();
            const svg = fixture.nativeElement.querySelector('svg') as SVGSVGElement;
            svg.style.width = '386px';
            svg.style.height = 'auto';
            const card = svg.getBoundingClientRect();
            const statsTop = card.top + 104 * card.width / svg.viewBox.baseVal.width;
            const pv = svg.querySelector<SVGPathElement>('path')!.getBoundingClientRect();
            for (const selector of ['.vessel-title', '.vessel-subtitle', '.custom-badge-frame']) {
                const bounds = svg.querySelector<SVGGraphicsElement>(selector)!.getBoundingClientRect();
                expect(bounds.bottom).withContext(`${cardStyle} ${selector} covers the stats`).toBeLessThan(statsTop);
                expect(bounds.right).withContext(`${cardStyle} ${selector} covers the PV`).toBeLessThan(pv.left);
            }
            const title = svg.querySelector<SVGTextElement>('.vessel-title')!.getBoundingClientRect();
            const subtitle = svg.querySelector<SVGTextElement>('.vessel-subtitle')!.getBoundingClientRect();
            const badge = svg.querySelector<SVGRectElement>('.custom-badge-frame')!.getBoundingClientRect();
            expect(subtitle.left).toBeGreaterThan(title.right);
            expect(badge.left).toBeGreaterThan(subtitle.right);
        }
    });
});
