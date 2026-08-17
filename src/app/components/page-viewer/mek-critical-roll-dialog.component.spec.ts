// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import type { CriticalSlot } from '../../models/force-serialization';
import { CORE_2026_GAME_RULES } from '../../models/rules/game-rules';
import { MekCriticalRollDialogComponent } from './mek-critical-roll-dialog.component';

describe('MekCriticalRollDialogComponent', () => {
    let fixture: ComponentFixture<MekCriticalRollDialogComponent>;
    let caseIISlot: CriticalSlot;
    let criticalSlots: CriticalSlot[];
    let dialogRef: { close: jasmine.Spy };
    const slotsVersion = signal(0);

    beforeEach(async () => {
        const caseII = new MiscEquipment({
            id: 'ISCASEII',
            name: 'CASE II',
            type: 'misc',
            flags: ['F_CASE_II'],
        });
        const weapon = new WeaponEquipment({
            id: 'MediumLaser',
            name: 'Medium Laser',
            type: 'weapon',
        });
        const inapplicableElement = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        inapplicableElement.setAttribute('hittable', '0');
        caseIISlot = { id: 'caseii@LT', name: caseII.name, loc: 'LT', slot: 1, eq: caseII, el: inapplicableElement };
        criticalSlots = [
            { id: 'laser@LT', name: weapon.name, loc: 'LT', slot: 0, eq: weapon },
            caseIISlot,
        ];
        dialogRef = { close: jasmine.createSpy('close') };
        const unit = {
            gameRules: CORE_2026_GAME_RULES,
            rules: { mountedCriticalDamageDestructionThreshold: () => 1 },
            getCritSlots: () => {
                slotsVersion();
                return criticalSlots;
            },
            getCritSlot: (location: string, slot: number) => {
                slotsVersion();
                return criticalSlots.find(candidate => candidate.loc === location && candidate.slot === slot) ?? null;
            },
            getUnit: () => ({ comp: [] }),
        } as unknown as CBTForceUnit;

        await TestBed.configureTestingModule({
            imports: [MekCriticalRollDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DialogRef, useValue: dialogRef },
                {
                    provide: DIALOG_DATA,
                    useValue: { unit, location: 'LT', consolidateImmediately: true },
                },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(MekCriticalRollDialogComponent);
        fixture.detectChanges();
    });

    it('keeps the initial location protection visible after it is destroyed', () => {
        const element = fixture.nativeElement as HTMLElement;

        expect(element.querySelector('.protection-badge')?.textContent).toContain('CASE II');
        expect(element.querySelector('.protection-note')?.textContent).toContain('Caps internal damage at 1');

        caseIISlot.destroyed = 1;
        slotsVersion.update(version => version + 1);
        fixture.detectChanges();

        expect(element.querySelector('.protection-badge')?.textContent).toContain('CASE II');
        expect(element.querySelector('.protection-note')?.textContent).toContain('Caps internal damage at 1');
    });

    it('animates to dice faces for a valid critical slot', () => {
        spyOn(Math, 'random').and.returnValue(0);
        const roller = fixture.componentInstance.roller()!;
        const roll = spyOn(roller, 'roll');

        fixture.componentInstance.roll();

        expect(roll).toHaveBeenCalledOnceWith([1, 1]);
    });

    it('automatically retries if a selected slot becomes invalid before the roll finishes', () => {
        const roll = spyOn(fixture.componentInstance, 'roll');

        fixture.componentInstance.onFinished({ results: [1, 2] });
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.critical-result')).toBeNull();
        expect(fixture.componentInstance.appliedHits()).toBe(0);
        expect(roll).toHaveBeenCalledTimes(1);
    });

    it('finishes a manual roll after explicitly discarding when no valid slot remains', () => {
        criticalSlots[0].destroyed = 1;
        slotsVersion.update(version => version + 1);
        fixture.detectChanges();

        expect(fixture.componentInstance.rollButtonLabel()).toBe('DISCARD REMAINING');
        expect(fixture.componentInstance.complete()).toBeFalse();

        fixture.componentInstance.roll();
        fixture.detectChanges();

        expect(fixture.componentInstance.discarded()).toBeTrue();
        expect(fixture.componentInstance.complete()).toBeTrue();
        expect(fixture.componentInstance.rollButtonLabel()).toBe('CRITICALS DISCARDED');

        fixture.componentInstance.close();
        expect(dialogRef.close).toHaveBeenCalledOnceWith({ completed: true });
    });
});
