export declare const SIGNAL: unique symbol;
export declare const STATUS: unique symbol;
export declare const COMPUTED: unique symbol;
export declare const RESOURCE: unique symbol;
export declare const RESOURCE_IMMEDIATE: unique symbol;

export type FlowSignalDefinition<T = unknown> = {
  readonly kind: "async.flow.signal";
  readonly initial: T;
};

export type FlowStatusDefinition<T = unknown> = {
  readonly kind: "async.flow.status";
  readonly initial: T;
  readonly allowed?: readonly T[];
};

export type FlowComputedDefinition<T = unknown> = {
  readonly kind: "async.flow.computed";
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
  readonly [RESOURCE]: true;
  readonly [RESOURCE_IMMEDIATE]?: true;
  readonly kind: "async.flow.asyncSignal";
  readonly options: FlowAsyncSignalOptions;
  readonly loader: (
    this: FlowAsyncSignalReceiver,
    ...args: Input[]
  ) => T | PromiseLike<T>;
};

export type FlowResourceOptions = FlowAsyncSignalOptions;
export type FlowResourceDefinition<T = unknown, Input = unknown> = FlowAsyncSignalDefinition<T, Input>;

export type FlowDefinitionContext = {
  describe?(): {
    statuses?: readonly string[];
    transitions?: Record<string, unknown>;
    handlers?: readonly string[];
  };
};

export type FlowComputedReceiver = {
  readonly store?: Record<string, unknown>;
  readonly refs?: Record<string, unknown>;
  readonly name?: string;
};

export type FlowAsyncSignalReceiver = {
  readonly store?: Record<string, unknown>;
  readonly refs?: Record<string, unknown>;
  readonly resources?: Record<string, unknown>;
  readonly name?: string;
  readonly signal: AbortSignal;
  readonly version: number;
  readonly args: readonly unknown[];
};

export type FlowDefinition = {
  readonly kind: "async.flow.definition";
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
export const defineResource: typeof defineAsyncSignal;
export function defineFlow(config: {
  store?: Record<string, unknown>;
  on?: Record<string, Function>;
}): FlowDefinition;
export function isFlowDefinition(value: unknown): value is FlowDefinition;
export function isSignalDefinition(value: unknown): value is FlowSignalDefinition;
export function isStatusDefinition(value: unknown): value is FlowStatusDefinition;
export function isComputedDefinition(value: unknown): value is FlowComputedDefinition;
export function isAsyncSignalDefinition(value: unknown): value is FlowAsyncSignalDefinition;
export function isResourceDefinition(value: unknown): value is FlowResourceDefinition;
export function isAsyncSignal(value: unknown): boolean;
export function isResource(value: unknown): boolean;
export function isImmediateResource(value: unknown): boolean;
export const flow: typeof defineFlow;
export const signal: typeof defineSignal;
export const computed: typeof defineComputed;
export const status: typeof defineStatus;
export const asyncSignal: typeof defineAsyncSignal;
export const resource: typeof defineResource;
