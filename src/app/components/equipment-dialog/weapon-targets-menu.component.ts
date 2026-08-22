// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ColorPickerButtonComponent } from '../color-picker-button/color-picker-button.component';
import {
    getEffectiveInventoryControlCalculatorState,
    INVENTORY_CONTROL_TARGET_COLORS,
    INVENTORY_CONTROL_TARGET_MAX_COUNT,
    type InventoryControlRuntimeTarget,
    type InventoryControlRuntimeTargetId
} from '../../models/inventory-control-runtime-state.model';
import { TooltipDirective } from '../../directives/tooltip.directive';
import { getUnitConditionDefinition, NARC_CONDITION_COLOR } from '../../models/rules/unit-type-rules';
import { CORE_2026_GAME_RULES, type C3DegradationLabel, type CBTGameRules } from '../../models/rules/game-rules';
import {
    calculateTargetTnModifierBreakdown,
    type TnTargetModifierBreakdownEntry,
    type TnTargetNumberCalculatorState,
} from '../../models/target-number-calculator.model';
import { unitBuildingLevelNumber, unitWaterDepthNumber } from '../../models/unit-cover.model';
import {
    inventoryTargetAllowsC3,
    inventoryTargetUsesC3,
    resolveTargetGuidance,
} from '../../utils/inventory-target-number.util';

const JAMMED_CONDITION_COLOR = getUnitConditionDefinition('jammed')?.color ?? '#ff6be6';
const TAGGED_CONDITION_COLOR = getUnitConditionDefinition('tagged').color;

interface TargetModifierPill {
    label: string;
    modifier?: number;
    accentColor?: string;
    invalid?: boolean;
    invalidReason?: string;
    custom?: boolean;
}

export interface NarcCapableWeaponLayers {
    aboveWater: boolean;
    underwater: boolean;
}

const NO_NARC_CAPABLE_WEAPON_LAYERS: NarcCapableWeaponLayers = {
    aboveWater: false,
    underwater: false,
};

export interface WeaponTargetUpdateRequest {
    targetId: InventoryControlRuntimeTargetId;
    patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>;
    manualTnOverride?: boolean;
}

export interface WeaponTargetCalculatorRequest {
    targetId: InventoryControlRuntimeTargetId;
    origin: HTMLElement;
}

