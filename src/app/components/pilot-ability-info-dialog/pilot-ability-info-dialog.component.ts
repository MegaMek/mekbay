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

import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ASPilotAbility, ASCustomPilotAbility } from '../../models/pilot-abilities.model';

export interface PilotAbilityInfoDialogData {
    /** The pilot ability (either standard or custom) */
    ability: ASPilotAbility | ASCustomPilotAbility;
    /** Whether this is a custom ability */
    isCustom: boolean;
}

/**
 * Author: Drake
 *
 * Dialog component to show detailed information about a pilot ability.
 */
@Component({
    selector: 'pilot-ability-info-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './pilot-ability-info-dialog.component.html',
    styleUrl: './pilot-ability-info-dialog.component.scss'
})
export class PilotAbilityInfoDialogComponent {
    private readonly dialogRef = inject(DialogRef);
    private readonly data = inject<PilotAbilityInfoDialogData>(DIALOG_DATA);

    readonly ability = computed(() => this.data.ability);
    readonly isCustom = computed(() => this.data.isCustom);
    readonly abilityName = computed(() => this.ability().name);
    readonly abilityCost = computed(() => this.ability().cost);
    
    readonly summary = computed<string[]>(() => {
        const ability = this.ability();
        if (this.isCustom()) {
            // Custom abilities have a single summary string
            return [(ability as ASCustomPilotAbility).summary];
        }
        return (ability as ASPilotAbility).summary;
    });
    
    readonly rulesReference = computed<string | null>(() => {
        if (this.isCustom()) return null;
        const ability = this.ability() as ASPilotAbility;
        if (!ability.rulesPage) return null;
        return `${ability.rulesBook}, page ${ability.rulesPage}`;
    });

    close(): void {
        this.dialogRef.close();
    }
}
