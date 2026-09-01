// SPDX-License-Identifier: GPL-3.0-or-later

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import type { AutomationCheckDialogData } from '../../models/automation-check.model';
import { PendingUnitCheckDialogComponent } from './pending-unit-check-dialog.component';
import { PendingUnitCheckRowComponent } from './pending-unit-check-row.component';

describe('PendingUnitCheckDialogComponent', () => {
    let fixture: ComponentFixture<PendingUnitCheckDialogComponent>;
    let close: jasmine.Spy;

    afterEach(() => TestBed.resetTestingModule());

    it('uses a check-specific automatic label', async () => {
        await create({
            title: 'Resolve Pending Checks',
            initiallyFailedGroups: new Set(),
            checks: [{
                id: 'startup', subject: 'Atlas', label: 'Shutdown recovery',
                description: 'Heat below 14.', failureOutcome: 'remains shutdown',
                automaticOutcome: 'success', automaticLabel: 'AUTOMATIC RESTART',
            }],
        });

        const row = fixture.debugElement.query(By.directive(PendingUnitCheckRowComponent))
            .componentInstance as PendingUnitCheckRowComponent;
        expect(row.automaticLabel()).toBe('AUTOMATIC RESTART');
        expect(fixture.componentInstance.allResolved()).toBeTrue();
    });

    it('requires a tied failure choice before APPLY can resolve', async () => {
        await create({
            title: 'Resolve Pending Checks',
            initiallyFailedGroups: new Set(),
            checks: [{
                id: 'ammo', subject: 'Atlas', label: 'Ammunition explosion',
                description: 'Avoid ammunition explosion.', failureOutcome: 'ammunition explosion',
                targetNumber: 4,
                failureChoices: [
                    { id: 'left', label: 'LRM Ammo · LT' },
                    { id: 'right', label: 'LRM Ammo · RT' },
                ],
            }],
        });
        const row = fixture.debugElement.query(By.directive(PendingUnitCheckRowComponent))
            .componentInstance as PendingUnitCheckRowComponent;

        row.choose('failed');
        fixture.detectChanges();
        expect(fixture.componentInstance.allResolved()).toBeFalse();

        fixture.componentInstance.selectChoice('ammo', 'right');
        fixture.detectChanges();
        expect(fixture.componentInstance.allResolved()).toBeTrue();
        fixture.componentInstance.apply();
        expect(close).toHaveBeenCalledWith([
            jasmine.objectContaining({ id: 'ammo', outcome: 'failed', selectionId: 'right' }),
        ]);
    });

    it('cascades a failed consciousness group without rolling later checks', async () => {
        await create({
            title: 'Consciousness Rolls',
            initiallyFailedGroups: new Set(),
            checks: [
                {
                    id: 'first', subject: 'Atlas', label: 'Consciousness check',
                    description: 'Pilot hit 1 of 2.', failureOutcome: 'unconsciousness',
                    targetNumber: 3, failureGroup: 'pilot',
                },
                {
                    id: 'second', subject: 'Atlas', label: 'Consciousness check',
                    description: '2 pilot hits.', failureOutcome: 'unconsciousness',
                    targetNumber: 5, failureGroup: 'pilot',
                    cascadeFailureLabel: 'UNCONSCIOUS',
                },
            ],
        });
        const rows = fixture.debugElement.queryAll(By.directive(PendingUnitCheckRowComponent))
            .map(debug => debug.componentInstance as PendingUnitCheckRowComponent);

        rows[0]!.choose('failed');
        fixture.detectChanges();

        expect(rows[1]!.isAutomatic()).toBeTrue();
        expect(rows[1]!.automaticLabel()).toBe('UNCONSCIOUS');
        expect(fixture.componentInstance.allResolved()).toBeTrue();
    });

    it('restores entered dice and publishes edits before CLOSE', async () => {
        const selectionsChanged = jasmine.createSpy('selectionsChanged');
        await create({
            title: 'Piloting Skill Rolls',
            initiallyFailedGroups: new Set(),
            initialSelections: [{ id: 'psr', outcome: 'success', dice: [3, 4] }],
            selectionsChanged,
            checks: [{
                id: 'psr', subject: 'Atlas', label: 'Piloting Skill Check',
                description: 'Heavy damage.', failureOutcome: 'Fall', targetNumber: 7,
            }],
        });
        const row = fixture.debugElement.query(By.directive(PendingUnitCheckRowComponent))
            .componentInstance as PendingUnitCheckRowComponent;

        expect(row.resolution()).toEqual(jasmine.objectContaining({
            outcome: 'success',
            dice: [3, 4],
            source: 'selected',
        }));

        row.choose('failed');
        fixture.componentInstance.close();

        expect(selectionsChanged).toHaveBeenCalledWith([
            { id: 'psr', outcome: 'failed', dice: null },
        ]);
        expect(close).toHaveBeenCalledWith();
    });

    async function create(data: AutomationCheckDialogData): Promise<void> {
        close = jasmine.createSpy('close');
        await TestBed.configureTestingModule({
            imports: [PendingUnitCheckDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close } },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(PendingUnitCheckDialogComponent);
        fixture.detectChanges();
    }
});