@Component({
    selector: 'weapon-targets-menu',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { '[style.--jammed-condition-color]': 'jammedConditionColor' },
    imports: [ColorPickerButtonComponent, TooltipDirective],
    template: `
        <div class="weapon-targets-menu glass framed-borders has-shadow">
            <div class="weapon-targets-header">
                <strong>Targets</strong>
                <div class="weapon-targets-header-group">
                    @if (targets().length > 0) {
                        <button class="bt-button targets-delete" type="button" aria-label="Reset targets" title="Reset targets" [disabled]="readOnly() || targets().length === 0" (click)="resetTargets()">CLEAR</button>
                    }
                    <button class="bt-button" type="button" aria-label="Add target" title="Add force target" [disabled]="readOnly() || manualTargetCount() >= maxTargets()" (click)="addTarget()">ADD</button>
                    @if (opforAvailable()) {
                        <button class="bt-button opfor-toggle" type="button" aria-label="Toggle opposing units as targets" title="Add or remove all opposing units as targets" [class.selected]="opforEnabled()" [attr.aria-pressed]="opforEnabled()" [disabled]="readOnly()" (click)="toggleOpfor()">
                            <svg class="opfor-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.91" aria-hidden="true" focusable="false">
                                <path d="M10.57 5.8l2.71-2.72a5.4 5.4 0 0 1 7.64 7.64l-2.72 2.71" />
                                <path d="m5.8 10.57-2.72 2.71a5.4 5.4 0 0 0 7.64 7.64l2.71-2.72" />
                                <path d="m16.77 7.23-9.54 9.54" />
                            </svg>
                            <span>OPFOR</span>
                        </button>
                    }
                </div>
            </div>
            <div class="weapon-targets-list">
                @if (targets().length === 0) {
                    <div class="weapon-targets-empty">No targets</div>
                } @else {
                    @if (unassignedMovement()) {
                        <div class="movement-disclaimer">
                            <span>Don't forget to select your movement for proper TN calculation!</span>
                        </div>
                    }
                    @for (target of targets(); track target.id) {
                        <div class="weapon-target-row" [style.--target-row-color]="target.color">
                            <div class="target-wrapper" [class.has-c3-distance]="showC3Distance()">
                                <div class="target-main-row">
                                    <div class="target-identity-row">
                                        <color-picker-button
                                            class="target-square"
                                            [value]="target.color"
                                            [colors]="colors()"
                                            [disabled]="readOnly()"
                                            [ariaLabel]="'Choose color for ' + target.name"
                                            (valueChange)="updateColor(target.id, $event)">
                                            {{ target.letter }}
                                        </color-picker-button>
                                        <input class="bt-input target-name" [class.linked-target-name]="target.readOnly === true" type="text" [readOnly]="readOnly() || target.readOnly === true" [value]="target.name" (input)="updateName(target.id, $any($event.target).value)">
                                    </div>
                                    <div class="target-controls-row">
                                        <div class="target-number-field">
                                            <span>Distance</span>
                                            <span class="target-stepper">
                                                <button class="bt-button square-small" type="button" [disabled]="readOnly()" (click)="stepDistance(target, -1)">-</button>
                                                <input class="value" type="number" min="0" step="1" [readOnly]="readOnly()" [value]="target.distance" (input)="updateDistance(target.id, $any($event.target).value)">
                                                <button class="bt-button square-small" type="button" [disabled]="readOnly()" (click)="stepDistance(target, 1)">+</button>
                                            </span>
                                        </div>
                                        <div class="target-number-field">
                                            <span class="tn-modifier-label" [tooltip]="tnModifierTooltip">TN Modifier <span class="info-notice" aria-hidden="true">i</span></span>
                                            <span class="target-stepper">
                                                <button class="bt-button square-small" type="button" [disabled]="readOnly()" (click)="stepTnModifier(target, -1)">-</button>
                                                <input class="value tn-modifier-value" [class.linked-tn-modifier]="!isTnModifierManual(target)" type="number" step="1" [readOnly]="readOnly()" [value]="target.tnModifier" [attr.aria-label]="tnModifierAriaLabel(target)" [title]="tnModifierTitle(target)" (input)="updateTnModifier(target.id, $any($event.target).value)">
                                                <button class="bt-button square-small" type="button" [disabled]="readOnly()" (click)="stepTnModifier(target, 1)">+</button>
                                            </span>
                                        </div>
                                        <button class="bt-button square primary calculator-button" type="button" [disabled]="readOnly()" (click)="openTnCalculator(target.id, $event)" aria-label="Open TN calculator" title="Open TN calculator">
                                            <svg fill="currentColor" width="16px" height="16px" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M116,184a12,12,0,0,1-12,12H84v20a12,12,0,0,1-24,0V196H40a12,12,0,0,1,0-24H60V152a12,12,0,0,1,24,0v20h20A12,12,0,0,1,116,184ZM104,60H40a12,12,0,0,0,0,24h64a12,12,0,0,0,0-24Zm48,116.06641h64a12,12,0,0,0,0-24H152a12,12,0,0,0,0,24Zm64,15.86718H152a12,12,0,0,0,0,24h64a12,12,0,0,0,0-24Zm-64.48535-87.44824a12.00033,12.00033,0,0,0,16.9707,0L184,88.9707l15.51465,15.51465a12.0001,12.0001,0,0,0,16.9707-16.9707L200.9707,72l15.51465-15.51465a12.0001,12.0001,0,0,0-16.9707-16.9707L184,55.0293,168.48535,39.51465a12.0001,12.0001,0,0,0-16.9707,16.9707L167.0293,72,151.51465,87.51465A12.00062,12.00062,0,0,0,151.51465,104.48535Z"/>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                @if (showC3Distance()) {
                                    <div class="target-secondary-row">
                                        <div class="target-identity-spacer">
                                            @if (targetModifierPills(target); as modifierPills) {
                                                @if (modifierPills.length > 0) {
                                                    <div class="target-modifier-pills" aria-label="Assigned target modifiers">
                                                        @for (pill of modifierPills; track $index) {
                                                            <span class="target-modifier-pill" [class.guidance-pill]="pill.accentColor !== undefined" [class.invalid-guidance]="pill.invalid" [class.custom-pill]="pill.custom" [style.--target-pill-accent]="pill.accentColor ?? null" [attr.aria-label]="pill.invalid ? pill.label + ' guidance unavailable' : null" [attr.title]="pill.invalid ? pill.invalidReason : null">
                                                                <span class="modifier-label">{{ pill.label }}</span>
                                                                @if (pill.modifier !== undefined) {
                                                                    <span class="modifier-badge">{{ formatModifier(pill.modifier) }}</span>
                                                                }
                                                                @if (pill.custom) {
                                                                    <button class="custom-pill-remove" type="button" [disabled]="readOnly()" aria-label="Remove custom TN modifier" title="Remove custom TN modifier" (click)="removeCustomModifier(target.id)">×</button>
                                                                }
                                                            </span>
                                                        }
                                                    </div>
                                                }
                                            }
                                        </div>
                                        <div class="target-controls-row target-c3-controls" [class.c3-degraded]="c3Degraded()">
                                            <div class="c3-fields">
                                                <div class="c3-distance-caption">C³ Distance@if (c3Degraded()) { <strong class="c3-status-label"> ({{ c3DegradationLabel() }})</strong> }</div>
                                                <div class="target-number-field c3-distance-field" [class.disabled-field]="!c3Enabled(target)">
                                                    <span class="target-stepper">
                                                        <button class="bt-button square-small" type="button" [disabled]="readOnly() || !c3Enabled(target)" (click)="stepC3Distance(target, -1)">-</button>
                                                        <input class="value" type="number" min="0" step="1" [disabled]="!c3Enabled(target)" [readOnly]="readOnly()" [value]="c3DistanceInputValue(target)" (input)="updateC3Distance(target, $any($event.target).value)">
                                                        <button class="bt-button square-small" type="button" [disabled]="readOnly() || !c3Enabled(target)" (click)="stepC3Distance(target, 1)">+</button>
                                                    </span>
                                                </div>
                                                <div class="target-number-field use-c3-field">
                                                    <label class="use-c3-toggle">
                                                        <input type="checkbox" class="bt-checkbox" [checked]="useC3Checked(target)" [disabled]="readOnly() || !c3Available(target)" (change)="updateUseC3(target, $event)">
                                                        <span>Use C³</span>
                                                    </label>
                                                </div>
                                            </div>
                                            <span class="calculator-spacer" aria-hidden="true"></span>
                                        </div>
                                    </div>
                                }
                                @if (targetModifierPills(target); as modifierPills) {
                                    @if (modifierPills.length > 0) {
                                        <div class="target-modifier-pills target-modifier-pills-fallback" aria-label="Assigned target modifiers">
                                            @for (pill of modifierPills; track $index) {
                                                <span class="target-modifier-pill" [class.guidance-pill]="pill.accentColor !== undefined" [class.invalid-guidance]="pill.invalid" [class.custom-pill]="pill.custom" [style.--target-pill-accent]="pill.accentColor ?? null" [attr.aria-label]="pill.invalid ? pill.label + ' guidance unavailable' : null" [attr.title]="pill.invalid ? pill.invalidReason : null">
                                                    <span class="modifier-label">{{ pill.label }}</span>
                                                    @if (pill.modifier !== undefined) {
                                                        <span class="modifier-badge">{{ formatModifier(pill.modifier) }}</span>
                                                    }
                                                    @if (pill.custom) {
                                                        <button class="custom-pill-remove" type="button" [disabled]="readOnly()" aria-label="Remove custom TN modifier" title="Remove custom TN modifier" (click)="removeCustomModifier(target.id)">×</button>
                                                    }
                                                </span>
                                            }
                                        </div>
                                    }
                                }
                            </div>
                            @if (manualTargetCount() > 0) {
                                <div class="target-delete-row">
                                    @if (!target.readOnly) {
                                    <button class="target-delete" type="button" [disabled]="readOnly()" aria-label="Delete target" title="Delete target" (click)="deleteTarget(target.id)">
                                        <svg width="18px" height="18px" fill="currentColor" viewBox="0 0 1200 1200" aria-hidden="true"><path d="M0,264.84L335.16,600L0,935.16L264.84,1200L600,864.84L935.16,1200L1200,935.16L864.84,600L1200,264.84L935.16,0L600,335.16L264.84,0L0,264.84z"></path></svg>
                                    </button>
                                    }
                                </div>
                            }
                        </div>
                    }
                }
            </div>
        </div>
    `,
    styles: [`
        @media print {
            :host {
                display: none !important;
            }
        }

        .weapon-targets-menu {
            --target-control-height: 28px;
            container-type: inline-size;
            box-sizing: border-box;
            width: min(560px, calc(100dvw - 16px));
            max-height: min(620px, calc(100dvh - 16px));
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .weapon-targets-header {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            align-items: center;
            padding: 8px 12px;
            border-bottom: 1px solid var(--border-color);
            color: var(--text-color);
            text-transform: uppercase;
            font-size: 0.82rem;
            letter-spacing: 0;
        }

        .weapon-targets-header-group {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .opfor-toggle {
            gap: 5px;
        }

        .opfor-link-icon {
            inline-size: 16px;
            block-size: 16px;
            flex: 0 0 16px;
            stroke-linecap: round;
            stroke-linejoin: round;
        }

        .weapon-targets-list {
            display: flex;
            flex-direction: column;
            overflow: auto;
            gap: 4px;
        }

        .weapon-targets-empty {
            padding: 22px 16px;
            color: var(--text-color-secondary);
            text-align: center;
        }

        .weapon-target-row {
            display: flex;
            align-items: stretch;
            justify-content: space-between;
            flex-wrap: nowrap;
            gap: 10px;
            padding: 4px 8px 4px 8px;
            border-bottom: 1px solid var(--border-color);
            margin-left: 4px;
            margin-right: 4px;
            box-sizing: border-box;
            --target-row-color: transparent;
            background-color: color-mix(in srgb, 
            color-mix(in srgb, var(--target-row-color) 25%, black) 50%, 
            transparent
            );
            border: 2px solid var(--target-row-color);

            &:last-child {
                margin-bottom: 4px;
            }
        }

        .target-wrapper {
            display: flex;
            flex-direction: column;
            gap: 10px;
            align-items: stretch;
            flex-wrap: nowrap;
            flex: 1 1 auto;
            min-width: 0;
        }

        .target-modifier-pills {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 1px;
            min-width: 0;
        }

        .target-wrapper.has-c3-distance .target-modifier-pills-fallback {
            display: none;
        }

        .target-identity-spacer .target-modifier-pills {
            flex: 1 1 auto;
        }

        .target-modifier-pill {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            min-height: 24px;
            max-width: 100%;
            padding: 0 6px;
            border: 1px solid var(--border-color);
            background: rgba(0, 0, 0, 0.35);
            color: var(--text-color-secondary);
            font-size: 0.76rem;
            line-height: 1;
            white-space: nowrap;
            box-sizing: border-box;
        }

        .target-modifier-pill .modifier-label {
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .target-modifier-pill.guidance-pill {
            border-color: var(--target-pill-accent);
            background: color-mix(in srgb, var(--target-pill-accent) 48%, #141414);
            color: #fff;
            font-weight: 700;
        }

        .target-modifier-pill.guidance-pill.invalid-guidance {
            border-color: color-mix(in srgb, var(--target-pill-accent) 55%, var(--border-color));
            background: rgba(0, 0, 0, 0.35);
            color: var(--text-color-secondary);
            font-weight: 400;
        }

        .target-modifier-pill.custom-pill {
            border-color: var(--bt-yellow, #EAAE3F);
            background: color-mix(in srgb, var(--bt-yellow, #EAAE3F) 24%, #141414);
            color: var(--bt-yellow, #EAAE3F);
            font-weight: 700;
        }

        .target-modifier-pill.invalid-guidance .modifier-label {
            color: var(--danger, red);
            text-decoration-line: line-through;
            text-decoration-color: red;
            text-decoration-thickness: 2px;
        }

        .target-modifier-pill .modifier-badge {
            flex: 0 0 18px;
            inline-size: 18px;
            block-size: 18px;
            margin-right: -4px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--border-color);
            background: rgba(0, 0, 0, 0.6);
            color: var(--text-color);
            font-weight: 600;
            font-size: 0.85em;
            font-variant-numeric: tabular-nums;
            line-height: 1;
            box-sizing: border-box;
        }

        .custom-pill-remove {
            inline-size: 18px;
            block-size: 18px;
            margin: 0 -4px 0 0;
            padding: 0;
            border: 0;
            background: transparent;
            color: inherit;
            font: inherit;
            font-size: 1rem;
            font-weight: 800;
            line-height: 1;
            cursor: pointer;
        }

        .custom-pill-remove:hover:not(:disabled),
        .custom-pill-remove:focus-visible {
            background: var(--bt-yellow, #EAAE3F);
            color: #000;
            outline: none;
        }

        .custom-pill-remove:disabled {
            cursor: not-allowed;
            opacity: 0.45;
        }

        .target-main-row,
        .target-secondary-row {
            display: flex;
            gap: 10px;
            align-items: end;
            min-width: 0;
        }
        .target-identity-row,
        .target-identity-spacer {
            display: flex;
            gap: 8px;
            align-items: end;
            flex: 1 1 180px;
            min-width: 0;
        }

        .target-identity-spacer {
            min-height: 1px;
        }

        .target-controls-row {
            display: flex;
            gap: 8px;
            align-items: end;
            flex: 1 1 220px;
            min-width: 0;
        }

        .target-c3-controls {
            align-items: end;
            position: relative;
            overflow: visible;
            align-self: start;
        }

        .c3-fields {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            column-gap: 8px;
            row-gap: 3px;
            flex: 1 1 0;
            min-width: 0;
        }

        .c3-distance-caption {
            grid-column: 1 / 3;
            min-width: 0;
            color: var(--text-color-secondary);
            font-size: 0.76rem;
            font-weight: 700;
            text-transform: uppercase;
            white-space: nowrap;
        }

        .c3-status-label {
            color: var(--jammed-condition-color);
        }

        .calculator-button,
        .calculator-spacer {
            flex: 0 0 var(--target-control-height);
            inline-size: var(--target-control-height);
        }

        .target-delete-row {
            border-left: 1px solid var(--border-color);
            padding-left: 10px;
            min-height: 100%;
            display: flex;
            flex-direction: column;
            align-items: end;
            justify-content: start;
            flex: 0 0 29px;
            inline-size: 29px;
            box-sizing: border-box;
        }

        .target-square {
            inline-size: var(--target-control-height);
            block-size: var(--target-control-height);
            flex: 0 0 var(--target-control-height);
        }

        .target-name {
            min-width: 0;
            width: auto;
            height: var(--target-control-height);
            box-sizing: border-box;
            flex: 1 1 auto;
        }

        .target-name.linked-target-name,
        .target-name.linked-target-name:hover,
        .target-name.linked-target-name:focus,
        .target-name.linked-target-name:focus-visible {
            border-color: transparent;
            background-color: transparent;
            background-image: none;
            transition: none;
            outline: none;
            cursor: default;
        }

        .target-number-field {
            display: grid;
            gap: 3px;
            color: var(--text-color-secondary);
            font-size: 0.76rem;
            font-weight: 700;
            text-transform: uppercase;
            align-self: end;
            flex: 1 1 0;
            min-width: 0;
        }

        .target-number-field > span:first-child {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .disabled-field {
            opacity: 0.45;
        }

        .target-c3-controls.c3-degraded::after {
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
            letter-spacing: 0.08em;
            pointer-events: none;
            opacity: 0.5;
        }

        .tn-modifier-label {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            width: fit-content;
            max-width: 100%;
            cursor: help;
        }

        .target-stepper {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 3px;
            align-items: center;
            min-width: 0;

            input {
                border: 0;
                text-align: center;
                font-variant-numeric: tabular-nums;
                background: transparent;
                color: var(--text-color);
                border-bottom: 1px solid var(--border-color);
                height: var(--target-control-height);
                box-sizing: border-box;
            }
        }

        .target-stepper .value {
            font-size: 1.5em;
            flex: 1 1 0;
            inline-size: 0;
            min-inline-size: 3ch;
            appearance: textfield;
            -moz-appearance: textfield;
        }

        .target-stepper .value.tn-modifier-value {
            border-bottom-width: 2px;
            transition: border-color 0.2s ease-in-out, background-color 0.2s ease-in-out, color 0.2s ease-in-out;
        }

        .target-stepper .value.tn-modifier-value.linked-tn-modifier {
            border-bottom-color: var(--primary-focus-color);
            background-color: color-mix(in srgb, var(--primary-focus-color) 10%, transparent);
        }

        .target-stepper .value::-webkit-outer-spin-button,
        .target-stepper .value::-webkit-inner-spin-button {
            margin: 0;
            -webkit-appearance: none;
        }

        .target-stepper .bt-button {
            min-width: var(--target-control-height);
            min-height: var(--target-control-height);
            max-width: var(--target-control-height);
            max-height: var(--target-control-height);
        }

        .use-c3-toggle {
            min-height: var(--target-control-height);
            display: flex;
            align-items: center;
            gap: 6px;
            color: var(--text-color);
            text-transform: none;
            font-size: 0.82rem;
            font-weight: 600;
            white-space: nowrap;
            width: max-content;
            cursor: pointer;
        }

        .use-c3-toggle input {
            margin: 0;
        }

        .target-delete {
            color: #999;
            border: 0;
            padding: 0;
            background: transparent;
            cursor: pointer;
            transition: color 0.2s;
            margin-top: 21px;

            &:hover {
                color: var(--damage-color);
            }
        }
        
        .movement-disclaimer {
            width: 100%;
            font-size: 0.8rem;
            padding: 2px;
            font-weight: 500;
            box-sizing: border-box;
            text-align: center;
            background-color: orange;
            color: black;
        }

        @container (max-width: 500px) {
            .weapon-target-row {
                gap: 4px;
            }

            .target-main-row,
            .target-secondary-row {
                flex-direction: column;
                align-items: stretch;
                gap: 8px;
                padding: 4px 2px 4px 0px;
            }

            .target-wrapper {
                gap: 4px;
            }

            .target-identity-spacer {
                display: none;
            }

            .target-wrapper.has-c3-distance .target-modifier-pills-fallback {
                display: flex;
            }

            .target-identity-row,
            .target-controls-row {
                flex: 1 1 100%;
                width: 100%;
            }

            .target-delete {
                margin-top: 8px;
            }
        }
    `]
})
export class WeaponTargetsMenuComponent {
    readonly jammedConditionColor = JAMMED_CONDITION_COLOR;
    readonly tnModifierTooltip = 'Target-side TN modifier for this target. Use it for target movement, indirect fire, spotter movement, terrain, cover, stance, and similar target conditions. It is added separately from your unit skill, your movement, range, heat, and weapon modifiers. The calculator can fill it, and you can still override it manually.';
    readonly targets = input<InventoryControlRuntimeTarget[]>([]);
    readonly colors = input<readonly string[]>(INVENTORY_CONTROL_TARGET_COLORS);
    readonly maxTargets = input(INVENTORY_CONTROL_TARGET_MAX_COUNT);
    readonly unassignedMovement = input(false);
    readonly showC3Distance = input(false);
    readonly c3Degraded = input(false);
    readonly c3DegradationLabel = input<C3DegradationLabel>('DEGRADED');
    readonly gameRules = input<CBTGameRules>(CORE_2026_GAME_RULES);
    readonly hasSemiGuidedMissiles = input(false);
    readonly narcCapableWeaponLayers = input<NarcCapableWeaponLayers>(NO_NARC_CAPABLE_WEAPON_LAYERS);
    readonly opforAvailable = input(false);
    readonly opforEnabled = input(false);
    readonly readOnly = input(false);

