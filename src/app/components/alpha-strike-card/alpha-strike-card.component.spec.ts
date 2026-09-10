// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ASForceUnit } from '../../models/as-force-unit.model';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { UnitFluffImageService } from '../../services/catalogs/unit-fluff-image.service';
import { DialogsService } from '../../services/dialogs.service';
import { OptionsService } from '../../services/options.service';
import { PickerFactoryService, type NumericPickerConfig } from '../../services/picker-factory.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { AlphaStrikeCardComponent } from './alpha-strike-card.component';

describe('AlphaStrikeCardComponent native SVG interactions', () => {
    const options = signal({ ASUnifiedDamagePicker: false, pickerStyle: 'radial', ASUseAutomations: false });
    let pickerFactory: jasmine.SpyObj<Pick<PickerFactoryService, 'createNumericPicker'>>;
    let state: { heat: () => number; pendingHeat: ReturnType<typeof signal<number>>; armor: () => number; internal: () => number; pendingArmor: () => number; pendingInternal: () => number };
    let forceUnit: ASForceUnit;
    let setPendingHeat: jasmine.Spy;
    let setPendingArmorDamage: jasmine.Spy;
    let setPendingCritHits: jasmine.Spy;

    beforeEach(() => {
        options.set({ ASUnifiedDamagePicker: false, pickerStyle: 'radial', ASUseAutomations: false });
        state = { heat: () => 1, pendingHeat: signal(0), armor: () => 0, internal: () => 0, pendingArmor: () => 0, pendingInternal: () => 0 };
        setPendingHeat = jasmine.createSpy('setPendingHeat').and.callFake((value: number) => state.pendingHeat.set(value));
        setPendingArmorDamage = jasmine.createSpy('setPendingArmorDamage');
        setPendingCritHits = jasmine.createSpy('setPendingCritHits');
        forceUnit = {
            getSummary: () => createEmptyUnit({ as: { Arm: 5, Str: 3 } }),
            getState: () => state,
            getCommittedCritHits: () => 1,
            getPendingCritChange: () => 0,
            setPendingHeat,
            setPendingArmorDamage,
            setPendingCritHits,
        } as unknown as ASForceUnit;
        pickerFactory = jasmine.createSpyObj('PickerFactoryService', ['createNumericPicker']);
        pickerFactory.createNumericPicker.and.returnValue({
            destroy: () => {}, setPosition: () => {}, component: {},
        } as unknown as ReturnType<PickerFactoryService['createNumericPicker']>);
        TestBed.configureTestingModule({
            imports: [AlphaStrikeCardComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: OptionsService, useValue: { options } },
                { provide: AsAbilityLookupService, useValue: {} },
                { provide: DialogsService, useValue: {} },
                { provide: UnitFluffImageService, useValue: {} },
                { provide: PickerFactoryService, useValue: pickerFactory },
            ],
        }).overrideComponent(AlphaStrikeCardComponent, {
            set: {
                imports: [],
                template: `<svg viewBox="0 0 1120 800">
                    <g class="heat-track"><g class="heat-level" data-heat="3"><rect width="30" height="30"/><text>3</text></g></g>
                    <g class="pips-wrapper"><g data-damage-type="armor"><svg class="pip"><circle r="10"/></svg></g></g>
                    <g data-crit="engine"><circle class="pip" r="10"/><circle class="pip" r="10"/></g>
                </svg>`,
            },
        });
    });

    async function createComponent() {
        const fixture = TestBed.createComponent(AlphaStrikeCardComponent);
        fixture.componentRef.setInput('forceUnit', forceUnit);
        fixture.componentRef.setInput('interactive', true);
        fixture.detectChanges();
        await fixture.whenStable();
        return fixture;
    }

    function pointer(target: Element, type: string, x = 10): void {
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: 10 }));
    }

    function tap(target: Element): void {
        pointer(target, 'pointerdown');
        pointer(target, 'pointerup');
    }

    it('uses a nested SVG heat label to set and toggle the pending heat delta', async () => {
        const fixture = await createComponent();
        const label = fixture.nativeElement.querySelector('.heat-level text');

        tap(label);
        expect(setPendingHeat).toHaveBeenCalledWith(2);
        tap(label);
        expect(setPendingHeat).toHaveBeenCalledWith(0);
    });

    it('opens the armor picker from a nested SVG pip and applies its result', async () => {
        const fixture = await createComponent();
        tap(fixture.nativeElement.querySelector('[data-damage-type="armor"] circle'));

        const config: NumericPickerConfig = pickerFactory.createNumericPicker.calls.mostRecent().args[0];
        expect(config.title).toBe('ARMOR');
        expect(config.max).toBe(5);
        config.onPick({ value: 2 });
        expect(setPendingArmorDamage).toHaveBeenCalledOnceWith(2);
    });

    it('retains critical row identity when a native circle receives the pointer event', async () => {
        const fixture = await createComponent();
        tap(fixture.nativeElement.querySelector('[data-crit] circle'));

        const config = pickerFactory.createNumericPicker.calls.mostRecent().args[0];
        expect(config.title).toBe('ENGINE');
        expect(config.min).toBe(-1);
        expect(config.max).toBe(1);
        config.onPick({ value: 1 });
        expect(setPendingCritHits).toHaveBeenCalledOnceWith('engine', 1);
    });

    it('does not apply heat while dragging or after interactive mode is disabled', async () => {
        const fixture = await createComponent();
        const label = fixture.nativeElement.querySelector('.heat-level text');
        pointer(label, 'pointerdown');
        pointer(label, 'pointermove', 50);
        pointer(label, 'pointerup', 50);
        expect(setPendingHeat).not.toHaveBeenCalled();

        fixture.componentRef.setInput('interactive', false);
        fixture.detectChanges();
        tap(label);
        expect(setPendingHeat).not.toHaveBeenCalled();
    });
});
