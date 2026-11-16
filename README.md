# pip-ext-multikey

API key pools for [Pi Pocket](https://github.com/TannerMidd/pi-pocket): **several API keys for one provider**, used
one at a time — either until one runs out, or spread across sessions.

Two keys for the same provider is common: a work account and a personal one, a key per billing account, or a key that
is nearly out of credit beside a fresh one. Pi takes one key per provider, so without this module the only way to
switch is to edit the key by hand and restart.

## What it does

- **Add many keys for one provider**, each with a name of your own.
- **Sequential mode**: a key stays in force until the provider says its quota or credit is gone, then the next key
  takes over. You lose one aborted request, not the run: Pi retries, and the retry uses the new key.
- **Balanced mode**: each new session or subagent gets the key that has carried the least so far, and keeps it while
  it works, so the provider's prompt cache lasts. Balance by tokens, requests, or cost.
- **Knows a used-up key from a paused one.** "No credit left", "quota exceeded", 402, a refused or revoked key: the
  key is retired until you bring it back. A rate limit or "overloaded": the key rests for a while, then works again.
  Anything else, such as a context that is too long, leaves the key alone.
- **Shows what each key carried**: requests, tokens, cost, when it last worked, why it is resting.
- **Keeps the keys on the server.** The page shows a mask such as `sk-ant-…4f2c` and nothing more, and every key
  is hidden from Pi and from the transcript.
- **Says when it switches**, with a notice in the app.

Keys are added, marked used up, reset, and removed on the **API keys** page on the rail.

## Install

1. Copy these into Pi Pocket's drop-in folder, `~/.pi-pocket/extensions/` (on Windows,
   `%USERPROFILE%\.pi-pocket\extensions\`):

    | What                  | Why                                                                             |
    | --------------------- | ------------------------------------------------------------------------------- |
    | `multikey.ts`         | the module                                                                      |
    | `_multikey-policy.ts` | the rules it uses; the leading `_` keeps it from loading as a module of its own |
    | `multikey/` (folder)  | the page: `index.js` and `style.css`                                            |

    On macOS or Linux:

        cp multikey.ts _multikey-policy.ts ~/.pi-pocket/extensions/
        cp -r multikey ~/.pi-pocket/extensions/

    The folder must sit next to the module, not one level deeper: Pi Pocket serves a browser module only from beside
    its module.

2. Reload Pi Pocket in the browser, then turn on **API key pools** in **Menu → Extensions**. A drop-in starts off.
3. Use the **API keys** button on the rail. Type the provider as Pi knows it (`anthropic`, `openai`,
   `openrouter`, `deepseek`, …), a name for the key, and the key itself. The provider field suggests the names that
   Pi's own catalog, sign-ins, and endpoints know.

Nothing else is needed: Pi Pocket links its packages into the drop-in folder, and this module imports only
`@earendil-works/pi-durable`.

## Using it

### A pool

A pool is all the keys of one provider. Adding the first key makes the pool, and puts that key in force at once, so
the next message in any session uses it.

Each key row shows its name, a hint of the key, what it carried, and these buttons:

- **Use now** puts this key in force, whatever the mode would choose, and clears its used-up and resting marks.
- **Used up** retires the key by hand, for a spent plan or an error that does not say so. **Bring back** clears it.
- **Reset usage** sets the counters to zero and clears the marks: a fresh start for the balance.
- **Remove** forgets the key. Removing the last key of a pool forgets the pool, and gives the provider back to Pi's
  own sign-in.

### Sequential

    key one ─────────────► used up ──► key two ─────────────► used up ──► key three

The key in force stays until the provider turns it down, then the next key in the list takes over. The order is the
list order, wrapping at the end, and it skips keys that are used up or resting.

### Balanced

    new session  ──► the key that carried the least ──► kept for that session
    new subagent ──► the key that carried the least ──► kept for that subagent

A new conversation takes the lightest key at its first request and keeps it while it works: a swap in the middle of
a session throws away the provider's prompt cache, which costs more than the imbalance. A conversation that the pool
forgets (after 30 days, or beyond the newest 300) takes a new key when it comes back.

The weight is tokens (input, output, and cache) by default. **Menu → Extensions → API key pools** can count requests
or cost instead.

### What counts as used up

The module reads what the provider said about a failed request:

| What the provider said                                                                                     | What happens                                           |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `insufficient_quota`, "credit balance is too low", "payment required", 402, "spend limit", "monthly limit" | the key is retired                                     |
| `invalid` or `incorrect api key`, "unauthorized", "revoked", "disabled", 401, 403                          | the key is retired                                     |
| `rate_limit`, "too many requests", "overloaded", 429, 503                                                  | the key rests for the cooldown (10 minutes by default) |
| anything else: too long a context, a bad request, a network drop, a 500                                    | nothing changes                                        |

A retired key comes back by hand, or by itself: **Hours until a used-up key is tried again** (off by default) gives a
monthly quota a second chance.

### Settings

**Menu → Extensions → API key pools**:

| Setting                                                  | Default   | What it does                               |
| -------------------------------------------------------- | --------- | ------------------------------------------ |
| Tell me when a key is used up, or when a pool switches   | on        | a notice in the app                        |
| What the balanced mode evens out                         | tokens    | tokens, requests, or cost                  |
| Minutes a key rests after the provider asks to slow down | 10        | 0 puts it straight back to work            |
| Hours until a used-up key is tried again                 | 0 (never) | for quotas that come back, such as a month |

## Limits

Read these before you rely on a pool.

1. **One key is in force at a time, for the whole app.** Pi composes one API key per provider, so a pool switches
   _the_ key, not a key per request. Two sessions that run at the same time both use the key that was in force when
   each request started: each session's own key is put back before its next request, but a request that starts in the
   same instant as another session's switch may go out with the other key. In practice the mode holds; it is not a
   hard guarantee.
2. **A key that Pi itself has stored wins.** If you signed in to a provider in **Menu → Providers** with an API key,
   Pi sends that key before any that this module registers, and the pool does nothing for that provider. The page
   says so when it sees one: sign out there, and the pool takes over. The module reads the provider _names_ in Pi's
   `auth.json` for that warning, never a key.
3. **Built-in providers and your own `models.json` endpoints keep their model list.** A provider that a _Pi extension_
   registers itself (a "native" provider) loses its model list as soon as a pool registers a key for it, because Pi
   drops a native provider when a configuration replaces it. Do not make a pool for one.
4. **The first request after a restart** may use the key that was in force before it: the module learns which
   provider a session talks to from that session's own requests. In balanced mode it then pins the session to that
   key, which is the key the request really used.
5. **A key is stored in plain text** in `<data folder>/multikey/keys.json`. The file is mode 0600 and Pi Pocket's
   data folder is private, but anyone who can read that folder can read the keys.
6. **A key is not checked when you add it.** A wrong key shows up as a failed request, and is then retired as "the
   provider refused this key".

## What it reads and writes

| Where                                             | What                                                 |
| ------------------------------------------------- | ---------------------------------------------------- |
| `<data folder>/multikey/keys.json`                | the pools, the keys themselves, the counters         |
| `~/.pi/agent/auth.json`                           | the provider names only, for the warning above       |
| `~/.pi/agent/models-store.json` and `models.json` | the provider names only, to suggest them in the page |

It sends nothing anywhere. A key reaches only the provider, in the request that Pi builds, as any key does.

## How it works

For Pi Pocket extension authors:

- `host.registerModelProvider(provider, { apiKey })` _replaces the key of a provider_ and nothing else: with no
  `baseUrl` and no `models`, Pi keeps the provider's catalog, endpoint, and API. That is the whole trick.
- The newest registration is in force. A switch registers the new key and then gives the one before back, so the
  stack stays one deep and a reload never leaves two keys behind.
- `hook(GenerationTask)`:
    - `beforeRequest` runs before Pi resolves the key, so a switch made there is the key the request uses.
    - `beforeProviderRequest` is the only hook that names the model, so it teaches the module which provider a
      conversation talks to.
    - `afterResponse` has the usage and the error: there a key is counted, or retired.
- The state is a file, not a Pi Durable document, because the module needs it while it loads, before any request or
  hook exists: documents can be read only inside a request or a hook.
- The rules live in `_multikey-policy.ts`, which uses nothing of Pi's, so they can be tested on their own. Pi Pocket
  does not load a helper again when it changes: a change there needs a server restart.

## Development

    npm install
    npm test

- `test/policy.test.ts` checks the rules: which key comes next, what a failure means, what a file may hold.
- `test/module.test.ts` loads the module against a fake host and web part, and plays requests, answers, and routes
  through it.
- `test/runtime.test.ts` asks Pi's own model runtime the three questions the module depends on: a provider keeps its
  models when only a key is registered, the newest registration is the key in force, and a stored sign-in still wins.
  It needs Pi Pocket's packages beside the checkout, and skips without them:

        # Windows: a junction to an installed or checked-out Pi Pocket
        mklink /J node_modules C:\path\to\pi-pocket\node_modules
        # macOS and Linux
        ln -s /path/to/pi-pocket/node_modules node_modules

- `npm run check` type-checks the module.

## License

MIT. Not affiliated with Pi, Earendil Works, or Pi Pocket.
