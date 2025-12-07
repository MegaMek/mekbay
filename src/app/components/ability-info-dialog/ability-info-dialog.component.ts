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
import { ParsedAbility } from '../../services/as-ability-lookup.service';

export interface AbilityInfoDialogData {
    parsedAbility: ParsedAbility;
}

@Component({
    selector: 'ability-info-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './ability-info-dialog.component.html',
    styleUrl: './ability-info-dialog.component.scss'
})
export class AbilityInfoDialogComponent {
    private readonly dialogRef = inject(DialogRef);
    private readonly data = inject<AbilityInfoDialogData>(DIALOG_DATA);

    readonly originalText = computed(() => this.data.parsedAbility.originalText);
    readonly mainAbility = computed(() => this.data.parsedAbility.ability);
    readonly abilityName = computed(() => this.mainAbility()?.name ?? null);
    readonly turretDamage = computed(() => this.data.parsedAbility.turretDamage ?? null);
    readonly subAbilities = computed(() => this.data.parsedAbility.subAbilities ?? []);
    readonly hasSubAbilities = computed(() => this.subAbilities().length > 0);

    close(): void {
        this.dialogRef.close();
    }
}
