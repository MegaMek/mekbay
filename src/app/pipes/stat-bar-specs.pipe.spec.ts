// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import { DataService } from '../services/data.service';
import { UnitSearchIndexService } from '../services/unit-search-index.service';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import type { UnitSummary } from '../models/unit-summary.model';
import { StatBarSpecsPipe } from './stat-bar-specs.pipe';

describe('StatBarSpecsPipe', () => {
    let index: UnitSearchIndexService;
    let pipe: StatBarSpecsPipe;
    beforeEach(() => {
        index = new UnitSearchIndexService();
        TestBed.configureTestingModule({ providers: [{ provide: DataService,
            useValue: { getUnitStats: (unit: UnitSummary) => index.getUnitStats(unit) } }] });
        pipe = TestBed.runInInjectionContext(() => new StatBarSpecsPipe());
    });

    it('shares TP/superheavy p95 buckets and caps only the visual bar', () => {
        const units = Array.from({ length: 20 }, (_, i) => createEmptyUnit({
            armor: i === 19 ? 300 : 100, subtype: i % 2 ? 'BattleMek Omni' : 'BattleMek',
        }));
        const sh = createEmptyUnit({ armor: 800, weightClass: 'Colossal/Super-Heavy' });
        index.prepareUnits([...units, sh]);
        const armor = pipe.transform(units[19]).find(stat => stat.label === 'Armor')!;
        expect(armor.value).toBe(300);
        expect(armor.valueText).toContain('300');
        expect(armor.max).toBe(100);
        expect(armor.percent).toBe(100);
        expect(pipe.transform(sh).find(stat => stat.label === 'Armor')!.max).toBe(800);
    });

    it('preserves rare capabilities while excluding unavailable measurements', () => {
        const units = Array.from({ length: 100 }, (_, i) => createEmptyUnit({
            heat: null, dissipation: null, dpt: i === 99 ? 5 : 0,
        }));
        index.prepareUnits(units);
        const stats = pipe.transform(units[99]);
        expect(stats.some(stat => stat.label === 'Heat')).toBeFalse();
        expect(stats.some(stat => stat.label === 'Dissipation')).toBeFalse();
        const damage = stats.find(stat => stat.label === 'Damage/Turn')!;
        expect(damage.value).toBe(5);
        expect(damage.max).toBe(0);
        expect(damage.percent).toBe(100);
        expect(damage.description).toContain('rare capability');
        expect(pipe.transform(units[0]).find(stat => stat.label === 'Damage/Turn')!.percent).toBe(0);
    });

    it('renders measured zero and 999 heat values', () => {
        const unit = createEmptyUnit({ heat: 0, dissipation: 999 });
        index.prepareUnits([unit]);
        const stats = pipe.transform(unit);
        expect(stats.find(stat => stat.label === 'Heat')?.value).toBe(0);
        expect(stats.find(stat => stat.label === 'Dissipation')?.value).toBe(999);
    });
});
