export type MaybePromise<T> = T | PromiseLike<T>;
export type Step<TContext, TResult = unknown> = (
  context: TContext
) => MaybePromise<TResult | void>;
export type Runner<TContext, TResult = unknown> = (
  context: TContext
) => MaybePromise<TResult | void>;

export function run<TContext, TResult = unknown>(
  step: Step<TContext, TResult>
): Runner<TContext, TResult>;
export function run<TContext, TResult = unknown>(
  steps: Step<TContext, TResult>[]
): Runner<TContext, TResult>;
export function isPromiseLike(value: unknown): value is PromiseLike<unknown>;
