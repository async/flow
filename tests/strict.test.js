import assert from "node:assert/strict";
import test from "node:test";
import {
  GUARD,
  TRANSITION,
  bool,
  can,
  every,
  flow,
  guard,
  matches,
  not,
  set,
  some,
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

test("boolean condition helpers compose status matches predicates and can checks", () => {
  const checkout = flow({
    store: {
      phase: status("idle", ["idle", "dragging", "overTarget"]),
      cardId: null,
      overColumnId: null,
      dropped: false,
      dragging: matches("phase", ["dragging", "overTarget"]),
      dropReady: every(
        matches("phase", "overTarget"),
        (store) => store.cardId,
        (store) => store.overColumnId
      ),
      blocked: not(can("drop")),
      hasTarget: bool((store) => store.overColumnId),
      idleOrTargeted: some(
        matches("phase", "idle"),
        (store) => store.overColumnId
      ),
      contextReady: bool((store) => store.phase === "idle")
    },
    on: {
      start: set({
        phase: "dragging",
        cardId: "card-1"
      }),
      over: set({
        phase: "overTarget",
        overColumnId: "done"
      }),
      drop: guard(
        every(
          matches("phase", "overTarget"),
          (store) => store.cardId,
          (store) => store.overColumnId
        ),
        set("dropped", true)
      )
    }
  });

  assert.equal(checkout.store.dragging, false);
  assert.equal(checkout.store.dropReady, false);
  assert.equal(checkout.store.blocked, true);
  assert.equal(checkout.store.hasTarget, false);
  assert.equal(checkout.store.idleOrTargeted, true);
  assert.equal(checkout.store.contextReady, true);

  checkout.start();
  assert.equal(checkout.store.dragging, true);
  assert.equal(checkout.store.dropReady, false);
  assert.equal(checkout.store.blocked, true);

  checkout.over();
  assert.equal(checkout.store.dropReady, true);
  assert.equal(checkout.store.blocked, false);
  assert.equal(checkout.store.hasTarget, true);
  assert.equal(checkout.can("drop"), true);

  checkout.drop();
  assert.equal(checkout.store.dropped, true);
});

test("boolean condition helpers reject store key strings", () => {
  assert.throws(
    () => bool("missing"),
    /bool\(\.\.\.\) requires a boolean condition/
  );
});

test("flow can and explain cover unknown plain transition and conditioned events", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment", "review"]),
      attempts: 0,
      canNext: can("next"),
      canNextForStep: can("step", "next")
    },
    on: {
      ping() {
        return "pong";
      },
      next: transition("step", [
        {
          from: "shipping",
          to: "payment",
          when(store, input) {
            store.attempts += 1;
            return input?.allow === true;
          },
          reason: "cannot_continue",
          label: "Continue"
        },
        {
          from: "payment",
          to: "review"
        }
      ])
    }
  });

  assert.equal(checkout.can("missing"), false);
  assert.deepEqual(checkout.explain("missing"), {
    event: "missing",
    allowed: false,
    reason: "unknown_event"
  });
  assert.equal(checkout.can("ping"), true);
  assert.deepEqual(checkout.explain("ping"), {
    event: "ping",
    allowed: true,
    reason: "plain_handler",
    source: "handler"
  });
  assert.equal(checkout.can("next", { allow: false }), false);
  assert.equal(checkout.store.attempts, 0);
  assert.deepEqual(checkout.explain("next", { allow: false }), {
    event: "next",
    allowed: false,
    reason: "cannot_continue",
    source: "transition",
    status: "step",
    current: "shipping",
    label: "Continue"
  });
  assert.equal(checkout.can("next", { allow: true }), true);
  assert.deepEqual(checkout.explain("next", { allow: true }), {
    event: "next",
    allowed: true,
    reason: "allowed",
    source: "transition",
    status: "step",
    current: "shipping",
    label: "Continue",
    next: "payment"
  });
  assert.equal(checkout.store.canNext, false);
  assert.equal(checkout.store.canNextForStep, false);

  checkout.next({ allow: true });
  assert.equal(checkout.store.step, "payment");
  assert.equal(checkout.store.canNext, true);
  assert.equal(checkout.store.canNextForStep, true);

  checkout.next();
  assert.equal(checkout.store.step, "review");
  assert.equal(checkout.can("next"), false);
  assert.equal(checkout.explain("next").reason, "no_matching_transition");
});

test("transition rules accept composed boolean conditions", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment"]),
      approved: false,
      canNext: can("next")
    },
    on: {
      next: transition("step", {
        from: "shipping",
        to: "payment",
        when: every(matches("step", "shipping"), (store) => store.approved),
        reason: "approval_required"
      })
    }
  });

  assert.equal(checkout.can("next"), false);
  assert.equal(checkout.store.canNext, false);
  assert.deepEqual(checkout.explain("next"), {
    event: "next",
    allowed: false,
    reason: "approval_required",
    source: "transition",
    status: "step",
    current: "shipping"
  });

  checkout.store.approved = true;
  assert.equal(checkout.can("next"), true);
  assert.equal(checkout.store.canNext, true);

  checkout.next();
  assert.equal(checkout.store.step, "payment");
});

test("guarded events explain blocked and allowed outcomes with receiver helpers", () => {
  const checkout = flow({
    store: {
      step: status("review", ["review", "submitted"]),
      canSubmit: false,
      submitted: false,
      canSubmitNow: can("submit")
    },
    on: {
      submit: guard(
        (store, input) => {
          store.canSubmit = true;
          return input?.confirm === true && store.step === "review";
        },
        transition("step", {
          review: "submitted"
        }),
        {
          reason: "cannot_submit",
          label: "Submit order"
        }
      ),
      inspect(store, input) {
        return [
          this.can("submit", input),
          this.explain("submit", input).reason,
          this.describe().handlers
        ];
      }
    }
  });

  assert.equal(checkout.can("submit", { confirm: false }), false);
  assert.equal(checkout.store.canSubmit, false);
  assert.deepEqual(checkout.explain("submit", { confirm: false }), {
    event: "submit",
    allowed: false,
    reason: "cannot_submit",
    source: "guard",
    status: "step",
    current: "review",
    label: "Submit order"
  });
  assert.equal(checkout.store.canSubmitNow, false);
  assert.deepEqual(checkout.inspect({ confirm: false }), [
    false,
    "cannot_submit",
    ["submit", "inspect"]
  ]);

  assert.equal(checkout.can("submit", { confirm: true }), true);
  assert.deepEqual(checkout.explain("submit", { confirm: true }), {
    event: "submit",
    allowed: true,
    reason: "allowed",
    source: "transition",
    status: "step",
    current: "review",
    label: "Submit order",
    next: "submitted"
  });
  checkout.submit({ confirm: true });
  assert.equal(checkout.store.step, "submitted");
});
