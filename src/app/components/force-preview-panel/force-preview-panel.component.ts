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
import { CdkMenuModule } from '@angular/cdk/menu';
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
import { formationNameMatchesGroupName, NO_FORMATION_ID, type FormationTypeDefinition } from '../../utils/formation-type.model';
import { getOrgFromForce, getOrgFromGroup } from '../../utils/org/org-namer.util';
import { FormationInfoDialogComponent, type FormationInfoDialogData } from '../formation-info-dialog/formation-info-dialog.component';
import { UnitDetailsDialogComponent, type UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { ForceTagsComponent, type ForceTagClickEvent } from '../force-tags/force-tags.component';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { GameSystem } from '../../models/common.model';
import { PVCalculatorUtil } from '../../utils/pv-calculator.util';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../../models/crew-member.model';
import { BVCalculatorUtil } from '../../utils/bv-calculator.util';

const UNIT_TILE_MIN_WIDTH = 86;
const UNIT_TILE_MAX_WIDTH = 114;
const UNIT_TILE_GAP = 4;
type ForcePreviewSelectionMode = 'multi' | 'single';
export type ForcePreviewUnitMenuAction = 'edit-pilot' | 'toggle-chassis-lock' | 'reroll-unit-keep-pilot' | 'reroll-unit-and-pilot' | 'reject';
export type ForcePreviewUnitMenuIcon = 'pilot' | 'lock' | 'reroll' | 'reject';

export interface ForcePreviewUnitMenuItem {
    action: ForcePreviewUnitMenuAction;
    label: string | ((unitEntry: ForcePreviewUnit) => string);
    icon: ForcePreviewUnitMenuIcon;
    danger?: boolean;
    closeOnSelect?: boolean;
}

export interface ForcePreviewUnitMenuActionEvent {
    action: ForcePreviewUnitMenuAction;
    unitEntry: ForcePreviewUnit;
}

@Component({
    selector: 'force-preview-panel',
    standalone: true,
    imports: [CommonModule, CdkMenuModule, CleanModelStringPipe, MeasureClampOverflowDirective, UnitIconComponent, ForceTagsComponent],
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
                @if (entry.era; as era) {
                    @if (era.img || era.icon; as eraImg) {
                        <img [src]="eraImg" class="era-icon" [alt]="era.name || 'Era'" [title]="era.name || 'Era'" />
                    }
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
            </div>
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
                    <div class="group-name">
                        @if (gd.name) {
                            <span>{{ gd.name }}</span>
                        }
                        @if (gd.formationName; as formationName) {
                            @if (gd.name) { <span class="group-sep">·</span> }
                            <span class="group-formation">{{ formationName }}</span>
                        }
                        @if (gd.orgName; as orgName) {
                            @if (gd.name || gd.formationName) { <span class="group-sep">·</span> }
                            <span class="group-org">{{ orgName }}</span>
                        }
                        @if (gd.formation; as formation) {
                            <button
                                class="btn-formation-info"
                                type="button"
                                title="Formation info"
                                [attr.aria-label]="'Formation info: ' + formation.name"
                                (click)="showFormationInfo($event, gd.group, formation, gd.formationDisplayName)">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                            </button>
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
                                    @if (showUnitCost() && unitEntry.unit) {
                                    <div class="spanner"></div>
                                    <div class="unit-cost">
                                        <div class="value">{{ getUnitCost(unitEntry) }}</div>
                                    </div>
                                    }
                                </div>
                            </div>

                            @if (showLockControls() || controls() !== 'none') {
                                <div class="unit-actions" [class.single-action]="showLockControls() !== (controls() !== 'none')">
                                    @if (showLockControls()) {
                                        <button
                                            class="unit-lock-button bt-button"
                                            type="button"
                                            [class.locked]="isLocked(unitEntry)"
                                            [class.locked-chassis-only]="isChassisOnlyLocked(unitEntry)"
                                            (click)="onLockButtonClick($event, unitEntry)">
                                            {{ isLocked(unitEntry) ? ( isChassisOnlyLocked(unitEntry) ? 'UNLOCK CHASSIS' : 'UNLOCK' ) : 'LOCK' }}
                                        </button>
                                    }

                                    @if (controls() === 'menu') {
                                        <button
                                            class="bt-button unit-menu-button"
                                            type="button"
                                            aria-label="Unit options"
                                            [cdkMenuTriggerFor]="unitMenu"
                                            #unitMenuTrigger="cdkMenuTriggerFor"
                                            (click)="onUnitMenuClick($event, unitEntry)">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                                        </button>
                                        <ng-template #unitMenu>
                                            <div class="popup-menu glass framed-borders has-shadow" cdkMenu>
                                                @for (item of unitMenuItems(); track item.action) {
                                                    <button
                                                        class="menu-item"
                                                        type="button"
                                                        cdkMenuItem
                                                        [class.danger]="item.danger === true"
                                                        [disabled]="!unitEntry.unit"
                                                        (click)="onUnitMenuItemClick(item, unitEntry, unitMenuTrigger.close.bind(unitMenuTrigger))">
                                                        <span class="icon">
                                                            @switch (item.icon) {
                                                                @case ('pilot') {
                                                                    <svg width="16px" height="16px" viewBox="-3 -3 54 54" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                                                        <path d="M 24.9,0 C 13.1,0.516 3.5,10.2 3.5,21.5 v 22.2 c 0,0.3 0.2,0.6 0.5,0.7 l 15.4,6.5 c 1.2,0.4 2.3,-0.3 2.3,-1.5 v -7.9 c 0,0 0,0 0,0 v -7.2 c 0,-0.4 -0.2,-1 -0.5,-1.4 l -7.9,-5 v 0 c -1.2,-0.6 -2.1,-2 -2,-3.4 0.3,-2.1 2.2,-3.5 4.3,-3.5 h 6.3 c 0.9,0 1.7,0.6 1.7,1.5 v 9.3 c 0,0 0,0.8 2.3,0.8 2.3,0 2.3,-0.8 2.3,-0.8 V 22.5 C 28.1,21.6 29,21 29.8,21 H 36 c 2.2,0 4,1.4 4.3,3.5 0.1,1.4 -0.8,2.8 -1.9,3.4 v 0 l -7.9,5 c -0.2,0.4 -0.6,1 -0.6,1.4 v 7.2 7.9 c 0,1.2 1,1.9 2.3,1.5 l 15.1,-6.5 c 0.2,-0.1 0.2,-0.3 0.2,-0.7 V 21 C 47.7,9.04 37.2,-0.568 24.9,0 Z" />
                                                                    </svg>
                                                                }
                                                                @case ('lock') {
                                                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                                                                        <path fill-rule="evenodd" clip-rule="evenodd" d="M4 6V4C4 1.79086 5.79086 0 8 0C10.2091 0 12 1.79086 12 4V6H14V16H2V6H4ZM6 4C6 2.89543 6.89543 2 8 2C9.10457 2 10 2.89543 10 4V6H6V4ZM7 13V9H9V13H7Z"/>
                                                                    </svg>
                                                                }
                                                                @case ('reroll') {
                                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                                                        <path d="M20 12C20 16.4183 16.4183 20 12 20C9.53614 20 7.33243 18.8868 5.86408 17.1359M4 12C4 7.58172 7.58172 4 12 4C14.4639 4 16.6676 5.11324 18.1359 6.86408M18.1359 6.86408V3M18.1359 6.86408H14.5M5.86408 17.1359V21M5.86408 17.1359H9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                                                                    </svg>
                                                                }
                                                                @case ('reject') {
                                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                                                        <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.71 2.88 18.3 9.17 12 2.88 5.71 4.29 4.29 10.59 10.59 16.89 4.29 18.3 5.71Z" />
                                                                    </svg>
                                                                }
                                                            }
                                                        </span>
                                                        {{ getUnitMenuItemLabel(item, unitEntry) }}
                                                    </button>
                                                }
                                            </div>
                                        </ng-template>
                                    }
                                    @else if (controls() === 'selection') {
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
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            grid-template-areas:
                "name meta"
                "tags tags";
            gap: 4px 8px;
            align-items: start;
            margin-bottom: 8px;
        }

        .faction-name-wrapper {
            grid-area: name;
            display: flex;
            align-items: first baseline;
            gap: 4px;
            flex-direction: row;
            flex: 1 1 0;
            min-width: 0;
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
            min-width: 0;
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
            grid-area: meta;
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
            grid-area: tags;
            justify-self: stretch;
            width: 100%;
            max-width: 100%;
            min-width: 0;
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
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 0 2px;
        }

        .btn-formation-info {
            flex-shrink: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: none;
            border: none;
            color: var(--text-color-tertiary);
            cursor: pointer;
            padding: 2px;
            border-radius: 50%;
            transition: color 0.15s;
        }

        .btn-formation-info:hover {
            color: var(--bt-yellow);
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
            height: 100%;
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
            white-space: normal;
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

        .unit-actions > .unit-menu-button {
            flex: 0 0 32px;
            max-width: 32px;
            height: 24px;
            margin: 0;
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

        .unit-lock-button.locked-chassis-only {
            background: #2c5fa2;
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

        .unit-cost {
            width: 100%;
            box-sizing: border-box;
            display: flex;
            justify-content: right;
            padding-right: 4px;
            padding-bottom: 4px;
            font-size: 0.7em;
            margin-top: 6px;
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
    readonly showUnitCost = input(false);
    readonly controls = input<('none' | 'selection' | 'menu')>('none');
    readonly selectionMode = input<ForcePreviewSelectionMode>('multi');
    readonly displayMode = input<Options['unitDisplayName'] | null>(null);
    readonly unitMenuItems = input<readonly ForcePreviewUnitMenuItem[]>([]);
    readonly lockedUnitKeys = input<ReadonlySet<string>>(new Set<string>());
    readonly chassisOnlyLockedUnitKeys = input<ReadonlySet<string>>(new Set<string>());
    readonly lockToggle = input<((unitEntry: ForcePreviewUnit) => void) | null>(null);
    readonly variantChange = input<((unitEntry: ForcePreviewUnit, variant: Unit) => void) | null>(null);
    readonly hoveredUnitChange = output<ForcePreviewUnit | null>();
    readonly selectedUnitsChange = output<ForcePreviewUnit[]>();
    readonly unitMenuAction = output<ForcePreviewUnitMenuActionEvent>();
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

    readonly groupDisplayData = computed(() => {
        const entry = this.force();
        return entry.groups.map((group: ForcePreviewGroup) => {
            const sizeResult = getOrgFromGroup(group);
            const orgName = sizeResult.name && sizeResult.name !== 'Force' ? sizeResult.name : null;
            const formation = this.getPreviewFormation(group, entry.type);
            const formationDisplayName = formation ? this.getPreviewFormationDisplayName(formation, orgName) : null;
            const displayOrgName = formation ? null : orgName;

            const name = group.name || formationDisplayName || '';

            let formationName: string | null = null;
            if (formation && formationDisplayName && group.name) {
                if (!formationNameMatchesGroupName(formation, group.name)) {
                    formationName = formationDisplayName;
                }
            }

            return { group, name, orgName: displayOrgName, formationName, formation, formationDisplayName };
        });
    });

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

    getUnitCost(loadForceUnit: ForcePreviewUnit): string {
        if (!loadForceUnit.unit) {
            return '';
        }
        if (this.force().type == GameSystem.ALPHA_STRIKE) {
            const adjustedPV = PVCalculatorUtil.calculateAdjustedPV(loadForceUnit.unit.as.PV, loadForceUnit.skill ?? DEFAULT_GUNNERY_SKILL);
            return `PV: ${adjustedPV}`;
        }
        const adjustedBV = BVCalculatorUtil.calculateAdjustedBV(loadForceUnit.unit, loadForceUnit.unit.bv, loadForceUnit.gunnery ?? DEFAULT_GUNNERY_SKILL, loadForceUnit.piloting ?? DEFAULT_PILOTING_SKILL);
        return `BV: ${adjustedBV}`;
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

    showFormationInfo(
        event: MouseEvent,
        group: ForcePreviewGroup,
        formation: FormationTypeDefinition,
        formationDisplayName: string | null,
    ): void {
        event.stopPropagation();
        this.dialogsService.createDialog(FormationInfoDialogComponent, {
            data: {
                formation,
                gameSystem: this.force().type,
                formationDisplayName: formationDisplayName ?? formation.name,
                unitCount: group.units.length,
            } satisfies FormationInfoDialogData,
        });
    }

    onUnitHover(loadForceUnit: ForcePreviewUnit | null): void {
        this.hoveredUnitChange.emit(loadForceUnit?.unit ? loadForceUnit : null);
    }

    private getPreviewFormation(
        group: ForcePreviewGroup,
        gameSystem: ForcePreviewEntry['type'],
    ): FormationTypeDefinition | null {
        if (!group.formationId || group.formationId === NO_FORMATION_ID) {
            return null;
        }

        return LanceTypeIdentifierUtil.getDefinitionById(group.formationId, gameSystem);
    }

    private getPreviewFormationDisplayName(
        formation: FormationTypeDefinition,
        orgName: string | null,
    ): string {
        if (!orgName || formation.name.includes(orgName)) {
            return formation.name;
        }

        if (orgName.includes('Level')) {
            return `${orgName} - ${formation.name}`;
        }

        return `${formation.name} ${orgName}`;
    }

    isLocked(loadForceUnit: ForcePreviewUnit): boolean {
        return !!loadForceUnit.lockKey && this.lockedUnitKeys().has(loadForceUnit.lockKey);
    }

    isChassisOnlyLocked(loadForceUnit: ForcePreviewUnit): boolean {
        return !!loadForceUnit.lockKey && this.chassisOnlyLockedUnitKeys().has(loadForceUnit.lockKey);
    }

    isSelected(loadForceUnit: ForcePreviewUnit): boolean {
        return this.selectedUnits().has(loadForceUnit);
    }

    onLockButtonClick(event: Event, loadForceUnit: ForcePreviewUnit): void {
        event.stopPropagation();
        this.lockToggle()?.(loadForceUnit);
    }

    onUnitMenuClick(event: Event, loadForceUnit: ForcePreviewUnit): void {
        event.stopPropagation();
    }

    getUnitMenuItemLabel(item: ForcePreviewUnitMenuItem, unitEntry: ForcePreviewUnit): string {
        return typeof item.label === 'function' ? item.label(unitEntry) : item.label;
    }

    onUnitMenuItemClick(item: ForcePreviewUnitMenuItem, unitEntry: ForcePreviewUnit, closeMenu: () => void): void {
        this.onUnitMenuAction(item.action, unitEntry);
        if (item.closeOnSelect !== false) {
            closeMenu();
        }
    }

    onUnitMenuAction(action: ForcePreviewUnitMenuAction, unitEntry: ForcePreviewUnit): void {
        this.unitMenuAction.emit({ action, unitEntry });
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