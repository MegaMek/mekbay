import { LAYOUT_STANDARD_SVG_TEMPLATE } from './layouts/layout-standard-svg.template';
import { LAYOUT_VESSEL_FRONT_SVG_TEMPLATE } from './layouts/layout-vessel-front-svg.template';
import { LAYOUT_VESSEL_REAR_SVG_TEMPLATE } from './layouts/layout-vessel-rear-svg.template';
import { FOOTER_LOGOS_SVG_TEMPLATE } from './footer-logos-svg.template';

export const ALPHA_STRIKE_CARD_TEMPLATE = `
<div class="card-container">
    <svg class="card-svg" viewBox="0 0 1120 800" xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid meet" role="img" [attr.aria-label]="chassis() + ' ' + model() + ' Alpha Strike card'">
        <defs>
            <linearGradient [attr.id]="'title-gradient-' + instanceId" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stop-color="#5b504e" stop-opacity="0" />
                <stop offset="0.08" stop-color="#5b504e" />
                <stop offset="0.92" stop-color="#5b504e" />
                <stop offset="1" stop-color="#5b504e" stop-opacity="0" />
            </linearGradient>
            <linearGradient [attr.id]="'range-left-gradient-' + instanceId" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stop-color="#5b504e" stop-opacity="0" />
                <stop offset="0.08" stop-color="#5b504e" />
                <stop offset="1" stop-color="#5b504e" />
            </linearGradient>
            <linearGradient [attr.id]="'range-right-gradient-' + instanceId" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stop-color="#5b504e" />
                <stop offset="0.92" stop-color="#5b504e" />
                <stop offset="1" stop-color="#5b504e" stop-opacity="0" />
            </linearGradient>
            <clipPath [attr.id]="'card-clip-' + instanceId">
                <rect x="20" y="20" width="1080" height="760" />
            </clipPath>
        </defs>

        <rect class="card-border" x="0" y="0" width="1120" height="800" fill="#000" />
        <rect class="card-field" x="20" y="20" width="1080" height="760" fill="#fff" />

        @if (resolvedUnit(); as renderedUnit) {
            @switch (currentDesign()) {
                @case ('standard') {
                    ${LAYOUT_STANDARD_SVG_TEMPLATE}
                }
                @case ('large-vessel-1') {
                    <g class="vessel-front" font-family="Roboto, sans-serif">
                        ${LAYOUT_VESSEL_FRONT_SVG_TEMPLATE}
                    </g>
                }
                @case ('large-vessel-2') {
                    <g class="vessel-rear" font-family="Roboto, sans-serif">
                        ${LAYOUT_VESSEL_REAR_SVG_TEMPLATE}
                    </g>
                }
            }
        }

        <g class="footer">
            <path d="M20 704 H535 L590 780 H20 Z" fill="#000" />
            ${FOOTER_LOGOS_SVG_TEMPLATE}
        </g>
    </svg>

    <div class="interaction-overlay" aria-hidden="true">
        @if (interactive() && currentDesign() === 'standard' && standardLayout().critical) {
            @let critical = standardLayout().critical!;
            <button class="crit-roll-button" type="button" aria-label="Roll critical hit"
                [style.left.%]="(critical.x + critical.width - 45) / 11.2" [style.top.%]="(critical.y + 8) / 8"
                (click)="$event.stopPropagation(); onRollCriticalClick()"></button>
        }
        @if (interactive() && isDirty()) {
            <button class="bt-button commit-button primary" type="button" (click)="onCommitClick($event)">COMMIT</button>
        }
    </div>
</div>
`;