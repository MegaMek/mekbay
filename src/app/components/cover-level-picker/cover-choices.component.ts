// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { UnitCover } from '../../models/unit-cover.model';
import { CoverLevelPickerComponent, type CoverLevel } from './cover-level-picker.component';

/** Shared cover controls for the record sheet and tactical view. */
@Component({
    selector: 'cover-choices',
    imports: [CoverLevelPickerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `            <div class="cover-choices" role="group" aria-label="Unit cover">
                <button
                    type="button"
                    class="bt-button cover-button"
                    aria-label="Light cover"
                    [class.selected]="cover() === 'light'"
                    [attr.aria-pressed]="cover() === 'light'"
                    (click)="coverChange.emit('light')"
                >
                    <svg viewBox="0 0 512 512" aria-hidden="true"><path d="M326.039,229.594c20.662,10.332,58.534-9.176,58.534-9.176C301.915,128.572,256.001,0,256.001,0s-45.916,128.572-128.573,220.418c0,0,37.872,19.509,58.538,9.176c0,0-20.666,79.215-113.64,183.691c82.642,22.948,144.634-14.936,144.634-14.936V512h78.083V398.348c0,0,61.992,37.884,144.634,14.936C346.701,308.809,326.039,229.594,326.039,229.594z"/></svg>
                </button>
                <button
                    type="button"
                    class="bt-button cover-button heavy-cover-button"
                    aria-label="Heavy cover"
                    [class.selected]="cover() === 'heavy'"
                    [attr.aria-pressed]="cover() === 'heavy'"
                    (click)="coverChange.emit('heavy')"
                >
                    <svg viewBox="0 0 724 512" aria-hidden="true"><path d="M326.039,229.594c20.662,10.332,58.534-9.176,58.534-9.176C301.915,128.572,256.001,0,256.001,0s-45.916,128.572-128.573,220.418c0,0,37.872,19.509,58.538,9.176c0,0-20.666,79.215-113.64,183.691c82.642,22.948,144.634-14.936,144.634-14.936V512h78.083V398.348c0,0,61.992,37.884,144.634,14.936C346.701,308.809,326.039,229.594,326.039,229.594z"/><path transform="translate(212 0)" d="M326.039,229.594c20.662,10.332,58.534-9.176,58.534-9.176C301.915,128.572,256.001,0,256.001,0s-45.916,128.572-128.573,220.418c0,0,37.872,19.509,58.538,9.176c0,0-20.666,79.215-113.64,183.691c82.642,22.948,144.634-14.936,144.634-14.936V512h78.083V398.348c0,0,61.992,37.884,144.634,14.936C346.701,308.809,326.039,229.594,326.039,229.594z"/></svg>
                </button>
                <cover-level-picker
                    kind="water"
                    [value]="waterDepth()"
                    (valueChange)="waterDepthChange.emit($event)"
                />
                <cover-level-picker
                    kind="building"
                    [value]="buildingLevel()"
                    (valueChange)="buildingLevelChange.emit($event)"
                />
            </div>`,
    styles: [`:host { display: block; min-width: 0; }
.cover-choices {
    flex: 1 1 auto;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 4px;
    min-width: 0;
}

.cover-button {
    width: 100%;
    min-width: 0;
    min-height: 40px;
    padding: 3px;
}

.cover-button svg {
    width: 17px;
    height: 17px;
    fill: currentColor;
}

.heavy-cover-button svg {
    width: 23px;
}
`],
})
export class CoverChoicesComponent {
    readonly cover = input<UnitCover | null>(null);
    readonly waterDepth = input('');
    readonly buildingLevel = input('');
    readonly coverChange = output<'light' | 'heavy'>();
    readonly waterDepthChange = output<CoverLevel>();
    readonly buildingLevelChange = output<CoverLevel>();
}
