// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { ParsedAbility } from '../../services/as-ability-lookup.service';
import type { ASSpecialAbility } from '../../models/as-abilities.model';

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
