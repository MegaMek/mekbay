// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    type ComponentRef,
    ElementRef,
    inject,
    Injector,
    input,
    type OnDestroy,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { ComponentPortal } from '@angular/cdk/portal';
import type { UnitBuildingLevel, UnitWaterDepth } from '../../models/unit-cover.model';
import { OverlayManagerService } from '../../services/overlay-manager.service';

export type CoverLevelPickerKind = 'water' | 'building';
export type CoverLevel = UnitWaterDepth | UnitBuildingLevel;

export interface CoverLevelOption {
    value: CoverLevel;
    label: string;
}

const WATER_DEPTH_OPTIONS: readonly CoverLevelOption[] = [
    { value: 'underwater-depth-1', label: '1' },
    { value: 'underwater-depth-2', label: '2' },
    { value: 'underwater-depth-3', label: '3' },
];

const BUILDING_LEVEL_OPTIONS: readonly CoverLevelOption[] = [
    { value: 'building-1', label: '1' },
    { value: 'building-2', label: '2' },
    { value: 'building-3', label: '3' },
];

function coverLevelOptions(kind: CoverLevelPickerKind): readonly CoverLevelOption[] {
    return kind === 'water' ? WATER_DEPTH_OPTIONS : BUILDING_LEVEL_OPTIONS;
}