    readonly addRequest = output<void>();
    readonly opforToggleRequest = output<boolean>();
    readonly resetRequest = output<void>();
    readonly updateRequest = output<WeaponTargetUpdateRequest>();
    readonly deleteRequest = output<InventoryControlRuntimeTargetId>();
    readonly calculatorRequest = output<WeaponTargetCalculatorRequest>();

    addTarget(): void {
        if (!this.readOnly()) this.addRequest.emit();
    }

    toggleOpfor(): void {
        if (!this.readOnly() && this.opforAvailable()) this.opforToggleRequest.emit(!this.opforEnabled());
    }

    manualTargetCount(): number {
        return this.targets().filter(target => target.source !== 'opfor').length;
    }

    resetTargets(): void {
        if (!this.readOnly()) this.resetRequest.emit();
    }

    deleteTarget(targetId: InventoryControlRuntimeTargetId): void {
        if (!this.readOnly()) this.deleteRequest.emit(targetId);
    }

    updateName(targetId: InventoryControlRuntimeTargetId, name: string): void {
        if (this.readOnly() || this.targetReadOnly(targetId)) return;
        this.updateRequest.emit({ targetId, patch: { name } });
    }

    updateColor(targetId: InventoryControlRuntimeTargetId, color: string): void {
        if (this.readOnly()) return;
        this.updateRequest.emit({ targetId, patch: { color } });
    }

