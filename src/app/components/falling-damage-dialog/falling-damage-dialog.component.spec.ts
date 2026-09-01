// SPDX-License-Identifier: GPL-3.0-or-later

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
    FallingDamageDialogComponent,
    type FallingDamageDialogData,
} from './falling-damage-dialog.component';

describe('FallingDamageDialogComponent', () => {
    let fixture: ComponentFixture<FallingDamageDialogComponent>;

    beforeEach(async () => {
        const data: FallingDamageDialogData = {
            unitName: 'Atlas',
            sourceMessage: 'A failed Piloting Skill Roll caused the Mek to fall.',
            ruleset: 'total-warfare',
            tons: 100,
            levelsFallen: 0,
            waterDepth: 0,
            hitLocationTable: 'biped',
        };
        await TestBed.configureTestingModule({
            imports: [FallingDamageDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(FallingDamageDialogComponent);
        fixture.detectChanges();
    });

    afterEach(() => TestBed.resetTestingModule());

    it('does not enable ACCEPT when only the orientation is resolved', () => {
        fixture.componentInstance.setOrientationRoll(1);

        expect(fixture.componentInstance.orientation()).not.toBeNull();
        expect(fixture.componentInstance.groupRows().every(row => row.result === null)).toBeTrue();
        expect(fixture.componentInstance.allResolved()).toBeFalse();
    });

    it('enables ACCEPT after every damage group has a location', () => {
        fixture.componentInstance.rollAllResults(() => 0);

        expect(fixture.componentInstance.allResolved()).toBeTrue();
        expect(fixture.componentInstance.groupRows().every(row => row.result?.location)).toBeTrue();
    });
});
