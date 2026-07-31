/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

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