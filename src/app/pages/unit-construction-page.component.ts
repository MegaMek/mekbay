// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, Injector, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CONSTRUCTION_URL_SYNC } from '../app.routes';
import { DialogsService } from '../services/dialogs.service';
import { RoutedDialogPage } from './routed-dialog-page';
import type { UnitConstructionComponent } from '../construction/unit-construction.component';
import { CBTForceMember } from '../models/force-member.model';
import type { UnitSummary } from '../models/unit-summary.model';

@Component({ selector: 'unit-construction-page', template: '', changeDetection: ChangeDetectionStrategy.OnPush })
export class UnitConstructionPageComponent extends RoutedDialogPage {
    private readonly dialogs = inject(DialogsService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly injector = inject(Injector);
    private readonly loading = signal(true);
    private editor?: UnitConstructionComponent;

    canDeactivate(): Promise<boolean> | boolean {
        if (this.router.currentNavigation()?.extras.info === CONSTRUCTION_URL_SYNC) return true;
        return this.editor?.canLeave() ?? true;
    }

    protected override async openDialog() {
        const { UnitConstructionComponent } = await import('../construction/unit-construction.component');
        if (this.destroyRef.destroyed) return null;
        const ref = this.dialogs.createDialog(UnitConstructionComponent, {
            disableClose: true,
            closeOnNavigation: false,
        });
        this.editor = ref.componentInstance;
        // Angular reuses this page when only the UUID changes. The route guard
        // checks unsaved changes before the next resolved unit reaches the editor.
        this.route.data.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(data => {
            const unit = data['unit'] as UnitSummary | CBTForceMember | typeof CONSTRUCTION_URL_SYNC | undefined;
            if (unit === CONSTRUCTION_URL_SYNC) return;
            this.loading.set(true);
            const opening = unit instanceof CBTForceMember
                ? ref.componentInstance.openForceMember(unit)
                : unit ? ref.componentInstance.openUnit(unit) : ref.componentInstance.createNew();
            void opening.finally(() => this.loading.set(false));
        });
        effect(() => {
            if (this.loading() || ref.componentInstance.busy() || this.router.currentNavigation()) return;
            const uuid = ref.componentInstance.routeUuid();
            untracked(() => {
                const url = this.router.createUrlTree(uuid ? ['/meklab', uuid] : ['/meklab'], {
                    queryParamsHandling: 'preserve',
                    preserveFragment: true,
                });
                if (this.router.serializeUrl(url) !== this.router.url) {
                    void this.router.navigateByUrl(url, { replaceUrl: true, info: CONSTRUCTION_URL_SYNC });
                }
            });
        }, { injector: this.injector });
        return ref;
    }
}
