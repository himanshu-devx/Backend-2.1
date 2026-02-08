type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitOpenError extends Error {
  constructor(message = "Circuit breaker is open") {
    super(message);
    this.name = "CircuitOpenError";
  }
}

export type CircuitBreakerOptions = {
  failureThreshold: number;
  openMs: number;
};

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private nextAttemptAt = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  private open() {
    this.state = "OPEN";
    this.nextAttemptAt = Date.now() + this.options.openMs;
  }

  private close() {
    this.state = "CLOSED";
    this.failures = 0;
    this.nextAttemptAt = 0;
  }

  private halfOpen() {
    this.state = "HALF_OPEN";
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (this.state === "OPEN") {
      if (now < this.nextAttemptAt) {
        throw new CircuitOpenError();
      }
      this.halfOpen();
    }

    try {
      const result = await fn();
      this.close();
      return result;
    } catch (err) {
      this.failures += 1;
      if (this.failures >= this.options.failureThreshold) {
        this.open();
      }
      throw err;
    }
  }
}

const breakers = new Map<string, CircuitBreaker>();

export const CircuitBreakerRegistry = {
  get(key: string, options: CircuitBreakerOptions): CircuitBreaker {
    const existing = breakers.get(key);
    if (existing) return existing;
    const breaker = new CircuitBreaker(options);
    breakers.set(key, breaker);
    return breaker;
  },
};
