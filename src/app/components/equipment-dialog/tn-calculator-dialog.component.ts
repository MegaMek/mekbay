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

import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { MoveType } from '../../models/units.model';
import type { InventoryControlRuntimeTarget, InventoryControlRuntimeTargetId } from '../../models/inventory-control-runtime-state.model';
import { HexSliderComponent } from '../hex-slider/hex-slider.component';
import {
    calculateTargetTnModifier,
    getIndirectFireModifier,
    getTargetMovementBracketModifier,
    TN_TARGET_MOVE_TYPE_OPTIONS,
    TN_TARGET_MOVEMENT_BRACKETS,
    TN_TARGET_UNIT_TYPE_OPTIONS,
    type TnAttackDirection,
    type TnInterveningWoods,
    type TnTargetHexCover,
    type TnTargetMovementBracketId,
    type TnTargetNumberCalculatorState,
    type TnTargetStance,
    type TnTargetUnitType,
    type TnSpotterMoveMode,
} from '../../models/target-number-calculator.model';

export interface TnCalculatorDialogData {
    target: InventoryControlRuntimeTarget;
}

export interface TnCalculatorDialogResult {
    targetId: InventoryControlRuntimeTargetId;
    patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>;
}

@Component({
    selector: 'tn-calculator-dialog',
    standalone: true,
    imports: [CommonModule, HexSliderComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'tn-calculator-host'
    },
    template: `
    <div class="tn-dialog glass framed-borders has-shadow" [class.ready]="renderReady()">
        <h2 class="tn-dialog-title"><span class="target-color-square" [style.background]="target.color">{{ target.letter }}</span><span>{{ target.name }}</span></h2>
        <div class="tn-dialog-body">
            <div class="tn-grid">
                <section class="tn-section">

                    <div class="section-title">Attack Method</div>
                    <div class="button-row">
                        <button type="button" class="bt-button move-button" [class.selected]="indirectFire()" [attr.aria-pressed]="indirectFire()" (click)="toggleIndirectFire()">
                            <span>Indirect Fire</span><span class="modifier-badge">+1</span>
                        </button>
                        <button type="button" class="bt-button move-button" [class.selected]="secondaryTarget()" [attr.aria-pressed]="secondaryTarget()" (click)="toggleSecondaryTarget()">
                            <span>Secondary Target</span><span class="modifier-badge">+1</span>
                        </button>
                    </div>
                    @if (indirectFire()) {
                    <div class="section-title secondary">Spotter</div>
                    <div class="spotter-section framed-borders muted-frame">
                        <div class="button-row spotter-move-row">
                            <button type="button" class="bt-button move-button" [class.selected]="spotterMoveMode() === 'stationary'" [attr.aria-pressed]="spotterMoveMode() === 'stationary'" (click)="selectSpotterMove('stationary')">
                                <svg width="16px" height="16px" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
                                    <path d="M32 2C15.432 2 2 15.432 2 32c-.001 16.568 13.432 30 30 30s30.001-13.432 30-30c.001-16.568-13.432-30-30-30zM9 38V26h46v12H9z" fill="currentColor"></path>
                                </svg>
                            </button>
                            <button type="button" class="bt-button move-button" [class.selected]="spotterMoveMode() === 'walk'" [attr.aria-pressed]="spotterMoveMode() === 'walk'" (click)="selectSpotterMove('walk')"><span>Walk</span><span class="modifier-badge">+1</span></button>
                            <button type="button" class="bt-button move-button" [class.selected]="spotterMoveMode() === 'run'" [attr.aria-pressed]="spotterMoveMode() === 'run'" (click)="selectSpotterMove('run')"><span>Run</span><span class="modifier-badge">+2</span></button>
                            <button type="button" class="bt-button move-button" [class.selected]="spotterMoveMode() === 'jump'" [attr.aria-pressed]="spotterMoveMode() === 'jump'" (click)="selectSpotterMove('jump')"><span>Jump</span><span class="modifier-badge">+3</span></button>
                        </div>
                        <div class="button-row">
                            <button type="button" class="bt-button move-button" [class.selected]="spotterDeclaredAttacks()" [attr.aria-pressed]="spotterDeclaredAttacks()" (click)="toggleSpotterDeclaredAttacks()">
                                <span>Declared Attacks</span><span class="modifier-badge">+1</span>
                            </button>
                        </div>
                    </div>
                    }
            </section>

                <section class="tn-section target-identity-section">
                    <div class="section-title">Target Identity</div>
                    <div class="field-row">
                        <label for="tnTargetUnitType">Unit type</label>
                        <select id="tnTargetUnitType" class="bt-select" [value]="unitType()" (change)="onUnitTypeChange($event)">
                            @for (option of unitTypeOptions; track option.value) {
                                <option [value]="option.value">{{ option.label }}</option>
                            }
                        </select>
                    </div>
                    <div class="field-row">
                        <label for="tnTargetMoveType">Move type</label>
                        <select id="tnTargetMoveType" class="bt-select" [value]="targetMoveType() ?? ''" (change)="onMoveTypeChange($event)">
                            @for (option of moveTypeOptions; track option.value) {
                                <option [value]="option.value">{{ option.label }}</option>
                            }
                        </select>
                    </div>
                </section>

                <section class="tn-section">
                    <div class="section-title">Target Movement</div>
                    <div class="row">
                        <hex-slider
                            class="tn-slider"
                            [min]="MOVEMENT_MIN"
                            [max]="MOVEMENT_MAX"
                            [step]="1"
                            [value]="targetMovementBracketIndex()"
                            [ticks]="movementTicks"
                            [tickLabels]="movementTickLabels"
                            [label]="targetMovementBracketLabel()"
                            [ariaLabel]="'Target movement bracket'"
                            [valueAssigned]="stance() === 'none'"
                            [compactLabel]="true"
                            (valueChange)="setTargetMovementBracketIndex($event)"></hex-slider>
                    </div>
                    <div class="button-row">
                        <button type="button" class="bt-button move-button" [class.selected]="jumped()" [attr.aria-pressed]="jumped()" (click)="toggleJumped()"><span>Jumped</span><span class="modifier-badge">+1</span></button>
                        <button type="button" class="bt-button move-button" [class.selected]="skidding()" [attr.aria-pressed]="skidding()" (click)="toggleSkidding()"><span>Skidding</span><span class="modifier-badge">+2</span></button>
                    </div>
                    <div class="button-row" role="group" aria-label="Target stance">
                        <button type="button" class="bt-button move-button" [class.selected]="stance() === 'prone'" [attr.aria-pressed]="stance() === 'prone'" (click)="selectStance('prone')"><span>{{ proneLabel() }}</span><span class="modifier-badge">{{ proneModifierLabel() }}</span></button>
                        <button type="button" class="bt-button move-button" [class.selected]="stance() === 'immobile'" [attr.aria-pressed]="stance() === 'immobile'" (click)="selectStance('immobile')"><span>Immobile</span><span class="modifier-badge">-4</span></button>
                    </div>
                </section>

                <section class="tn-section">
                    <div class="section-title">Other</div>
                    <div class="choice-line">
                        <span class="choice-label"><span>Cover</span>@if (targetHexCoverModifierLabel(); as modifierLabel) { <span class="modifier-badge">{{ modifierLabel }}</span> }</span>
                        <div class="icon-choice-row" role="group" aria-label="Target hex cover">
                            <button type="button" class="bt-button icon-choice none-choice" [class.selected]="targetHexCover() === 'none'" [attr.aria-pressed]="targetHexCover() === 'none'" (click)="selectTargetHexCover('none')">X</button>
                            <button type="button" class="bt-button icon-choice" [class.selected]="targetHexCover() === 'light'" [attr.aria-pressed]="targetHexCover() === 'light'" (click)="selectTargetHexCover('light')">
                                <svg viewBox="0 0 512 512" aria-hidden="true"><path d="M326.039,229.594c20.662,10.332,58.534-9.176,58.534-9.176C301.915,128.572,256.001,0,256.001,0s-45.916,128.572-128.573,220.418c0,0,37.872,19.509,58.538,9.176c0,0-20.666,79.215-113.64,183.691c82.642,22.948,144.634-14.936,144.634-14.936V512h78.083V398.348c0,0,61.992,37.884,144.634,14.936C346.701,308.809,326.039,229.594,326.039,229.594z"/></svg>
                            </button>
                            <button type="button" class="bt-button icon-choice double-tree" [class.selected]="targetHexCover() === 'heavy'" [attr.aria-pressed]="targetHexCover() === 'heavy'" (click)="selectTargetHexCover('heavy')">
                                    <svg viewBox="0 0 724 512" aria-hidden="true"><path d="M326.039,229.594c20.662,10.332,58.534-9.176,58.534-9.176C301.915,128.572,256.001,0,256.001,0s-45.916,128.572-128.573,220.418c0,0,37.872,19.509,58.538,9.176c0,0-20.666,79.215-113.64,183.691c82.642,22.948,144.634-14.936,144.634-14.936V512h78.083V398.348c0,0,61.992,37.884,144.634,14.936C346.701,308.809,326.039,229.594,326.039,229.594z"/><path transform="translate(212 0)" d="M326.039,229.594c20.662,10.332,58.534-9.176,58.534-9.176C301.915,128.572,256.001,0,256.001,0s-45.916,128.572-128.573,220.418c0,0,37.872,19.509,58.538,9.176c0,0-20.666,79.215-113.64,183.691c82.642,22.948,144.634-14.936,144.634-14.936V512h78.083V398.348c0,0,61.992,37.884,144.634,14.936C346.701,308.809,326.039,229.594,326.039,229.594z"/></svg>
                            </button>
                        </div>
                        <span class="choice-caption"><span>{{ targetHexCoverCaption() }}</span></span>
                    </div>
                    
                    @if (indirectFire()) {
                    <div class="section-title secondary">From the Spotter line of sight</div>
                    }
                    <div class="terrain-group" [class.framed-borders]="indirectFire()" [class.muted-frame]="indirectFire()">
                        <div class="choice-line">
                            <span class="choice-label"><span>Intervening</span>@if (woodsModifierLabel(); as modifierLabel) { <span class="modifier-badge">{{ modifierLabel }}</span> }</span>
                            <div class="icon-choice-row" role="group" aria-label="Intervening woods">
                                <button type="button" class="bt-button icon-choice none-choice" [class.selected]="interveningWoods() === 'none'" [attr.aria-pressed]="interveningWoods() === 'none'" (click)="selectInterveningWoods('none')">X</button>
                                <button type="button" class="bt-button icon-choice" [class.selected]="interveningWoods() === 'light1'" [attr.aria-pressed]="interveningWoods() === 'light1'" (click)="selectInterveningWoods('light1')">
                                    <svg viewBox="0 0 512 512" aria-hidden="true"><path d="M326.039,229.594c20.662,10.332,58.534-9.176,58.534-9.176C301.915,128.572,256.001,0,256.001,0s-45.916,128.572-128.573,220.418c0,0,37.872,19.509,58.538,9.176c0,0-20.666,79.215-113.64,183.691c82.642,22.948,144.634-14.936,144.634-14.936V512h78.083V398.348c0,0,61.992,37.884,144.634,14.936C346.701,308.809,326.039,229.594,326.039,229.594z"/></svg>
                                </button>
                                <button type="button" class="bt-button icon-choice double-tree" [class.selected]="interveningWoods() === 'light2'" [attr.aria-pressed]="interveningWoods() === 'light2'" (click)="selectInterveningWoods('light2')">
                                    <svg viewBox="0 0 724 512" aria-hidden="true"><path d="M326.039,229.594c20.662,10.332,58.534-9.176,58.534-9.176C301.915,128.572,256.001,0,256.001,0s-45.916,128.572-128.573,220.418c0,0,37.872,19.509,58.538,9.176c0,0-20.666,79.215-113.64,183.691c82.642,22.948,144.634-14.936,144.634-14.936V512h78.083V398.348c0,0,61.992,37.884,144.634,14.936C346.701,308.809,326.039,229.594,326.039,229.594z"/><path transform="translate(212 0)" d="M326.039,229.594c20.662,10.332,58.534-9.176,58.534-9.176C301.915,128.572,256.001,0,256.001,0s-45.916,128.572-128.573,220.418c0,0,37.872,19.509,58.538,9.176c0,0-20.666,79.215-113.64,183.691c82.642,22.948,144.634-14.936,144.634-14.936V512h78.083V398.348c0,0,61.992,37.884,144.634,14.936C346.701,308.809,326.039,229.594,326.039,229.594z"/></svg>
                                </button>
                            </div>
                            <span class="choice-caption woods-caption">
                                @if (interveningWoods() === 'light2') {
                                    <span>2 Light Woods or</span>
                                    <span>1 Heavy Wood</span>
                                } @else {
                                    <span>{{ woodsCaption() }}</span>
                                }
                            </span>
                        </div>
                        <div class="button-row">
                        <button type="button" class="bt-button move-button partial-cover" [class.selected]="partialCover()" [attr.aria-pressed]="partialCover()" [disabled]="partialCoverDisabled()" (click)="togglePartialCover()"><span>Partial Cover</span><span class="modifier-badge">+1</span></button>
                        </div>
                    </div>

                </section>

                <section class="tn-section">
                    <div class="section-title">Range</div>
                    <div class="row">
                        <hex-slider
                            class="tn-slider"
                            [min]="RANGE_MIN"
                            [max]="RANGE_MAX"
                            [step]="1"
                            [value]="range()"
                            [ticks]="rangeTicks"
                            [label]="rangeLabel()"
                            [ariaLabel]="'Range'"
                            [valueAssigned]="true"
                            (valueChange)="setRangeValue($event)"></hex-slider>
                    </div>
                </section>

            </div>
        </div>
        <div class="tn-actions">
            <div class="total-box">Target TN Modifier: <strong>{{ signedTotal() }}</strong></div>
            <button class="bt-button primary" type="button" (click)="apply()">APPLY</button>
            <button class="bt-button" type="button" (click)="close()">CANCEL</button>
        </div>
    </div>
    `,
    styles: [`
        :host {
            display: block;
            pointer-events: auto;
        }

        .tn-dialog {
            pointer-events: auto;
            width: min(800px, calc(100dvw - 20px));
            max-height: min(86dvh, 720px);
            display: flex;
            flex-direction: column;
            padding: 0;
            overflow: hidden;
            box-sizing: border-box;
        }

        .tn-dialog-title {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            font-weight: bold;
            text-align: center;
            padding: 8px 12px;
            font-size: 0.82em;
            line-height: 1.2;
            margin: 0;
            border-bottom: 1px solid var(--border-color);
            text-transform: uppercase;
        }

        .target-color-square {
            inline-size: 16px;
            block-size: 16px;
            flex: 0 0 16px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--border-color);
            color: #000;
            font-size: 0.7rem;
            font-weight: 800;
            line-height: 1;
            box-sizing: border-box;
        }

        .tn-dialog-body {
            overflow: auto;
            min-height: 0;
            padding: 8px;
        }

        .tn-dialog:not(.ready) .bt-button,
        .tn-dialog:not(.ready) .modifier-badge {
            transition: none;
        }

        .tn-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            column-gap: 24px;
            row-gap: 8px;
            align-items: start;
            position: relative;
        }

        .tn-grid::before {
            content: '';
            position: absolute;
            inset-block: 0;
            inset-inline-start: 50%;
            width: 1px;
            transform: translateX(-50%);
            background: var(--border-color);
            opacity: 0.7;
            pointer-events: none;
        }

        .tn-section {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
            width: 100%;
        }

        .section-title {
            color: var(--text-color);
            text-align: center;
            font-weight: 500;
            font-size: 0.9em;
            letter-spacing: 0;
            padding: 4px;

            &.secondary {
                font-size: 0.8em;
            }
        }

        .row {
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
            gap: 4px;
            min-width: 0;
            text-wrap: nowrap;
        }

        .button-row {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 4px;
            min-width: 0;
        }

        .button-row .bt-button {
            flex: 1 1 0;
            min-width: 0;
            box-sizing: border-box;
        }

        .spotter-move-row {
            flex-wrap: wrap;
        }

        .terrain-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .terrain-group.framed-borders {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 8px;
            background-color: rgba(0, 0, 0, 0.2);
        }

        .tn-slider {
            --hex-slider-track-height: 12px;
            --hex-slider-track-overhang: 14px;

            flex: 1 1 auto;
            min-width: 0;
            margin-top: -8px;
        }

        .modifier {
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            border: 1px solid var(--border-color);
            background: rgba(0, 0, 0, 0.7);
            padding: 2px 4px;
            min-width: 32px;
            min-height: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .modifier.important {
            font-size: 1.1em;
            min-height: 28px;
        }

        .modifier-badge {
            flex: 0 0 24px;
            inline-size: 24px;
            block-size: 24px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--border-color);
            background: rgba(0, 0, 0, 0.6);
            color: var(--text-color);
            font-weight: 600;
            font-size: 0.78em;
            font-variant-numeric: tabular-nums;
            line-height: 1;
            box-sizing: border-box;
            transition: border 0.2s ease-in-out, background 0.2s ease-in-out, color 0.2s ease-in-out;
        }

        .bt-button.move-button {
            pointer-events: auto;
            cursor: pointer;
            outline: none;
            padding: 2px;
            text-align: center;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            min-height: 30px;
            flex-direction: row;
            flex-grow: 1;
            box-sizing: border-box;
        }

        .bt-button.move-button.selected .modifier-badge {
            background-color: #000;
        }

        .bt-button.move-button:disabled {
            cursor: not-allowed;
            opacity: 0.45;
        }

        .spotter-section {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 8px;
            background-color: rgba(0, 0, 0, 0.2);
        }

        .field-row,
        .choice-line {
            display: flex;
            align-items: center;
            gap: 4px;
            min-width: 0;
        }

        .field-row label,
        .choice-label {
            flex: 0 0 96px;
            color: var(--text-color-secondary);
            font-size: 0.8rem;
            font-weight: 500;
        }

        .choice-label {
            display: inline-flex;
            align-items: center;
            justify-content: space-between;
            gap: 4px;
        }

        .field-row .bt-select {
            flex: 1 1 auto;
            min-width: 0;
        }

        .toggle-button.selected,
        .segment-button.selected {
            background: var(--selection-bg, #555);
            color: var(--text-color);
            box-shadow: inset 0 0 0 2px var(--accent-color, #f6e77b);
        }

        .segmented-row,
        .icon-choice-row {
            display: flex;
            flex-wrap: nowrap;
            gap: 4px;
        }

        .toggle-button,
        .segment-button {
            border: 1px solid var(--border-color);
            background: var(--button-bg);
            color: var(--text-color-secondary);
            min-height: 28px;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 0.78rem;
        }

        .toggle-button:disabled {
            cursor: not-allowed;
            opacity: 0.45;
        }

        .segment-button {
            flex: 1 1 104px;
        }

        .icon-choice {
            inline-size: 36px;
            block-size: 32px;
            padding: 3px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0;
        }

        .none-choice {
            font-size: 1rem;
        }

        .icon-choice svg {
            inline-size: 20px;
            block-size: 20px;
            fill: currentColor;
        }

        .double-tree svg {
            inline-size: 28px;
            margin-inline: 0;
        }

        .choice-caption {
            flex: 1 1 auto;
            margin-left: auto;
            color: var(--text-color-secondary);
            font-size: 0.78rem;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .woods-caption {
            flex-direction: column;
            align-items: flex-start;
            gap: 0;
            line-height: 1.1;
        }

        .partial-cover {
            align-self: flex-start;
        }

        .tn-actions {
            display: flex;
            align-items: center;
            gap: 6px;
            border-top: 1px solid var(--border-color);
            padding: 8px;

            .bt-button {
                width: 100px;
            }
        }

        .total-box {
            margin-right: auto;
            font-weight: 500;
            color: var(--text-color-secondary);
        }

        .total-box strong {
            color: var(--text-color);
            font-size: 1.05rem;
        }

        @media (max-width: 1000px) {
            .tn-dialog {
                width: min(400px, calc(100dvw - 8px));
                max-height: calc(100dvh - 8px);
            }

            .tn-grid {
                grid-template-columns: minmax(0, 1fr);
                row-gap: 8px;
                column-gap: 8px;
            }

            .tn-grid::before {
                content: none;
            }

            .field-row {
                align-items: stretch;
                flex-direction: column;
            }

            .field-row label {
                flex: 0 0 auto;
            }

            .target-identity-section {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 2px 6px;
            }

            .target-identity-section .section-title {
                grid-column: 1 / -1;
            }

            .total-box {
                width: 100%;
            }
        }

        @media (max-width: 400px) {
            :host {
                width: 100dvw;
                max-height: 100dvh;
            }

            .tn-dialog {
                width: calc(100dvw - 8px);
                max-height: calc(100dvh - 8px);
                margin: 4px;
                box-sizing: border-box;
            }
        }
    `]
})
export class TnCalculatorDialogComponent {
    readonly MOVEMENT_MIN = 0;
    readonly MOVEMENT_MAX = TN_TARGET_MOVEMENT_BRACKETS.length - 1;
    readonly RANGE_MIN = 0;
    readonly RANGE_MAX = 25;
    private readonly dialogRef = inject(DialogRef<TnCalculatorDialogResult | null>);
    private readonly data = inject<TnCalculatorDialogData>(DIALOG_DATA);
    private readonly initialCalculator = this.data.target.tnCalculator;
    private readonly initialUnitType = this.data.target.unitType ?? 'mek-biped';

