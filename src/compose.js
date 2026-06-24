const COMPOSE_STOP = Symbol("async.flow.compose.stop");
const AVAILABILITY = Symbol.for("@async/flow.availability");
const GUARD = Symbol.for("@async/flow.guard");
export const COMPOSE_BATCH = Symbol.for("@async/flow.compose.batch");

export function compose(stepOrSteps) {
  const steps = Array.isArray(stepOrSteps) ? stepOrSteps : [stepOrSteps];

  for (const step of steps) {
    if (typeof step !== "function") {
      throw new TypeError("compose(...) requires a function or an array of functions.");
    }
  }

  const composed = function composed(store, input) {
    return runSteps(steps, this, store, input, undefined);
  };

  liftLeadingAvailability(steps, composed);
  return composed;
}

export function parallel(branches) {
  const normalized = normalizeParallelBranches(branches);

  return function parallelStep(store, input, previous) {
    const receiver = this;
    const results = [];
    let hasAsync = false;

    for (const branch of normalized) {
      const result = branch.call(receiver, store, input, previous);
      results.push(result);

      if (isPromiseLike(result)) {
        hasAsync = true;
      }
    }

    if (!hasAsync) {
      return undefined;
    }

    return Promise.all(results).then(() => undefined);
  };
}

export function remember(mappingOrMappings, stepOrSteps) {
  const mappings = normalizeRememberMappings(mappingOrMappings);
  const steps = normalizeScopedSteps(stepOrSteps, "remember");

  return function rememberStep(store, input, previous) {
    const receiver = this;
    const captured = mappings.map(({ source, target }) => ({
      source,
      target,
      value: store[source]
    }));
    const result = runSteps(steps, receiver, store, input, previous);

    if (isPromiseLike(result)) {
      return Promise.resolve(result).then((resolved) =>
        runRememberWrites(receiver, store, captured, () => resolved)
      );
    }

    writeRemembered(store, captured);
    return result;
  };
}

function runSteps(steps, receiver, store, input, initialPrevious) {
  let previous = initialPrevious;
  let index = 0;

  return runSegment(false);

  function runSegment(batchContinuation) {
    const execute = () => {
      while (index < steps.length) {
        const next = steps[index].call(receiver, store, input, previous);
        index += 1;

        if (isPromiseLike(next)) {
          return Promise.resolve(next).then((resolved) => {
            if (applyStepResult(resolved) === COMPOSE_STOP) {
              return previous;
            }

            return runSegment(true);
          });
        }

        if (applyStepResult(next) === COMPOSE_STOP) {
          return previous;
        }
      }

      return previous;
    };

    const batch = batchContinuation ? receiver?.[COMPOSE_BATCH] : undefined;
    return typeof batch === "function" ? batch.call(receiver, execute) : execute();
  }

  function applyStepResult(next) {
    if (isComposeStop(next)) {
      return COMPOSE_STOP;
    }

    if (next !== undefined) {
      previous = next;
    }

    return undefined;
  }
}

export function isPromiseLike(value) {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof value.then === "function"
  );
}

export function createComposeStop() {
  return {
    [COMPOSE_STOP]: true
  };
}

export function isComposeStop(value) {
  return Boolean(value && typeof value === "object" && value[COMPOSE_STOP] === true);
}

function normalizeParallelBranches(branches) {
  const branchList = Array.isArray(branches)
    ? branches
    : isRecord(branches)
      ? Object.values(branches)
      : undefined;

  if (!branchList || branchList.length === 0) {
    throw new TypeError("parallel(...) requires at least one branch function.");
  }

  for (const branch of branchList) {
    if (typeof branch !== "function") {
      throw new TypeError("parallel(...) requires branch functions.");
    }
  }

  return branchList;
}

function normalizeRememberMappings(mappingOrMappings) {
  const mappings = isRememberTuple(mappingOrMappings)
    ? [mappingOrMappings]
    : Array.isArray(mappingOrMappings)
      ? mappingOrMappings
      : undefined;

  if (!mappings || mappings.length === 0) {
    throw new TypeError("remember(...) requires a memory mapping.");
  }

  const sources = new Set();
  const targets = new Set();

  return mappings.map((mapping) => {
    if (!isRememberTuple(mapping)) {
      throw new TypeError('remember(...) mappings must be [source, target] tuples.');
    }

    const [source, target] = mapping;
    if (source === target) {
      throw new TypeError("remember(...) source and target names must differ.");
    }

    if (sources.has(source)) {
      throw new TypeError(`remember(...) duplicate source "${source}".`);
    }

    if (targets.has(target)) {
      throw new TypeError(`remember(...) duplicate target "${target}".`);
    }

    sources.add(source);
    targets.add(target);
    return { source, target };
  });
}

function normalizeScopedSteps(stepOrSteps, helperName) {
  const steps = Array.isArray(stepOrSteps) ? stepOrSteps : [stepOrSteps];

  if (steps.length === 0) {
    throw new TypeError(`${helperName}(...) requires a function or a non-empty array of functions.`);
  }

  for (const step of steps) {
    if (typeof step !== "function") {
      throw new TypeError(`${helperName}(...) requires a function or a non-empty array of functions.`);
    }
  }

  return steps;
}

function runRememberWrites(receiver, store, captured, getResult) {
  const batch = receiver?.[COMPOSE_BATCH];

  if (typeof batch === "function") {
    return batch.call(receiver, () => {
      writeRemembered(store, captured);
      return getResult();
    });
  }

  writeRemembered(store, captured);
  return getResult();
}

function writeRemembered(store, captured) {
  for (const { source, target, value } of captured) {
    if (!Object.is(store[source], value)) {
      store[target] = value;
    }
  }
}

function isRememberTuple(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    value[0].length > 0 &&
    typeof value[1] === "string" &&
    value[1].length > 0
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function liftLeadingAvailability(steps, target) {
  const gates = [];

  for (const step of steps) {
    if (!step?.[AVAILABILITY]) {
      break;
    }

    gates.push(step[AVAILABILITY]);
  }

  if (gates.length === 0) {
    return;
  }

  const metadata = firstPublicMetadata(gates);

  Object.defineProperty(target, GUARD, {
    configurable: true,
    value: {
      predicate(store, input, previous) {
        return explainAvailability(gates, this, store, input, previous).allowed;
      },
      explain(store, input, previous) {
        return explainAvailability(gates, this, store, input, previous);
      },
      ...metadata
    }
  });
}

function explainAvailability(gates, receiver, store, input, previous) {
  for (const gate of gates) {
    if (!gate.predicate.call(receiver, store, input, previous)) {
      return {
        allowed: false,
        reason: gate.reason ?? "guard_failed",
        ...copyPublicLabel(gate),
        dynamicMetadata: true
      };
    }
  }

  return {
    allowed: true
  };
}

function firstPublicMetadata(gates) {
  for (const gate of gates) {
    const metadata = copyPublicMetadata(gate);
    if (Object.keys(metadata).length > 0) {
      return metadata;
    }
  }

  return {};
}

function copyPublicMetadata(source) {
  const metadata = {};

  if (typeof source?.reason === "string") {
    metadata.reason = source.reason;
  }

  if (typeof source?.label === "string") {
    metadata.label = source.label;
  }

  return metadata;
}

function copyPublicLabel(source) {
  return typeof source?.label === "string"
    ? { label: source.label }
    : {};
}
