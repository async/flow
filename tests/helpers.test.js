import assert from "node:assert/strict";
import test from "node:test";
import { flow } from "@async/flow";
import { compose } from "@async/flow/compose";
import { after, branch, dispatch, onError, set, update, when } from "@async/flow/steps";

test("set and update helpers write through Flow store values", () => {
  const counter = flow({
    store: {
      loading: false,
      count: 0
    },
    on: {
      start: set({ loading: true }),
      increment: update("count", (count) => count + 1)
    }
  });

  counter.start();
  counter.increment();

  assert.equal(counter.store.loading, true);
  assert.equal(counter.store.count, 1);
});

test("set derives values from input and previous compose results", async () => {
  const checkout = flow({
    store: {
      orderId: null,
      source: null,
      complete: false
    },
    on: {
      submit: compose([
        async (_store, input) => ({
          id: input.orderId,
          source: input.source
        }),
        set({
          orderId: (_store, _input, output) => output.id,
          source: (_store, _input, output) => output.source,
          complete: true
        }),
        () => "saved"
      ])
    }
  });

  await checkout.submit({ orderId: "ord_123", source: "web" });

  assert.deepEqual(checkout.snapshot(), {
    orderId: "ord_123",
    source: "web",
    complete: true
  });
});

test("after schedules a later Flow event with derived input", async () => {
  const checkout = flow({
    store: {
      status: "idle",
      attempts: 0
    },
    on: {
      wait: compose([
        set("status", "waiting"),
        after(0, "retry", (_store, input) => ({
          by: input.by
        }))
      ]),
      retry: compose([
        update("attempts", (attempts, _store, input) => attempts + input.by),
        set("status", "retrying")
      ])
    }
  });

  await new Promise((resolve, reject) => {
    const stop = checkout.subscribe((change) => {
      if (change.store?.status === "retrying") {
        stop();
        resolve();
      }
    });

    try {
      checkout.wait({ by: 2 });
    } catch (error) {
      stop();
      reject(error);
    }
  });

  assert.deepEqual(checkout.snapshot(), {
    status: "retrying",
    attempts: 2
  });
});

test("dispatch helper forwards to another Flow event", () => {
  const checkout = flow({
    store: {
      step: "idle",
      lastInput: null
    },
    on: {
      start: dispatch("finish", (_store, input) => ({
        source: input.source
      })),
      finish(store, input) {
        store.step = "finished";
        store.lastInput = input.source;
      }
    }
  });

  checkout.start({ source: "submit" });

  assert.deepEqual(checkout.snapshot(), {
    step: "finished",
    lastInput: "submit"
  });
});

test("branch runs the first matching case or the default handler", () => {
  const checkout = flow({
    store: {
      jobStatus: "SUCCEEDED",
      step: "DetermineCompletion"
    },
    on: {
      determineCompletion: branch([
        [
          (store) => store.jobStatus === "SUCCEEDED",
          dispatch("reportJobSucceeded")
        ],
        [
          (store) => store.jobStatus === "FAILED",
          dispatch("reportJobFailed")
        ],
        set("step", "WaitForCompletion")
      ]),
      reportJobSucceeded: set("step", "JobSucceeded"),
      reportJobFailed: set("step", "JobFailed")
    }
  });

  checkout.determineCompletion();
  assert.equal(checkout.store.step, "JobSucceeded");

  checkout.store.jobStatus = "UNKNOWN";
  checkout.determineCompletion();
  assert.equal(checkout.store.step, "WaitForCompletion");
});

test("compose helpers can be used as a normal Flow handler function", async () => {
  const checkout = flow({
    store: {
      loading: false,
      canSubmit: true,
      orderId: null
    },
    on: {
      submit: compose([
        when((store) => store.canSubmit),
        set("loading", true),
        async (_store, input) => ({
          loading: false,
          orderId: input.orderId
        })
      ])
    }
  });

  const result = checkout.submit({ orderId: "ord_123" });

  assert.equal(checkout.store.loading, true);
  assert.deepEqual(await result, {
    loading: false,
    orderId: "ord_123"
  });
  assert.deepEqual(checkout.snapshot(), {
    loading: false,
    canSubmit: true,
    orderId: "ord_123"
  });
});

test("when stops a helper chain without applying later steps", () => {
  const checkout = flow({
    store: {
      canSubmit: false,
      loading: false
    },
    on: {
      submit: compose([
        when((store) => store.canSubmit),
        set("loading", true)
      ])
    }
  });

  assert.equal(checkout.submit(), undefined);
  assert.equal(checkout.store.loading, false);
});

test("onError maps sync throws and async rejections to store updates", async () => {
  const checkout = flow({
    store: {
      error: null
    },
    on: {
      sync: onError(
        (error) => ({ error: error.message }),
        () => {
          throw new Error("sync failed");
        }
      ),
      asyncFailure: onError(
        (error) => ({ error: error.message }),
        async () => {
          throw new Error("async failed");
        }
      )
    }
  });

  checkout.sync();
  assert.equal(checkout.store.error, "sync failed");

  await checkout.asyncFailure();
  assert.equal(checkout.store.error, "async failed");
});
