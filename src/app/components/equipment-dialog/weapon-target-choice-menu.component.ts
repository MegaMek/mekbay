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
                <span class="target-choice-tn" aria-hidden="true"></span>
                <span class="target-choice-name">No target</span>
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
                        @if (targetNumberText(target.id) === 'X') {
                            <span class="target-choice-tn square out-of-range" title="Out of range">X</span>
                        } @else if (targetNumberText(target.id)) {
                            <span class="target-choice-tn square">{{ targetNumberText(target.id) }}</span>
                        } @else {
                            <span class="target-choice-tn"></span>
                        }
                        <span class="target-choice-name">{{ target.name }}</span>
                    </button>
                }
            </div>
        </div>
    `,
    styles: [`
        .weapon-target-choice-menu {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 8px;
            inline-size: min(300px, calc(100dvw - 16px));
            max-block-size: min(420px, calc(100dvh - 16px));
            overflow: auto;
        }

        .target-choices {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .target-choice {
            display: grid;
            grid-template-columns: 28px 28px minmax(0, 1fr);
            align-items: center;
            min-inline-size: 0;
            min-block-size: 32px;
            padding: 2px;
            gap: 8px;
            border: 2px solid transparent;
            background: transparent;
            color: var(--text-color);
            font: inherit;
            text-align: start;
            cursor: pointer;

            &:hover {
                background: var(--hover-bg-color, rgba(255, 255, 255, 0.08));
            }
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

        .target-choice.selected-choice {
            border-color: var(--bt-yellow);
            background-color: var(--bt-yellow-background);
        }

        .target-choice-tn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            inline-size: 28px;
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

        .target-choice-name {
            min-inline-size: 0;
            overflow: hidden;
            color: var(--text-color);
            text-overflow: ellipsis;
            white-space: nowrap;
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