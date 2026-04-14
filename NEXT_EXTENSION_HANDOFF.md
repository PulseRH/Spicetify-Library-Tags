# Handoff for next extension — colored-tag pills

Knowledge transferred from building `sort-by-others` (in this same repo). Pick this up in a fresh session for a new extension.

## What the user wants to build

A Spicetify extension that lets the user **tag playlists and folders** with named, colored labels and **filter the library by tag**.

- Right-click a playlist or folder → context menu lets you toggle tags on/off for that item.
- Each tag has a **name** and a **colored dot**.
- Tags appear as **filter pills** in the library filter row, alongside Spotify's own chips. Each pill shows the tag's colored dot.
- Up to **8 default tag slots**, plus a button (also in the context menu) to **create another tag** with a custom name.
- Activating a pill filters the library to items carrying that tag (combine with sort-by-others-style additive logic if it makes sense).

The user has not specified persistence yet — assume `Spicetify.LocalStorage` keyed by playlist/folder URI.

## Why this repo is the right starting point

The existing `src/app.tsx` already solves the hardest plumbing:
- Inserting a chip into Spotify's filter listbox, with native-matching styles.
- Hooking React fibers to read filter state and trigger re-fetches.
- Monkey-patching `LibraryAPI.getContents` to filter at the data layer (CSS hiding does **not** work — see "Virtualized grid" below).
- Reconstructing `selectedFilters` / `availableFilters` so the UI stays in sync.

Read `src/app.tsx` end-to-end before designing. Most patterns transfer directly.

## Project setup (Spicetify-creator)

```
package.json     → spicetify-creator scripts
src/app.tsx      → entry point, default-exports an async main()
src/settings.json → extension metadata
tsconfig.json
```

Build/dev:
```bash
npm run build            # → dist/
npm run watch            # rebuild on save
```

After build, copy the JS from `dist/` into Spicetify's Extensions folder, then:
```bash
spicetify config extensions <name>.js
spicetify apply
```

**Spotify must be FULLY CLOSED and REOPENED** after every extension change. A reload (Ctrl+R) does not pick up extension code. This is the single biggest time-sink if you forget.

## Debugging via CDP (essential)

Spotify's Chromium runtime exposes CDP on `localhost:9222` if launched with `--remote-debugging-port=9222`. Recreate the helper:

```js
// .cdp_eval.js — usage: node .cdp_eval.js "javascript expression"
const WebSocket = require('ws');
const http = require('http');
const expr = process.argv[2];
http.get('http://localhost:9222/json', res => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    const ws = new WebSocket(JSON.parse(d)[0].webSocketDebuggerUrl);
    ws.on('open', () => ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression: `(async () => { ${expr} })()`,
        awaitPromise: true, returnByValue: true }
    })));
    ws.on('message', m => {
      const r = JSON.parse(m).result?.result;
      console.log(JSON.stringify(r?.value, null, 2)); ws.close();
    });
  });
});
```

Add `ws` via `npm i -D ws`. Use it for: inspecting fibers, calling `toggleFilterId` manually, dumping `getContents` results, reading DOM. Delete before shipping.

## Spotify internals you'll use

### `Spicetify.Platform.LibraryAPI`
- `.getContents({ filters?: string[], folderUri?, offset?, limit?, ... })` — returns `{ items, totalLength, selectedFilters, availableFilters, ... }`.
- `items` may include `type: "playlist"` and `type: "folder"`.
- Each playlist has `uri`, `name`, `owner.uri`. Each folder has `uri` like `spotify:user:<me>:folder:<hex>`.
- Filter IDs are **strings** but callers sometimes pass numbers — normalize with `String(x)`.

### `Spicetify.Platform.RootlistAPI`
- `.getContents()` returns the playlist tree as nested folders/playlists. Use this to enumerate all playlists for tag indexing.
- Folders contain a nested `items` array — recurse.

### `Spicetify.Platform.UserAPI.getUser()` → current user URI.

### Built-in filter IDs (discovered, not documented)
- Top-level: `0` Albums, `1` Artists, `2` Playlists, `3` Podcasts, `4` Audiobooks, `100` Downloaded
- Playlists sub-filters (only available when `2` is selected, OR inside a folder): `102` By you, `103` By Spotify, `107` Mixed, `100` Downloaded

Pick a numeric range for your own tag filter IDs that won't collide. Anything ≥ `1000` is safe.

### `Spicetify.ContextMenu` (you'll need this — sort-by-others doesn't use it)
```ts
new Spicetify.ContextMenu.Item(
  "Tag: Friends",          // label
  (uris) => { /* onClick */ },
  (uris) => true,           // shouldAdd predicate (filter by URI type)
  Spicetify.SVGIcons.tag,   // icon
  /* disabled */ false
).register();

new Spicetify.ContextMenu.SubMenu(
  "Tags",
  [item1, item2, /* ... */],
  (uris) => true
).register();
```
- `uris` is an array of `spotify:playlist:...` or `spotify:user:...:folder:...` etc.
- Filter `shouldAdd` to only show on playlist/folder URIs.
- For a checkable item, you'll need to rebuild the menu on every open or use the trick of registering one item per state. There's no native checkbox — the convention is to prefix the label with `✓ ` when active.
- A "Create new tag" item lives at the bottom of the submenu, opens a small prompt UI.

