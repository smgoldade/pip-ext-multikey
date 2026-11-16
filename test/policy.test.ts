import { test } from "node:test";
import assert from "node:assert/strict";
import {
    addKey,
    addUsage,
    classifyFailure,
    emptyPool,
    emptyState,
    maskSecret,
    normalizeState,
    pickAfter,
    pickBalanced,
    pickFor,
    pickSequential,
    prunePicks,
    usable,
    type Pool,
    type PoolKey,
} from "../_multikey-policy.ts";

const now = 1_700_000_000_000;

/** A key for a test: a pool of these is what the picks work on. */
function key(id: string, addedAt = now): PoolKey {
    return {
        id,
        label: id,
        secret: `sk-${id}-secret-value`,
        addedAt,
        usage: {
            requests: 0,
            errors: 0,
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0,
            lastAt: 0,
        },
    };
}

/** A pool with these keys, in this order, and no key chosen yet. */
function pool(keys: PoolKey[], mode: Pool["mode"] = "sequential"): Pool {
    return { mode, keys, current: keys[0]?.id, picks: {} };
}

test("a failure that says the quota is gone is used up, not a pause", () => {
    assert.equal(
        classifyFailure("400 Your credit balance is too low to access the Anthropic API")?.kind,
        "used-up",
    );
    assert.equal(
        classifyFailure(
            '429 {"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}',
        )?.kind,
        "used-up",
    );
    assert.equal(classifyFailure("HTTP 402 payment required")?.kind, "used-up");
});

test("a refusal of the key itself is told apart from a pause", () => {
    assert.equal(classifyFailure("401 Unauthorized: invalid x-api-key")?.kind, "rejected");
    assert.equal(classifyFailure("Incorrect API key provided")?.kind, "rejected");
});

test("a rate limit is a pause", () => {
    assert.equal(
        classifyFailure("429 rate_limit_error: number of requests has exceeded your rate limit")
            ?.kind,
        "cooling",
    );
    assert.equal(
        classifyFailure("The engine is currently overloaded, please try again later")?.kind,
        "cooling",
    );
});

test("a failure about the request, and not the key, says nothing about the key", () => {
    assert.equal(classifyFailure("400 prompt is too long: 210000 tokens"), undefined);
    assert.equal(classifyFailure("fetch failed"), undefined);
    assert.equal(classifyFailure(""), undefined);
    assert.equal(classifyFailure(undefined), undefined);
});

test("a key that is used up or resting cannot carry a request", () => {
    const key1 = key("k1");

    assert.equal(usable(key1, now), true);

    key1.coolUntil = now + 60_000;
    assert.equal(usable(key1, now), false);
    assert.equal(usable(key1, now + 60_000), true);

    const key2 = key("k2");
    key2.usedUpAt = now;
    assert.equal(usable(key2, now), false);
    assert.equal(usable(key2, now + 10 * 24 * 3_600_000), false);
});

test("sequential keeps its key while it works, then takes the next one", () => {
    const keys = [key("k1"), key("k2"), key("k3")];
    const pool1 = pool(keys);
    // What the module does with each answer: the key it picked becomes the key in force.
    const pick = () => {
        const chosen = pickSequential(pool1, now);

        if (chosen !== undefined) {
            pool1.current = chosen.id;
        }

        return chosen?.id;
    };

    assert.equal(pick(), "k1");

    keys[0]!.usedUpAt = now;
    assert.equal(pick(), "k2");

    // The key that is in force stays, even when an earlier one comes back.
    delete keys[0]!.usedUpAt;
    assert.equal(pick(), "k2");

    keys[1]!.usedUpAt = now;
    assert.equal(pick(), "k3");

    keys[2]!.usedUpAt = now;
    assert.equal(pick(), "k1");
});

test("sequential wraps around, and waits for a key that is resting", () => {
    const keys = [key("k1"), key("k2")];
    const pool1 = pool(keys);

    keys[0]!.usedUpAt = now;
    keys[1]!.usedUpAt = now;
    keys[1]!.coolUntil = now + 120_000;
    delete keys[1]!.usedUpAt;

    assert.equal(pickSequential(pool1, now)?.id, "k2");
    assert.equal(pickSequential(pool1, now + 120_000)?.id, "k2");
});

test("balanced takes the key that carried the least, and the one idle longest on a tie", () => {
    const keys = [key("k1"), key("k2")];
    const pool1 = pool(keys, "balanced");

    keys[0]!.usage.input = 500;
    assert.equal(pickBalanced(pool1, now, "tokens")?.id, "k2");

    keys[1]!.usage.input = 500;
    keys[0]!.usage.lastAt = now - 1000;
    keys[1]!.usage.lastAt = now - 5000;
    assert.equal(pickBalanced(pool1, now, "tokens")?.id, "k2");

    // Fewer requests on the first key: another metric, another key.
    keys[1]!.usage.requests = 3;
    assert.equal(pickBalanced(pool1, now, "requests")?.id, "k1");
});

