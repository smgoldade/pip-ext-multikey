// API key pools' browser module: the "API keys" button on the rail, the sheet in the menu, and the page. It lists
// Pi's providers the way Menu → Providers does, and each row opens in place to add keys and to set how they take turns.
// The page never shows a key: the server sends a hint.

/** The version of `pocket` this module was written for. */
export const pocketApi = 1;

/** A count of tokens, short enough for a phone. */
function tokens(count) {
    if (count >= 1_000_000) {
        return `${(count / 1_000_000).toFixed(1)}M`;
    }

    if (count >= 1_000) {
        return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}k`;
    }

    return String(count);
}

/** An amount of money, short enough for a phone. */
function money(amount) {
    if (amount >= 1) {
        return `${amount.toFixed(2)}`;
    }

    return amount > 0 ? "<0.01" : "0";
}

/** How long ago, or how long until, in a few words. */
function when(at, now) {
    const seconds = Math.round((at - now) / 1000);
    const ahead = seconds > 0;
    const left = Math.abs(seconds);
    const words =
        left < 60
            ? `${left}s`
            : left < 3600
              ? `${Math.round(left / 60)}m`
              : left < 86_400
                ? `${Math.round(left / 3600)}h`
                : `${Math.round(left / 86_400)}d`;

    return ahead ? `in ${words}` : `${words} ago`;
}

/** What a provider row says under its name. */
function about(provider) {
    const models =
        typeof provider.models === "number" && provider.models > 0
            ? `${provider.models} model${provider.models === 1 ? "" : "s"}`
            : "";

    return [models, provider.id].filter((each) => each !== "").join(" · ");
}

export default function setup(pocket) {
    const { html, useEffect, useState, Loader } = pocket;

    // The page's own styles, in the app's cascade layer (docs/extensions/browser-modules.md).
    pocket.style("style.css");

    /** Why a pool key cannot go out for this provider, or how it goes out in place of Pi's own key. */
    function signInNote(kind, inForce) {
        if (kind === "oauth") {
            return html`<div class="error-box">
                Pi is signed in to this provider with a subscription, and sends that token. A key cannot take its
                place: sign out of it in Menu → Providers to use the pool.
            </div>`;
        }

        if (kind === undefined || kind === null) {
            return null;
        }

        return html`<p class="muted small">
            The pool's key goes out in place of Pi's own key${inForce ? ", which stays stored" : ""}. Menu →
            Providers still shows the provider as signed in.
        </p>`;
    }

    function ApiKeys() {
        const [view, setView] = useState(null);
        const [error, setError] = useState(null);
        const [busy, setBusy] = useState(null);
        const [query, setQuery] = useState("");
        /** The provider whose row is open, or `"new"` for the row that takes a provider by hand. */
        const [open, setOpen] = useState(null);
        const [name, setName] = useState("");
        const [secret, setSecret] = useState("");
        /** The id typed in the "Another provider" row. */
        const [otherId, setOtherId] = useState("");

        const show = (next) => {
            if (next !== undefined && next !== null) {
                setView(next);
            }
        };

        /** Runs one change: the control says it waits, and an error shows above the list. */
        const act = async (id, run) => {
            setBusy(id);

            try {
                show(await run());
                setError(null);
            } catch (failure) {
                setError(failure.message);
            } finally {
                setBusy(null);
            }
        };

        useEffect(() => {
            let live = true;
            const read = () =>
                pocket.api("state").then(
                    (next) => live && show(next),
                    (failure) => live && setError(failure.message),
                );

            void read();

            // Another tab, or a switch that this page made: read the pools again.
            const stop = pocket.on("changed", () => {
                pocket.api("state").then(
                    (next) => live && show(next),
                    () => {},
                );
            });

            return () => {
                live = false;
                stop();
            };
        }, []);

        if (error !== null && view === null) {
            return html`<div class="error-box">${error}</div>
                <button class="button" onClick=${() => act("reload", () => pocket.api("state"))}>
                    Try again
                </button>`;
        }

        if (view === null) {
            return html`<${Loader} label="Reading the key pools" />`;
        }

        const now = Date.now();
        const pools = new Map(view.providers.map((pool) => [pool.provider, pool]));
        const signIns = view.signIns ?? {};
        const listed = new Map();

        for (const provider of view.catalog ?? []) {
            listed.set(provider.id, {
                id: provider.id,
                name: provider.name,
                models: provider.models,
            });
        }

        for (const id of view.known ?? []) {
            if (!listed.has(id)) {
                listed.set(id, { id, name: id, models: null });
            }
        }

        for (const pool of view.providers) {
            if (!listed.has(pool.provider)) {
                listed.set(pool.provider, { id: pool.provider, name: pool.provider, models: null });
            }
        }

        const needle = query.trim().toLowerCase();
        const match = (provider) =>
            needle === "" || `${provider.id} ${provider.name}`.toLowerCase().includes(needle);

        const all = [...listed.values()].sort((left, right) => left.name.localeCompare(right.name));
        const groups = [
            ["Your pools", all.filter((provider) => pools.has(provider.id) && match(provider))],
            [
                "Signed in in Pi",
                all.filter(
                    (provider) =>
                        !pools.has(provider.id) &&
                        signIns[provider.id] !== undefined &&
                        match(provider),
                ),
            ],
            [
                "Other providers",
                all.filter(
                    (provider) =>
                        !pools.has(provider.id) &&
                        signIns[provider.id] === undefined &&
                        match(provider),
                ),
            ],
        ].filter(([, each]) => each.length > 0);

        /** Opens a row, and starts its form empty. */
        const toggle = (provider) => {
            setName("");
            setSecret("");
            setError(null);
            setOpen((was) => (was === provider ? null : provider));
        };

        const add = (provider) => async (event) => {
            event.preventDefault();

            await act(`add ${provider}`, async () => {
                const next = await pocket.api("add", { provider, label: name, secret });

                setSecret("");

                // A provider typed by hand has a row of its own after this: its panel opens there.
                if (open === "new") {
                    setOpen(provider);
                }

                return next;
            });
        };

        const keyRow = (
            pool,
            key,
        ) => html`<div class="mk-row ${key.id === pool.current ? "on" : ""}">
            <div class="mk-line">
                <span class="mk-name">
                    ${key.label}
                    ${key.id === pool.current ? html`<span class="mk-tag on">in use</span>` : null}
                    ${key.usedUpAt !== null ? html`<span class="mk-tag bad">used up</span>` : null}
                    ${
                        key.coolUntil !== null
                            ? html`<span class="mk-tag warn">
                              rests ${when(key.coolUntil, now)}
                          </span>`
                            : null
                    }
                </span>
                <span class="mono small muted">${key.hint}</span>
            </div>
            <div class="muted small">
                ${key.usage.requests} requests ·
                ${tokens(
                    key.usage.input + key.usage.output + key.usage.cacheRead + key.usage.cacheWrite,
                )} tokens · $${money(key.usage.cost)}
                ${key.usedUpAt !== null ? html`· <span>${key.usedUpReason}</span>` : null}
            </div>
            <div class="mk-actions">
                <button
                    class="button small"
                    disabled=${busy === "use" + key.id || key.id === pool.current}
                    onClick=${() =>
                        act("use" + key.id, () =>
                            pocket.api("use", { provider: pool.provider, id: key.id }),
                        )}
                >
                    Use now
                </button>
                <button
                    class="button small"
                    disabled=${busy === "used" + key.id}
                    onClick=${() =>
                        act("used" + key.id, () =>
                            pocket.api("used", {
                                provider: pool.provider,
                                id: key.id,
                                used: key.usedUpAt === null,
                            }),
                        )}
                >
                    ${key.usedUpAt === null ? "Used up" : "Bring back"}
                </button>
                <button
                    class="button small"
                    disabled=${busy === "reset" + key.id}
                    onClick=${() =>
                        act("reset" + key.id, () =>
                            pocket.api("reset", { provider: pool.provider, id: key.id }),
                        )}
                >
                    Reset usage
                </button>
                <button
                    class="button small"
                    disabled=${busy === "remove" + key.id}
                    onClick=${() =>
                        act("remove" + key.id, () =>
                            pocket.api("remove", { provider: pool.provider, id: key.id }),
                        )}
                >
                    Remove
                </button>
            </div>
        </div>`;

        const keyForm = (provider) => html`<form class="mk-add" onSubmit=${add(provider)}>
            <input
                class="mk-input"
                placeholder="Name for the key"
                maxlength="40"
                value=${name}
                onInput=${(event) => setName(event.currentTarget.value)}
            />
            <input
                class="mk-input mono"
                type="password"
                autocomplete="off"
                placeholder="API key"
                value=${secret}
                onInput=${(event) => setSecret(event.currentTarget.value)}
            />
            <button
                class="button primary small"
                type="submit"
                disabled=${busy !== null || name === "" || secret === "" || provider === ""}
            >
                Add key
            </button>
        </form>`;

        /** What a row opens: its mode, its keys, the form for the next key, and the way to let the pool go. */
        const panel = (provider) => {
            const pool = pools.get(provider);

            return html`<div class="mk-panel">
                ${error !== null ? html`<div class="error-box">${error}</div>` : null}
                ${signInNote(signIns[provider], pool?.inForce)}

                <div class="mk-head">
                    <span>Keys${pool === undefined ? "" : ` · ${pool.keys.length}`}</span>
                    <span class="mk-modes">
                        ${["sequential", "balanced"].map(
                            (mode) =>
                                html`<button
                                class="button mk-mode ${pool?.mode === mode ? "on" : ""}"
                                disabled=${busy === "mode" + mode || pool === undefined}
                                onClick=${() =>
                                    act("mode" + mode, () =>
                                        pocket.api("mode", { provider, mode }),
                                    )}
                            >
                                ${mode}
                            </button>`,
                        )}
                    </span>
                </div>
                <p class="muted small">
                    ${
                        pool === undefined
                            ? "Add the first key. Then choose how its keys take turns: a key stays until its quota is gone (sequential), or each new session takes the one that carried the least (balanced)."
                            : pool.mode === "balanced"
                              ? `Each new session or subagent takes the key that carried the least (${
                                    view.settings.balance
                                }), and keeps it while it works.`
                              : "A key stays in use until the provider says its quota is gone, then the next key takes over."
                    }
                </p>

                ${(pool?.keys ?? []).map((key) => keyRow(pool, key))}
                ${keyForm(provider)}

                ${
                    pool !== undefined
                        ? html`<button
                          class="button small ghost"
                          disabled=${busy === "drop"}
                          onClick=${() => act("drop", () => pocket.api("drop", { provider }))}
                      >
                          Remove the pool
                      </button>`
                        : null
                }
            </div>`;
        };

        /** A row of the list: the provider, what it has, and whether its panel is open. */
        const item = (provider) => {
            const pool = pools.get(provider.id);
            const isOpen = open === provider.id;

            return html`<div class="mk-entry" key=${provider.id}>
                <button
                    class="mk-item ${isOpen ? "open" : ""}"
                    aria-expanded=${isOpen}
                    onClick=${() => toggle(provider.id)}
                >
                    <span class="mk-item-info">
                        <span class="mk-item-name">
                            ${provider.name}
                            ${
                                signIns[provider.id] === "oauth"
                                    ? html`<span class="mk-tag">subscription</span>`
                                    : signIns[provider.id] !== undefined
                                      ? html`<span class="mk-tag on">signed in</span>`
                                      : null
                            }
                            ${
                                pool !== undefined
                                    ? html`<span class="mk-tag">
                                      ${pool.keys.length} key${pool.keys.length === 1 ? "" : "s"}
                                  </span>`
                                    : null
                            }
                        </span>
                        <span class="muted small">${about(provider)}</span>
                    </span>
                    <span class="mk-item-side">
                        ${
                            pool !== undefined
                                ? html`<span class="muted small">${pool.mode}</span>`
                                : null
                        }
                        <span class="mk-caret">${isOpen ? "▴" : "▾"}</span>
                    </span>
                </button>
                ${isOpen ? panel(provider.id) : null}
            </div>`;
        };

        const other = html`<div class="mk-entry">
            <button
                class="mk-item ${open === "new" ? "open" : ""}"
                aria-expanded=${open === "new"}
                onClick=${() => toggle("new")}
            >
                <span class="mk-item-info">
                    <span class="mk-item-name">Another provider</span>
                    <span class="muted small">an id Pi does not list, such as an endpoint of your own</span>
                </span>
                <span class="mk-item-side">
                    <span class="mk-caret">${open === "new" ? "▴" : "▾"}</span>
                </span>
            </button>
            ${
                open === "new"
                    ? html`<div class="mk-panel">
                      ${error !== null ? html`<div class="error-box">${error}</div>` : null}
                      <p class="muted small">
                          The id that Pi uses for it, in small letters:
                          <span class="mono">anthropic</span>, <span class="mono">openrouter</span>, or the id of an
                          endpoint of your own.
                      </p>
                      <input
                          class="mk-input mono"
                          placeholder="provider"
                          value=${otherId}
                          onInput=${(event) => setOtherId(event.currentTarget.value.trim().toLowerCase())}
                      />
                      ${keyForm(otherId)}
                  </div>`
                    : null
            }
        </div>`;

        return html`<div class="mk-page">
            <p class="muted small">
                Pi uses one key at a time for each provider. Every provider here has its own pool and its own mode, and
                the keys stay on this server.
            </p>

            ${error !== null ? html`<div class="error-box">${error}</div>` : null}

            <input
                class="mk-input mk-search"
                type="search"
                placeholder="Search providers"
                value=${query}
                onInput=${(event) => setQuery(event.currentTarget.value)}
            />

            ${
                groups.length === 0
                    ? html`<p class="muted small">
                      ${
                          query.trim() === ""
                              ? "Pi's list of providers has not arrived yet: it comes with Pi's next request."
                              : `No provider matches “${query}”.`
                      }
                  </p>`
                    : groups.map(
                          ([title, rows]) => html`<div class="mk-group">
                          <div class="mk-group-title">${title}</div>
                          ${rows.map((provider) => item(provider))}
                      </div>`,
                      )
            }

            ${other}

            <p class="muted small">
                Timing and the balance metric are under Menu → Extensions. The keys are in
                <span class="mono">multikey/keys.json</span> in Pi Pocket's data folder.
            </p>
        </div>`;
    }

    pocket.page({ id: "keys", title: "API keys", component: ApiKeys });

    // A sheet on the menu, under Pi's own "Providers" row: the pools are one tap from the menu, in the place that
    // Providers takes. Pi does not let a module put rows inside that sheet.
    pocket.sheet({ id: "pools", title: "API key pools", component: ApiKeys, wide: true });
    pocket.menu({
        id: "pools",
        label: "API key pools",
        hint: "several keys per provider",
        sheet: "pools",
    });

    pocket.rail({ id: "keys", title: "API keys", icon: "key", page: "keys" });
    pocket.launcher({
        id: "keys",
        label: "API keys",
        detail: "key pools for one provider",
        icon: "key",
        page: "keys",
    });
}
