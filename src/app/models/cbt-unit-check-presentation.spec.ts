// SPDX-License-Identifier: GPL-3.0-or-later

import { orderedAutomationChecks, type AutomationCheck } from './automation-check.model';
import {
    cbtUnitCheckAutomaticMessage,
    cbtUnitCheckPresentation,
    cbtUnitCheckReviewDescription,
} from './cbt-unit-check-presentation';

describe('CBT unit-check presentation', () => {
    it('uses the canonical origin/next text for recoveries and heat checks', () => {
        expect(cbtUnitCheckPresentation('shutdown', { targetNumber: 6 })).toEqual(jasmine.objectContaining({
            label: 'Shutdown',
            description: 'Avoid shutdown.',
            failureOutcome: 'shutdown',
        }));
        expect(cbtUnitCheckPresentation('startup')).toEqual(jasmine.objectContaining({
            label: 'Shutdown recovery',
            description: 'Heat below 14.',
            successLabel: 'RESTARTS',
            failedLabel: 'REMAINS SHUTDOWN',
            automaticLabel: 'AUTOMATIC RESTART',
        }));
        expect(cbtUnitCheckPresentation('consciousness-recovery')).toEqual(jasmine.objectContaining({
            label: 'Consciousness recovery',
            description: 'Restores consciousness; the unit may act next turn.',
            successLabel: 'WAKES UP',
            failedLabel: 'STAYS UNCONSCIOUS',
        }));
    });

    it('orders checks by rules priority while preserving ties', () => {
        const checks: AutomationCheck[] = [
            check('ammo:first', 20),
            check('shutdown:first', 10),
            check('shutdown:second', 10),
            check('consciousness', 80),
        ];

        expect(orderedAutomationChecks(checks).map(row => row.id)).toEqual([
            'shutdown:first',
            'shutdown:second',
            'ammo:first',
            'consciousness',
        ]);
    });

    it('uses the exact origin/next review wording', () => {
        expect(cbtUnitCheckReviewDescription('shutdown', { targetNumber: 6 }))
            .toBe('Shutdown check 6+');
        expect(cbtUnitCheckReviewDescription('startup', { heat: 10 }))
            .toBe('Engine restarts automatically at heat 10');
        expect(cbtUnitCheckReviewDescription('random-movement', { targetNumber: 7 }))
            .toBe('Random movement check 7+');
        expect(cbtUnitCheckReviewDescription('random-movement', { heat: 15 }))
            .toBe('Heat 15 ends the heat-induced random-movement effect');
        expect(cbtUnitCheckReviewDescription('pilot-damage', {
            targetNumber: 5,
            hits: 1,
        })).toBe('Pilot heat damage check 5+ · 1 pilot hit on failure');
        expect(cbtUnitCheckReviewDescription('life-support-damage', { hits: 2 }))
            .toBe('Damaged life support (2 pilot hits)');
        expect(cbtUnitCheckReviewDescription('control-recovery'))
            .toBe('Regain control after heat-induced random movement.');
        expect(cbtUnitCheckReviewDescription('control-recovery', {
            controlCause: 'controller-loss',
        })).toBe('Regain control after going out of control.');
    });

    it('uses the exact origin/next automatic result wording', () => {
        expect(cbtUnitCheckAutomaticMessage('shutdown', {
            outcome: 'failed', total: 2, targetNumber: 6,
        })).toBe('Shutdown: FAILED (2 vs 6+) — unit shut down');
        expect(cbtUnitCheckAutomaticMessage('startup', {
            outcome: 'success', total: 12, targetNumber: 6,
        })).toBe('Shutdown recovery: PASSED (12 vs 6+) — unit restarted');
        expect(cbtUnitCheckAutomaticMessage('life-support-damage', {
            outcome: 'failed', total: null,
        }, { hits: 3 })).toBe(
            'Life Support damage: FAILED (automatic) — 3 pilot hits applied',
        );
        expect(cbtUnitCheckAutomaticMessage('control-recovery', {
            outcome: 'failed', total: 4, targetNumber: 5,
        })).toBe(
            'Regain aerospace control: FAILED (4 vs 5+) — unit remains out of control',
        );
        expect(cbtUnitCheckAutomaticMessage('ammo-explosion', {
            outcome: 'failed', total: 3, targetNumber: 4, effect: null,
        })).toBe('Ammunition explosion: FAILED (3 vs 4+)');
    });
});

function check(id: string, priority: number): AutomationCheck {
    return {
        id,
        subject: 'Unit',
        label: id,
        description: '',
        failureOutcome: '',
        priority,
    };
}
