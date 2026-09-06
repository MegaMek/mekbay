// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { CdkTrapFocus } from '@angular/cdk/a11y';
import { OverlayModule, type ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

@Component({
    selector: 'radar-help',
    standalone: true,
    imports: [OverlayModule, CdkTrapFocus],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <button class="help-button" type="button" aria-label="How to read the radar"
            aria-haspopup="dialog" [attr.aria-expanded]="open()"
            cdkOverlayOrigin #origin="cdkOverlayOrigin"
            (click)="$event.stopPropagation(); open.set(!open())"><span aria-hidden="true">?</span></button>
        <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="origin"
            [cdkConnectedOverlayOpen]="open()" [cdkConnectedOverlayPositions]="positions"
            [cdkConnectedOverlayPush]="true" [cdkConnectedOverlayViewportMargin]="12"
            [cdkConnectedOverlayHasBackdrop]="true"
            cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
            (backdropClick)="open.set(false)" (detach)="open.set(false)"
            (overlayKeydown)="onKeydown($event)">
            <section class="radar-help framed-borders has-shadow" role="dialog"
                aria-label="How to read the radar" aria-modal="true"
                cdkTrapFocus [cdkTrapFocusAutoCapture]="true" (keydown)="onKeydown($event)">
                <header tabindex="0" cdkFocusInitial>
                    <strong>Reading the radar</strong>
                </header>
                <div class="legend-row">
                    <svg viewBox="0 0 40 30" aria-hidden="true"><polygon class="force-sample" points="20,3 37,15 20,27 3,15" /></svg>
                    <div><strong>Your force</strong><small>Compared with its composition's reference.</small></div>
                </div>
                <div class="legend-row">
                    <svg viewBox="0 0 40 30" aria-hidden="true"><polygon class="unit-sample" points="20,3 37,15 20,27 3,15" /></svg>
                    <div><strong>Hovered unit</strong><small>Compared with one matching unit, not the force.</small></div>
                </div>
                <div class="legend-row">
                    <svg viewBox="0 0 40 30" aria-hidden="true"><polygon class="average-sample" points="20,3 37,18 20,24 6,15" /></svg>
                    <div><strong>Catalog average</strong><small>Sum of bucket averages for your force composition.</small></div>
                </div>
                <small class="scale-note">Center: 0 · rings: 25 / 50 / 75 / 100%</small>
                <div class="value-example" aria-label="Example: 300 actual value out of a 500 reference">
                    <span><b>300</b><small>Actual value</small></span>
                    <span aria-hidden="true">/</span>
                    <span><b>500</b><small>95th percentile reference</small></span>
                </div>
            </section>
        </ng-template>
    `,
    styles: [`
        :host { position: absolute; top: 0; right: 0; z-index: 1; }
        button { color: var(--text-color, #fff); cursor: pointer; font: inherit; }
        .help-button { display: grid; place-items: center; width: 36px; height: 36px; border: 0; background: transparent; }
        .help-button span { display: grid; place-items: center; width: 21px; height: 21px; border: 1px solid currentColor; border-radius: 50%; font-size: 14px; }
        button:hover { color: var(--bt-yellow, #eaae3f); }
        button:focus-visible { outline: 2px solid var(--bt-yellow, #eaae3f); outline-offset: -2px; }
        .radar-help { box-sizing: border-box; width: min(340px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: auto; overscroll-behavior: contain; padding: 12px 14px; background-color: var(--background-color-menu); color: var(--text-color, #fff); font-size: 13px; line-height: 1.4; }
        header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; font-size: 15px; }
        .legend-row { display: flex; align-items: center; gap: 10px; margin: 12px 0; }
        .legend-row svg { flex: 0 0 40px; width: 40px; height: 30px; }
        .force-sample { stroke: var(--bt-yellow, #eaae3f); fill: rgba(234, 174, 63, 0.22); stroke-width: 2; }
        .unit-sample { stroke: #62c4ff; fill: rgba(98, 196, 255, 0.16); stroke-width: 2; stroke-dasharray: 6 4; }
        .average-sample { fill: none; stroke: #aaa; stroke-width: 2; stroke-dasharray: 1 5; stroke-linecap: round; }
        small { display: block; color: var(--text-color-secondary, #aaa); font-size: 12px; }
        .scale-note { margin: 12px 0; text-align: center; }
        .value-example { display: flex; justify-content: center; align-items: baseline; gap: 16px; padding: 10px 0; border-top: 1px solid var(--border-color); text-align: center; }
        .value-example b { font-size: 20px; font-variant-numeric: tabular-nums; }
        p { margin: 12px 0; }
    `],
})
export class RadarHelpComponent {
    readonly open = signal(false);
    readonly positions: ConnectedPosition[] = [
        { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
        { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
    ];

    onKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        this.open.set(false);
    }
}
