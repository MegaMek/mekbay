// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { UnitSvgService } from "./unit-svg.service";
import type { InfantryRules } from "../models/rules/infantry-rules";
import { getInventoryControlModeAmmoSummary } from "../utils/inventory-control.util";

const SOLDIER_IMAGE_DAMAGED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABEAAAAgCAYAAAD0S5PyAAACJUlEQVR4AYyVP0iVURjGz71TDRYNQVRUEE1BEHEpCoIacilag4YwgpoaCmooomiLBnUREUVxcBX8MwkiOCiCgwgOIoqg4KSgg4Oov3M47/nec7/vnKs8z3n/P985937nWjeJvxNjFiBINKh0pQiT3TVjGrCGP6b6K91KETrfQAeEXiE05YLEUhJhoJ/ey9gTIfEDmERJhM57MAK7uRQlmoIqkS/0/IOCUXbUBn9LotlGIjQu0vAVfoMWQyzt0B7niHoXfglBhAZg7tPxGgre4ZyH0/Av/EzTOWwEJ0LhSpTNBHw+h81lJ0Iy+xVSz0JE7ma7iuKPwi28Okd5WIQtvQXpYO6i+HXOOC9BC9tJfZnhDgjMHksP3JbjUE+il8ojuAu34QAUfMJpiMh/ghQ+UpiDf2AETlGDWyLyneoqbIU1huygozQ7EQrHJO7AKmz45Cb2NizBiZSyceKWD1ewVggT4ywiMtHOjm9KoG1O5KVuzPlJEZ46kRvUtZTIkm5q5WuRx6r5wPrsBlgvTy1yXbVqwZDmFX8SAuVoEZVOurNVFS1yjYarcBzq+/GMM8kb+oJaCVpkh6q9YParfY8vGOQY9t+H/e3VR5a6CSI8bSRkjdkXn7y8sfaS/pS8tkGEp72VAoMXxPd20tt1byMTRMg+hw4ItjmnWBrerbyk9uexjyFgwufATsJx/HCHtzdonIG/fOyM3ckH52UWRPUVeErrMAw4BQAA//8vRpiEAAAABklEQVQDAIqrYVGBIbQ0AAAAAElFTkSuQmCC';
const SOLDIER_IMAGE_COMMITTED_DAMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABEAAAAgCAYAAAD0S5PyAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABO0lEQVRIia3VMUvDQBTA8T9OLuJa6eSnEJFCl07ODuLkNxDcRKSrvEF0URCh30ChCA4uDk4FQXASRbs4uAgOrieFF3mWvNxdmuGR3L3cL3dJXg4BnBgJhIr8X3iJE3M+rIt8TrVvc5ELXYaNr1xkVIJkL6cjcGiAS4EFgX4q8iBwZYCBwI9AV2Bf4DiGhMSY95BWBoKHPDWBhMTY85CVDKRnBi/WmcmRwJLAtuk7FfhIQc50tgdOvl0gkrGkMP2QC2RO4Dlh0Evdj+1Nj+PYK055uDcKzfzZk4usN4EwK/JYF1k1F987eBTZcAYEE2tNICGG7GiBDfWPX/R3zXkvhmw6d3zX9q5WcCVip/7t9L/GkK2KdV9rf+lOaBt255vsMzY32VaLIixFzhPegC2BO/1B/UNSC83ml23uF/evF2kUzHpAAAAAAElFTkSuQmCC';
const SOLDIER_IMAGE_FRESH_DAMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABEAAAAgCAYAAAD0S5PyAAACXklEQVR4AYxVPWgUURD+ZtNooWIhiAYVxEoQJByKgqCFaSK2goWcCjkbCwNaKBKxEwsVJAaJP1jYCv5UgggWSsBCBAsRRTBopaCFhHCT773beft29+1ejpl8M9/MfHnv7b67DA0fvYN5ujaUS3RShMO3pIcOXRg/LU0kkqQIFMesl0JHKPTS8hTWRHQWcxBs4KCac3CM3mg1Ea5iV7Wbq1lf5eK8LtLHOa7kWtT0ROewRmcwjYZPSYTLf48MU1zNed+veEgcxyLGIFii0E3mNQsiFHCPczc7jtIHJjjBYDUFXhGvEs/qfaxiXDIvorexscS2JNLF/2rZi2AErY+wOlTNByLAzmohmQsupviM78WeVCHJKeaN59w6izOZxDtLhuANHuxHPoAuXaH4Q5yhL9h2mucFsxzey4bfHFwg3qOb9ch1TOS6sTVUTLLxLfkr9JLxTRY5gx8DkZ+4wOpn+jD74gd7EIfW7EVkGn0SO+gp+5aT34nb6TXzIjW2TGzL009EJ0Qo20pEbGKcW9hqSYzNIoKJuLEtbhTh+/O8bTCupUUEH+KmYXEssi809/HPxTwDcTjMCxHBaGgWFIKBBPiltD9KQ1iIBKolELxJVWORzRBsYtMzYnE/FAfdtpyzdphes0JE8Yt3xF2wCeLJ0JnhAW+q8upPkRul1yyI8D89jqp/LeajHryxCndJLxkfYxDhoR23AgXXWpzjixy/5liCIIIMh6zifmcs9qjoeASSlzTjCu66PcfnIKcQtuOHM3Q9AlvY+5p+Oc89ZBCc9lHLH55LfAUOYASP4vZlAAAA///SowAJAAAABklEQVQDAFITkax+POX2AAAAAElFTkSuQmCC';
const SOLDIER_IMAGE_RESTORED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABEAAAAgCAYAAAD0S5PyAAACl0lEQVR4AYxVPWgUQRT+3uwpMTkVi4CoqCBWgiDhUBQELUyjpDsjFnIiaGVhQAtFInZioTYi4h8Wca9S/KkEESyUgIUIKUQUwYAIKt4mCN7uy9ufmf2b3WSYmffe97759t7Mzp5CRXO63rTjelyRzsFWEcedu+G3my3/cJNE7GluhSWwigA8rrkidkiEXurYZksijuvdEeKwWNYDjBHBKntJBITtRbaUtaaIZeOSCPnBGQKupCR+jCc/Vzbc3mSK5b2ciOp679mhCQbOJrQHAI025gdGAqh+w/Wuw9KMSFg/MXaAaSzDOyb+Clb0isCXGTiNezwgWK7HIl1vbQ6tCzr0r5iORGSqPcLiomIs6wFibMMSGoPO22hq2dT8TlvChiniaYN3f63Wvvp/ZPCdDuqsHPu1vkMfnUdeJzwEh5f/cdzeTfFno3LqFssVuKUCtSsg+u30eRaEuymfTvmkWpGIPOVqmih6dDJQwVtivlTMyJtMaA9+j0T6M0PnZHM/FUnlmD6HC/XQ+UgEkxQwYSvs7WsCf5PStiR+zsQiOagUbE6QGbEiJHOhL0VELxmVMjbpIGurRYgOZol1fqWI3x56Xrcwm7OKyCZ/yJIW840IkdqtyQTyQl/2gEK72DAiHPgbDJnZCBpMnIb7d4+YUjcipYwFYKg3FhhGRK75er9B60B4JkRzP+Q13BeWFQ4iHJBcqRsRIfyILhgjPNrjmslE9+WmsnK9CQ6Qloy0GRF50lQKo6d9f7wZvbGyw3JJ+YLGs9aIyHfiqE6I4CrtJ/ZFZBV9iWxhMiKyF/tNTv5njB87rciw/ZIq+TrdDmsWktkHjA2bcgQHiDqI20bhvlbduYtxGM/yS+hE7FbPhSuwN4B6mGUvAAAA//9j1lhdAAAABklEQVQDAJshxPtgVRjCAAAAAElFTkSuQmCC';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

