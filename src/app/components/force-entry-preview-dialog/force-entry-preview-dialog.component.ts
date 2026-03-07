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

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { LoadForceEntry, LoadForceGroup } from '../../models/load-force-entry.model';
import { FactionImgPipe } from '../../pipes/faction-img.pipe';
import { CleanModelStringPipe } from '../../pipes/clean-model-string.pipe';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { OptionsService } from '../../services/options.service';
import { LanceTypeIdentifierUtil } from '../../utils/lance-type-identifier.util';
import { NO_FORMATION_ID } from '../../utils/formation-type.model';
import { DialogsService } from '../../services/dialogs.service';
import { UnitDetailsDialogComponent, UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import { Unit } from '../../models/units.model';
import { DataService } from '../../services/data.service';
import { FormationNamerUtil } from '../../utils/formation-namer.util';

export interface ForceEntryPreviewDialogData {
    force: LoadForceEntry;
}

/**
 * Author: Drake
 * 
 * Dialog component that shows a detailed preview of a force entry, including its name, faction icon,
 * and other relevant details.
 */
@Component({
    selector: 'force-entry-preview-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, FactionImgPipe, CleanModelStringPipe, UnitIconComponent],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
    @let unitDisplayName = optionsService.options().unitDisplayName;
    <div class="wide-dialog">
        <h2 class="wide-dialog-title">FORCE DETAILS</h2>
        <div class="wide-dialog-body">
            <div class="force-preview">
                <div class="force-preview-header">
                    <div class="faction-name-wrapper">
                        @if (force.factionId | factionImg; as factionImgUrl) {
                            <img [src]="factionImgUrl" class="faction-icon" />
                        }
                        <div class="force-name-block">
                            <span class="force-preview-name">{{ force.name }}</span>
                            @if (forceOrgName) {
                                <span class="force-org-name">{{ forceOrgName }}</span>
                            }
                        </div>
                    </div>
                    <span class="force-preview-info">
                        <span class="game-type-badge" [class.as]="force.type === 'as'">
                            {{ force.type === 'as' ? 'AS' : 'CBT' }}
                        </span>
                        @if (force.type === 'as') {
                            @if (force.pv && force.pv > 0) {
                                <span class="force-bv">PV: {{ force.pv | number }}</span>
                            }
                        } @else {
                            @if (force.bv && force.bv > 0) {
                                <span class="force-bv">BV: {{ force.bv | number }}</span>
                            }
                        }
                    </span>
                </div>
                <div class="unit-scroll">
                    @for (gd of groupDisplayData; track gd.group) {
                    <div class="unit-group">
                        <div class="group-name">{{ gd.name }}
                            @if (gd.formationName; as fName) {
                                @if (gd.name) { <span class="group-sep">·</span> }
                                <span class="group-formation">{{ fName }}</span>
                            }
                            @if (gd.orgName; as orgName) {
                                @if (gd.name || gd.formationName) { <span class="group-sep">·</span> }
                                <span class="group-org">{{ orgName }}</span>
                            }
                        </div>
                        <div class="units">
                            @for (unitEntry of gd.group.units; let i = $index; track i) {
                            <div class="unit-square compact-mode"
                                [class.destroyed]="unitEntry.destroyed"
                                [class.missing]="!unitEntry.unit"
                                [class.clickable]="!!unitEntry.unit"
                                (click)="onUnitClick(unitEntry.unit)">
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
                            </div>
                            }
                        </div>
                    </div>
                    }
                </div>
            </div>
        </div>
        <div class="wide-dialog-actions">
            <button class="bt-button" (click)="close()">DISMISS</button>
        </div>
    </div>
    `,
    styles: [`
        .force-preview {
            width: 100%;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border-color, #333);
            padding: 8px 12px;
            box-sizing: border-box;
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
            flex-direction: row;
            gap: 4px;
            overflow-x: auto;
        }

        .unit-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
            border-right: 2px solid var(--border-color, #333);
            padding-right: 4px;
            justify-content: flex-end;
        }

        .unit-group:last-child {
            border-right: none;
            padding-right: 0;
        }

        .unit-group .group-name {
            font-size: 0.8em;
            color: var(--text-color-secondary);
            text-align: left;
        }

        .group-sep {
            color: var(--text-color-secondary);
            margin: 0 2px;
        }

        .group-org {
            font-weight: 400;
            color: var(--text-color-secondary);
        }

        .group-formation {
            font-weight: 400;
            color: var(--text-color-secondary);
        }

        .unit-group .units {
            display: flex;
            flex-direction: row;
            gap: 2px;
        }

        .unit-square.compact-mode {
            width: 86px;
            height: 80px;
            max-height: 105px;
            min-width: 86px;
            background: #0003;
            padding: 2px;
            display: flex;
            flex-direction: column;
            align-items: center;
            overflow: hidden;
            box-sizing: border-box;
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

        .unit-square.compact-mode.missing {
            background-color: #F003;
        }

        .unit-square.compact-mode.clickable {
            cursor: pointer;
        }

        .unit-square.compact-mode.clickable:hover {
            background: #fff1;
        }

        .unit-square.compact-mode.destroyed unit-icon {
            filter: grayscale(1) brightness(0.7) sepia(1) hue-rotate(-30deg) saturate(6) contrast(1.2);
        }

        .unit-square.compact-mode .unit-model {
            color: var(--text-color-secondary);
            font-size: 0.6em;
            text-align: center;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            max-width: 100%;
            display: block;
        }

        .unit-square.compact-mode .unit-alias,
        .unit-square.compact-mode .unit-chassis {
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

        .unit-square.compact-mode .unit-alias {
            font-weight: bold;
        }

        .unit-square.compact-mode .unit-alias.thin {
            font-size: 0.6em;
            font-weight: normal;
        }
    `]
})
export class ForceEntryPreviewDialogComponent {
    private dialogRef = inject(DialogRef<void>);
    private data: ForceEntryPreviewDialogData = inject(DIALOG_DATA);
    private dialogsService = inject(DialogsService);
    private dataService = inject(DataService);
    optionsService = inject(OptionsService);
    force: LoadForceEntry;
    forceOrgName: string | null = null;
    groupDisplayData: { group: LoadForceGroup; name: string; orgName: string | null; formationName: string | null }[];
    private allUnits: Unit[];

    constructor() {
        this.force = this.data.force;
        this.allUnits = this.force.groups
            .flatMap(g => g.units)
            .map(u => u.unit)
            .filter((u): u is Unit => !!u);

        const factionName = this.force.factionId !== undefined
            ? (this.dataService.getFactionById(this.force.factionId)?.name ?? 'Mercenary')
            : 'Mercenary';
        const isComStarOrWoB = factionName.includes('ComStar') || factionName.includes('Word of Blake');
        const techBase = isComStarOrWoB ? '' : FormationNamerUtil.deriveTechBase(this.allUnits);

        this.groupDisplayData = this.force.groups.map(group => {
            const sizeResult = FormationNamerUtil.getFormationSizeResult(group, factionName, techBase);
            const orgName = (sizeResult.name && sizeResult.name !== 'Force') ? sizeResult.name : null;

            let name: string;
            if (!group.name) {
                name = LanceTypeIdentifierUtil.getFormationName(group.formationId) || '';
            } else {
                name = group.name;
            }

            let formationName: string | null = null;
            if (group.formationId && group.formationId !== NO_FORMATION_ID && group.name) {
                const fName = LanceTypeIdentifierUtil.getFormationName(group.formationId);
                if (fName && !group.name.includes(fName)) {
                    formationName = fName;
                }
            }

            return { group, name, orgName, formationName };
        });

        const forceResult = FormationNamerUtil.getForceSizeName(this.force, factionName);
        if (forceResult && forceResult !== 'Force') {
            this.forceOrgName = forceResult;
        }
    }

    onUnitClick(unit: Unit | undefined): void {
        if (!unit) return;
        const unitIndex = this.allUnits.findIndex(u => u.name === unit.name);
        this.dialogsService.createDialog(UnitDetailsDialogComponent, {
            data: {
                unitList: this.allUnits,
                unitIndex: unitIndex >= 0 ? unitIndex : 0,
                hideAddButton: true,
                gameSystem: this.force.type
            } as UnitDetailsDialogData
        });
    }

    close(): void {
        this.dialogRef.close();
    }
}
