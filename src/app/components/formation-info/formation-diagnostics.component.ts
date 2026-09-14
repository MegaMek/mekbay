// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { FormationConstraintEvaluation, FormationEvaluation } from '../../utils/formation/formation-requirement.model';
import type { FormationUnitLike } from '../../utils/formation/formation-facts.util';
import { UnitNameService } from '../../services/unit-name.service';

@Component({
    selector: 'formation-diagnostics',
    imports: [NgTemplateOutlet],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="formation-diagnostics">
            <ng-container *ngTemplateOutlet="requirements; context: { $implicit: evaluation().constraints }"></ng-container>
        </div>
        <ng-template #requirements let-constraints>
            <ul class="requirement-results">
                @for (constraint of visibleConstraints(constraints); track constraint.constraintId) {
                    <li [class.requirement-failed]="!constraint.satisfied">
                        <span class="requirement-status">
                            <svg viewBox="0 0 16 16" role="img" [attr.aria-label]="constraint.satisfied ? 'Satisfied' : 'Not satisfied'">
                                @if (constraint.satisfied) {
                                    <path d="M3 8 6.5 11.5 13 4.5" />
                                } @else {
                                    <circle cx="8" cy="8" r="3" />
                                }
                            </svg>
                        </span>
                        <div class="requirement-body">
                            <div>
                                {{ constraint.label }}
                                @if (!constraint.childEvaluations && constraint.actual !== undefined && constraint.required !== undefined) {
                                    <span> ({{ constraint.actual }} / {{ constraint.required }})</span>
                                }
                            </div>
                            @if (!constraint.satisfied && constraint.mismatchingUnitIndexes?.length) {
                                <div class="requirement-units">Conflicting units:
                                    @for (index of constraint.mismatchingUnitIndexes; track index; let last = $last) {
                                        {{ unitDisplayName(index) }}{{ last ? '' : ', ' }}
                                    }
                                </div>
                            }
                            @if (constraint.kind === 'any-of') { <div>Any one alternative qualifies:</div> }
                            @if (constraint.childEvaluations) {
                                <ng-container *ngTemplateOutlet="requirements; context: { $implicit: displayedChildren(constraint) }"></ng-container>
                            }
                        </div>
                    </li>
                }
            </ul>
        </ng-template>
    `,
    styles: [`
        :host { display: block; }
        .requirement-results { list-style: none; padding-left: 20px; margin-block: 6px; }
        .requirement-results li {
            display: grid;
            grid-template-columns: 1em minmax(0, 1fr);
            column-gap: 0.35em;
            margin-block: 6px;
            color: var(--text-color);
            line-height: 1.4;
        }
        .requirement-status {
            display: flex;
            align-items: center;
            justify-content: center;
            align-self: start;
            height: 1.4em;
        }
        .requirement-status svg {
            width: 1em;
            height: 1em;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.5;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .requirement-body > .requirement-results { padding-left: 0; }
        .requirement-results li.requirement-failed { color: var(--formation-failure-color, var(--danger, #f00)); }
        .requirement-units { font-size: 0.9em; }
    `],
})
export class FormationDiagnosticsComponent {
    evaluation = input.required<FormationEvaluation>();
    units = input<readonly FormationUnitLike[]>([]);
    filter = input<'all' | 'failed' | 'blocked'>('all');
    private readonly unitNames = inject(UnitNameService);

    unitDisplayName(index: number): string {
        const unit = this.units()[index];
        return this.unitNames.name(unit?.getFormationEntity?.() ?? unit?.getFormationSummary?.()) || `Unit ${index + 1}`;
    }

    visibleConstraints(constraints: readonly FormationConstraintEvaluation[]): readonly FormationConstraintEvaluation[] {
        switch (this.filter()) {
            case 'failed': return constraints.filter(constraint => !constraint.satisfied);
            case 'blocked': return constraints.filter(constraint => constraint.blocked);
            default: return constraints;
        }
    }

    displayedChildren(constraint: FormationConstraintEvaluation): readonly FormationConstraintEvaluation[] {
        const children = constraint.childEvaluations ?? [];
        return constraint.kind === 'any-of' && constraint.satisfied ? children.filter(child => child.satisfied) : children;
    }
}
