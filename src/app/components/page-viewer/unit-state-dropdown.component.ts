import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { CdkMenuModule } from '@angular/cdk/menu';

type UnitStateDropdownAction = 'selected' | 'incremented' | 'decremented';

interface UnitStateDropdownTarget {
    key: string;
    action: UnitStateDropdownAction;
}

export interface UnitStateDropdownChoice {
    key: string;
    label: string;
    color: string;
    active: boolean;
    counted?: boolean;
    isBreak?: boolean;
    value?: number;
}

@Component({
    selector: 'unit-state-dropdown',
    standalone: true,
    imports: [CdkMenuModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div #dropdown class="unit-state-dropdown has-shadow" cdkMenu aria-label="Unit states">
            @for (choice of choices(); track choice.isBreak ? $index : choice.key) {
                @if (choice.isBreak) {
                    <div class="unit-state-dropdown-break" aria-hidden="true"></div>
                } @else if (choice.counted) {
                    <div
                        class="unit-state-dropdown-item counted"
                        [class.has-count]="choice.active"
                        [class.drag-hover]="isHovered(choice)"
                        [style.--unit-state-color]="choice.color">
                        <button
                            class="count-button"
                            type="button"
                            [disabled]="!choice.active"
                            [class.drag-hover]="isHovered(choice, 'decremented')"
                            [attr.data-unit-state-key]="choice.key"
                            data-unit-state-action="decremented"
                            (click)="decremented.emit(choice.key)">-</button>
                        <button
                            class="state-label-button"
                            type="button"
                            [class.drag-hover]="isHovered(choice, 'selected')"
                            [attr.data-unit-state-key]="choice.key"
                            data-unit-state-action="selected"
                            (click)="selected.emit(choice.key)">
                            <span class="state-label">{{ choice.label }}</span>
                            <span class="state-count">{{ choice.value ?? 0 }}</span>
                        </button>
                        <button
                            class="count-button"
                            type="button"
                            [class.drag-hover]="isHovered(choice, 'incremented')"
                            [attr.data-unit-state-key]="choice.key"
                            data-unit-state-action="incremented"
                            (click)="incremented.emit(choice.key)">+</button>
                    </div>
                } @else {
                    <button
                        class="unit-state-dropdown-item"
                        type="button"
                        cdkMenuItemCheckbox
                        [cdkMenuItemChecked]="choice.active"
                        [attr.aria-checked]="choice.active"
                        [class.active]="choice.active"
                        [class.drag-hover]="isHovered(choice, 'selected')"
                        [style.--unit-state-color]="choice.color"
                        [attr.data-unit-state-key]="choice.key"
                        data-unit-state-action="selected"
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

        .unit-state-dropdown-break {
            height: 1px;
            margin: 4px 2px;
            background-color: #bbb;
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
        .unit-state-dropdown-item.drag-hover,
        .unit-state-dropdown-item.counted.drag-hover,
        .state-label-button:hover,
        .state-label-button:focus-visible,
        .state-label-button.drag-hover,
        .count-button:not(:disabled):hover,
        .count-button:not(:disabled):focus-visible,
        .count-button.drag-hover:not(:disabled) {
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
    private readonly destroyRef = inject(DestroyRef);

    private activePointerId: number | null = null;

    private readonly dropdownRef = viewChild<ElementRef<HTMLDivElement>>('dropdown');

    readonly choices = input<UnitStateDropdownChoice[]>([]);
    readonly closeOnSelect = input(true);
    readonly initialEvent = input<PointerEvent | null>(null);
    readonly selected = output<string>();
    readonly incremented = output<string>();
    readonly decremented = output<string>();
    readonly cancelled = output<void>();
    readonly holdSelectionCompleted = output<void>();

    readonly hoveredTarget = signal<UnitStateDropdownTarget | null>(null);

    constructor() {
        effect((cleanup) => {
            const initialEvent = this.initialEvent();
            if (!initialEvent || initialEvent.type !== 'pointerdown') return;

            this.setupHoldSelection(initialEvent);
            cleanup(() => this.cleanupHoldSelection());
        });

        this.destroyRef.onDestroy(() => this.cleanupHoldSelection());
    }

    isHovered(choice: UnitStateDropdownChoice, action?: UnitStateDropdownAction): boolean {
        const hoveredTarget = this.hoveredTarget();
        return hoveredTarget?.key === choice.key && (!action || hoveredTarget.action === action);
    }

    private setupHoldSelection(initialEvent: PointerEvent): void {
        this.cleanupHoldSelection();
        this.activePointerId = initialEvent.pointerId;
        window.addEventListener('pointermove', this.onHoldPointerMove, { capture: true, passive: false });
        window.addEventListener('pointerup', this.onHoldPointerUp, { capture: true, passive: false });
        window.addEventListener('pointercancel', this.onHoldPointerCancel, { capture: true, passive: false });
    }

    private cleanupHoldSelection(): void {
        this.activePointerId = null;
        this.hoveredTarget.set(null);
        window.removeEventListener('pointermove', this.onHoldPointerMove, true);
        window.removeEventListener('pointerup', this.onHoldPointerUp, true);
        window.removeEventListener('pointercancel', this.onHoldPointerCancel, true);
    }

    private readonly onHoldPointerMove = (event: PointerEvent): void => {
        if (event.pointerId !== this.activePointerId) return;
        event.preventDefault();
        event.stopPropagation();
        this.hoveredTarget.set(this.targetFromPoint(event.clientX, event.clientY));
    };

    private readonly onHoldPointerUp = (event: PointerEvent): void => {
        if (event.pointerId !== this.activePointerId) return;
        event.preventDefault();
        event.stopPropagation();

        const target = this.targetFromPoint(event.clientX, event.clientY) ?? this.hoveredTarget();
        this.cleanupHoldSelection();

        if (!target) {
            this.cancelled.emit();
            return;
        }

        this.emitTarget(target);
        this.holdSelectionCompleted.emit();
    };

    private readonly onHoldPointerCancel = (event: PointerEvent): void => {
        if (event.pointerId !== this.activePointerId) return;
        this.cleanupHoldSelection();
        this.cancelled.emit();
    };

    private targetFromPoint(clientX: number, clientY: number): UnitStateDropdownTarget | null {
        const dropdown = this.dropdownRef()?.nativeElement;
        if (!dropdown) return null;

        const element = document.elementFromPoint(clientX, clientY);
        const button = element?.closest<HTMLElement>('[data-unit-state-key][data-unit-state-action]') ?? null;
        if (!button || !dropdown.contains(button)) return null;
        if (button instanceof HTMLButtonElement && button.disabled) return null;

        const key = button.dataset['unitStateKey'];
        const action = button.dataset['unitStateAction'] as UnitStateDropdownAction | undefined;
        if (!key || !action || !this.isDropdownAction(action)) return null;

        return { key, action };
    }

    private isDropdownAction(action: string): action is UnitStateDropdownAction {
        return action === 'selected' || action === 'incremented' || action === 'decremented';
    }

    private emitTarget(target: UnitStateDropdownTarget): void {
        if (target.action === 'incremented') {
            this.incremented.emit(target.key);
        } else if (target.action === 'decremented') {
            this.decremented.emit(target.key);
        } else {
            this.selected.emit(target.key);
        }
    }
}
