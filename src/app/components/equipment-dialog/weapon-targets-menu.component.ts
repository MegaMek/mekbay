import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ColorPickerButtonComponent } from '../color-picker-button/color-picker-button.component';
import {
    INVENTORY_CONTROL_TARGET_COLORS,
    INVENTORY_CONTROL_TARGET_MAX_COUNT,
    type InventoryControlRuntimeTarget,
    type InventoryControlRuntimeTargetId
} from '../../models/inventory-control-runtime-state.model';
import { TooltipDirective } from '../../directives/tooltip.directive';

export interface WeaponTargetUpdateRequest {
    targetId: InventoryControlRuntimeTargetId;
    patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>;
}

export interface WeaponTargetCalculatorRequest {
    targetId: InventoryControlRuntimeTargetId;
    origin: HTMLElement;
}

@Component({
    selector: 'weapon-targets-menu',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ColorPickerButtonComponent, TooltipDirective],
    template: `
        <div class="weapon-targets-menu glass framed-borders has-shadow">
            <div class="weapon-targets-header">
                <strong>Targets</strong>
                <div class="weapon-targets-header-group">
                    @if (targets().length > 0) {
                        <button class="bt-button targets-delete" type="button" aria-label="Reset targets" title="Reset targets" [disabled]="targets().length === 0" (click)="resetRequest.emit()">CLEAR</button>
                    }
                    <button class="bt-button" type="button" aria-label="Add target" title="Add target" [disabled]="targets().length >= maxTargets()" (click)="addRequest.emit()">ADD TARGET</button>
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
                            <div class="target-wrapper">
                                <div class="target-main-row">
                                    <div class="target-identity-row">
                                        <color-picker-button
                                            class="target-square"
                                            [value]="target.color"
                                            [colors]="colors()"
                                            [ariaLabel]="'Choose color for ' + target.name"
                                            (valueChange)="updateColor(target.id, $event)">
                                            {{ target.letter }}
                                        </color-picker-button>
                                        <input class="bt-input target-name" type="text" [value]="target.name" (input)="updateName(target.id, $any($event.target).value)">
                                    </div>
                                    <div class="target-controls-row">
                                        <div class="target-number-field">
                                            <span>Distance</span>
                                            <span class="target-stepper">
                                                <button class="bt-button square-small" type="button" (click)="stepDistance(target, -1)">-</button>
                                                <input class="value" type="number" min="0" step="1" [value]="target.distance" (input)="updateDistance(target.id, $any($event.target).value)">
                                                <button class="bt-button square-small" type="button" (click)="stepDistance(target, 1)">+</button>
                                            </span>
                                        </div>
                                        <div class="target-number-field">
                                            <span class="tn-modifier-label" [tooltip]="tnModifierTooltip">TN Modifier <span class="info-notice" aria-hidden="true">i</span></span>
                                            <span class="target-stepper">
                                                <button class="bt-button square-small" type="button" (click)="stepTnModifier(target, -1)">-</button>
                                                <input class="value" type="number" step="1" [value]="target.tnModifier" (input)="updateTnModifier(target.id, $any($event.target).value)">
                                                <button class="bt-button square-small" type="button" (click)="stepTnModifier(target, 1)">+</button>
                                            </span>
                                        </div>
                                        <button class="bt-button square-small calculator-button" type="button" (click)="openTnCalculator(target.id, $event)" aria-label="Open TN calculator" title="Open TN calculator">
                                            <svg fill="currentColor" width="16px" height="16px" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M116,184a12,12,0,0,1-12,12H84v20a12,12,0,0,1-24,0V196H40a12,12,0,0,1,0-24H60V152a12,12,0,0,1,24,0v20h20A12,12,0,0,1,116,184ZM104,60H40a12,12,0,0,0,0,24h64a12,12,0,0,0,0-24Zm48,116.06641h64a12,12,0,0,0,0-24H152a12,12,0,0,0,0,24Zm64,15.86718H152a12,12,0,0,0,0,24h64a12,12,0,0,0,0-24Zm-64.48535-87.44824a12.00033,12.00033,0,0,0,16.9707,0L184,88.9707l15.51465,15.51465a12.0001,12.0001,0,0,0,16.9707-16.9707L200.9707,72l15.51465-15.51465a12.0001,12.0001,0,0,0-16.9707-16.9707L184,55.0293,168.48535,39.51465a12.0001,12.0001,0,0,0-16.9707,16.9707L167.0293,72,151.51465,87.51465A12.00062,12.00062,0,0,0,151.51465,104.48535Z"/>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                @if (showC3Distance()) {
                                    <div class="target-secondary-row">
                                        <div class="target-identity-spacer" aria-hidden="true"></div>
                                        <div class="target-controls-row target-c3-controls">
                                            <div class="target-number-field" [class.disabled-field]="!c3Enabled(target)">
                                                <span>C³ Distance</span>
                                                <span class="target-stepper">
                                                    <button class="bt-button square-small" type="button" [disabled]="!c3Enabled(target)" (click)="stepC3Distance(target, -1)">-</button>
                                                    <input class="value" type="number" min="0" step="1" [disabled]="!c3Enabled(target)" [value]="c3DistanceInputValue(target)" (input)="updateC3Distance(target, $any($event.target).value)">
                                                    <button class="bt-button square-small" type="button" [disabled]="!c3Enabled(target)" (click)="stepC3Distance(target, 1)">+</button>
                                                </span>
                                            </div>
                                            <div class="target-number-field use-c3-field">
                                                <label class="use-c3-toggle">
                                                    <input type="checkbox" class="bt-checkbox" [checked]="useC3Checked(target)" (change)="updateUseC3(target, $event)">
                                                    <span>Use C³</span>
                                                </label>
                                            </div>
                                            <span class="calculator-spacer" aria-hidden="true"></span>
                                        </div>
                                    </div>
                                }
                            </div>
                            <div class="target-delete-row">
                                <button class="target-delete" type="button" aria-label="Delete target" title="Delete target" (click)="deleteRequest.emit(target.id)">
                                    <svg _ngcontent-ng-c1165242001="" width="18px" height="18px" fill="currentColor" viewBox="0 0 1200 1200" version="1.1" xmlns="http://www.w3.org/2000/svg"><path _ngcontent-ng-c1165242001="" d="M0,264.84L335.16,600L0,935.16L264.84,1200L600,864.84L935.16,1200
                                        L1200,935.16L864.84,600L1200,264.84L935.16,0L600,335.16L264.84,0L0,264.84z"></path></svg>
                                </button>
                            </div>
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
            padding: 4px 8px 4px 12px;
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
            flex: 0 0 auto;
        }

        .target-square {
            inline-size: var(--target-control-height);
            block-size: var(--target-control-height);
            flex: 0 0 var(--target-control-height);
        }

        .target-name {
            min-width: 0;
            width: 100%;
            height: var(--target-control-height);
            box-sizing: border-box;
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
            min-width: var(--target-control-height);
            min-height: var(--target-control-height);
            color: #999;
            border: 0;
            padding: 2px 0 2px 0;
            background: transparent;
            cursor: pointer;
            transition: color 0.2s;
            margin-top: 18px;

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

            .target-identity-row,
            .target-controls-row {
                flex: 1 1 100%;
                width: 100%;
            }

            .target-delete {
                margin-top: 6px;
            }
        }
    `]
})
export class WeaponTargetsMenuComponent {
    readonly tnModifierTooltip = 'Target-side TN modifier for this target. Use it for target movement, indirect fire, spotter movement, terrain, cover, stance, and similar target conditions. It is added separately from your unit skill, your movement, range, heat, and weapon modifiers. The calculator can fill it, and you can still override it manually.';
    readonly targets = input<InventoryControlRuntimeTarget[]>([]);
    readonly colors = input<readonly string[]>(INVENTORY_CONTROL_TARGET_COLORS);
    readonly maxTargets = input(INVENTORY_CONTROL_TARGET_MAX_COUNT);
    readonly unassignedMovement = input(false);
    readonly showC3Distance = input(false);
    readonly readOnly = input(false);

