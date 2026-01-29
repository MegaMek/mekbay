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

import { ChangeDetectionStrategy, Component, inject, signal, viewChild, AfterViewInit, computed } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { DiceRollerComponent } from '../../dice-roller/dice-roller.component';
import { ASForceUnit } from '../../../models/as-force-unit.model';
import { MoveType } from '../../../models/units.model';

/*
 * Author: Drake
 *
 * Dialog for rolling motive system damage for vehicles.
 * Vehicles (CV, SV) must roll on this table whenever they take structure damage.
 */
export interface MotiveDamageRollDialogData {
    /** The force unit to apply motive damage to */
    forceUnit: ASForceUnit;
}

export interface MotiveDamageResult {
    roll: number;
    effectType: string;
    description: string;
    /** The pip key to mark if this effect is applicable, or null if no effect */
    pipKey: string | null;
}

interface MotiveTableEntry {
    effectType: string;
    description: string;
    /** The pip key to mark for this effect, or null if no effect */
    pipKey: string | null;
}

/**
 * Roll modifiers based on motive type.
 */
function getMotiveRollModifier(moveType: MoveType | undefined): number {
    switch (moveType) {
        case 'Tracked':
        case 'Naval':
        case 'Submarine':
        case 'Hydrofoil':
            return 0;
        case 'Wheeled':
        case 'Hover':
            return 1;
        case 'VTOL':
        case 'WiGE':
            return 2;
        default:
            // Default to tracked modifier for unknown types
            return 0;
    }
}

/**
 * Get display name for motive type category.
 */
function getMotiveTypeName(moveType: MoveType | undefined): string {
    switch (moveType) {
        case 'Tracked':
            return 'Tracked';
        case 'Naval':
        case 'Submarine':
        case 'Hydrofoil':
            return 'Naval';
        case 'Wheeled':
            return 'Wheeled';
        case 'Hover':
            return 'Hovercraft';
        case 'VTOL':
            return 'VTOL';
        case 'WiGE':
            return 'WiGE';
        default:
            return moveType ?? 'Unknown';
    }
}

/**
 * Motive Systems Damage Table.
 */
const MOTIVE_DAMAGE_TABLE: Record<number, MotiveTableEntry> = {
    // Results 2-8: No Effect (we'll handle this with <= 8 check)
    9: { effectType: '-2" Move, -1 TMM', description: 'Vehicle suffers -2" Move and -1 TMM for the rest of the game.', pipKey: 'motive1' },
    10: { effectType: '-2" Move, -1 TMM', description: 'Vehicle suffers -2" Move and -1 TMM for the rest of the game.', pipKey: 'motive1' },
    11: { effectType: '-50% Move, -50% TMM', description: 'Vehicle suffers -50% Move and -50% TMM, with a minimum of -2" Move and -1 TMM, for the rest of the game.', pipKey: 'motive2' },
    12: { effectType: 'Unit Immobilized', description: 'Vehicle is immobilized. It cannot move for the rest of the game.', pipKey: 'motive3' },
    // Results 13+: treated as 12
};

