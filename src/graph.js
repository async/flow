import { FLOW_GRAPH, FLOW_GRAPH_KIND, FLOW_INSPECT } from "./protocol.js";

export { FLOW_GRAPH, FLOW_GRAPH_KIND };

export function toGraph(targetOrInspection, options = {}) {
  assertOptions(options, "toGraph");

  if (isFlowGraph(targetOrInspection)) {
    return targetOrInspection;
  }

  const description = isFlowInspection(targetOrInspection)
    ? targetOrInspection
    : readFlowInspection(targetOrInspection);

  assertFlowInspection(description);

  const statuses = {};
  const events = {};
  const handlers = Array.isArray(description.handlers)
    ? [...description.handlers]
    : [];

  for (const [name, entry] of Object.entries(description.store ?? {})) {
    if (entry?.type !== "status") {
      continue;
    }

    statuses[name] = {
      type: "status",
      name,
      current: cloneGraphValue(entry.value),
      states: normalizeStates(entry.allowed, entry.value),
      transitions: []
    };
  }

  for (const name of handlers) {
    events[name] = {
      type: "handler",
      name,
      transitions: [],
      guards: []
    };
  }

  for (const [eventName, transition] of Object.entries(description.transitions ?? {})) {
    const event = ensureEvent(events, eventName);
    const statusName = transition.status;
    const status = ensureStatus(statuses, statusName);

    for (const rule of transition.rules ?? []) {
      const edge = {
        event: eventName,
        status: statusName,
        conditional: Boolean(rule.conditional),
        ...copyGraphMetadata(rule)
      };

      if (Object.hasOwn(rule, "from")) {
        edge.from = cloneGraphValue(rule.from);
        addStates(status.states, rule.from);
      }

      if (rule.dynamic === true) {
        edge.dynamic = true;
      } else if (Object.hasOwn(rule, "to")) {
        edge.to = cloneGraphValue(rule.to);
        addStates(status.states, rule.to);
      }

      event.transitions.push(edge);
      status.transitions.push(edge);
    }
  }

  for (const [eventName, guard] of Object.entries(description.guards ?? {})) {
    const event = ensureEvent(events, eventName);
    event.guards.push({
      conditional: true,
      ...copyGraphMetadata(guard)
    });
  }

  for (const event of Object.values(events)) {
    event.type = classifyEvent(event);
  }

  const graph = {
    kind: FLOW_GRAPH_KIND,
    version: 1,
    statuses,
    events,
    handlers,
    asyncSignals: cloneGraphValue(description.asyncSignals ?? {})
  };

  if (typeof options.name === "string" && options.name.length > 0) {
    graph.name = options.name;
  }

  return brandGraph(graph);
}

export function toMermaid(graph, options = {}) {
  assertOptions(options, "toMermaid");

  if (!isFlowGraph(graph)) {
    throw new TypeError("toMermaid(...) requires a Flow graph.");
  }

  const indent = typeof options.indent === "string" ? options.indent : "  ";
  const lines = ["stateDiagram-v2"];

  for (const status of Object.values(graph.statuses ?? {})) {
    lines.push(`${indent}state ${quoteMermaid(status.name)} as ${stateId(status.name)} {`);

    for (const value of status.states ?? []) {
      lines.push(`${indent}${indent}state ${quoteMermaid(formatValue(value))} as ${stateId(status.name, value)}`);
    }

    const initial = status.initial ?? status.current;
    if (initial !== undefined && hasState(status.states, initial)) {
      lines.push(`${indent}${indent}[*] --> ${stateId(status.name, initial)}`);
    }

    for (const edge of status.transitions ?? []) {
      if (edge.dynamic === true || edge.to === undefined) {
        lines.push(`${indent}${indent}%% ${edge.event} has a dynamic target`);
        continue;
      }

      const fromValues = edge.from === undefined
        ? status.states.filter((value) => !Object.is(value, edge.to))
        : normalizeValueList(edge.from);

      for (const from of fromValues) {
        if (!hasState(status.states, from)) {
          continue;
        }

        lines.push(
          `${indent}${indent}${stateId(status.name, from)} --> ${stateId(status.name, edge.to)}: ${formatEdgeLabel(edge)}`
        );
      }
    }

    lines.push(`${indent}}`);
  }

  return lines.join("\n");
}

function assertOptions(options, caller) {
  if (!isRecord(options)) {
    throw new TypeError(`${caller}(...) options must be an object.`);
  }
}

function assertFlowInspection(value) {
  if (!isFlowInspection(value)) {
    throw new TypeError("toGraph(...) requires a Flow instance or Flow inspection object.");
  }
}

function readFlowInspection(value) {
  const inspect = value?.[FLOW_INSPECT];
  return typeof inspect === "function" ? inspect.call(value) : undefined;
}

function isFlowGraph(value) {
  return Boolean(value?.[FLOW_GRAPH]) || value?.kind === FLOW_GRAPH_KIND;
}

function brandGraph(graph) {
  Object.defineProperty(graph, FLOW_GRAPH, {
    configurable: false,
    enumerable: false,
    value: true
  });
  return graph;
}

function isFlowInspection(value) {
  return isRecord(value) &&
    isRecord(value.store) &&
    Array.isArray(value.handlers) &&
    isRecord(value.transitions) &&
    isRecord(value.guards);
}

function ensureEvent(events, name) {
  if (!events[name]) {
    events[name] = {
      type: "handler",
      name,
      transitions: [],
      guards: []
    };
  }

  return events[name];
}

function ensureStatus(statuses, name) {
  if (!statuses[name]) {
    statuses[name] = {
      type: "status",
      name,
      states: [],
      transitions: []
    };
  }

  return statuses[name];
}

function classifyEvent(event) {
  if (event.transitions.length > 0 && event.guards.length > 0) {
    return "guarded-transition";
  }

  if (event.transitions.length > 0) {
    return "transition";
  }

  if (event.guards.length > 0) {
    return "guard";
  }

  return "handler";
}

function normalizeStates(allowed, current) {
  const states = [];

  if (Array.isArray(allowed)) {
    addStates(states, allowed);
  }

  if (current !== undefined) {
    addStates(states, current);
  }

  return states;
}

function addStates(states, value) {
  for (const entry of normalizeValueList(value)) {
    if (!states.some((state) => Object.is(state, entry))) {
      states.push(cloneGraphValue(entry));
    }
  }
}

function normalizeValueList(value) {
  return Array.isArray(value) ? value : [value];
}

function hasState(states, value) {
  return Array.isArray(states) && states.some((state) => Object.is(state, value));
}

function copyGraphMetadata(source) {
  const metadata = {};

  if (typeof source?.reason === "string") {
    metadata.reason = source.reason;
  }

  if (typeof source?.label === "string") {
    metadata.label = source.label;
  }

  return metadata;
}

function formatEdgeLabel(edge) {
  const parts = [edge.label ?? edge.event];

  if (edge.conditional) {
    parts.push("[condition]");
  }

  return parts.join(" ");
}

function stateId(statusName, value) {
  const parts = value === undefined
    ? [statusName]
    : [statusName, formatValue(value)];
  const id = parts
    .join("__")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^([^A-Za-z_])/, "_$1");

  return id.length > 0 ? id : "state";
}

function quoteMermaid(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatValue(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "undefined";
  }

  return JSON.stringify(value);
}

function cloneGraphValue(value) {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