    readonly target = this.data.target;
    readonly unitTypeOptions = TN_TARGET_UNIT_TYPE_OPTIONS;
    readonly moveTypeOptions = TN_TARGET_MOVE_TYPE_OPTIONS;
    readonly movementBrackets = TN_TARGET_MOVEMENT_BRACKETS;
    readonly movementTicks = this.movementBrackets.map((_bracket, index) => index);
    readonly movementTickLabels = this.movementBrackets.map(bracket => bracket.label);
    readonly rangeTicks = Array.from({ length: this.RANGE_MAX - this.RANGE_MIN + 1 }, (_value, index) => index + this.RANGE_MIN);

    readonly unitType = signal<TnTargetUnitType>(this.initialUnitType);
    readonly targetMoveType = signal<MoveType | null>(this.normalizeTargetMoveType(this.initialCalculator?.targetMoveType));
    readonly targetMovementBracketIndex = signal<number>(this.indexFromStoredMovementBracket());
    readonly jumped = signal<boolean>(this.initialCalculator?.jumped ?? false);
    readonly skidding = signal<boolean>(this.initialCalculator?.skidding ?? false);
    readonly stance = signal<TnTargetStance>(this.initialCalculator?.stance ?? 'none');
    readonly interveningWoods = signal<TnInterveningWoods>(this.normalizeInterveningWoods(this.initialCalculator?.interveningWoods as TnInterveningWoods | 'heavy1' | null | undefined));
    readonly targetHexCover = signal<TnTargetHexCover>(this.initialCalculator?.targetHexCover ?? 'none');
    readonly range = signal<number>(Math.max(0, this.data.target.distance ?? 0));
    readonly partialCover = signal<boolean>((this.initialCalculator?.partialCover ?? false) && this.range() > 0);
    readonly attackDirection = signal<TnAttackDirection>(this.initialCalculator?.attackDirection ?? 'front');
    readonly indirectFire = signal<boolean>(this.initialCalculator?.indirectFire ?? false);
    readonly secondaryTarget = signal<boolean>(this.initialCalculator?.secondaryTarget ?? false);
    readonly spotterMoveMode = signal<TnSpotterMoveMode>(this.initialCalculator?.spotterMoveMode ?? 'stationary');
    readonly spotterDeclaredAttacks = signal<boolean>(this.initialCalculator?.spotterDeclaredAttacks ?? false);
    readonly renderReady = signal(false);

