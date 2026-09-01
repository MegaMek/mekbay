// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Options } from '../models/options.model';
import { CBTUnitViewModeService } from './cbt-unit-view-mode.service';
import { OptionsService } from './options.service';

describe('CBTUnitViewModeService', () => {
    it('reads the persisted mode and writes toolbar changes back to options', () => {
        const options = signal({ cbtUnitViewMode: 'tactical' } as Options);
        const setOption = jasmine.createSpy('setOption').and.callFake(
            (key: keyof Options, value: Options[keyof Options]) => {
                options.update(current => ({ ...current, [key]: value }));
            },
        );

        TestBed.configureTestingModule({
            providers: [
                CBTUnitViewModeService,
                { provide: OptionsService, useValue: { options, setOption } },
            ],
        });
        const service = TestBed.inject(CBTUnitViewModeService);

        expect(service.mode()).toBe('tactical');

        service.showSheet();

        expect(setOption).toHaveBeenCalledOnceWith('cbtUnitViewMode', 'sheet');
        expect(service.mode()).toBe('sheet');

        service.toggle();

        expect(setOption).toHaveBeenCalledWith('cbtUnitViewMode', 'tactical');
        expect(service.mode()).toBe('tactical');
    });
});
