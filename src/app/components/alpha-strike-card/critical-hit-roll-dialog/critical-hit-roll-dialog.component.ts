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
import { ASUnitTypeCode } from '../../../models/units.model';
import { OptionsService } from '../../../services/options.service';

/*
 * Author: Drake
 *
 * Dialog for rolling critical hits and displaying the result.
 */
export interface CriticalHitRollDialogData {
    /** The unit type code to determine which table to use */
    unitType: ASUnitTypeCode;
    /** The force unit to apply critical hits to (optional) */
    forceUnit?: ASForceUnit;
}

export interface CriticalHitResult {
    roll: number;
    critType: string;
    description: string;
    /** The pip key to mark if this crit is applicable, or null if not mappable */
    pipKey: string | null;
    /** For weapon hits on large vessels, the randomly determined arc */
    randomArc?: string;
    /** Whether damage was added instead of crit applied */
    damageAdded?: boolean;
}

interface CritTableEntry {
    critType: string;
    description: string;
    /** The pip key to mark for this crit, or null if not directly mappable */
    pipKey: string | null;
    /** Whether this crit requires a random arc roll (for vessel weapon hits) */
    requiresArcRoll?: boolean;
    /** Maximum number of this crit type allowed (e.g., 1 for Thruster Hit) */
    maxHits?: number;
}

/** Arc labels for random arc determination */
const ARCS = ['NOSE', 'AFT', 'LS', 'RS'] as const;
type ArcLabel = typeof ARCS[number];

/** Weapon column types for large vessels with CAP (WS, SS, JS) */
const WEAPON_COLUMNS_WITH_CAP = ['STD', 'CAP', 'SCAP', 'MSL'] as const;

/** Weapon column types for large vessels without CAP (DA, DS, SC) */
const WEAPON_COLUMNS_NO_CAP = ['STD', 'SCAP', 'MSL'] as const;

function dropshipOrSmallCraft(unitType: ASUnitTypeCode): boolean {
    return ['DA', 'DS', 'SC'].includes(unitType);
}

/**
 * Critical hit tables based on unit type.
 * Keys are 2D6 roll values (2-12).
 */
const CRIT_TABLE_MEK: Record<number, CritTableEntry> = {
    2: { critType: 'Ammo Hit', description: 'Unit destroyed unless CASE/CASEII/ENE. CASE: +1 damage. CASEII/ENE: No effect.', pipKey: null },
    3: { critType: 'Engine Hit', description: '+1 Heat when firing weapons. Second hit destroys unit.', pipKey: 'engine' },
    4: { critType: 'Fire Control Hit', description: '+2 To-Hit modifier for weapon attacks.', pipKey: 'fire-control' },
    5: { critType: 'No Critical Hit', description: 'No additional effect.', pipKey: null },
    6: { critType: 'Weapon Hit', description: '-1 Damage at all ranges.', pipKey: 'weapons' },
    7: { critType: 'MP Hit', description: '½ Movement. Minimum -2" MV and -1 TMM per hit.', pipKey: 'mp' },
    8: { critType: 'Weapon Hit', description: '-1 Damage at all ranges.', pipKey: 'weapons' },
    9: { critType: 'No Critical Hit', description: 'No additional effect.', pipKey: null },
    10: { critType: 'Fire Control Hit', description: '+2 To-Hit modifier for weapon attacks.', pipKey: 'fire-control' },
    11: { critType: 'Engine Hit', description: '+1 Heat when firing weapons. Second hit destroys unit.', pipKey: 'engine' },
    12: { critType: 'Unit Destroyed', description: 'The unit is eliminated from the game.', pipKey: null },
};

const CRIT_TABLE_PROTOMEK: Record<number, CritTableEntry> = {
    2: { critType: 'Weapon Hit', description: '-1 Damage at all ranges.', pipKey: 'weapons' },
    3: { critType: 'Weapon Hit', description: '-1 Damage at all ranges.', pipKey: 'weapons' },
    4: { critType: 'Fire Control Hit', description: '+2 To-Hit modifier for weapon attacks.', pipKey: 'fire-control' },
    5: { critType: 'MP Hit', description: '½ Movement. Minimum -2" MV and -1 TMM per hit.', pipKey: 'mp' },
    6: { critType: 'No Critical Hit', description: 'No additional effect.', pipKey: null },
    7: { critType: 'MP Hit', description: '½ Movement. Minimum -2" MV and -1 TMM per hit.', pipKey: 'mp' },
    8: { critType: 'No Critical Hit', description: 'No additional effect.', pipKey: null },
    9: { critType: 'MP Hit', description: '½ Movement. Minimum -2" MV and -1 TMM per hit.', pipKey: 'mp' },
    10: { critType: 'Unit Destroyed', description: 'The unit is eliminated from the game.', pipKey: null },
    11: { critType: 'Weapon Hit', description: '-1 Damage at all ranges.', pipKey: 'weapons' },
    12: { critType: 'Weapon Hit', description: '-1 Damage at all ranges.', pipKey: 'weapons' },
};