    readonly partialCoverDisabled = computed(() => this.range() <= 0);
    readonly proneLabel = computed(() => this.range() <= 0 ? 'Prone (Adjacent)' : 'Prone');
    readonly proneModifierLabel = computed(() => this.range() <= 0 ? '-2' : '+1');
    readonly targetMovementBracket = computed(() => this.movementBrackets[this.targetMovementBracketIndex()] ?? this.movementBrackets[0]);
    readonly targetMovementBracketLabel = computed(() => this.targetMovementBracket().label);
    readonly targetMovementModifier = computed(() => this.stance() === 'none' ? getTargetMovementBracketModifier(this.targetMovementBracket().id) : 0);
    readonly rangeLabel = computed(() => `${this.range()}`);
    readonly indirectFireModifier = computed(() => getIndirectFireModifier(this.indirectFire(), this.spotterMoveMode(), this.spotterDeclaredAttacks()));
    readonly totalModifier = computed(() => calculateTargetTnModifier({
        unitType: this.unitType(),
        range: this.range(),
        targetMoveType: this.targetMoveType(),
        targetMovementBracket: this.stance() === 'none' ? this.targetMovementBracket().id : null,
        jumped: this.jumped(),
        skidding: this.skidding(),
        stance: this.stance(),
        interveningWoods: this.interveningWoods(),
        targetHexCover: this.targetHexCover(),
        partialCover: this.partialCover(),
        attackDirection: this.attackDirection(),
        indirectFire: this.indirectFire(),
        secondaryTarget: this.secondaryTarget(),
        spotterMoveMode: this.spotterMoveMode(),
        spotterDeclaredAttacks: this.spotterDeclaredAttacks(),
    }));
    readonly signedTotal = computed(() => this.totalModifier() >= 0 ? `+${this.totalModifier()}` : `${this.totalModifier()}`);
    readonly woodsCaption = computed(() => {
        switch (this.interveningWoods()) {
            case 'light1': return '1 Light Wood';
            case 'light2': return '2 Light Woods or 1 Heavy Wood';
            default: return 'No woods';
        }
    });
    readonly woodsModifierLabel = computed(() => {
        switch (this.interveningWoods()) {
            case 'light1': return '+1';
            case 'light2': return '+2';
            default: return null;
        }
    });
    readonly targetHexCoverCaption = computed(() => {
        switch (this.targetHexCover()) {
            case 'light': return 'Light Wood';
            case 'heavy': return 'Heavy Wood';
            default: return 'No cover';
        }
    });
    readonly targetHexCoverModifierLabel = computed(() => {
        switch (this.targetHexCover()) {
            case 'light': return '+1';
            case 'heavy': return '+2';
            default: return null;
        }
    });

