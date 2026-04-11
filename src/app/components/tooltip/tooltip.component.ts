
import { ChangeDetectionStrategy, Component } from '@angular/core';

export interface TooltipLine {
    label?: string;
    value: string;
}

export type TooltipContent = string | TooltipLine[];

@Component({
    selector: 'tooltip',
    standalone: true,
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'tooltip' },
    template: `
        <div class="tooltip-content framed-borders has-shadow">
            @if (isString) {
                {{ content }}
            } @else {
                @for (line of lines; track $index) {
                    @if (line.label) {
                        <div class="tooltip-row">
                            <span class="label">{{ line.label }}</span>
                            <span class="value">{{ line.value }}</span>
                        </div>
                    } @else {
                        <div class="tooltip-row plain">{{ line.value }}</div>
                    }
                }
            }
        </div>
    `,
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
        .tooltip-row {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            white-space: nowrap;
        }
        .tooltip-row.plain {
            display: block;
        }
        .tooltip-row .value {
            font-weight: 500;
        }
    `]
})
export class TooltipComponent {
    content: TooltipContent = '';
    
    get isString(): boolean {
        return typeof this.content === 'string';
    }
    
    get lines(): TooltipLine[] {
        return Array.isArray(this.content) ? this.content : [];
    }
}