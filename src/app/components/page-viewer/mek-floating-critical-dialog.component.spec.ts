// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import {
    MekFloatingCriticalDialogComponent,
    type MekFloatingCriticalDialogData,
} from './mek-floating-critical-dialog.component';

describe('MekFloatingCriticalDialogComponent', () => {
    let fixture: ComponentFixture<MekFloatingCriticalDialogComponent>;
    let close: jasmine.Spy;
    let onDraftChange: jasmine.Spy;
    let data: MekFloatingCriticalDialogData;

    beforeEach(async () => {
        close = jasmine.createSpy('close');
        onDraftChange = jasmine.createSpy('onDraftChange');
        data = {
            unit: mockUnit('Biped'),
            hitArc: 'left',
            onDraftChange,
        };
        await TestBed.configureTestingModule({
            imports: [MekFloatingCriticalDialogComponent],
            providers: [
                { provide: DialogRef, useValue: { close } },
                { provide: DIALOG_DATA, useValue: data },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(MekFloatingCriticalDialogComponent);
        fixture.detectChanges();
    });

    it('applies a directly selected facing-aware location', () => {
        const row = fixture.componentInstance.locationRows.find(candidate => candidate.roll === 7)!;

        fixture.componentInstance.selectLocation(row);

        expect(onDraftChange).toHaveBeenCalledOnceWith([3, 4], null);
        expect(fixture.componentInstance.selectedLocation()).toBe('LT');
        expect(close).not.toHaveBeenCalled();

        fixture.componentInstance.apply();

        expect(close).toHaveBeenCalledOnceWith({ action: 'apply', location: 'LT' });
    });

    it('persists exact rolled dice and applies their facing-aware location', () => {
        fixture.componentInstance.onFinished({ results: [5, 5], sum: 2 });

        expect(onDraftChange).toHaveBeenCalledOnceWith([5, 5], null);
        expect(fixture.componentInstance.selectedLocation()).toBe('RA');
        expect(close).not.toHaveBeenCalled();

        fixture.componentInstance.apply();

        expect(close).toHaveBeenCalledOnceWith({ action: 'apply', location: 'RA' });
    });

    it('requires a resolved location only for APPLY', () => {
        fixture.componentInstance.apply();
        expect(close).not.toHaveBeenCalled();

        fixture.componentInstance.skip();
        fixture.componentInstance.close();

        expect(close.calls.allArgs()).toEqual([
            [{ action: 'skip' }],
            [undefined],
        ]);
    });

    it('restores a pending draft without persisting it again', () => {
        fixture.destroy();
        Object.assign(data, {
            initialDice: [2, 6] as const,
        });
        fixture = TestBed.createComponent(MekFloatingCriticalDialogComponent);
        fixture.detectChanges();

        expect(fixture.componentInstance.initialDice).toEqual([2, 6]);
        expect(fixture.componentInstance.locationRoll()).toBe(8);
        expect(fixture.componentInstance.selectedLocation()).toBe('CT');
        expect(onDraftChange).not.toHaveBeenCalled();
    });

    it('requires and applies the additional tripod leg result', () => {
        fixture.destroy();
        Object.assign(data, { unit: mockUnit('Tripod'), hitArc: 'front' });
        fixture = TestBed.createComponent(MekFloatingCriticalDialogComponent);
        fixture.detectChanges();
        const row = fixture.componentInstance.locationRows.find(candidate => candidate.roll === 5)!;

        fixture.componentInstance.selectLocation(row);

        expect(fixture.componentInstance.needsTripodLegRoll()).toBeTrue();
        fixture.componentInstance.apply();
        expect(close).not.toHaveBeenCalled();

        fixture.componentInstance.selectTripodLeg(3);

        expect(fixture.componentInstance.selectedLocation()).toBe('CL');
        expect(onDraftChange.calls.allArgs()).toEqual([
            [[2, 3], null],
            [[2, 3], 3],
        ]);

        fixture.componentInstance.apply();

        expect(close).toHaveBeenCalledOnceWith({ action: 'apply', location: 'CL' });
    });
});

function mockUnit(subtype: 'Biped' | 'Tripod'): CBTForceUnit {
    return {
        getUnit: () => ({
            type: 'Mek',
            subtype,
            comp: [],
        }),
    } as unknown as CBTForceUnit;
}