    constructor() {
        afterNextRender(() => this.renderReady.set(true));

        if (this.stance() !== 'none') {
            this.jumped.set(false);
            this.skidding.set(false);
        }
    }

    onUnitTypeChange(event: Event): void {
        this.unitType.set((event.target as HTMLSelectElement).value as TnTargetUnitType);
    }

    onMoveTypeChange(event: Event): void {
        const value = (event.target as HTMLSelectElement).value as MoveType | '';
        this.targetMoveType.set(value === '' ? null : value);
    }

    private normalizeTargetMoveType(value: MoveType | null | undefined): MoveType | null {
        return value === 'VTOL' || value === 'WiGE' ? value : null;
    }

    private normalizeInterveningWoods(value: TnInterveningWoods | 'heavy1' | null | undefined): TnInterveningWoods {
        return value === 'heavy1' ? 'light2' : value ?? 'none';
    }

    setTargetMovementBracketIndex(value: number): void {
        this.targetMovementBracketIndex.set(this.alignToStep(value, this.MOVEMENT_MIN, this.MOVEMENT_MAX));
        this.clearStanceForMovement();
    }

    toggleJumped(): void {
        this.jumped.set(!this.jumped());
        this.clearStanceForMovement();
    }

    toggleSkidding(): void {
        this.skidding.set(!this.skidding());
        this.clearStanceForMovement();
    }

