// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { CommonModule } from '@angular/common';
import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { GameSystem } from '../../../models/common.model';
import { AsAbilityLookupService } from '../../../services/as-ability-lookup.service';
import { DataService } from '../../../services/data.service';
import { DialogsService } from '../../../services/dialogs.service';
import { GameService } from '../../../services/game.service';
import { OptionsService } from '../../../services/options.service';
import { createEmptyUnit } from '../../../testing/unit-test-helpers';
import { UnitCardExpandedComponent } from '../../unit-card-expanded/unit-card-expanded.component';
import { UnitDetailsVariantsTabComponent } from './unit-details-variants-tab.component';

describe('UnitDetailsVariantsTabComponent', () => {
    const variant = createEmptyUnit({
        name: 'Atlas AS7-D',
        chassis: 'Atlas',
        model: 'AS7-D',
        type: 'Mek',
        bv: 1_000,
    });
    const gameSystem = signal(GameSystem.CLASSIC);

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [UnitDetailsVariantsTabComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DataService, useValue: { getUnits: () => [variant] } },
                {
                    provide: GameService,
                    useValue: {
                        currentGameSystem: gameSystem,
                        isAlphaStrike: computed(() => gameSystem() === GameSystem.ALPHA_STRIKE),
                    },
                },
                {
                    provide: OptionsService,
                    useValue: { options: signal({ ASUseHex: false, forceViewerBVPVDisplay: 'both' }) },
                },
                { provide: DialogsService, useValue: { createDialog: jasmine.createSpy('createDialog') } },
                { provide: AsAbilityLookupService, useValue: { parseAbility: jasmine.createSpy('parseAbility') } },
            ],
        })
            .overrideComponent(UnitCardExpandedComponent, {
                set: {
                    imports: [CommonModule],
                    template: '',
                },
            })
            .compileComponents();
    });

    it('shows variant BV adjusted for the supplied skills', () => {
        const fixture = TestBed.createComponent(UnitDetailsVariantsTabComponent);
        fixture.componentRef.setInput('unit', variant);
        fixture.componentRef.setInput('gunnerySkill', 3);
        fixture.componentRef.setInput('pilotingSkill', 4);
        fixture.detectChanges();

        const card = fixture.debugElement.query(By.directive(UnitCardExpandedComponent))
            .componentInstance as UnitCardExpandedComponent;

        expect(card.resolvedBv()).toBe('1,320 (1,000)');
    });
});
