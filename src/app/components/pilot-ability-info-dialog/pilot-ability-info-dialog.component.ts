// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { CommandAbility } from '../../models/command-abilities.model';
import { type PilotAbility, type ASCustomPilotAbility, formatSummaryMovement, getAbilityDetails } from '../../models/pilot-abilities.model';
import { formatRulesReference, type GameSystem, type RulesReference } from '../../models/common.model';
import type { GameService } from '../../services/game.service';
import { OptionsService } from '../../services/options.service';
import type { FormationWideAbility } from '../../utils/formation-type.model';

export interface PilotAbilityInfoDialogData {
    gameSystem: GameSystem;
    /** The pilot ability (either standard or custom) */
    ability: PilotAbility | ASCustomPilotAbility | CommandAbility | FormationWideAbility;
    /** Whether this is a custom ability */
    isCustom: boolean;
    /** Whether this is a formation-granted command ability */
    isCommand?: boolean;
    /** Whether this is a formation-wide ability that is not assigned to a unit. */
    isFormationWide?: boolean;
}

/**
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
    private readonly optionsService = inject(OptionsService);

    readonly ability = computed(() => this.data.ability);
    readonly isCustom = computed(() => this.data.isCustom);
    readonly isCommand = computed(() => this.data.isCommand ?? false);
    readonly isFormationWide = computed(() => this.data.isFormationWide ?? false);
    readonly summaryIsHtml = computed(() => !this.isCustom());
    readonly abilityName = computed(() => this.ability().name);
    readonly abilityCost = computed<number | null>(() => {
        if (this.isCommand() || this.isFormationWide()) {
            return null;
        }
        return (this.ability() as PilotAbility | ASCustomPilotAbility).cost;
    });
    readonly formatRuleReference = formatRulesReference;
    
    readonly summary = computed<string[]>(() => {
        const ability = this.ability();
        if (this.isCustom()) {
            // Custom abilities have a single summary string
            return [(ability as ASCustomPilotAbility).summary];
        }
        if (this.isCommand()) {
            return [...(ability as CommandAbility).summary];
        }
        if (this.isFormationWide()) {
            return formatSummaryMovement(
                (ability as FormationWideAbility).summary,
                this.optionsService.options().ASUseHex,
            );
        }
        return formatSummaryMovement(
            getAbilityDetails(ability as PilotAbility, this.data.gameSystem).summary,
            this.optionsService.options().ASUseHex,
        );
    });
    
    readonly rulesReference = computed<RulesReference[] | null>(() => {
        if (this.isCustom()) return null;
        if (this.isCommand()) {
            const ability = this.ability() as CommandAbility;
            return ability.rulesRef?.length ? ability.rulesRef : null;
        }
        if (this.isFormationWide()) {
            const ability = this.ability() as FormationWideAbility;
            return ability.rulesRef?.length ? ability.rulesRef : null;
        }
        const ability = this.ability() as PilotAbility;
        const details = getAbilityDetails(ability, this.data.gameSystem);
        if (!details.rulesRef?.length) return null;
        return details.rulesRef;
    });

    close(): void {
        this.dialogRef.close();
    }
}
