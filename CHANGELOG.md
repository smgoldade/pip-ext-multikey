# Changelog

## 1.6.0

- **The pools open as a popup everywhere.** The rail button, the menu row, and the launcher now all open the same wide
  sheet that Menu → Providers opens, so there is one screen and no full page. The sheet keeps its title, its width of
  760 px on a wide screen, and its place in the flow beside Providers.

## 1.5.0

- **Pi's own keys show in the pool panel.** A provider that Menu → Providers signed in with an API key now shows a
  `Pi key sk-ant-…4f2c` pill on its row, and the panel shows the key with a hint, plus **Take it into the pool**.
- **Take it into the pool** copies Pi's key into the pool as `From Pi` and signs that provider out of Pi's own store
  through Pi's own sign-out call, so one panel holds every key. A subscription sign-in is explained instead.
- **A description that reads well in the Extensions sheet**, and an author: **Steven Goldade**.

## 1.4.0

- **The page now uses Menu → Providers' own layout**: the same search box, the same group headings with their counts,
  and the same bordered list of rows, each with a button on the right (**Add key**, or **Keys**).
- A row's panel opens under it with the same tint and slide as a provider's sign-in in Providers, and holds the mode,
  the keys, the form for the next key, and Remove the pool. The Subagent models column is not there.
- The page draws with Pi Pocket's classes for those parts, so it follows the theme and the phone layout.

## 1.3.0

- **A pool's key now goes out in place of Pi's own API key**, by carrying the header that the provider's API reads its
  key from. A subscription sign-in is left alone.
- **Rows open in place**, as in Menu → Providers: no second page.

## 1.2.0

- **The page lists Pi's providers**, with the groups "Your pools", "Signed in in Pi", and "Other providers". Pi's
  provider list is read from the model runtime in a hook and kept in `multikey/providers.json`.

## 1.1.0

- **Menu → API key pools**: the pools open as a sheet from the menu, right under Pi's own Providers row.

## 1.0.0

- Key pools for one provider: several API keys, used one at a time.
- Sequential mode: a key stays in force until the provider says its quota or credit is gone.
- Balanced mode: each new session or subagent takes the key that carried the least, and keeps it.
- A key is retired when the provider refuses it or its quota is gone, and rests after a rate limit.
- Usage per key: requests, tokens, cost. Resettable.
- An **API keys** page on the rail, with add, use now, used up, bring back, reset, remove, and remove the pool.
- Four settings: notices, balance metric, cooldown, and recovery.
- Keys are hidden from Pi and from the transcript, and no route returns one.
