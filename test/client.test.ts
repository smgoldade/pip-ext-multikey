import { test } from "node:test";
import assert from "node:assert/strict";
import setup, { pocketApi } from "../multikey/index.js";

/**
 * A browser module has no DOM here, so this runs its page with a pocket of its own: `html` makes a string of
 * what would be drawn, the hooks hold still, and the calls that would talk to the server are kept. A throw here is a
 * page that fails in a tab.
 */
function run(states: unknown[]) {
    const registered: Record<string, { id: string; component: () => unknown }[]> = {
        page: [],
        sheet: [],
        rail: [],
        menu: [],
        launcher: [],
    };
    let state = 0;

    const asText = (value: unknown): string => {
        if (Array.isArray(value)) {
            return value.map(asText).join("");
        }

        if (value === null || value === undefined || value === false || value === true) {
            return "";
        }

        return typeof value === "object" ? "[node]" : String(value);
    };

    const pocket = {
        html: (strings: TemplateStringsArray, ...values: unknown[]) =>
            strings.reduce(
                (out, part, index) =>
                    out + part + (index < values.length ? asText(values[index]) : ""),
                "",
            ),
        Loader: () => "",
        useState: () => {
            const value = states[state] ?? null;

            state += 1;

            return [value, () => {}];
        },
        useEffect: () => {},
        useMemo: (make: () => unknown) => make(),
        useCallback: (make: () => unknown) => make(),
        useRef: () => ({ current: null }),
        style: () => {},
        api: async () => undefined,
        on: () => () => {},
        page: (spec: never) => registered["page"]?.push(spec),
        sheet: (spec: never) => registered["sheet"]?.push(spec),
        rail: (spec: never) => registered["rail"]?.push(spec),
        menu: (spec: never) => registered["menu"]?.push(spec),
        launcher: (spec: never) => registered["launcher"]?.push(spec),
    };

    setup(pocket as never);

    return registered;
}

/** What the server sends the page, with one pool that has two keys. */
const view = {
    providers: [
        {
            provider: "anthropic",
            mode: "balanced",
            current: "k2",
            inForce: true,
            storedSignIn: true,
            signInKind: "api_key",
            keys: [
                {
                    id: "k1",
                    label: "Work",
                    hint: "sk-ant-…1111",
                    usable: true,
                    usedUpAt: 1,
                    usedUpReason: "no credit or quota left",
                    coolUntil: null,
                    usage: {
                        requests: 3,
                        errors: 1,
                        input: 900,
                        output: 100,
                        cacheRead: 0,
                        cacheWrite: 0,
                        cost: 0.25,
                        lastAt: 1,
                    },
                },
                {
                    id: "k2",
                    label: "Home",
                    hint: "sk-ant-…2222",
                    usable: true,
                    usedUpAt: null,
                    usedUpReason: null,
                    coolUntil: Date.now() + 60_000,
                    usage: {
                        requests: 1,
                        errors: 0,
                        input: 10,
                        output: 2,
                        cacheRead: 0,
                        cacheWrite: 0,
                        cost: 0,
                        lastAt: 1,
                    },
                },
            ],
        },
    ],
    catalog: [
        { id: "anthropic", name: "Anthropic", models: 18 },
        { id: "openai", name: "OpenAI", models: 9 },
    ],
    known: ["opencode-go"],
    signedIn: ["anthropic", "openai"],
    signIns: {
        anthropic: { kind: "api_key", hint: "sk-ant-…9999" },
        openai: { kind: "oauth" },
    },
    settings: { balance: "tokens", cooldown: 10, recover: 0, notify: true },
    at: 1,
};

