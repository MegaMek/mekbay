// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';

import { SkillDropdownPanelComponent } from './skill-dropdown-panel.component';

describe('SkillDropdownPanelComponent', () => {
    it('keeps each option wide enough for its content on narrow screens', () => {
        TestBed.configureTestingModule({ imports: [SkillDropdownPanelComponent] });
        const fixture = TestBed.createComponent(SkillDropdownPanelComponent);
        fixture.componentRef.setInput('entries', [{ skill: 4, adjustedValue: 1234, delta: 0 }]);
        fixture.detectChanges();

        const option = fixture.nativeElement.querySelector('.skill-option') as HTMLElement;
        expect(getComputedStyle(option).minWidth).toBe('max-content');

        fixture.destroy();
    });
});
