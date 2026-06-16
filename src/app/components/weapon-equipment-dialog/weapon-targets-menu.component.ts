import { ChangeDetectionStrategy, Component, afterNextRender, input, output, signal } from '@angular/core';
import { ColorPickerButtonComponent } from '../color-picker-button/color-picker-button.component';
import {
    INVENTORY_CONTROL_TARGET_COLORS,
    INVENTORY_CONTROL_TARGET_MAX_COUNT,
    type InventoryControlRuntimeTarget,
    type InventoryControlRuntimeTargetId
} from '../../models/inventory-control-runtime-state.model';

export interface WeaponTargetUpdateRequest {
    targetId: InventoryControlRuntimeTargetId;
    patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>;
}

@Component({
    selector: 'weapon-targets-menu',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ColorPickerButtonComponent],
    host: {
        '[class.ready]': 'ready()'
    },
    template: `
        <div class="weapon-targets-menu glass framed-borders has-shadow">
            <div class="weapon-targets-header">
                <div class="weapon-targets-header-group">
                    <button class="bt-button square-small" type="button" aria-label="Add target" title="Add target" [disabled]="readOnly() || targets().length >= maxTargets()" (click)="addRequest.emit()">+</button>
                    <strong>Targets</strong>
                </div>
                    <button class="targets-delete" type="button" aria-label="Reset targets" title="Reset targets" [disabled]="readOnly() || targets().length === 0" (click)="resetRequest.emit()">
                            <svg _ngcontent-ng-c1165242001="" width="18px" height="18px" fill="currentColor" viewBox="0 0 1200 1200" version="1.1" xmlns="http://www.w3.org/2000/svg"><path _ngcontent-ng-c1165242001="" d="M0,264.84L335.16,600L0,935.16L264.84,1200L600,864.84L935.16,1200
                                        L1200,935.16L864.84,600L1200,264.84L935.16,0L600,335.16L264.84,0L0,264.84z"></path></svg>
                    </button>
            </div>
            <div class="weapon-targets-list">
                @if (targets().length === 0) {
                    <div class="weapon-targets-empty">No targets</div>
                } @else {
                    @for (target of targets(); track target.id) {
                        <div class="weapon-target-row">
                            <div class="target-identity-row">
                                <color-picker-button
                                    class="target-square"
                                    [value]="target.color"
                                    [colors]="colors()"
                                    [disabled]="readOnly()"
                                    [ariaLabel]="'Choose color for ' + target.name"
                                    (pickerOpened)="colorPickerOpened.emit()"
                                    (pickerClosed)="colorPickerClosed.emit()"
                                    (valueChange)="updateColor(target.id, $event)">
                                    {{ target.letter }}
                                </color-picker-button>
                                <input class="bt-input target-name" type="text" [value]="target.name" [disabled]="readOnly()" (input)="updateName(target.id, $any($event.target).value)">
                            </div>
                            <div class="target-controls-row">
                                <label class="target-number-field">
                                    <span>Distance</span>
                                    <span class="target-stepper">
                                        <button class="bt-button square-small" type="button" [disabled]="readOnly()" (click)="stepDistance(target, -1)">-</button>
                                        <input class="bt-input" type="number" min="0" step="1" [value]="target.distance" [disabled]="readOnly()" (input)="updateDistance(target.id, $any($event.target).value)">
                                        <button class="bt-button square-small" type="button" [disabled]="readOnly()" (click)="stepDistance(target, 1)">+</button>
                                    </span>
                                </label>
                                <label class="target-number-field">
                                    <span>TN Modifier</span>
                                    <span class="target-stepper">
                                        <button class="bt-button square-small" type="button" [disabled]="readOnly()" (click)="stepTnModifier(target, -1)">-</button>
                                        <input class="bt-input" type="number" step="1" [value]="target.tnModifier" [disabled]="readOnly()" (input)="updateTnModifier(target.id, $any($event.target).value)">
                                        <button class="bt-button square-small" type="button" [disabled]="readOnly()" (click)="stepTnModifier(target, 1)">+</button>
                                    </span>
                                </label>
                            </div>
                            <div class="target-delete-row">
                                <button class="target-delete" type="button" aria-label="Delete target" title="Delete target" [disabled]="readOnly()" (click)="deleteRequest.emit(target.id)">
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
        :host:not(.ready) .bt-button {
            transition: none !important;
        }

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
            padding: 10px 12px;
            border-bottom: 1px solid var(--border-color);
            color: var(--text-color-secondary);
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
        }

        .weapon-targets-empty {
            padding: 23px 16px;
            color: var(--text-color-secondary);
            text-align: center;
        }

        .weapon-target-row {
            display: flex;
            gap: 10px;
            align-items: end;
            flex-wrap: nowrap;
            padding: 4px 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);

            &:last-child {
                border-bottom: 0;
                padding-bottom: 12px;
            }
        }

        .weapon-target-row:last-child {
            border-bottom: 0;
        }

        .target-identity-row {
            display: flex;
            gap: 8px;
            align-items: end;
            flex: 1 1 180px;
            min-width: 0;
        }

        .target-controls-row {
            display: flex;
            gap: 8px;
            align-items: end;
            flex: 0 0 auto;
        }

        .target-delete-row {
            display: flex;
            align-items: end;
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
        }

        .target-stepper {
            display: grid;
            grid-template-columns: var(--target-control-height) minmax(42px, 1fr) var(--target-control-height);
            gap: 3px;
            align-items: center;
            width: 136px;
        }

        .target-stepper .bt-button {
            min-width: var(--target-control-height);
            min-height: var(--target-control-height);
            transition: none;
        }

        .target-stepper input {
            min-width: 0;
            width: 100%;
            height: var(--target-control-height);
            box-sizing: border-box;
            text-align: center;
            font-variant-numeric: tabular-nums;
        }

        .targets-delete,
        .target-delete {
            min-width: var(--target-control-height);
            min-height: var(--target-control-height);
            color: #999;
            border: 0;
            padding: 0;
            background: transparent;
            cursor: pointer;
            transition: color 0.2s;

            &:hover {
                color: var(--damage-color);
            }
        }

        @container (max-width: 500px) {
            .weapon-target-row {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                gap: 10px;
                align-items: stretch;
            }

            .target-identity-row {
                grid-column: 1;
                grid-row: 1;
                align-items: center;
            }

            .target-delete-row {
                grid-column: 2;
                grid-row: 1;
                align-items: center;
            }

            .target-controls-row {
                grid-column: 1 / -1;
                grid-row: 2;
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
                gap: 8px;
                padding-left: 32px;
            }

            .target-stepper {
                width: 100%;
            }
        }
    `]
})
export class WeaponTargetsMenuComponent {
    readonly targets = input<InventoryControlRuntimeTarget[]>([]);
    readonly colors = input<readonly string[]>(INVENTORY_CONTROL_TARGET_COLORS);
    readonly maxTargets = input(INVENTORY_CONTROL_TARGET_MAX_COUNT);
    readonly readOnly = input(false);
    readonly ready = signal(false);