@Component({
    selector: 'cover-level-indicator',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (kind() === 'water') {
            <svg class="water-icon" viewBox="0 0 24 20" aria-hidden="true"><circle cx="12" cy="4" r="2.5"/><path d="M7 12.5 9 8h6l2 4.5M2 15c2.5-2 4.5 2 7 0s4.5 2 7 0 4.5 2 6 0M2 19c2.5-2 4.5 2 7 0s4.5 2 7 0 4.5 2 6 0"/></svg>
        } @else {
            <svg class="building-icon" viewBox="0 0 426.667 384" aria-hidden="true"><path d="M234.667 0v341.333H256v-256h149.333v256h21.334V384H0v-42.667h21.333V0h213.334ZM149.333 277.333h-42.666v64h42.666v-64Zm192-21.333h-42.666v42.667h42.666V256Zm0-85.333h-42.666v42.666h42.666v-42.666Zm-192 0h-42.666v42.666h42.666v-42.666Zm0-85.334h-42.666V128h42.666V85.333Z"/></svg>
        }
        @if (label()) {
            <span>{{ label() }}</span>
        }
    `,
    styles: [`
        :host {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 3px;
            font-weight: 700;
            line-height: 1;
        }

        svg { width: 20px; height: 20px; }
        .water-icon {
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .building-icon { fill: currentColor; }
    `],
})
export class CoverLevelIndicatorComponent {
    readonly kind = input.required<CoverLevelPickerKind>();
    readonly label = input.required<string>();
}

@Component({
    selector: 'cover-level-picker-panel',
    imports: [CoverLevelIndicatorComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div
            class="cover-options glass has-shadow framed-borders"
            [class.water]="kind() === 'water'"
            [class.building]="kind() === 'building'"
            data-scroll-container
            [id]="optionsId()"
            role="listbox"
            [attr.aria-label]="ariaLabel()"
            [attr.aria-activedescendant]="activeOptionId()"
        >
            @for (option of options(); let index = $index; track option.value) {
                <button
                    class="cover-option"
                    type="button"
                    role="option"
                    [id]="optionId(index)"
                    [class.active]="option.value === value()"
                    [class.keyboard-active]="index === activeIndex()"
                    [attr.aria-selected]="option.value === value()"
                    (pointerenter)="pointerHovered.emit(index)"
                    (click)="selected.emit(option.value)"
                >
                    <cover-level-indicator [kind]="kind()" [label]="option.label" />
                </button>
            }
        </div>
    `,
    styles: [`
        :host { display: block; }

        .cover-options {
            box-sizing: border-box;
            display: grid;
            grid-template-columns: 44px;
            gap: 4px;
            width: max-content;
            max-height: 90dvh;
            padding: 4px;
            overflow-y: auto;
        }

        .cover-option {
            display: flex;
            align-items: center;
            justify-content: center;
            inline-size: 44px;
            block-size: 40px;
            padding: 3px;
            border: 2px solid var(--border-color);
            background: var(--button-bg);
            color: var(--text-color);
            font: inherit;
            cursor: pointer;
        }

        .cover-options.water .cover-option.active {
            border-color: #64b5f6;
            background: #1565c0;
            color: #fff;
        }

        .cover-options.building .cover-option.active {
            border-color: #fff;
            background: #d1d1d1;
            color: #000;
        }

        .cover-option:hover,
        .cover-option.keyboard-active:not(.active) {
            background: rgba(255, 255, 255, 0.1);
        }
    `],
})
export class CoverLevelPickerPanelComponent {
    readonly kind = input<CoverLevelPickerKind>('water');
    readonly value = input('');
    readonly optionsId = input('');
    readonly activeOptionId = input('');
    readonly activeIndex = input(0);

    readonly selected = output<CoverLevel>();
    readonly pointerHovered = output<number>();

    readonly options = computed(() => coverLevelOptions(this.kind()));
    readonly ariaLabel = computed(() => this.kind() === 'water' ? 'Water depth' : 'Building level');

    optionId(index: number): string {
        return `${this.optionsId()}-${index}`;
    }
}

@Component({
    selector: 'cover-level-picker',
    imports: [CoverLevelIndicatorComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[attr.data-kind]': 'kind()',
    },
    template: `
        <button
            #triggerEl
            class="bt-button cover-trigger"
            type="button"
            aria-haspopup="listbox"
            [class.selected]="selectedOption() !== null"
            [attr.aria-controls]="open() ? optionsId : null"
            [attr.aria-expanded]="open()"
            [attr.aria-label]="ariaLabel()"
            [disabled]="disabled()"
            (click)="toggle()"
            (keydown)="onTriggerKeydown($event)"
        >
            <cover-level-indicator [kind]="kind()" [label]="selectedOption()?.label ?? ''" />
        </button>
    `,
    styles: [`
        :host {
            display: block;
            width: 100%;
            height: 100%;
            min-width: 0;
        }

        .cover-trigger {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            min-width: 0;
            padding: 3px;
            text-align: center;
        }

        .cover-trigger:disabled:not(.selected) {
            border-color: transparent;
            background-color: transparent;
            background-image: none;
            color: inherit;
        }

        :host([data-kind='water']) .cover-trigger.selected,
        :host([data-kind='water']) .cover-trigger.selected:hover,
        :host([data-kind='water']) .cover-trigger.selected:active {
            border-color: #64b5f6;
            background: #1565c0;
            color: #fff;
        }

        :host([data-kind='building']) .cover-trigger.selected,
        :host([data-kind='building']) .cover-trigger.selected:hover,
        :host([data-kind='building']) .cover-trigger.selected:active {
            border-color: #fff;
            background: #d1d1d1;
            color: #000;
        }
    `],
})
export class CoverLevelPickerComponent implements OnDestroy {
    private static nextId = 0;
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly injector = inject(Injector);
    private readonly instanceId = `coverLevelPicker-${CoverLevelPickerComponent.nextId++}`;
    private readonly overlayKey = `${this.instanceId}-overlay`;
    private readonly triggerEl = viewChild<ElementRef<HTMLButtonElement>>('triggerEl');
    private panelRef: ComponentRef<CoverLevelPickerPanelComponent> | null = null;
    private closedSubscription: { unsubscribe(): void } | null = null;

    readonly kind = input.required<CoverLevelPickerKind>();
    readonly value = input('');
    readonly disabled = input(false);
    readonly valueChange = output<CoverLevel>();

    readonly open = signal(false);
    readonly activeIndex = signal(0);
    readonly options = computed(() => coverLevelOptions(this.kind()));
    readonly selectedOption = computed(() => this.options().find(option => option.value === this.value()) ?? null);
    readonly ariaLabel = computed(() => this.kind() === 'water' ? 'Water depth' : 'Building level');
    readonly optionsId = `${this.instanceId}-options`;
    readonly activeOptionId = computed(() => `${this.optionsId}-${this.activeIndex()}`);

    toggle(): void {
        this.open() ? this.close() : this.openDropdown();
    }

    close(): void {
        this.closeDropdown();
    }

    select(value: CoverLevel): void {
        this.valueChange.emit(value);
        this.closeDropdown();
    }

    onTriggerKeydown(event: KeyboardEvent): void {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                this.openDropdown();
                this.moveActive(1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.openDropdown();
                this.moveActive(-1);
                break;
            case 'Home':
                event.preventDefault();
                this.openDropdown();
                this.setActiveIndex(0);
                break;
            case 'End':
                event.preventDefault();
                this.openDropdown();
                this.setActiveIndex(this.options().length - 1);
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                if (this.open()) {
                    const option = this.options()[this.activeIndex()];
                    if (option) this.select(option.value);
                } else {
                    this.openDropdown();
                }
                break;
            case 'Escape':
                event.preventDefault();
                this.closeDropdown();
                break;
            case 'Tab':
                this.closeDropdown();
                break;
        }
    }

    ngOnDestroy(): void {
        this.closeDropdown();
    }

    private openDropdown(): void {
        if (this.open() || this.disabled() || this.options().length === 0) return;
        const selectedIndex = this.options().findIndex(option => option.value === this.value());
        this.activeIndex.set(Math.max(0, selectedIndex));
        this.open.set(true);
        this.attachOverlay();
    }

    private closeDropdown(): void {
        this.open.set(false);
        this.closedSubscription?.unsubscribe();
        this.closedSubscription = null;
        this.panelRef = null;
        this.overlayManager.closeManagedOverlay(this.overlayKey);
    }

    private attachOverlay(): void {
        const trigger = this.triggerEl();
        if (!trigger) return;

        const portal = new ComponentPortal(CoverLevelPickerPanelComponent, null, this.injector);
        const { componentRef, closed } = this.overlayManager.createManagedOverlay(
            this.overlayKey,
            trigger,
            portal,
            {
                closeOnOutsideClick: true,
                panelClass: 'cover-level-picker-overlay',
                anchorActiveSelector: '.cover-option.keyboard-active',
            },
        );

        this.panelRef = componentRef;
        this.syncPanelInputs();
        componentRef.instance.selected.subscribe(value => this.select(value));
        componentRef.instance.pointerHovered.subscribe(index => this.setActiveIndex(index));
        this.closedSubscription = closed.subscribe(() => {
            this.open.set(false);
            this.panelRef = null;
            this.closedSubscription = null;
        });
    }

    private syncPanelInputs(): void {
        const panelRef = this.panelRef;
        if (!panelRef) return;
        panelRef.setInput('kind', this.kind());
        panelRef.setInput('value', this.value());
        panelRef.setInput('optionsId', this.optionsId);
        panelRef.setInput('activeOptionId', this.activeOptionId());
        panelRef.setInput('activeIndex', this.activeIndex());
        panelRef.changeDetectorRef.detectChanges();
    }

    private moveActive(delta: number): void {
        const count = this.options().length;
        if (count === 0) return;
        this.setActiveIndex((this.activeIndex() + delta + count) % count);
    }

    private setActiveIndex(index: number): void {
        if (index < 0 || index >= this.options().length || index === this.activeIndex()) return;
        this.activeIndex.set(index);
        this.syncPanelInputs();
    }
}
