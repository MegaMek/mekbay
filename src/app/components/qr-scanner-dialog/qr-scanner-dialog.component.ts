/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BarcodeFormat } from '@zxing/library';
import { ZXingScannerModule } from '@zxing/ngx-scanner';

/*
 * Author: Drake
 */

@Component({
    selector: 'qr-scanner-inline',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, ZXingScannerModule],
    template: `
        <div class="scanner-inline-shell">
            <div class="scanner-shell" [class.error-state]="!!scanError()">
                <zxing-scanner
                    class="scanner-view"
                    [autostart]="true"
                    [autofocusEnabled]="true"
                    [formats]="formats"
                    [device]="manualDevice() ?? undefined"
                    [videoConstraints]="videoConstraints"
                    (camerasFound)="onCamerasFound($event)"
                    (camerasNotFound)="onCamerasNotFound()"
                    (permissionResponse)="onPermissionResponse($event)"
                    (deviceChange)="onActiveDeviceChange($event)"
                    (scanSuccess)="onScanSuccess($event)"
                    (scanError)="onScanError($event)"
                ></zxing-scanner>
                <div class="scanner-frame"></div>
            </div>
            @if (devices().length > 1) {
                <div class="device-picker">
                    <label for="scanner-device">Camera</label>
                    <select id="scanner-device" class="field-input" [value]="selectedDeviceId()" (change)="onDeviceChange($event)">
                        @for (device of devices(); track device.deviceId) {
                            <option [value]="device.deviceId">{{ getDeviceLabel(device, $index) }}</option>
                        }
                    </select>
                </div>
            }
            @if (scanError()) {
                <p class="status error">{{ scanError() }}</p>
            } @else {
                <p class="status">{{ status() }}</p>
            }
        </div>
    `,
    styles: [`
        .scanner-inline-shell {
            display: flex;
            flex-direction: column;
            gap: 10px;
            width: 100%;
            max-width: 100%;
            min-width: 0;
            overflow-x: hidden;
        }

        .scanner-shell {
            position: relative;
            width: 100%;
            max-width: 100%;
            min-width: 0;
            aspect-ratio: 4 / 3;
            overflow: hidden;
            background:
                radial-gradient(circle at top, rgba(255, 255, 255, 0.06), transparent 55%),
                rgba(0, 0, 0, 0.55);
            border: 1px solid rgba(255, 255, 255, 0.12);
        }

        .scanner-view {
            display: block;
            width: 100%;
            height: 100%;
            max-width: 100%;
            min-width: 0;
        }

        .scanner-view ::ng-deep video {
            display: block;
            width: 100%;
            height: 100%;
            max-width: 100%;
            min-height: 0;
            max-height: none;
            object-fit: cover;
        }

        .scanner-frame {
            pointer-events: none;
            position: absolute;
            inset: 50% auto auto 50%;
            width: min(calc(100% - 24px), 240px);
            height: min(calc(100% - 24px), 240px);
            transform: translate(-50%, -50%);
            border: 2px solid rgba(255, 255, 255, 0.8);
            box-shadow: 0 0 0 200vmax rgba(0, 0, 0, 0.28);
            max-width: calc(100% - 24px);
            max-height: calc(100% - 24px);
        }

        .scanner-frame::before,
        .scanner-frame::after {
            content: '';
            position: absolute;
            inset: 0;
            border: 4px solid transparent;
        }

        .scanner-frame::before {
            border-top-color: var(--bt-yellow);
            border-left-color: var(--bt-yellow);
            width: 34px;
            height: 34px;
        }

        .scanner-frame::after {
            border-right-color: var(--bt-yellow);
            border-bottom-color: var(--bt-yellow);
            width: 34px;
            height: 34px;
            inset: auto 0 0 auto;
        }

        .status {
            margin: 0;
            font-size: 0.9em;
            color: var(--text-color-tertiary);
        }

        .status.error {
            color: rgb(var(--enemy-color));
        }

        .device-picker {
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-width: 0;
        }

        .device-picker label {
            font-size: 0.85em;
            color: var(--text-color-tertiary);
        }
    `]
})
export class QrScannerInlineComponent {
    onScan = input.required<(value: string) => void>();

    readonly formats = [BarcodeFormat.QR_CODE];
    readonly videoConstraints: MediaTrackConstraints = {
        facingMode: { ideal: 'environment' }
    };

    devices = signal<MediaDeviceInfo[]>([]);
    manualDevice = signal<MediaDeviceInfo | null>(null);
    selectedDeviceId = signal('');
    status = signal('Requesting camera access...');
    scanError = signal<string | null>(null);

    onCamerasFound(devices: MediaDeviceInfo[]): void {
        this.devices.set(devices);
        if (!devices.some(device => device.deviceId === this.selectedDeviceId())) {
            this.selectedDeviceId.set('');
        }
        this.status.set(devices.length > 1 ? 'Camera ready. You can switch cameras if needed.' : 'Camera ready. Align the QR code inside the frame.');
        this.scanError.set(null);
    }

    onCamerasNotFound(): void {
        this.devices.set([]);
        this.manualDevice.set(null);
        this.selectedDeviceId.set('');
        this.scanError.set('No camera was found on this device.');
    }

    onPermissionResponse(hasPermission: boolean): void {
        if (hasPermission) {
            this.status.set('Camera ready. Align the QR code inside the frame.');
            this.scanError.set(null);
            return;
        }

        this.scanError.set('Camera access was denied.');
    }

    onActiveDeviceChange(device: MediaDeviceInfo | null): void {
        if (!device) {
            this.selectedDeviceId.set('');
            return;
        }

        this.selectedDeviceId.set(device.deviceId);
        this.scanError.set(null);
    }

    onScanSuccess(value: string): void {
        const scannedValue = value.trim();
        if (!scannedValue) return;
        this.onScan()(scannedValue);
    }

    onScanError(error: Error): void {
        this.scanError.set(error.message || 'QR scanning failed.');
    }

    onDeviceChange(event: Event): void {
        const selectedId = (event.target as HTMLSelectElement).value;
        this.selectedDeviceId.set(selectedId);
        const device = this.devices().find(entry => entry.deviceId === selectedId) ?? null;
        this.manualDevice.set(device);
    }

    getDeviceLabel(device: MediaDeviceInfo, index: number): string {
        return device.label || `Camera ${index + 1}`;
    }

}