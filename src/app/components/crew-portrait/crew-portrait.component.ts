// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { PortraitService } from '../../services/portrait.service';

/** Head-and-shoulders outline in a 256x320 box, the portrait aspect; stands in for a missing portrait. */
export const PERSON_SILHOUETTE_PATH = 'M128 8C82 8 54 39 54 83L57 121'
    + 'C49 116 45 124 47 137C48 149 52 157 59 158'
    + 'C63 180 75 196 87 206L86 224'
    + 'C69 236 43 242 24 253L2 267V318H254V267L232 253'
    + 'C213 242 187 236 170 224L169 206C181 196 193 180 197 158'
    + 'C204 157 208 149 209 137C211 124 207 116 199 121'
    + 'L202 83C202 39 174 8 128 8Z';

/** Clips a shared sheet to one portrait */
@Component({
    selector: 'crew-portrait',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { '[style.width.px]': 'width()', '[style.height.px]': 'width() * 1.25', 'aria-hidden': 'true' },
    template: `
        @if (sprite(); as sprite) {
            <img class="sheet" [src]="sprite.url" alt="" draggable="false"
                [style.width.px]="sprite.width" [style.height.px]="sprite.height"
                [style.left.px]="sprite.left" [style.top.px]="sprite.top"
                [style.visibility]="loadedUrl() === sprite.url ? 'visible' : 'hidden'"
                (load)="loadedUrl.set(sprite.url)" (error)="loadedUrl.set('')" />
        }
    `,
    styles: `
        :host { display: inline-block; position: relative; overflow: hidden; flex-shrink: 0; vertical-align: middle; }
        .sheet { position: absolute; max-width: none; max-height: none; pointer-events: none; }
    `,
})
export class CrewPortraitComponent {
    readonly name = input<string>();
    readonly width = input(64);
    readonly portraits = inject(PortraitService);
    readonly loadedUrl = signal('');
    readonly sprite = computed(() => {
        const name = this.name();
        const manifest = this.portraits.manifest();
        const portrait = name && manifest && Object.hasOwn(manifest.portraits, name) ? manifest.portraits[name] : undefined;
        const sheet = portrait && manifest?.sheets[portrait.sheet];
        if (!portrait || !sheet || !manifest) return undefined;
        const url = this.portraits.sheetUrl(sheet);
        if (!url) return undefined;
        const scale = this.width() / manifest.width;
        return { url, width: sheet.width * scale, height: sheet.height * scale,
            left: -portrait.x * scale, top: -portrait.y * scale };
    });

    constructor() {
        effect(() => {
            const name = this.name();
            if (name) void this.portraits.loadPortrait(name).catch(() => this.loadedUrl.set(''));
        });
    }
}