    updateDistance(targetId: InventoryControlRuntimeTargetId, value: string): void {
        if (this.readOnly()) return;
        this.updateRequest.emit({ targetId, patch: { distance: this.parseNumber(value, 0, true) } });
    }

    updateC3Distance(target: InventoryControlRuntimeTarget, value: string): void {
        if (this.readOnly() || !this.c3Enabled(target)) return;
        this.updateRequest.emit({ targetId: target.id, patch: { c3Distance: this.parseNumber(value, 0, true) } });
    }

    updateUseC3(target: InventoryControlRuntimeTarget, event: Event): void {
        if (this.readOnly() || !this.c3Available(target)) return;
        const checked = (event.target as HTMLInputElement).checked;
        this.updateRequest.emit({
            targetId: target.id,
            patch: {
                useC3: checked,
                ...(checked && target.c3Distance === undefined && { c3Distance: target.distance })
            }
        });
    }

    updateTnModifier(targetId: InventoryControlRuntimeTargetId, value: string): void {
        if (this.readOnly()) return;
        this.updateRequest.emit({ targetId, patch: { tnModifier: this.parseNumber(value, 0, false) }, manualTnOverride: true });
    }

    removeCustomModifier(targetId: InventoryControlRuntimeTargetId): void {
        if (this.readOnly()) return;
        this.updateRequest.emit({ targetId, patch: { tnCalculator: { customModifier: undefined } } });
    }

