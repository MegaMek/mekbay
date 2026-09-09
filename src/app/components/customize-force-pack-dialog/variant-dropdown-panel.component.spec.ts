// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Component, input, output, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { GameSystem } from '../../models/common.model';
import type { UnitSummary } from '../../models/unit-summary.model';
import { TaggingService } from '../../services/tagging.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { UnitCardCompactComponent } from '../unit-card-compact/unit-card-compact.component';
import type { TagClickEvent } from '../unit-tags/unit-tags.component';
import { VariantDropdownPanelComponent } from './variant-dropdown-panel.component';

@Component({ selector: 'unit-card-compact', template: '' })
class UnitCardStub {
    unit = input.required<UnitSummary>();
    gameSystem = input<GameSystem | null>(null);
    isOriginal = input(false);
    isSelected = input(false);
    showInfoButton = input(false);
    showTags = input(false);
    cardClick = output<void>();
    infoClick = output<void>();
    tagClick = output<TagClickEvent>();
}

describe('VariantDropdownPanelComponent identity', () => {
    it('selects and tracks same-name custom variants separately through reordering', async () => {
        await TestBed.configureTestingModule({
            imports: [VariantDropdownPanelComponent],
            providers: [provideZonelessChangeDetection(), { provide: TaggingService, useValue: {} }],
        }).overrideComponent(VariantDropdownPanelComponent, {
            remove: { imports: [UnitCardCompactComponent] },
            add: { imports: [UnitCardStub] },
        }).compileComponents();
        const first = createEmptyUnit({ name: 'Custom collision', isCustom: true });
        const second = createEmptyUnit({ name: first.name, isCustom: true });
        const fixture = TestBed.createComponent(VariantDropdownPanelComponent);
        fixture.componentRef.setInput('variants', [first, second]);
        fixture.componentRef.setInput('originalUnitUuid', first.uuid);
        fixture.componentRef.setInput('currentUnitUuid', second.uuid);
        fixture.detectChanges();
        const cards = fixture.debugElement.queryAll(By.directive(UnitCardStub));
        const firstCard = cards[0].componentInstance as UnitCardStub;
        const secondCard = cards[1].componentInstance as UnitCardStub;
        expect(firstCard.isOriginal()).toBeTrue();
        expect(firstCard.isSelected()).toBeFalse();
        expect(secondCard.isOriginal()).toBeFalse();
        expect(secondCard.isSelected()).toBeTrue();

        fixture.componentRef.setInput('variants', [{ ...second }, { ...first }]);
        fixture.detectChanges();
        const reordered = fixture.debugElement.queryAll(By.directive(UnitCardStub));
        expect(reordered[0].componentInstance).toBe(secondCard);
        expect(reordered[1].componentInstance).toBe(firstCard);
        fixture.destroy();
    });
});