test("a conversation keeps its key while it works, and gets another when that one is used up", () => {
    const keys = [key("k1"), key("k2")];
    const pool1 = pool(keys, "balanced");

    const first = pickFor(pool1, "7", now, "tokens");
    assert.equal(first?.id, "k1");
    pool1.picks["7"] = { id: "k1", at: now };

    // Another conversation carries more on k1, so the balance alone would move conversation 7.
    keys[0]!.usage.input = 10_000;
    assert.equal(pickFor(pool1, "7", now, "tokens")?.id, "k1");

    keys[0]!.usedUpAt = now;
    assert.equal(pickFor(pool1, "7", now, "tokens")?.id, "k2");
});

test("the next key after a failure skips the one that failed", () => {
    const keys = [key("k1"), key("k2"), key("k3")];
    const pool1 = pool(keys);

    assert.equal(pickAfter(pool1, "k1", now, "tokens")?.id, "k2");
    assert.equal(pickAfter(pool1, "k3", now, "tokens")?.id, "k1");

    keys[1]!.usedUpAt = now;
    assert.equal(pickAfter(pool1, "k1", now, "tokens")?.id, "k3");
});

test("a pool whose keys are all gone has no key to pick", () => {
    const keys = [key("k1"), key("k2")];

    keys[0]!.usedUpAt = now;
    keys[1]!.usedUpAt = now;

    const pool1 = pool(keys);

    assert.equal(pickSequential(pool1, now), undefined);
    assert.equal(pickBalanced(pool1, now, "tokens"), undefined);
    assert.equal(pickAfter(pool1, "k1", now, "tokens"), undefined);
});

test("a key shows as its first characters and its last four", () => {
    assert.equal(maskSecret("sk-ant-api03-abcdefghijklmnop-4f2c"), "sk-ant-…4f2c");
    assert.equal(maskSecret("1234567890"), "…7890");
    assert.equal(maskSecret("short"), "…");
});

test("a new key gets the next id, and the first one is in force", () => {
    const state = emptyState();
    const pool1 = emptyPool();

    assert.equal(addKey(state, pool1, { label: "one", secret: "sk-one" }, now).id, "k1");
    assert.equal(addKey(state, pool1, { label: "two", secret: "sk-two" }, now).id, "k2");
    assert.equal(pool1.current, "k1");
    assert.equal(state.counter, 2);
});

test("what a key carried adds up, and never goes down", () => {
    const key1 = key("k1");

    addUsage(key1, { input: 10, output: 5, cacheRead: 3, cacheWrite: 1, cost: 0.25 }, now);
    addUsage(key1, { input: 10, output: 5, cost: 0.25, error: true }, now + 1);

    assert.equal(key1.usage.requests, 2);
    assert.equal(key1.usage.errors, 1);
    assert.equal(key1.usage.input, 20);
    assert.equal(key1.usage.output, 10);
    assert.equal(key1.usage.cacheRead, 3);
    assert.equal(key1.usage.cacheWrite, 1);
    assert.equal(key1.usage.cost, 0.5);
    assert.equal(key1.usage.lastAt, now + 1);
});

test("a conversation's choice is forgotten when it is old", () => {
    const pool1 = pool([key("k1")], "balanced");

    pool1.picks["1"] = { id: "k1", at: now };
    pool1.picks["2"] = { id: "k1", at: now - 40 * 24 * 3_600_000 };

    prunePicks(pool1, now);

    assert.deepEqual(Object.keys(pool1.picks), ["1"]);
});

test("a file that holds junk keeps the pools that are whole", () => {
    const state = normalizeState({
        version: 1,
        counter: 3,
        providers: {
            anthropic: {
                mode: "balanced",
                keys: [
                    { id: "k2", label: "two", secret: "sk-two", usage: { requests: 4 } },
                    { id: "k9", label: "nine", secret: "sk-nine" },
                    { secret: "" },
                    "junk",
                ],
                current: "k9",
                picks: { 5: { id: "k2", at: 10 }, 6: { id: "k1", at: 10 }, 7: "junk" },
            },
            openai: { keys: [] },
        },
    });

    assert.deepEqual(Object.keys(state.providers), ["anthropic"]);
    assert.equal(state.providers["anthropic"]?.mode, "balanced");
    assert.equal(state.providers["anthropic"]?.keys.length, 2);
    assert.equal(state.providers["anthropic"]?.keys[0]?.usage.requests, 4);
    assert.equal(state.providers["anthropic"]?.current, "k9");
    assert.equal(state.counter, 9);
    assert.deepEqual(state.providers["anthropic"]?.picks, { 5: { id: "k2", at: 10 } });
});

test("a file that is not a file of pools gives an empty state", () => {
    assert.deepEqual(normalizeState(undefined), emptyState());
    assert.deepEqual(normalizeState("junk"), emptyState());
    assert.deepEqual(normalizeState({ providers: 7 }), emptyState());
});
