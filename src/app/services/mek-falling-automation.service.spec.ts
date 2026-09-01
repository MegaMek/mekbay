// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import type { FallingDamageDialogData } from '../components/falling-damage-dialog/falling-damage-dialog.component';
import { DialogsService } from './dialogs.service';
import { MekFallingAutomationService } from './mek-falling-automation.service';
import { OptionsService } from './options.service';

describe('MekFallingAutomationService', () => {
    const data: FallingDamageDialogData = {
        unitName: 'Atlas',
        sourceMessage: 'A failed Piloting Skill Roll caused the Mek to fall.',
        ruleset: 'total-warfare',
        tons: 100,
        levelsFallen: 0,
        waterDepth: 0,
        hitLocationTable: 'biped',
    };

    it('resolves every damage group automatically in yes mode', async () => {
        spyOn(Math, 'random').and.returnValue(0);
        const createDialog = jasmine.createSpy('createDialog').and.returnValue({ closed: of(undefined) });
        TestBed.configureTestingModule({ providers: [
            MekFallingAutomationService,
            { provide: OptionsService, useValue: { cbtAutomationMode: () => 'yes' } },
            { provide: DialogsService, useValue: { createDialog } },
        ] });

        const result = await TestBed.inject(MekFallingAutomationService).resolve(data);

        expect(result).toEqual(jasmine.objectContaining({
            action: 'accept',
            damage: jasmine.objectContaining({ totalDamage: 10 }),
            groups: jasmine.any(Array),
        }));
        if (result?.action === 'accept') {
            expect(result.groups).toHaveSize(2);
            expect(result.groups.every(group => group.location !== null)).toBeTrue();
        }
        expect(createDialog).toHaveBeenCalledWith(
            jasmine.any(Function),
            jasmine.objectContaining({
                disableClose: true,
                data: jasmine.objectContaining({ unitName: 'Atlas' }),
            }),
        );
    });

    it('leaves falling damage to the player in no mode', async () => {
        TestBed.configureTestingModule({ providers: [
            MekFallingAutomationService,
            { provide: OptionsService, useValue: { cbtAutomationMode: () => 'no' } },
            { provide: DialogsService, useValue: {} },
        ] });

        expect(await TestBed.inject(MekFallingAutomationService).resolve(data))
            .toEqual({ action: 'skip' });
    });

    it('treats closing the ask dialog as cancellation', async () => {
        const createDialog = jasmine.createSpy('createDialog').and.returnValue({ closed: of(undefined) });
        TestBed.configureTestingModule({ providers: [
            MekFallingAutomationService,
            { provide: OptionsService, useValue: { cbtAutomationMode: () => 'ask' } },
            { provide: DialogsService, useValue: { createDialog } },
        ] });

        expect(await TestBed.inject(MekFallingAutomationService).resolve(data)).toBeNull();
        expect(createDialog).toHaveBeenCalledWith(
            jasmine.any(Function),
            jasmine.objectContaining({ disableClose: false, data }),
        );
    });
});
