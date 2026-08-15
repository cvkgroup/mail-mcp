class Mutex {
    queue = Promise.resolve();
    async runExclusive(fn) {
        const previous = this.queue;
        let release;
        this.queue = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await fn();
        }
        finally {
            release();
        }
    }
}
export class Sequencer {
    current;
    mutex = new Mutex();
    constructor(initial = 0) {
        this.current = initial;
    }
    async next() {
        return this.mutex.runExclusive(() => {
            this.current += 1;
            return this.current;
        });
    }
    getCurrent() {
        return this.current;
    }
    setCurrent(value) {
        if (value > this.current) {
            this.current = value;
        }
    }
}
