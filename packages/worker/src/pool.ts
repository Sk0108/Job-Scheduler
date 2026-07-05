/** Simple counting semaphore bounding how many jobs this process runs concurrently. */
export class Semaphore {
  private inUse = 0;
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(private readonly capacity: number) {}

  available(): number {
    return this.capacity - this.inUse;
  }

  activeCount(): number {
    return this.inUse;
  }

  /** Runs `task` under the semaphore, tracking it so `drain()` can await in-flight work during shutdown. */
  run(task: () => Promise<void>): void {
    this.inUse++;
    const promise = task().finally(() => {
      this.inUse--;
      this.inFlight.delete(promise);
    });
    this.inFlight.add(promise);
  }

  /** Waits for currently in-flight tasks to finish, up to `timeoutMs` — used for graceful shutdown. */
  async drain(timeoutMs: number): Promise<void> {
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    await Promise.race([Promise.allSettled(this.inFlight), timeout]);
  }
}
