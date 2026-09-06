// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { InventoryControlOpforService } from '../../services/inventory-control-opfor.service';
import { ChangeDetectionStrategy, Component, input, output, inject } from '@angular/core';
import type { EncounterTargetId } from '../../models/runtime/encounter-runtime';

/** Detached presentation row shared by legacy and Entity/runtime target surfaces. */
export interface WeaponTargetChoiceRow {
    readonly id: EncounterTargetId;
    readonly letter: string;
    readonly name: string;
    readonly color: string;
}

@Component({
    selector: 'weapon-target-choice-menu',
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
                        [disabled]="targetDisabledReason(target.id) !== null"
                        [attr.aria-label]="targetAriaLabel(target)"
                        [title]="targetDisabledReason(target.id) ?? targetNames.targetName(target.id, target.name)"
                        (click)="selected.emit(target.id)">
                        <span class="target-choice-token" [style.background]="target.color">{{ target.letter }}</span>
                        @if (targetDisabledReason(target.id); as disabledReason) {
                            <span class="target-choice-tn square out-of-range" [title]="disabledReason">X</span>
                        } @else if (targetNumberText(target.id) === 'X') {
                            <span class="target-choice-tn square out-of-range" title="Out of range">X</span>
                        } @else if (targetNumberText(target.id)) {
                            <span class="target-choice-tn square">{{ targetNumberText(target.id) }}</span>
                        } @else {
                            <span class="target-choice-tn"></span>
                        }
                        <span class="target-choice-name">{{ targetNames.targetName(target.id, target.name) }}</span>
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

            &:not(:disabled):hover {
                background: var(--hover-bg-color, rgba(255, 255, 255, 0.08));
            }

            &:disabled {
                opacity: 0.65;
                cursor: not-allowed;
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
            font-size: 1.3em;
            font-weight: 700;
            line-height: 1;
            white-space: nowrap;

            &.square {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                inline-size: 24px;
                block-size: 24px;
                border: 1px solid var(--text-color-secondary);
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
    readonly targetNames = inject(InventoryControlOpforService);
    readonly targets = input<readonly WeaponTargetChoiceRow[]>([]);
    readonly selectedTargetId = input<EncounterTargetId | null>(null);
    readonly targetNumberTexts = input<Readonly<Record<EncounterTargetId, string>>>({});
    readonly disabledTargetReasons = input<Readonly<Record<EncounterTargetId, string>>>({});
    readonly selected = output<EncounterTargetId | null>();

    targetNumberText(targetId: EncounterTargetId): string {
        return this.targetNumberTexts()[targetId] ?? '';
    }

    targetDisabledReason(targetId: EncounterTargetId): string | null {
        return this.disabledTargetReasons()[targetId] ?? null;
    }

    targetAriaLabel(target: WeaponTargetChoiceRow): string {
        const targetNumber = this.targetNumberText(target.id);
        const disabledReason = this.targetDisabledReason(target.id);
        if (disabledReason) return `${this.targetNames.targetName(target.id, target.name)}, unavailable: ${disabledReason}`;
        return targetNumber ? `${this.targetNames.targetName(target.id, target.name)}, TN ${targetNumber}` : this.targetNames.targetName(target.id, target.name);
    }
}
