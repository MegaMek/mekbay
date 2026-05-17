import { ChangeDetectionStrategy, Component, ElementRef, input, viewChild } from '@angular/core';

import type { PageViewerShadowDescriptor } from '../../internal/types';

@Component({
    selector: 'viewer-shadow-page',
    standalone: true,
    templateUrl: './viewer-shadow-page.component.html',
    styleUrl: './viewer-shadow-page.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ViewerShadowPageComponent {
    readonly descriptor = input.required<PageViewerShadowDescriptor>();
    private readonly wrapperRef = viewChild.required<ElementRef<HTMLDivElement>>('wrapper');

    get nativeElement(): HTMLDivElement {
        return this.wrapperRef().nativeElement;
    }
}
