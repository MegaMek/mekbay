
import { ChangeDetectionStrategy, Component } from '@angular/core';

export interface TooltipLine {
    label?: string;
    value: string;
    iconSrc?: string;
    iconAlt?: string;
    isHeader?: boolean;
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
                    <div class="tooltip-row" [class.plain]="!line.label" [class.header]="!!line.isHeader">
                        @if (line.iconSrc) {
                            <img class="tooltip-icon" [src]="line.iconSrc" [alt]="line.iconAlt ?? ''" />
                        }
                        @if (line.label) {
                            <span class="label">{{ line.label }}</span>
                            <span class="value">{{ line.value }}</span>
                        } @else {
                            <span class="value">{{ line.value }}</span>
                        }
                    </div>
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
            justify-content: flex-start;
            gap: 8px;
        }
        .tooltip-row.header .value {
            font-weight: 600;
        }
        .tooltip-row .value {
            font-weight: 500;
        }
        .tooltip-icon {
            width: 1.1em;
            height: 1.1em;
            object-fit: contain;
            flex: 0 0 auto;
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