
import { ChangeDetectionStrategy, Component, HostBinding } from '@angular/core';

@Component({
    selector: 'tooltip',
    standalone: true,
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div class="tooltip-content framed-borders has-shadow">{{ text }}</div>`,
    styles: [`
        :host {
            display: block;
            pointer-events: none;
        }
        .tooltip-content {
            color: #fff;
            background-color: var(--background-color-menu);
            padding: 6px 8px;
            font-size: 0.9em;
            max-width: 400px;
        }
    `]
})
export class TooltipComponent {
    text = '';
    @HostBinding('class') hostClass = 'tooltip';
}