    stepDistance(target: InventoryControlRuntimeTarget, delta: number): void {
        if (this.readOnly()) return;
        this.updateRequest.emit({ targetId: target.id, patch: { distance: Math.max(0, target.distance + delta) } });
    }

    stepC3Distance(target: InventoryControlRuntimeTarget, delta: number): void {
        if (this.readOnly() || !this.c3Enabled(target)) return;
        this.updateRequest.emit({ targetId: target.id, patch: { c3Distance: Math.max(0, this.c3DistanceValue(target) + delta) } });
    }

    c3DistanceValue(target: InventoryControlRuntimeTarget): number {
        return target.c3Distance ?? target.distance;
    }

    c3DistanceInputValue(target: InventoryControlRuntimeTarget): number | '' {
        return this.c3Enabled(target) ? this.c3DistanceValue(target) : '';
    }

    c3Enabled(target: InventoryControlRuntimeTarget): boolean {
        return this.useC3Checked(target);
    }

    c3Available(target: InventoryControlRuntimeTarget): boolean {
        return inventoryTargetAllowsC3(target);
    }

    useC3Checked(target: InventoryControlRuntimeTarget): boolean {
        return inventoryTargetUsesC3(target);
    }

    stepTnModifier(target: InventoryControlRuntimeTarget, delta: number): void {
        if (this.readOnly()) return;
        this.updateRequest.emit({ targetId: target.id, patch: { tnModifier: target.tnModifier + delta }, manualTnOverride: true });
    }