const CRIT_TABLE_VEHICLE: Record<number, CritTableEntry> = {
    2: { critType: 'Ammo Hit', description: 'Unit destroyed unless CASE/CASEII/ENE. CASE: +1 damage. CASEII/ENE: No effect.', pipKey: null },
    3: { critType: 'Crew Stunned', description: 'Unit cannot move or attack next turn. Treated as immobile target.', pipKey: null },
    4: { critType: 'Fire Control Hit', description: '+2 To-Hit modifier for weapon attacks.', pipKey: 'fire-control' },
    5: { critType: 'Fire Control Hit', description: '+2 To-Hit modifier for weapon attacks.', pipKey: 'fire-control' },
    6: { critType: 'No Critical Hit', description: 'No additional effect.', pipKey: null },
    7: { critType: 'No Critical Hit', description: 'No additional effect.', pipKey: null },
    8: { critType: 'No Critical Hit', description: 'No additional effect.', pipKey: null },
    9: { critType: 'Weapon Hit', description: '-1 Damage at all ranges.', pipKey: 'weapons' },
    10: { critType: 'Weapon Hit', description: '-1 Damage at all ranges.', pipKey: 'weapons' },
    11: { critType: 'Crew Killed', description: 'The unit is destroyed. Remove from play.', pipKey: null },
    12: { critType: 'Engine Hit', description: '½ MV and Damage. Second hit destroys unit.', pipKey: 'engine' },
};

const CRIT_TABLE_VEHICLE_SCOURING_SANDS: Record<number, CritTableEntry> = {
    2: { critType: 'Ammo Hit', description: 'Unit destroyed unless CASE/CASEII/ENE. CASE: +1 damage. CASEII/ENE: No effect.', pipKey: null },
    3: { critType: 'Crew Stunned', description: 'Unit cannot move or attack next turn. Treated as immobile target.', pipKey: null },
    4: { critType: 'Fire Control Hit', description: '+2 To-Hit modifier for weapon attacks.', pipKey: 'fire-control' },
    5: { critType: 'Fire Control Hit', description: '+2 To-Hit modifier for weapon attacks.', pipKey: 'fire-control' },
    6: { critType: 'Weapon Hit', description: '-1 Damage at all ranges.', pipKey: 'weapons' },
    7: { critType: 'Motive Hit', description: '½ Movement. Minimum -2" MV and -1 TMM per hit.', pipKey: 'motive2' },
    8: { critType: 'Weapon Hit', description: '-1 Damage at all ranges.', pipKey: 'weapons' },
    9: { critType: 'Weapon Hit', description: '-1 Damage at all ranges.', pipKey: 'weapons' },
    10: { critType: 'Weapon Hit', description: '-1 Damage at all ranges.', pipKey: 'weapons' },
    11: { critType: 'Crew Killed', description: 'The unit is destroyed. Remove from play.', pipKey: null },
    12: { critType: 'Engine Hit', description: '½ MV and Damage. Second hit destroys unit.', pipKey: 'engine' },
};

const CRIT_TABLE_AEROSPACE: Record<number, CritTableEntry> = {
    2: { critType: 'Fuel Hit', description: 'Fuel tank hit. Unit crashes and is destroyed.', pipKey: null },
    3: { critType: 'Fire Control Hit', description: '+2 To-Hit modifier for weapon attacks.', pipKey: 'fire-control' },
    4: { critType: 'Engine Hit', description: '½ Thrust (min 1 lost). Second hit = 0 Thrust, crash.', pipKey: 'engine' },
    5: { critType: 'Weapon Hit', description: '-1 Damage at all ranges (min 0).', pipKey: 'weapons' },
    6: { critType: 'No Critical Hit', description: 'No additional effect.', pipKey: null },
    7: { critType: 'No Critical Hit', description: 'No additional effect.', pipKey: null },
    8: { critType: 'No Critical Hit', description: 'No additional effect.', pipKey: null },
    9: { critType: 'Weapon Hit', description: '-1 Damage at all ranges (min 0).', pipKey: 'weapons' },
    10: { critType: 'Engine Hit', description: '½ Thrust (min 1 lost). Second hit = 0 Thrust, crash.', pipKey: 'engine' },
    11: { critType: 'Fire Control Hit', description: '+2 To-Hit modifier for weapon attacks.', pipKey: 'fire-control' },
    12: { critType: 'Crew Killed', description: 'The crew is killed. Unit is destroyed.', pipKey: null },
};

