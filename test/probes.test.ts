import { test } from "node:test";
import assert from "node:assert/strict";
import { probeFor, probeProviders, readBalance } from "../_multikey-probes.ts";

/** An answer for a probe: the body it would get, and the status. */
const answer = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test("the providers that state a balance are the ones this module can ask", () => {
    assert.deepEqual(probeProviders().sort(), [
        "deepseek",
        "moonshotai",
        "moonshotai-cn",
        "openrouter",
    ]);
    assert.equal(probeFor("anthropic"), undefined);
    assert.equal(probeFor("__proto__"), undefined);
});

test("OpenRouter states what a key has left of its limit", async () => {
    const probe = probeFor("openrouter");

    assert.ok(probe !== undefined);

    const seen: { url: string; headers: Record<string, string> }[] = [];
    const reading = await readBalance(probe, "sk-or-one", AbortSignal.timeout(5000), (async (
        url: string,
        init: RequestInit,
    ) => {
        seen.push({
            url: String(url),
            headers: Object.fromEntries(new Headers(init.headers).entries()),
        });

        return new Response(
            JSON.stringify({
                data: { label: "one", limit: 25, usage: 20.5, limit_remaining: 4.5 },
            }),
            { status: 200 },
        );
    }) as unknown as typeof fetch);

    assert.deepEqual(reading, { remaining: 4.5, unit: "credits" });
    assert.equal(seen[0]?.url, "https://openrouter.ai/api/v1/key");
    assert.equal(seen[0]?.headers["authorization"], "Bearer sk-or-one");
});

test("a key with no limit of its own states no balance", () => {
    const probe = probeFor("openrouter");

    assert.ok(probe !== undefined);
    assert.equal(probe.read({ data: { limit: null, limit_remaining: null, usage: 3 } }), undefined);
});

test("DeepSeek states the balance of the account, in CNY when it has one", async () => {
    const probe = probeFor("deepseek");

    assert.ok(probe !== undefined);

    const reading = await readBalance(
        probe,
        "sk-deep",
        AbortSignal.timeout(5000),
        answer({
            is_available: true,
            balance_infos: [
                {
                    currency: "USD",
                    total_balance: "1.25",
                    granted_balance: "0",
                    topped_up_balance: "1.25",
                },
                {
                    currency: "CNY",
                    total_balance: "110.00",
                    granted_balance: "10",
                    topped_up_balance: "100",
                },
            ],
        }),
    );

    assert.deepEqual(reading, { remaining: 110, unit: "CNY" });
});

test("Moonshot states its available balance", async () => {
    const probe = probeFor("moonshotai");

    assert.ok(probe !== undefined);

    const reading = await readBalance(
        probe,
        "sk-moon",
        AbortSignal.timeout(5000),
        answer({
            code: 0,
            data: { available_balance: 12.34, voucher_balance: 0, cash_balance: 12.34 },
        }),
    );

    assert.deepEqual(reading, { remaining: 12.34, unit: "CNY" });
});

test("a refused or empty answer is an error with the provider's own words", async () => {
    const probe = probeFor("openrouter");

    assert.ok(probe !== undefined);

    await assert.rejects(
        readBalance(probe, "sk-bad", AbortSignal.timeout(5000), answer({ error: "nope" }, 401)),
        /answered 401/u,
    );
    await assert.rejects(
        readBalance(probe, "sk-odd", AbortSignal.timeout(5000), answer({ data: { usage: 1 } })),
        /no balance/u,
    );
});
