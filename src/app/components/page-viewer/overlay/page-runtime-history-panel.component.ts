// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';

import type { CBTForce } from '../../../models/cbt-force.model';
import {
    formatRuntimeHistoryMessage,
    runtimeHistoryMessageUnitId,
    type RuntimeHistoryEvent,
} from '../../../models/runtime/runtime-history';

interface RuntimeHistoryRow {
    readonly event: RuntimeHistoryEvent;
    readonly applied: boolean;
    readonly unitId: string | null;
}

interface RuntimeHistoryPhaseGroup {
    readonly phase: number;
    readonly rows: readonly RuntimeHistoryRow[];
}

interface RuntimeHistoryTurnGroup {
    readonly turn: number;
    readonly phases: readonly RuntimeHistoryPhaseGroup[];
}

@Component({
    selector: 'page-runtime-history-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="runtime-history glass framed-borders has-shadow" aria-label="Runtime history">
            <button type="button" class="close-log" (click)="close()()">× Close Log</button>
            <nav class="history-tabs" aria-label="History scope">
                <button
                    type="button"
                    [class.active]="scope() === 'unit'"
                    [attr.aria-pressed]="scope() === 'unit'"
                    (click)="scope.set('unit')"
                >This Unit</button>
                <button
                    type="button"
                    [class.active]="scope() === 'force'"
                    [attr.aria-pressed]="scope() === 'force'"
                    (click)="scope.set('force')"
                >Force-wide</button>
            </nav>
            @if (groups().length === 0) {
                <p class="empty">No actions in the log yet.</p>
            } @else {
                <div class="history-scroll">
                    @for (turn of groups(); track turn.turn) {
                        <section class="turn-group">
                            <h3>TURN {{ turn.turn }}</h3>
                            @for (phase of turn.phases; track phase.phase) {
                                <section class="phase-group">
                                    <h4>PHASE</h4>
                                    <ul>
                                        @for (row of phase.rows; track $index) {
                                            <li [class.undone]="!row.applied">
                                                @if (scope() === 'force') {
                                                    @if (row.unitId; as unitId) {
                                                        <button type="button" class="unit-link" (click)="goToUnit(unitId, $event)">{{ unitLabel(unitId) }}</button><span>: </span>
                                                    }
                                                }
                                                {{ format(row.event) }}
                                            </li>
                                        }
                                    </ul>
                                </section>
                            }
                        </section>
                    }
                </div>
            }
        </section>
    `,
    styles: [`
        :host { display: block; }
        .runtime-history {
            width: min(760px, calc(100vw - 24px));
            max-height: min(86vh, 900px);
            padding: 16px;
            color: var(--text-color, #fff);
            background-color: var(--glass-background, rgba(15, 15, 15, 0.98));
            user-select: text;
        }
        .close-log {
            margin: 0 0 14px;
            padding: 4px 0;
            color: inherit;
            border: 0;
            background: none;
            cursor: pointer;
            font: inherit;
        }
        .history-tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 14px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.3);
        }
        .history-tabs button {
            padding: 7px 12px;
            color: var(--secondary-text-color, #bbb);
            border: 0;
            border-bottom: 2px solid transparent;
            background: none;
            cursor: pointer;
            font: inherit;
        }
        .history-tabs button.active {
            color: inherit;
            border-bottom-color: currentColor;
        }
        .history-scroll { overflow: auto; max-height: calc(min(86vh, 900px) - 100px); }
        h3, h4, p { margin: 0; }
        h3 {
            margin-top: 14px;
            padding: 4px 0;
            border-top: 2px solid currentColor;
            border-bottom: 1px solid rgba(255, 255, 255, 0.18);
        }
        .turn-group:first-child h3 { margin-top: 0; }
        h4 {
            margin-top: 12px;
            padding: 2px 0;
            border-top: 2px dotted rgba(255, 255, 255, 0.34);
            border-bottom: 1px dotted rgba(255, 255, 255, 0.24);
            color: var(--secondary-text-color, #bbb);
            font-size: 0.85rem;
            letter-spacing: 0.08em;
        }
        ul {
            margin: 8px 0 16px;
            padding: 4px 12px 4px 34px;
            border-left: 2px solid rgba(255, 255, 255, 0.28);
        }
        li { margin: 8px 0; line-height: 1.35; overflow-wrap: anywhere; }
        li.undone { opacity: 0.4; text-decoration: line-through; }
        .unit-link {
            padding: 0;
            color: inherit;
            border: 0;
            border-bottom: 1px dotted currentColor;
            background: none;
            cursor: pointer;
            font: inherit;
            font-weight: 700;
        }
        .empty { color: var(--secondary-text-color, #bbb); }
    `],
})
export class PageRuntimeHistoryPanelComponent {
    readonly force = input.required<CBTForce>();
    readonly activeUnitId = input<string | null>(null);
    readonly selectUnit = input<(instanceId: string) => void>(() => undefined);
    readonly close = input<() => void>(() => undefined);
    readonly scope = signal<'unit' | 'force'>('unit');
    private readonly version = signal(0);

    readonly groups = computed<readonly RuntimeHistoryTurnGroup[]>(() => {
        this.version();
        const turns = new Map<number, Map<number, RuntimeHistoryRow[]>>();
        const activeUnitId = this.activeUnitId();
        for (const source of this.force().getRuntimeHistory()) {
            const unitId = runtimeHistoryMessageUnitId(source.event.message);
            if (this.scope() === 'unit' && unitId !== null && unitId !== activeUnitId) continue;
            const row = Object.freeze({ ...source, unitId });
            let phases = turns.get(row.event.turn);
            if (!phases) {
                phases = new Map();
                turns.set(row.event.turn, phases);
            }
            const rows = phases.get(row.event.phase) ?? [];
            rows.push(row);
            phases.set(row.event.phase, rows);
        }
        return Object.freeze([...turns].map(([turn, phases]) => Object.freeze({
            turn,
            phases: Object.freeze([...phases].map(([phase, rows]) => Object.freeze({
                phase,
                rows: Object.freeze(rows),
            }))),
        })));
    });

    constructor() {
        effect(onCleanup => {
            const subscription = this.force().changed.subscribe(() => this.version.update(value => value + 1));
            onCleanup(() => subscription.unsubscribe());
        });
    }

    format(event: RuntimeHistoryEvent): string {
        return formatRuntimeHistoryMessage(event.message, {
            unitLabel: instanceId => this.force().runtimeHistoryUnitLabel(instanceId),
            targetLabel: (instanceId, kind, targetId) =>
                this.force().runtimeHistoryTargetLabel(instanceId, kind, targetId),
            crewLabel: (instanceId, occurrence) =>
                this.force().runtimeHistoryCrewLabel(instanceId, occurrence),
            ammoLabel: (instanceId, munitionKey) =>
                this.force().runtimeHistoryAmmoLabel(instanceId, munitionKey),
            omitUnitLabel: true,
        });
    }

    unitLabel(instanceId: string): string {
        return this.force().runtimeHistoryUnitLabel(instanceId);
    }

    goToUnit(instanceId: string, event: MouseEvent): void {
        event.stopPropagation();
        this.selectUnit()(instanceId);
        this.close()();
    }
}
