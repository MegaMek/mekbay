// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import type { CBTForce } from '../../../models/cbt-force.model';
import { RUNTIME_HISTORY_MESSAGE } from '../../../models/runtime/runtime-history';
import { ForceWorkspaceStateService } from '../../../services/force-workspace-state.service';
import { ToastService } from '../../../services/toast.service';
import { PageRuntimeHistoryPanelComponent } from './page-runtime-history-panel.component';

describe('PageRuntimeHistoryPanelComponent', () => {
    const turnOneRows = [{
        event: {
            turn: 1,
            phase: 1,
            message: [RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR, 'unit:first', 'f:lt', 6, 'pending'],
        },
        applied: true,
    }, {
        event: {
            turn: 1,
            phase: 1,
            message: [
                RUNTIME_HISTORY_MESSAGE.WEAPONS_FIRED,
                'unit:first',
                'c:ac20',
                'ISAC20PrecisionAmmo',
            ],
        },
        applied: true,
    }, {
        event: {
            turn: 1,
            phase: 2,
            message: [RUNTIME_HISTORY_MESSAGE.DAMAGE_CRITICAL, 'unit:second', 's:ra:7', 1, 'pending'],
        },
        applied: true,
    }, {
        event: {
            turn: 1,
            phase: 2,
            message: [RUNTIME_HISTORY_MESSAGE.TURN_ENDED],
        },
        applied: true,
    }];

    function setup(history: () => readonly unknown[], undoState = { canUndo: true, canRedo: false }) {
        const changed = new Subject<void>();
        const close = jasmine.createSpy('close');
        const selectUnit = jasmine.createSpy('selectUnit');
        const members = { 'unit:second': { id: 'unit:second' } } as Record<string, unknown>;
        const force = {
            changed,
            readOnly: () => false,
            getRuntimeHistory: history,
            getRuntimeUndoState: () => undoState,
            undoRuntimeCommand: jasmine.createSpy('undo').and.resolveTo({ accepted: true, changed: true }),
            redoRuntimeCommand: jasmine.createSpy('redo').and.resolveTo({ accepted: true, changed: true }),
            getCBTMember: (instanceId: string) => members[instanceId] ?? null,
            runtimeHistoryUnitLabel: (instanceId: string) => instanceId === 'unit:first'
                ? 'King Crab KGC-000'
                : 'Awesome AWS-8Q',
            runtimeHistoryTargetLabel: (_instanceId: string, kind: string) => kind === 'critical'
                ? 'PPC at Right Arm slot 8'
                : kind === 'component'
                    ? 'Autocannon/20'
                : 'Left Torso (front)',
            runtimeHistoryCrewLabel: () => 'Pilot',
            runtimeHistoryAmmoLabel: () => 'Precision AC/20 Ammo',
        };
        TestBed.configureTestingModule({
            imports: [PageRuntimeHistoryPanelComponent],
            providers: [
                { provide: ForceWorkspaceStateService, useValue: { selectUnit } },
                { provide: ToastService, useValue: { showToast: () => '' } },
            ],
        });
        const fixture = TestBed.createComponent(PageRuntimeHistoryPanelComponent);
        fixture.componentRef.setInput('force', force as unknown as CBTForce);
        fixture.componentRef.setInput('activeUnitId', 'unit:first');
        fixture.componentRef.setInput('close', close);
        fixture.detectChanges();
        const element = fixture.nativeElement as HTMLElement;
        // Buttons by their visible text, or by their label when they show only an icon.
        const button = (text: string) => [...element.querySelectorAll('button')]
            .find(candidate => candidate.textContent?.includes(text) || candidate.getAttribute('aria-label') === text) as HTMLButtonElement;
        return { fixture, element, force, changed, close, selectUnit, button };
    }

    it('defaults to readable unit history, names phases and offers clickable force-wide unit names', () => {
        const { fixture, element, close, selectUnit, button } = setup(() => turnOneRows);

        let text = element.textContent ?? '';
        expect(text).toContain('TURN 1');
        expect([...element.querySelectorAll('h4')].map(header => header.textContent?.trim()))
            .toEqual(['Movement', 'Weapons']);
        expect(text).toContain('6 armor damage at Left Torso (front) (pending)');
        expect(text).toContain('Fired Autocannon/20 using Precision AC/20 Ammo');
        expect(text).not.toContain('King Crab KGC-000:');
        expect(text).not.toContain('PPC at Right Arm slot 8');
        expect(text).toContain('Ended turn');
        expect(element.querySelectorAll('li')).toHaveSize(3);

        button('Force-wide').click();
        fixture.detectChanges();

        text = element.textContent ?? '';
        expect(text).toContain('King Crab KGC-000');
        expect(text).toContain('Awesome AWS-8Q');
        expect(text).toContain('Critical hit on PPC at Right Arm slot 8 (pending)');
        expect(element.querySelectorAll('li')).toHaveSize(4);

        button('Awesome').click();
        expect(selectUnit).toHaveBeenCalledOnceWith(jasmine.objectContaining({ id: 'unit:second' }));
        expect(close).toHaveBeenCalledTimes(1);

        button('Close log').click();
        expect(close).toHaveBeenCalledTimes(2);
    });

    it('grays out undone entries and undoes and redoes through the force session', async () => {
        const rows = [turnOneRows[0], { ...turnOneRows[1], applied: false }];
        const { fixture, element, force, button } = setup(() => rows, { canUndo: true, canRedo: true });

        expect(element.querySelectorAll('li.undone')).toHaveSize(1);
        expect(button('Undo').disabled).toBeFalse();
        expect(button('Redo').disabled).toBeFalse();
        button('Undo').click();
        button('Redo').click();
        await fixture.whenStable();
        expect(force.undoRuntimeCommand).toHaveBeenCalledTimes(1);
        expect(force.redoRuntimeCommand).toHaveBeenCalledTimes(1);
    });

    it('shows one turn at a time, opening on the latest and following it until an older turn is picked', () => {
        let rows = [
            { event: { turn: 1, phase: 1, message: [RUNTIME_HISTORY_MESSAGE.TURN_ENDED] }, applied: true },
            { event: { turn: 2, phase: 1, message: [RUNTIME_HISTORY_MESSAGE.PHASE_DISCARDED] }, applied: true },
        ];
        const { fixture, element, changed, button } = setup(() => rows);
        const chips = () => [...element.querySelectorAll('.turn-chip')].map(chip => chip.textContent?.trim());
        const shown = () => element.querySelector('.turn-chip.active')?.textContent?.trim();

        expect(chips()).toEqual(['TURN 1', 'TURN 2']);
        expect(shown()).toBe('TURN 2');
        expect(element.textContent).not.toContain('Ended turn');

        rows = [...rows, { event: { turn: 3, phase: 1, message: [RUNTIME_HISTORY_MESSAGE.TURN_ENDED] }, applied: true }];
        changed.next();
        fixture.detectChanges();
        expect(shown()).toBe('TURN 3');

        button('TURN 1').click();
        fixture.detectChanges();
        expect(shown()).toBe('TURN 1');
        expect(element.textContent).toContain('Ended turn');

        rows = [...rows, { event: { turn: 4, phase: 1, message: [RUNTIME_HISTORY_MESSAGE.TURN_ENDED] }, applied: true }];
        changed.next();
        fixture.detectChanges();
        expect(shown()).toBe('TURN 1');
    });
});
