// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { CBT_RULESET_LABELS, type CBTRuleset } from '../../models/cbt-ruleset.model';
import type { LobbyGameSettings } from '../../models/lobby.model';
import { CBT_OPTIONAL_RULE_CHOICES, INITIATIVE_ORDER_CHOICES, type CBTOptionalRules } from '../../models/options.model';
import { isBoundOptionalRule } from '../../models/runtime/bound-optional-rules';
import type { InitiativeOrderMode } from '../../models/rules/initiative-rules';
import { DialogsService } from '../../services/dialogs.service';
import { LobbyService } from '../../services/lobby.service';
import { OptionsService } from '../../services/options.service';
import { ModeSwitchComponent } from '../mode-switch/mode-switch.component';

/** The lobby's game settings: the host edits them, every other player reads them. */
@Component({
    selector: 'lobby-settings-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ModeSwitchComponent],
    host: { class: 'fullscreen-dialog-host glass' },
    template: `
        <div class="wide-dialog lobby-settings-dialog">
            <h2 class="wide-dialog-title">Lobby Settings</h2>
            <div class="wide-dialog-body">
                @if (lobbyService.state(); as lobby) {
                    <div class="lobby-setting lobby-ruleset">
                        <span class="lobby-setting-label">Rules</span>
                        @if (lobby.isHost) {
                            <mode-switch
                                [leftLabel]="rulesetLabels['total-warfare']"
                                [rightLabel]="rulesetLabels['core-2026']"
                                ariaLabel="Lobby rules"
                                switchAriaLabel="Switch lobby rules"
                                [selectedRight]="lobby.settings.ruleset === 'core-2026'"
                                [disabled]="lobbyService.switchingRuleset()"
                                (selectedRightChange)="onRulesetChange($event)"
                            ></mode-switch>
                        } @else {
                            <strong class="lobby-setting-value">{{ rulesetLabels[lobby.settings.ruleset] }}</strong>
                        }
                    </div>
                    <div class="lobby-setting">
                        <span class="lobby-setting-label" id="lobby-initiative-order-label">Initiative order</span>
                        @if (lobby.isHost) {
                            <select class="bt-select" aria-labelledby="lobby-initiative-order-label" [disabled]="lobby.settings.ruleset === 'core-2026' || lobbyService.switchingRuleset()" (change)="onInitiativeOrderChange($event)">
                                @for (choice of initiativeOrderChoices; track choice.value) {
                                    <option [value]="choice.value" [selected]="lobby.settings.initiativeOrder === choice.value" [title]="choice.hint">{{ choice.label }}</option>
                                }
                            </select>
                        } @else {
                            <span class="lobby-setting-value" [class.inactive]="lobby.settings.ruleset === 'core-2026'">{{ initiativeOrderLabel() }}</span>
                        }
                    </div>
                    <div class="lobby-setting">
                        <span class="lobby-setting-label" id="lobby-initiative-die-label">Initiative Die</span>
                        @if (lobby.isHost) {
                            <select class="bt-select" aria-labelledby="lobby-initiative-die-label" [value]="lobby.settings.initiativeDie" [disabled]="lobbyService.switchingRuleset()" (change)="onInitiativeDieChange($event)">
                                <option value="false">Disabled</option>
                                <option value="true">Enabled</option>
                            </select>
                        } @else {
                            <span class="lobby-setting-value">{{ lobby.settings.initiativeDie ? 'Enabled' : 'Disabled' }}</span>
                        }
                    </div>
                    <fieldset class="lobby-optional-rules">
                        <legend class="lobby-setting-label">Optional rules</legend>
                        @for (rule of optionalRuleChoices; track rule.key) {
                            @if (!rule.ruleset || rule.ruleset === lobby.settings.ruleset) {
                                <label class="lobby-optional-rule">
                                    <input class="bt-checkbox" type="checkbox" [checked]="optionalRules()[rule.key]"
                                        [disabled]="!lobby.isHost || lobbyService.switchingRuleset()"
                                        (change)="onOptionalRuleChange(rule.key, $event)" />
                                    <span>{{ rule.label }}</span>
                                </label>
                            }
                        }
                    </fieldset>
                }
            </div>
            <div class="wide-dialog-actions">
                <button class="bt-button" type="button" (click)="close()">CLOSE</button>
            </div>
        </div>
    `,
    styles: [`
        .lobby-settings-dialog {
            width: min(30rem, 100dvw);
        }

        .wide-dialog-body {
            gap: 8px;
        }

        .lobby-setting {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 4px 12px;
            min-height: 32px;
        }

        .lobby-setting-label {
            color: var(--text-color-secondary);
            font-size: 0.75em;
            font-weight: bold;
            text-transform: uppercase;
            white-space: nowrap;
        }

        .lobby-setting-value {
            font-weight: bold;
            white-space: nowrap;

            &.inactive {
                opacity: 0.55;
            }
        }

        .lobby-ruleset .lobby-setting-value {
            color: var(--bt-yellow);
            font-size: 1.1em;
            text-transform: uppercase;
        }

        .lobby-setting .bt-select {
            min-width: 0;
            padding-top: 4px;
            padding-bottom: 4px;
        }

        .lobby-optional-rules {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 2px;
            min-width: 0;
            margin: 8px 0 0;
            padding: 8px 0 0;
            border: 0;
            border-top: 1px solid var(--border-color);
            text-align: left;

            legend {
                float: left;
                width: 100%;
                padding: 0;
                margin-bottom: 4px;
            }
        }

        .lobby-optional-rule {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            min-height: 28px;
            font-size: 0.9em;
            cursor: pointer;

            &:has(:disabled) {
                cursor: default;
            }
        }
    `],
})
export class LobbySettingsDialogComponent {
    readonly lobbyService = inject(LobbyService);
    private readonly dialogsService = inject(DialogsService);
    private readonly dialogRef = inject(DialogRef<void>);
    private readonly optionsService = inject(OptionsService);
    readonly rulesetLabels = CBT_RULESET_LABELS;
    readonly initiativeOrderChoices = INITIATIVE_ORDER_CHOICES;
    readonly initiativeOrderLabel = computed(() => INITIATIVE_ORDER_CHOICES
        .find(choice => choice.value === this.lobbyService.settings()?.initiativeOrder)?.label ?? '');