    isTnModifierManual(target: InventoryControlRuntimeTarget): boolean {
        return target.manualTnModifier !== undefined;
    }

    tnModifierAriaLabel(target: InventoryControlRuntimeTarget): string {
        return this.isTnModifierManual(target)
            ? 'TN Modifier (manual override)'
            : 'TN Modifier (linked to calculator)';
    }

    tnModifierTitle(target: InventoryControlRuntimeTarget): string {
        return this.isTnModifierManual(target)
            ? 'TN Modifier: manual override'
            : 'TN Modifier: linked to calculator';
    }

    openTnCalculator(targetId: InventoryControlRuntimeTargetId, event: MouseEvent): void {
        if (this.readOnly()) return;
        this.calculatorRequest.emit({ targetId, origin: event.currentTarget as HTMLElement });
    }

    targetModifierPills(target: InventoryControlRuntimeTarget): TargetModifierPill[] {
        const statePills = [
            ...this.targetGuidancePills(target),
            ...(target.tnCalculator?.stealth ? [{ label: 'Stealth' }] : []),
        ];
        const calculator = getEffectiveInventoryControlCalculatorState(target);
        if (!calculator) return statePills;
        const breakdown = calculateTargetTnModifierBreakdown({
            ...calculator,
            unitType: target.unitType,
            range: target.distance,
        }, this.gameRules());
        return [...statePills, ...this.targetBreakdownPills(breakdown, calculator)];
    }

