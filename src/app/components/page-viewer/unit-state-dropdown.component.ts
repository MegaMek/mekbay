import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CdkMenuModule } from '@angular/cdk/menu';

export interface UnitStateDropdownChoice {
    key: string;
    label: string;
    color: string;
    active: boolean;
}

@Component({
    selector: 'unit-state-dropdown',
    standalone: true,
    imports: [CdkMenuModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="unit-state-dropdown has-shadow" cdkMenu aria-label="Unit states">
            @for (choice of choices(); track choice.key) {
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
        </div>
    `,
    styles: [`
        .unit-state-dropdown {
            display: flex;
            flex-direction: column;
            min-width: 128px;
            padding: 2px;
            gap: 2px;
            border: 1px solid black;
            background-color: white;
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

        .unit-state-dropdown-item:hover,
        .unit-state-dropdown-item:focus-visible {
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

        .state-label {
            white-space: nowrap;
        }
    `]
})
export class UnitStateDropdownComponent {
    readonly choices = input<UnitStateDropdownChoice[]>([]);
    readonly closeOnSelect = input(true);
    readonly selected = output<string>();
}