    readonly optionalRuleChoices = CBT_OPTIONAL_RULE_CHOICES;
    /** The optional rules the lobby plays: the host's, which every player adopts on joining. */
    readonly optionalRules = computed<CBTOptionalRules>(() => ({
        ...this.optionsService.options().CBTOptionalRules,
        ...this.lobbyService.settings()?.optionalRules,
    }));

    constructor() {
        effect(() => {
            if (!this.lobbyService.state()) this.dialogRef.close();
        });
    }

    async onRulesetChange(useCore2026: boolean): Promise<void> {
        const ruleset: CBTRuleset = useCore2026 ? 'core-2026' : 'total-warfare';
        const confirmed = await this.dialogsService.requestConfirmation(
            `Every player in the lobby, you included, switches to ${CBT_RULESET_LABELS[ruleset]} now. Undo starts over.`,
            'Change Lobby Rules?',
            'warning',
        );
        if (confirmed) this.updateSettings({ ruleset });
    }

    /** A rule bound into units restarts undo for everyone, so the host confirms it first. */
    async onOptionalRuleChange(key: keyof CBTOptionalRules, event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const value = input.checked;
        const confirmed = !isBoundOptionalRule(key) || await this.dialogsService.requestConfirmation(
            `Every player in the lobby, you included, ${value ? 'plays this rule' : 'stops playing this rule'} now. Undo starts over.`,
            'Change Lobby Optional Rule?',
            'warning',
        );
        if (confirmed) this.updateSettings({ optionalRules: { ...this.optionalRules(), [key]: value } });
        else input.checked = this.optionalRules()[key];
    }

    onInitiativeOrderChange(event: Event): void {
        this.updateSettings({ initiativeOrder: (event.target as HTMLSelectElement).value as InitiativeOrderMode });
    }

    onInitiativeDieChange(event: Event): void {
        this.updateSettings({ initiativeDie: (event.target as HTMLSelectElement).value === 'true' });
    }

    close(): void {
        this.dialogRef.close();
    }

    /** Settings wait while the host's forces switch rules, so a change cannot carry the rules being replaced. */
    private updateSettings(change: Partial<LobbyGameSettings>): void {
        const settings = this.lobbyService.settings();
        if (settings && !this.lobbyService.switchingRuleset()) void this.lobbyService.setSettings({ ...settings, ...change });
    }
}
