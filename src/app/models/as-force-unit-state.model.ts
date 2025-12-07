/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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
import { ForceUnitState } from './force-unit-state.model';
import { ASForceUnit } from './as-force-unit.model';
import { ASSerializedState } from './force-serialization';

/*
 * Author: Drake
 */
export class ASForceUnitState extends ForceUnitState {
    declare unit: ASForceUnit;

    public heat = signal<number>(0);
    public armor = signal<number>(0);
    public internal = signal<number>(0);

    constructor(unit: ASForceUnit) {
        super(unit);
    }

    override update(data: ASSerializedState) {
        this.modified.set(data.modified);
        this.destroyed.set(data.destroyed);
        this.shutdown.set(data.shutdown);
        this.c3Linked.set(data.c3Linked);
        this.heat.set(data.heat);
        this.armor.set(data.armor);
        this.internal.set(data.internal);
    }
}
