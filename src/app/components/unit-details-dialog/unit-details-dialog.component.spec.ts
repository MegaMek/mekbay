// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { GameSystem } from '../../models/common.model';
import { DialogsService } from '../../services/dialogs.service';
import { FloatingOverlayService } from '../../services/floating-overlay.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { GameService } from '../../services/game.service';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { LayoutService } from '../../services/layout.service';
import { TaggingService } from '../../services/tagging.service';
import { ToastService } from '../../services/toast.service';
import { UrlService } from '../../services/url.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { UnitDetailsDialogComponent } from './unit-details-dialog.component';

describe('UnitDetailsDialogComponent', () => {
    it('uses model skill defaults for a crewless CBT unit', () => {
        const summary = createEmptyUnit({
            type: 'Handheld Weapon',
            subtype: 'Handheld Weapon',
            crewSize: 0,
        });
        const unit = Object.create(CBTForceUnit.prototype) as CBTForceUnit;
        Object.defineProperties(unit, {
            force: { value: { gameSystem: GameSystem.CLASSIC } },
            getUnit: { value: () => summary },
            getCrewMember: { value: () => undefined },
            gunnerySkill: { value: () => 4 },
            pilotingSkill: { value: () => 5 },
        });

        TestBed.configureTestingModule({
            imports: [UnitDetailsDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DIALOG_DATA, useValue: { unitList: [unit], unitIndex: 0 } },
                { provide: DialogRef, useValue: { closed: of(undefined) } },
                { provide: GameService, useValue: { isAlphaStrike: () => false } },
                { provide: ForceBuilderService, useValue: {} },
                { provide: ToastService, useValue: {} },
                { provide: LayoutService, useValue: { windowWidth: () => 1024 } },
                { provide: FloatingOverlayService, useValue: {} },
                { provide: TaggingService, useValue: {} },
                { provide: UrlService, useValue: { setQueryParams: () => {} } },
                { provide: DialogsService, useValue: {} },
                { provide: KeyboardShortcutService, useValue: { register: () => {} } },
            ],
        });
        TestBed.overrideComponent(UnitDetailsDialogComponent, { set: { template: '' } });

        const component = TestBed.createComponent(UnitDetailsDialogComponent).componentInstance;

        expect(component.gunnerySkill()).toBe(4);
        expect(component.pilotingSkill()).toBe(5);
    });
});