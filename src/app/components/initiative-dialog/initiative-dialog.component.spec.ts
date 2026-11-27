// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DialogRef } from '@angular/cdk/dialog';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import {
    initiativeOrderFromRolls,
    initiativeRollsDue,
    withInitiativeRoll,
    type InitiativeRecord,
} from '../../models/rules/initiative-rules';
import { InitiativeService, type InitiativeSide } from '../../services/initiative.service';
import { DiceRollerComponent } from '../dice-roller/dice-roller.component';
import { InitiativeDialogComponent } from './initiative-dialog.component';

describe('InitiativeDialogComponent', () => {
    const sides: InitiativeSide[] = [
        { id: 'ives', label: 'St. Ives', friendly: true, mine: true },
        { id: 'lance', label: 'Reinforced Lance', friendly: false, mine: true },
    ];

    function setup() {
        const record = signal<InitiativeRecord | null>(null);
        const ids = sides.map(side => side.id);
        const due = computed(() => initiativeRollsDue(ids, record()?.rolls ?? []));
        const initiative = {
            sides: signal(sides),
            record,
            order: computed(() => initiativeOrderFromRolls(ids, record()?.rolls ?? [])),
            due,
            myDue: computed(() => sides.filter(side => due().has(side.id))),
            carriedDice: signal({}),
            canReorder: signal(false),
            currentTurn: signal(0),
            currentPips: signal([]),
        };
        TestBed.configureTestingModule({
            imports: [InitiativeDialogComponent],
            providers: [
                { provide: InitiativeService, useValue: initiative },
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
            ],
        });
        const fixture = TestBed.createComponent(InitiativeDialogComponent);
        fixture.detectChanges();
        const roll = (side: string, dice: readonly [number, number]) => {
            record.set({ turn: 0, rolls: withInitiativeRoll(record()?.rolls ?? [], side, dice, 0) });
            fixture.detectChanges();
            jasmine.clock().tick(1000);
            fixture.detectChanges();
        };
        /** Each row's force and the dice its roller shows, top to bottom. */
        const shown = () => fixture.debugElement.queryAll(By.css('.side')).map(row => [
            row.query(By.css('.name')).nativeElement.textContent.trim(),
            row.query(By.directive(DiceRollerComponent)).componentInstance.diceResults(),
        ]);
        return { roll, shown, element: fixture.nativeElement as HTMLElement };
    }

    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('rolls each new roll out on its own force when the decided order moves the winner up', () => {
        const { roll, shown } = setup();
        roll('ives', [3, 2]);
        roll('lance', [6, 4]);
        expect(shown()).toEqual([['Reinforced Lance', [6, 4]], ['St. Ives', [3, 2]]]);
    });

    it('shows a tie as due for a reroll on both forces', () => {
        const { roll, shown, element } = setup();
        roll('ives', [6, 4]);
        roll('lance', [5, 5]);
        expect(shown()).toEqual([['St. Ives', [6, 4]], ['Reinforced Lance', [5, 5]]]);
        expect([...element.querySelectorAll('.roll-button')].map(button => button.textContent?.trim()))
            .toEqual(['REROLL TIE', 'REROLL TIE']);
    });
});