    selectStance(stance: TnTargetStance): void {
        const next = this.stance() === stance ? 'none' : stance;
        this.stance.set(next);
        if (next !== 'none') {
            this.jumped.set(false);
            this.skidding.set(false);
        }
        if (next === 'prone') {
            this.partialCover.set(false);
        }
    }

    selectInterveningWoods(woods: TnInterveningWoods): void {
        this.interveningWoods.set(woods);
    }

    selectTargetHexCover(cover: TnTargetHexCover): void {
        this.targetHexCover.set(cover);
    }

    togglePartialCover(): void {
        if (this.partialCoverDisabled()) {
            this.partialCover.set(false);
            return;
        }
        const next = !this.partialCover();
        this.partialCover.set(next);
        if (next && this.stance() === 'prone') {
            this.stance.set('none');
        }
    }

    toggleIndirectFire(): void {
        const next = !this.indirectFire();
        this.indirectFire.set(next);
        if (!next) {
            this.spotterMoveMode.set('stationary');
            this.spotterDeclaredAttacks.set(false);
        }
    }

    toggleSecondaryTarget(): void {
        this.secondaryTarget.set(!this.secondaryTarget());
    }

    selectSpotterMove(mode: TnSpotterMoveMode): void {
        this.spotterMoveMode.set(mode);
    }

