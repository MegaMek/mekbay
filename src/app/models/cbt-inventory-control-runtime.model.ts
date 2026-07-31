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

import type { MountedEquipment } from './mounted-equipment.model';
import type { CBTForceUnit } from './cbt-force-unit.model';
import { InventoryControlRuntimeState, type InventoryControlRuntimeRangeKey, type InventoryControlRuntimeTarget, type InventoryControlRuntimeTargetId } from './inventory-control-runtime-state.model';

export class CBTInventoryControlRuntime extends InventoryControlRuntimeState {
    constructor(unit: CBTForceUnit) {
        super(() => unit.getInventory());
    }

    override setEntrySelected(entry: MountedEquipment, selected: boolean): void {
        super.setEntrySelected(entry, selected);
        this.markInventoryViewChanged();
    }

    override setEntryRange(entry: MountedEquipment, range: InventoryControlRuntimeRangeKey | null): void {
        super.setEntryRange(entry, range);
        this.markInventoryViewChanged();
    }

    override setEntryAmmoOption(entryId: string, optionId: string): void {
        super.setEntryAmmoOption(entryId, optionId);
        this.markInventoryViewChanged();
    }

    override setEntryTarget(entry: MountedEquipment, targetId: InventoryControlRuntimeTargetId | null): void {
        super.setEntryTarget(entry, targetId);
        this.markInventoryViewChanged();
    }

    override createTarget(): InventoryControlRuntimeTarget | null {
        const target = super.createTarget();
        this.markInventoryViewChanged();
        return target;
    }

    override updateTarget(targetId: InventoryControlRuntimeTargetId, patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>): InventoryControlRuntimeTarget | null {
        const target = super.updateTarget(targetId, patch);
        this.markInventoryViewChanged();
        return target;
    }

    override deleteTarget(targetId: InventoryControlRuntimeTargetId): void {
        super.deleteTarget(targetId);
        this.markInventoryViewChanged();
    }

    override resetTargets(): void {
        super.resetTargets();
        this.markInventoryViewChanged();
    }

    override clearSelection(): void {
        super.clearSelection();
        this.markInventoryViewChanged();
    }

}
