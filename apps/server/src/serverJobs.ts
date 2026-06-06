export type ServerJobKind = 'youtube-metadata' | 'youtube-audio' | 'clip-render' | 'silence-render' | 'silence-map';

export class ServerJobLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxJobs: number) {}

  run<T>(_kind: ServerJobKind, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active += 1;
        void task()
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            this.drain();
          });
      };

      this.queue.push(start);
      this.drain();
    });
  }

  activeCount(): number {
    return this.active;
  }

  queuedCount(): number {
    return this.queue.length;
  }

  private drain(): void {
    while (this.active < this.maxJobs) {
      const next = this.queue.shift();
      if (!next) return;
      next();
    }
  }
}

export function readServerMaxJobs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SERVER_MAX_JOBS?.trim();
  if (!raw) return 1;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 32) return parsed;
  console.warn(`SERVER_MAX_JOBS must be an integer between 1 and 32; using default 1.`);
  return 1;
}

export const serverJobLimiter = new ServerJobLimiter(readServerMaxJobs());
