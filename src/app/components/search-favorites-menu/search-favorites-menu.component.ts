import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';

export interface SerializedFavorite {
    name: string;
    q?: string;
    sort?: string;
    sortDir?: 'asc' | 'desc';
    filters?: Record<string, any>;
    gunnery?: number;
    piloting?: number;
}

@Component({
    selector: 'search-favorites-menu',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div class="favorites-menu framed-borders">
        <div class="favorites-list">
            @let favorites = this.favorites();
            @if (!favorites || favorites.length === 0) {
                <div class="no-favorites">No saved searches</div>
            } @else {
                @for (f of favorites; let i = $index; track i) {
                    <div *ngIf="f" class="favorite-item"
                         (click)="selectFavorite(f)" style="padding:8px; cursor:pointer; border-radius:4px;">
                        {{ f.name }}
                    </div>
                }
            }
        </div>
        <div class="favorites-actions">
            <button type="button" class="bt-button" (click)="onSave()">SAVE SEARCH</button>
        </div>
    </div>
    `,
    styles: [`
        .favorites-menu {
            width: 300px;
            max-height: 500px;
            min-height: 200px;
            background-color: var(--background-color-menu);
            display: flex;
            flex-direction: column;
        }
        .favorites-list {
            max-height: 320px;
            overflow: auto;
            display: flex;
            flex-direction: column;
            flex-grow: 1;
        }
        .favorite-item {
            border-bottom: 1px solid var(--border-color);
        }
        .favorite-item:hover {
            background-color: var(--button-hover-bg);
        }
        .no-favorites {
            font-size: 0.9em;
            color: var(--text-color-tertiary);
            display: flex;
            justify-content: center;
            align-items: center;
            flex-grow: 1;
        }
        .favorites-actions {
            padding: 8px;
            border-top: 1px solid var(--border-color);
            display: flex;
            justify-content: center;
            align-items: center;
        }
    `]
})
export class SearchFavoritesMenuComponent {
    favorites = input<SerializedFavorite[]>([]);
    select = output<SerializedFavorite>();
    saveRequest = output<void>();

    selectFavorite(favorite: SerializedFavorite) {
        this.select.emit(favorite);
    }

    onSave() {
        this.saveRequest.emit();
    }
}