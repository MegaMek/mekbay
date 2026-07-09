export const LAYOUT_VESSEL_FRONT_SVG_TEMPLATE = `
<text x="30" y="64" fill="#000" font-family="Roboto, sans-serif" font-size="42" font-weight="900">
    {{ (forceUnit()?.alias() || chassis() + ' ' + model()).toUpperCase() }}
</text>
<path d="M860 20 H1100 V105 H910 Z" fill="#000" />
<text x="1010" y="78" fill="#fff" font-size="58" font-weight="900" text-anchor="middle">{{ adjustedPV() }}</text>

<g class="vessel-stats">
    <rect class="frame-background" x="28" y="88" width="520" height="62" rx="16" fill="#fff" fill-opacity="0.85" stroke="#221f20" stroke-width="3" />
    <text x="48" y="130" fill="#000" font-size="27">TP:<tspan fill="#7b0000" font-weight="900">{{ asStats().TP }}</tspan></text>
    <text x="165" y="130" fill="#000" font-size="27">SZ:<tspan fill="#7b0000" font-weight="900">{{ asStats().SZ }}</tspan></text>
    <text x="270" y="130" fill="#000" font-size="27">THR:<tspan fill="#7b0000" font-weight="900">{{ movementSvgText() }}</tspan></text>
    <text class="skill-control clickable" x="526" y="130" fill="#000" font-size="27" text-anchor="end"
        (click)="interactive() && onEditPilotClick()">SKILL:<tspan fill="#7b0000" font-weight="900">{{ skill() }}</tspan></text>
</g>

<g class="era-icons">
    @for (item of eraAvailability(); track item.era.id; let eraIndex = $index) {
        @if (item.era.icon) {
            <image class="era-icon" [class.unavailable]="!item.isAvailable" [attr.href]="item.era.icon"
                [attr.x]="575 + eraIndex * 42" y="96" width="32" height="32" preserveAspectRatio="xMidYMid meet">
                <title>{{ item.era.name }}</title>
            </image>
        }
    }
</g>

<g class="vessel-damage-frame">
    <rect class="frame-background" x="28" y="158" width="520" height="235" rx="16" fill="#fff" fill-opacity="0.85" stroke="#221f20" stroke-width="3" />
    <line x1="195" y1="166" x2="195" y2="385" stroke="#000" stroke-width="2" />
    <line x1="205" y1="270" x2="535" y2="270" stroke="#000" stroke-width="2" />
    <line x1="205" y1="381" x2="535" y2="381" stroke="#000" stroke-width="2" />
    <text x="105" y="190" fill="#000" font-size="22" font-weight="900" text-anchor="middle">ARMOR</text>
    <text x="105" y="247" fill="#000" font-size="55" font-weight="900" text-anchor="middle">{{ armorPips() }}</text>
    <text x="105" y="300" fill="#000" font-size="22" font-weight="900" text-anchor="middle">STRUCTURE</text>
    <text x="105" y="365" fill="#000" font-size="55" font-weight="900" text-anchor="middle">{{ structurePips() }}</text>
    <text x="215" y="190" fill="#000" font-size="20" font-weight="900">DAMAGE</text>
    <g class="damage-track" data-damage-track="armor" [class.pending-damage]="pendingArmorChange() > 0" [class.pending-heal]="pendingArmorChange() < 0">
        <text x="365" y="245" fill="#7b0000" font-size="48" font-weight="900" text-anchor="middle">
            {{ committedArmorDamage() || '' }}@if (pendingArmorChange()) {<tspan>{{ pendingArmorChange() > 0 ? '+' : '' }}{{ pendingArmorChange() }}</tspan>}
        </text>
    </g>
    <text x="215" y="300" fill="#000" font-size="20" font-weight="900">DAMAGE</text>
    <g class="damage-track" data-damage-track="structure" [class.pending-damage]="pendingInternalChange() > 0" [class.pending-heal]="pendingInternalChange() < 0">
        <text x="365" y="365" fill="#7b0000" font-size="48" font-weight="900" text-anchor="middle">
            {{ committedInternalDamage() || '' }}@if (pendingInternalChange()) {<tspan>{{ pendingInternalChange() > 0 ? '+' : '' }}{{ pendingInternalChange() }}</tspan>}
        </text>
    </g>
</g>

<g class="damage-threshold">
    <rect class="frame-background" x="556" y="158" width="536" height="62" rx="16" fill="#fff" fill-opacity="0.85" stroke="#221f20" stroke-width="3" />
    <text x="824" y="201" fill="#000" font-size="30" font-weight="900" text-anchor="middle">
        <tspan fill="#7b0000">{{ asStats().Th }}</tspan> DAMAGE THRESHOLD
    </text>
</g>

@if (renderImageUrl()) {
    <image class="fluff-image" [attr.href]="renderImageUrl()" x="556" y="230" width="536" height="330"
        preserveAspectRatio="xMidYMid meet" [attr.clip-path]="'url(#card-clip-' + instanceId + ')'" />
}

<g class="vessel-critical-frame">
    <rect class="frame-background" x="28" y="402" width="520" height="294" rx="16" fill="#fff" fill-opacity="0.85" stroke="#221f20" stroke-width="3" />
    <text x="288" y="440" fill="#000" font-size="29" font-weight="900" text-anchor="middle">CRITICAL HITS</text>
    @for (row of vesselCriticalRows(); track row.key; let rowIndex = $index) {
        @let rowY = 486 + rowIndex * 36;
        <g class="critical-row" [attr.data-crit]="row.key">
            <text x="150" [attr.y]="rowY" fill="#7b0000" font-family="Roboto Condensed, sans-serif" font-size="19" font-weight="900" text-anchor="end">{{ row.name }}</text>
            @for (pipIndex of range(row.maxPips); track pipIndex) {
                <circle class="pip" [class.damaged]="isCritPipDamaged(row.key, pipIndex)"
                    [class.pending-damage]="isCritPipPendingDamage(row.key, pipIndex)"
                    [class.pending-heal]="isCritPipPendingHeal(row.key, pipIndex)"
                    [attr.cx]="168 + pipIndex * 24" [attr.cy]="rowY - 7" r="10" fill="#fff" stroke="#000" stroke-width="3" />
            }
            @if (row.descriptions.length > 1) {
                <text [attr.x]="174 + row.maxPips * 24" [attr.y]="rowY + 8" fill="#000"
                    font-family="Roboto Condensed, sans-serif" font-size="42" font-weight="400">&#123;</text>
            }
            @for (description of row.descriptions; track description; let descriptionIndex = $index) {
                <text [attr.x]="190 + row.maxPips * 24"
                    [attr.y]="rowY - (row.descriptions.length > 1 ? 8 : 0) + descriptionIndex * 22"
                    fill="#000" font-family="Roboto Condensed, sans-serif" font-size="18" font-weight="600">{{ description }}</text>
            }
        </g>
    }
    <text x="150" y="678" fill="#7b0000" font-family="Roboto Condensed, sans-serif" font-size="19" font-weight="900" text-anchor="end">WEAPONS</text>
    <text x="168" y="678" fill="#000" font-family="Roboto Condensed, sans-serif" font-size="18" font-weight="600">See Back...</text>
</g>

@if (vesselSpecialsRenderModel().frame; as specialsFrame) {
    <g class="vessel-specials">
        <rect class="frame-background" [attr.x]="specialsFrame.x" [attr.y]="specialsFrame.y"
            [attr.width]="specialsFrame.width" [attr.height]="specialsFrame.height"
            rx="16" fill="#fff" fill-opacity="0.85" stroke="#221f20" stroke-width="3" />
        <text [attr.x]="specialsFrame.x + 14" [attr.y]="vesselSpecialsRenderModel().firstBaseline" fill="#000" font-size="30">SPECIAL:</text>
        @for (token of vesselSpecialsRenderModel().tokens; track token.state.original) {
            <text class="special-ability" [attr.data-original]="token.state.original" [attr.x]="token.x" [attr.y]="token.y"
                fill="#7b0000" font-family="Roboto, sans-serif" font-size="30" font-weight="900"
                (click)="onSvgSpecialClick(token.state, $event)">{{ token.text }}</text>
        }
    </g>
}
`;