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
import { CommonModule } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { LoadOrganizationEntry } from '../../models/organization.model';

/*
 * Author: Drake
 *
 * Dialog that displays a list of organizations containing a particular force,
 * allowing the user to select which organization to open.
 */

export interface OrgSelectDialogData {
    organizations: LoadOrganizationEntry[];
    factionImages: Map<string, string | undefined>;
}

@Component({
    selector: 'org-select-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    host: {
        class: 'fullscreen-dialog-host glass'
    },
    template: `
        <div class="wide-dialog">
            <h2 class="wide-dialog-title">Select TO&amp;E</h2>
            <div class="wide-dialog-body">
                <div class="org-list">
                    @for (org of data.organizations; track org.organizationId) {
                        <button class="org-entry" (click)="select(org)">
                            <div class="org-info">
                                @if (data.factionImages.get(org.organizationId); as factionImgUrl) {
                                    <img [src]="factionImgUrl" class="faction-icon" />
                                }
                                <span class="org-name">{{ org.name || 'Unnamed Organization' }}</span>
                            </div>
                            <span class="org-meta">{{ org.forceCount }} force{{ org.forceCount !== 1 ? 's' : '' }}</span>
                        </button>
                    }
                </div>
            </div>
            <div class="wide-dialog-actions">
                <button class="bt-button modal-btn" (click)="dismiss()">DISMISS</button>
            </div>
        </div>
    `,
    styles: [`
        .org-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
            width: 100%;
        }

        .org-entry {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 10px 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid transparent;
            cursor: pointer;
            transition: background 0.15s, border-color 0.15s;
            text-align: left;
            color: inherit;
            font: inherit;

            &:hover {
                background: rgba(255, 255, 255, 0.1);
                border-color: rgba(255, 255, 255, 0.15);
            }
        }

        .org-info {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1 1 0;
            min-width: 0;
        }

        .faction-icon {
            width: 24px;
            height: 24px;
            object-fit: contain;
            flex-shrink: 0;
        }

        .org-name {
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: var(--text-color, #fff);
        }

        .org-meta {
            font-size: 0.9em;
            color: var(--text-color-secondary, #aaa);
            white-space: nowrap;
        }
    `]
})
export class OrgSelectDialogComponent {
    private dialogRef = inject(DialogRef<LoadOrganizationEntry | null>);
    data = inject<OrgSelectDialogData>(DIALOG_DATA);

    select(org: LoadOrganizationEntry): void {
        this.dialogRef.close(org);
    }

    dismiss(): void {
        this.dialogRef.close(null);
    }
}
