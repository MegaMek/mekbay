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

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import type { LoadForceEntry, LoadForceGroup } from '../../models/load-force-entry.model';
import { FactionImgPipe } from '../../pipes/faction-img.pipe';
import { CleanModelStringPipe } from '../../pipes/clean-model-string.pipe';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { OptionsService } from '../../services/options.service';
import { LanceTypeIdentifierUtil } from '../../utils/lance-type-identifier.util';
import { NO_FORMATION_ID } from '../../utils/formation-type.model';
import { DialogsService } from '../../services/dialogs.service';
import { UnitDetailsDialogComponent, type UnitDetailsDialogData } from '../unit-details-dialog/unit-details-dialog.component';
import type { Unit } from '../../models/units.model';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ToastService } from '../../services/toast.service';
import { type ForceAddModePickerData, ForceAddModePickerDialogComponent, type ForceAddModePickerResult } from '../force-add-mode-picker-dialog/force-add-mode-picker-dialog.component';
import { firstValueFrom } from 'rxjs';
import { getOrgFromForce, getOrgFromGroup } from '../../utils/org/org-namer.util';
import { getUnitsAverageTechBase } from '../../models/tech.model';

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
    imports: [CommonModule, CleanModelStringPipe, UnitIconComponent],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    templateUrl: './force-entry-preview-dialog.component.html',
    styleUrls: ['./force-entry-preview-dialog.component.scss']
})
export class ForceEntryPreviewDialogComponent {
    private dialogRef = inject(DialogRef<void>);
    private data: ForceEntryPreviewDialogData = inject(DIALOG_DATA);
    private dialogsService = inject(DialogsService);
    private forceBuilderService = inject(ForceBuilderService);
    private toastService = inject(ToastService);
    optionsService = inject(OptionsService);
    force: LoadForceEntry;
    forceOrgName: string | null = null;
    groupDisplayData: { group: LoadForceGroup; name: string; orgName: string | null; formationName: string | null }[];
    private allUnits: Unit[];

    isForceLoaded = signal(false);

    constructor() {
        this.force = this.data.force;
        this.allUnits = this.force.groups
            .flatMap(g => g.units)
            .map(u => u.unit)
            .filter((u): u is Unit => !!u);

        this.groupDisplayData = this.force.groups.map(group => {
            const sizeResult = getOrgFromGroup(group);
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

        const forceResult = getOrgFromForce(this.force);
        if (forceResult.name !== 'Force') {
            this.forceOrgName = forceResult.name;
        }

        this.isForceLoaded.set(
            this.forceBuilderService.loadedForces().some(s => s.force.instanceId() === this.force.instanceId)
        );
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

    async onLoad(): Promise<void> {
        const loaded = await this.forceBuilderService.loadForceEntry(this.force, 'load');
        if (loaded) this.close();
    }

    async onAdd(): Promise<void> {
        const currentForce = this.forceBuilderService.smartCurrentForce();
        const showInsert = !!currentForce && currentForce.owned();
        const ref = this.dialogsService.createDialog<ForceAddModePickerResult>(
            ForceAddModePickerDialogComponent,
            {
                data: {
                    showInsert,
                    currentForceName: currentForce?.name,
                } as ForceAddModePickerData
            }
        );
        const result = await firstValueFrom(ref.closed);
        if (!result) return;
        if (result === 'insert') {
            const inserted = await this.forceBuilderService.loadForceEntry(this.force, 'insert');
            if (inserted) {
                this.toastService.showToast(`"${this.force.name}" inserted into "${currentForce!.name}".`, 'success');
                this.close();
            }
        } else {
            const added = await this.forceBuilderService.loadForceEntry(this.force, 'add', result, { activate: false });
            if (added) {
                this.isForceLoaded.set(true);
                this.toastService.showToast(`"${this.force.name}" added to loaded forces.`, 'success');
                this.close();
            }
        }
    }

    close(): void {
        this.dialogRef.close();
    }
}
