// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, input, signal, viewChild } from '@angular/core';
import { BrowserCodeReader, BrowserQRCodeReader, IScannerControls } from '@zxing/browser';
import { ChecksumException, Exception, FormatException, NotFoundException, Result } from '@zxing/library';

@Component({
    selector: 'qr-scanner-inline',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="scanner-inline-shell">
            <div class="scanner-shell" [class.error-state]="!!scanError()">
                <video
                    #videoElement
                    class="scanner-view"
                    autoplay
                    muted
                    playsinline
                    aria-label="QR code camera preview"
                ></video>
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

        .scanner-view {
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
export class QrScannerInlineComponent implements AfterViewInit, OnDestroy {
    onScan = input.required<(value: string) => void>();

    private readonly videoElement = viewChild.required<ElementRef<HTMLVideoElement>>('videoElement');
    private readonly reader = new BrowserQRCodeReader(undefined, {
        delayBetweenScanAttempts: 300,
        delayBetweenScanSuccess: 750
    });
    private scannerControls: IScannerControls | null = null;
    private startSequence = 0;
    private destroyed = false;
    devices = signal<MediaDeviceInfo[]>([]);
    selectedDeviceId = signal('');
    status = signal('Requesting camera access...');
    scanError = signal<string | null>(null);

    ngAfterViewInit(): void {
        void this.startScanner();
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.stopScanner();
    }

    private async startScanner(deviceId?: string): Promise<void> {
        this.stopReader();
        const sequence = ++this.startSequence;
        this.scanError.set(null);
        this.status.set('Requesting camera access...');

        try {
            const controls = await this.reader.decodeFromVideoDevice(
                deviceId || undefined,
                this.videoElement().nativeElement,
                (result, error) => this.onDecode(result, error)
            );

            if (this.destroyed || sequence !== this.startSequence) {
                controls.stop();
                return;
            }

            this.scannerControls = controls;
            await this.refreshDevices(sequence, deviceId);
            if (this.destroyed || sequence !== this.startSequence) return;

            this.status.set(this.devices().length > 1
                ? 'Camera ready. You can switch cameras if needed.'
                : 'Camera ready. Align the QR code inside the frame.');
        } catch (error) {
            if (this.destroyed || sequence !== this.startSequence) return;

            this.devices.set([]);
            this.selectedDeviceId.set('');
            this.scanError.set(this.describeCameraError(error));
        }
    }

    private async refreshDevices(sequence: number, requestedDeviceId?: string): Promise<void> {
        try {
            const devices = await BrowserCodeReader.listVideoInputDevices();
            if (this.destroyed || sequence !== this.startSequence) return;

            this.devices.set(devices);
            const activeDeviceId = this.getActiveDeviceId();
            if (activeDeviceId && devices.some(device => device.deviceId === activeDeviceId)) {
                this.selectedDeviceId.set(activeDeviceId);
            } else if (requestedDeviceId && devices.some(device => device.deviceId === requestedDeviceId)) {
                this.selectedDeviceId.set(requestedDeviceId);
            } else if (devices.length === 1) {
                this.selectedDeviceId.set(devices[0].deviceId);
            } else {
                this.selectedDeviceId.set('');
            }
        } catch {
            if (this.destroyed || sequence !== this.startSequence) return;

            this.devices.set([]);
            this.selectedDeviceId.set('');
        }
    }

    private getActiveDeviceId(): string | undefined {
        try {
            const stream = this.videoElement().nativeElement.srcObject as MediaStream | null;
            return stream?.getVideoTracks()[0]?.getSettings().deviceId;
        } catch {
            return undefined;
        }
    }

    onScanSuccess(value: string): void {
        const scannedValue = value.trim();
        if (!scannedValue) return;
        this.stopScanner();
        this.onScan()(scannedValue);
    }

    private onDecode(result: Result | undefined, error: Exception | undefined): void {
        if (result) {
            this.onScanSuccess(result.getText());
            return;
        }

        if (error && !this.isExpectedDecodeFailure(error)) {
            this.scanError.set(error.message || 'QR scanning failed.');
        }
    }

    onDeviceChange(event: Event): void {
        const selectedId = (event.target as HTMLSelectElement).value;
        this.selectedDeviceId.set(selectedId);
        void this.startScanner(selectedId);
    }

    getDeviceLabel(device: MediaDeviceInfo, index: number): string {
        return device.label || `Camera ${index + 1}`;
    }

    private isExpectedDecodeFailure(error: Exception): boolean {
        return error instanceof NotFoundException
            || error instanceof ChecksumException
            || error instanceof FormatException
            || ['NotFoundException', 'ChecksumException', 'FormatException'].includes(error.name);
    }

    private describeCameraError(error: unknown): string {
        const errorName = error instanceof Error ? error.name : '';
        switch (errorName) {
            case 'NotAllowedError':
                return 'Camera access was denied.';
            case 'NotFoundError':
                return 'No camera was found on this device.';
            case 'NotReadableError':
                return 'The camera is already in use by another application.';
            case 'OverconstrainedError':
                return 'The selected camera is no longer available.';
            case 'NotSupportedError':
            case 'SecurityError':
                return 'Camera access requires a secure connection.';
            default:
                return error instanceof Error && error.message
                    ? error.message
                    : 'QR scanner could not start.';
        }
    }

    private stopScanner(): void {
        this.startSequence += 1;
        this.stopReader();
    }

    private stopReader(): void {
        const controls = this.scannerControls;
        this.scannerControls = null;
        controls?.stop();

        const video = this.videoElement()?.nativeElement;
        if (!video) return;

        const stream = video.srcObject as MediaStream | null;
        stream?.getTracks().forEach(track => track.stop());
        video.pause();
        BrowserCodeReader.cleanVideoSource(video);
    }

}