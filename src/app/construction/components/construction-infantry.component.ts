// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InfantryEntity } from '../../models/entity/entities/infantry/infantry-entity';
import { INFANTRY_SPECIALIZATION_TO_BIT, PREDEFINED_INFANTRY_MOUNTS, type InfantryMount, type InfantrySpecialization } from '../../models/entity/types/infantry';

// MegaMek PilotOptions.MD_ADVANTAGES and ProstheticEnhancementType option IDs.
const AUGMENTATIONS = [
    ['artificial_pain_shunt', 'Artificial pain shunt'], ['comm_implant', 'Communications implant'],
    ['boost_comm_implant', 'Boosted communications implant'], ['cyber_imp_audio', 'Enhanced audio'],
    ['cyber_imp_visual', 'Enhanced vision'], ['cyber_imp_laser', 'Laser eye implant'], ['cyber_imp_tele', 'Telescopic vision'],
    ['mm_implants', 'Multi-modal implants'], ['enh_mm_implants', 'Enhanced multi-modal implants'],
    ['filtration_implants', 'Filtration implants'], ['gas_effuser_pheromone', 'Pheromone gas effuser'],
    ['gas_effuser_toxin', 'Toxin gas effuser'], ['dermal_armor', 'Dermal armor'], ['dermal_camo_armor', 'Dermal camouflage armor'],
    ['tsm_implant', 'TSM implant'], ['triple_core_processor', 'Triple-core processor'], ['vdni', 'VDNI'], ['bvdni', 'Buffered VDNI'],
    ['proto_dni', 'ProtoMek DNI'], ['pl_enhanced', 'Enhanced prosthetic limbs'], ['pl_ienhanced', 'Improved enhanced limbs'],
    ['pl_extra_limbs', 'Extraneous limbs'], ['pl_tail', 'Prosthetic tail'], ['pl_masc', 'Prosthetic MASC'],
    ['pl_glider', 'Glider wings'], ['pl_flight', 'Powered flight wings'], ['suicide_implants', 'Suicide implants'],
] as const;
const PROSTHETICS = ['', 'LASER', 'BALLISTIC', 'NEEDLER', 'SHOTGUN', 'SONIC_STUNNER', 'SMG', 'BLADE', 'SHOCKER', 'VIBROBLADE', 'RUMAL_GARROTE', 'GRAPPLER', 'CLIMBING_CLAWS'] as const;
type MountNumberKey = 'weight' | 'movementPoints' | 'burstDamage' | 'vehicleDamage' | 'damageDivisor' | 'maxWaterDepth' | 'secondaryGroundMP' | 'uwEndurance';

