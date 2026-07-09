import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ASCardStyle } from '../../models/options.model';

@Component({
    selector: 'g[as-footer-logos]',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './footer-logos.component.html',
    styleUrl: './alpha-strike-card-svg.component.scss',
    host: {
        '[class.night-mode]': 'cardStyle() === "night"',
    },
})
export class AsFooterLogosComponent {
    readonly instanceId = input.required<number>();
    readonly cardStyle = input.required<ASCardStyle>();
}