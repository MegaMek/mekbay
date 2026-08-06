// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { LoadOrganizationEntry } from '../../models/organization.model';

/*
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
