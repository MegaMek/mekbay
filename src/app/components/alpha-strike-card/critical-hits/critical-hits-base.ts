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

import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { ASForceUnit } from '../../../models/as-force-unit.model';

/*
 * Author: Drake
 * 
 * Critical Hits base component.
 */
@Component({
    selector: 'as-critical-hits-base',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: ``,
})
export class AsCriticalHitsBase {
    forceUnit = input<ASForceUnit>();
    cardStyle = input<'colored' | 'monochrome'>('colored');
    useHex = input<boolean>(false);
    
    range(count: number): number[] {
        return Array.from({ length: count }, (_, i) => i);
    }

    /**
     * Check if a pip should be shown as committed damage.
     * Pips fill from left (index 0) up to committed count.
     */
    isCritPipDamaged(key: string, pipIndex: number): boolean {
        const fu = this.forceUnit();
        if (!fu) return false;
        const committed = fu.getState().getCommittedCritHits(key);
        return pipIndex < committed;
    }

    /**
     * Check if a pip should be shown as pending damage.
     * Pending damage pips come after committed pips.
     */
    isCritPipPendingDamage(key: string, pipIndex: number): boolean {
        const fu = this.forceUnit();
        if (!fu) return false;
        const committed = fu.getState().getCommittedCritHits(key);
        const pendingChange = fu.getState().getPendingCritChange(key);
        
        // If pending is positive (damage), pips from committed to committed+pending are pending damage
        if (pendingChange > 0) {
            return pipIndex >= committed && pipIndex < committed + pendingChange;
        }
        return false;
    }

    /**
     * Check if a pip should be shown as pending heal.
     * Pending heal pips are the last committed pips that will be removed.
     */
    isCritPipPendingHeal(key: string, pipIndex: number): boolean {
        const fu = this.forceUnit();
        if (!fu) return false;
        const committed = fu.getState().getCommittedCritHits(key);
        const pendingChange = fu.getState().getPendingCritChange(key);
        
        // If pending is negative (heal), the last |pendingChange| committed pips are pending heal
        if (pendingChange < 0) {
            const healCount = -pendingChange;
            const startHealIndex = Math.max(0, committed - healCount);
            return pipIndex >= startHealIndex && pipIndex < committed;
        }
        return false;
    }
}
