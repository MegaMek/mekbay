// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import type { Force } from '../../models/force.model';
import type { ForcePerson } from '../../models/force-personnel';
import { GameSystem } from '../../models/common.model';
import type { CrewDragData } from '../../services/crew-assignment.service';
import { CrewPortraitComponent } from '../crew-portrait/crew-portrait.component';

export type CrewLayout = 'compact' | 'cards' | 'rows';

@Component({
    selector: 'crew-card',
    imports: [CdkDrag, CdkDragHandle, CrewPortraitComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="crew-card" [class.compact]="layout() === 'compact'" [class.card-layout]="layout() === 'cards'"
            cdkDrag [cdkDragData]="dragData()" [cdkDragDisabled]="!canMove()"
            (mousedown)="$event.stopPropagation()" (touchstart)="$event.stopPropagation()" (click)="$event.stopPropagation()">
            <button class="crew-main" type="button" [disabled]="!canEdit()" (click)="edited.emit()"
                cdkDragHandle [cdkDragHandleDisabled]="layout() !== 'compact'"
                [attr.aria-label]="'Edit ' + displayName() + ', ' + skillLabel()" [attr.title]="displayName() + ' · ' + skillLabel()">
                @if (person().portrait) {
                    <crew-portrait [name]="person().portrait" [width]="layout() === 'compact' ? 28 : layout() === 'cards' ? 48 : 32" />
                } @else {
                    <img src="/images/helmet.svg" width="28" height="28" alt="" />
                }
                <span class="crew-profile"><span class="crew-name">{{ displayName() }}</span>
                    <span class="crew-skills">{{ isAS() ? 'Skill ' : 'G ' }}{{ person().gunnery ?? 4 }}
                        @if (!isAS()) { / P {{ displayedPiloting() }} }
                        @if (person().commander) { <span class="commander" title="Commander" aria-label="Commander">★</span> }
                    </span>
                </span>
            </button>
            @if (canMove() && layout() !== 'compact') {
                <div class="crew-actions">
                    <button type="button" class="icon-action drag-handle" cdkDragHandle title="Move crew"
                        [attr.aria-label]="'Drag ' + displayName()">⠿</button>
                    @if (assigned()) {
                        <button type="button" class="icon-action" title="Move to reserves" (click)="unassigned.emit()"
                            [attr.aria-label]="'Move ' + displayName() + ' to reserves'">↗</button>
                    }
                    <button type="button" class="icon-action delete" title="Delete crew member" (click)="deleted.emit()"
                        [attr.aria-label]="'Delete ' + displayName()">×</button>
                </div>
            }
        </div>
    `,
    styles: [`
        :host { display: block; min-width: 0; }
        .crew-card { display: flex; align-items: stretch; min-width: 0; background: #0002;
            border: 1px solid var(--border-color, #ffffff25); color: var(--text-color); }
        .crew-main { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; padding: 8px;
            color: inherit; border: 0; background: transparent; text-align: left; cursor: pointer; }
        .crew-main:disabled { cursor: default; }
        .crew-main:not(:disabled):hover { background: #ffffff0a; }
        .crew-main img { flex-shrink: 0; }
        .crew-profile { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
        .crew-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .85em; }
        .crew-skills { color: var(--text-color-secondary); font-size: .75em; white-space: nowrap; }
        .commander { color: var(--bt-yellow); margin-left: 4px; }
        .crew-actions { display: flex; align-items: center; gap: 1px; padding: 2px; }
        .icon-action { border: 0; background: transparent; color: var(--text-color-secondary); width: 26px; height: 30px; cursor: pointer; }
        .icon-action:hover { color: var(--text-color); background: #ffffff10; }
        .drag-handle { cursor: grab; touch-action: none; }
        .delete:hover { color: #ff6868; }
        .compact { border: 0; background: transparent; width: 36px; }
        .compact .crew-main { padding: 4px; justify-content: center; }
        .compact .crew-main img { width: 28px; height: 28px; }
        .compact .crew-profile { display: none; }
        .card-layout { flex-direction: column; }
        .card-layout .crew-main { padding: 12px; }
        .card-layout .crew-actions { justify-content: flex-end; border-top: 1px solid #ffffff12; }
        .cdk-drag-preview { box-sizing: border-box; background: var(--background-color, #252a31); box-shadow: 0 6px 20px #0008; }
        .cdk-drag-placeholder { opacity: .25; }
    `],
})
export class CrewCardComponent {
    readonly force = input.required<Force>();
    readonly person = input.required<ForcePerson>();
    readonly label = input('Unnamed crew');
    readonly layout = input<CrewLayout>('rows');
    readonly assigned = input(false);
    readonly canEdit = input(false);
    readonly canMove = input(false);
    readonly effectivePiloting = input<number>();
    readonly reason = input<string>();
    readonly edited = output<void>();
    readonly unassigned = output<void>();
    readonly deleted = output<void>();
    readonly displayName = computed(() => this.person().name || this.label());
    readonly isAS = computed(() => this.force().gameSystem === GameSystem.AS);
    readonly displayedPiloting = computed(() => this.effectivePiloting() ?? this.person().piloting ?? 5);
    readonly skillLabel = computed(() => this.isAS() ? `Skill ${this.person().gunnery ?? 4}`
        : `Gunnery ${this.person().gunnery ?? 4}, Piloting ${this.displayedPiloting()}`
            + (this.displayedPiloting() !== (this.person().piloting ?? 5) ? ` (personal Piloting ${this.person().piloting ?? 5})` : ''));
    readonly dragData = computed<CrewDragData>(() => ({ kind: 'force-person', force: this.force(), personId: this.person().id }));
}
