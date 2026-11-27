// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ASForceUnit } from '../../../models/as-force-unit.model';
import { AsAbilityLookupService } from '../../../services/as-ability-lookup.service';
import { DataService } from '../../../services/data.service';
import { createEmptyUnit } from '../../../testing/unit-test-helpers';
import { AsLayoutBaseComponent } from './layout-base.component';

@Component({
    selector: 'as-test-layout',
    template: '',
})
class TestLayoutComponent extends AsLayoutBaseComponent {}

describe('AsLayoutBaseComponent skill and PV', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [TestLayoutComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DataService, useValue: {} },
                { provide: AsAbilityLookupService, useValue: {} },
            ],
        }).compileComponents();
    });

    function createFixture(pointValue = 20) {
        const fixture = TestBed.createComponent(TestLayoutComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit({ as: { PV: pointValue } }));
        fixture.detectChanges();
        return fixture;
    }

    it('uses skill 4 and base PV when no skill source is provided', () => {
        const fixture = createFixture();

        expect(fixture.componentInstance.skill()).toBe(4);
        expect(fixture.componentInstance.adjustedPV()).toBe(20);
    });

    it('uses the skill override to calculate adjusted PV for a plain unit', () => {
        const fixture = createFixture();

        fixture.componentRef.setInput('skillOverride', 3);
        fixture.detectChanges();

        expect(fixture.componentInstance.skill()).toBe(3);
        expect(fixture.componentInstance.adjustedPV()).toBe(24);
        expect(fixture.componentInstance.basePV()).toBe(20);
    });

    it('prefers the force unit pilot skill over the plain-unit override', () => {
        const fixture = createFixture();
        const forceUnit = {
            getPilotStats: () => 2,
            getBv: () => 28,
        } as ASForceUnit;

        fixture.componentRef.setInput('skillOverride', 3);
        fixture.componentRef.setInput('forceUnit', forceUnit);
        fixture.detectChanges();

        expect(fixture.componentInstance.skill()).toBe(2);
        expect(fixture.componentInstance.adjustedPV()).toBe(28);
    });

    it('uses the force authority for an abandoned unit instead of pricing its default rating', () => {
        const fixture = createFixture();
        fixture.componentRef.setInput('forceUnit', {
            getPilotStats: () => 4,
            getBv: () => 0,
            crewVacant: () => true,
        } as ASForceUnit);
        expect(fixture.componentInstance.adjustedPV()).toBe(0);
        expect(fixture.componentInstance.basePV()).toBe(20);
        expect(fixture.componentInstance.vacant()).toBeTrue();
    });

    it('rejects an invalid skill override when adjusted PV is evaluated', () => {
        const fixture = createFixture();

        fixture.componentRef.setInput('skillOverride', -1);
        fixture.detectChanges();

        expect(() => fixture.componentInstance.adjustedPV()).toThrowError(
            RangeError,
            'Alpha Strike skill must be a non-negative integer.',
        );
    });
});