export class UnitSvgInfantryService extends UnitSvgService {
    private readonly originalSoldierImages = new WeakMap<Element, string>();
    private get infantryRules(): InfantryRules { return this.unit.rules as InfantryRules; }
    // BattleArmor-specific SVG handling logic goes here

    protected override updateAllDisplays() {
        if (!this.unit.svg()) return;
        // Read all reactive state properties to ensure they are tracked by the effect.
        const crew = this.unit.getCrewMembers();
        const locations = this.unit.getLocations();
        this.unit.phaseTrigger(); // Ensure phase changes trigger update

        // Update all displays
        this.updateBVDisplay();
        this.updateCrewDisplay(crew);
        this.updateTroopsDisplay();
        this.updateAmmoProfile();
        this.updateInventory();
        this.updateTurnState();
    }

    protected override updateArmorDisplay(initial: boolean = false) {
        const svg = this.unit.svg();
        if (!svg) return;

        const armorPips = Array.from(svg.querySelectorAll('.armor.pip')).reverse();
        const locations = this.unit.getLocations();
        const locInfo: Record<string, { committed: number; total: number; idx: number }> = {};
        armorPips.forEach(pip => {
            const loc = pip.getAttribute('loc');
            if (!loc) return;
            if (!locInfo[loc]) {
                const d = locations[loc];
                locInfo[loc] = { committed: d?.armor ?? 0, total: (d?.armor ?? 0) + (d?.pendingArmor ?? 0), idx: 0 };
            }
            const s = locInfo[loc];
            this.updatePip(pip, ++s.idx, s.committed, s.total, initial);
        });

        this.unit.locations?.armor.forEach(entry => {
            let el = svg.querySelector(`.unitLocation.armor[loc="${entry.loc}"]`);
            if (!el) return;
            if (this.unit.isArmorLocDestroyed(entry.loc, entry.rear)) {
                el.classList.add('damaged');
            } else {
                el.classList.remove('damaged');
            }
        });
    }

