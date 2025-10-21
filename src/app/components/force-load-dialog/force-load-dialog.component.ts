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
import { DialogsService } from '../../services/dialogs.service';
import { Pipe, PipeTransform } from "@angular/core";
import { LoadForceEntry } from '../../models/load-force-entry.model';
import { OptionsService } from '../../services/options.service';

/*
 * Author: Drake
 */

        
@Pipe({
    name: 'cleanModelString',
    pure: true // Pure pipes are only called when the input changes
})
export class CleanModelStringPipe implements PipeTransform {
    transform(model: string | undefined): string {
        if (!model) return '';
        return model.replace(/\s*\(.*?\)\s*/g, '').trim();
    }
}

@Pipe({
    name: 'formatTimestamp',
    pure: true // Pure pipes are only called when the input changes
})
export class FormatTimestamp implements PipeTransform {
    transform(timestamp: string | undefined): string {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
}

@Component({
    selector: 'force-load-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent, CleanModelStringPipe, FormatTimestamp],
    templateUrl: './force-load-dialog.component.html',
    styleUrls: ['./force-load-dialog.component.css']
})
export class ForceLoadDialogComponent {
    dialogRef = inject(DialogRef<ForceLoadDialogComponent>);
    dataService = inject(DataService);
    optionsService = inject(OptionsService);
    cdr = inject(ChangeDetectorRef);
    dialogsService = inject(DialogsService);
    @Output() load = new EventEmitter<LoadForceEntry>();

    forces = signal<LoadForceEntry[]>([]);
    selectedForce = signal<LoadForceEntry | null>(null);
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

    selectForce(force: LoadForceEntry) {
        this.selectedForce.set(force);
    }

    onLoad() {
        const force = this.selectedForce();
        if (!force) return;
        this.load.emit(force);
    }

    async onDelete() {
        const force = this.selectedForce();
        if (!force) return;
        if (!force.instanceId) return;

        const confirmed = await this.dialogsService.showQuestion(
            `Are you sure you want to delete "${force.name}"? This action cannot be undone.`,
            'Delete Force',
            'danger'
        );
        if (confirmed === 'yes') {
            if (force.instanceId) {
                await this.dataService.deleteForce(force.instanceId);
            }
            this.forces.set(this.forces().filter(f => f !== force));
            this.selectedForce.set(null);
        }
    }

    onClose() {
        this.dialogRef.close();
    }
}