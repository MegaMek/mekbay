// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, type ComponentRef, DestroyRef, inject, Injector, input, output } from '@angular/core';
import { ComponentPortal } from '@angular/cdk/portal';
import { outputToObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OverlayManagerService } from '../../services/overlay-manager.service';

@Component({
    selector: 'color-picker-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="color-picker-panel glass framed-borders has-shadow">
            @for (color of colors(); track color) {
                <button
                    class="color-choice"
                    type="button"
                    [class.selected-color]="color === value()"
                    [style.background]="color"
                    [attr.aria-label]="'Use color ' + color"
                    (click)="selected.emit(color)">
                </button>
            }
        </div>
    `,
    styles: [`
        .color-picker-panel {
            display: grid;
            grid-template-columns: repeat(6, 18px);
            gap: 6px;
            padding: 8px;
        }

        .color-choice {
            inline-size: 18px;
            block-size: 18px;
            padding: 0;
            border: 1px solid rgba(255, 255, 255, 0.35);
            cursor: pointer;
        }

        .color-choice.selected-color {
            outline: 2px solid var(--bt-yellow);
            outline-offset: 1px;
        }
    `]
})
class ColorPickerPanelComponent {
    readonly colors = input<readonly string[]>([]);
    readonly value = input<string | null>(null);
    readonly selected = output<string>();
}

let nextColorPickerId = 0;

@Component({
    selector: 'color-picker-button',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <button
            class="color-picker-button"
            type="button"
            [style.background]="value()"
            [disabled]="disabled()"
            [attr.aria-label]="ariaLabel()"
            (click)="toggle($event)">
            <ng-content />
        </button>
    `,
    styles: [`
        :host {
            display: inline-flex;
            inline-size: 100%;
            block-size: 100%;
        }

        .color-picker-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            inline-size: 100%;
            block-size: 100%;
            padding: 0;
            border: 1px solid rgba(255, 255, 255, 0.45);
            color: #111;
            font: inherit;
            font-weight: 800;
            font-size: 0.82rem;
            line-height: 1;
            cursor: pointer;
        }

        .color-picker-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
    `]
})
export class ColorPickerButtonComponent {
    readonly value = input<string | null>(null);
    readonly colors = input<readonly string[]>([]);
    readonly disabled = input(false);
    readonly ariaLabel = input('Choose color');
    readonly valueChange = output<string>();
    readonly pickerOpened = output<void>();
    readonly pickerClosed = output<void>();

    private readonly overlayManager = inject(OverlayManagerService);
    private readonly injector = inject(Injector);
    private readonly destroyRef = inject(DestroyRef);
    private readonly overlayKey = `color-picker-${nextColorPickerId++}`;
    private panelRef: ComponentRef<ColorPickerPanelComponent> | null = null;

    constructor() {
        this.destroyRef.onDestroy(() => this.close());
    }

    toggle(event: MouseEvent): void {
        event.stopPropagation();
        if (this.disabled()) return;
        if (this.panelRef) {
            this.close();
            return;
        }
        const portal = new ComponentPortal(ColorPickerPanelComponent, null, this.injector);
        const { componentRef, closed } = this.overlayManager.createManagedOverlay(this.overlayKey, event.currentTarget as HTMLElement, portal, {
            hasBackdrop: false,
            panelClass: 'color-picker-overlay-panel',
            closeOnOutsideClick: true
        });
        this.panelRef = componentRef;
        this.pickerOpened.emit();
        componentRef.setInput('colors', this.colors());
        componentRef.setInput('value', this.value());
        componentRef.changeDetectorRef.detectChanges();

        outputToObservable(componentRef.instance.selected).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(color => {
            this.valueChange.emit(color);
            this.close();
        });
        closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.panelRef = null;
            this.pickerClosed.emit();
        });
    }

    private close(): void {
        this.overlayManager.closeManagedOverlay(this.overlayKey);
        this.panelRef = null;
    }
}