    protected updateTroopsDisplay() {
        const svg = this.unit.svg();
        if (!svg) return;

        const hasTroops = svg.getElementById('soldier_1');
        if (!hasTroops) return;
        const totalTroops = this.unit.locations?.internal.get('TROOP')!.points || 0;
        const troopData = this.unit.getLocations()['TROOP'];
        const committed = troopData?.internal ?? 0;
        const total = committed + (troopData?.pendingInternal ?? 0);
        for (let i = 1; i <= totalTroops; i++) {
            const soldierEl = svg.getElementById(`soldier_${i}`);
            if (!soldierEl) continue;
            // Soldiers are numbered 1..N where 1 is the first alive, so damage counts from the end
            const idx = totalTroops - i + 1; // reverse: soldier_1 = last to be hit
            const shouldDamage = idx <= total;
            const shouldPending = (idx > committed && idx <= total) || (idx > total && idx <= committed);
            const wasDamaged = soldierEl.classList.contains('damaged');
            if (wasDamaged !== shouldDamage) {
                soldierEl.classList.toggle('damaged', shouldDamage);
                soldierEl.classList.add('fresh');
            } else {
                soldierEl.classList.remove('fresh');
            }
            const damageEl = svg.getElementById(`damage_${i}`);
            damageEl?.classList.toggle('disabled-text', idx <= committed);
            soldierEl.classList.toggle('pending', shouldPending);
            this.updateSoldierImage(soldierEl, shouldDamage, shouldPending);
        }
    }

    private updateSoldierImage(soldier: Element, damaged: boolean, pending: boolean): void {
        const original = this.originalSoldierImages.get(soldier) ??
            soldier.getAttribute('href') ?? soldier.getAttributeNS(XLINK_NAMESPACE, 'href');
        if (!original) return;
        this.originalSoldierImages.set(soldier, original);

        let source = original;
        if (soldier.classList.contains('fresh')) {
            source = damaged ? SOLDIER_IMAGE_FRESH_DAMAGE : SOLDIER_IMAGE_RESTORED;
        } else if (pending) {
            source = damaged ? SOLDIER_IMAGE_DAMAGED : SOLDIER_IMAGE_RESTORED;
        } else if (damaged) {
            source = SOLDIER_IMAGE_COMMITTED_DAMAGE;
        }

        soldier.classList.toggle('soldierTinted', source !== original);
        soldier.setAttribute('href', source);
        soldier.setAttributeNS(XLINK_NAMESPACE, 'xlink:href', source);
    }

    protected override updateInventory() {
        const svg = this.unit.svg();
        if (!svg) return;
        super.updateInventory();
        this.updateFieldGunDisplay();
        this.unit.getInventory().forEach(entry => {
            if (!entry.el?.getAttribute('SSW')) return;
            if (this.unit.getEquipmentStatus(entry) === 'destroyed') {
                entry.el.classList.add('damagedInventory');
                entry.el.classList.remove('interactive');
                entry.el.classList.remove('selected');
            } else {
                entry.el.classList.remove('damagedInventory');
                entry.el.classList.add('interactive');
            }
        });
    }

    private updateFieldGunDisplay(): void {
        const svg = this.unit.svg();
        if (!svg) return;

        const fieldGunComponent = this.unit.getUnit().comp.find(component => component.l === 'FGUN' && component.cw !== undefined);
        if (!fieldGunComponent) return;

        const qty = svg.getElementById('field_gun_qty');
        if (qty) {
            const functionalCount = this.infantryRules.getFieldGunFunctionalCount(fieldGunComponent);
            qty.textContent = functionalCount.toString();
            this.setFieldGunSummaryDamageColor(qty, functionalCount < Math.max(0, fieldGunComponent.q ?? 0));
        }

        const fieldGunEntry = this.unit.getInventory().find(entry => this.infantryRules.getFieldGunComponent(entry) === fieldGunComponent);
        const ammo = svg.getElementById('field_gun_ammo');
        if (fieldGunEntry && ammo) {
            const ammoSummary = getInventoryControlModeAmmoSummary(fieldGunEntry, this.unit.getEquipmentRegistry(), this.unit.getInventoryControlRules());
            const remainingAmmo = ammoSummary.tracksAmmo ? ammoSummary.remaining : 0;
            ammo.textContent = remainingAmmo.toString();
            this.setFieldGunSummaryDamageColor(ammo, ammoSummary.tracksAmmo && remainingAmmo < ammoSummary.total);
        }
    }

    private setFieldGunSummaryDamageColor(element: Element, damaged: boolean): void {
        const svgElement = element as SVGElement;
        if (damaged) {
            svgElement.style.setProperty('fill', 'var(--damage-color)');
        } else {
            svgElement.style.removeProperty('fill');
        }
    }
}
