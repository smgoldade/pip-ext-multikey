# Changelog

## 1.4.0

- **The page now uses Menu → Providers' own layout**: the same search box, the same group headings with their counts,
  and the same bordered list of rows. Each row is a provider with its name and pills, its model count and id, and a
  button on the right (**Add key**, or **Keys**), like the **API key** button there.
- A row's panel opens under it with the same tint and slide as a provider's sign-in in Providers, and holds the mode,
  the keys, the form for the next key, and Remove the pool. The Subagent models column is not there, as asked.
- The page draws with Pi Pocket's classes for those parts (search, provider-group, sheet-list, provider,
  provider-panel), so it follows the theme and the phone layout of the real sheet. This module's stylesheet now
  covers only what is new: the pills, the key rows, and the form.

## 1.3.0

- **A pool's key now goes out in place of Pi's own API key.** Pi resolves a stored sign-in before a registration, so
  the registration carries the header that the provider's API reads its key from (measured against Pi's own runtime).
  Pi's stored key stays where it is; Menu → Providers still shows the provider as signed in.
- **A subscription sign-in is left alone.** A token for a plan is not an API key, so a pool stays idle for that
  provider, and the page says why.
- **Rows open in place, as in Menu → Providers**: a row shows the provider, its chips, and its mode, and opening it
  gives the mode, the keys, the buttons, and the form that adds the next key. No second page.
- The client's page is covered by tests that draw the list, a pool, the "another provider" row, and a subscription
  sign-in.

## 1.2.0

- **The page lists Pi's providers**, in the shape of Menu → Providers: a search field, and the groups "Your pools",
  "Signed in in Pi", and "Other providers", with each provider's name, model count, sign-in state, key count, and
  mode. A provider is picked from that list; typing an id by hand is now only the "Another provider" row at the end.
- Pi's provider list is read from the model runtime in a hook, and kept in `multikey/providers.json` for the next start.

## 1.1.0

- **Menu → API key pools**: the pools open as a sheet from the menu, right under Pi's own Providers row. The rail
  button and the page are still there, with the same list.
- Pi Pocket does not let a module add rows inside the Providers sheet itself; the README says what it allows instead.

## 1.0.0

- Key pools for one provider: several API keys, used one at a time.
- Sequential mode: a key stays in force until the provider says its quota or credit is gone.
- Balanced mode: each new session or subagent takes the key that carried the least, and keeps it.
- A key is retired when the provider refuses it or its quota is gone, and rests after a rate limit.
- Usage per key: requests, tokens, cost. Resettable.
- An **API keys** page on the rail, with add, use now, used up, bring back, reset, remove, and remove the pool.
- Four settings: notices, balance metric, cooldown, and recovery.
- Keys are hidden from Pi and from the transcript, and no route returns one.
