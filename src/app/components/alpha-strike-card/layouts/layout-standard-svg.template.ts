export const LAYOUT_STANDARD_SVG_TEMPLATE = `
@let layout = standardLayout();
@let image = standardImageGeometry();

@if (renderImageUrl()) {
    <image class="fluff-image" [attr.href]="renderImageUrl()" [attr.x]="image.x" [attr.y]="image.y"
        [attr.width]="image.width" [attr.height]="image.height" [attr.preserveAspectRatio]="image.preserveAspectRatio"
        [attr.clip-path]="'url(#card-clip-' + instanceId + ')'" />
}
<g class="era-icons" aria-label="Era availability">
    @for (item of eraAvailability(); track item.era.id; let eraIndex = $index) {
        @if (item.era.icon) {
            <image class="era-icon" [class.unavailable]="!item.isAvailable" [attr.href]="item.era.icon"
                [attr.x]="cardGeometry.bodyRight - 30" [attr.y]="145 + eraIndex * 35" width="28" height="28" preserveAspectRatio="xMidYMid meet">
                <title>{{ item.era.name }}</title>
            </image>
        }
    }
</g>

<g class="header" fill="#000" font-family="Roboto, sans-serif">
    @if (isCommander()) {
        <svg class="group-commander-icon" [attr.x]="cardGeometry.bodyInset" y="20" width="84" height="104" viewBox="0 0 21.04 25.94" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <g transform="translate(-.02) rotate(180 10.52 12.97)" fill="#000" opacity="0.3">
                <g transform="matrix(.265 0 0 .265 -21.1 0)">
                    <path d="m79.7 70 39.3-70 40 70.1h-27l-13-22.1-13 22.1z" />
                    <path d="m81.4 97.9 11.3-21.6h52.3l12 21.6z" />
                </g>
            </g>
        </svg>
    }
    <text [attr.x]="cardGeometry.bodyInset" y="54" font-size="40" font-weight="400">{{ headerLines().model }}</text>
    <text class="chassis-text" [attr.x]="cardGeometry.bodyInset" y="120" [attr.font-size]="headerLines().fontSize"
        font-family="Roboto Condensed, sans-serif" font-weight="700" letter-spacing="0.05em">{{ headerLines().chassis }}</text>
</g>
<path class="pv-background" d="M860 20 H1100 V105 H910 Z" fill="#000" />
<text x="1010" y="78" fill="#fff" font-family="Roboto, sans-serif" font-size="58" font-weight="900" text-anchor="middle">{{ adjustedPV() }}</text>
@if (basePV() !== adjustedPV()) {
    <text class="base-pv" x="1010" y="126" fill="#000" stroke="#fff" stroke-width="5" paint-order="stroke fill"
        font-family="Roboto, sans-serif" font-size="24" font-weight="700" text-anchor="middle">Base PV: {{ basePV() }}</text>
}

<g class="general-frame">
    <rect class="frame-background" [attr.x]="layout.general.x" [attr.y]="layout.general.y" [attr.width]="layout.general.width" [attr.height]="layout.general.height" rx="16" ry="16" fill="#fff" fill-opacity="0.85" stroke="#666" stroke-width="3" />
    <text [attr.x]="layout.general.x + 14" [attr.y]="layout.general.y + 35" fill="#000" font-family="Roboto, sans-serif" font-size="29" font-weight="500">TP: <tspan class="as-value" fill="#7b0000" font-weight="900">{{ asStats().TP }}</tspan></text>
    <text [attr.x]="layout.general.x + 145" [attr.y]="layout.general.y + 35" fill="#000" font-family="Roboto, sans-serif" font-size="29" font-weight="500">SZ: <tspan class="as-value" fill="#7b0000" font-weight="900">{{ asStats().SZ }}</tspan></text>
    @if (!isAerospaceUnit()) {
        <text [attr.x]="layout.general.x + 285" [attr.y]="layout.general.y + 35" fill="#000" font-family="Roboto, sans-serif" font-size="29" font-weight="500">TMM: <tspan class="as-value" fill="#7b0000" font-weight="900">{{ tmmDisplay() }}</tspan></text>
    }
    <text [attr.x]="layout.general.x + layout.general.width - 14" [attr.y]="layout.general.y + 35" fill="#000" font-family="Roboto, sans-serif" font-size="29" font-weight="500" text-anchor="end">
        {{ isAerospaceUnit() ? 'THR' : 'MV' }}: <tspan class="as-value" fill="#7b0000" font-weight="900">{{ movementSvgText() }}</tspan>
    </text>
    @if (sprintMove()) {
        <text [attr.x]="layout.general.x + layout.general.width - 14" [attr.y]="layout.general.y + 57" fill="#000" font-family="Roboto, sans-serif" font-size="20" font-weight="700" text-anchor="end">Sprint: {{ sprintMove() }}</text>
    }
    <text [attr.x]="layout.general.x + 14" [attr.y]="layout.general.y + 80" fill="#000" font-family="Roboto, sans-serif" font-size="27" font-weight="500">ROLE: <tspan class="as-value" fill="#7b0000" font-weight="900">{{ renderedUnit.role }}</tspan></text>
    <text class="skill-control" [class.clickable]="interactive()" [attr.x]="layout.general.x + layout.general.width - 14" [attr.y]="layout.general.y + 80"
        fill="#000" font-family="Roboto, sans-serif" font-size="27" font-weight="500" text-anchor="end" (click)="interactive() && onEditPilotClick()">
        SKILL: <tspan class="as-value" fill="#7b0000" font-weight="900">{{ skill() }}</tspan>
    </text>
</g>

<g class="damage-frame">
    <rect class="frame-background" [attr.x]="layout.damage.x" [attr.y]="layout.damage.y" [attr.width]="layout.damage.width" [attr.height]="layout.damage.height" rx="16" ry="16" fill="#fff" fill-opacity="0.85" stroke="#666" stroke-width="3" />
    <text [attr.x]="layout.damage.x + 20" [attr.y]="layout.damage.y + layout.damage.height / 2"
        [attr.transform]="'rotate(-90 ' + (layout.damage.x + 20) + ' ' + (layout.damage.y + layout.damage.height / 2) + ')'"
        fill="#7b0000" font-family="Roboto Condensed, sans-serif" font-size="23" font-weight="900" text-anchor="middle" dominant-baseline="middle">DAMAGE</text>
    @for (range of damageRanges(); track range.label; let rangeIndex = $index) {
        @let rangeWidth = (layout.damage.width - 54) / damageRanges().length;
        @let rangeX = layout.damage.x + 50 + rangeIndex * rangeWidth + rangeWidth / 2;
        <rect class="range-title-background" [attr.x]="layout.damage.x + 50 + rangeIndex * rangeWidth" [attr.y]="layout.damage.y + 7"
            [attr.width]="rangeWidth" height="28"
            [attr.fill]="cardStyle() === 'night' ? (rangeIndex === 0 ? 'url(#range-left-gradient-' + instanceId + ')' : rangeIndex === damageRanges().length - 1 ? 'url(#range-right-gradient-' + instanceId + ')' : 'url(#title-gradient-' + instanceId + ')') : 'transparent'" />
        <text class="range-header-text" [attr.x]="rangeX" [attr.y]="layout.damage.y + 28" fill="#000" font-family="Roboto, sans-serif" font-size="20" font-weight="700" text-anchor="middle">{{ range.label }} ({{ range.modifier === 0 ? '0' : '+' + range.modifier }} | {{ range.toHit }}+)</text>
        <text class="damage-value" [class.reduced]="weaponHits() > 0" [attr.x]="rangeX" [attr.y]="layout.damage.y + 75" fill="#7b0000" font-family="Roboto, sans-serif" font-size="42" font-weight="900" text-anchor="middle">{{ range.value }}</text>
        <text [attr.x]="rangeX" [attr.y]="layout.damage.y + 102" fill="#000" font-family="Roboto, sans-serif" font-size="19" text-anchor="middle">{{ range.distance }}</text>
    }
</g>

@if (layout.heat; as heatFrame) {
    <g class="heat-frame">
        <rect class="frame-background" [attr.x]="heatFrame.x" [attr.y]="heatFrame.y" [attr.width]="heatFrame.width" [attr.height]="heatFrame.height" rx="16" ry="16" fill="#fff" fill-opacity="0.85" stroke="#666" stroke-width="3" />
        <text [attr.x]="heatFrame.x + 14" [attr.y]="heatFrame.y + 39" fill="#000" font-family="Roboto, sans-serif" font-size="28" font-weight="500">OV: <tspan class="as-value" fill="#7b0000" font-weight="900">{{ asStats().OV }}</tspan></text>
        <rect class="heat-title-background" [attr.x]="heatFrame.x + 110" [attr.y]="heatFrame.y + 8" width="235" height="40"
            [attr.fill]="cardStyle() === 'night' ? 'url(#title-gradient-' + instanceId + ')' : 'transparent'" />
        <text class="heat-title-text" [attr.x]="heatFrame.x + 142" [attr.y]="heatFrame.y + 43" fill="#000" font-family="Roboto, sans-serif" font-size="29" font-weight="900">HEAT SCALE</text>
        @let heatLevels = heatTrackLevels();
        @let cellWidth = heatLevels.length > 4 ? 34 : 44;
        @let trackX = heatFrame.x + heatFrame.width - (heatLevels.length + 1) * cellWidth - 14;
        <rect [attr.x]="trackX" [attr.y]="heatFrame.y + 7" [attr.width]="(heatLevels.length + 1) * cellWidth" height="44" rx="11" ry="11" fill="#888" stroke="#000" stroke-width="3" />
        <g class="heat-track">
            @let committedHeat = heatLevel();
            @let pendingHeatDelta = pendingHeat();
            @let previewHeat = committedHeat + pendingHeatDelta;
            @for (level of heatLevels; track level; let heatIndex = $index) {
                <g class="heat-level" [class.active]="committedHeat === level" [class.pending]="pendingHeatDelta !== 0 && previewHeat === level" [attr.data-heat]="level">
                    <rect class="heat-cell" [attr.x]="trackX + heatIndex * cellWidth + (heatIndex === 0 ? 2 : 1)" [attr.y]="heatFrame.y + 9"
                        [attr.width]="cellWidth - 2" height="40" [attr.rx]="heatIndex === 0 ? 9 : 0" [attr.ry]="heatIndex === 0 ? 9 : 0" fill="transparent" />
                    <text [attr.x]="trackX + heatIndex * cellWidth + cellWidth / 2" [attr.y]="heatFrame.y + 41" fill="#fff" font-family="Roboto, sans-serif" font-size="31" text-anchor="middle">{{ level }}</text>
                    <line class="heat-separator" [attr.x1]="trackX + (heatIndex + 1) * cellWidth" [attr.x2]="trackX + (heatIndex + 1) * cellWidth"
                        [attr.y1]="heatFrame.y + 9" [attr.y2]="heatFrame.y + 49" stroke="#000" stroke-width="2" />
                </g>
            }
            <g class="heat-level heat-s" [class.active]="committedHeat >= shutdownHeatThreshold()" [class.pending]="pendingHeatDelta !== 0 && previewHeat >= shutdownHeatThreshold()" [attr.data-heat]="shutdownHeatThreshold()">
                <rect class="heat-cell" [attr.x]="trackX + heatLevels.length * cellWidth + 1" [attr.y]="heatFrame.y + 9"
                    [attr.width]="cellWidth - 3" height="40" rx="9" ry="9" fill="transparent" />
                <text [attr.x]="trackX + heatLevels.length * cellWidth + cellWidth / 2" [attr.y]="heatFrame.y + 41" fill="#fff" font-family="Roboto, sans-serif" font-size="31" text-anchor="middle">S</text>
            </g>
        </g>
    </g>
}

<g class="armor-frame pips-wrapper">
    <rect class="frame-background" [attr.x]="layout.armor.x" [attr.y]="layout.armor.y" [attr.width]="layout.armor.width" [attr.height]="layout.armor.height" rx="16" ry="16" fill="#fff" fill-opacity="0.85" stroke="#666" stroke-width="3" />
    <g class="pip-row" data-damage-type="armor">
        <text [attr.x]="layout.armor.x + 14" [attr.y]="layout.armor.y + 37" fill="#000" font-family="Roboto, sans-serif" font-size="29" font-weight="500">A:</text>
        @for (pipState of armorPipStates(); track pipState.index) {
            <circle class="pip" [class.damaged]="pipState.isDamaged" [class.pending-damage]="pipState.isPendingDamage" [class.pending-heal]="pipState.isPendingHeal"
                [attr.cx]="armorPipX(pipState.index, layout.armor.x)" [attr.cy]="armorPipY(pipState.index, layout.armor.y)" r="13" fill="#fff" stroke="#000" stroke-width="3" />
        }
    </g>
    <g class="pip-row" data-damage-type="structure">
        <text [attr.x]="layout.armor.x + 14" [attr.y]="structurePipY(0, layout.armor.y) + 10" fill="#000" font-family="Roboto, sans-serif" font-size="29" font-weight="500">S:</text>
        @for (pipState of structurePipStates(); track pipState.index) {
            <circle class="pip structure" [class.damaged]="pipState.isDamaged" [class.pending-damage]="pipState.isPendingDamage" [class.pending-heal]="pipState.isPendingHeal"
                [attr.cx]="armorPipX(pipState.index, layout.armor.x)" [attr.cy]="structurePipY(pipState.index, layout.armor.y)" r="13" fill="#bbb" stroke="#000" stroke-width="3" />
        }
    </g>
    @if (asStats().usesTh) {
        <text [attr.x]="layout.armor.x + layout.armor.width - 14" [attr.y]="layout.armor.y + 34" fill="#000" font-family="Roboto, sans-serif" font-size="29" text-anchor="end">TH:</text>
        <text [attr.x]="layout.armor.x + layout.armor.width - 28" [attr.y]="layout.armor.y + 78" fill="#7b0000" font-family="Roboto, sans-serif" font-size="40" font-weight="900" text-anchor="middle">{{ asStats().Th }}</text>
    }
</g>

@if (layout.critical; as criticalFrame) {
    <g class="critical-frame">
        <rect class="frame-background" [attr.x]="criticalFrame.x" [attr.y]="criticalFrame.y" [attr.width]="criticalFrame.width" [attr.height]="criticalFrame.height" rx="16" ry="16" fill="#fff" fill-opacity="0.85" stroke="#666" stroke-width="3" />
        <rect class="critical-title-background" [attr.x]="criticalFrame.x + 70" [attr.y]="criticalFrame.y + 8" [attr.width]="criticalFrame.width - 140" height="38" [attr.fill]="cardStyle() === 'night' ? 'url(#title-gradient-' + instanceId + ')' : 'transparent'" />
        <text class="critical-title-text" [attr.x]="criticalFrame.x + criticalFrame.width / 2" [attr.y]="criticalFrame.y + 38" fill="#000" font-family="Roboto, sans-serif" font-size="29" font-weight="900" text-anchor="middle">CRITICAL HITS</text>
        @for (row of criticalRows(); track row.key; let rowIndex = $index) {
            @let rowY = criticalFrame.y + 72 + rowIndex * 39;
            <g class="critical-row" [attr.data-crit]="row.key">
                <text [attr.x]="criticalFrame.x + 128" [attr.y]="rowY" fill="#7b0000" font-family="Roboto Condensed, sans-serif" font-size="19" font-weight="900" text-anchor="end">{{ row.name }}</text>
                @if (showNumericCritPips(row.key, row.maxPips)) {
                    <text class="pip-count" [class.pending-damage]="pendingCritChange(row.key) > 0" [class.pending-heal]="pendingCritChange(row.key) < 0" [attr.x]="criticalFrame.x + 145" [attr.y]="rowY" fill="var(--damage-color)" font-family="Roboto, sans-serif" font-size="23" font-weight="900">{{ committedCritHits(row.key) }}{{ pendingCritChange(row.key) ? pendingCritDelta(row.key) : '' }}</text>
                    <circle class="pip damaged" [attr.cx]="criticalFrame.x + 196" [attr.cy]="rowY - 7" r="10" fill="var(--damage-color)" stroke="#000" stroke-width="3" />
                } @else {
                    @for (pipIndex of range(row.maxPips); track pipIndex) {
                        <circle class="pip" [class.damaged]="isCritPipDamaged(row.key, pipIndex)" [class.pending-damage]="isCritPipPendingDamage(row.key, pipIndex)" [class.pending-heal]="isCritPipPendingHeal(row.key, pipIndex)"
                            [attr.cx]="criticalFrame.x + 146 + pipIndex * 24" [attr.cy]="rowY - 7" r="10" fill="#fff" stroke="#000" stroke-width="3" />
                    }
                }
                <text [attr.x]="criticalFrame.x + 150 + row.maxPips * 24" [attr.y]="rowY" fill="#000" font-family="Roboto Condensed, sans-serif" font-size="20" font-weight="600">{{ row.description }}</text>
            </g>
        }
        @if (currentCriticalHitsVariant() === 'vehicle') {
            @let motiveY = criticalFrame.y + criticalFrame.height - 24;
            <text [attr.x]="criticalFrame.x + 105" [attr.y]="motiveY" fill="#7b0000" font-family="Roboto Condensed, sans-serif" font-size="19" font-weight="900" text-anchor="end">MOTIVE</text>
            @for (motive of [{ key: 'motive1', desc: useHex() ? '-1⬢ MV' : '-2″ MV', pips: 2 }, { key: 'motive2', desc: '½ MV', pips: 2 }, { key: 'motive3', desc: '0 MV', pips: 1 }]; track motive.key; let motiveIndex = $index) {
                <g class="critical-row motive-row" [attr.data-crit]="motive.key">
                    @for (pipIndex of range(motive.pips); track pipIndex) {
                        <circle class="pip" [class.damaged]="isCritPipDamaged(motive.key, pipIndex)" [class.pending-damage]="isCritPipPendingDamage(motive.key, pipIndex)" [class.pending-heal]="isCritPipPendingHeal(motive.key, pipIndex)"
                            [attr.cx]="criticalFrame.x + 120 + motiveIndex * 105 + pipIndex * 23" [attr.cy]="motiveY - 7" r="9" fill="#fff" stroke="#000" stroke-width="3" />
                    }
                    <text [attr.x]="criticalFrame.x + 120 + motiveIndex * 105 + motive.pips * 23" [attr.y]="motiveY" fill="#000" font-family="Roboto Condensed, sans-serif" font-size="18" font-weight="600">{{ motive.desc }}</text>
                </g>
            }
        }
    </g>
}

@if (pilotAbilities().length > 0) {
    <g class="pilot-abilities">
        @for (ability of pilotAbilities(); track formatPilotAbility(ability); let abilityIndex = $index) {
            <text class="pilot-ability" x="650" [attr.y]="(layout.critical?.y ?? layout.mainBottom) - 12 - abilityIndex * 28" fill="#000" stroke="#fff" stroke-width="5" paint-order="stroke fill"
                font-family="Roboto, sans-serif" font-size="25" font-weight="700" (click)="onPilotAbilityClick(ability)">{{ formatPilotAbility(ability) }}</text>
        }
    </g>
}
@if (layout.specials; as specialsFrame) {
    <g class="specials-frame">
        <rect class="frame-background" [attr.x]="specialsFrame.x" [attr.y]="specialsFrame.y" [attr.width]="specialsFrame.width" [attr.height]="specialsFrame.height" rx="16" ry="16" fill="#fff" fill-opacity="0.85" stroke="#666" stroke-width="3" />
        <text [attr.x]="specialsFrame.x + 14" [attr.y]="specialsFrame.y + 38" fill="#000" font-family="Roboto, sans-serif" font-size="30" font-weight="500">SPECIAL:</text>
        @for (token of specialTokens(); track token.state.original) {
            <text class="special-ability as-value" [class.exhausted]="token.state.isExhausted || (token.state.maxCount && (token.state.consumedCount ?? 0) >= token.state.maxCount)" [class.has-consumed]="token.state.consumedCount"
                [attr.data-original]="token.state.original" [attr.x]="token.x" [attr.y]="token.y" fill="#7b0000" font-family="Roboto, sans-serif" font-size="30" font-weight="900"
                (click)="onSvgSpecialClick(token.state, $event)">{{ token.text }}</text>
        }
    </g>
}
@if (isDestroyed()) {
    <g class="destroyed-overlay" pointer-events="none">
        <rect x="20" y="20" width="1080" height="760" fill="#800" fill-opacity="0.3" />
        <text x="1080" y="210" fill="#a00" stroke="#111" stroke-width="8" paint-order="stroke fill" font-family="Roboto, sans-serif" font-size="72" font-weight="900" text-anchor="end">DESTROYED</text>
    </g>
}
`;