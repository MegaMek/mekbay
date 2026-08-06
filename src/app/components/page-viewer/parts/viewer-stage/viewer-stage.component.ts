// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ChangeDetectionStrategy, Component, ElementRef, input, viewChild } from '@angular/core';

@Component({
    selector: 'viewer-stage',
    standalone: true,
    templateUrl: './viewer-stage.component.html',
    styleUrl: './viewer-stage.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ViewerStageComponent {
    readonly swiping = input(false);
    readonly multipleVisible = input(false);
    readonly atMinZoom = input(false);
    private readonly containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');

    get nativeElement(): HTMLDivElement {
        return this.containerRef().nativeElement;
    }
}