    readonly addRequest = output<void>();
    readonly resetRequest = output<void>();
    readonly updateRequest = output<WeaponTargetUpdateRequest>();
    readonly deleteRequest = output<InventoryControlRuntimeTargetId>();
    readonly calculatorRequest = output<WeaponTargetCalculatorRequest>();

    updateName(targetId: InventoryControlRuntimeTargetId, name: string): void {
        this.updateRequest.emit({ targetId, patch: { name } });
    }

    updateColor(targetId: InventoryControlRuntimeTargetId, color: string): void {
        this.updateRequest.emit({ targetId, patch: { color } });
    }

    updateDistance(targetId: InventoryControlRuntimeTargetId, value: string): void {
        this.updateRequest.emit({ targetId, patch: { distance: this.parseNumber(value, 0, true) } });
    }

    updateC3Distance(target: InventoryControlRuntimeTarget, value: string): void {
        if (!this.c3Enabled(target)) return;
        this.updateRequest.emit({ targetId: target.id, patch: { c3Distance: this.parseNumber(value, 0, true) } });
    }

    updateUseC3(target: InventoryControlRuntimeTarget, event: Event): void {
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
        this.updateRequest.emit({ targetId, patch: { tnModifier: this.parseNumber(value, 0, false) } });
    }

    stepDistance(target: InventoryControlRuntimeTarget, delta: number): void {
        this.updateRequest.emit({ targetId: target.id, patch: { distance: Math.max(0, target.distance + delta) } });
    }

    stepC3Distance(target: InventoryControlRuntimeTarget, delta: number): void {
        if (!this.c3Enabled(target)) return;
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

    useC3Checked(target: InventoryControlRuntimeTarget): boolean {
        return target.useC3 === true;
    }

    stepTnModifier(target: InventoryControlRuntimeTarget, delta: number): void {
        this.updateRequest.emit({ targetId: target.id, patch: { tnModifier: target.tnModifier + delta } });
    }

    openTnCalculator(targetId: InventoryControlRuntimeTargetId, event: MouseEvent): void {
        this.calculatorRequest.emit({ targetId, origin: event.currentTarget as HTMLElement });
    }

    private parseNumber(value: string, fallback: number, clampMinZero: boolean): number {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return clampMinZero ? Math.max(0, parsed) : parsed;
    }
}