const CRIT_TABLE_JUMPSHIP: Record<number, CritTableEntry> = {
    2: { critType: 'Door Hit', description: 'Random cargo bay doors damaged. Units cannot enter/exit.', pipKey: null },
    3: { critType: 'Dock Hit', description: '-1 DT capacity. No DT# or reduced to 0 = cannot dock DropShips.', pipKey: null },
    4: { critType: 'Fire Control Hit', description: '+2 To-Hit modifier for weapon attacks.', pipKey: 'fire-control' },
    5: { critType: 'No Critical Hit', description: 'No additional effect.', pipKey: null },
    6: { critType: 'Weapon Hit', description: '-25% Damage in random arc/column.', pipKey: null, requiresArcRoll: true },
    7: { critType: 'Weapon Hit', description: '-25% Damage in random arc/column.', pipKey: null, requiresArcRoll: true },
    8: { critType: 'Thruster Hit', description: '-1 Thrust. If 0 Thrust, crash.', pipKey: 'thruster', maxHits: 1 },
    9: { critType: 'No Critical Hit', description: 'No additional effect.', pipKey: null },
    10: { critType: 'KF Drive Hit', description: 'This unit sustains damage to its KF drive (if any). JumpShips can sustain a number of KF Drive hits equal to the unit’s Size value; WarShips can sustain a number of KF Drive hits equal to twice the unit’s Size value. Once a JumpShip or WarShip suffers more KF Drive hits than it can sustain, the unit cannot execute a hyperspace jump. Otherwise, this critical hit has no effect in gameplay.', pipKey: null },
    11: { critType: 'Engine Hit', description: '-25%/-50%/-100% Thrust per hit. Third hit = crash.', pipKey: 'engine' },
    12: { critType: 'Crew Hit', description: '+2 Weapon To-Hit and +2 Control Roll. Second hit kills crew.', pipKey: 'crew' },
};

const CRIT_TABLE_DROPSHIP: Record<number, CritTableEntry> = {
    2: { critType: 'KF Boom Hit', description: 'Cannot be transported via JumpShip.', pipKey: 'kf-boom', maxHits: 1},
    3: { critType: 'Docking Collar Hit', description: 'Cannot dock with a JumpShip.', pipKey: 'dock-collar', maxHits: 1 },
    4: { critType: 'No Critical Hit', description: 'No additional effect.', pipKey: null },
    5: { critType: 'Fire Control Hit', description: '+2 To-Hit modifier for weapon attacks.', pipKey: 'fire-control' },
    6: { critType: 'Weapon Hit', description: '-25% Damage in random arc/column.', pipKey: null, requiresArcRoll: true },
    7: { critType: 'Thruster Hit', description: '-1 Thrust. If 0 Thrust, crash.', pipKey: 'thruster', maxHits: 1 },
    8: { critType: 'Weapon Hit', description: '-25% Damage in random arc/column.', pipKey: null, requiresArcRoll: true },
    9: { critType: 'Door Hit', description: 'Random cargo bay doors damaged. Units cannot enter/exit.', pipKey: null },
    10: { critType: 'No Critical Hit', description: 'No additional effect.', pipKey: null },
    11: { critType: 'Engine Hit', description: '-25%/-50%/-100% Thrust per hit. Third hit = crash.', pipKey: 'engine' },
    12: { critType: 'Crew Hit', description: '+2 Weapon To-Hit and +2 Control Roll. Second hit kills crew.', pipKey: 'crew' },
};

