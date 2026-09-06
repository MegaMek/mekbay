// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';



export interface SkillPreviewEntry {
    skill: number;
    adjustedValue: number;
    delta: number;
}

@Component({
    selector: 'skill-dropdown-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="dropdown-panel glass has-shadow framed-borders" data-scroll-container>
            @if (title()) {
                <div class="panel-title">{{ title() }}</div>
            }
            @for (entry of entries(); track entry.skill) {
                <div class="skill-option"
                     [class.active]="entry.skill === selectedSkill()"
                     [class.skill-only]="!showPreview()"
                     (click)="onSelect(entry.skill)">
                    <span class="skill-value">{{ entry.skill }}</span>
                    @if (showPreview()) {
                    <span class="adjusted-value">{{ valueLabel() }}: {{ entry.adjustedValue }}</span>
                    <span class="delta" [class.positive]="entry.delta > 0" [class.negative]="entry.delta < 0">
                        @if (entry.delta !== 0) {
                            {{ entry.delta > 0 ? '+' : '' }}{{ entry.delta }}
                        }
                    </span>
                    }
                </div>
            }
        </div>
    `,
    styles: [`
        :host {
            display: block;
            width: 100%;
        }

        .dropdown-panel {
            box-sizing: border-box;
            overflow-y: auto;
            container-type: inline-size;
        }

        .panel-title {
            padding: 8px 12px 4px;
            font-size: 0.75em;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-color-tertiary);
        }

        .skill-option {
            padding: 8px 6px;
            min-width: max-content;
            cursor: pointer;
            display: grid;
            grid-template-columns: 1.5em auto 3em;
            align-items: center;
            gap: 4px;
            border-left: 3px solid transparent;
            white-space: nowrap;
        }

        .skill-value {
            font-weight: 700;
            font-size: 1.1em;
            text-align: left;
            color: var(--text-color);
        }

        .skill-option.skill-only {
            grid-template-columns: 1fr;
        }

        @container (min-width: 200px) {
            .skill-option {
                padding: 8px 16px;
                grid-template-columns: 2em auto 3.5em;
                gap: 8px;
            }
        }

        @container (min-width: 300px) {
            .skill-option {
                justify-content: space-between;
            }
            .skill-value {
                text-align: center;
            }
        }

        .skill-option:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .skill-option.active {
            background: var(--bt-yellow-background-transparent);
            border-left: 3px solid var(--bt-yellow);
        }

        .skill-option.active:hover {
            background: var(--bt-yellow-background-bright-transparent);
        }

        .adjusted-value {
            text-align: right;
            font-size: 0.9em;
            color: var(--text-color-secondary);
        }

        .delta {
            min-width: 36px;
            text-align: right;
            font-weight: 600;
            font-size: 0.85em;
        }

        .delta.positive {
            color: #4caf50;
        }

        .delta.negative {
            color: #f44336;
        }
    `]
})
export class SkillDropdownPanelComponent {
    entries = input.required<SkillPreviewEntry[]>();
    selectedSkill = input<number>(4);
    valueLabel = input<string>('BV');
    showPreview = input(true);
    title = input<string>('');

    selected = output<number>();

    onSelect(skill: number): void {
        this.selected.emit(skill);
    }
}
