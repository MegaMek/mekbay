// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameSystem } from '../../models/common.model';
import type { UnitSummary } from '../../models/unit-summary.model';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { DialogsService } from '../../services/dialogs.service';
import { GameService } from '../../services/game.service';
import { OptionsService } from '../../services/options.service';
import { MEGAMEK_RARITY_PRODUCTION_SORT_KEY } from '../../services/unit-search-filters.model';
import { MEGAMEK_AVAILABILITY_BADGE_COLORS, MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS, MEGAMEK_AVAILABILITY_UNKNOWN } from '../../models/megamek/availability.model';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { UnitCardExpandedComponent } from './unit-card-expanded.component';

describe('UnitCardExpandedComponent MegaMek availability display', () => {
    const currentGameSystemSignal = signal(GameSystem.CLASSIC);

    const gameServiceStub = {
        isAlphaStrike: computed(() => currentGameSystemSignal() === GameSystem.ALPHA_STRIKE),
        currentGameSystem: currentGameSystemSignal,
    };

    const dialogsServiceStub = {
        createDialog: jasmine.createSpy('createDialog'),
    };

    const abilityLookupServiceStub = {
        parseAbility: jasmine.createSpy('parseAbility').and.returnValue(null),
    };

    const optionsServiceStub = {
        options: signal({ forceViewerBVPVDisplay: 'both' }),
    };

    function createUnit(): UnitSummary {
        return createEmptyUnit({
            name: 'Atlas AS7-D',
            as: {
                TP: 'BM',
                MVm: {},
            },
        });
    }

    beforeEach(async () => {
        currentGameSystemSignal.set(GameSystem.CLASSIC);
        optionsServiceStub.options.set({ forceViewerBVPVDisplay: 'both' });

        await TestBed.configureTestingModule({
            imports: [UnitCardExpandedComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: GameService, useValue: gameServiceStub },
                { provide: DialogsService, useValue: dialogsServiceStub },
                { provide: AsAbilityLookupService, useValue: abilityLookupServiceStub },
                { provide: OptionsService, useValue: optionsServiceStub },
            ],
        })
            .overrideComponent(UnitCardExpandedComponent, {
                set: {
                    imports: [],
                    template: '<div></div>',
                },
            })
            .compileComponents();
    });

    it('suppresses the expanded rarity sort slot when fixed availability badges are provided', () => {
        const fixture = TestBed.createComponent(UnitCardExpandedComponent);

        fixture.componentRef.setInput('unit', createUnit());
        fixture.componentRef.setInput('sortKey', MEGAMEK_RARITY_PRODUCTION_SORT_KEY);
        fixture.componentRef.setInput('sortSlotLabel', 'RAT Rarity (P)');
        fixture.componentRef.setInput('sortSlotOverride', { value: 'Rare', numeric: false });
        fixture.componentRef.setInput('megaMekAvailability', [{ source: 'Requisition', score: 4, rarity: 'Rare' }]);
        fixture.detectChanges();

        expect(fixture.componentInstance.sortSlot()).toBeNull();
    });

    it('suppresses the compact rarity sort slot when fixed availability badges are provided', () => {
        const fixture = TestBed.createComponent(UnitCardExpandedComponent);
        const unit = createUnit();

        fixture.componentRef.setInput('unit', unit);
        fixture.componentRef.setInput('expandedView', false);
        fixture.componentRef.setInput('sortKey', MEGAMEK_RARITY_PRODUCTION_SORT_KEY);
        fixture.componentRef.setInput('sortSlotLabel', 'RAT Rarity (P)');
        fixture.componentRef.setInput('sortSlotOverride', { value: 'Rare', numeric: false });
        fixture.componentRef.setInput('megaMekAvailability', [{ source: 'Requisition', score: 4, rarity: 'Rare' }]);
        fixture.detectChanges();

        expect(fixture.componentInstance.getSortSlotForCompact(unit)).toBeNull();
    });

    it('builds a combined tooltip and rarity colors for availability badges', () => {
        const fixture = TestBed.createComponent(UnitCardExpandedComponent);

        fixture.componentRef.setInput('unit', createUnit());
        fixture.componentRef.setInput('megaMekAvailability', [
            { source: 'Requisition', score: 4, rarity: 'Rare' },
            { source: 'Salvage', score: 7, rarity: 'Common' },
        ]);
        fixture.detectChanges();

        expect(fixture.componentInstance.megaMekAvailabilityTooltip()).toEqual([
            { label: 'Requisition', value: 'Rare' },
            { label: 'Salvage', value: 'Common' },
        ]);
        expect(fixture.componentInstance.megaMekAvailabilityBadges()).toEqual([
            { source: 'Requisition', score: 4, rarity: 'Rare', color: MEGAMEK_AVAILABILITY_BADGE_COLORS['Rare'] },
            { source: 'Salvage', score: 7, rarity: 'Common', color: MEGAMEK_AVAILABILITY_BADGE_COLORS['Common'] },
        ]);
    });

    it('renders an Unknown pseudo-badge with a neutral tooltip label', () => {
        const fixture = TestBed.createComponent(UnitCardExpandedComponent);

        fixture.componentRef.setInput('unit', createUnit());
        fixture.componentRef.setInput('megaMekAvailability', [
            { source: MEGAMEK_AVAILABILITY_UNKNOWN, score: -1, rarity: MEGAMEK_AVAILABILITY_UNKNOWN },
        ]);
        fixture.detectChanges();

        expect(fixture.componentInstance.megaMekAvailabilityTooltip()).toEqual([
            { label: 'Availability', value: MEGAMEK_AVAILABILITY_UNKNOWN },
        ]);
        expect(fixture.componentInstance.megaMekAvailabilityBadges()).toEqual([
            { source: MEGAMEK_AVAILABILITY_UNKNOWN, score: -1, rarity: MEGAMEK_AVAILABILITY_UNKNOWN, color: MEGAMEK_AVAILABILITY_BADGE_COLORS[MEGAMEK_AVAILABILITY_UNKNOWN] },
        ]);
    });

    it('keeps the rarity sort slot behavior for non-search contexts without fixed availability badges', () => {
        const fixture = TestBed.createComponent(UnitCardExpandedComponent);

        fixture.componentRef.setInput('unit', createUnit());
        fixture.componentRef.setInput('sortKey', MEGAMEK_RARITY_PRODUCTION_SORT_KEY);
        fixture.componentRef.setInput('sortSlotLabel', 'RAT Rarity (P)');
        fixture.componentRef.setInput('sortSlotOverride', { value: 'Rare', numeric: false });
        fixture.detectChanges();

        expect(fixture.componentInstance.sortSlot()).toEqual({
            value: 'Rare',
            label: 'RAT Rarity (P)',
        });
    });

    it('always displays adjusted and base BV for Classic search results', () => {
        optionsServiceStub.options.set({ forceViewerBVPVDisplay: 'base' });
        const fixture = TestBed.createComponent(UnitCardExpandedComponent);
        const unit = createEmptyUnit({ bv: 12_600 });

        fixture.componentRef.setInput('unit', unit);
        fixture.componentRef.setInput('gunnery', 3);
        fixture.componentRef.setInput('piloting', 4);
        fixture.componentRef.setInput('useBvPvDisplayOption', true);
        fixture.detectChanges();

        expect(fixture.componentInstance.resolvedCompactBv()).toBe('16,632 (12,600)');
        expect(fixture.componentInstance.resolvedBv()).toBe('16,632 (12,600)');
    });

    it('always displays adjusted and base PV for Alpha Strike search results', () => {
        currentGameSystemSignal.set(GameSystem.ALPHA_STRIKE);
        optionsServiceStub.options.set({ forceViewerBVPVDisplay: 'adjusted' });
        const fixture = TestBed.createComponent(UnitCardExpandedComponent);
        const unit = createUnit();
        unit.as.PV = 40;

        fixture.componentRef.setInput('unit', unit);
        fixture.componentRef.setInput('gunnery', 3);
        fixture.componentRef.setInput('useBvPvDisplayOption', true);
        fixture.detectChanges();

        expect(fixture.componentInstance.resolvedCompactBv()).toMatch(/^\d+ \(40\)$/);
        expect(fixture.componentInstance.resolvedBv()).toBe(fixture.componentInstance.resolvedCompactBv());
    });

    it('always displays adjusted and base BV for normalized search results', () => {
        optionsServiceStub.options.set({ forceViewerBVPVDisplay: 'base' });
        const fixture = TestBed.createComponent(UnitCardExpandedComponent);

        fixture.componentRef.setInput('unit', createEmptyUnit({ bv: 12_600 }));
        fixture.componentRef.setInput('searchResultContext', {
            kind: 'bv',
            adjustedValue: 15_000,
            gunnery: 3,
            piloting: 4,
        });
        fixture.componentRef.setInput('useBvPvDisplayOption', true);
        fixture.detectChanges();

        expect(fixture.componentInstance.resolvedBv()).toBe('15,000 (12,600)');
        expect(fixture.componentInstance.resolvedCompactBv()).toBe('15,000 (12,600)');
    });

    it('leaves compact standalone units to the skill pipes outside search results', () => {
        const fixture = TestBed.createComponent(UnitCardExpandedComponent);

        fixture.componentRef.setInput('unit', createEmptyUnit({ bv: 12_600 }));
        fixture.detectChanges();

        expect(fixture.componentInstance.resolvedCompactBv()).toBeNull();
    });
});