    private targetGuidancePills(target: InventoryControlRuntimeTarget): TargetModifierPill[] {
        const calculator = target.tnCalculator;
        if (!calculator) return [];

        const narcWeaponLayers = this.narcCapableWeaponLayers();
        const guidance = resolveTargetGuidance(calculator, target.unitType, {
            semiGuided: this.hasSemiGuidedMissiles(),
            narcCapableAboveWater: narcWeaponLayers.aboveWater,
            narcCapableUnderwater: narcWeaponLayers.underwater,
        }, this.gameRules());
        const pills: TargetModifierPill[] = [];
        if (guidance.semiGuided) {
            pills.push({ label: 'Tagged', accentColor: TAGGED_CONDITION_COLOR });
        }

        if (guidance.narcRelevant) {
            pills.push({
                label: 'NARC',
                accentColor: NARC_CONDITION_COLOR,
                ...(guidance.narc ? {} : {
                    invalid: true,
                    invalidReason: guidance.narcUnavailableReason === 'ecm-shielded'
                        ? 'NARC guidance is suppressed by ECM'
                        : 'NARC guidance is unavailable across this water layer',
                }),
            });
        }
        return pills;
    }

    private targetBreakdownPills(
        breakdown: readonly TnTargetModifierBreakdownEntry[],
        calculator: TnTargetNumberCalculatorState,
    ): TargetModifierPill[] {
        const pills: TargetModifierPill[] = [];
        let spotterModifier = 0;
        for (const entry of breakdown) {
            if (entry.id === 'spotter-movement' || entry.id === 'spotter-declared-attack') {
                spotterModifier += entry.modifier;
                continue;
            }
            pills.push({
                label: this.targetModifierPillLabel(entry, calculator),
                modifier: entry.modifier,
                ...(entry.id === 'custom' && { custom: true }),
            });
        }
        if (spotterModifier !== 0) pills.push({ label: 'Spotter', modifier: spotterModifier });
        return pills;
    }

