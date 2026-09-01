// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import { AsAbilityLookupService } from './as-ability-lookup.service';
import { LoggerService } from './logger.service';

describe('AsAbilityLookupService shared specials AST', () => {
    let service: AsAbilityLookupService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                AsAbilityLookupService,
                {
                    provide: LoggerService,
                    useValue: {
                        info: jasmine.createSpy('info'),
                        warn: jasmine.createSpy('warn'),
                        error: jasmine.createSpy('error'),
                    },
                },
            ],
        });
        service = TestBed.inject(AsAbilityLookupService);
    });

    it('projects TUR damage and nested abilities from the shared parser', () => {
        const parsed = service.parseAbility('TUR(3/3/3,IF2,LRM3/3/2,SNARC)');

        expect(parsed.ability).not.toBeNull();
        expect(parsed.turretDamage).toBe('3/3/3');
        expect(parsed.subAbilities?.map(ability => ability.originalText)).toEqual([
            'IF2',
            'LRM3/3/2',
            'SNARC',
        ]);
        expect(parsed.subAbilities?.every(ability => ability.ability !== null)).toBeTrue();
    });

    it('keeps non-TUR parenthesized values as parameters rather than child abilities', () => {
        const parsed = service.parseAbility('LAM(6"g/12a)');

        expect(parsed.ability).not.toBeNull();
        expect(parsed.subAbilities).toEqual([]);
        expect(parsed.turretDamage).toBeUndefined();
    });
});