@Component({
    selector: 'motive-damage-roll-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DiceRollerComponent],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="content">
        <h2 dialog-title>MOTIVE SYSTEMS DAMAGE</h2>
        @if (unitDisplayName()) {
            <div class="unit-name alphastrike-text stroked colored">{{ unitDisplayName() }}</div>
        }
        <div dialog-content>
            <div class="motive-type-info">
                <span class="motive-label">Motive Type:</span>
                <span class="motive-value">{{ this.moveType }}</span>
                <span class="modifier-label">({{ rollModifier() >= 0 ? '+' : '' }}{{ rollModifier() }} modifier)</span>
            </div>
            
            <div class="dice-roller-container">
            <!-- 2D6 roll -->
            <dice-roller #mainRoller
                [diceCount]="2"
                [modifier]="rollModifier()"
                [rollDurationMs]="600"
                [freezeOnRollEnd]="500"
                (finished)="onMainRollFinished($event)"
                (click)="reroll()"
            />
            </div>
            
            @if (result()) {
                <div class="result-container">
                    <div class="result-type" [class.no-effect]="result()!.pipKey === null">
                        {{ result()!.effectType }}
                    </div>
                    <div class="reroll-hint">Click dice to reroll</div>
                </div>
            }
            
            <!-- Cannot apply warning -->
            @if (cannotApplyReason()) {
                <div class="cannot-apply-warning">
                    {{ cannotApplyReason() }}
                </div>
            }
        </div>
        <div dialog-actions>
            @if (canApply()) {
                <button (click)="apply()" class="bt-button primary">APPLY</button>
            }
            <button (click)="close()" class="bt-button">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        .content {
            display: block;
            max-width: 1000px;
            text-align: center;
        }

        h2 {
            margin-top: 8px;
            margin-bottom: 8px;
        }

        .unit-name {
            font-size: 1.8em;
        }

        [dialog-content] {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
            padding: 16px 0;
        }

        .motive-type-info {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 4px;
        }

        .motive-label {
            color: #aaa;
        }

        .motive-value {
            font-weight: bold;
            color: #fff;
        }

        .modifier-label {
            color: #ffcc00;
            font-size: 0.9em;
        }

        .result-container {
            padding: 16px;
            background: rgba(0, 0, 0, 0.3);
            min-width: 280px;
        }

        .result-type {
            font-size: 1.6em;
            font-weight: bold;
            color: #ff4444;
            margin-bottom: 8px;

            &.no-effect {
                color: #44ff44;
            }
        }

        .cannot-apply-warning {
            padding: 12px 16px;
            background: rgba(255, 100, 0, 0.2);
            border: 1px solid rgba(255, 100, 0, 0.5);
            color: #ffaa00;
            font-size: 0.95em;
        }

        .reroll-hint {
            margin-top: 8px;
            font-size: 0.85em;
            color: #888;
            font-style: italic;
        }

        dice-roller {
            cursor: pointer;
        }

        [dialog-actions] {
            padding-top: 8px;
            display: flex;
            gap: 8px;
            justify-content: center;
            flex-wrap: wrap;
        }

        [dialog-actions] button {
            padding: 8px;
            min-width: 100px;
        }
    `]
})
export class MotiveDamageRollDialogComponent implements AfterViewInit {
    private readonly dialogRef = inject(DialogRef);
    private readonly data = inject<MotiveDamageRollDialogData>(DIALOG_DATA);

    private readonly mainRoller = viewChild<DiceRollerComponent>('mainRoller');

    private readonly forceUnit = this.data.forceUnit;
    readonly moveType = this.forceUnit.getUnit().moveType;

    readonly result = signal<MotiveDamageResult | null>(null);

    /** Modifier to the roll based on motive type */
    readonly rollModifier = computed(() => getMotiveRollModifier(this.moveType));

    /** Display name combining chassis, model, and optional alias */
    readonly unitDisplayName = computed(() => {
        const unit = this.forceUnit.getUnit();
        const chassisModel = `${unit.chassis} ${unit.model}`;
        const alias = this.forceUnit.alias();
        return alias ? `${chassisModel} (${alias})` : chassisModel;
    });

    /** Reason why the effect cannot be applied, or null if it can */
    readonly cannotApplyReason = computed(() => {
        const res = this.result();
        if (!res || res.pipKey === null) return null;

        // Check if this motive level is already maxed
        const maxHits = this.getMaxHitsForPipKey(res.pipKey);
        const currentHits = this.forceUnit.getCommittedCritHits(res.pipKey) +
            this.forceUnit.getState().getPendingCritChange(res.pipKey);
        
        if (currentHits >= maxHits) {
            return `Motive damage already at maximum for this level.`;
        }

        return null;
    });

    /** Whether the current result can be applied */
    readonly canApply = computed(() => {
        const res = this.result();
        if (!res || res.pipKey === null) return false;
        if (this.cannotApplyReason()) return false;
        return true;
    });

    private getMaxHitsForPipKey(pipKey: string): number {
        switch (pipKey) {
            case 'motive1': return 2;
            case 'motive2': return 2;
            case 'motive3': return 1;
            default: return 1;
        }
    }

    ngAfterViewInit(): void {
        // Auto-roll when dialog opens
        setTimeout(() => {
            this.mainRoller()?.roll();
        }, 100);
    }

    onMainRollFinished(event: { results: number[]; sum: number }): void {
        const roll = event.sum;
        
        // Results of 8 or less (after modifier): No Effect
        if (roll <= 8) {
            this.result.set({
                roll,
                effectType: 'No Effect',
                description: 'The vehicle\'s motive systems suffer no additional damage.',
                pipKey: null,
            });
            return;
        }

        // Results of 13+ are treated as 12 (maximum damage)
        const effectiveRoll = Math.min(roll, 12);
        const entry = MOTIVE_DAMAGE_TABLE[effectiveRoll];
        
        if (entry) {
            this.result.set({
                roll,
                effectType: entry.effectType,
                description: entry.description,
                pipKey: entry.pipKey,
            });
        }
    }

    reroll(): void {
        this.result.set(null);
        this.mainRoller()?.roll();
    }

    /** Apply the motive damage by marking the appropriate pip */
    apply(): void {
        const res = this.result();
        if (!res || res.pipKey === null) return;

        // Get current pending delta for this motive level
        const currentDelta = this.forceUnit.getState().getPendingCritChange(res.pipKey);
        // Add one more hit
        this.forceUnit.setPendingCritHits(res.pipKey, currentDelta + 1);

        // Close the dialog after applying
        this.dialogRef.close(res);
    }

    close(): void {
        this.dialogRef.close(this.result());
    }
}
