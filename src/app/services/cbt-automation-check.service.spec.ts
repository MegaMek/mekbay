// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import type { AutomationCheck } from '../models/automation-check.model';
import { DialogsService } from './dialogs.service';
import { OptionsService } from './options.service';
import {
    CBTAutomationCheckService,
    resolveAutomationChecksAutomatically,
} from './cbt-automation-check.service';

describe('resolveAutomationChecksAutomatically', () => {
    it('rolls checks in order and cascades a failed fall group without another roll', () => {
        spyOn(Math, 'random').and.returnValues(0, 0, 0.99, 0.99);
        const checks = [
            check('first', 7, 'unit:fall'),
            check('second', 7, 'unit:fall'),
            check('independent', 7),
        ];

        expect(resolveAutomationChecksAutomatically(checks)).toEqual([
            { id: 'first', outcome: 'failed', dice: [1, 1], automatic: false },
            { id: 'second', outcome: 'failed', dice: null, automatic: true },
            { id: 'independent', outcome: 'success', dice: [6, 6], automatic: false },
        ]);
    });

    it('chooses among tied failure choices only after a failed check', () => {
        spyOn(Math, 'random').and.returnValue(0.99);
        const choices = Object.freeze([
            Object.freeze({ id: 'ammo:left', label: 'Left bin' }),
            Object.freeze({ id: 'ammo:right', label: 'Right bin' }),
        ]);

        expect(resolveAutomationChecksAutomatically([{
            ...check('ammo', 7),
            automaticOutcome: 'failed',
            failureChoices: choices,
        }])).toEqual([{
            id: 'ammo',
            outcome: 'failed',
            dice: null,
            automatic: true,
            selectionId: 'ammo:right',
        }]);
    });
});

describe('CBTAutomationCheckService', () => {
    it('opens the dedicated pending-check dialog in ask mode and returns CLOSE as cancellation', async () => {
        const createDialog = jasmine.createSpy('createDialog').and.returnValue({ closed: of(undefined) });
        TestBed.configureTestingModule({
            providers: [
                CBTAutomationCheckService,
                { provide: OptionsService, useValue: { cbtAutomationMode: () => 'ask' } },
                { provide: DialogsService, useValue: { createDialog } },
            ],
        });

        const result = await TestBed.inject(CBTAutomationCheckService).resolve(
            'pilotSkillCheck',
            [check('psr', 7)],
            { title: 'Piloting Skill Rolls' },
        );

        expect(result).toBeNull();
        expect(createDialog).toHaveBeenCalledWith(
            jasmine.any(Function),
            jasmine.objectContaining({
                disableClose: false,
                data: jasmine.objectContaining({ title: 'Piloting Skill Rolls' }),
            }),
        );
    });

    it('restores partial physical-dice choices after CLOSE and clears them after APPLY', async () => {
        const closed = [of(undefined), of([{
            id: 'psr', outcome: 'success' as const, dice: [3, 4] as const, automatic: false,
        }])];
        const createDialog = jasmine.createSpy('createDialog').and.callFake(
            (_component: unknown, config: { data: {
                initialSelections?: readonly unknown[];
                selectionsChanged?: (selections: readonly unknown[]) => void;
            } }) => {
                if (createDialog.calls.count() === 1) {
                    config.data.selectionsChanged?.([{
                        id: 'psr', outcome: 'success', dice: [3, 4],
                    }]);
                }
                return { closed: closed[createDialog.calls.count() - 1] };
            },
        );
        TestBed.configureTestingModule({
            providers: [
                CBTAutomationCheckService,
                { provide: OptionsService, useValue: { cbtAutomationMode: () => 'ask' } },
                { provide: DialogsService, useValue: { createDialog } },
            ],
        });
        const service = TestBed.inject(CBTAutomationCheckService);
        const checks = [check('psr', 7)];

        expect(await service.resolve('pilotSkillCheck', checks, {
            title: 'Piloting Skill Rolls',
        })).toBeNull();
        expect(await service.resolve('pilotSkillCheck', checks, {
            title: 'Piloting Skill Rolls',
        })).toEqual([jasmine.objectContaining({ id: 'psr', outcome: 'success' })]);

        const secondConfig = createDialog.calls.argsFor(1)[1] as {
            data: { initialSelections?: readonly unknown[] };
        };
        expect(secondConfig.data.initialSelections).toEqual([
            { id: 'psr', outcome: 'success', dice: [3, 4] },
        ]);
    });

    it('groups concurrent compatible family checks and splits their resolutions', async () => {
        const combined = [
            { id: 'mek', outcome: 'success' as const, dice: [3, 4] as const, automatic: false },
            { id: 'aero', outcome: 'failed' as const, dice: [1, 2] as const, automatic: false },
        ];
        const createDialog = jasmine.createSpy('createDialog').and.returnValue({ closed: of(combined) });
        TestBed.configureTestingModule({
            providers: [
                CBTAutomationCheckService,
                { provide: OptionsService, useValue: { cbtAutomationMode: () => 'ask' } },
                { provide: DialogsService, useValue: { createDialog } },
            ],
        });
        const service = TestBed.inject(CBTAutomationCheckService);

        const [mek, aero] = await Promise.all([
            service.resolve('pilotSkillCheck', [check('mek', 7)], { title: 'Resolve Pending Checks' }),
            service.resolve('pilotSkillCheck', [check('aero', 7)], { title: 'Resolve Pending Checks' }),
        ]);

        expect(createDialog).toHaveBeenCalledTimes(1);
        const data = createDialog.calls.argsFor(0)[1].data as { checks: readonly AutomationCheck[] };
        expect(data.checks.map(row => row.id)).toEqual(['mek', 'aero']);
        expect(mek).toEqual([combined[0]]);
        expect(aero).toEqual([combined[1]]);
    });
});

function check(id: string, targetNumber: number, failureGroup?: string): AutomationCheck {
    return {
        id,
        subject: 'Unit',
        label: 'Piloting Skill Check',
        description: id,
        failureOutcome: 'Fall',
        targetNumber,
        ...(failureGroup === undefined ? {} : { failureGroup }),
    };
}
