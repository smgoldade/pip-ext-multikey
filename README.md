# pip-ext-multikey

**Keeps several API keys for one provider, so a key that is spent, refused, or rate-limited never stops the work.**
A [Pi Pocket](https://github.com/TannerMidd/pi-pocket) extension. By **Steven Goldade** —
https://github.com/smgoldade/pip-ext-multikey

Two keys for the same provider is common: a work account and a personal one, a key per billing account, or a key that
is nearly out of credit beside a fresh one. Pi takes one key per provider, so without this module the only way to
switch is to edit the key by hand and restart.

> This paragraph is what the Extensions sheet shows (the module's first sentence), and the first paragraph of
> `multikey.ts` is what a gallery entry publishes as its description. Both are written to stand alone.

## What it does

- **Lists Pi's providers the way Menu → Providers does**: every provider with its name, its model count, a pill for
  Pi's own key (`Pi key sk-ant-…4f2c`), its key count, and its mode, with a search field.
- **Shows the keys Pi already has**, and moves them in: **Take it into the pool** copies the key that Menu →
  Providers holds into the pool and signs that provider out of Pi's own store, so one panel holds every key.
- **Add many keys for one provider**, each with a name of your own. Each provider has its own pool and its own mode.
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

Keys are added, marked used up, reset, and removed in one place: a **popup**, the wide sheet that Menu → Providers
opens. Three ways in — **Menu → API key pools** (right under Providers), the **API keys** button on the rail, and the
launcher — all open it. A row's button opens its panel inside it, with the mode, the keys, Pi's own key, and the form
that adds the next key.

Pi Pocket does not let a module put rows inside **Menu → Providers**: that sheet is core, and a module can add menu
rows, pages, sheets, panels, status items, and buttons, but not a section of a core sheet. The pools' sheet takes the
same place in the flow and lists the provider next to the warning about Pi's own sign-in, so the two are used side by
side: sign-in in Providers, keys in the pool.

## Install

1. Copy these into Pi Pocket's drop-in folder, `~/.pi-pocket/extensions/` (on Windows,
   `%USERPROFILE%\.pi-pocket\extensions\`):

    | What                  | Why                                                                             |
    | --------------------- | ------------------------------------------------------------------------------- |
    | `multikey.ts`         | the module                                                                      |
    | `_multikey-policy.ts` | the rules it uses; the leading `_` keeps it from loading as a module of its own |
    | `_multikey-probes.ts` | the three providers that state a balance; a helper too                          |
    | `multikey/` (folder)  | the popup: `index.js` and `style.css`                                           |

    On macOS or Linux:

        cp multikey.ts _multikey-policy.ts _multikey-probes.ts ~/.pi-pocket/extensions/
        cp -r multikey ~/.pi-pocket/extensions/

    The folder must sit next to the module, not one level deeper: Pi Pocket serves a browser module only from beside
    its module.

2. Reload Pi Pocket in the browser, then turn on **API key pools** in **Menu → Extensions**. A drop-in starts off.
3. Open **Menu → API key pools**, tap **API keys** on the rail, or find it in the launcher: all three open the same
   popup. It lists the providers that Pi knows. Open a provider's row, give the key a name, and paste the key. A
   provider that Pi does not list yet, such as an endpoint of your own, comes from **Another provider** at the end.

Nothing else is needed: Pi Pocket links its packages into the drop-in folder, and this module imports only
`@earendil-works/pi-durable`.

## Using it

### The list

The list has three groups, like Providers has its own:

- **Your pools**: the providers with keys. The row says how many keys, and the mode.
- **Signed in in Pi**: a provider that has a sign-in in Menu → Providers and no pool.
- **Other providers**: everything else that Pi lists.

The popup is laid out like Menu → Providers, without its Subagent models column: the same search box, the same group
headings with their counts, and the same bordered list of rows. A row says the provider's name and its pills
(`signed in`, `2 keys`, `balanced`), then its model count and id, and a button on the right — **Add key**, or
**Keys** when it has a pool.

That button opens the row's **panel under it**, with the same tint and slide as a provider's sign-in in Providers. The
panel holds the pool's mode, its keys with their buttons, the form for the next key, and Remove the pool. **Another
provider** is a group of its own at the end, for an id that Pi does not list yet; a custom endpoint gets its id from
Menu → Providers, under its OpenAI Compatible row.

Those parts draw with Pi Pocket's own class names (`search`, `provider-group`, `sheet-list`, `provider`,
`provider-panel`, …), so the page follows the theme, the phone layout, and the sheet's width. The module's own
stylesheet covers only what is new: the pills, the key rows, and the form. If a Pi Pocket update renames those
classes, the page keeps working and loses only their look.

Pi's list arrives with Pi's next request: the module reads it from the model runtime, which it can reach only while
a request runs. Until then the list holds the providers it learned another way (Pi's sign-ins and catalogs on disk),
and the next start has the full list from before.

### A pool

A pool is all the keys of one provider. Adding the first key makes the pool, and puts that key in force at once, so
the next message in any session uses it.

Each provider has its own mode, set at the top of its panel: **sequential** or **balanced**. It has no effect until
the pool has two keys.

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

    new session  ──► the key that carries the least for its share ──► kept while it works
    new subagent ──► the key that carries the least for its share ──► kept while it works

**First, the real balance.** For a provider that states what a key has left, the pool balances on that, and not on
its own meters:

| Provider        | What it answers                                         | Shown as            |
| --------------- | ------------------------------------------------------- | ------------------- |
| OpenRouter      | `GET /api/v1/key`: the key's own limit and what is left | `4.50 credits left` |
| DeepSeek        | `GET /user/balance`: the account's balance              | `110.00 CNY left`   |
| Moonshot (Kimi) | `GET /v1/users/me/balance`: the available balance       | `12.34 CNY left`    |

The page shows each key's balance, when it was read, and a **Refresh balance** button. A key whose provider says it is
empty is not used for new work, with no mark put on it: topping the account up brings it back by itself. **Menu →
Extensions** can ask every 15 minutes (the default), or only when you press Refresh.

For every other provider the module has no endpoint to read, so it balances on what it can see itself:

Four things decide it:

1. **A window, not a lifetime.** The pool evens out what each key carried _this month_ (or this day, or its whole life
   if you say so). A monthly quota comes back, so last month's spend does not weigh on this one.
2. **A share per key.** A key with share 2 takes twice the work of share 1: a $50 account beside a $5 one should carry
   ten times as much, not the same. Share 1 everywhere is an even split.
3. **A margin.** Another key takes over only when it is lighter by the margin (25% by default). Every switch costs the
   provider's prompt cache, so a small gain is not worth it.
4. **Quiet moments only.** The key in force never changes while another conversation of the same provider has a request
   in flight: Pi reads the key when a request starts, so switching then would send one request with the wrong key. The
   switch waits for the next request that starts alone.

A conversation keeps its key while that key works, however heavy it gets: a swap in the middle of a session throws
away the prompt cache. Usage is booked to the key that really carried each request, so a request that went out in a
shared moment does not distort the counts. A conversation the pool forgets (after 30 days, or beyond the newest 300)
takes a new key when it comes back.

The metric is **cost**, from Pi's own prices, which is the closest thing to a quota; a model with no price falls back
to tokens (input, output, and cache). **Menu → Extensions → API key pools** can count tokens or requests instead.

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

| Setting                                                  | Default   | What it does                                                 |
| -------------------------------------------------------- | --------- | ------------------------------------------------------------ |
| Tell me when a key is used up, or when a pool switches   | on        | a notice in the app                                          |
| What the balanced mode evens out                         | cost      | cost (tokens when a model has no price), tokens, or requests |
| The balanced mode starts again                           | monthly   | each month, each day, or never                               |
| Switch keys only when another is lighter by              | 25%       | any gain, 10%, 25%, or 50%                                   |
| Ask the provider what a key has left, every (minutes)    | 15        | OpenRouter, DeepSeek, Moonshot; 0 asks only on Refresh       |
| Minutes a key rests after the provider asks to slow down | 10        | 0 puts it straight back to work                              |
| Hours until a used-up key is tried again                 | 0 (never) | for quotas that come back, such as a month                   |

## Limits

Read these before you rely on a pool.

1. **One key is in force at a time, for the whole app.** Pi composes one API key per provider, so a pool switches
   _the_ key, not a key per request. Two sessions that run at the same time both use the key that was in force when
   each request started: each session's own key is put back before its next request, but a request that starts in the
   same instant as another session's switch may go out with the other key. In practice the mode holds; it is not a
   hard guarantee.
2. **A pool's key goes out in place of Pi's own API key, which stays stored.** Pi resolves a stored sign-in before
   a registration, so the module adds the header that carries the key for the provider's API (`x-api-key`,
   `Authorization`, or `x-goog-api-key`); a header of a registration goes over both. Menu → Providers still lists
   the provider as signed in, and signing out there changes nothing while a pool key is in force. The module reads
   the provider names and the _kind_ of sign-in in Pi's `auth.json`, never a key.
3. **A subscription sign-in keeps its place.** When Pi is signed in to a provider with a subscription (an OAuth
   token, such as Claude Pro/Max or a ChatGPT plan), its token is not an API key, and a key in its place would break
   the requests. The pool stays idle for that provider, and the page says so: sign out there to use the pool.
4. **Built-in providers and your own `models.json` endpoints keep their model list.** A provider that a _Pi extension_
   registers itself (a "native" provider) loses its model list as soon as a pool registers a key for it, because Pi
   drops a native provider when a configuration replaces it. Do not make a pool for one.
5. **The first request after a restart** may use the key that was in force before it: the module learns which
   provider a session talks to from that session's own requests. In balanced mode it then pins the session to that
   key, which is the key the request really used.
6. **A key is stored in plain text** in `<data folder>/multikey/keys.json`. The file is mode 0600 and Pi Pocket's
   data folder is private, but anyone who can read that folder can read the keys.
7. **A key is not checked when you add it.** A wrong key shows up as a failed request, and is then retired as "the
   provider refused this key".

## What it reads and writes

| Where                                             | What                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `<data folder>/multikey/keys.json`                | the pools, the keys themselves, the counters                                                  |
| `~/.pi/agent/auth.json`                           | provider names and kinds; an API key's value, to show a hint of it and to move it into a pool |
| `~/.pi/agent/models-store.json` and `models.json` | the provider names only, to suggest them in the page                                          |

It sends nothing anywhere except that check: for OpenRouter, DeepSeek, and Moonshot, a key is sent to that
provider's own balance endpoint (`openrouter.ai/api/v1/key`, `api.deepseek.com/user/balance`,
`api.moonshot.ai` or `api.moonshot.cn/v1/users/me/balance`), and nowhere else. A key reaches its provider in the
request that Pi builds, as any key does.

## How it works

For Pi Pocket extension authors:

- `host.registerModelProvider(provider, { apiKey })` _replaces the key of a provider_ and nothing else: with no
  `baseUrl` and no `models`, Pi keeps the provider's catalog, endpoint, and API.
- A stored sign-in still wins over the `apiKey` of a registration, so the registration also carries the header that
  the provider's API reads its key from: `x-api-key` for `anthropic-messages`, `x-goog-api-key` for Google,
  `api-key` for Azure, `Authorization: Bearer` for the rest. A registration's `headers` go over both. The API comes
  from a request's model, or from the catalog read in a hook, and is kept in `multikey/providers.json`.
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
