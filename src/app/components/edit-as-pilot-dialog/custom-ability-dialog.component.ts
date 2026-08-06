// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { afterNextRender, ChangeDetectionStrategy, Component, type ElementRef, input, output, viewChild } from '@angular/core';
import type { ASCustomPilotAbility } from '../../models/pilot-abilities.model';

@Component({
    selector: 'custom-ability-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="custom-ability-dialog framed-borders has-shadow glass">
            <h3>{{ initialAbility() ? 'Edit Custom Ability' : 'Add Custom Ability' }}</h3>
            
            <div class="row">
                <div class="form-group name-group">
                    <input 
                        #nameInput
                        id="abilityName"
                        type="text" 
                        placeholder="Name"
                        maxlength="50"
                        (keydown.enter)="onSubmit()">
                </div>
                
                <div class="form-group cost-group">
                    <input 
                        #costInput
                        id="abilityCost"
                        type="number" 
                        placeholder="0"
                        min="0"
                        value="0"
                        (keydown.enter)="onSubmit()">
                </div>
            </div>
            
            <div class="form-group">
                <textarea 
                    #summaryInput
                    id="abilitySummary"
                    class="summary-input"
                    placeholder="Description"
                    maxlength="512"
                    rows="3"></textarea>
            </div>
            
            <div class="dialog-actions">
                <button class="bt-button" (click)="onSubmit()">{{ initialAbility() ? 'SAVE' : 'ADD' }}</button>
                <button class="bt-button" (click)="onCancel()">CANCEL</button>
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: flex;
            justify-content: center;
            align-items: center;
        }

        .custom-ability-dialog {
            padding: 20px;
            min-width: 300px;
            max-width: 400px;
        }

        h3 {
            margin: 0 0 16px 0;
            text-align: center;
            color: var(--text-color);
        }
        .row {
            display: flex;
            flex-direction: row;
            gap: 16px;
        }

        .form-group {
            margin-bottom: 16px;
        }

        .name-group {
            flex: 1;
        }

        .cost-group {
            max-width: 60px;
        }

        #abilityCost {
            text-align: center;
        }

        label {
            display: block;
            margin-bottom: 4px;
            color: var(--text-color-secondary);
            font-size: 0.9em;
        }

        .form-group textarea,
        .form-group input {
            width: 100%;
            font-size: 1.2em;
            box-sizing: border-box;
            background: var(--background-input);
            color: white;
            border: 0;
            border-bottom: 1px solid #666;
            outline: none;
            transition: all 0.2s ease-in-out;
            white-space: normal;
            overflow-wrap: break-word;
            word-break: break-word;
            padding: 8px;
            flex: 1;
        }

        .form-group textarea:hover, .form-group input:hover,
        .form-group textarea:focus, .form-group input:focus {
            border-bottom: 1px solid #fff;
            outline: none;
        }

        .summary-input {
            resize: vertical;
            min-height: 60px;
            font-family: inherit;
        }

        .dialog-actions {
            display: flex;
            gap: 8px;
            justify-content: center;
            margin-top: 20px;
        }

        .dialog-actions button {
            min-width: 80px;
        }
    `]
})
export class CustomAbilityDialogComponent {
    nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');
    costInput = viewChild.required<ElementRef<HTMLInputElement>>('costInput');
    summaryInput = viewChild.required<ElementRef<HTMLTextAreaElement>>('summaryInput');

    /** If provided, the dialog is in edit mode with these initial values */
    initialAbility = input<ASCustomPilotAbility | null>(null);

    submitted = output<ASCustomPilotAbility>();
    cancelled = output<void>();

    constructor() {
        // Populate fields with initial values after view is ready
        afterNextRender(() => {
            const initial = this.initialAbility();
            if (initial) {
                this.nameInput().nativeElement.value = initial.name;
                this.costInput().nativeElement.value = String(initial.cost);
                this.summaryInput().nativeElement.value = initial.summary;
            }
        });
    }

    onSubmit(): void {
        const name = this.nameInput().nativeElement.value.trim();
        const cost = Number(this.costInput().nativeElement.value) || 0;
        const summary = this.summaryInput().nativeElement.value.trim();

        if (!name) {
            this.nameInput().nativeElement.focus();
            return;
        }

        this.submitted.emit({ name, cost, summary });
    }

    onCancel(): void {
        this.cancelled.emit();
    }
}
