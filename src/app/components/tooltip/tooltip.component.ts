
import { ChangeDetectionStrategy, Component } from '@angular/core';

export interface TooltipLine {
    label?: string;
    value: string;
    iconSrc?: string;
    iconAlt?: string;
    isHeader?: boolean;
}

export type TooltipType = 'info' | 'success' | 'error';

export type TooltipContent = string | TooltipLine[];

@Component({
    selector: 'tooltip',
    standalone: true,
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'tooltip' },
    template: `
        <div class="tooltip-content framed-borders has-shadow" [class.error]="type === 'error'">
            @if (isString) {
                <div class="tooltip-html" [innerHTML]="htmlContent"></div>
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
            background-color: var(--background-color-menu);
            max-width: min(400px, calc(100vw - 24px));
            max-height: calc(100dvh - 24px);
        }
        .tooltip-content {
            color: #fff;
            box-sizing: border-box;
            padding: 6px 8px;
            font-size: 0.9em;
            width: 100%;
            max-width: inherit;
            max-height: inherit;
            line-height: 1.4;
            overflow: auto;
            overscroll-behavior: contain;
        }
        .tooltip-html {
            white-space: normal;
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
    type: TooltipType = 'info';

    get htmlContent(): string {
        return typeof this.content === 'string' ? this.content : '';
    }
    
    get isString(): boolean {
        return typeof this.content === 'string';
    }
    
    get lines(): TooltipLine[] {
        return Array.isArray(this.content) ? this.content : [];
    }
}