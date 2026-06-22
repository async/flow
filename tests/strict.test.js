import assert from "node:assert/strict";
import test from "node:test";
import {
  GUARD,
  TRANSITION,
  can,
  flow,
  guard,
  matches,
  set,
  status,
  transition
} from "@async/flow";
import { compose } from "@async/flow/compose";

test("status stores values in writable Flow refs and validates writes", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment", "review"])
    }
  });

  assert.equal(checkout.refs.step.kind, "status");
  checkout.store.step = "payment";
  assert.equal(checkout.store.step, "payment");
  assert.throws(
    () => {
      checkout.store.step = "done";
    },
    /Invalid status value/
  );
});

test("transition writes matching status changes and no-ops when no rule matches", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment", "review"])
    },
    on: {
      next: transition("step", {
        shipping: "payment",
        payment: "review"
      })
    }
  });

  assert.equal(checkout.next(), undefined);
  assert.equal(checkout.store.step, "payment");
  checkout.next();
  assert.equal(checkout.store.step, "review");
  checkout.next();
  assert.equal(checkout.store.step, "review");
});

test("guard skips the handler when the predicate is false", () => {
  const checkout = flow({
    store: {
      step: status("payment", ["shipping", "payment", "review"]),
      submitted: false
    },
    on: {
      submit: guard(
        (store) => store.step === "review",
        set("submitted", true)
      )
    }
  });

  assert.equal(checkout.submit(), undefined);
  assert.equal(checkout.store.submitted, false);

  checkout.store.step = "review";
  checkout.submit();
  assert.equal(checkout.store.submitted, true);
});

test("transition and guard metadata use public symbols", () => {
  const move = transition("step", { shipping: "payment" });
  const guarded = guard(() => true, move);

  assert.equal(move[TRANSITION].status, "step");
  assert.deepEqual(move[TRANSITION].rules, [
    {
      from: "shipping",
      to: "payment",
      when: undefined
    }
  ]);
  assert.equal(guarded[TRANSITION], move[TRANSITION]);
  assert.equal(typeof guarded[GUARD].predicate, "function");
  assert.equal(Object.hasOwn(move, "_flowTransition"), false);
  assert.equal(Object.hasOwn(guarded, "_flowTransition"), false);
});

test("strict helpers work inside compose pipelines", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment"]),
      moved: false
    },
    on: {
      next: compose([
        transition("step", { shipping: "payment" }),
        set("moved", true)
      ])
    }
  });

  checkout.next();
  assert.equal(checkout.store.step, "payment");
  assert.equal(checkout.store.moved, true);
});

test("can and matches compute from strict transition metadata and status values", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment"]),
      canNext: can("step", "next"),
      inPayment: matches("step", "payment")
    },
    on: {
      next: transition("step", { shipping: "payment" })
    }
  });

  assert.equal(checkout.store.canNext, true);
  assert.equal(checkout.store.inPayment, false);

  checkout.next();

  assert.equal(checkout.store.canNext, false);
  assert.equal(checkout.store.inPayment, true);
});
