// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

/** One armor facing, with the opposite facing sharing the same location capacity. */
@Component({
    selector: 'construction-armor-control',
    host: { '[class.design-locked]': 'disabled()' },
    template: `
        <div class="armor-heading">
            <span>{{ label() }}</span>
            <div class="armor-value"><input type="number" min="0" [max]="maximum()" [value]="displayValue()" [disabled]="disabled()"
                [attr.aria-label]="locationName() + ' ' + face() + ' armor'" (change)="setNumber($event)"><span>/ {{ maximum() }}</span>
                @if (repaired(); as amount) { <b class="repair-gain" title="Armor repair pending">+{{ amount }}</b> }</div>
            @if (!disabled() || repairable() && damage() > 0) { <div class="armor-actions">
                @if (!disabled()) {
                    <button class="bt-button tiny" [disabled]="displayValue() <= 0" (click)="adjust(-1)" [attr.aria-label]="'Decrease ' + locationName() + ' ' + face() + ' armor'">−</button>
                    <button class="bt-button tiny" [disabled]="displayValue() >= maximum()" (click)="adjust(1)" [attr.aria-label]="'Increase ' + locationName() + ' ' + face() + ' armor'">+</button>
                }
                @if (repairable() && damage() > 0) {
                    <button class="bt-button tiny armor-repair-button" [disabled]="repairDisabled()" (click)="repair()"
                        [attr.aria-label]="'Repair ' + locationName() + ' ' + face() + ' armor'" title="Repair this armor facing when you save">Repair</button>
                }
            </div> }
        </div>
        <div class="armor-track" [class.over-limit]="displayValue() > maximum()">
            <span class="armor-fill" [style.width.%]="percent(displayValue())"></span>
            @if (damage() > 0) { <span class="armor-damage" [style.left.%]="percent(Math.max(0, displayValue() - damage()))" [style.width.%]="percent(Math.min(displayValue(), damage()))"></span> }
            @if (repaired() > 0) { <span class="armor-repair" [style.left.%]="percent(Math.max(0, displayValue() - damage() - repaired()))" [style.width.%]="percent(repaired())"></span> }
            <span class="armor-reserved" [style.width.%]="percent(reserved())"></span>
            <input type="range" min="0" [max]="maximum()" step="1" [value]="displayValue()" [style.width.%]="percent(maximum())" [disabled]="disabled()"
                [attr.aria-label]="locationName() + ' ' + face() + ' armor allocation'"
                [attr.aria-valuetext]="displayValue() + ' of ' + maximum() + ' points'"
                (input)="preview($event)" (change)="commit($event)">
        </div>
        @if (damage() > 0) { <div class="armor-condition">{{ Math.max(0, displayValue() - damage()) }} intact · {{ Math.min(displayValue(), damage()) }} damaged</div> }
    `,
    styleUrl: './construction-armor-control.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConstructionArmorControlComponent {
    readonly Math = Math;
    readonly label = input.required<string>();
    readonly locationName = input.required<string>();
    readonly face = input<'front' | 'rear'>('front');
    readonly value = input.required<number>();
    readonly capacity = input.required<number>();
    readonly reserved = input(0);
    readonly damage = input(0);
    readonly pendingRepair = input(0);
    readonly disabled = input(false);
    readonly repairable = input(false);
    readonly repairDisabled = input(false);
    readonly valueChange = output<number>();
    readonly repairRequested = output<void>();
    private readonly previewValue = signal<number | null>(null);
    readonly maximum = computed(() => Math.max(0, this.capacity() - this.reserved()));
    readonly displayValue = computed(() => this.previewValue() ?? this.value());
    readonly repaired = computed(() => Math.max(0, Math.min(this.pendingRepair(), this.displayValue() - this.damage())));

    percent(value: number): number { return this.capacity() > 0 ? Math.max(0, Math.min(100, value / this.capacity() * 100)) : 0; }
    preview(event: Event): void { if (!this.disabled()) this.previewValue.set((event.target as HTMLInputElement).valueAsNumber); }
    commit(event: Event): void {
        if (this.disabled()) return;
        const control = event.target as HTMLInputElement;
        const value = control.valueAsNumber;
        this.previewValue.set(null);
        if (!Number.isInteger(value) || value < 0) { control.value = String(this.value()); return; }
        if (value !== this.value()) this.valueChange.emit(value);
    }
    setNumber(event: Event): void { this.commit(event); }
    repair(): void {
        if (this.repairable() && this.damage() > 0 && !this.repairDisabled()) this.repairRequested.emit();
    }
    adjust(delta: number): void {
        if (this.disabled()) return;
        this.previewValue.set(null);
        const value = Math.max(0, Math.min(this.maximum(), this.value() + delta));
        if (value !== this.value()) this.valueChange.emit(value);
    }
}
