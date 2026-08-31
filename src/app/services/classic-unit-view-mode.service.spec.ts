// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Options } from '../models/options.model';
import { ClassicUnitViewModeService } from './classic-unit-view-mode.service';
import { OptionsService } from './options.service';

describe('ClassicUnitViewModeService', () => {
    it('reads the persisted mode and writes toolbar changes back to options', () => {
        const options = signal({ classicUnitViewMode: 'tactical' } as Options);
        const setOption = jasmine.createSpy('setOption').and.callFake(
            (key: keyof Options, value: Options[keyof Options]) => {
                options.update(current => ({ ...current, [key]: value }));
            },
        );

        TestBed.configureTestingModule({
            providers: [
                ClassicUnitViewModeService,
                { provide: OptionsService, useValue: { options, setOption } },
            ],
        });
        const service = TestBed.inject(ClassicUnitViewModeService);

        expect(service.mode()).toBe('tactical');

        service.showSheet();

        expect(setOption).toHaveBeenCalledOnceWith('classicUnitViewMode', 'sheet');
        expect(service.mode()).toBe('sheet');

        service.toggle();

        expect(setOption).toHaveBeenCalledWith('classicUnitViewMode', 'tactical');
        expect(service.mode()).toBe('tactical');
    });
});
