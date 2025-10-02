export interface IgnorePreset {
  id: string;
  name: string;
  patterns: string[];
}

export class PresetRegistry {
  private readonly presets = new Map<string, IgnorePreset>();

  register(preset: IgnorePreset): void {
    this.presets.set(preset.id, preset);
  }

  get(id: string): IgnorePreset | undefined {
    return this.presets.get(id);
  }

  list(): IgnorePreset[] {
    return [...this.presets.values()];
  }
}
