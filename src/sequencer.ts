class Mutex {
  private queue = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class Sequencer {
  private current: number;
  private readonly mutex = new Mutex();

  constructor(initial = 0) {
    this.current = initial;
  }

  async next(): Promise<number> {
    return this.mutex.runExclusive(() => {
      this.current += 1;
      return this.current;
    });
  }

  getCurrent(): number {
    return this.current;
  }

  setCurrent(value: number): void {
    if (value > this.current) {
      this.current = value;
    }
  }
}
