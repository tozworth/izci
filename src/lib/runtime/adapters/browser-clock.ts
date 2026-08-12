import type { ClockPort } from '../ports';

export type BrowserClockTarget = Pick<Window,
  | 'cancelAnimationFrame'
  | 'clearInterval'
  | 'clearTimeout'
  | 'requestAnimationFrame'
  | 'queueMicrotask'
  | 'setInterval'
  | 'setTimeout'
>;

export class BrowserClock implements ClockPort {
  constructor(
    private readonly target: BrowserClockTarget,
    private readonly readWallNow: () => number,
    private readonly readMonotonicNow: () => number
  ) {}

  wallNow(): number {
    return this.readWallNow();
  }

  monotonicNow(): number {
    return this.readMonotonicNow();
  }

  queueMicrotask(callback: () => void): void {
    this.target.queueMicrotask(callback);
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    return this.target.setTimeout(callback, delayMs);
  }

  clearTimeout(handle: unknown): void {
    this.target.clearTimeout(handle as number);
  }

  setInterval(callback: () => void, delayMs: number): unknown {
    return this.target.setInterval(callback, delayMs);
  }

  clearInterval(handle: unknown): void {
    this.target.clearInterval(handle as number);
  }

  requestAnimationFrame(callback: (time: number) => void): unknown {
    return this.target.requestAnimationFrame(callback);
  }

  cancelAnimationFrame(handle: unknown): void {
    this.target.cancelAnimationFrame(handle as number);
  }
}
