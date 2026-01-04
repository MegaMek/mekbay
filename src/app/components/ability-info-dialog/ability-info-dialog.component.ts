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
import { ASSpecialAbility } from '../../models/as-abilities.model';

export interface AbilityInfoDialogData {
    /** The parsed original ability */
    parsedAbility: ParsedAbility;
    /** Optional: the parsed effective ability after weapon damage reduction */
    effectiveParsed?: ParsedAbility;
}

/**
 * Represents a sub-ability with both original and effective text for display.
 */
export interface SubAbilityDisplay {
    originalText: string;
    effectiveText: string;
    ability: ASSpecialAbility | null;
    hasModification: boolean;
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
    readonly effectiveText = computed(() => this.data.effectiveParsed?.originalText ?? this.originalText());
    readonly hasModification = computed(() => {
        const effectiveParsed = this.data.effectiveParsed;
        return effectiveParsed !== undefined && effectiveParsed.originalText !== this.originalText();
    });
    readonly mainAbility = computed(() => this.data.parsedAbility.ability);
    readonly abilityName = computed(() => this.mainAbility()?.name ?? null);
    
    // Use effective turret damage if available, otherwise original
    readonly turretDamage = computed(() => 
        this.data.effectiveParsed?.turretDamage ?? this.data.parsedAbility.turretDamage ?? null
    );
    
    // Original turret damage for comparison
    readonly originalTurretDamage = computed(() => this.data.parsedAbility.turretDamage ?? null);
    readonly hasTurretModification = computed(() => {
        const original = this.originalTurretDamage();
        const effective = this.turretDamage();
        return original !== null && effective !== null && original !== effective;
    });
    
    // Combine original and effective sub-abilities for display
    readonly subAbilitiesDisplay = computed<SubAbilityDisplay[]>(() => {
        const originalSubs = this.data.parsedAbility.subAbilities ?? [];
        const effectiveSubs = this.data.effectiveParsed?.subAbilities ?? [];
        
        // Match up original and effective sub-abilities by index
        return originalSubs.map((sub, index) => {
            const effectiveSub = effectiveSubs[index];
            const effectiveText = effectiveSub?.originalText ?? sub.originalText;
            return {
                originalText: sub.originalText,
                effectiveText: effectiveText,
                ability: sub.ability,
                hasModification: sub.originalText !== effectiveText
            };
        });
    });
    
    readonly hasSubAbilities = computed(() => this.subAbilitiesDisplay().length > 0);

    close(): void {
        this.dialogRef.close();
    }
}
