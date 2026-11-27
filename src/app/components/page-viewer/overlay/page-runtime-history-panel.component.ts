// SPDX-License-Identifier: GPL-3.0-or-later

import type { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import {
    afterRenderEffect,
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    inject,
    input,
    signal,
    type Injector,
} from '@angular/core';

import type { CBTForce } from '../../../models/cbt-force.model';
import { historyPhaseLabel } from '../../../models/rules/turn-sequence';
import {
    formatRuntimeHistoryMessage,
    runtimeHistoryMessageUnitId,
    type RuntimeHistoryEvent,
} from '../../../models/runtime/runtime-history';
import { ForceWorkspaceStateService } from '../../../services/force-workspace-state.service';
import { LayoutService } from '../../../services/layout.service';
import type { OverlayManagerService } from '../../../services/overlay-manager.service';
import { ToastService } from '../../../services/toast.service';

interface RuntimeHistoryRow {
    readonly event: RuntimeHistoryEvent;
    /** False once undone: the row stays, grayed, while it can still be redone. */
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

/** Opens the force's log beside `target` (fullscreen on mobile), or closes it when it is already open. */
export function toggleRuntimeHistoryOverlay(
    force: CBTForce,
    activeUnitId: string | null,
    target: HTMLElement,
    sensitiveAreaReferenceElement: HTMLElement,
    overlayManager: OverlayManagerService,
    overlay: Overlay,
    injector: Injector,
    beforeOpen?: () => void,
): void {
    const overlayKey = `runtime-history-${force.instanceId() ?? 'force'}`;
    if (overlayManager.has(overlayKey)) {
        overlayManager.closeManagedOverlay(overlayKey);
        return;
    }
    beforeOpen?.();
    const fullscreen = injector.get(LayoutService).isMobile();
    const portal = new ComponentPortal(PageRuntimeHistoryPanelComponent, null, injector);
    const { componentRef } = overlayManager.createManagedOverlay<PageRuntimeHistoryPanelComponent>(
        overlayKey,
        fullscreen ? null : target,
        portal,
        {
            hasBackdrop: false,
            panelClass: 'runtime-history-overlay-panel',
            closeOnOutsideClick: false,
            closeOnOutsideClickOnly: true,
            sensitiveAreaReferenceElement,
            scrollStrategy: overlay.scrollStrategies.reposition(),
        },
    );
    componentRef?.setInput('force', force);
    componentRef?.setInput('activeUnitId', activeUnitId);
    componentRef?.setInput('fullscreen', fullscreen);
    componentRef?.setInput('close', () => overlayManager.closeManagedOverlay(overlayKey));
}

@Component({
    selector: 'page-runtime-history-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[class.fullscreen-dialog-host]': 'fullscreen()',
        '[class.fullheight]': 'fullscreen()',
    },
    template: `
        <section class="runtime-history glass framed-borders has-shadow" aria-label="Runtime history">
            <header class="log-header">
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
                <!-- Undo and redo step through the whole force's actions, whichever tab is shown. -->
                <button type="button" class="log-action" [disabled]="!undoState().canUndo" (click)="undo()"
                    aria-label="Undo" title="Undo the force's last action">
                    <svg aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 7 4 12l5 5"/><path d="M4 12h9a7 7 0 0 1 7 7"/></svg>
                </button>
                <button type="button" class="log-action" [disabled]="!undoState().canRedo" (click)="redo()"
                    aria-label="Redo" title="Redo the force's next action">
                    <svg aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="m15 7 5 5-5 5"/><path d="M20 12h-9a7 7 0 0 0-7 7"/></svg>
                </button>
                <button type="button" class="close-button" (click)="close()()" aria-label="Close log" title="Close log"></button>
            </header>
            @if (shownTurn(); as turn) {
                <nav class="turn-strip" aria-label="Turn">
                    @for (group of groups(); track group.turn) {
                        <button
                            type="button"
                            class="turn-chip"
                            [class.active]="group === turn"
                            [attr.aria-pressed]="group === turn"
                            (click)="showTurn(group.turn)"
                        >TURN {{ group.turn }}</button>
                    }
                </nav>
                <div class="history-scroll">
                    @for (phase of turn.phases; track phase.phase) {
                        <section class="phase-group">
                            <h4>{{ phaseLabel(phase.phase) }}</h4>
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
                </div>
            } @else {
                <p class="empty">No actions in the log yet.</p>
            }
        </section>
    `,
    styles: [`
        :host { display: block; }
        /* No padding on the frame, so the log's scrollbar runs along its edge; each section pads itself. */
        .runtime-history {
            --log-padding: 16px;
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
            width: min(760px, calc(100vw - 24px));
            max-height: min(86vh, 900px);
            padding: 0;
            color: var(--text-color, #fff);
            background-color: var(--glass-background, rgba(15, 15, 15, 0.98));
            user-select: text;
        }
        :host(.fullheight) .runtime-history {
            width: 100%;
            height: 100%;
            max-height: none;
        }
        /* One row: the scope tabs, then the force-wide undo, redo and the standard close X. */
        .log-header {
            display: flex;
            align-items: center;
            margin: 8px 8px 10px var(--log-padding);
            border-bottom: 1px solid rgba(255, 255, 255, 0.3);
        }
        .history-tabs {
            display: flex;
            flex: 1 1 auto;
            align-self: stretch;
            align-items: flex-end;
            gap: 4px;
            min-width: 0;
        }
        /* Icon buttons sized and colored like the close X beside them. */
        .log-action {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 auto;
            width: 36px;
            height: 40px;
            padding: 0;
            color: var(--text-color-secondary);
            border: 0;
            background: transparent;
            cursor: pointer;
        }
        .log-action svg { width: 20px; height: 20px; }
        .log-action:hover:not(:disabled), .log-action:focus-visible { color: var(--bt-yellow); }
        .log-action:disabled { opacity: 0.35; cursor: default; }
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
        /* One turn shows at a time; the strip scrolls on its own at any width. */
        .turn-strip {
            display: flex;
            flex: 0 0 auto;
            gap: 6px;
            min-width: 0;
            padding: 0 var(--log-padding) 6px;
            scroll-padding-inline: var(--log-padding);
            overflow-x: auto;
            scrollbar-width: thin;
        }
        .turn-chip {
            flex: 0 0 auto;
            padding: 4px 12px;
            color: var(--secondary-text-color, #bbb);
            border: 1px solid rgba(255, 255, 255, 0.28);
            border-radius: 999px;
            background: none;
            cursor: pointer;
            font: inherit;
            font-size: 0.8rem;
            font-weight: 700;
            letter-spacing: 0.06em;
        }
        .turn-chip.active {
            color: inherit;
            border-color: currentColor;
            background: rgba(255, 255, 255, 0.1);
        }
        .history-scroll { flex: 1 1 auto; min-height: 0; padding: 0 var(--log-padding) var(--log-padding); overflow: auto; }
        h4, p { margin: 0; }
        h4 {
            margin-top: 12px;
            padding: 2px 0;
            border-top: 2px dotted rgba(255, 255, 255, 0.34);
            border-bottom: 1px dotted rgba(255, 255, 255, 0.24);
            color: var(--secondary-text-color, #bbb);
            font-size: 0.85rem;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }
        ul {
            margin: 8px 0 16px;
            padding: 4px 12px 4px 34px;
            border-left: 2px solid rgba(255, 255, 255, 0.28);
        }
        li { margin: 8px 0; line-height: 1.35; overflow-wrap: anywhere; }
        li.undone { opacity: 0.4; }
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
        .empty { padding: 0 var(--log-padding) var(--log-padding); color: var(--secondary-text-color, #bbb); }
    `],
})
export class PageRuntimeHistoryPanelComponent {
    private readonly workspace = inject(ForceWorkspaceStateService);
    private readonly toast = inject(ToastService);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    readonly force = input.required<CBTForce>();
    readonly activeUnitId = input<string | null>(null);
    readonly fullscreen = input(false);
    readonly close = input<() => void>(() => undefined);
    readonly scope = signal<'unit' | 'force'>('unit');
    /** The turn the player picked; null follows the latest turn as the game goes on. */
    private readonly pickedTurn = signal<number | null>(null);
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
        return Object.freeze([...turns].sort(([left], [right]) => left - right).map(([turn, phases]) => Object.freeze({
            turn,
            phases: Object.freeze([...phases].map(([phase, rows]) => Object.freeze({
                phase,
                rows: Object.freeze(rows),
            }))),
        })));
    });

    readonly shownTurn = computed(() => {
        const groups = this.groups();
        return groups.find(group => group.turn === this.pickedTurn()) ?? groups.at(-1) ?? null;
    });

    /** Derived from the force's command session: one source of truth for what can be undone and redone. */
    readonly undoState = computed(() => {
        this.version();
        const force = this.force();
        return force.readOnly() ? { canUndo: false, canRedo: false } : force.getRuntimeUndoState();
    });

    constructor() {
        effect(onCleanup => {
            const subscription = this.force().changed.subscribe(() => this.version.update(value => value + 1));
            onCleanup(() => subscription.unsubscribe());
        });
        // Keep the shown turn's chip in view, so the strip opens scrolled to the latest turn.
        afterRenderEffect(() => {
            if (!this.shownTurn()) return;
            this.host.nativeElement.querySelector('.turn-chip.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
    }

    showTurn(turn: number): void {
        this.pickedTurn.set(turn === this.groups().at(-1)?.turn ? null : turn);
    }

    phaseLabel(phase: number): string {
        return historyPhaseLabel(phase);
    }

    async undo(): Promise<void> {
        const result = await this.force().undoRuntimeCommand();
        if (!result.accepted) this.toast.showToast(`Undo failed: ${result.reason}`, 'error');
    }

    async redo(): Promise<void> {
        const result = await this.force().redoRuntimeCommand();
        if (!result.accepted) this.toast.showToast(`Redo failed: ${result.reason}`, 'error');
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
        const member = this.force().getCBTMember(instanceId);
        if (member) this.workspace.selectUnit(member);
        this.close()();
    }
}
