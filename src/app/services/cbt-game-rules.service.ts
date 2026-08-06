// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { computed, inject, Injectable } from '@angular/core';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { CBTGameRules, CORE_2026_GAME_RULES, TW_GAME_RULES } from '../models/rules/game-rules';
import { AeroRules } from '../models/rules/aero-rules';
import { InfantryRules } from '../models/rules/infantry-rules';
import { MekRules } from '../models/rules/mek-rules';
import { ProtoMekRules } from '../models/rules/protomek-rules';
import { TWAeroRules, TWInfantryRules, TWMekRules, TWProtoMekRules, TWVehicleRules } from '../models/rules/tw-rules';
import type { UnitTypeRules } from '../models/rules/unit-type-rules';
import { VehicleRules } from '../models/rules/vehicle-rules';
import { OptionsService } from './options.service';

@Injectable({ providedIn: 'root' })
export class CBTGameRulesService {
    private readonly optionsService = inject(OptionsService);

    readonly gameRules = computed<CBTGameRules>(() => {
        return this.optionsService.options().CBTRules === 'tw'
            ? TW_GAME_RULES
            : CORE_2026_GAME_RULES;
    });

    createUnitRules(unit: CBTForceUnit): UnitTypeRules {
        if (unit.gameRules.id === 'tw') {
            switch (unit.getUnit().type) {
                case 'Mek': return new TWMekRules(unit);
                case 'Aero': return new TWAeroRules(unit);
                case 'Infantry': return new TWInfantryRules(unit);
                case 'ProtoMek': return new TWProtoMekRules(unit);
                default: return new TWVehicleRules(unit);
            }
        }
        switch (unit.getUnit().type) {
            case 'Mek': return new MekRules(unit);
            case 'Aero': return new AeroRules(unit);
            case 'Infantry': return new InfantryRules(unit);
            case 'ProtoMek': return new ProtoMekRules(unit);
            default: return new VehicleRules(unit);
        }
    }
}