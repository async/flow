export const FLOW_GRAPH_KIND: "@async/flow.graph";

export type FlowGraphOptions = {
  readonly name?: string;
};

export type FlowMermaidOptions = FlowGraphOptions & {
  readonly indent?: string;
};

export type FlowGraphTransition = {
  readonly event: string;
  readonly status: string;
  readonly conditional: boolean;
  readonly from?: unknown;
  readonly to?: unknown;
  readonly dynamic?: boolean;
  readonly reason?: string;
  readonly label?: string;
};

export type FlowGraphGuard = {
  readonly conditional: true;
  readonly reason?: string;
  readonly label?: string;
};

export type FlowGraphStatus = {
  readonly type: "status";
  readonly name: string;
  readonly current?: unknown;
  readonly initial?: unknown;
  readonly states: unknown[];
  readonly transitions: FlowGraphTransition[];
};

export type FlowGraphEvent = {
  readonly type: "handler" | "transition" | "guard" | "guarded-transition";
  readonly name: string;
  readonly transitions: FlowGraphTransition[];
  readonly guards: FlowGraphGuard[];
};

export type FlowGraph = {
  readonly kind: typeof FLOW_GRAPH_KIND;
  readonly version: 1;
  readonly name?: string;
  readonly statuses: Record<string, FlowGraphStatus>;
  readonly events: Record<string, FlowGraphEvent>;
  readonly handlers: string[];
  readonly asyncSignals: Record<string, unknown>;
};

export function toGraph(targetOrInspection: unknown, options?: FlowGraphOptions): FlowGraph;
export function toMermaid(graph: FlowGraph, options?: FlowMermaidOptions): string;
