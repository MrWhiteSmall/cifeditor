type SyncOptions = {
  current: () => { sessionId: string; revision: number } | null;
  enabled: () => boolean;
  revision: (sessionId: string) => Promise<number>;
  refresh: (sessionId: string) => Promise<void>;
  status: (state: "synced" | "offline") => void;
};

/** Poll only revisions, then refresh through the same queue used by local edits. */
export class SharedSessionSync {
  private busy = false;
  private readonly options: SyncOptions;

  constructor(options: SyncOptions) { this.options = options; }

  async check(): Promise<void> {
    if (this.busy || !this.options.enabled()) return;
    const current = this.options.current();
    if (!current) return;
    this.busy = true;
    try {
      const revision = await this.options.revision(current.sessionId);
      const latest = this.options.current();
      if (latest?.sessionId !== current.sessionId || !this.options.enabled()) return;
      if (revision !== latest.revision) await this.options.refresh(current.sessionId);
      this.options.status("synced");
    } catch {
      if (this.options.current()?.sessionId === current.sessionId) this.options.status("offline");
    } finally {
      this.busy = false;
    }
  }
}
