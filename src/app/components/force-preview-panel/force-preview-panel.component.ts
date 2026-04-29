/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { CommonModule } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    type ElementRef,
    inject,
    input,
    output,
    signal,
    untracked,
    viewChild,
} from '@angular/core';

import { MeasureClampOverflowDirective } from '../../directives/measure-clamp-overflow.directive';
import {
    getForcePreviewResolvedUnits,
    getForcePreviewUnitPilotStats,
    type ForcePreviewEntry,
    type ForcePreviewGroup,
    type ForcePreviewUnit,
} from '../../models/force-preview.model';
import type { Options } from '../../models/options.model';
import type { Unit } from '../../models/units.model';
import { CleanModelStringPipe } from '../../pipes/clean-model-string.pipe';
import { DialogsService } from '../../services/dialogs.service';
import { ForceTaggingService } from '../../services/force-tagging.service';
import { OptionsService } from '../../services/options.service';
import { LanceTypeIdentifierUtil } from '../../utils/lance-type-identifier.util';
import {
    NOTE_PREVIEW_LINE_COUNT,
    hasVisibleNoteText,
} from '../../utils/note-preview.util';
import { NO_FORMATION_ID } from '../../utils/formation-type.model';
import { getOrgFromForce, getOrgFromGroup } from '../../utils/org/org-namer.util';
import { UnitDetailsDialogComponent, type UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { ForceTagsComponent, type ForceTagClickEvent } from '../force-tags/force-tags.component';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';

const UNIT_TILE_MIN_WIDTH = 86;
const UNIT_TILE_MAX_WIDTH = 114;
const UNIT_TILE_GAP = 4;
type ForcePreviewSelectionMode = 'multi' | 'single';

@Component({
    selector: 'force-preview-panel',
    standalone: true,
    imports: [CommonModule, CleanModelStringPipe, MeasureClampOverflowDirective, UnitIconComponent, ForceTagsComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    @let unitDisplayName = effectiveUnitDisplayName();
    @let entry = force();
    <div class="force-preview-shell"
        [class.scroll-units-only]="scrollUnitsOnly()"
        [style.--preview-unit-columns]="unitColumnCount()"
        [style.--preview-unit-width.px]="unitTileWidth()">
        @if (showHeader()) {
        <div class="force-preview-header">
            <div class="faction-name-wrapper">
                @if (entry.faction?.img; as factionImg) {
                    <img [src]="factionImg" class="faction-icon" />
                }
                @if (entry.era?.img || entry.era?.icon; as eraImg) {
                    <img [src]="eraImg" class="era-icon" [alt]="entry.era?.name || 'Era'" [title]="entry.era?.name || 'Era'" />
                }
                <div class="force-name-block">
                    <span class="force-preview-name">{{ entry.name || forceOrgName() }}</span>
                    @if (entry.name && forceOrgName()) {
                        <span class="force-org-name">{{ forceOrgName() }}</span>
                    }
                </div>
            </div>
            <div class="force-preview-info">
                <span class="force-preview-meta">
                    <span class="game-type-badge" [class.as]="entry.type === 'as'">
                        {{ entry.type === 'as' ? 'AS' : 'CBT' }}
                    </span>
                    @if (entry.type === 'as') {
                        @if (entry.pv && entry.pv > 0) {
                            <span class="force-bv">PV: {{ entry.pv | number }}</span>
                        }
                    } @else {
                        @if (entry.bv && entry.bv > 0) {
                            <span class="force-bv">BV: {{ entry.bv | number }}</span>
                        }
                    }
                </span>
                @if (showEditableForceTags()) {
                    <force-tags
                        class="force-preview-tags"
                        [force]="entry"
                        [mode]="'full'"
                        [editable]="true"
                        [tagsVersion]="forceTagsVersion()"
                        (tagClick)="onForceTagClick($event)">
                    </force-tags>
                }
            </div>
        </div>
        }
        <div #forcePreviewViewport class="force-preview">
            @if (showNote() && hasVisibleNote(entry.note)) {
            @let noteIsExpandable = noteOverflowing();
            <div class="force-preview-note-shell">
                @if (noteIsExpandable) {
                <button
                    type="button"
                    class="force-preview-note-toggle"
                    [attr.aria-expanded]="noteExpanded()"
                    (click)="toggleNoteExpanded()">
                    <svg class="chevron" width="12px" height="12px" fill="currentColor" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" [class.collapsed]="!noteExpanded()">
                        <path d="M0 2l5 6 5-6z"/>
                    </svg>
                    <span
                        class="force-preview-note-summary"
                        [class.clamped]="!noteExpanded()"
                        [measureClampOverflow]="entry.note ?? ''"
                        [measureClampOverflowLines]="notePreviewLineCount"
                        (measureClampOverflowChange)="onNoteOverflowChange($event)">{{ entry.note }}</span>
                </button>
                } @else {
                <div class="force-preview-note-static">
                    <span
                        class="force-preview-note-summary"
                        [class.clamped]="true"
                        [measureClampOverflow]="entry.note ?? ''"
                        [measureClampOverflowLines]="notePreviewLineCount"
                        (measureClampOverflowChange)="onNoteOverflowChange($event)">{{ entry.note }}</span>
                </div>
                }
            </div>
            }
            <div class="unit-scroll">
                @for (gd of groupDisplayData(); track gd.group) {
                <div class="unit-group">
                    <div class="group-name">{{ gd.name }}
                        @if (gd.formationName; as formationName) {
                            @if (gd.name) { <span class="group-sep">·</span> }
                            <span class="group-formation">{{ formationName }}</span>
                        }
                        @if (gd.orgName; as orgName) {
                            @if (gd.name || gd.formationName) { <span class="group-sep">·</span> }
                            <span class="group-org">{{ orgName }}</span>
                        }
                    </div>
                    <div class="units">
                        @for (unitEntry of gd.group.units; let i = $index; track i) {
                        <div class="unit-tile"
                            (pointerenter)="onUnitHover(unitEntry)"
                            (pointerleave)="onUnitHover(null)">
                            <div class="unit-square compact-mode"
                                [class.destroyed]="unitEntry.destroyed"
                                [class.missing]="!unitEntry.unit"
                                [class.clickable]="!!unitEntry.unit"
                                (click)="onUnitClick(unitEntry)">
                                @if (unitEntry.commander) {
                                    <div class="group-commander-indicator" aria-hidden="true">
                                        <svg class="group-commander-icon" width="42.08" height="51.88" viewBox="0 0 21.04 25.94" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" focusable="false">
                                            <g transform="translate(-.02)">
                                                <g transform="matrix(.265 0 0 .265 -21.1 0)" fill="currentColor">
                                                    <path d="m79.7 70 39.3-70 40 70.1h-27l-13-22.1-13 22.1z" />
                                                    <path d="m81.4 97.9 11.3-21.6h52.3l12 21.6z" />
                                                </g>
                                            </g>
                                        </svg>
                                    </div>
                                }
                                <div class="unit-content">
                                    <unit-icon [unit]="unitEntry.unit" [size]="32"></unit-icon>
                                    @if (unitDisplayName === 'chassisModel'
                                        || unitDisplayName === 'both'
                                        || !unitEntry.alias) {
                                    <div class="unit-model">{{ unitEntry.unit?.model | cleanModelString }}</div>
                                    <div class="unit-chassis">{{ unitEntry.unit?.chassis }}</div>
                                    }
                                    @if (unitDisplayName === 'alias' || unitDisplayName === 'both') {
                                    <div class="unit-alias"
                                        [class.thin]="unitDisplayName === 'both'">{{ unitEntry.alias }}</div>
                                    }
                                    <div class="pilot-info info-slot numeric slim">
                                        <span class="value">{{ getPilotStats(unitEntry) }}</span>
                                    </div>
                                </div>
                            </div>

                            @if (showLockControls() || showSelectionControls()) {
                                <div class="unit-actions" [class.single-action]="showLockControls() !== showSelectionControls()">
                                    @if (showLockControls()) {
                                        <button
                                            class="unit-lock-button bt-button"
                                            type="button"
                                            [class.locked]="isLocked(unitEntry)"
                                            (click)="onLockButtonClick($event, unitEntry)">
                                            {{ isLocked(unitEntry) ? 'UNLOCK' : 'LOCK' }}
                                        </button>
                                    }

                                    @if (showSelectionControls()) {
                                        <input
                                            class="bt-checkbox unit-selection-checkbox"
                                            type="checkbox"
                                            [checked]="isSelected(unitEntry)"
                                            [attr.aria-label]="selectionMode() === 'single' ? 'Select unit' : 'Toggle unit selection'"
                                            (click)="$event.stopPropagation()"
                                            (change)="onSelectionChange($event, unitEntry)" />
                                    }
                                </div>
                            }
                        </div>
                        }
                    </div>
                </div>
                }
            </div>
        </div>
        @if (showHint()) {
            <div class="hint">Select a unit for detailed readout</div>
        }
    </div>
    `,
    styles: [`
        :host {
            display: flex;
            flex-direction: column;
            width: 100%;
            --preview-selection-accent: #62c4ff;
        }

        .force-preview-shell {
            display: flex;
            flex-direction: column;
            width: 100%;
            min-height: 0;
        }

        .force-preview-shell.scroll-units-only {
            flex: 1 1 auto;
        }

        .force-preview-shell.scroll-units-only .force-preview-header,
        .force-preview-shell.scroll-units-only .hint {
            flex-shrink: 0;
        }

        .force-preview {
            width: 100%;
            box-sizing: border-box;
            min-height: 0;
        }

        .force-preview-shell.scroll-units-only .force-preview {
            display: flex;
            flex: 1 1 auto;
            flex-direction: column;
            min-height: 0;
            overflow-x: hidden;
            overflow-y: auto;
        }

        .force-preview-header {
            display: flex;
            justify-content: space-between;
            align-items: first baseline;
            margin-bottom: 8px;
        }

        .faction-name-wrapper {
            display: flex;
            align-items: first baseline;
            gap: 4px;
            flex-direction: row;
            flex: 1 1 0;
        }

        .faction-icon,
        .era-icon {
            width: 1.2em;
            height: 1.2em;
            object-fit: contain;
            flex-shrink: 0;
            align-self: flex-start;
        }

        .force-name-block {
            display: flex;
            flex-direction: column;
            text-align: left;
        }

        .force-preview-name {
            font-weight: 600;
            font-size: 1em;
        }

        .force-org-name {
            font-size: 0.75em;
            color: var(--text-color-secondary);
        }

        .force-preview-info {
            display: flex;
            flex-direction: column;
            gap: 4px;
            align-items: flex-end;
            font-size: 0.85em;
            color: var(--text-color-secondary);
        }

        .force-preview-meta {
            display: flex;
            gap: 8px;
            align-items: first baseline;
            justify-content: flex-end;
        }

        .force-preview-tags {
            max-width: min(280px, 100%);
        }

        .force-preview-note-shell {
            display: flex;
            flex-direction: column;
            margin-bottom: 8px;
        }

        .force-preview-note-toggle {
            display: flex;
            align-items: flex-start;
            gap: 4px;
            width: 100%;
            padding: 4px;
            border: 0;
            background: transparent;
            color: inherit;
            font: inherit;
            cursor: pointer;
            text-align: left;
        }

        .force-preview-note-toggle:hover {
            background: rgba(255, 255, 255, 0.04);
        }

        .force-preview-note-static {
            display: flex;
            align-items: flex-start;
            gap: 4px;
            width: 100%;
            padding: 4px;
            box-sizing: border-box;
        }

        .force-preview-note-summary {
            display: block;
            flex: 1 1 auto;
            color: var(--text-color-secondary);
            font-size: 0.75em;
            line-height: 1.45;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            min-width: 0;
        }

        .force-preview-note-summary.clamped {
            display: -webkit-box;
            line-clamp: 2;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .chevron {
            color: var(--text-color-secondary);
            transition: transform 0.15s ease;
            flex-shrink: 0;
            margin-top: 2px;
        }

        .chevron.collapsed {
            transform: rotate(-90deg);
        }

        .game-type-badge {
            font-size: 0.7em;
            font-weight: bold;
            padding: 1px 5px;
            background: #a2792c;
            border: 1px solid #a2792c;
            color: #fff;
            text-transform: uppercase;
            flex-shrink: 0;
            align-self: center;
        }

        .game-type-badge.as {
            background: #811313;
            border: 1px solid #811313;
        }

        .force-bv {
            font-weight: 600;
        }

        .unit-scroll {
            display: flex;
            flex-direction: column;
            gap: 4px;
            overflow-y: auto;
        }

        .force-preview-shell.scroll-units-only .unit-scroll {
            flex: 0 0 auto;
            min-height: auto;
            overflow: visible;
        }

        .unit-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
            border-bottom: 1px solid var(--border-color, #333);
            padding-bottom: 4px;
        }

        .unit-group:last-child {
            border-bottom: none;
            padding-bottom: 0;
        }

        .group-name {
            font-size: 0.8em;
            color: var(--text-color-secondary);
            text-align: left;
        }

        .units {
            display: grid;
            grid-template-columns: repeat(var(--preview-unit-columns, 1), minmax(0, var(--preview-unit-width, 92px)));
            gap: 4px;
            justify-content: start;
            align-items: stretch;
        }

        .unit-tile {
            display: flex;
            flex-direction: column;
            gap: 2px;
            width: 100%;
            min-width: 0;
            max-width: 114px;
            min-height: 0;
            height: 100%;
            align-self: stretch;

            .unit-square {
                width: 100%;
            }
        }

        .group-sep {
            color: var(--text-color-secondary);
            margin: 0 2px;
        }

        .group-org,
        .group-formation {
            font-weight: 400;
            color: var(--text-color-secondary);
        }

        .unit-square.compact-mode {
            width: 100%;
            flex: 1 1 auto;
            min-height: 80px;
            max-height: 105px;
            min-width: 0;
            background: #0003;
            border: 1px solid var(--border-color, #333);
            padding: 2px;
            display: flex;
            flex-direction: column;
            align-items: center;
            overflow: hidden;
            box-sizing: border-box;
            position: relative;
        }

        .group-commander-indicator {
            position: absolute;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: var(--bt-yellow);
            pointer-events: none;
            z-index: 1;
            opacity: 0.5;
            top: 3px;
            left: 3px;
        }

        .group-commander-icon {
            width: 16px;
            height: auto;
            transform: rotate(180deg);
            flex-shrink: 0;
        }

        .unit-content {
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            position: relative;
            z-index: 2;
        }

        .unit-square.compact-mode.destroyed {
            background-image: repeating-linear-gradient(
                140deg,
                #500B 0px,
                #500B 12px,
                #300A 12px,
                #300A 24px
            );
        }

        .unit-square.compact-mode.destroyed unit-icon {
            filter: grayscale(1) brightness(0.7) sepia(1) hue-rotate(-30deg) saturate(6) contrast(1.2);
        }

        .unit-square.compact-mode.missing {
            background-color: #F003;
        }

        .unit-square.compact-mode.clickable {
            cursor: pointer;
        }

        .unit-square.compact-mode.clickable:hover {
            background: #fff1;
        }

        .unit-lock-button {
            min-height: 24px;
            padding: 2px 4px;
            font-size: 0.62em;
            letter-spacing: 0.08em;
        }

        .unit-actions {
            display: flex;
            align-items: stretch;
            gap: 2px;
            width: 100%;
        }

        .unit-actions > .bt-button {
            flex: 1 1 0;
            min-width: 0;
            align-self: stretch;
        }

        .unit-actions.single-action > * {
            flex-basis: 100%;
        }

        .unit-actions.single-action > .unit-selection-checkbox {
            flex: 1 1 100%;
            width: 100%;
            min-width: 0;
        }

        .unit-selection-checkbox {
            margin: 0;
            flex: 0 0 24px;
            width: 24px;
            min-width: 24px;
            min-height: 24px;
            height: auto;
            box-sizing: border-box;
        }

        .unit-selection-checkbox:checked {
            background-image:
                linear-gradient(var(--preview-selection-accent), var(--preview-selection-accent)),
                linear-gradient(var(--preview-selection-accent), var(--preview-selection-accent)),
                linear-gradient(var(--preview-selection-accent), var(--preview-selection-accent)),
                linear-gradient(var(--preview-selection-accent), var(--preview-selection-accent)),
                linear-gradient(var(--preview-selection-accent), var(--preview-selection-accent)),
                linear-gradient(var(--preview-selection-accent), var(--preview-selection-accent)),
                linear-gradient(var(--preview-selection-accent), var(--preview-selection-accent)),
                linear-gradient(var(--preview-selection-accent), var(--preview-selection-accent)),
                linear-gradient(var(--preview-selection-accent), var(--preview-selection-accent));
        }

        .unit-selection-label {
            line-height: 1;
        }

        .unit-lock-button.locked {
            background: #a2792c;
        }

        .unit-model {
            color: var(--text-color-secondary);
            font-size: 0.6em;
            text-align: center;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            max-width: 100%;
            display: block;
        }

        .unit-alias,
        .unit-chassis {
            font-size: 0.7em;
            color: var(--text-color);
            word-break: break-word;
            text-align: center;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .unit-alias {
            font-weight: bold;
        }

        .unit-alias.thin {
            font-size: 0.6em;
            font-weight: normal;
        }

        .info-slot {
            padding: 0 2px;
            gap: 1px;
            justify-content: start;
            font-size: 0.7em;
            position: absolute;
        }

        .info-slot.numeric {
            justify-content: end;
        }

        .pilot-info {
            top: 3px;
            right: 3px;
        }

        .hint {
            font-size: 0.7em;
            color: var(--text-color-secondary);
            text-align: center;
            padding-top: 6px;
            opacity: 0.7;
            font-style: italic;
        }
    `],
})
export class ForcePreviewPanelComponent {
    private readonly dialogsService = inject(DialogsService);
    private readonly forceTaggingService = inject(ForceTaggingService);
    readonly optionsService = inject(OptionsService);
    private readonly forcePreviewViewport = viewChild<ElementRef<HTMLElement>>('forcePreviewViewport');
    private readonly previewViewportWidth = signal(UNIT_TILE_MAX_WIDTH);

    readonly force = input.required<ForcePreviewEntry>();
    readonly showHeader = input(true);
    readonly showHint = input(true);
    readonly showNote = input(true);
    readonly scrollUnitsOnly = input(false);
    readonly showLockControls = input(false);
    readonly showSelectionControls = input(false);
    readonly selectionMode = input<ForcePreviewSelectionMode>('multi');
    readonly displayMode = input<Options['unitDisplayName'] | null>(null);
    readonly lockedUnitKeys = input<ReadonlySet<string>>(new Set<string>());
    readonly lockToggle = input<((unitEntry: ForcePreviewUnit) => void) | null>(null);
    readonly variantChange = input<((unitEntry: ForcePreviewUnit, variant: Unit) => void) | null>(null);
    readonly hoveredUnitChange = output<ForcePreviewUnit | null>();
    readonly selectedUnitsChange = output<ForcePreviewUnit[]>();
    private readonly selectedUnits = signal<ReadonlySet<ForcePreviewUnit>>(new Set<ForcePreviewUnit>());
    readonly noteExpanded = signal(false);
    readonly forceTagsVersion = signal(0);

    readonly unitColumnCount = computed(() => {
        const viewportWidth = Math.max(this.previewViewportWidth(), UNIT_TILE_MIN_WIDTH);
        return Math.max(1, Math.floor((viewportWidth + UNIT_TILE_GAP) / (UNIT_TILE_MIN_WIDTH + UNIT_TILE_GAP)));
    });

    readonly unitTileWidth = computed(() => {
        const viewportWidth = Math.max(this.previewViewportWidth(), UNIT_TILE_MIN_WIDTH);
        const columns = this.unitColumnCount();
        const totalGapWidth = UNIT_TILE_GAP * Math.max(0, columns - 1);
        const availableTileWidth = (viewportWidth - totalGapWidth) / columns;

        return Math.min(UNIT_TILE_MAX_WIDTH, Math.max(UNIT_TILE_MIN_WIDTH, availableTileWidth));
    });

    readonly effectiveUnitDisplayName = computed<Options['unitDisplayName']>(
        () => this.displayMode() ?? this.optionsService.options().unitDisplayName,
    );

    readonly resolvedUnits = computed<Unit[]>(() => getForcePreviewResolvedUnits(this.force()));
    readonly notePreviewLineCount = NOTE_PREVIEW_LINE_COUNT;
    readonly noteOverflowing = signal(false);

    readonly forceOrgName = computed(() => {
        const result = getOrgFromForce(this.force());
        return result.name !== 'Force' ? result.name : null;
    });

    readonly showEditableForceTags = computed(() => {
        const entry = this.force();
        return !!entry.instanceId && entry.owned;
    });

    readonly groupDisplayData = computed(() => this.force().groups.map((group: ForcePreviewGroup) => {
        const sizeResult = getOrgFromGroup(group);
        const orgName = sizeResult.name && sizeResult.name !== 'Force' ? sizeResult.name : null;

        const name = group.name || LanceTypeIdentifierUtil.getFormationName(group.formationId) || '';

        let formationName: string | null = null;
        if (group.formationId && group.formationId !== NO_FORMATION_ID && group.name) {
            const candidateFormationName = LanceTypeIdentifierUtil.getFormationName(group.formationId);
            if (candidateFormationName && !group.name.includes(candidateFormationName)) {
                formationName = candidateFormationName;
            }
        }

        return { group, name, orgName, formationName };
    }));

    constructor() {
        effect((onCleanup) => {
            const viewport = this.forcePreviewViewport()?.nativeElement;
            if (!viewport) {
                return;
            }

            const updateViewportWidth = () => {
                this.previewViewportWidth.set(Math.max(UNIT_TILE_MIN_WIDTH, viewport.clientWidth));
            };

            updateViewportWidth();

            if (typeof ResizeObserver === 'undefined') {
                return;
            }

            const resizeObserver = new ResizeObserver(() => updateViewportWidth());
            resizeObserver.observe(viewport);

            onCleanup(() => resizeObserver.disconnect());
        });

        effect(() => {
            const force = this.force();
            const showNote = this.showNote();
            void force.instanceId;
            void force.note;
            void showNote;

            untracked(() => {
                this.noteExpanded.set(false);
                this.noteOverflowing.set(false);
            });
        });

        effect(() => {
            this.force();
            untracked(() => {
                if (this.selectedUnits().size === 0) {
                    return;
                }

                this.selectedUnits.set(new Set<ForcePreviewUnit>());
                this.selectedUnitsChange.emit([]);
            });
        });
    }

    getPilotStats(loadForceUnit: ForcePreviewUnit): string {
        return getForcePreviewUnitPilotStats(loadForceUnit, this.force().type);
    }

    onUnitClick(loadForceUnit: ForcePreviewUnit): void {
        if (!loadForceUnit.unit) {
            return;
        }

        const unitList = this.resolvedUnits();
        const unitIndex = unitList.findIndex((unit: Unit) => unit === loadForceUnit.unit || unit.name === loadForceUnit.unit?.name);
        const variantChange = this.variantChange();
        this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: {
                unitList,
                unitIndex: unitIndex >= 0 ? unitIndex : 0,
                hideAddButton: true,
                gameSystem: this.force().type,
                changeAction: variantChange ? {
                    originalUnit: loadForceUnit.unit,
                    apply: (variant: Unit) => variantChange(loadForceUnit, variant),
                    closeParentOnChange: true,
                } : undefined,
                showChangeButton: false,
            } satisfies UnitDetailsDialogData,
        });
    }

    async onForceTagClick({ force, event }: ForceTagClickEvent): Promise<void> {
        event.stopPropagation();
        const target = (event.currentTarget as HTMLElement) || (event.target as HTMLElement);
        const anchorElement = (target.closest('.add-tag-btn') as HTMLElement) || target;

        await this.forceTaggingService.openForceTagSelector([force], anchorElement, {
            updateCloud: force.cloud ?? true,
            onTagsChanged: () => this.forceTagsVersion.update(version => version + 1),
        });
    }

    onUnitHover(loadForceUnit: ForcePreviewUnit | null): void {
        this.hoveredUnitChange.emit(loadForceUnit?.unit ? loadForceUnit : null);
    }

    isLocked(loadForceUnit: ForcePreviewUnit): boolean {
        return !!loadForceUnit.lockKey && this.lockedUnitKeys().has(loadForceUnit.lockKey);
    }

    isSelected(loadForceUnit: ForcePreviewUnit): boolean {
        return this.selectedUnits().has(loadForceUnit);
    }

    onLockButtonClick(event: Event, loadForceUnit: ForcePreviewUnit): void {
        event.stopPropagation();
        this.lockToggle()?.(loadForceUnit);
    }

    onSelectionChange(event: Event, loadForceUnit: ForcePreviewUnit): void {
        event.stopPropagation();

        const checked = (event.target as HTMLInputElement).checked;
        const nextSelectedUnits = new Set<ForcePreviewUnit>();

        if (this.selectionMode() === 'single') {
            if (checked) {
                nextSelectedUnits.add(loadForceUnit);
            }
        } else {
            for (const unit of this.selectedUnits()) {
                nextSelectedUnits.add(unit);
            }

            if (checked) {
                nextSelectedUnits.add(loadForceUnit);
            } else {
                nextSelectedUnits.delete(loadForceUnit);
            }
        }

        this.selectedUnits.set(nextSelectedUnits);
        this.selectedUnitsChange.emit([...nextSelectedUnits]);
    }

    hasVisibleNote(note: string | null | undefined): boolean {
        return hasVisibleNoteText(note);
    }

    onNoteOverflowChange(isOverflowing: boolean): void {
        if (this.noteOverflowing() === isOverflowing) {
            return;
        }

        this.noteOverflowing.set(isOverflowing);
        if (!isOverflowing) {
            this.noteExpanded.set(false);
        }
    }

    toggleNoteExpanded(): void {
        this.noteExpanded.update((expanded) => !expanded);
    }
}