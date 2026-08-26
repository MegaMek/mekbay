// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import type { CBTForce } from '../../../models/cbt-force.model';
import { RUNTIME_HISTORY_MESSAGE } from '../../../models/runtime/runtime-history';
import { PageRuntimeHistoryPanelComponent } from './page-runtime-history-panel.component';

describe('PageRuntimeHistoryPanelComponent', () => {
    it('defaults to readable unit history and offers clickable force-wide unit names', () => {
        const changed = new Subject<void>();
        const close = jasmine.createSpy('close');
        const selectUnit = jasmine.createSpy('selectUnit');
        const force = {
            changed,
            getRuntimeHistory: () => [{
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
                applied: false,
            }, {
                event: {
                    turn: 1,
                    phase: 2,
                    message: [RUNTIME_HISTORY_MESSAGE.TURN_ENDED],
                },
                applied: true,
            }],
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
        } as unknown as CBTForce;
        TestBed.configureTestingModule({ imports: [PageRuntimeHistoryPanelComponent] });
        const fixture = TestBed.createComponent(PageRuntimeHistoryPanelComponent);
        fixture.componentRef.setInput('force', force);
        fixture.componentRef.setInput('activeUnitId', 'unit:first');
        fixture.componentRef.setInput('selectUnit', selectUnit);
        fixture.componentRef.setInput('close', close);
        fixture.detectChanges();

        let text = (fixture.nativeElement as HTMLElement).textContent ?? '';
        expect(text).toContain('TURN 1');
        expect(fixture.nativeElement.querySelectorAll('h4')).toHaveSize(2);
        expect(text).toContain('6 armor damage at Left Torso (front) (pending)');
        expect(text).toContain('Fired Autocannon/20 using Precision AC/20 Ammo');
        expect(text).not.toContain('King Crab KGC-000:');
        expect(text).not.toContain('PPC at Right Arm slot 8');
        expect(text).toContain('Ended turn');
        expect(fixture.nativeElement.querySelectorAll('li')).toHaveSize(3);
        expect(fixture.nativeElement.querySelectorAll('li.undone')).toHaveSize(0);

        const forceWide = [...fixture.nativeElement.querySelectorAll('.history-tabs button')]
            .find((button: Element) => button.textContent?.includes('Force-wide')) as HTMLButtonElement;
        forceWide.click();
        fixture.detectChanges();

        text = (fixture.nativeElement as HTMLElement).textContent ?? '';
        expect(text).toContain('King Crab KGC-000');
        expect(text).toContain('Awesome AWS-8Q');
        expect(text).toContain('Critical hit on PPC at Right Arm slot 8 (pending)');
        expect(fixture.nativeElement.querySelectorAll('li')).toHaveSize(4);
        expect(fixture.nativeElement.querySelectorAll('li.undone')).toHaveSize(1);

        const awesomeLink = [...fixture.nativeElement.querySelectorAll('.unit-link')]
            .find((button: Element) => button.textContent?.includes('Awesome')) as HTMLButtonElement;
        awesomeLink.click();
        expect(selectUnit).toHaveBeenCalledOnceWith('unit:second');
        expect(close).toHaveBeenCalledTimes(1);

        (fixture.nativeElement.querySelector('.close-log') as HTMLButtonElement).click();
        expect(close).toHaveBeenCalledTimes(2);
    });
});