### `Spicetify.LocalStorage`
- `get(key)` / `set(key, value)` / `remove(key)`. Strings only — JSON.stringify your state.
- Suggested schema:
  ```json
  {
    "tags": [{ "id": "t1", "name": "Friends", "color": "#ff5577" }, ...],
    "assignments": { "spotify:playlist:abc": ["t1", "t3"], "spotify:user:me:folder:xyz": ["t2"] }
  }
  ```
- Wrap in a small store module with `subscribe` so the chip row and context menu both react.

### `Spicetify.Popup` / `Spicetify.PopupModal`
For "create new tag" / "rename tag" UIs. Render a tiny React form with a name input and color swatches.

## Patterns to lift directly from `src/app.tsx`

### 1. Filter chip insertion (lines ~360–426)
`buildAndInsertChip` builds a chip, copies styling classes from a sibling chip via `getChipStyles`, inserts it in the listbox `[role="listbox"][aria-label="Filter options"]`, and wires a `pointerdown` handler with `stopImmediatePropagation` (Spotify's own listeners would otherwise interfere).

For colored dots: prepend a `<span>` with `display:inline-block; width:8px; height:8px; border-radius:50%; background:<color>; margin-right:6px;` inside the chip's text span.

### 2. React fiber traversal (lines ~78–98)
`findFilterFiberProps()` walks `__reactFiber*` up to 80 ancestors looking for `memoizedProps.toggleFilterId`. That props bag also has `selectedFilters` and `availableFilters`. This is how you read/write filter state without a public API.

### 3. `getContents` monkey-patch (lines ~136–232)
When any of your tag pills is active:
- Call `origGetContents` with the caller's params, but **strip your own filter IDs** from `params.filters` first.
- Filter `result.items` locally by `assignments[item.uri]` membership.
- Reconstruct `selectedFilters` from the caller's filters using a name cache (your tag IDs won't appear in the server's response).
- Filter `availableFilters` to remove anything already in `selectedFilters` (otherwise duplicate chips appear).

Folder handling: `if (item.type === "folder") return true;` lets folders through unconditionally so navigation works. A "proper" version recurses RootlistAPI to only show folders that contain ≥1 tagged item — implement only if the simple version feels wrong.

### 4. Force re-fetch (lines ~282–322)
After flipping tag state, the library doesn't know to re-query. Solution: toggle an **unrelated** top-level filter on, wait for React to commit (`waitForFilterChange`), then toggle it back off. Pick a candidate that's currently OFF so the net is no-op. **Don't toggle Playlists itself** — it nukes the sub-filter chips.

Inside folders, top-level candidates like `0` (Albums) return 0 items and cause an empty flash — prefer sub-filter candidates (`102`/`103`) when `'2'` isn't in `selectedFilters` (the in-folder signal).

### 5. Lifecycle observer (lines ~428–476)
The filter listbox is destroyed and recreated on navigation. A 500ms `setInterval` poll for the listbox is much cheaper than a `MutationObserver` on `document.body` (which fires on every virtualizer row swap during scroll — that bug bit us).

`MutationObserver` on the listbox itself, watching `aria-checked` attribute changes, is the right tool for reacting to chip-state changes within a stable listbox.

## Pitfalls (learned the hard way)

1. **Virtualized grid**: Spotify's library is a virtualized grid (`grid-template-rows` reserves the full height; only ~60 rows render near scroll position). **CSS `display:none` does not work** — filtered-out rows leave gaps until you scroll past the virtualizer window. Always filter at the data layer (`getContents`).

2. **Filter ID type coercion**: filter IDs are sometimes numbers, sometimes strings. Always normalize with `String(x)` before set/map operations.

3. **`selectedFilters` round-trip**: the `getContents` response's `selectedFilters` overrides React state on every call. If you strip an ID from the underlying call, the response won't include it, and the chip will appear deselected. Reconstruct from the caller's intent + a name cache populated from prior responses.

4. **Duplicate chips**: an ID present in both `selectedFilters` and `availableFilters` of the response will render twice. Filter `availableFilters` to exclude anything in `selectedFilters`.

5. **Refetch timing**: `setTimeout(..., 40)` is too short for React to commit `toggleFilterId` state. Use a polling `waitForFilterChange` instead of fixed delays — robust against varying React commit times.

6. **Don't trust `MutationObserver` on body during scroll** — the virtualizer churns the DOM constantly. Scope observers tightly.

7. **Other extensions can break things**: in `sort-by-others` we chased a "rows unload at top of library" bug for an hour before A/B testing (replace `app.tsx` with a noop and reproduce). Turned out to be `folderArtwork.js`. **Always A/B test scroll/render bugs before patching.**

8. **Spotify must fully close + reopen** to pick up extension changes. Reload (Ctrl+R) doesn't work.

## Suggested implementation order

1. Tag store (LocalStorage + a tiny pub/sub) with default 8 tags pre-seeded.
2. Context menu items: "Tags ►" submenu showing all tags with `✓` prefix when assigned, plus "Create new tag…" at the bottom.
3. "Create new tag" modal (name + color picker — 8 swatches is fine).
4. Inject one chip per active tag into the filter listbox (lift `buildAndInsertChip`, add the colored dot).
5. Monkey-patch `getContents` to filter by tag assignments (lift the pattern from `installGetContentsPatch`).
6. Lift `forceLibraryRefetch` for re-querying when a tag pill is toggled.
7. Settings page (use `spcr-settings` or roll your own) for tag rename/delete/reorder.

## Files in this repo to study before starting

- `src/app.tsx` — every pattern above lives here, with comments explaining the why. ~480 lines, read it all.
- `src/settings.json` — Spicetify extension manifest format.
- `package.json` — minimal Spicetify-creator setup.
