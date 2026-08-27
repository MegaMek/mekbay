// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import {
    FallingDamageDialogComponent,
    type FallingDamageDialogData,
} from './falling-damage-dialog.component';

describe('FallingDamageDialogComponent', () => {
    let fixture: ComponentFixture<FallingDamageDialogComponent>;
    let persistRolls: jasmine.Spy;

    beforeEach(async () => {
        persistRolls = jasmine.createSpy('setPendingFallRolls');
        const unit = {
            gameRules: { id: 'core2026' },
            getPendingFall: () => undefined,
            setPendingFallRolls: persistRolls,
            getNotificationDisplayName: () => 'Atlas AS7-D',
            hasArmorType: () => false,
            getUnit: () => ({
                type: 'Mek',
                subtype: 'Biped',
                comp: [],
                tons: 70,
                armorType: 'Standard',
            }),
        } as unknown as CBTForceUnit;
        const data: FallingDamageDialogData = {
            unit,
            trigger: {
                kind: 'falling',
                id: 'fall:test',
                source: 'psr',
                levelsFallen: 0,
            },
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

    it('rolls and persists orientation plus every damage-group location as one action', () => {
        const random = spyOn(Math, 'random').and.returnValues(
            0, 0, 0, 0.999, 0.999,
            0.999, 0.5, 0.5, 0, 0,
        );

        fixture.componentInstance.rollAllResults();

        expect(fixture.componentInstance.orientationRoll()).toBe(1);
        expect(fixture.componentInstance.groupRows().map(row => row.hitLocationRoll)).toEqual([2, 12]);
        expect(fixture.componentInstance.groupRows().every(row => row.result?.location !== null)).toBeTrue();
        expect(fixture.componentInstance.allResolved()).toBeTrue();
        expect(persistRolls).toHaveBeenCalled();

        fixture.componentInstance.rollAllResults();

        expect(fixture.componentInstance.orientationRoll()).toBe(6);
        expect(fixture.componentInstance.groupRows().map(row => row.hitLocationRoll)).toEqual([8, 2]);
        expect(random).toHaveBeenCalledTimes(10);
    });
});