    toggleSpotterDeclaredAttacks(): void {
        this.spotterDeclaredAttacks.set(!this.spotterDeclaredAttacks());
    }

    onRangeInput(event: Event): void {
        const el = event.target as HTMLInputElement;
        this.setRangeValue(Number(el.value || 0));
    }

    apply(): void {
        const state: TnTargetNumberCalculatorState = {
            targetMoveType: this.targetMoveType(),
            targetMovementBracket: this.stance() === 'none' ? this.targetMovementBracket().id : null,
            jumped: this.jumped(),
            skidding: this.skidding(),
            stance: this.stance(),
            interveningWoods: this.interveningWoods(),
            targetHexCover: this.targetHexCover(),
            partialCover: this.partialCover() && !this.partialCoverDisabled(),
            attackDirection: this.attackDirection(),
            indirectFire: this.indirectFire(),
            secondaryTarget: this.secondaryTarget(),
            spotterMoveMode: this.indirectFire() ? this.spotterMoveMode() : 'stationary',
            spotterDeclaredAttacks: this.indirectFire() && this.spotterDeclaredAttacks(),
        };
        this.dialogRef.close({
            targetId: this.target.id,
            patch: {
                unitType: this.unitType(),
                distance: this.range(),
                tnModifier: this.totalModifier(),
                tnCalculator: state,
            }
        });
    }

    close(): void {
        this.dialogRef.close(null);
    }

    setRangeValue(value: number): void {
        const next = this.alignToStep(value, this.RANGE_MIN, this.RANGE_MAX);
        this.range.set(next);
        if (next <= 0) {
            this.partialCover.set(false);
        }
    }

    private clearStanceForMovement(): void {
        if (this.stance() !== 'none') {
            this.stance.set('none');
        }
    }

    private indexFromStoredMovementBracket(): number {
        const bracketId = this.initialCalculator?.targetMovementBracket;
        if (!bracketId) return 0;
        const index = this.movementBrackets.findIndex(bracket => bracket.id === bracketId);
        return index >= 0 ? index : 0;
    }

    private alignToStep(value: number, min: number, max: number): number {
        const stepped = Math.round(value / 1);
        return Math.max(min, Math.min(max, Number.isFinite(stepped) ? stepped : min));
    }

    private formatModifier(value: number): string {
        return value >= 0 ? `+${value}` : `${value}`;
    }
}