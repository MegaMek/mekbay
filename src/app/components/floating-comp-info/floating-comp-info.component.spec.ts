// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import { Equipment } from '../../models/equipment.model';
import { CBTGameRulesService } from '../../services/cbt-game-rules.service';
import { DataService } from '../../services/data.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
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
                {
                    provide: CBTGameRulesService,
                    useValue: { gameRules: () => ({ resolveToHit: () => ({ profile: [0] }) }) },
                },
            ],
        });
        const fixture = TestBed.createComponent(FloatingCompInfoComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit());
        fixture.componentRef.setInput('comp', {
            id: equipment.id,
            q: 1,
            n: equipment.name,
            t: 'C',
            p: 0,
            l: 'CT',
        });

        fixture.detectChanges();

        const root = fixture.nativeElement as HTMLElement;
        const reference = Array.from(root.querySelectorAll('.equip-item'))
            .find(item => item.querySelector('.equip-label')?.textContent?.trim() === 'Reference:');
        expect(reference?.querySelector('.equip-value')?.textContent?.trim())
            .toBe('TO:AUE, 181; TM; BMM');
    });
});