    readonly addRequest = output<void>();
    readonly resetRequest = output<void>();
    readonly updateRequest = output<WeaponTargetUpdateRequest>();
    readonly deleteRequest = output<InventoryControlRuntimeTargetId>();
    readonly colorPickerOpened = output<void>();
    readonly colorPickerClosed = output<void>();

    constructor() {
        afterNextRender(() => this.ready.set(true));
    }

    updateName(targetId: InventoryControlRuntimeTargetId, name: string): void {
        this.updateRequest.emit({ targetId, patch: { name } });
    }

    updateColor(targetId: InventoryControlRuntimeTargetId, color: string): void {
        this.updateRequest.emit({ targetId, patch: { color } });
    }

    updateDistance(targetId: InventoryControlRuntimeTargetId, value: string): void {
        this.updateRequest.emit({ targetId, patch: { distance: this.parseNumber(value, 0, true) } });
    }

    updateTnModifier(targetId: InventoryControlRuntimeTargetId, value: string): void {
        this.updateRequest.emit({ targetId, patch: { tnModifier: this.parseNumber(value, 0, false) } });
    }

    stepDistance(target: InventoryControlRuntimeTarget, delta: number): void {
        this.updateRequest.emit({ targetId: target.id, patch: { distance: Math.max(0, target.distance + delta) } });
    }

    stepTnModifier(target: InventoryControlRuntimeTarget, delta: number): void {
        this.updateRequest.emit({ targetId: target.id, patch: { tnModifier: target.tnModifier + delta } });
    }

    private parseNumber(value: string, fallback: number, clampMinZero: boolean): number {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return clampMinZero ? Math.max(0, parsed) : parsed;
    }
}