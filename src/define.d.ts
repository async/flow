export declare const SIGNAL: unique symbol;
export declare const STATUS: unique symbol;
export declare const COMPUTED: unique symbol;
export declare const ASYNC_SIGNAL: unique symbol;
export declare const ASYNC_SIGNAL_IMMEDIATE: unique symbol;

export type FlowSignalDefinition<T = unknown> = {
  readonly type: "async.flow.signal";
  readonly initial: T;
};

export type FlowStatusDefinition<T = unknown> = Omit<FlowSignalDefinition<T>, "type"> & {
  readonly [STATUS]?: true;
  readonly type: "async.flow.status";
  readonly initial: T;
  readonly allowed?: readonly T[];
};

export type FlowComputedDefinition<T = unknown> = {
  readonly type: "async.flow.computed";
  readonly options: FlowComputedOptions;
  readonly compute: (this: FlowComputedReceiver, ...args: unknown[]) => T;
};

export type FlowComputedOptions = {
  readonly arguments?: readonly unknown[] | ((store: Record<string, unknown>) => readonly unknown[]);
} & Record<string, unknown>;

export type FlowAsyncSignalOptions = {
  readonly immediate?: boolean;
  readonly arguments?: readonly unknown[] | ((store: Record<string, unknown> | undefined) => readonly unknown[]);
} & Record<string, unknown>;

export type FlowAsyncSignalDefinition<T = unknown, Input = unknown> = {
  readonly [ASYNC_SIGNAL]: true;
  readonly [ASYNC_SIGNAL_IMMEDIATE]?: true;
  readonly type: "async.flow.asyncSignal";
  readonly options: FlowAsyncSignalOptions;
  readonly loader: (
    this: FlowAsyncSignalReceiver,
    ...args: Input[]
  ) => T | PromiseLike<T>;
};

export type FlowComputedReceiver = Record<string, unknown> & {
  readonly store?: Record<string, unknown>;
  readonly refs?: Record<string, unknown>;
  readonly name?: string;
};

export type FlowAsyncSignalReceiver = {
  readonly store?: Record<string, unknown>;
  readonly refs?: Record<string, unknown>;
  readonly asyncSignals?: Record<string, unknown>;
  readonly name?: string;
  readonly signal: AbortSignal;
  readonly version: number;
  readonly args: readonly unknown[];
};

export type FlowDefinition = {
  readonly type: "async.flow.definition";
  readonly store: Record<string, unknown>;
  readonly on: Record<string, Function>;
};

export function defineSignal<T>(initial: T): FlowSignalDefinition<T>;
export function defineStatus<T>(initial: T, allowed?: readonly T[]): FlowStatusDefinition<T>;
export function defineComputed<T>(
  compute: FlowComputedDefinition<T>["compute"]
): FlowComputedDefinition<T>;
export function defineComputed<T>(
  options: FlowComputedOptions,
  compute: FlowComputedDefinition<T>["compute"]
): FlowComputedDefinition<T>;
export function defineAsyncSignal<T = unknown, Input = unknown>(
  loader: FlowAsyncSignalDefinition<T, Input>["loader"]
): FlowAsyncSignalDefinition<T, Input>;
export function defineAsyncSignal<T = unknown, Input = unknown>(
  options: FlowAsyncSignalOptions,
  loader: FlowAsyncSignalDefinition<T, Input>["loader"]
): FlowAsyncSignalDefinition<T, Input>;
export function defineFlow(config: {
  store?: Record<string, unknown>;
  on?: Record<string, Function>;
}): FlowDefinition;
export function isFlowDefinition(value: unknown): value is FlowDefinition;
export function isSignalDefinition(value: unknown): value is FlowSignalDefinition;
export function isStatusDefinition(value: unknown): value is FlowStatusDefinition;
export function isComputedDefinition(value: unknown): value is FlowComputedDefinition;
export function isAsyncSignalDefinition(value: unknown): value is FlowAsyncSignalDefinition;
export function isAsyncSignal(value: unknown): boolean;
export function isImmediateAsyncSignal(value: unknown): boolean;
export const flow: typeof defineFlow;
export const signal: typeof defineSignal;
export const computed: typeof defineComputed;
export const asyncSignal: typeof defineAsyncSignal;
