// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AmmoEquipment, Equipment } from '../../models/equipment.model';
import { EquipmentRegistry } from '../../models/equipment-lookup';
import type { CBTRuleset } from '../../models/cbt-ruleset.model';
import type { UnitComponent, UnitSummary } from '../../models/unit-summary.model';
import { DataService } from '../../services/data.service';
import { OptionsService } from '../../services/options.service';
import { FloatingCompInfoComponent } from './floating-comp-info.component';

describe('FloatingCompInfoComponent', () => {
    for (const catalogBv of [30, 80]) {
        it('updates ammo BV when the ruleset changes with catalog BV ' + catalogBv, () => {
            const standard = new AmmoEquipment({
                id: 'ISArrowIVAmmo', name: 'Arrow IV Ammo', type: 'ammo',
                stats: { bv: 30 }, tech: { base: 'IS' },
                ammo: { type: 'ARROW_IV', rackSize: 20, shots: 5 },
            });
            const thunder = new AmmoEquipment({
                id: 'ISArrowIVFASCAMAmmo', name: 'Arrow IV Thunder Ammo', type: 'ammo',
                stats: { bv: catalogBv }, tech: { base: 'IS' },
                ammo: {
                    type: 'ARROW_IV', rackSize: 20, shots: 5, baseAmmo: standard.id,
                    munitionType: ['M_FASCAM'],
                },
            });
            const registry = new EquipmentRegistry({ [standard.id]: standard, [thunder.id]: thunder });
            const options = signal<{ CBTRules: CBTRuleset }>({ CBTRules: 'core-2026' });
            TestBed.configureTestingModule({
                imports: [FloatingCompInfoComponent],
                providers: [
                    { provide: DataService, useValue: {
                        findEquipment: (id: string) => registry.findEquipment(id),
                        getEquipmentRegistry: () => registry,
                    } },
                    { provide: OptionsService, useValue: { options } },
                ],
            });
            const fixture = TestBed.createComponent(FloatingCompInfoComponent);
            fixture.componentRef.setInput('unit', {
                type: 'Mek', mixed: false, techBase: 'Inner Sphere',
            } as unknown as UnitSummary);
            fixture.componentRef.setInput('comp', {
                id: thunder.id, q: 1, n: thunder.name, t: 'A', p: 0, l: 'CT',
            } satisfies UnitComponent);

            for (const [ruleset, expectedBv] of [
                ['core-2026', 30], ['total-warfare', 80], ['core-2026', 30],
            ] as const) {
                options.set({ CBTRules: ruleset });
                fixture.detectChanges();
                const bv = Array.from(
                    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.equip-item'),
                ).find(item => item.querySelector('.equip-label')?.textContent?.trim() === 'BV:');
                expect(bv?.querySelector('.equip-value')?.textContent?.trim())
                    .withContext(ruleset).toBe(String(expectedBv));
            }
            expect(thunder.bv).toBe(catalogBv);
        });
    }

    it('renders structured equipment rules references', () => {
        const equipment = new Equipment({
            id: 'test-equipment',
            name: 'Test Equipment',
            type: 'misc',
            rulesRefs: [
                { book: 'TO:AUE', page: 181 },
                { book: 'TM', page: null },
                { book: 'BMM' },
            ],
        });
        TestBed.configureTestingModule({
            imports: [FloatingCompInfoComponent],
            providers: [
                { provide: DataService, useValue: { findEquipment: () => equipment } },
                { provide: OptionsService, useValue: { options: () => ({ CBTRules: 'core-2026' }) } },
            ],
        });
        const fixture = TestBed.createComponent(FloatingCompInfoComponent);
        fixture.componentRef.setInput('unit', {
            type: 'Mek',
            mixed: false,
            techBase: 'Inner Sphere',
        } as unknown as UnitSummary);
        fixture.componentRef.setInput('comp', {
            id: equipment.id,
            q: 1,
            n: equipment.name,
            t: 'C',
            p: 0,
            l: 'CT',
        } satisfies UnitComponent);

        fixture.detectChanges();

        const panel = fixture.nativeElement.querySelector('.floating-comp-info') as HTMLElement;
        expect(panel.classList.contains('framed-borders')).toBeTrue();
        expect(getComputedStyle(panel).borderTopWidth).toBe('2px');
        expect(getComputedStyle(panel).borderLeftWidth).toBe('0px');
        expect(getComputedStyle(panel).backgroundImage).toContain('linear-gradient');
        expect(getComputedStyle(panel).backgroundImage).toContain(getComputedStyle(panel).borderTopColor);

        const reference = Array.from(
            (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.equip-item'),
        ).find(item => item.querySelector('.equip-label')?.textContent?.trim() === 'Reference:');
        expect(reference?.querySelector('.equip-value')?.textContent?.trim())
            .toBe('TO:AUE, 181; TM; BMM');
    });
});
