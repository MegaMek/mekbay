// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { InventoryControlRuntimeTarget, InventoryControlRuntimeTargetId } from '../../models/inventory-control-runtime-state.model';
import { HexSliderComponent } from '../hex-slider/hex-slider.component';
import { MultilineDropdownComponent, type MultilineDropdownOption } from '../multiline-dropdown/multiline-dropdown.component';
import { CoverLevelPickerComponent } from '../cover-level-picker/cover-level-picker.component';
import {
    calculateTargetTnModifier,
    getIndirectFireModifier,
    getTargetMovementBracketModifier,
    getTargetUnitTypeModifier,
    isStaticTargetType,
    isTerrainTargetType,
    resolveTnTargetBuildingCoverState,
    resolveTnTargetWaterState,
    TN_TARGET_MOVEMENT_BRACKETS,
    TN_TARGET_UNIT_TYPE_OPTIONS,
    ADJACENT_RANGE,
    type TnAttackDirection,
    type TnInterveningWoods,
    type TnTargetHexCover,
    type TnTargetNumberCalculatorState,
    type TnTargetUnitType,
    type TnSpotterMoveMode,
} from '../../models/target-number-calculator.model';
import { getUnitConditionDefinition } from '../../models/rules/unit-type-rules';
import type { CBTGameRules } from '../../models/rules/game-rules';
import {
    isUnitBuildingLevel,
    isUnitWaterDepth,
    unitBuildingLevelNumber,
    unitWaterDepthNumber,
    type UnitBuildingLevel,
    type UnitWaterDepth,
} from '../../models/unit-cover.model';

const JAMMED_CONDITION_COLOR = getUnitConditionDefinition('jammed')?.color ?? '#ff6be6';
export interface TnCalculatorDialogData {
    target: InventoryControlRuntimeTarget;
    gameRules: CBTGameRules;
    targetStateReadOnly?: boolean;
    showC3Distance?: boolean;
    c3Degraded?: boolean;
    indirectFireBaseModifier?: number;
    indirectFireAvailable?: boolean;
}

export interface TnCalculatorDialogResult {
    targetId: InventoryControlRuntimeTargetId;
    patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>;
}

