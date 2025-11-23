import { Component, ChangeDetectionStrategy, inject, input, signal, effect, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ImageStorageService } from '../../services/image-storage.service';
import { Unit } from '../../models/units.model';

@Component({
  selector: 'unit-icon',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <img [src]="currentSrc()" 
         [alt]="displayAlt()" 
         [title]="displayTitle()"
         [class]="styleClass()"
         (error)="onError()"
         draggable="false">
  `,
  styles: [`
    img { max-height: 100%; max-width: 100%; object-fit: contain; }
  `]
})
export class UnitIconComponent {
  private imageService = inject(ImageStorageService);
  private isLoading = toSignal(this.imageService.loading$, { initialValue: false });
  
  // Primary Input
  unit = input<Unit | undefined | null>(null);
  alt = input<string | undefined>(undefined);
  title = input<string | undefined>(undefined);
  styleClass = input<string>('');

  private readonly FALLBACK = '/images/unknown.png';
  
  currentSrc = signal<string>(this.FALLBACK);

  displayAlt = computed(() => {
    if (this.alt()) return this.alt();
    const u = this.unit();
    return u ? `${u.chassis || ''} ${u.model || ''}`.trim() : '';
  });

  displayTitle = computed(() => {
    if (this.title()) return this.title();
    const u = this.unit();
    return u ? `${u.chassis || ''} ${u.model || ''}`.trim() : '';
  });

  constructor() {
    effect(() => {
      const u = this.unit();
      const path = u?.icon;
      const loading = this.isLoading();
      
      // If the service is currently hydrating the DB, we wait.
      // The effect will automatically re-run when loading becomes false.
      if (loading) {
        return;
      }
      
      if (!path) {
        this.currentSrc.set(this.FALLBACK);
        return;
      }

      this.imageService.getImage(path).then(url => {
        this.currentSrc.set(url || this.FALLBACK);
      }).catch(() => {
        this.currentSrc.set(this.FALLBACK);
      });
    });
  }

  onError() {
    if (this.currentSrc() !== this.FALLBACK) {
      this.currentSrc.set(this.FALLBACK);
    }
  }
}