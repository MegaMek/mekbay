import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { InventoryControlRuntimeTarget, InventoryControlRuntimeTargetId } from '../../models/inventory-control-runtime-state.model';

@Component({
    selector: 'weapon-target-choice-menu',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="weapon-target-choice-menu glass framed-borders has-shadow">
            <button
                class="target-choice empty-choice"
                type="button"
                [class.selected-choice]="selectedTargetId() === null"
                aria-label="No target"
                title="No target"
                (click)="selected.emit(null)">
                <span class="target-choice-token">—</span>
            </button>
            <div class="target-choices">
                @for (target of targets(); track target.id) {
                    <button
                        class="target-choice"
                        type="button"
                        [class.selected-choice]="selectedTargetId() === target.id"
                        [attr.aria-label]="targetAriaLabel(target)"
                        [title]="target.name"
                        (click)="selected.emit(target.id)">
                        <span class="target-choice-token" [style.background]="target.color">{{ target.letter }}</span>
                        @if (targetNumberText(target.id); as targetNumber) {
                            @if (targetNumber == '') {
                                <span class="target-choice-tn"></span>
                            } @else if (targetNumber == 'X') {
                                <span class="target-choice-tn square out-of-range" title="Out of range">X</span>
                            } @else {
                                <span class="target-choice-tn square">{{ targetNumber }}</span>
                            }
                        }
                    </button>
                }
            </div>
        </div>
    `,
    styles: [`
        .weapon-target-choice-menu {
            display: flex;
            flex-direction: row;
            gap: 6px;
            padding: 8px;
            max-width: min(245px, calc(100dvw - 16px));
        }

        .target-choices {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }

        .target-choice {
            display: inline-flex;
            flex-direction: column;
            align-items: center;
            justify-content: start;
            padding: 0;
            gap: 3px;
            border: 0;
            background: transparent;
            color: var(--text-color);
            font: inherit;
            cursor: pointer;
        }

        .target-choice-token {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            inline-size: 28px;
            block-size: 28px;
            border: 1px solid rgba(255, 255, 255, 0.45);
            font-weight: 800;
            color: #111;
        }

        .target-choice.empty-choice .target-choice-token {
            color: var(--text-color-secondary);
        }

        .target-choice.selected-choice .target-choice-token {
            border: 1px solid var(--bt-yellow);
        }

        .target-choice-tn {
            color: var(--text-color);
            font-size: 10px;
            font-weight: 700;
            line-height: 1;
            white-space: nowrap;

            &.square {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                inline-size: 16px;
                block-size: 16px;
                border: 1px solid var(--text-color-secondary);
                font-size: 10px;
                font-weight: 700;
            }

            &.out-of-range {
                color: var(--damage-color);
                border-color: var(--damage-color);
            }
        }
    `]
})
export class WeaponTargetChoiceMenuComponent {
    readonly targets = input<InventoryControlRuntimeTarget[]>([]);
    readonly selectedTargetId = input<InventoryControlRuntimeTargetId | null>(null);
    readonly targetNumberTexts = input<Readonly<Record<InventoryControlRuntimeTargetId, string>>>({});
    readonly selected = output<InventoryControlRuntimeTargetId | null>();

    targetNumberText(targetId: InventoryControlRuntimeTargetId): string {
        return this.targetNumberTexts()[targetId] ?? '';
    }

    targetAriaLabel(target: InventoryControlRuntimeTarget): string {
        const targetNumber = this.targetNumberText(target.id);
        return targetNumber ? `${target.name}, TN ${targetNumber}` : target.name;
    }
}