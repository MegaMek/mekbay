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

import { signal } from '@angular/core';
import type { CBTForceUnit } from '../cbt-force-unit.model';
import { UnitTypeRules } from './unit-type-rules';
import { PSRCheck } from '../turn-state.model';

/**
 * Author: Drake
 * 
 * Vehicle / Naval / VTOL / default game rules.
 */
export class VehicleRules implements UnitTypeRules {

    constructor(private unit: CBTForceUnit) {}

    evaluateDestroyed(): void {
        // Destruction: critLocs with 'destroy' attribute, SI, or any internal location destroyed.
        let destroyed = false;

        // Check critLocs with 'destroy' attribute (vehicle-style crits)
        for (const crit of this.unit.getCritSlots()) {
            if (crit.destroyed && crit.el?.getAttribute('destroy')) {
                destroyed = true;
                break;
            }
        }

        // Check SI (structural integrity)
        if (!destroyed && this.unit.locations?.internal?.has('SI')) {
            if (this.unit.isInternalLocCommittedDestroyed('SI')) {
                destroyed = true;
            }
        }

        // For Naval/Tank/VTOL: any internal location destroyed = unit destroyed
        const unitType = this.unit.getUnit().type;
        if (!destroyed && (unitType === 'Naval' || unitType === 'Tank' || unitType === 'VTOL')) {
            this.unit.locations?.internal?.forEach((_value, loc) => {
                if (this.unit.isInternalLocCommittedDestroyed(loc)) {
                    destroyed = true;
                }
            });
        }

        if (this.unit.destroyed !== destroyed) {
            this.unit.setDestroyed(destroyed);
        }
    }

    /** Vehicles do not support PSR. */
    readonly PSRModifiers = signal<{ modifier: number; modifiers: PSRCheck[] }>({ modifier: 0, modifiers: [] });
    readonly PSRTargetRoll = signal<number>(0);
}
