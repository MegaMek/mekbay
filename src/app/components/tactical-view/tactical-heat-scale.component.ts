// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, output, signal, viewChild } from '@angular/core';
import { recordSheetHeatEffects } from '../../models/runtime/heat-effect-presentation';
import type { MekRecordSheetSnapshot } from '../../models/runtime/mek-record-sheet';
import type { NonMekRecordSheetSnapshot } from '../../models/runtime/non-mek-record-sheet';
import { recordSheetHeatScale, type RecordSheetHeatScale } from '../../models/runtime/record-sheet-heat-scale';
import type { TurnSummaryHeatRow } from '../page-viewer/overlay/page-turn-summary.util';

@Component({
    selector: 'tactical-heat-scale',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './tactical-heat-scale.component.html',
    styleUrl: './tactical-heat-scale.component.scss',
})
export class TacticalHeatScaleComponent {
    readonly Math = Math;
    readonly mek = input<MekRecordSheetSnapshot | null>(null);
    readonly entity = input<NonMekRecordSheetSnapshot | null>(null);
    readonly readOnly = input(false);
    readonly selectedHeat = input<number | null>(null);
    readonly summaryRows = input<readonly TurnSummaryHeatRow[]>([]);
    readonly heatChange = output<number>();
    readonly applyHeat = output<void>();
    readonly levels = Array.from({ length: 31 }, (_, index) => index);
    readonly heatInput = viewChild<ElementRef<HTMLInputElement>>('heatInput');
    readonly preview = signal<number | null>(null);
    readonly previewX = signal(0);
    private pointerId: number | null = null;
    private baseline = 0;

    readonly state = computed<RecordSheetHeatScale>(() => {
        const mek = this.mek();
        if (mek) return recordSheetHeatScale(mek);
        const heat = this.entity()?.heat;
        return { current: heat?.current ?? 0, pending: heat?.pending ?? undefined, automaticProjection: false };
    });
    readonly displayedHeat = computed(() => this.preview() ?? this.state().pending ?? this.state().current);
    readonly projection = computed(() => {
        const projection = this.mek()?.heatProjection;
        return projection?.kind === 'supported' ? projection.projection : null;
    });
    readonly cooling = computed(() => this.projection()?.remainingDissipation
        ?? this.entity()?.heat.dissipation
        ?? Math.max(0, (this.mek()?.heatSinks.count ?? 0) - (this.mek()?.heat.heatsinksOff ?? 0)));
    readonly family = computed(() => this.mek() ? this.mek()!.identity.form === 'lam' ? 'lam' : 'mek' : 'aero');
    readonly effects = computed(() => recordSheetHeatEffects(this.family(), this.displayedHeat())
        .filter(effect => effect.active && !effect.superseded));
    readonly cells = computed(() => this.levels.map(heat => ({
        heat,
        effects: recordSheetHeatEffects(this.family(), heat).filter(effect => effect.heat === heat)
            .map(effect => effect.label + (effect.secondaryLabel ?? '')).join(' · '),
    })));
    readonly markers = computed(() => {
        const state = this.state();
        return [
            { id: 'current', label: 'NOW', value: state.current, tone: 'current' },
            { id: 'pending', label: 'NEXT', value: state.pending, tone: (state.pending ?? 0) >= state.current ? 'hot' : 'cold' },
            { id: 'previous', label: 'PREV', value: state.previous, tone: 'previous' },
            { id: 'projection', label: 'PROJECTED', value: state.projection, tone: (state.projection ?? 0) > state.current ? 'hot' : 'cold' },
            { id: 'selected', label: 'SELECTED', value: this.selectedHeat() ?? undefined, tone: 'selected' },
        ].filter((marker): marker is typeof marker & { value: number } => marker.value !== undefined);
    });
    readonly previewDelta = computed(() => {
        const delta = (this.preview() ?? this.displayedHeat()) - this.baseline;
        return `${delta >= 0 ? '+' : ''}${delta}`;
    });

    constructor() {
        effect(() => {
            this.mek()?.entityUuid;
            this.entity()?.entityUuid;
            this.cancelDrag();
        });
    }

    markersAt(heat: number) {
        return this.markers().filter(marker => heat === 31 ? marker.value > 30 : marker.value === heat);
    }

    setHeat(value: number): void {
        if (!this.readOnly() && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000) {
            this.heatChange.emit(value);
        }
    }

    setNumericHeat(event: Event): void {
        const input = event.target as HTMLInputElement;
        this.setHeat(input.valueAsNumber);
        input.value = String(this.displayedHeat());
    }

    enterOverflow(): void {
        this.heatInput()?.nativeElement.focus();
        this.heatInput()?.nativeElement.select();
    }

    startDrag(event: PointerEvent): void {
        if (this.readOnly() || event.button !== 0 || this.pointerId !== null
            || !(event.target as Element).closest('[data-heat]')) return;
        const track = event.currentTarget as HTMLElement;
        this.pointerId = event.pointerId;
        this.baseline = this.displayedHeat();
        track.focus({ preventScroll: true });
        track.setPointerCapture(event.pointerId);
        event.preventDefault();
        this.updatePreview(event, track);
    }

    moveDrag(event: PointerEvent): void {
        if (this.pointerId !== event.pointerId) return;
        this.updatePreview(event, event.currentTarget as HTMLElement);
    }

    finishDrag(event: PointerEvent): void {
        if (this.pointerId !== event.pointerId) return;
        const value = this.preview();
        this.cancelDrag();
        if (value !== null) this.setHeat(value);
    }

    cancelDrag(): void {
        this.pointerId = null;
        this.preview.set(null);
    }

    selectCell(event: MouseEvent, heat: number): void {
        // Pointer selection is committed once on release; keyboard/AT clicks arrive with detail 0.
        if (event.detail === 0) this.setHeat(heat);
    }

    keyDown(event: KeyboardEvent): void {
        const value = this.displayedHeat();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 30
            : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? value + 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? Math.max(0, value - 1)
            : event.key === 'PageUp' ? value + 5 : event.key === 'PageDown' ? Math.max(0, value - 5) : null;
        if (event.key === 'Escape') this.cancelDrag();
        if (next === null) return;
        event.preventDefault();
        this.setHeat(next);
    }

    private updatePreview(event: PointerEvent, track: HTMLElement): void {
        let closest: HTMLElement | null = null;
        let distance = Infinity;
        for (const cell of track.querySelectorAll<HTMLElement>('[data-heat]')) {
            const rect = cell.getBoundingClientRect();
            const dx = event.clientX - (rect.left + rect.width / 2);
            const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
            const candidateDistance = dx * dx + dy * dy;
            if (candidateDistance < distance) { closest = cell; distance = candidateDistance; }
        }
        if (!closest) return;
        this.preview.set(Number(closest.dataset['heat']));
        const rect = closest.getBoundingClientRect();
        this.previewX.set(rect.left + rect.width / 2 - track.getBoundingClientRect().left);
    }
}