@Component({
    selector: 'construction-infantry', imports: [FormsModule],
    templateUrl: './construction-infantry.component.html', styleUrl: './construction-infantry.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConstructionInfantryComponent {
    readonly entity = input.required<InfantryEntity>();
    readonly change = output<() => void>();
    readonly augmentations = AUGMENTATIONS;
    readonly specializations = (Object.keys(INFANTRY_SPECIALIZATION_TO_BIT) as InfantrySpecialization[])
        .map(value => ({ value, label: this.label(value) }));
    readonly prosthetics = PROSTHETICS.map(value => ({ value, label: value ? this.label(value) : 'None' }));
    readonly predefinedMounts = [...PREDEFINED_INFANTRY_MOUNTS.keys()];
    readonly mountChoice = computed(() => { const mount = this.entity().mount(); return mount?.custom ? 'custom' : mount?.name ?? ''; });
    readonly limbSlots = computed(() => [
        { id: '1', enhancement: this.entity().prostheticEnhancement1, count: this.entity().prostheticEnhancement1Count, pair: this.entity().extraneousPair1 },
        { id: '2', enhancement: this.entity().prostheticEnhancement2, count: this.entity().prostheticEnhancement2Count, pair: this.entity().extraneousPair2 },
    ]);
    readonly mountNumberFields: readonly { key: MountNumberKey; label: string; min: number; max: number; step: number }[] = [
        { key: 'weight', label: 'Mass per beast (t)', min: 0.001, max: Number.MAX_SAFE_INTEGER, step: 0.001 },
        { key: 'movementPoints', label: 'Primary movement points', min: 1, max: 10_000, step: 1 },
        { key: 'secondaryGroundMP', label: 'Secondary ground MP', min: 0, max: 10_000, step: 1 },
        { key: 'burstDamage', label: 'Burst damage dice', min: 0, max: 10_000, step: 1 },
        { key: 'vehicleDamage', label: 'Damage against vehicles', min: 0, max: 10_000, step: 1 },
        { key: 'damageDivisor', label: 'Damage divisor', min: 1, max: 10_000, step: 0.5 },
        { key: 'maxWaterDepth', label: 'Maximum water depth (−1 unlimited)', min: -1, max: 10_000, step: 1 },
        { key: 'uwEndurance', label: 'Underwater endurance (turns)', min: 0, max: 10_000, step: 1 },
    ];

    private label(value: string): string {
        if (value === 'xct') return 'Xenoplanetary condition training';
        return value.toLowerCase().replace(/[_-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
    }

    setSpecialization(specialization: InfantrySpecialization, selected: boolean): void {
        this.change.emit(() => this.entity().specializations.update(current => {
            const next = new Set(current);
            if (selected) next.add(specialization); else next.delete(specialization);
            return next;
        }));
    }

    setAugmentation(key: string, selected: boolean): void {
        this.change.emit(() => this.entity().augmentations.update(current => selected
            ? [...new Set([...current, key])] : current.filter(value => value !== key)));
    }

    setLimbType(set: (value: string) => void, value: string): void {
        this.change.emit(() => {
            if (!PROSTHETICS.some(option => option === value)) throw new Error('Choose a prosthetic enhancement.');
            set(value);
        });
    }

    setLimbCount(set: (value: number) => void, value: number): void {
        this.change.emit(() => {
            if (!Number.isInteger(value) || value < 0 || value > 2) throw new Error('Prosthetic enhancement count must be 0, 1, or 2.');
            set(value);
        });
    }

    selectMount(choice: string): void {
        this.change.emit(() => {
            const infantry = this.entity();
            if (!choice) {
                infantry.mount.set(null);
                if (infantry.motiveType() === 'Beast') infantry.motiveType.set('Leg');
                return;
            }
            const current = choice === 'custom' ? infantry.mount() ?? PREDEFINED_INFANTRY_MOUNTS.get('Horse') : PREDEFINED_INFANTRY_MOUNTS.get(choice);
            if (!current) throw new Error('Choose a beast mount.');
            infantry.mount.set({ ...current, custom: choice === 'custom' });
            infantry.motiveType.set('Beast');
        });
    }

    setMountText(key: 'name' | 'size' | 'movementMode', value: string): void {
        this.change.emit(() => {
            const current = this.entity().mount();
            if (!current) return;
            if (key === 'name' && (!value.trim() || /[,:\r\n]/.test(value))) throw new Error('Beast name cannot be empty or contain commas, colons, or line breaks.');
            if (key === 'size' && !['Large', 'Very Large', 'Monstrous'].includes(value)) throw new Error('Choose a beast size.');
            if (key === 'movementMode' && !['Leg', 'VTOL', 'Submarine'].includes(value)) throw new Error('Choose a beast movement type.');
            this.entity().mount.set({ ...current, [key]: value, custom: true } as InfantryMount);
        });
    }

    setMountNumber(key: MountNumberKey, value: unknown): void {
        this.change.emit(() => {
            const current = this.entity().mount();
            const field = this.mountNumberFields.find(field => field.key === key)!;
            const number = Number(value);
            if (value === '' || value == null || !Number.isFinite(number) || number < field.min || number > field.max || (field.step === 1 && !Number.isInteger(number))) {
                throw new Error(`Enter a valid ${field.label.toLowerCase()} (${field.min}–${field.max}).`);
            }
            if (current) this.entity().mount.set({ ...current, [key]: number, custom: true });
        });
    }
}
