// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OptionsService } from './options.service';
import { UnitNameService } from './unit-name.service';
import type { DisplayUnitNameFormat } from '../models/options.model';
import { TestBipedMekEntity } from '../models/entity/testing/test-entities';
import { formatUnitChassis, formatUnitName } from '../utils/unit-display-name.util';

describe('Unit name presentation', () => {
    const summary = Object.freeze({
        chassis: 'Mad Cat (Timber Wolf)', baseChassis: 'Mad Cat', clanName: 'Timber Wolf', model: 'Prime',
    });

    it('formats summaries and live entities consistently without changing catalog names', () => {
        const options = signal<{ displayUnitNameFormat: DisplayUnitNameFormat }>({ displayUnitNameFormat: 'innerSphereClan' });
        TestBed.configureTestingModule({ providers: [{ provide: OptionsService, useValue: { options } }] });
        const names = TestBed.inject(UnitNameService);
        const entity = new TestBipedMekEntity();
        entity.chassis.set(summary.baseChassis);
        entity.clanName.set(summary.clanName);
        entity.model.set(summary.model);
        const liveName = computed(() => names.name(entity));
        const summaryName = computed(() => names.name(summary));
        expect(liveName()).toBe('Mad Cat (Timber Wolf) Prime');
        expect(summaryName()).toBe(liveName());

        options.set({ displayUnitNameFormat: 'clanInnerSphere' });
        expect(liveName()).toBe('Timber Wolf (Mad Cat) Prime');
        expect(summaryName()).toBe(liveName());
        expect(entity.fullChassis()).toBe(summary.chassis);
        expect(summary.chassis).toBe('Mad Cat (Timber Wolf)');

        options.set({ displayUnitNameFormat: 'innerSphereClan' });
        expect(summaryName()).toBe('Mad Cat (Timber Wolf) Prime');
    });

    it('shows the available name alone in either format and preserves chassis parentheses', () => {
        for (const format of ['innerSphereClan', 'clanInnerSphere'] as const) {
            expect(formatUnitChassis({ chassis: 'King Crab' }, format)).toBe('King Crab');
            expect(formatUnitChassis({ chassis: '', clanName: 'Timber Wolf' }, format)).toBe('Timber Wolf');
            expect(formatUnitName({ chassis: '', clanName: 'Timber Wolf', model: 'Prime' }, format)).toBe('Timber Wolf Prime');
            expect(formatUnitChassis({ chassis: 'Atlas (Prototype)' }, format)).toBe('Atlas (Prototype)');
            expect(formatUnitChassis(undefined, format)).toBe('');
        }
        const entity = new TestBipedMekEntity();
        entity.chassis.set('');
        entity.clanName.set('Timber Wolf');
        expect(entity.fullChassis()).toBe('Timber Wolf');
    });

    it('updates generated sheet labels without touching model or rules text', () => {
        const options = signal({ displayUnitNameFormat: 'clanInnerSphere' });
        TestBed.configureTestingModule({ providers: [{ provide: OptionsService, useValue: { options } }] });
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.innerHTML = '<text id="type">old</text><text data-mekbay-field="display-name">old</text><text id="model">Prime</text>';
        TestBed.inject(UnitNameService).applyToRecordSheet(svg, summary);
        expect(svg.getElementById('type')?.textContent).toBe('Timber Wolf (Mad Cat) Prime');
        expect(svg.querySelector('[data-mekbay-field]')?.textContent).toBe('Timber Wolf (Mad Cat) Prime');
        expect(svg.getElementById('model')?.textContent).toBe('Prime');
    });
});
