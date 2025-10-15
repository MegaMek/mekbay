/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
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

import { Component, EventEmitter, inject, OnInit, Output, signal, effect, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';
import { DataService } from '../../services/data.service';
import { Force, ForceUnit } from '../../models/force-unit.model';
import { DialogsService } from '../../services/dialogs.service';

/*
 * Author: Drake
 */
@Component({
    selector: 'force-load-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent],
    templateUrl: './force-load-dialog.component.html',
    styleUrls: ['./force-load-dialog.component.css']
})
export class ForceLoadDialogComponent {
    dialogRef = inject(DialogRef<ForceLoadDialogComponent>);
    dataService = inject(DataService);
    cdr = inject(ChangeDetectorRef);
    dialogsService = inject(DialogsService);
    @Output() load = new EventEmitter<Force>();

    forces = signal<Force[]>([]);
    selectedForce = signal<Force | null>(null);
    loading = signal<boolean>(true);

    constructor() {
        effect(async () => {
            this.loading.set(true);
            const result = await this.dataService.listForces();
            this.forces.set(result);
            this.loading.set(false);
            this.cdr.detectChanges();
        });
    }

    getUnitImg(unit: ForceUnit): string | undefined {
        return `https://db.mekbay.com/images/units/${unit.getUnit().icon}`;
    }

    formatTimestamp(force: Force): string {
        const ts = force.timestamp ?? '';
        if (!ts) return '';
        const date = new Date(ts);
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    getCleanedModel(unit: ForceUnit): string {
        let name = unit.getUnit().model;
        // Remove text in () or [] and trim
        return name.replace(/(\(.*?\)|\[.*?\])/g, '').trim();
    }

    selectForce(force: Force) {
        this.selectedForce.set(force);
    }

    getTotalBV(force: Force): number {
        return force.units().reduce((sum, unit) => sum + (unit.getBv() ?? 0), 0);
    }

    onLoad() {
        const force = this.selectedForce();
        if (!force) return;
        this.load.emit(force);
    }

    async onDelete() {
        const force = this.selectedForce();
        if (!force) return;
        const forceInstanceId = force.instanceId();
        if (!forceInstanceId) return;

        const confirmed = await this.dialogsService.showQuestion(
            `Are you sure you want to delete "${force.name}"? This action cannot be undone.`,
            'Delete Force',
            'danger'
        );
        if (confirmed === 'yes') {
            if (forceInstanceId) {
                await this.dataService.deleteForce(forceInstanceId);
            }
            this.forces.set(this.forces().filter(f => f !== force));
            this.selectedForce.set(null);
        }
    }

    onClose() {
        this.dialogRef.close();
    }
}