// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { runServiceWorkerUpdateBootstrap } from './app/utils/service-worker-update-bootstrap.util';


runServiceWorkerUpdateBootstrap()
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => console.error(err));
