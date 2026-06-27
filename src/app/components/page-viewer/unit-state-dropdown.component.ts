import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CdkMenuModule } from '@angular/cdk/menu';

export interface UnitStateDropdownChoice {
    key: string;
    label: string;
    color: string;
    active: boolean;
    counted?: boolean;
    value?: number;
}

@Component({
    selector: 'unit-state-dropdown',
    standalone: true,
    imports: [CdkMenuModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="unit-state-dropdown has-shadow" cdkMenu aria-label="Unit states">
            @for (choice of choices(); track choice.key) {
                @if (choice.counted) {
                    <div
                        class="unit-state-dropdown-item counted"
                        [class.has-count]="choice.active"
                        [style.--unit-state-color]="choice.color">
                        <button class="count-button" type="button" [disabled]="!choice.active" (click)="decremented.emit(choice.key)">-</button>
                        <button class="state-label-button" type="button" (click)="selected.emit(choice.key)">
                            <span class="state-label">{{ choice.label }}</span>
                            <span class="state-count">{{ choice.value ?? 0 }}</span>
                        </button>
                        <button class="count-button" type="button" (click)="incremented.emit(choice.key)">+</button>
                    </div>
                } @else {
                    <button
                        class="unit-state-dropdown-item"
                        type="button"
                        cdkMenuItemCheckbox
                        [cdkMenuItemChecked]="choice.active"
                        [attr.aria-checked]="choice.active"
                        [class.active]="choice.active"
                        [style.--unit-state-color]="choice.color"
                        (click)="selected.emit(choice.key)">
                        <span class="state-label">{{ choice.label }}</span>
                    </button>
                }
            }
        </div>
    `,
    styles: [`
        .unit-state-dropdown {
            display: flex;
            flex-direction: column;
            min-width: 136px;
            padding: 3px;
            gap: 2px;
            border: 1px solid black;
            background-color: white;
        }

        .unit-state-dropdown,
        .unit-state-dropdown * {
            box-sizing: border-box;
        }

        .unit-state-dropdown-item {
            display: grid;
            grid-template-columns: 12px 1fr auto;
            align-items: center;
            gap: 8px;
            width: 100%;
            min-height: 30px;
            padding: 5px 8px;
            border: 0;
            background: transparent;
            color: black;
            font: inherit;
            font-size: 12px;
            font-weight: 700;
            text-align: left;
            cursor: pointer;
        }

        .unit-state-dropdown-item.counted {
            grid-template-columns: 18px minmax(0, 1fr) 18px;
            gap: 3px;
            min-height: 30px;
            padding: 4px 6px;
            background: transparent;
            cursor: default;
        }

        .state-label-button,
        .count-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 0;
            border: 1px solid transparent;
            background: transparent;
            color: inherit;
            font: inherit;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
        }

        .state-label-button {
            justify-content: space-between;
            gap: 4px;
            height: 20px;
            padding: 0 3px;
            border-radius: 2px;
            text-align: left;
        }

        .count-button {
            width: 18px;
            height: 18px;
            padding: 0;
            border: 0;
            line-height: 1;
        }

        .unit-state-dropdown-item.counted.has-count .state-label-button {
            color: var(--unit-state-color);
        }

        .count-button:disabled {
            opacity: 0.35;
            cursor: default;
        }

        .unit-state-dropdown-item:hover,
        .unit-state-dropdown-item:focus-visible,
        .state-label-button:hover,
        .state-label-button:focus-visible,
        .count-button:not(:disabled):hover,
        .count-button:not(:disabled):focus-visible {
            outline: none;
            background-color: #ddd;
        }

        .unit-state-dropdown-item.active {
            background-color: var(--unit-state-color);
        }

        .unit-state-dropdown-item.active:hover,
        .unit-state-dropdown-item.active:focus-visible {
            background-color: color-mix(in srgb, var(--unit-state-color) 62%, transparent);
        }

        .unit-state-dropdown-item:not(.counted) .state-label {
            grid-column: 1 / -1;
        }

        .unit-state-dropdown-item.counted.active,
        .unit-state-dropdown-item.counted.has-count {
            background: transparent;
        }

        .state-count {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 auto;
            min-width: 16px;
            height: 16px;
            padding: 0 3px;
            background-color: var(--unit-state-color);
            color: white;
            font-size: 11px;
            line-height: 1;
        }

        .state-label {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    `]
})
export class UnitStateDropdownComponent {
    readonly choices = input<UnitStateDropdownChoice[]>([]);
    readonly closeOnSelect = input(true);
    readonly selected = output<string>();
    readonly incremented = output<string>();
    readonly decremented = output<string>();
}
