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
            floatingCriticals: true,
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

    it('previews and accepts the same rerolled location for a floating fall hit', () => {
        const dialog = fixture.componentInstance;
        dialog.setOrientationRoll(1);
        dialog.setHitLocationRoll(0, 2);
        dialog.setHitLocationRoll(1, 7);
        expect(dialog.allResolved()).toBeFalse();
        dialog.setHitLocationRoll(0, 12, true);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.damage-location-primary').textContent).toContain('Head');
        dialog.apply();
        expect(TestBed.inject(DialogRef).close).toHaveBeenCalledWith(jasmine.objectContaining({
            groups: [jasmine.objectContaining({ location: 'HD', throughArmorCritical: true }),
                jasmine.objectContaining({ throughArmorCritical: false })],
        }));
    });
});
