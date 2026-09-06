// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { PortraitService } from '../../services/portrait.service';

/** Clips a shared sheet to one portrait; missing images retain the helmet placeholder. */
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
        @if (!sprite() || loadedUrl() !== sprite()?.url) {
            <img class="placeholder" src="/images/helmet.svg" alt="" draggable="false" />
        }
    `,
    styles: `
        :host { display: inline-block; position: relative; overflow: hidden; flex-shrink: 0; vertical-align: middle; }
        .sheet { position: absolute; max-width: none; max-height: none; pointer-events: none; }
        .placeholder { position: absolute; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
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