    private targetModifierPillLabel(
        entry: TnTargetModifierBreakdownEntry,
        calculator: TnTargetNumberCalculatorState,
    ): string {
        if (entry.partialCoverSource === 'water' && calculator.waterDepth) {
            return `Depth ${unitWaterDepthNumber(calculator.waterDepth)}`;
        }
        if ((entry.partialCoverSource === 'building' || entry.id === 'building-cover')
            && calculator.buildingCover) {
            return `Building lv${unitBuildingLevelNumber(calculator.buildingCover)}`;
        }
        switch (entry.id) {
            case 'intervening-woods': return 'LoS';
            case 'target-hex-cover':
                switch (entry.targetHexCover) {
                    case 'heavy': return 'Heavy Wood';
                    case 'light': return 'Light Wood';
                    default: return entry.label;
                }
            case 'secondary-target': return 'Secondary';
            case 'secondary-target-side-back': return 'Secondary (Side/Back)';
            case 'large-target': return 'Large';
            case 'indirect-fire': return 'Indirect';
            case 'prone': return 'Prone';
            default: return entry.label;
        }
    }

    formatModifier(value: number): string {
        return value >= 0 ? `+${value}` : `${value}`;
    }

    private parseNumber(value: string, fallback: number, clampMinZero: boolean): number {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return clampMinZero ? Math.max(0, parsed) : parsed;
    }

    private targetReadOnly(targetId: InventoryControlRuntimeTargetId): boolean {
        return this.targets().find(target => target.id === targetId)?.readOnly === true;
    }
}
