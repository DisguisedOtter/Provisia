import type { ModuleByKind, ModuleKind } from './types.js';

export class ModuleNotFoundError extends Error {
  constructor(
    public readonly kind: ModuleKind,
    public readonly id: string,
  ) {
    super(`${kind} module "${id}" is not registered`);
    this.name = 'ModuleNotFoundError';
  }
}

/** Holds every installed module per kind. One instance per process, filled at boot by `loadModules()`. */
export class ModuleRegistry {
  private readonly modules: { [K in ModuleKind]: Map<string, ModuleByKind[K]> } = {
    gateway: new Map(),
    registrar: new Map(),
    provisioner: new Map(),
  };

  register<K extends ModuleKind>(kind: K, module: ModuleByKind[K]): this {
    if (this.modules[kind].has(module.id)) {
      throw new Error(`${kind} module "${module.id}" is already registered`);
    }
    this.modules[kind].set(module.id, module);
    return this;
  }

  has(kind: ModuleKind, id: string): boolean {
    return this.modules[kind].has(id);
  }

  /** Throws `ModuleNotFoundError` when missing. */
  get<K extends ModuleKind>(kind: K, id: string): ModuleByKind[K] {
    const mod = this.modules[kind].get(id);
    if (!mod) throw new ModuleNotFoundError(kind, id);
    return mod;
  }

  find<K extends ModuleKind>(kind: K, id: string): ModuleByKind[K] | undefined {
    return this.modules[kind].get(id);
  }

  list<K extends ModuleKind>(kind: K): ModuleByKind[K][] {
    return [...this.modules[kind].values()];
  }

  /** Lightweight listing for the admin UI. */
  describe(): Array<{ kind: ModuleKind; id: string; name: string; version: string }> {
    const out: Array<{ kind: ModuleKind; id: string; name: string; version: string }> = [];
    for (const kind of Object.keys(this.modules) as ModuleKind[]) {
      for (const m of this.modules[kind].values()) {
        out.push({ kind, id: m.id, name: m.name, version: m.version });
      }
    }
    return out;
  }
}
