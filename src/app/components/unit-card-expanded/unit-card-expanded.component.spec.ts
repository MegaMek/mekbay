import { CommonModule } from '@angular/common';
import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameSystem } from '../../models/common.model';
import type { Unit } from '../../models/units.model';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { DialogsService } from '../../services/dialogs.service';
import { GameService } from '../../services/game.service';
import { MEGAMEK_RARITY_PRODUCTION_SORT_KEY } from '../../services/unit-search-filters.model';
import { MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS } from '../../models/megamek/availability.model';
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

    function createUnit(): Unit {
        return {
            name: 'Atlas AS7-D',
            as: {
                TP: 'BM',
                MVm: {},
            },
        } as Unit;
    }

    beforeEach(async () => {
        currentGameSystemSignal.set(GameSystem.CLASSIC);

        await TestBed.configureTestingModule({
            imports: [UnitCardExpandedComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: GameService, useValue: gameServiceStub },
                { provide: DialogsService, useValue: dialogsServiceStub },
                { provide: AsAbilityLookupService, useValue: abilityLookupServiceStub },
            ],
        })
            .overrideComponent(UnitCardExpandedComponent, {
                set: {
                    imports: [CommonModule],
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
        fixture.componentRef.setInput('megaMekAvailability', [{ source: 'Production', score: 4, rarity: 'Rare' }]);
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
        fixture.componentRef.setInput('megaMekAvailability', [{ source: 'Production', score: 4, rarity: 'Rare' }]);
        fixture.detectChanges();

        expect(fixture.componentInstance.getSortSlotForCompact(unit)).toBeNull();
    });

    it('builds a combined tooltip and rarity colors for availability badges', () => {
        const fixture = TestBed.createComponent(UnitCardExpandedComponent);

        fixture.componentRef.setInput('unit', createUnit());
        fixture.componentRef.setInput('megaMekAvailability', [
            { source: 'Production', score: 4, rarity: 'Rare' },
            { source: 'Salvage', score: 7, rarity: 'Common' },
        ]);
        fixture.detectChanges();

        expect(fixture.componentInstance.megaMekAvailabilityTooltip()).toEqual([
            { label: 'Production', value: 'Rare' },
            { label: 'Salvage', value: 'Common' },
        ]);
        expect(fixture.componentInstance.megaMekAvailabilityBadges()).toEqual([
            { source: 'Production', score: 4, rarity: 'Rare', color: MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS['Rare'] },
            { source: 'Salvage', score: 7, rarity: 'Common', color: MEGAMEK_AVAILABILITY_RARITY_ICON_COLORS['Common'] },
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
});