test("the module registers a page, a sheet, a rail button, a menu row, and a launcher action", () => {
    const registered = run([view, null, null, "", null, "", "", ""]);

    assert.equal(pocketApi, 1);
    assert.equal(registered["sheet"]?.[0]?.id, "pools");
    assert.equal(registered["menu"]?.[0]?.id, "pools");
    assert.equal(registered["rail"]?.[0]?.id, "keys");
    assert.equal(registered["launcher"]?.[0]?.id, "keys");

    // One screen, in a popup: there is no full page, and every way in opens the sheet.
    assert.equal(registered["page"]?.length, 0);
    assert.equal((registered["menu"]?.[0] as { sheet?: string }).sheet, "pools");
    assert.equal((registered["rail"]?.[0] as { sheet?: string }).sheet, "pools");
    assert.equal((registered["launcher"]?.[0] as { sheet?: string }).sheet, "pools");
});

test("the popup is wide, like the Providers sheet", () => {
    const registered = run([view, null, null, "", null, "", "", ""]);

    assert.equal((registered["sheet"]?.[0] as { wide?: boolean }).wide, true);
    assert.equal((registered["sheet"]?.[0] as { title?: string }).title, "API key pools");
});

test("the list draws every group and the row of a pool", () => {
    const registered = run([view, null, null, "", null, "", "", ""]);
    const text = String(registered["sheet"]?.[0]?.component());

    assert.match(text, /Your pools/u);
    assert.match(text, /Signed in in Pi/u);
    assert.match(text, /Other providers/u);
    assert.match(text, /Anthropic/u);
    assert.match(text, /2 keys/u);
    assert.match(text, /balanced/u);
    assert.match(text, /Another provider/u);
});

test("a row is the provider, its pills, and one button, as in Providers", () => {
    const registered = run([view, null, null, "", null, "", "", ""]);
    const text = String(registered["sheet"]?.[0]?.component());

    assert.match(text, /provider-item/u);
    assert.match(text, /provider-info/u);
    assert.match(text, /provider-name/u);
    assert.match(text, /provider-actions/u);
    assert.match(text, /sheet-list/u);
    assert.match(text, /provider-group-head/u);
    assert.match(text, /class="search"/u);
    // A provider with a pool says "Keys"; one with no pool says "Add key".
    assert.match(text, />\s*Keys\s*</u);
    assert.match(text, />\s*Add key\s*</u);
});

test("a provider that is not listed yet still fills the page", () => {
    const registered = run([
        {
            providers: [],
            catalog: [],
            known: [],
            signedIn: [],
            signIns: {},
            settings: { balance: "tokens" },
        },
        null,
        null,
        "",
        null,
        "",
        "",
        "",
    ]);
    const text = String(registered["sheet"]?.[0]?.component());

    assert.match(text, /has not arrived yet/u);
});

test("an open row draws its keys, its mode, and the form for the next key", () => {
    const registered = run([view, null, null, "", "anthropic", "", "", ""]);
    const text = String(registered["sheet"]?.[0]?.component());

    assert.match(text, /Work/u);
    assert.match(text, /Home/u);
    assert.match(text, /sk-ant-…1111/u);
    assert.match(text, /used up/u);
    assert.match(text, /rests in 1m/u);
    assert.match(text, /Add key/u);
    assert.match(text, /Remove the pool/u);
    // Pi's own key shows as a hint, with the way to move it into the pool.
    assert.match(text, /Pi's key/u);
    assert.match(text, /sk-ant-…9999/u);
    assert.match(text, /Take it into the pool/u);
    assert.match(text, /goes out in its place/u);
});

test("the row shows a hint of Pi's key beside its other pills", () => {
    const registered = run([view, null, null, "", null, "", "", ""]);
    const text = String(registered["sheet"]?.[0]?.component());

    assert.match(text, /Pi key/u);
    assert.match(text, /sk-ant-…9999/u);
    assert.match(text, /subscription/u);
});

test("the row that takes a provider by hand draws its form", () => {
    const registered = run([view, null, null, "", "new", "", "", "openrouter"]);
    const text = String(registered["sheet"]?.[0]?.component());

    assert.match(text, /endpoint of your own/u);
    assert.match(text, /Add key/u);
});

test("a subscription sign-in is said to keep its place", () => {
    const registered = run([view, null, null, "", "openai", "", "", ""]);
    const text = String(registered["sheet"]?.[0]?.component());

    assert.match(text, /signed in to this provider with a subscription/u);
});
