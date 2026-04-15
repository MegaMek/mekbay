import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import {
    getLoadForceUnitPilotStats,
    type LoadForceEntry,
    type LoadForceGroup,
    type LoadForceUnit,
} from '../../models/load-force-entry.model';
import type { Options } from '../../models/options.model';
import type { Unit } from '../../models/units.model';
import { CleanModelStringPipe } from '../../pipes/clean-model-string.pipe';
import { DialogsService } from '../../services/dialogs.service';
import { OptionsService } from '../../services/options.service';
import { LanceTypeIdentifierUtil } from '../../utils/lance-type-identifier.util';
import { NO_FORMATION_ID } from '../../utils/formation-type.model';
import { getOrgFromForce, getOrgFromGroup } from '../../utils/org/org-namer.util';
import { UnitDetailsDialogComponent, type UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';

@Component({
    selector: 'load-force-preview-panel',
    standalone: true,
    imports: [CommonModule, CleanModelStringPipe, UnitIconComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    @let unitDisplayName = effectiveUnitDisplayName();
    @let entry = force();
    <div class="force-preview-shell" [class.scroll-units-only]="scrollUnitsOnly()">
        <div class="force-preview-header">
            <div class="faction-name-wrapper">
                @if (entry.faction?.img; as factionImg) {
                    <img [src]="factionImg" class="faction-icon" />
                }
                <div class="force-name-block">
                    <span class="force-preview-name">{{ entry.name || forceOrgName() }}</span>
                    @if (entry.name && forceOrgName()) {
                        <span class="force-org-name">{{ forceOrgName() }}</span>
                    }
                </div>
            </div>
            <span class="force-preview-info">
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
        <div class="force-preview">
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

                            @if (showLockControls()) {
                                <button
                                    class="unit-lock-button bt-button"
                                    type="button"
                                    [class.locked]="isLocked(unitEntry)"
                                    (click)="onLockButtonClick($event, unitEntry)">
                                    {{ isLocked(unitEntry) ? 'UNLOCK' : 'LOCK' }}
                                </button>
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
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border-color, #333);
            padding: 8px 12px;
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

        .faction-icon {
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
            gap: 8px;
            align-items: first baseline;
            font-size: 0.85em;
            color: var(--text-color-secondary);
        }

        .game-type-badge {
            font-size: 0.8em;
            font-weight: bold;
            padding: 2px 6px;
            background: #a2792c;
            color: #fff;
            text-transform: uppercase;
            flex-shrink: 0;
            align-self: center;
        }

        .game-type-badge.as {
            background: #811313;
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
            grid-template-columns: repeat(auto-fit, minmax(86px, 92px));
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
            width: 100%;
            min-height: 24px;
            padding: 2px 4px;
            font-size: 0.62em;
            letter-spacing: 0.08em;
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
export class LoadForcePreviewPanelComponent {
    private readonly dialogsService = inject(DialogsService);
    readonly optionsService = inject(OptionsService);

    readonly force = input.required<LoadForceEntry>();
    readonly showHint = input(true);
    readonly scrollUnitsOnly = input(false);
    readonly showLockControls = input(false);
    readonly displayMode = input<Options['unitDisplayName'] | null>(null);
    readonly lockedUnitKeys = input<ReadonlySet<string>>(new Set<string>());
    readonly lockToggle = input<((unitEntry: LoadForceUnit) => void) | null>(null);
    readonly hoveredUnitChange = output<LoadForceUnit | null>();

    readonly effectiveUnitDisplayName = computed<Options['unitDisplayName']>(
        () => this.displayMode() ?? this.optionsService.options().unitDisplayName,
    );

    readonly allUnits = computed(() => this.force().groups
        .flatMap((group) => group.units)
        .map((entry) => entry.unit)
        .filter((unit): unit is Unit => unit !== undefined));

    readonly forceOrgName = computed(() => {
        const result = getOrgFromForce(this.force());
        return result.name !== 'Force' ? result.name : null;
    });

    readonly groupDisplayData = computed(() => this.force().groups.map((group) => {
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

    getPilotStats(loadForceUnit: LoadForceUnit): string {
        return getLoadForceUnitPilotStats(loadForceUnit, this.force().type);
    }

    onUnitClick(loadForceUnit: LoadForceUnit): void {
        if (!loadForceUnit.unit) {
            return;
        }

        const unitIndex = this.allUnits().findIndex((unit) => unit.name === loadForceUnit.unit?.name);
        this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: {
                unitList: this.allUnits(),
                unitIndex: unitIndex >= 0 ? unitIndex : 0,
                hideAddButton: true,
                gameSystem: this.force().type,
            } satisfies UnitDetailsDialogData,
        });
    }

    onUnitHover(loadForceUnit: LoadForceUnit | null): void {
        this.hoveredUnitChange.emit(loadForceUnit?.unit ? loadForceUnit : null);
    }

    isLocked(loadForceUnit: LoadForceUnit): boolean {
        return !!loadForceUnit.lockKey && this.lockedUnitKeys().has(loadForceUnit.lockKey);
    }

    onLockButtonClick(event: Event, loadForceUnit: LoadForceUnit): void {
        event.stopPropagation();
        this.lockToggle()?.(loadForceUnit);
    }
}