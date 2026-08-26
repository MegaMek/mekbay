// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { Equipment } from '../../models/equipment.model';
import type { UnitComponent, UnitSummary } from '../../models/unit-summary.model';
import { DataService } from '../../services/data.service';
import { OptionsService } from '../../services/options.service';
import { FloatingCompInfoComponent } from './floating-comp-info.component';

describe('FloatingCompInfoComponent', () => {
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

        const reference = Array.from(
            (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.equip-item'),
        ).find(item => item.querySelector('.equip-label')?.textContent?.trim() === 'Reference:');
        expect(reference?.querySelector('.equip-value')?.textContent?.trim())
            .toBe('TO:AUE, 181; TM; BMM');
    });
});
