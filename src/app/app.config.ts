// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { type ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection, ErrorHandler, provideAppInitializer, inject, isDevMode } from '@angular/core';
import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { LoggerService } from './services/logger.service';
import { EquipmentInteractionRegistryService } from './services/equipment-interaction-registry.service';
import { WakeLockService } from './services/wake-lock.service';
import { registerAllHandlers } from './equipment-handlers';


export const appConfig: ApplicationConfig = {
    providers: [
        provideZonelessChangeDetection(),
        {
            provide: ErrorHandler,
            useExisting: LoggerService,
        },
        provideBrowserGlobalErrorListeners(),
        provideRouter(routes),
        provideHttpClient(),
        provideAppInitializer(() => {
            const registryService = inject(EquipmentInteractionRegistryService);
            registerAllHandlers(registryService);
        }),
        provideAppInitializer(() => {
            inject(WakeLockService);
        }),
        provideServiceWorker('ngsw-worker.js', {
            enabled: !isDevMode(),
            registrationStrategy: 'registerWhenStable:30000',
        }),
        { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
    ]
};