// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import { GameSystem } from '../../models/common.model';
import { LoadForceEntry } from '../../models/load-force-entry.model';
import type { UnitSummary } from '../../models/unit-summary.model';
import { UnitSearchIndexService } from '../../services/unit-search-index.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { ForceRadarPanelComponent } from './force-radar-panel.component';

describe('ForceRadarPanelComponent', () => {
    let index: UnitSearchIndexService;
    beforeEach(() => {
        index = new UnitSearchIndexService();
        TestBed.configureTestingModule({ imports: [ForceRadarPanelComponent], providers: [
            { provide: UnitSearchIndexService, useValue: index },
        ] });
    });

    function render(units: UnitSummary[], type = GameSystem.CBT) {
        const fixture = TestBed.createComponent(ForceRadarPanelComponent);
        fixture.componentRef.setInput('force', new LoadForceEntry({ type,
            groups: [{ units: units.map(unit => ({ unit, destroyed: false })) }] }));
        fixture.detectChanges();
        return fixture;
    }

    it('uses shared TP and superheavy p95 values for the exact force composition', () => {
        const standard = Array.from({ length: 20 }, (_, i) => createEmptyUnit({
            name: `BM ${i}`, armor: i === 19 ? 500 : 100, internal: 10,
            run2: i === 19 ? 40 : 14, jump: 0,
            subtype: i % 2 ? 'BattleMek Omni' : 'BattleMek',
        }));
        const sh = createEmptyUnit({ armor: 800, internal: 100, run2: 3, jump: 0,
            weightClass: 'Colossal/Super-Heavy' });
        index.commitPreparedCatalogIndexes(index.prepareCatalogIndexes([...standard, sh], [], []));
        const fixture = render([standard[0], standard[19], sh]);
        const axes = fixture.componentInstance.chartAxes();
        expect(axes.find(axis => axis.key === 'mobility')!.max).toBe(31);
        expect(axes.find(axis => axis.key === 'endurance')!.max).toBe(1120);
        expect(axes.find(axis => axis.key === 'mobility')!.value).toBe(57);
    });

    it('uses linear ratios and retains a fixed benchmark above 100 percent', () => {
        const units = Array.from({ length: 20 }, (_, i) => createEmptyUnit({
            run2: i === 19 ? 40 : 10, jump: 0,
        }));
        index.commitPreparedCatalogIndexes(index.prepareCatalogIndexes(units, [], []));
        const fixture = render([units[19]]);
        const axis = fixture.componentInstance.chartAxes()[0];
        expect(axis.max).toBe(10);
        expect(axis.ratio).toBe(4);
        expect(axis.comparisonText).toBe('40 / 10 · 400%');
        expect(axis.dataPoint).toEqual(axis.axisPoint);
        const average = fixture.componentInstance.averageAxes()[0];
        expect(average.value).toBe(11.5);
        expect(average.ratio).toBe(1.15);
        expect(average.dataPoint).toEqual(average.axisPoint);
        fixture.componentRef.setInput('hoveredUnit', createEmptyUnit({ run2: 5, jump: 0 }));
        fixture.detectChanges();
        const overlay = fixture.componentInstance.hoveredUnitAxes()[0];
        expect(overlay.max).toBe(axis.max);
        expect(overlay.ratio).toBe(0.5);
    });

    it('plots composition-weighted catalog averages on each axis, keeping zero as the origin', () => {
        const low = createEmptyUnit({ run2: 4, jump: 0, armor: 100, internal: 0 });
        const high = createEmptyUnit({ run2: 12, jump: 0, armor: 300, internal: 0 });
        const sh = createEmptyUnit({ run2: 2, jump: 0, armor: 800, internal: 0,
            weightClass: 'Colossal/Super-Heavy' });
        const vehicle = createEmptyUnit({ run2: 20, jump: 0, armor: 10, internal: 0, as: { TP: 'CV' } });
        index.commitPreparedCatalogIndexes(index.prepareCatalogIndexes([low, high, sh, vehicle], [], []));
        const fixture = render([low, low, sh, vehicle]);
        const component = fixture.componentInstance;
        const [mobility, endurance] = component.averageAxes();
        expect(mobility.value).toBe(38);
        expect(mobility.max).toBe(46);
        expect(mobility.ratio).toBeCloseTo(38 / 46);
        expect(endurance.value).toBe(1210);
        expect(endurance.max).toBe(1410);
        expect(endurance.ratio).toBeCloseTo(1210 / 1410);
        expect(component.averagePath().match(/M/g)!.length).toBe(4);
        expect(fixture.nativeElement.querySelector('.radar-ring-midpoint')).toBeNull();
        expect(fixture.nativeElement.querySelector('.radar-average-outline').getAttribute('d')).toBe(component.averagePath());
        const path = component.averagePath();
        fixture.componentRef.setInput('hoveredUnit', low);
        fixture.detectChanges();
        expect(component.averagePath()).toBe(path);
        expect(component.hoveredUnitAxes()[0].ratio).toBeCloseTo(4 / 12);
    });

    it('compares hovered units against their own bucket regardless of force size', () => {
        const unit = createEmptyUnit({ run2: 10, jump: 0 });
        index.commitPreparedCatalogIndexes(index.prepareCatalogIndexes([unit], [], []));
        const fixture = render(Array(12).fill(unit));
        fixture.componentRef.setInput('hoveredUnit', unit);
        fixture.detectChanges();
        expect(fixture.componentInstance.chartAxes()[0].max).toBe(120);
        expect(fixture.componentInstance.hoveredUnitAxes()[0].max).toBe(10);
        expect(fixture.componentInstance.hoveredUnitAxes()[0].ratio).toBe(1);
        expect(fixture.componentInstance.hoveredUnitAxes()[0].comparisonText).toBe('10 / 10');
        expect(fixture.nativeElement.textContent).not.toContain('Unit profile');
        expect(fixture.nativeElement.querySelector('button[aria-label="How to read the radar"]')).not.toBeNull();
    });

    it('switches hover benchmarks with the unit TP and superheavy bucket', () => {
        const mek = createEmptyUnit({ run2: 10, jump: 0 });
        const sh = createEmptyUnit({ run2: 3, jump: 0, weightClass: 'Colossal/Super-Heavy' });
        const vehicle = createEmptyUnit({ run2: 8, jump: 0, as: { TP: 'CV' } });
        index.commitPreparedCatalogIndexes(index.prepareCatalogIndexes([mek, sh, vehicle], [], []));
        const fixture = render([mek, sh, vehicle]);
        for (const unit of [mek, sh, vehicle]) {
            fixture.componentRef.setInput('hoveredUnit', unit);
            fixture.detectChanges();
            expect(fixture.componentInstance.chartAxes()[0].max).toBe(21);
            expect(fixture.componentInstance.hoveredUnitAxes()[0].max).toBe(unit.run2);
            expect(fixture.componentInstance.hoveredUnitAxes()[0].ratio).toBe(1);
        }
    });

    it('shows rare positive capabilities without a fabricated denominator', () => {
        const units = Array.from({ length: 100 }, (_, i) => createEmptyUnit({
            as: { TP: 'BA', dmg: { dmgL: i === 99 ? '0*' : '0' } },
        }));
        index.commitPreparedCatalogIndexes(index.prepareCatalogIndexes(units, [], []));
        const fixture = render([units[99]], GameSystem.AS);
        const axis = fixture.componentInstance.chartAxes().find(axis => axis.key === 'asDmgL')!;
        expect(axis.available).toBeTrue();
        expect(axis.max).toBe(0);
        expect(axis.value).toBe(0.5);
        expect(axis.comparisonText).toBe('0.5 · rare');
        const average = fixture.componentInstance.averageAxes().find(axis => axis.key === 'asDmgL')!;
        expect(average.value).toBe(0.005);
        expect(average.available).toBeFalse();
        expect(fixture.componentInstance.averagePath().match(/M/g)!.length).toBe(3);
    });

    it('distinguishes missing data from genuine zero capability, including mixed forces', () => {
        const fighter = createEmptyUnit({ as: { TP: 'AF', TMM: null } });
        const mek = createEmptyUnit({ as: { TP: 'BM', TMM: 0 } });
        index.commitPreparedCatalogIndexes(index.prepareCatalogIndexes([fighter, mek], [], []));
        const fixture = render([fighter, mek], GameSystem.AS);
        expect(fixture.componentInstance.chartAxes()[0].comparisonText).toBe('N/A');
        expect(fixture.componentInstance.averageAxes()[0].available).toBeFalse();
        expect(fixture.componentInstance.averagePath().match(/M/g)!.length).toBe(3);
        fixture.componentRef.setInput('hoveredUnit', mek);
        fixture.detectChanges();
        expect(fixture.componentInstance.hoveredUnitAxes()[0].comparisonText).toBe('0 / 0');
        fixture.componentRef.setInput('hoveredUnit', fighter);
        fixture.detectChanges();
        expect(fixture.componentInstance.hoveredUnitAxes()[0].comparisonText).toBe('N/A');
        const zero = render([mek], GameSystem.AS).componentInstance.chartAxes()[0];
        expect(zero.available).toBeTrue();
        expect(zero.comparisonText).toBe('0 / 0');
        expect(zero.ratio).toBe(0);
    });

    it('shows an empty state without units', () => {
        const fixture = render([]);
        expect(fixture.componentInstance.hasUnits()).toBeFalse();
        expect(fixture.componentInstance.averagePath().trim()).toBe('');
        expect(fixture.nativeElement.textContent).toContain('No units to chart.');
    });
});