@Component({
    selector: 'tn-calculator-dialog',
    standalone: true,
    imports: [CommonModule, HexSliderComponent, MultilineDropdownComponent, CoverLevelPickerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'tn-calculator-host',
        '[style.--jammed-condition-color]': 'jammedConditionColor'
    },
    template: `
    <div class="tn-dialog glass framed-borders has-shadow" [class.ready]="renderReady()">
        <h2 class="tn-dialog-title"><span class="target-color-square" [style.background]="target.color">{{ target.letter }}</span><span>{{ target.name }}</span></h2>
        <div class="tn-dialog-body">
            <div class="tn-grid">
                <div class="tn-column">
                    <section class="tn-section attack-method-section">

                        <div class="section-title">Attack Method</div>
                        <div class="button-row">
                            <button type="button" class="bt-button move-button" [class.selected]="secondaryTarget()" [attr.aria-pressed]="secondaryTarget()" (click)="toggleSecondaryTarget()">
                                <span>Secondary Target</span><span class="modifier-badge">+1</span>
                            </button>
                            @if (gameRules().supportsSecondaryTargetSideBack) {
                                <button type="button" class="bt-button move-button" [class.selected]="secondaryTargetSideBack()" [attr.aria-pressed]="secondaryTargetSideBack()" (click)="toggleSecondaryTargetSideBack()">
                                    <span>Secondary (Side/Back)</span><span class="modifier-badge">+2</span>
                                </button>
                            } @else if (gameRules().supportsLargeTarget) {
                                <button type="button" class="bt-button move-button" [class.selected]="largeTarget()" [attr.aria-pressed]="largeTarget()" [disabled]="targetStateReadOnly" (click)="toggleLargeTarget()">
                                    <span>Large Target</span><span class="modifier-badge">-1</span>
                                </button>
                            }
                        </div>
                        @if (indirectFireAvailable) {
                            <div class="button-row">
                                <button type="button" class="bt-button move-button" [class.selected]="indirectFire()" [attr.aria-pressed]="indirectFire()" (click)="toggleIndirectFire()">
                                    <span>Indirect Fire</span>@if (indirectFireModifierLabel(); as modifierLabel) { <span class="modifier-badge">{{ modifierLabel }}</span> }
                                </button>
                            </div>
                            @if (indirectFire()) {
                                <div class="spotter-section framed-borders muted-frame">
                                    <div class="section-title secondary">Spotter</div>
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
                        }
                    </section>

                    <section class="tn-section target-movement-section" [class.derived-target-state]="targetStateReadOnly">
                        <div class="section-title">Target Movement</div>
                        <div class="row" [class.static-target-disabled]="staticTarget()">
                            <hex-slider
                                class="tn-slider"
                                [min]="MOVEMENT_MIN"
                                [max]="MOVEMENT_MAX"
                                [step]="1"
                                [value]="targetMovementBracketIndex()"
                                [ticks]="movementTicks"
                                [tickLabels]="movementTickLabels"
                                [label]="targetMovementBracketLabel()"
                                [modifierLabel]="targetMovementModifierLabel()"
                                [ariaLabel]="'Target movement bracket'"
                                [valueAssigned]="!staticTarget()"
                                [compactLabel]="true"
                                (valueChange)="setTargetMovementBracketIndex($event)"></hex-slider>
                        </div>
                        <div class="button-row">
                            <button type="button" class="bt-button move-button" [class.selected]="isAirborne()" [attr.aria-pressed]="isAirborne()" [disabled]="staticTarget() || targetStateReadOnly" (click)="toggleAirborne()"><span>Jumped / Airborne</span><span class="modifier-badge">+1</span></button>
                            @if (gameRules().supportsSkidding) {
                                <button type="button" class="bt-button move-button" [class.selected]="skidding()" [attr.aria-pressed]="skidding()" [disabled]="staticTarget() || targetStateReadOnly" (click)="toggleSkidding()"><span>Skidding</span><span class="modifier-badge">+2</span></button>
                            }
                        </div>
                        <div class="button-row" role="group" aria-label="Target stance">
                            <button type="button" class="bt-button move-button" [class.selected]="prone()" [attr.aria-pressed]="prone()" [disabled]="staticTarget() || targetStateReadOnly" (click)="toggleProne()"><span>{{ proneLabel() }}</span><span class="modifier-badge">{{ proneModifierLabel() }}</span></button>
                            <button type="button" class="bt-button move-button" [class.selected]="immobile()" [attr.aria-pressed]="immobile()" [disabled]="staticTarget() || targetStateReadOnly" (click)="toggleImmobile()"><span>Immobile</span><span class="modifier-badge">-4</span></button>
                        </div>
                    </section>

                    <section class="tn-section distance-section">
                        <div class="section-title">Distance</div>
                        <div class="row">
                            <hex-slider
                                class="tn-slider"
                                [min]="RANGE_MIN"
                                [max]="RANGE_MAX"
                                [step]="1"
                                [value]="range()"
                                [ticks]="rangeTicks"
                                [label]="rangeLabel()"
                                [ariaLabel]="'Distance'"
                                [valueAssigned]="true"
                                (valueChange)="setRangeValue($event)"></hex-slider>
                        </div>
                        @if (showC3Distance()) {
                            <div class="c3-distance-control" [class.c3-degraded]="c3Degraded()">
                            <div class="section-title secondary c3-distance-title">
                                <label class="use-c3-toggle" [class.disabled-field]="c3BlockedByIndirectFire()">
                                    <input type="checkbox" class="bt-checkbox" [checked]="useC3()" [disabled]="c3BlockedByIndirectFire()" (change)="setUseC3($event)">
                                    <span>C³ Distance@if (c3Degraded()) { <strong class="c3-status-label"> ({{ gameRules().c3DegradationLabel }})</strong> }</span>
                                </label>
                            </div>
                            <div class="row" [class.c3-distance-disabled]="!c3Enabled()">
                                <hex-slider
                                    class="tn-slider"
                                    [min]="RANGE_MIN"
                                    [max]="RANGE_MAX"
                                    [step]="1"
                                    [value]="c3Distance()"
                                    [ticks]="rangeTicks"
                                    [label]="c3DistanceLabel()"
                                    [ariaLabel]="'C³ Range'"
                                    [valueAssigned]="c3Enabled()"
                                    (valueChange)="setC3DistanceValue($event)"></hex-slider>
                            </div>
                            </div>
                        }
                    </section>
                </div>

                <div class="tn-column">
                    <section class="tn-section target-identity-section">
                        <div class="section-title">Target Identity</div>
                        <div class="field-row">
                            <label for="tnTargetUnitType">Target Type</label>
                            <multiline-dropdown
                                class="bt-button identity-choice"
                                [class.selected]="unitTypeSelectedHasModifier()"
                                [class.derived-target-control]="targetStateReadOnly"
                                controlId="tnTargetUnitType"
                                [label]="'Target Type'"
                                [options]="unitTypeDropdownOptions()"
                                [value]="unitType()"
                                [disabled]="targetStateReadOnly"
                                (valueChange)="selectUnitType($event)" />
                        </div>
                    </section>

                    <section class="tn-section other-section">
                        <div class="section-title">Other</div>
                        <div class="choice-line" [class.derived-target-state]="targetStateReadOnly">
                            <span class="choice-label"><span>Cover</span>@if (targetHexCoverModifierLabel(); as modifierLabel) { <span class="modifier-badge">{{ modifierLabel }}</span> }</span>
                            <div class="icon-choice-row cover-choice-row" role="group" aria-label="Target hex cover">
                                <button type="button" class="bt-button icon-choice" aria-label="Light cover" [class.selected]="targetHexCover() === 'light'" [attr.aria-pressed]="targetHexCover() === 'light'" [disabled]="terrainTarget() || targetStateReadOnly" (click)="selectTargetHexCover('light')">
                                    <svg viewBox="0 0 512 512" aria-hidden="true"><path d="M326.039,229.594c20.662,10.332,58.534-9.176,58.534-9.176C301.915,128.572,256.001,0,256.001,0s-45.916,128.572-128.573,220.418c0,0,37.872,19.509,58.538,9.176c0,0-20.666,79.215-113.64,183.691c82.642,22.948,144.634-14.936,144.634-14.936V512h78.083V398.348c0,0,61.992,37.884,144.634,14.936C346.701,308.809,326.039,229.594,326.039,229.594z"/></svg>
                                </button>
                                <button type="button" class="bt-button icon-choice double-tree" aria-label="Heavy cover" [class.selected]="targetHexCover() === 'heavy'" [attr.aria-pressed]="targetHexCover() === 'heavy'" [disabled]="terrainTarget() || targetStateReadOnly" (click)="selectTargetHexCover('heavy')">
                                        <svg viewBox="0 0 724 512" aria-hidden="true"><path d="M326.039,229.594c20.662,10.332,58.534-9.176,58.534-9.176C301.915,128.572,256.001,0,256.001,0s-45.916,128.572-128.573,220.418c0,0,37.872,19.509,58.538,9.176c0,0-20.666,79.215-113.64,183.691c82.642,22.948,144.634-14.936,144.634-14.936V512h78.083V398.348c0,0,61.992,37.884,144.634,14.936C346.701,308.809,326.039,229.594,326.039,229.594z"/><path transform="translate(212 0)" d="M326.039,229.594c20.662,10.332,58.534-9.176,58.534-9.176C301.915,128.572,256.001,0,256.001,0s-45.916,128.572-128.573,220.418c0,0,37.872,19.509,58.538,9.176c0,0-20.666,79.215-113.64,183.691c82.642,22.948,144.634-14.936,144.634-14.936V512h78.083V398.348c0,0,61.992,37.884,144.634,14.936C346.701,308.809,326.039,229.594,326.039,229.594z"/></svg>
                                </button>
                                <cover-level-picker
                                    kind="water"
                                    [value]="waterDepthValue()"
                                    [disabled]="targetStateReadOnly"
                                    (valueChange)="selectWaterDepth($event)"
                                />
                                <cover-level-picker
                                    kind="building"
                                    [value]="buildingCoverValue()"
                                    [disabled]="staticTarget() || targetStateReadOnly"
                                    (valueChange)="selectBuildingLevel($event)"
                                />
                            </div>
                            <span class="choice-caption"><span>{{ targetHexCoverCaption() }}</span></span>
                        </div>
                        
                        <div class="terrain-group" [class.framed-borders]="indirectFire()" [class.muted-frame]="indirectFire()">
                            @if (indirectFire()) {
                            <div class="section-title secondary">From the Spotter Line of Sight</div>
                            }
                            <div class="choice-line">
                                <span class="choice-label"><span>Intervening</span>@if (woodsModifierLabel(); as modifierLabel) { <span class="modifier-badge">{{ modifierLabel }}</span> }</span>
                                <div class="icon-choice-row interleaving-choice-row" role="group" aria-label="Intervening woods">
                                    <button type="button" class="bt-button icon-choice" aria-label="1 light wood" [class.selected]="interveningWoods() === 'light1'" [attr.aria-pressed]="interveningWoods() === 'light1'" (click)="selectInterveningWoods('light1')">
                                        <svg viewBox="0 0 512 512" aria-hidden="true"><path d="M326.039,229.594c20.662,10.332,58.534-9.176,58.534-9.176C301.915,128.572,256.001,0,256.001,0s-45.916,128.572-128.573,220.418c0,0,37.872,19.509,58.538,9.176c0,0-20.666,79.215-113.64,183.691c82.642,22.948,144.634-14.936,144.634-14.936V512h78.083V398.348c0,0,61.992,37.884,144.634,14.936C346.701,308.809,326.039,229.594,326.039,229.594z"/></svg>
                                    </button>
                                    <button type="button" class="bt-button icon-choice double-tree" aria-label="2 light woods or 1 heavy wood" [class.selected]="interveningWoods() === 'light2'" [attr.aria-pressed]="interveningWoods() === 'light2'" (click)="selectInterveningWoods('light2')">
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
                            <div class="button-row" [class.derived-target-state]="waterPartialCover() || buildingPartialCover()">
                            <button type="button" class="bt-button move-button partial-cover" [class.selected]="partialCoverSelected()" [class.water-choice]="waterPartialCover()" [class.building-choice]="buildingPartialCover()" [attr.aria-pressed]="partialCoverSelected()" [disabled]="partialCoverDisabled()" (click)="togglePartialCover()"><span>{{ partialCoverLabel() }}</span><span class="modifier-badge">+1</span></button>
                            </div>
                        </div>

                    </section>
                </div>

            </div>
        </div>
        <div class="tn-actions">
            <div class="total-box">TN Modifier: <span class="modifier">{{ signedTotal() }}</span></div>
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

        .tn-column {
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-width: 0;
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

        .framed-borders .section-title {
            padding-top: 0px;
            margin-top: -2px;
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

        .c3-distance-title {
            padding-bottom: 0;
        }

        .c3-status-label {
            color: var(--jammed-condition-color);
        }

        .c3-distance-control {
            position: relative;
            overflow: visible;
        }

        .c3-distance-control.c3-degraded::after {
            content: '';
            position: absolute;
            inset: -4px;
            z-index: 2;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            background: color-mix(in srgb, var(--jammed-condition-color) 30%, transparent);
            border: 1px solid var(--jammed-condition-color);
            font-weight: 800;
            letter-spacing: 0.1em;
            pointer-events: none;
            opacity: 0.5;
        }

        .use-c3-toggle {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
        }

        .disabled-field,
        .c3-distance-disabled {
            opacity: 0.45;
        }

        .static-target-disabled {
            opacity: 0.45;
            pointer-events: none;
        }

        .derived-target-state {
            opacity: 0.7;
            pointer-events: none;
        }

        .identity-choice.derived-target-control {
            opacity: 0.7;
        }

        .c3-distance-disabled hex-slider {
            pointer-events: none;
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
            opacity: 0.7;
        }

        .derived-target-state .bt-button,
        .derived-target-state .bt-button:hover,
        .derived-target-state .bt-button:active,
        .identity-choice.derived-target-control,
        .identity-choice.derived-target-control:hover,
        .identity-choice.derived-target-control:active {
            pointer-events: none;
            cursor: default;
            transition: none;
            border-color: transparent;
            background-image: none;
        }

        .derived-target-state .bt-button:not(.selected),
        .derived-target-state .bt-button:not(.selected):hover,
        .derived-target-state .bt-button:not(.selected):active,
        .identity-choice.derived-target-control:not(.selected),
        .identity-choice.derived-target-control:not(.selected):hover,
        .identity-choice.derived-target-control:not(.selected):active {
            background-color: transparent;
            color: inherit;
        }

        .derived-target-state .bt-button.selected,
        .derived-target-state .bt-button.selected:hover,
        .derived-target-state .bt-button.selected:active,
        .identity-choice.derived-target-control.selected,
        .identity-choice.derived-target-control.selected:hover,
        .identity-choice.derived-target-control.selected:active {
            border-color: transparent;
            background-color: var(--bt-yellow);
            color: #000;
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
            flex: 0 0 94px;
            color: var(--text-color-secondary);
            font-size: 0.8rem;
            font-weight: 500;
        }

        .field-row label {
            display: inline-flex;
            align-items: center;
            justify-content: space-between;
            gap: 4px;
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

        .identity-choice {
            flex: 1 1 auto;
            min-width: 0;
            width: 100%;
            display: flex;
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

        .cover-choice-row {
            display: grid;
            grid-template-columns: repeat(4, 40px);
        }

        .interleaving-choice-row {
            display: grid;
            grid-template-columns: repeat(2, 40px);
        }

        .cover-choice-row > .icon-choice,
        .interleaving-choice-row > .icon-choice {
            inline-size: 100%;
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

        .icon-choice svg {
            inline-size: 20px;
            block-size: 20px;
            fill: currentColor;
        }

        .water-choice.selected,
        .water-choice.selected:hover,
        .water-choice.selected:active,
        .derived-target-state .water-choice.selected,
        .derived-target-state .water-choice.selected:hover,
        .derived-target-state .water-choice.selected:active {
            border-color: #64b5f6;
            background: #1565c0;
            color: #fff;
        }

        .building-choice.selected,
        .building-choice.selected:hover,
        .building-choice.selected:active,
        .derived-target-state .building-choice.selected,
        .derived-target-state .building-choice.selected:hover,
        .derived-target-state .building-choice.selected:active {
            border-color: #fff;
            background: #d1d1d1;
            color: #000;
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
            justify-content: flex-end;
            gap: 6px;
            border-top: 1px solid var(--border-color);
            padding: 8px;

            .bt-button {
                width: 170px;
            }
        }

        .total-box {
            font-weight: 500;
            color: var(--text-color-secondary);
            display: inline-flex;
            align-items: center;
            gap: 4px;

            .modifier {
                color: var(--text-color);
                font-size: 1.1em;
                min-height: 28px;
                border-color: #aaa;
            }
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

            .tn-column {
                display: contents;
            }

            .attack-method-section {
                order: 1;
            }

            .target-identity-section {
                order: 2;
            }

            .target-movement-section {
                order: 3;
            }

            .other-section {
                order: 4;
            }

            .distance-section {
                order: 5;
            }

            .tn-grid::before {
                content: none;
            }

            .total-box {
                font-size: 0.9em;
                width: 220px;
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
    readonly jammedConditionColor = JAMMED_CONDITION_COLOR;
    readonly MOVEMENT_MIN = 0;
    readonly MOVEMENT_MAX = TN_TARGET_MOVEMENT_BRACKETS.length - 1;
    readonly RANGE_MIN = 0;
    readonly RANGE_MAX = 25;
    private readonly dialogRef = inject(DialogRef<TnCalculatorDialogResult | null>);
    private readonly data = inject<TnCalculatorDialogData>(DIALOG_DATA);
    private readonly initialCalculator = this.data.target.tnCalculator;
    private readonly initialUnitType = this.data.target.unitType ?? 'mek-biped';

    readonly target = this.data.target;
    readonly indirectFireAvailable = this.data.indirectFireAvailable ?? true;
    private readonly initialIndirectFire = this.initialCalculator?.indirectFire ?? false;
    readonly targetStateReadOnly = this.data.targetStateReadOnly ?? false;
    readonly gameRules = signal(this.data.gameRules);
    readonly showC3Distance = signal<boolean>(this.data.showC3Distance ?? false);
    readonly c3Degraded = signal<boolean>(this.data.c3Degraded ?? false);
    readonly indirectFireBaseModifier = this.data.indirectFireBaseModifier ?? 1;
    readonly unitTypeOptions = TN_TARGET_UNIT_TYPE_OPTIONS;
    readonly unitTypeDropdownOptions = computed<MultilineDropdownOption[]>(() => this.unitTypeOptions.map(option => ({
        value: option.value,
        label: option.label,
        modifierLabel: this.formatNonZeroModifier(getTargetUnitTypeModifier(option.value)),
    })));
    readonly movementBrackets = TN_TARGET_MOVEMENT_BRACKETS;
    readonly movementTicks = this.movementBrackets.map((_bracket, index) => index);
    readonly movementTickLabels = this.movementBrackets.map(bracket => bracket.label);
    readonly rangeTicks = Array.from({ length: this.RANGE_MAX - this.RANGE_MIN + 1 }, (_value, index) => index + this.RANGE_MIN);
    readonly unitType = signal<TnTargetUnitType>(this.initialUnitType);
    readonly isAirborne = signal<boolean>(this.initialCalculator?.isAirborne ?? false);
    readonly targetMovementBracketIndex = signal<number>(this.indexFromStoredMovementBracket());
    readonly skidding = signal<boolean>(this.initialCalculator?.skidding ?? false);
    readonly prone = signal<boolean>(this.initialCalculator?.prone ?? false);
    readonly immobile = signal<boolean>(this.initialCalculator?.immobile ?? false);
    readonly interveningWoods = signal<TnInterveningWoods>(this.normalizeInterveningWoods(this.initialCalculator?.interveningWoods as TnInterveningWoods | 'heavy1' | null | undefined));
    readonly targetHexCover = signal<TnTargetHexCover>(this.initialCalculator?.targetHexCover ?? 'none');
    readonly waterDepth = signal<UnitWaterDepth | undefined>(this.initialCalculator?.waterDepth);
    readonly buildingCover = signal<UnitBuildingLevel | undefined>(this.initialCalculator?.buildingCover);
    readonly range = signal<number>(Math.max(0, this.data.target.distance ?? 1));
    readonly c3Distance = signal<number>(Math.max(0, this.data.target.c3Distance ?? this.data.target.distance ?? 1));
    readonly useC3 = signal<boolean>((this.data.target.useC3 ?? false) && !this.initialIndirectFire);
    readonly partialCover = signal<boolean>((this.initialCalculator?.partialCover ?? false)
        && !this.initialIndirectFire
        && this.initialCalculator?.waterDepth === undefined
        && this.initialCalculator?.buildingCover === undefined
        && this.range() > ADJACENT_RANGE);
    readonly attackDirection = signal<TnAttackDirection>(this.initialCalculator?.attackDirection ?? 'front');
    readonly indirectFire = signal<boolean>(this.initialIndirectFire);
    readonly secondaryTarget = signal<boolean>(this.initialCalculator?.secondaryTarget ?? false);
    readonly secondaryTargetSideBack = signal<boolean>((this.initialCalculator?.secondaryTargetSideBack ?? false) && !(this.initialCalculator?.secondaryTarget ?? false));
    readonly largeTarget = signal<boolean>(
        this.data.gameRules.supportsLargeTarget && (this.initialCalculator?.largeTarget ?? false),
    );
    readonly spotterMoveMode = signal<TnSpotterMoveMode>(this.initialCalculator?.spotterMoveMode ?? 'stationary');
    readonly spotterDeclaredAttacks = signal<boolean>(this.initialCalculator?.spotterDeclaredAttacks ?? false);
    readonly renderReady = signal(false);
    readonly unitTypeSelectedHasModifier = computed(() => this.unitTypeDropdownOptions().some(option => option.value === this.unitType() && !!option.modifierLabel));

    readonly staticTarget = computed(() => isStaticTargetType(this.unitType()));
    readonly terrainTarget = computed(() => isTerrainTargetType(this.unitType()));
    readonly waterDepthValue = computed(() => this.waterDepth() ?? '');
    readonly buildingCoverValue = computed(() => this.buildingCover() ?? '');
    readonly targetWaterState = computed(() => resolveTnTargetWaterState({
        unitType: this.unitType(),
        waterDepth: this.waterDepth(),
        largeTarget: this.largeTarget(),
        prone: this.prone(),
    }));
    readonly waterPartialCover = computed(() => this.targetWaterState().partiallyUnderwater);
    readonly targetBuildingCoverState = computed(() => resolveTnTargetBuildingCoverState({
        unitType: this.unitType(),
        buildingCover: this.buildingCover(),
        largeTarget: this.largeTarget(),
        prone: this.prone(),
    }));
    readonly buildingPartialCover = computed(() => this.targetBuildingCoverState().effect === 'partial');
    readonly partialCoverUnavailable = computed(() => this.staticTarget() || this.prone() || this.indirectFire() || this.range() <= ADJACENT_RANGE);
    readonly partialCoverDisabled = computed(() => this.waterDepth() !== undefined || this.buildingCover() !== undefined || this.partialCoverUnavailable());
    readonly partialCoverSelected = computed(() => this.waterPartialCover() || this.buildingPartialCover() || this.partialCover());
    readonly partialCoverLabel = computed(() => this.waterPartialCover()
        ? 'Partial Cover (water)'
        : this.buildingPartialCover()
            ? 'Partial Cover (building)'
            : 'Partial Cover');
    readonly proneLabel = computed(() => this.range() <= ADJACENT_RANGE ? 'Prone (Adjacent)' : 'Prone');
    readonly proneModifierLabel = computed(() => this.range() <= ADJACENT_RANGE ? '-2' : '+1');
    readonly targetMovementBracket = computed(() => this.movementBrackets[this.targetMovementBracketIndex()] ?? this.movementBrackets[0]);
    readonly targetMovementBracketLabel = computed(() => this.targetMovementBracket().label);
    readonly targetMovementModifier = computed(() => getTargetMovementBracketModifier(this.targetMovementBracket().id));
    readonly targetMovementModifierLabel = computed(() => this.formatModifier(this.targetMovementModifier()));
    readonly rangeLabel = computed(() => `${this.range()}`);
    readonly c3BlockedByIndirectFire = computed(() => this.indirectFire());
    readonly c3Enabled = computed(() => this.showC3Distance() && this.useC3() && !this.c3BlockedByIndirectFire());
    readonly c3DistanceLabel = computed(() => this.c3Enabled() ? `${this.c3Distance()}` : '');
    readonly indirectFireModifier = computed(() => getIndirectFireModifier(this.indirectFire(), this.spotterMoveMode(), this.spotterDeclaredAttacks(), this.indirectFireBaseModifier));
    readonly indirectFireModifierLabel = computed(() => this.formatModifier(getIndirectFireModifier(true, this.spotterMoveMode(), this.spotterDeclaredAttacks(), this.indirectFireBaseModifier)));
    readonly totalModifier = computed(() => calculateTargetTnModifier({
        unitType: this.unitType(),
        range: this.range(),
        isAirborne: this.isAirborne(),
        targetMovementBracket: !this.staticTarget() ? this.targetMovementBracket().id : null,
        skidding: this.skidding(),
        prone: this.prone(),
        immobile: this.immobile(),
        interveningWoods: this.interveningWoods(),
        targetHexCover: this.targetHexCover(),
        partialCover: this.partialCover(),
        waterDepth: this.waterDepth(),
        buildingCover: this.buildingCover(),
        attackDirection: this.attackDirection(),
        indirectFire: this.indirectFire(),
        secondaryTarget: this.secondaryTarget(),
        secondaryTargetSideBack: this.secondaryTargetSideBack(),
        largeTarget: this.largeTarget(),
        spotterMoveMode: this.spotterMoveMode(),
        spotterDeclaredAttacks: this.spotterDeclaredAttacks(),
        indirectFireBaseModifier: this.indirectFireBaseModifier,
    }, this.gameRules()));
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
        const waterDepth = this.waterDepth();
        if (waterDepth) return `Water depth ${unitWaterDepthNumber(waterDepth)}`;
        const buildingCover = this.buildingCover();
        if (buildingCover) return `Building level ${unitBuildingLevelNumber(buildingCover)}`;
        switch (this.targetHexCover()) {
            case 'light': return 'Light Wood';
            case 'heavy': return 'Heavy Wood';
            default: return 'No cover';
        }
    });
    readonly targetHexCoverModifierLabel = computed(() => {
        if (this.waterDepth()) return null;
        if (this.buildingCover()) {
            return this.targetBuildingCoverState().modifier === 2 ? '+2' : null;
        }
        switch (this.targetHexCover()) {
            case 'light': return '+1';
            case 'heavy': return '+2';
            default: return null;
        }
    });

    constructor() {
        afterNextRender(() => this.renderReady.set(true));
        this.clearStaticTargetModifiers();
    }

    selectUnitType(value: string): void {
        if (this.targetStateReadOnly) return;
        this.unitType.set(value as TnTargetUnitType);
        this.clearStaticTargetModifiers();
    }

    private normalizeInterveningWoods(value: TnInterveningWoods | 'heavy1' | null | undefined): TnInterveningWoods {
        return value === 'heavy1' ? 'light2' : value ?? 'none';
    }

    setTargetMovementBracketIndex(value: number): void {
        if (this.staticTarget() || this.targetStateReadOnly) return;
        this.targetMovementBracketIndex.set(this.alignToStep(value, this.MOVEMENT_MIN, this.MOVEMENT_MAX));
    }

    toggleAirborne(): void {
        if (this.staticTarget() || this.targetStateReadOnly) return;
        this.isAirborne.set(!this.isAirborne());
    }

    toggleSkidding(): void {
        if (this.staticTarget() || this.targetStateReadOnly) return;
        this.skidding.set(!this.skidding());
    }

    toggleProne(): void {
        if (this.staticTarget() || this.targetStateReadOnly) return;
        const next = !this.prone();
        this.prone.set(next);
        if (next) this.partialCover.set(false);
    }

    toggleImmobile(): void {
        if (this.staticTarget() || this.targetStateReadOnly) return;
        this.immobile.update(value => !value);
    }

    selectInterveningWoods(woods: TnInterveningWoods): void {
        this.interveningWoods.update(current => current === woods ? 'none' : woods);
    }

    selectTargetHexCover(cover: TnTargetHexCover): void {
        if (this.terrainTarget() || this.targetStateReadOnly) return;
        this.waterDepth.set(undefined);
        this.buildingCover.set(undefined);
        this.targetHexCover.update(current => current === cover ? 'none' : cover);
    }

    selectWaterDepth(value: string): void {
        if (!isUnitWaterDepth(value) || this.targetStateReadOnly) return;
        this.waterDepth.update(current => current === value ? undefined : value);
        this.buildingCover.set(undefined);
        this.targetHexCover.set('none');
        this.partialCover.set(false);
    }

    selectBuildingLevel(value: string): void {
        if (!isUnitBuildingLevel(value) || this.staticTarget() || this.targetStateReadOnly) return;
        this.buildingCover.update(current => current === value ? undefined : value);
        this.waterDepth.set(undefined);
        this.targetHexCover.set('none');
        this.partialCover.set(false);
    }

    togglePartialCover(): void {
        if (this.waterDepth() || this.buildingCover()) return;
        if (this.partialCoverUnavailable()) {
            this.partialCover.set(false);
            return;
        }
        const next = !this.partialCover();
        this.partialCover.set(next);
        if (next && this.prone()) {
            this.prone.set(false);
        }
    }

    toggleIndirectFire(): void {
        if (!this.indirectFireAvailable) return;
        const next = !this.indirectFire();
        this.indirectFire.set(next);
        if (next) {
            this.useC3.set(false);
            this.partialCover.set(false);
        }
        if (!next) {
            this.spotterMoveMode.set('stationary');
            this.spotterDeclaredAttacks.set(false);
        }
    }

    toggleSecondaryTarget(): void {
        const next = !this.secondaryTarget();
        this.secondaryTarget.set(next);
        if (next) {
            this.secondaryTargetSideBack.set(false);
        }
    }

    toggleSecondaryTargetSideBack(): void {
        const next = !this.secondaryTargetSideBack();
        this.secondaryTargetSideBack.set(next);
        if (next) {
            this.secondaryTarget.set(false);
        }
    }

    toggleLargeTarget(): void {
        if (this.targetStateReadOnly || !this.gameRules().supportsLargeTarget) return;
        this.largeTarget.set(!this.largeTarget());
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

    setUseC3(event: Event): void {
        const checked = (event.target as HTMLInputElement).checked;
        this.useC3.set(checked && !this.c3BlockedByIndirectFire());
    }

    setC3Degraded(degraded: boolean): void {
        this.c3Degraded.set(degraded);
    }

    apply(): void {
        const state: TnTargetNumberCalculatorState = {
            isAirborne: this.staticTarget() ? false : this.isAirborne(),
            targetMovementBracket: !this.staticTarget() ? this.targetMovementBracket().id : null,
            skidding: this.staticTarget() ? false : this.skidding(),
            prone: this.prone(),
            immobile: this.immobile(),
            interveningWoods: this.interveningWoods(),
            targetHexCover: this.terrainTarget() ? 'none' : this.targetHexCover(),
            partialCover: this.partialCover() && !this.partialCoverDisabled(),
            waterDepth: this.waterDepth(),
            buildingCover: this.buildingCover(),
            attackDirection: this.attackDirection(),
            indirectFire: this.indirectFire(),
            secondaryTarget: this.secondaryTarget(),
            secondaryTargetSideBack: this.secondaryTargetSideBack(),
            largeTarget: this.largeTarget(),
            spotterMoveMode: this.indirectFire() ? this.spotterMoveMode() : 'stationary',
            spotterDeclaredAttacks: this.indirectFire() && this.spotterDeclaredAttacks(),
        };
        this.dialogRef.close({
            targetId: this.target.id,
            patch: {
                unitType: this.unitType(),
                distance: this.range(),
                ...(this.showC3Distance() && { c3Distance: this.c3Distance(), useC3: this.useC3() && !this.c3BlockedByIndirectFire() }),
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
        if (next <= ADJACENT_RANGE) {
            this.partialCover.set(false);
        }
    }

    setC3DistanceValue(value: number): void {
        if (!this.c3Enabled()) return;
        this.c3Distance.set(this.alignToStep(value, this.RANGE_MIN, this.RANGE_MAX));
    }

    private clearStaticTargetModifiers(): void {
        if (!this.staticTarget()) return;
        this.targetMovementBracketIndex.set(0);
        this.clearAirborne();
        this.skidding.set(false);
        this.prone.set(false);
        this.immobile.set(true);
        this.partialCover.set(false);
        this.waterDepth.set(undefined);
        this.buildingCover.set(undefined);
        if (this.terrainTarget()) this.targetHexCover.set('none');
    }

    private clearAirborne(): void {
        if (this.isAirborne()) {
            this.isAirborne.set(false);
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

    private formatNonZeroModifier(value: number): string | null {
        return value === 0 ? null : this.formatModifier(value);
    }

    private formatModifier(value: number): string {
        return value >= 0 ? `+${value}` : `${value}`;
    }
}
