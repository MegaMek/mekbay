import { ChangeDetectionStrategy, Component, ElementRef, input, viewChild } from '@angular/core';

import type { PageViewerPageDescriptor } from '../../internal/types';

@Component({
    selector: 'viewer-page',
    standalone: true,
    templateUrl: './viewer-page.component.html',
    styleUrl: './viewer-page.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ViewerPageComponent {
    readonly descriptor = input.required<PageViewerPageDescriptor>();
    private readonly wrapperRef = viewChild.required<ElementRef<HTMLDivElement>>('wrapper');

    get nativeElement(): HTMLDivElement {
        return this.wrapperRef().nativeElement;
    }
}
