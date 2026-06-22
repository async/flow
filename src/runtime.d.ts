export type FlowScheduler = {
  batch<T>(fn: () => T): T;
  enqueue?(fn: () => void): void;
  flush?(): Promise<void>;
};

export type Signal<T = unknown> = {
  readonly kind: "signal";
  value: T;
  get(): T;
  set(next: T): T;
  update(fn: (current: T) => T): T;
  subscribe(fn: (value: T) => void): () => void;
  snapshot(): T;
};

export type Computed<T = unknown> = {
  readonly kind: "computed";
  readonly value: T;
  get(): T;
  subscribe(fn: (value: T) => void): () => void;
  snapshot(): T;
};

export type SignalLike<T = unknown> = Signal<T> | Computed<T>;

export type FlowChange = {
  name?: string;
  input?: unknown;
  signals: Record<string, unknown>;
};

export type FlowHandlerContext<Input = unknown> = {
  flow: FlowInstance;
  signals: Record<string, unknown>;
  refs: Record<string, SignalLike>;
  input: Input;
};

export type FlowHandler<Input = unknown, Result = unknown> = (
  context: FlowHandlerContext<Input>
) => Result | PromiseLike<Result>;

export type FlowInstance = {
  readonly signals: Record<string, unknown>;
  readonly refs: Record<string, SignalLike>;
  readonly handlers: Record<string, FlowHandler>;
  get(name: string): unknown;
  set(name: string, value: unknown): unknown;
  update(name: string, fn: (value: unknown) => unknown): unknown;
  subscribe(name: string, fn: (value: unknown) => void): () => void;
  subscribe(fn: (change: FlowChange) => void): () => void;
  run(name: string, input?: unknown): unknown | PromiseLike<unknown>;
  snapshot(): Record<string, unknown>;
  restore(snapshot: Record<string, unknown>): void;
  destroy(): void;
};

export function createSignal<T>(initial: T, options?: { scheduler?: FlowScheduler }): Signal<T>;
export function createComputed<T>(compute: () => T, options?: { scheduler?: FlowScheduler }): Computed<T>;
export function createAsyncSignal<T>(
  loader: (context?: unknown) => T | PromiseLike<T>,
  options?: { scheduler?: FlowScheduler; initial?: T }
): {
  kind: "asyncSignal";
  refs: {
    value: Signal<T | undefined>;
    loading: Signal<boolean>;
    error: Signal<unknown>;
    ready: Signal<boolean>;
  };
  refresh(context?: unknown): T | Promise<T>;
};
export function createFlow(definitionOrConfig: unknown, options?: { scheduler?: FlowScheduler }): FlowInstance;
export function isPromiseLike(value: unknown): value is PromiseLike<unknown>;