@Component({
    selector: 'critical-hit-roll-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DiceRollerComponent],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    <div class="content">
        <h2 dialog-title>CRITICAL HIT ROLL</h2>
        @if (unitDisplayName()) {
            <div class="unit-name alphastrike-text stroked colored">{{ unitDisplayName() }}</div>
        }
        <div dialog-content>
            <div class="dice-roller-container">
            <!-- 2D6 roll -->
            <dice-roller #mainRoller
                [diceCount]="2"
                [modifier]="rollModifier()"
                [rollDurationMs]="600"
                [freezeOnRollEnd]="500"
                (finished)="onMainRollFinished($event)"
            />
            </div>
            
            @if (result()) {
                <div class="result-container">
                    <div class="result-type" [class.no-crit]="result()!.critType === 'No Critical Hit'">
                        {{ result()!.critType }}
                    </div>
                    <div class="result-description">{{ result()!.description }}</div>
                    <!-- Arc roll for large vessel weapon hits -->
                    @if (currentEntry()?.requiresArcRoll && randomArc() && randomColumn()) {
                        <div class="arc-roll-section">
                            <div class="arc-result">
                                <span class="arc-label">{{ randomArc() }}</span>
                                <span class="column-label">{{ randomColumn() }}</span>
                            </div>
                        </div>
                    }
                </div>
                
            }
            
            <!-- Ammo hit mitigation message -->
            @if (ammoHitMitigation() === 'case') {
                <div class="mitigation-message case">
                    CASE reduces Ammo Hit to +1 damage.
                </div>
            } @else if (ammoHitMitigation() === 'immune') {
                <div class="mitigation-message immune">
                    CASEII/ENE negates Ammo Hit. No effect.
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
            @if (showAddDamage()) {
                <button (click)="addDamage()" class="bt-button warning">ADD 1 DAMAGE</button>
            } @else if (canApply()) {
                <button (click)="apply()" class="bt-button primary">APPLY</button>
            }
            <button (click)="reroll()" class="bt-button">REROLL</button>
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

            &.no-crit {
                color: #44ff44;
            }
        }

        .result-description {
            font-size: 1em;
            color: #ddd;
            line-height: 1.4;
        }

        .arc-result {
            margin-top: 12px;
            display: flex;
            justify-content: center;
            gap: 16px;
        }

        .arc-label, .column-label {
            font-size: 1.4em;
            font-weight: bold;
            color: #ffcc00;
            padding: 4px 12px;
            background: rgba(0, 0, 0, 0.3);
        }

        .mitigation-message {
            padding: 12px 16px;
            font-size: 1.1em;
            font-weight: bold;

            &.case {
                background: rgba(255, 200, 0, 0.2);
                border: 1px solid rgba(255, 200, 0, 0.5);
                color: #ffcc00;
            }

            &.immune {
                background: rgba(0, 200, 100, 0.2);
                border: 1px solid rgba(0, 200, 100, 0.5);
                color: #44ff88;
            }
        }

        .cannot-apply-warning {
            padding: 12px 16px;
            background: rgba(255, 100, 0, 0.2);
            border: 1px solid rgba(255, 100, 0, 0.5);
            color: #ffaa00;
            font-size: 0.95em;
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
export class CriticalHitRollDialogComponent implements AfterViewInit {
    private readonly dialogRef = inject(DialogRef);
    private readonly data = inject<CriticalHitRollDialogData>(DIALOG_DATA);
    private readonly optionsService = inject(OptionsService);

    private readonly mainRoller = viewChild<DiceRollerComponent>('mainRoller');

    private readonly critTable = this.getTableForUnitType(this.data.unitType);
    private readonly forceUnit = this.data.forceUnit;
    private readonly unitType = this.data.unitType;
    private readonly _hasCap = !dropshipOrSmallCraft(this.data.unitType);

    /** Available weapon columns based on unit type */
    private readonly weaponColumns = this._hasCap ? WEAPON_COLUMNS_WITH_CAP : WEAPON_COLUMNS_NO_CAP;

    readonly result = signal<CriticalHitResult | null>(null);
    readonly randomArc = signal<ArcLabel | null>(null);
    readonly randomColumn = signal<string | null>(null);
    readonly currentEntry = signal<CritTableEntry | null>(null);

    /** Modifier to the critical hit roll (e.g., -2 for CR special) */
    readonly rollModifier = computed(() => {
        if (!this.forceUnit) return 0;
        const specials = this.forceUnit.getUnit().as.specials;
        if (!specials) return 0;
        // CR (Critical-Resistant) special reduces crit roll by 2
        if (specials.includes('CR')) return -2;
        return 0;
    });

    /** Ammo hit mitigation status based on unit specials */
    readonly ammoHitMitigation = computed<'none' | 'case' | 'immune'>(() => {
        const res = this.result();
        if (!res || res.critType !== 'Ammo Hit' || !this.forceUnit) return 'none';

        const specials = this.forceUnit.getUnit().as.specials;
        if (!specials) return 'none';

        // CASEII or ENE = complete immunity
        if (specials.some(s => s === 'CASEII' || s === 'ENE')) return 'immune';

        // CASE = reduced to +1 damage
        if (specials.includes('CASE')) return 'case';

        return 'none';
    });

    /** Display name combining chassis, model, and optional alias */
    readonly unitDisplayName = computed(() => {
        if (!this.forceUnit) return null;
        const unit = this.forceUnit.getUnit();
        const chassisModel = `${unit.chassis} ${unit.model}`;
        const alias = this.forceUnit.alias();
        return alias ? `${chassisModel} (${alias})` : chassisModel;
    });

    /** Reason why the crit cannot be applied, or null if it can */
    readonly cannotApplyReason = computed(() => {
        const res = this.result();
        const entry = this.currentEntry();
        if (!res || !this.forceUnit || res.critType === 'No Critical Hit') return null;

        // For arc-based weapon hits, check if we have arc/column yet
        if (entry?.requiresArcRoll) {
            const arc = this.randomArc();
            const col = this.randomColumn();
            if (!arc || !col) return null; // Still rolling

            // Check if this arc/column is already maxed out (4 hits)
            const critKey = `${arc}-${col}`;
            const currentHits = this.forceUnit.getCommittedCritHits(critKey) +
                this.forceUnit.getState().getPendingCritChange(critKey);
            if (currentHits >= 4) {
                return `${arc} ${col} already at maximum crits (4 hits).`;
            }
            return null;
        }

        // For regular pip-based crits
        if (!res.pipKey) return null;

        // We evaluate each key if has any effect, if we already bottomed the affects stats then we cannot apply
        if (res.pipKey === 'mp' || res.pipKey === 'motive1' || res.pipKey === 'motive2' || res.pipKey === 'motive3') {
            const movement = this.forceUnit.previewMovementNoHeat();
            const entries = Object.entries(movement);
            if ((entries.length === 0) || (entries.every(([, inches]) => inches <= 0))) {
                return `Unit has no movement left to reduce.`;
            }
        } else if (res.pipKey === 'weapons') {
            // Check if all damage values are already at minimum
            if (this.forceUnit.isAllPreviewDamageAtMinimum()) {
                return `Unit has no weapons damage left to reduce.`;
            }
        }

        // for all others we just check max hits
        const maxHits = entry?.maxHits;
        if (maxHits) {
            const currentHits = this.forceUnit.getCommittedCritHits(res.pipKey) +
                this.forceUnit.getState().getPendingCritChange(res.pipKey);
            if (currentHits >= maxHits) {
                return `${res.critType} already at maximum (${maxHits} hit${maxHits > 1 ? 's' : ''}).`;
            }
        }


        return null;
    });

    /** Whether the current result can be applied (has a pip key and a force unit) */
    readonly canApply = computed(() => {
        const res = this.result();
        const entry = this.currentEntry();
        if (!res || !this.forceUnit) return false;
        if (res.critType === 'No Critical Hit') return false;
        if (this.cannotApplyReason()) return false;

        // For arc-based crits, need arc and column determined
        if (entry?.requiresArcRoll) {
            return !!this.randomArc() && !!this.randomColumn();
        }

        return !!res.pipKey;
    });

    /** Whether to show "ADD 1 DAMAGE" button instead of apply */
    readonly showAddDamage = computed(() => {
        // CASE mitigates Ammo Hit to +1 damage
        if (this.ammoHitMitigation() === 'case') return true;

        return !!this.cannotApplyReason() && !!this.forceUnit;
    });

    ngAfterViewInit(): void {
        // Auto-roll when dialog opens
        setTimeout(() => {
            this.mainRoller()?.roll();
        }, 100);
    }

    onMainRollFinished(event: { results: number[]; sum: number }): void {
        const roll = event.sum;
        
        // If unit type doesn't have a crit table, always return No Critical Hit
        if (!this.critTable) {
            this.currentEntry.set(null);
            this.result.set({
                roll,
                critType: 'No Critical Hit',
                description: 'This unit type does not take critical hits.',
                pipKey: null,
            });
            return;
        }

        // Rolls of 1 or less (possible with CR modifier) are not critical hits
        if (roll <= 1) {
            this.currentEntry.set(null);
            this.result.set({
                roll,
                critType: 'No Critical Hit',
                description: 'No additional effect.',
                pipKey: null,
            });
            return;
        }
        
        const entry = this.critTable[roll];
        if (entry) {
            // Check if this crit type has maxHits and is already at the limit
            if (entry.maxHits && entry.pipKey && this.forceUnit) {
                const currentHits = this.forceUnit.getCommittedCritHits(entry.pipKey) +
                    this.forceUnit.getState().getPendingCritChange(entry.pipKey);
                if (currentHits >= entry.maxHits) {
                    // Treat as No Critical Hit since this crit type is maxed out
                    this.currentEntry.set(null);
                    this.result.set({
                        roll,
                        critType: 'No Critical Hit',
                        description: `${entry.critType} already sustained. No additional effect.`,
                        pipKey: null,
                    });
                    return;
                }
            }

            this.currentEntry.set(entry);
            this.result.set({
                roll,
                critType: entry.critType,
                description: entry.description,
                pipKey: entry.pipKey,
            });

            // If this needs an arc roll, pick random arc and column
            if (entry.requiresArcRoll) {
                this.rollRandomArcAndColumn();
            }
        }
    }

    /** Randomly select arc and column for large vessel weapon hits */
    private rollRandomArcAndColumn(): void {
        const arcIndex = Math.floor(Math.random() * ARCS.length);
        this.randomArc.set(ARCS[arcIndex]);

        const colIndex = Math.floor(Math.random() * this.weaponColumns.length);
        this.randomColumn.set(this.weaponColumns[colIndex]);
    }

    reroll(): void {
        this.result.set(null);
        this.currentEntry.set(null);
        this.randomArc.set(null);
        this.randomColumn.set(null);
        this.mainRoller()?.roll();
    }

    /** Apply the critical hit by marking the appropriate pip */
    apply(): void {
        const res = this.result();
        const entry = this.currentEntry();
        if (!res || !this.forceUnit) return;

        let critKey: string;

        if (entry?.requiresArcRoll) {
            // For arc-based weapon hits
            const arc = this.randomArc();
            const col = this.randomColumn();
            if (!arc || !col) return;
            critKey = `${arc}-${col}`;
            res.randomArc = `${arc} ${col}`;
        } else if (res.pipKey) {
            critKey = res.pipKey;
        } else {
            return;
        }

        // Get current pending delta for this crit type
        const currentDelta = this.forceUnit.getState().getPendingCritChange(critKey);
        // Add one more hit
        this.forceUnit.setPendingCritHits(critKey, currentDelta + 1);

        // Close the dialog after applying
        this.dialogRef.close(res);
    }

    /** Add 1 damage when crit cannot be applied */
    addDamage(): void {
        const res = this.result();
        if (!res || !this.forceUnit) return;

        // Get current pending damage (armor + internal)
        const state = this.forceUnit.getState();
        const currentPending = state.pendingArmor() + state.pendingInternal();
        // Add 1 pending damage
        this.forceUnit.setPendingDamage(currentPending + 1);

        res.damageAdded = true;
        this.dialogRef.close(res);
    }

    close(): void {
        this.dialogRef.close(this.result());
    }

    /** Get the critical hit table for a unit type */
    private getTableForUnitType(unitType: ASUnitTypeCode): Record<number, CritTableEntry> | null {
        switch (unitType) {
            case 'BM':  // BattleMek
            case 'IM':  // IndustrialMek
                return CRIT_TABLE_MEK;
            case 'PM':  // ProtoMek
                return CRIT_TABLE_PROTOMEK;
            case 'CV':  // Combat Vehicle
            case 'SV':  // Support Vehicle
                return this.optionsService.options().ASVehiclesCriticalHitTable === 'scouringSands'
                    ? CRIT_TABLE_VEHICLE_SCOURING_SANDS
                    : CRIT_TABLE_VEHICLE;
            case 'AF':  // Aerospace Fighter
            case 'CF':  // Conventional Fighter
                return CRIT_TABLE_AEROSPACE;
            case 'WS':  // WarShip
            case 'SS':  // Space Station
            case 'JS':  // JumpShip
                return CRIT_TABLE_JUMPSHIP;
            case 'SC':  // Small Craft
            case 'DA':  // DropShip (Aerodyne)
            case 'DS':  // DropShip (Spheroid)
                return CRIT_TABLE_DROPSHIP;
            case 'BA':  // Battle Armor - no critical hits
            case 'CI':  // Conventional Infantry - no critical hits
            case 'MS':  // Mobile Structure - no critical hits
                return null;
            default:
                return null;
        }
    }
}
