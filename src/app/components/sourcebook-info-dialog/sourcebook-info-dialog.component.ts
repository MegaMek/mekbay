// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { type AfterViewInit, ChangeDetectionStrategy, Component, type ElementRef, inject, viewChild } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { Sourcebook } from '../../models/sourcebook.model';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';


export interface SourcebookInfoDialogSource extends Sourcebook {
    sourceAnnotations?: string[];
}

export interface SourcebookInfoDialogUnknownSource {
    abbrev: string;
    sourceAnnotations?: string[];
}

export interface SourcebookInfoDialogData {
    sourcebooks: SourcebookInfoDialogSource[];
    unknownSources: SourcebookInfoDialogUnknownSource[];
    selectedIndex?: number;
}

@Component({
    selector: 'sourcebook-info-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BaseDialogComponent],
    host: {
        class: 'fullscreen-dialog-host'
    },
    template: `
    <base-dialog [autoHeight]="true">
        <div dialog-header><div class="title">SOURCES</div></div>
        <div dialog-body class="sourcebook-content" #scrollContainer>
            @for (sourcebook of data.sourcebooks; let i = $index; let last = $last; track sourcebook.id) {
                <div class="sourcebook-entry" [attr.data-index]="i">
                    @if (sourcebook.image) {
                        <div class="sourcebook-image">
                            <img [src]="sourcebook.image" [alt]="sourcebook.title" (error)="onImageError($event)" />
                        </div>
                    }
                    <div class="sourcebook-title">
                        <span>{{ sourcebook.title }}</span>
                        @if (sourcebook.sourceAnnotations?.length) {
                            <span class="source-note">({{ sourcebook.sourceAnnotations.join(', ') }})</span>
                        }
                    </div>
                    @if (sourcebook.sku) {
                        <div class="sourcebook-sku">
                            <span class="label">SKU:</span>
                            <span class="value allow-select">{{ sourcebook.sku }}</span>
                        </div>
                    }
                    <div class="sourcebook-buttons">
                        @if (sourcebook.url) {
                            <a class="modal-btn bt-button primary" [href]="sourcebook.url" target="_blank" rel="noopener">GET</a>
                        }
                        @if (sourcebook.mul_url) {
                            <a class="modal-btn bt-button" [href]="sourcebook.mul_url" target="_blank" rel="noopener">INFO</a>
                        }
                    </div>
                </div>
                @if (!last) {
                    <hr class="sourcebook-separator" />
                }
            }
            @for (unknown of data.unknownSources; let last = $last; track unknown.abbrev) {
                @if (data.sourcebooks.length > 0 || !$first) {
                    <hr class="sourcebook-separator" />
                }
                <div class="sourcebook-entry unknown">
                    <div class="sourcebook-title">
                        <span>{{ unknown.abbrev }}</span>
                        @if (unknown.sourceAnnotations?.length) {
                            <span class="source-note">({{ unknown.sourceAnnotations.join(', ') }})</span>
                        }
                    </div>
                </div>
            }
        </div>
        <div dialog-footer class="footer">
            <button class="modal-btn bt-button" (click)="close()">DISMISS</button>
        </div>
    </base-dialog>
    `,
    styles: [`
        .sourcebook-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            padding: 8px;
            max-height: 60vh;
            overflow-y: auto;
        }

        .sourcebook-entry {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            width: 100%;
        }

        .sourcebook-entry.unknown {
            opacity: 0.7;
        }

        .sourcebook-image {
            display: flex;
            justify-content: center;
            width: 100%;
            max-height: 400px;
        }

        .sourcebook-image img {
            width: 100%;
            height: auto;
            object-fit: contain;
            border-radius: 4px;
        }

        .sourcebook-title {
            display: inline-flex;
            align-items: baseline;
            justify-content: center;
            flex-wrap: wrap;
            gap: 4px;
            font-weight: 600;
            font-size: 1.1em;
            text-align: center;
        }

        .source-note {
            color: var(--text-color-secondary);
            font-weight: normal;
            font-size: 0.9em;
        }

        .sourcebook-sku {
            display: flex;
            gap: 8px;
            justify-content: center;
        }

        .sourcebook-sku .label {
            color: var(--text-color-secondary);
        }

        .sourcebook-sku .value {
            font-weight: 500;
        }

        .sourcebook-buttons {
            display: flex;
            gap: 8px;
            justify-content: center;
        }

        .sourcebook-buttons a {
            text-decoration: none;
        }

        .sourcebook-separator {
            width: 80%;
            border: none;
            border-top: 1px solid var(--border-color);
            margin: 8px 0;
        }

        .footer {
            width: 100%;
            display: flex;
            justify-content: center;
            flex-direction: row;
            gap: 8px;
        }
    `]
})
export class SourcebookInfoDialogComponent implements AfterViewInit {
    private dialogRef = inject(DialogRef);
    readonly data: SourcebookInfoDialogData = inject(DIALOG_DATA);
    
    private scrollContainer = viewChild<ElementRef<HTMLElement>>('scrollContainer');

    ngAfterViewInit(): void {
        const idx = this.data.selectedIndex;
        if (idx == null || idx < 0) return;
        
        // Small delay to ensure DOM is fully rendered
        requestAnimationFrame(() => {
            const container = this.scrollContainer()?.nativeElement;
            if (!container) return;
            
            const entry = container.querySelector(`[data-index="${idx}"]`) as HTMLElement;
            if (entry) {
                entry.scrollIntoView({ behavior: 'instant', block: 'start' });
            }
        });
    }

    onImageError(event: Event): void {
        const img = event.target as HTMLImageElement;
        img.style.display = 'none';
    }

    close() {
        this.dialogRef.close();
    }
}
