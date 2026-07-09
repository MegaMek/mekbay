export const LAYOUT_VESSEL_FRONT_SVG_TEMPLATE = `
<text class="chassis-text" [attr.x]="cardGeometry.bodyInset" y="64" fill="#000" font-family="Roboto Condensed, sans-serif"
    font-size="42" font-weight="700" letter-spacing="0.05em">
    {{ (forceUnit()?.alias() || chassis() + ' ' + model()).toUpperCase() }}
</text>
<path d="M860 20 H1100 V105 H910 Z" fill="#000" />
<text x="1010" y="78" fill="#fff" font-size="58" font-weight="900" text-anchor="middle">{{ adjustedPV() }}</text>

<g class="vessel-stats">
    <rect class="frame-background" [attr.x]="vesselFrontGeometry.leftX" [attr.y]="vesselFrontGeometry.statsY"
        [attr.width]="vesselFrontGeometry.leftWidth" [attr.height]="vesselFrontGeometry.statsHeight" rx="16" fill="#fff" fill-opacity="0.85" stroke="#666" stroke-width="3" />
    <text [attr.x]="vesselFrontGeometry.leftX + 20" y="130" fill="#000" font-size="27">TP:<tspan fill="#7b0000" font-weight="900">{{ asStats().TP }}</tspan></text>
    <text [attr.x]="vesselFrontGeometry.leftX + 137" y="130" fill="#000" font-size="27">SZ:<tspan fill="#7b0000" font-weight="900">{{ asStats().SZ }}</tspan></text>
    <text [attr.x]="vesselFrontGeometry.leftX + 242" y="130" fill="#000" font-size="27">THR:<tspan fill="#7b0000" font-weight="900">{{ movementSvgText() }}</tspan></text>
    <text class="skill-control clickable" [attr.x]="vesselFrontGeometry.leftX + vesselFrontGeometry.leftWidth - 22" y="130" fill="#000" font-size="27" text-anchor="end"
        (click)="interactive() && onEditPilotClick()">SKILL:<tspan fill="#7b0000" font-weight="900">{{ skill() }}</tspan></text>
</g>

<g class="era-icons">
    @for (item of eraAvailability(); track item.era.id; let eraIndex = $index) {
        @if (item.era.icon) {
            <image class="era-icon" [class.unavailable]="!item.isAvailable" [attr.href]="item.era.icon"
                [attr.x]="vesselFrontGeometry.rightX + 21 + eraIndex * 42" y="96" width="32" height="32" preserveAspectRatio="xMidYMid meet">
                <title>{{ item.era.name }}</title>
            </image>
        }
    }
</g>

<g class="vessel-damage-frame">
    <rect class="frame-background" [attr.x]="vesselFrontGeometry.leftX" [attr.y]="vesselFrontGeometry.secondRowY"
        [attr.width]="vesselFrontGeometry.leftWidth" [attr.height]="vesselFrontGeometry.damageHeight" rx="16" fill="#fff" fill-opacity="0.85" stroke="#666" stroke-width="3" />
    <line [attr.x1]="vesselFrontGeometry.leftX + 167" [attr.y1]="vesselFrontGeometry.secondRowY + 8"
        [attr.x2]="vesselFrontGeometry.leftX + 167" [attr.y2]="vesselFrontGeometry.secondRowY + vesselFrontGeometry.damageHeight - 8" stroke="#000" stroke-width="2" />
    <line [attr.x1]="vesselFrontGeometry.leftX + 177" [attr.y1]="vesselFrontGeometry.secondRowY + 112"
        [attr.x2]="vesselFrontGeometry.leftX + vesselFrontGeometry.leftWidth - 13" [attr.y2]="vesselFrontGeometry.secondRowY + 112" stroke="#000" stroke-width="2" />
    <line [attr.x1]="vesselFrontGeometry.leftX + 177" [attr.y1]="vesselFrontGeometry.secondRowY + vesselFrontGeometry.damageHeight - 12"
        [attr.x2]="vesselFrontGeometry.leftX + vesselFrontGeometry.leftWidth - 13" [attr.y2]="vesselFrontGeometry.secondRowY + vesselFrontGeometry.damageHeight - 12" stroke="#000" stroke-width="2" />
    <text [attr.x]="vesselFrontGeometry.leftX + 77" [attr.y]="vesselFrontGeometry.secondRowY + 32" fill="#000" font-size="22" font-weight="900" text-anchor="middle">ARMOR</text>
    <text [attr.x]="vesselFrontGeometry.leftX + 77" [attr.y]="vesselFrontGeometry.secondRowY + 89" fill="#000" font-size="55" font-weight="900" text-anchor="middle">{{ armorPips() }}</text>
    <text [attr.x]="vesselFrontGeometry.leftX + 77" [attr.y]="vesselFrontGeometry.secondRowY + 142" fill="#000" font-size="22" font-weight="900" text-anchor="middle">STRUCTURE</text>
    <text [attr.x]="vesselFrontGeometry.leftX + 77" [attr.y]="vesselFrontGeometry.secondRowY + 207" fill="#000" font-size="55" font-weight="900" text-anchor="middle">{{ structurePips() }}</text>
    <text [attr.x]="vesselFrontGeometry.leftX + 187" [attr.y]="vesselFrontGeometry.secondRowY + 32" fill="#000" font-size="20" font-weight="900">DAMAGE</text>
    <g class="damage-track" data-damage-track="armor" [class.pending-damage]="pendingArmorChange() > 0" [class.pending-heal]="pendingArmorChange() < 0">
        <rect class="damage-track-hit-area" [attr.x]="vesselFrontGeometry.leftX + 177"
            [attr.y]="vesselFrontGeometry.secondRowY + 8"
            [attr.width]="vesselFrontGeometry.leftWidth - 190" height="104"
            fill="transparent" pointer-events="all" />
        <text [attr.x]="vesselFrontGeometry.leftX + 337" [attr.y]="vesselFrontGeometry.secondRowY + 87" fill="#7b0000" font-size="48" font-weight="900" text-anchor="middle">
            {{ committedArmorDamage() || '' }}@if (pendingArmorChange()) {<tspan>{{ pendingArmorChange() > 0 ? '+' : '' }}{{ pendingArmorChange() }}</tspan>}
        </text>
    </g>
    <text [attr.x]="vesselFrontGeometry.leftX + 187" [attr.y]="vesselFrontGeometry.secondRowY + 142" fill="#000" font-size="20" font-weight="900">DAMAGE</text>
    <g class="damage-track" data-damage-track="structure" [class.pending-damage]="pendingInternalChange() > 0" [class.pending-heal]="pendingInternalChange() < 0">
        <rect class="damage-track-hit-area" [attr.x]="vesselFrontGeometry.leftX + 177"
            [attr.y]="vesselFrontGeometry.secondRowY + 112"
            [attr.width]="vesselFrontGeometry.leftWidth - 190"
            [attr.height]="vesselFrontGeometry.damageHeight - 124"
            fill="transparent" pointer-events="all" />
        <text [attr.x]="vesselFrontGeometry.leftX + 337" [attr.y]="vesselFrontGeometry.secondRowY + 207" fill="#7b0000" font-size="48" font-weight="900" text-anchor="middle">
            {{ committedInternalDamage() || '' }}@if (pendingInternalChange()) {<tspan>{{ pendingInternalChange() > 0 ? '+' : '' }}{{ pendingInternalChange() }}</tspan>}
        </text>
    </g>
</g>

<g class="damage-threshold">
    <rect class="frame-background" [attr.x]="vesselFrontGeometry.rightX" [attr.y]="vesselFrontGeometry.secondRowY"
        [attr.width]="vesselFrontGeometry.rightWidth" [attr.height]="vesselFrontGeometry.statsHeight" rx="16" fill="#fff" fill-opacity="0.85" stroke="#666" stroke-width="3" />
    <text [attr.x]="vesselFrontGeometry.rightX + vesselFrontGeometry.rightWidth / 2" [attr.y]="vesselFrontGeometry.secondRowY + 43" fill="#000" font-size="30" font-weight="900" text-anchor="middle">
        <tspan fill="#7b0000">{{ asStats().Th }}</tspan> DAMAGE THRESHOLD
    </text>
</g>

@if (renderImageUrl()) {
    <image class="fluff-image" [attr.href]="renderImageUrl()" [attr.x]="vesselFrontGeometry.rightX"
        [attr.y]="vesselFrontGeometry.secondRowY + vesselFrontGeometry.statsHeight + cardGeometry.frameGap"
        [attr.width]="vesselFrontGeometry.rightWidth" height="330"
        preserveAspectRatio="xMidYMid meet" [attr.clip-path]="'url(#card-clip-' + instanceId + ')'" />
}

<g class="vessel-critical-frame">
    <rect class="frame-background" [attr.x]="vesselFrontGeometry.leftX" [attr.y]="vesselFrontGeometry.criticalY"
        [attr.width]="vesselFrontGeometry.leftWidth" [attr.height]="vesselFrontGeometry.criticalBottom - vesselFrontGeometry.criticalY"
        rx="16" fill="#fff" fill-opacity="0.85" stroke="#666" stroke-width="3" />
    <text class="critical-title-text" [attr.x]="vesselFrontGeometry.leftX + vesselFrontGeometry.leftWidth / 2"
        [attr.y]="vesselFrontGeometry.criticalY + 38" fill="#000" font-size="29" font-weight="900" text-anchor="middle">CRITICAL HITS</text>
    @for (row of vesselCriticalRows(); track row.key; let rowIndex = $index) {
        @let rowY = vesselFrontGeometry.criticalY + 84 + rowIndex * 36;
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
    <text x="150" [attr.y]="vesselFrontGeometry.criticalBottom - 18" fill="#7b0000" font-family="Roboto Condensed, sans-serif" font-size="19" font-weight="900" text-anchor="end">WEAPONS</text>
    <text x="168" [attr.y]="vesselFrontGeometry.criticalBottom - 18" fill="#000" font-family="Roboto Condensed, sans-serif" font-size="18" font-weight="600">See Back...</text>
</g>

@if (vesselSpecialsRenderModel().frame; as specialsFrame) {
    <g class="vessel-specials">
        <rect class="frame-background" [attr.x]="specialsFrame.x" [attr.y]="specialsFrame.y"
            [attr.width]="specialsFrame.width" [attr.height]="specialsFrame.height"
            rx="16" fill="#fff" fill-opacity="0.85" stroke="#666" stroke-width="3" />
        <text [attr.x]="specialsFrame.x + 14" [attr.y]="vesselSpecialsRenderModel().firstBaseline" fill="#000" font-size="30">SPECIAL:</text>
        @for (token of vesselSpecialsRenderModel().tokens; track token.state.original) {
            <text class="special-ability" [attr.data-original]="token.state.original" [attr.x]="token.x" [attr.y]="token.y"
                fill="#7b0000" font-family="Roboto, sans-serif" font-size="30" font-weight="900"
                (click)="onSvgSpecialClick(token.state, $event)">{{ token.text }}</text>
        }
    </g>
}
`;