// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { isIOS } from "./platform.util";


const DEFAULT_VIBRATION_DURATION = 10;

/**
 * Triggers a vibration effect on supported devices.
 * @param duration The duration of the vibration in milliseconds. Defaults to 10ms.
 * @returns void
 */
export function vibrate(duration?: number): void {
    if (typeof window === "undefined") return;
    if (!duration) {
        duration = DEFAULT_VIBRATION_DURATION;
    }
    if (navigator.vibrate) {
        navigator.vibrate(duration);
    } else if (isIOS()) {
        simulateiOSVibration();
    }
}

// Fallback function for iOS
function simulateiOSVibration(): void {
    const switchEl = getSwitchElement();
    if (!switchEl) return;
    switchEl.click();
}

let inputEl: HTMLInputElement | null = null;
let labelEl: HTMLLabelElement | null = null;
const HAPTIC_ELEMENT_ID = "___haptic_switch_element___";

function getSwitchElement(): HTMLLabelElement {
    if (labelEl) return labelEl;
    inputEl = document.createElement("input");
    inputEl.style.display = "none";
    inputEl.id = HAPTIC_ELEMENT_ID;
    inputEl.type = "checkbox";
    inputEl.setAttribute("switch", "");
    document.body.appendChild(inputEl);

    labelEl = document.createElement("label");
    labelEl.style.display = "none";
    labelEl.htmlFor = HAPTIC_ELEMENT_ID;
    document.body.appendChild(labelEl);
    return labelEl;
}