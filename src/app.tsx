declare const Spicetify: any;

// ============================================================
// Constants
// ============================================================

const STORAGE_KEY = "library-tags:state";
const CHIP_PREFIX = "library-tag-chip-";
const MAX_TAGS = 8;

// 8 swatches for the color picker. First is the default for the seed tag.
const TAG_COLORS = [
  "#1db954", // Spotify green
  "#ff5577", // pink
  "#5570ff", // blue
  "#ffaa22", // orange
  "#bb55ff", // purple
  "#22ccdd", // cyan
  "#ffee55", // yellow
  "#b0b0b0", // gray
];

// ============================================================
// Types
// ============================================================

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface StoreState {
  tags: Tag[];
  // uri -> tag id[]
  assignments: Record<string, string[]>;
}

// ============================================================
// Tag store (LocalStorage + pub/sub)
// ============================================================

type Unsubscribe = () => void;

class TagStore {
  private state: StoreState = { tags: [], assignments: {} };
  private listeners = new Set<() => void>();

  load() {
    try {
      const raw = Spicetify.LocalStorage.get(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tags) && parsed.assignments) {
          this.state = {
            tags: parsed.tags,
            assignments: parsed.assignments,
          };
        }
      }
    } catch (e) {
      console.warn("[library-tags] Failed to load storage, starting fresh:", e);
    }
    // Seed one default tag on first run (no name — just a colored circle).
    if (this.state.tags.length === 0) {
      this.state.tags.push({
        id: this.nextId(),
        name: "",
        color: TAG_COLORS[0],
      });
      this.persist();
    }
  }

  private persist() {
    Spicetify.LocalStorage.set(STORAGE_KEY, JSON.stringify(this.state));
    for (const l of this.listeners) l();
  }

  private nextId(): string {
    const nums = this.state.tags.map((t) => parseInt(t.id, 10)).filter((n) => !Number.isNaN(n));
    const max = nums.length ? Math.max(...nums) : 999;
    return String(Math.max(1000, max + 1));
  }

  subscribe(fn: () => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getTags(): Tag[] {
    return this.state.tags.slice();
  }

  getTag(id: string): Tag | undefined {
    return this.state.tags.find((t) => t.id === id);
  }

  canCreate(): boolean {
    return this.state.tags.length < MAX_TAGS;
  }

  createTag(name: string, color: string): Tag | null {
    if (!this.canCreate()) return null;
    const tag: Tag = { id: this.nextId(), name, color };
    this.state.tags.push(tag);
    this.persist();
    return tag;
  }

  updateTag(id: string, patch: Partial<Pick<Tag, "name" | "color">>) {
    const t = this.state.tags.find((x) => x.id === id);
    if (!t) return;
    if (patch.name !== undefined) t.name = patch.name;
    if (patch.color !== undefined) t.color = patch.color;
    this.persist();
  }

  deleteTag(id: string) {
    this.state.tags = this.state.tags.filter((t) => t.id !== id);
    // Scrub assignments
    for (const uri of Object.keys(this.state.assignments)) {
      this.state.assignments[uri] = this.state.assignments[uri].filter((x) => x !== id);
      if (this.state.assignments[uri].length === 0) delete this.state.assignments[uri];
    }
    this.persist();
  }

  getAssignments(uri: string): string[] {
    return this.state.assignments[uri] || [];
  }

  hasTag(uri: string, tagId: string): boolean {
    return (this.state.assignments[uri] || []).includes(tagId);
  }

  assign(uris: string[], tagId: string) {
    for (const uri of uris) {
      const cur = new Set(this.state.assignments[uri] || []);
      cur.add(tagId);
      this.state.assignments[uri] = Array.from(cur);
    }
    this.persist();
  }

  unassign(uris: string[], tagId: string) {
    for (const uri of uris) {
      const cur = (this.state.assignments[uri] || []).filter((x) => x !== tagId);
      if (cur.length > 0) this.state.assignments[uri] = cur;
      else delete this.state.assignments[uri];
    }
    this.persist();
  }
}

const store = new TagStore();

// Active tag pills (OR semantics — union of tagged items is shown)
const activeTagIds = new Set<string>();

// ============================================================
// Chip styles (lifted from sort-by-others reference)
// ============================================================

interface ChipStyles {
  chipClass: string;
  spanClass: string;
  selectedChipClass: string;
  selectedSpanClass: string;
}

let cachedStyles: ChipStyles | null = null;

function getChipStyles(listbox: Element): ChipStyles | null {
  const isOurChip = (el: Element) => {
    const id = el.closest('[role="option"]')?.id || "";
    return id.startsWith(CHIP_PREFIX);
  };

  const unselected = Array.from(
    listbox.querySelectorAll('[data-encore-id="chip"][aria-checked="false"]')
  ).find((el) => !isOurChip(el));
  const selected = Array.from(
    listbox.querySelectorAll('[data-encore-id="chip"][aria-checked="true"]')
  ).find((el) => !isOurChip(el));

  if (unselected && selected) {
    const us = unselected.querySelector("span");
    const ss = selected.querySelector("span");
    if (us && ss) {
      cachedStyles = {
        chipClass: unselected.className,
        spanClass: us.className,
        selectedChipClass: selected.className,
        selectedSpanClass: ss.className,
      };
    }
  }

  if (cachedStyles) return cachedStyles;

  const chip =
    unselected ||
    selected ||
    Array.from(listbox.querySelectorAll('[data-encore-id="chip"]')).find((el) => !isOurChip(el));
  if (!chip) return null;
  const span = chip.querySelector("span");
  if (!span) return null;
  return {
    chipClass: chip.className,
    spanClass: span.className,
    selectedChipClass: chip.className.replace("-sm-", "-sm-selected-"),
    selectedSpanClass: span.className.replace("ChipInnerComponent-sm ", "ChipInnerComponent-sm-selected "),
  };
}

function setChipVisual(chipEl: Element, spanEl: Element, active: boolean, styles: ChipStyles) {
  chipEl.className = active ? styles.selectedChipClass : styles.chipClass;
  chipEl.setAttribute("aria-checked", active ? "true" : "false");
  spanEl.className = active ? styles.selectedSpanClass : styles.spanClass;
}

// ============================================================
// React fiber traversal (lifted)
// ============================================================

interface FilterFiberProps {
  selectedFilters?: Array<{ id: string; name: string }>;
  availableFilters?: Array<{ id: string; name: string }>;
  toggleFilterId?: (id: string) => void;
  resetFilterIds?: () => void;
}

function findFilterFiberProps(): FilterFiberProps | null {
  const lb = document.querySelector('[role="listbox"][aria-label="Filter options"]');
  if (!lb) return null;
  const fiberKey = Object.keys(lb).find((k) => k.startsWith("__reactFiber"));
  if (!fiberKey) return null;
  let fiber: any = (lb as any)[fiberKey];
  for (let i = 0; i < 80 && fiber; i++) {
    const props = fiber.memoizedProps;
    if (props && typeof props.toggleFilterId === "function") {
      return props as FilterFiberProps;
    }
    fiber = fiber.return;
  }
  return null;
}

// ============================================================
// getContents patch — filter playlists by tag assignments
// ============================================================

let origGetContents: ((params: any) => Promise<any>) | null = null;

// Flat-list cache — when a tag is active we recursively walk the folder tree,
// which means one patched getContents call can fan out into many raw calls.
// The virtualizer pages through getContents (different offset/limit each
// call) as the user scrolls, so without caching we'd re-walk the whole tree
// on every page. Keyed by folderUri + sorted activeTagIds. Short TTL so
// library mutations outside the extension become visible quickly.
interface FlatCacheEntry {
  key: string;
  ts: number;
  items: any[];
  envelope: any;
}
let flatCache: FlatCacheEntry | null = null;
const FLAT_CACHE_TTL_MS = 3000;

function flatCacheKey(params: any): string {
  const folder = params?.folderUri || "";
  const tags = Array.from(activeTagIds).sort().join(",");
  return folder + "::" + tags;
}

function invalidateFlatCache() {
  flatCache = null;
}

// Recursively collect playlist items under a folder. Folders are "unfolded"
// — only their playlist descendants appear in the result. Non-playlist items
// inside a folder (rare / shouldn't exist) are ignored at this depth.
async function collectFromFolder(folderUri: string, baseParams: any): Promise<any[]> {
  if (!origGetContents) return [];
  const res = await origGetContents({
    ...baseParams,
    folderUri,
    offset: 0,
    limit: 10000,
  });
  const out: any[] = [];
  const subfolders: any[] = [];
  for (const item of res?.items || []) {
    if (!item) continue;
    if (item.type === "folder") {
      subfolders.push(item);
    } else if (item.type === "playlist") {
      const assigned = store.getAssignments(item.uri);
      if (assigned.some((tid) => activeTagIds.has(tid))) out.push(item);
    }
  }
  // Parallelize sibling-folder recursion so N folders costs ~one roundtrip.
  const subResults = await Promise.all(
    subfolders.map((f) => collectFromFolder(f.uri, baseParams))
  );
  for (const arr of subResults) out.push(...arr);
  return out;
}

function installGetContentsPatch() {
  const api = Spicetify.Platform.LibraryAPI;
  if (!api || origGetContents) return;
  origGetContents = api.getContents.bind(api);

  api.getContents = async function (params: any) {
    if (activeTagIds.size === 0 || !origGetContents) {
      return origGetContents ? origGetContents(params) : api.__proto__.getContents.call(api, params);
    }

    // Serve from cache if fresh — same folder scope + same active tags.
    const key = flatCacheKey(params);
    const now = Date.now();
    let flat: any[];
    let envelope: any;

    if (flatCache && flatCache.key === key && now - flatCache.ts < FLAT_CACHE_TTL_MS) {
      flat = flatCache.items;
      envelope = flatCache.envelope;
    } else {
      // Fetch the current scope fully — gives us the response envelope
      // (selectedFilters, availableFilters, etc.) plus the top-level items.
      const top = await origGetContents({
        ...params,
        offset: 0,
        limit: 10000,
      });
      envelope = top;

      const collected: any[] = [];
      const folders: any[] = [];
      for (const item of top?.items || []) {
        if (!item) continue;
        if (item.type === "folder") {
          // "Unfold" — don't include the folder itself; its playlists will be added via recursion.
          folders.push(item);
        } else if (item.type === "playlist") {
          const assigned = store.getAssignments(item.uri);
          // OR semantics: any active tag match → include
          if (assigned.some((tid) => activeTagIds.has(tid))) collected.push(item);
        } else {
          // Non-playlist, non-folder items (albums, artists, etc.) pass
          // through — our filter only constrains playlists.
          collected.push(item);
        }
      }

      // Parallel recursion into each folder in the current scope.
      const folderResults = await Promise.all(
        folders.map((f) => collectFromFolder(f.uri, params))
      );
      for (const arr of folderResults) collected.push(...arr);

      flat = collected;
      flatCache = { key, ts: now, items: flat, envelope };
    }

    const offset = params?.offset || 0;
    const limitRaw = params?.limit;
    const limit = typeof limitRaw === "number" ? limitRaw : flat.length;

    return {
      ...envelope,
      items: flat.slice(offset, offset + limit),
      totalLength: flat.length,
      offset,
      limit,
    };
  };
}

// ============================================================
// Force library refetch (lifted)
// ============================================================

const PLAYLIST_FILTER_ID = "2";
const BY_YOU_FILTER_ID = "102";
const BY_SPOTIFY_FILTER_ID = "103";
const REFETCH_CANDIDATES = ["0", "1", "3", "4"]; // Albums, Artists, Podcasts, Audiobooks

function getCurrentFilterIds(): string[] {
  const props = findFilterFiberProps();
  return (props?.selectedFilters || []).map((f) => String(f.id));
}

function filterSetsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const id of b) if (!sa.has(id)) return false;
  return true;
}

function waitForFilterChange(baseline: string[], maxMs = 500, stepMs = 15): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (!filterSetsEqual(getCurrentFilterIds(), baseline)) return resolve();
      if (Date.now() - start > maxMs) return resolve();
      setTimeout(tick, stepMs);
    };
    tick();
  });
}

async function forceLibraryRefetch() {
  const p1 = findFilterFiberProps();
  if (!p1?.toggleFilterId) return;

  const currentIds = new Set(getCurrentFilterIds());
  const inFolder = !currentIds.has(PLAYLIST_FILTER_ID);
  const candidates = inFolder
    ? [BY_YOU_FILTER_ID, BY_SPOTIFY_FILTER_ID, ...REFETCH_CANDIDATES]
    : [...REFETCH_CANDIDATES, BY_YOU_FILTER_ID, BY_SPOTIFY_FILTER_ID];
  const toggleTarget = candidates.find((id) => !currentIds.has(id)) || candidates[0];

  try {
    const before = getCurrentFilterIds();
    p1.toggleFilterId(toggleTarget);
    await waitForFilterChange(before);

    const p2 = findFilterFiberProps();
    if (p2?.toggleFilterId) {
      const mid = getCurrentFilterIds();
      p2.toggleFilterId(toggleTarget);
      await waitForFilterChange(mid);
    }
  } catch (e) {
    console.error("[library-tags] forceLibraryRefetch failed:", e);
  }
}

// ============================================================
// Chip rendering (one chip per tag)
// ============================================================

function makeColoredDot(color: string, size = 8): HTMLSpanElement {
  const dot = document.createElement("span");
  dot.style.cssText = `
    display: inline-block;
    width: ${size}px;
    height: ${size}px;
    border-radius: 50%;
    background: ${color};
    flex-shrink: 0;
  `;
  return dot;
}

function buildOneChip(tag: Tag, styles: ChipStyles): HTMLElement {
  const active = activeTagIds.has(tag.id);

  const chipDiv = document.createElement("div");
  chipDiv.className = active ? styles.selectedChipClass : styles.chipClass;
  chipDiv.setAttribute("role", "presentation");
  chipDiv.setAttribute("aria-checked", active ? "true" : "false");
  chipDiv.setAttribute("data-encore-id", "chip");
  chipDiv.setAttribute("aria-label", tag.name || "Tag");
  chipDiv.setAttribute("data-tag-id", tag.id);
  chipDiv.setAttribute("tabindex", "-1");
  chipDiv.style.marginBlockEnd = "0px";
  chipDiv.style.cursor = "pointer";

  const span = document.createElement("span");
  span.className = active ? styles.selectedSpanClass : styles.spanClass;
  // Use flex so the dot aligns cleanly next to text (or stands alone if no name).
  span.style.display = "inline-flex";
  span.style.alignItems = "center";
  span.style.gap = tag.name ? "6px" : "0";

  const dot = makeColoredDot(tag.color, 8);
  span.appendChild(dot);

  if (tag.name) {
    const text = document.createElement("span");
    text.textContent = tag.name;
    span.appendChild(text);
  }

  chipDiv.appendChild(span);

  const carouselDiv = document.createElement("div");
  carouselDiv.setAttribute("data-carousel-item", "true");
  carouselDiv.setAttribute("role", "presentation");
  carouselDiv.appendChild(chipDiv);

  const optionDiv = document.createElement("div");
  optionDiv.setAttribute("role", "option");
  optionDiv.setAttribute("tabindex", "-1");
  optionDiv.id = CHIP_PREFIX + tag.id;
  optionDiv.appendChild(carouselDiv);

  // Left click → toggle active; right click → tag-pill mini-menu
  optionDiv.addEventListener(
    "pointerdown",
    (e) => {
      if ((e as PointerEvent).button !== 0) return; // only left click
      e.preventDefault();
      e.stopImmediatePropagation();

      if (activeTagIds.has(tag.id)) activeTagIds.delete(tag.id);
      else activeTagIds.add(tag.id);
      setChipVisual(chipDiv, span, activeTagIds.has(tag.id), styles);
      forceLibraryRefetch();
    },
    true
  );

  optionDiv.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    showPillMenu(tag, chipDiv);
  });

  return optionDiv;
}

function removeAllTagChips() {
  document
    .querySelectorAll(`[id^="${CHIP_PREFIX}"]`)
    .forEach((el) => el.remove());
}

function renderAllChips(listbox: Element) {
  const styles = getChipStyles(listbox);
  if (!styles) return;

  removeAllTagChips();

  // Append tag chips at the end of the pill list (after Downloaded).
  for (const tag of store.getTags()) {
    listbox.appendChild(buildOneChip(tag, styles));
  }
}

// ============================================================
// Chip lifecycle observer
// ============================================================

let chipObserver: MutationObserver | null = null;
let currentListbox: Element | null = null;

function ensureChips(listbox: Element) {
  // If any of our chips are missing (Spotify may have re-rendered the listbox
  // children), rebuild all of them.
  const expected = store.getTags().length;
  const found = listbox.querySelectorAll(`[id^="${CHIP_PREFIX}"]`).length;
  if (found !== expected) renderAllChips(listbox);
}

function startChipLifecycleObserver(listbox: Element) {
  if (chipObserver) chipObserver.disconnect();

  // Initial render
  renderAllChips(listbox);

  chipObserver = new MutationObserver(() => ensureChips(listbox));
  chipObserver.observe(listbox, {
    attributes: true,
    attributeFilter: ["aria-checked"],
    subtree: true,
    childList: true,
  });
}

async function waitForElement(selector: string): Promise<Element> {
  while (true) {
    const el = document.querySelector(selector);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ============================================================
// Tag editor modal (create OR edit — used by Create new tag, Rename, Change color)
// ============================================================

function openTagEditor(opts: {
  existing?: Tag;
  title?: string;
  onDone?: (tag: Tag) => void;
}) {
  const existing = opts.existing;
  let selectedColor = existing?.color || TAG_COLORS[0];
  const initialName = existing?.name || "";

  const wrapper = document.createElement("div");
  wrapper.style.cssText = "display:flex; flex-direction:column; gap:16px; padding:4px;";

  // Name input
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Name (optional)";
  nameLabel.style.cssText = "font-size:13px; color:var(--text-subdued, #b3b3b3);";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = initialName;
  nameInput.placeholder = "Leave empty for just a colored dot";
  nameInput.style.cssText = `
    width: 100%;
    padding: 8px 10px;
    background: var(--background-elevated-base, #282828);
    border: 1px solid var(--essential-subdued, #535353);
    border-radius: 4px;
    color: var(--text-base, #fff);
    font-size: 14px;
    box-sizing: border-box;
  `;
  const nameBox = document.createElement("div");
  nameBox.style.cssText = "display:flex; flex-direction:column; gap:6px;";
  nameBox.appendChild(nameLabel);
  nameBox.appendChild(nameInput);
  wrapper.appendChild(nameBox);

  // Color swatches
  const colorLabel = document.createElement("div");
  colorLabel.textContent = "Color";
  colorLabel.style.cssText = "font-size:13px; color:var(--text-subdued, #b3b3b3);";
  const swatchRow = document.createElement("div");
  swatchRow.style.cssText = "display:flex; gap:10px; flex-wrap:wrap;";

  const swatches: HTMLButtonElement[] = [];
  for (const color of TAG_COLORS) {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.setAttribute("data-color", color);
    sw.style.cssText = `
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: ${color};
      border: 2px solid ${color === selectedColor ? "#fff" : "transparent"};
      cursor: pointer;
      padding: 0;
      outline: none;
      transition: border-color 120ms;
    `;
    sw.addEventListener("click", () => {
      selectedColor = color;
      for (const s of swatches) {
        s.style.borderColor = s.getAttribute("data-color") === selectedColor ? "#fff" : "transparent";
      }
    });
    swatches.push(sw);
    swatchRow.appendChild(sw);
  }

  const colorBox = document.createElement("div");
  colorBox.style.cssText = "display:flex; flex-direction:column; gap:8px;";
  colorBox.appendChild(colorLabel);
  colorBox.appendChild(swatchRow);
  wrapper.appendChild(colorBox);

  // Buttons
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex; justify-content:flex-end; gap:8px; margin-top:8px;";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = `
    padding: 8px 16px;
    background: transparent;
    color: var(--text-base, #fff);
    border: 1px solid var(--essential-subdued, #727272);
    border-radius: 500px;
    cursor: pointer;
    font-weight: 700;
  `;
  cancelBtn.addEventListener("click", () => Spicetify.PopupModal.hide());

  const saveBtn = document.createElement("button");
  saveBtn.textContent = existing ? "Save" : "Create";
  saveBtn.style.cssText = `
    padding: 8px 20px;
    background: var(--text-base, #fff);
    color: #000;
    border: none;
    border-radius: 500px;
    cursor: pointer;
    font-weight: 700;
  `;

  const doSave = () => {
    const name = nameInput.value.trim();
    let resultTag: Tag | undefined;
    if (existing) {
      store.updateTag(existing.id, { name, color: selectedColor });
      resultTag = store.getTag(existing.id);
    } else {
      const created = store.createTag(name, selectedColor);
      if (created) resultTag = created;
    }
    Spicetify.PopupModal.hide();
    if (resultTag) opts.onDone?.(resultTag);
  };
  saveBtn.addEventListener("click", doSave);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSave();
    else if (e.key === "Escape") Spicetify.PopupModal.hide();
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  wrapper.appendChild(btnRow);

  Spicetify.PopupModal.display({
    title: opts.title || (existing ? "Edit tag" : "Create tag"),
    content: wrapper,
    isLarge: false,
  });

  // Focus the name input on open
  setTimeout(() => nameInput.focus(), 50);
}

// ============================================================
// Tag-pill right-click mini-menu
// ============================================================

const PILL_MENU_ID = "library-tags-pill-menu";

function showPillMenu(tag: Tag, anchorEl: HTMLElement) {
  const existing = document.getElementById(PILL_MENU_ID);
  if (existing) existing.remove();

  const menu = document.createElement("div");
  menu.id = PILL_MENU_ID;
  menu.style.cssText = `
    position: absolute;
    z-index: 1000;
    background: var(--background-elevated-base, #282828);
    border-radius: 4px;
    padding: 4px;
    box-shadow: 0 4px 12px rgba(0,0,0,.5);
    min-width: 160px;
  `;

  const itemStyle = `
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: none;
    color: var(--text-base, #fff);
    font-size: 14px;
    cursor: pointer;
    border-radius: 2px;
    text-align: left;
  `;

  const makeItem = (label: string, onClick: () => void, destructive = false): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.style.cssText = itemStyle;
    if (destructive) btn.style.color = "#f15e6c";
    btn.textContent = label;
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "var(--background-elevated-highlight, #3e3e3e)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "none";
    });
    btn.addEventListener("click", () => {
      menu.remove();
      onClick();
    });
    return btn;
  };

  menu.appendChild(
    makeItem("Edit (name & color)", () => {
      openTagEditor({ existing: tag, title: "Edit tag" });
    })
  );
  menu.appendChild(
    makeItem(
      "Delete tag",
      () => {
        // If the tag was active, remove from the active set and refetch.
        if (activeTagIds.has(tag.id)) {
          activeTagIds.delete(tag.id);
          forceLibraryRefetch();
        }
        store.deleteTag(tag.id);
      },
      true
    )
  );

  document.body.appendChild(menu);
  const rect = anchorEl.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;

  const closeHandler = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener("click", closeHandler, true);
    }
  };
  setTimeout(() => document.addEventListener("click", closeHandler, true), 0);
}

// ============================================================
// Spotify right-click context menu (playlist/folder → Tags submenu)
// ============================================================

let registeredSubMenu: any = null;

function isTaggable(uris: string[]): boolean {
  return uris.every(
    (u) => u.startsWith("spotify:playlist:") || /^spotify:user:[^:]+:folder:/.test(u)
  );
}

function registerContextMenu() {
  if (!Spicetify.ContextMenu) return;

  if (registeredSubMenu) {
    try {
      registeredSubMenu.deregister();
    } catch {}
    registeredSubMenu = null;
  }

  const items: any[] = [];

  for (const tag of store.getTags()) {
    const label = tag.name || UNNAMED_LABEL;

    // "Assigned" variant — shown when ALL selected URIs already have the tag.
    // Check icon on assigned / no icon on unassigned is enough to differentiate;
    // we don't also prefix the label with "✓ " (that produced two visible ticks).
    const assignedItem = new Spicetify.ContextMenu.Item(
      label,
      (uris: string[]) => {
        // store.subscribe triggers the refetch — no explicit call needed.
        store.unassign(uris, tag.id);
      },
      (uris: string[]) => isTaggable(uris) && uris.every((u) => store.hasTag(u, tag.id)),
      Spicetify.SVGIcons?.check || undefined
    );

    // "Unassigned" variant — shown when not all selected URIs have the tag.
    const unassignedItem = new Spicetify.ContextMenu.Item(
      label,
      (uris: string[]) => {
        // store.subscribe triggers the refetch — no explicit call needed.
        store.assign(uris, tag.id);
      },
      (uris: string[]) => isTaggable(uris) && !uris.every((u) => store.hasTag(u, tag.id))
    );

    items.push(assignedItem, unassignedItem);
  }

  // "Create new tag…" — only when under the cap
  if (store.canCreate()) {
    const createItem = new Spicetify.ContextMenu.Item(
      "Create new tag…",
      (uris: string[]) => {
        openTagEditor({
          title: "Create tag",
          onDone: (tag) => {
            // store.subscribe will invalidate the cache + refetch if needed.
            store.assign(uris, tag.id);
          },
        });
      },
      (uris: string[]) => isTaggable(uris)
    );
    items.push(createItem);
  }

  const sub = new Spicetify.ContextMenu.SubMenu(
    SUBMENU_LABEL,
    items,
    (uris: string[]) => isTaggable(uris),
    false
  );
  sub.register();
  registeredSubMenu = sub;
}

// ============================================================
// Context-menu decorator — inject colored dots into tag menu items
// ============================================================
//
// Spicetify.ContextMenu.Item labels are plain strings; there's no hook to
// render custom content. To show the colored dot next to each tag in the
// right-click submenu, we observe Spotify's menu DOM and prepend a dot to
// menu items whose text matches one of our tags.
//
// Scope: we only watch DIRECT children of <body> (no subtree) to avoid
// firing on virtualized-grid row swaps during scroll. Spotify mounts
// context-menu portals at body level, so this is enough to catch them.
// When a menu opens we attach a nested observer to handle the Tags
// submenu opening/re-rendering.

const DOT_ATTR = "data-library-tags-dot";
const UNNAMED_LABEL = "(unnamed tag)";
const SUBMENU_LABEL = "Add Tag";
const MOVE_TO_FOLDER_LABEL = "Move to folder";

function labelToTag(text: string): Tag | undefined {
  return store.getTags().find((t) => (t.name || UNNAMED_LABEL) === text);
}

function collectMenuItems(root: Element | Document): HTMLElement[] {
  const out: HTMLElement[] = [];
  // Standard ARIA roles first
  root.querySelectorAll<HTMLElement>(
    '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'
  ).forEach((el) => out.push(el));
  // Fallback — Spotify's context-menu items sometimes render as buttons
  // without an explicit role; scope to descendants of [role="menu"] so we
  // don't decorate unrelated buttons elsewhere on the page.
  root.querySelectorAll<HTMLElement>('[role="menu"] button').forEach((el) => out.push(el));
  return out;
}

function decorateMenuItems(root: Element | Document) {
  for (const item of collectMenuItems(root)) {
    if (item.querySelector(`[${DOT_ATTR}]`)) continue;
    const text = (item.textContent || "").trim();
    if (!text) continue;
    const tag = labelToTag(text);
    if (!tag) continue;
    const dot = makeColoredDot(tag.color, 10);
    dot.setAttribute(DOT_ATTR, "true");
    dot.style.marginRight = "8px";
    dot.style.verticalAlign = "middle";
    // Prefer inserting inside the innermost label span so the dot flows with
    // the text. Fall back to prepending to the item itself.
    const spans = item.querySelectorAll("span");
    const labelSpan = spans.length ? spans[spans.length - 1] : null;
    if (labelSpan) labelSpan.insertBefore(dot, labelSpan.firstChild);
    else item.insertBefore(dot, item.firstChild);
  }
}

// Move our "Add Tag" submenu trigger to sit directly above "Move to folder",
// so it appears in the same group (below the divider above "Move to folder").
// Spicetify gives no public API for item ordering, so we reorder the DOM
// after it renders. Guard: if already in place, do nothing — moving a node
// triggers another mutation which would otherwise loop.
function positionAddTagItem(root: Element | Document) {
  const items = collectMenuItems(root);
  let addTagEl: HTMLElement | null = null;
  let moveToFolderEl: HTMLElement | null = null;
  for (const el of items) {
    const text = (el.textContent || "").trim();
    if (!addTagEl && (text === SUBMENU_LABEL || text.startsWith(SUBMENU_LABEL))) {
      addTagEl = el;
    }
    if (!moveToFolderEl && (text === MOVE_TO_FOLDER_LABEL || text.startsWith(MOVE_TO_FOLDER_LABEL))) {
      moveToFolderEl = el;
    }
  }
  if (!addTagEl || !moveToFolderEl) return;
  // Reorder at the wrapper level (<li> if present) so native group dividers stay intact.
  const addAny: any = addTagEl;
  const moveAny: any = moveToFolderEl;
  const addWrap: HTMLElement = (addAny.closest("li") as HTMLElement) || addAny;
  const moveWrap: HTMLElement = (moveAny.closest("li") as HTMLElement) || moveAny;
  if (addWrap.parentNode !== moveWrap.parentNode) return;
  if (addWrap.nextElementSibling === moveWrap) return; // already in place
  moveWrap.parentNode?.insertBefore(addWrap, moveWrap);
}

function startContextMenuObserver() {
  // rAF-coalesced whole-document scan. Previous attempts scoped the observer
  // to what I thought were context-menu portals but Spotify's actual menu DOM
  // (roles / classes / portal location) varies and my detection missed it,
  // so colors never appeared. A full scan is cheaper than it sounds: the
  // querySelectorAll is fast, and the DOT_ATTR dedup means each menuitem
  // is touched at most once per open.
  let rafPending = false;
  const scan = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      try {
        decorateMenuItems(document);
        positionAddTagItem(document);
      } catch (e) {
        console.error("[library-tags] menu decorator failed:", e);
      }
    });
  };
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
  // Run once in case a menu is already open when we initialize.
  scan();
}

// ============================================================
// Main
// ============================================================

async function main() {
  while (
    !Spicetify?.Platform?.LibraryAPI ||
    !Spicetify?.Platform?.UserAPI ||
    !Spicetify?.LocalStorage ||
    !Spicetify?.ContextMenu ||
    !Spicetify?.PopupModal
  ) {
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log("[library-tags] Extension loaded");

  store.load();
  installGetContentsPatch();
  registerContextMenu();
  startContextMenuObserver();

  // Re-register the context menu whenever the tag list changes,
  // and re-render chips to reflect any name/color/add/delete edits.
  store.subscribe(() => {
    registerContextMenu();
    if (currentListbox) renderAllChips(currentListbox);
    // Tag/assignment edits may change what the flatten cache would return
    // under the same (folderUri + activeTagIds) key; evict so the next
    // getContents call rebuilds.
    invalidateFlatCache();
    // If a tag filter is currently active and the user just toggled an
    // assignment, re-query so the grid reflects the new membership.
    if (activeTagIds.size > 0) forceLibraryRefetch();
  });

  // Poll for the filter listbox — it's destroyed/recreated on navigation.
  // A MutationObserver on document.body is more expensive (fires on every
  // virtualizer row swap during scroll).
  const checkListbox = () => {
    const lb = document.querySelector('[role="listbox"][aria-label="Filter options"]');
    if (lb && lb !== currentListbox) {
      currentListbox = lb;
      cachedStyles = null; // fresh listbox → re-read styles
      startChipLifecycleObserver(lb);
    } else if (!lb && currentListbox) {
      currentListbox = null;
      if (chipObserver) {
        chipObserver.disconnect();
        chipObserver = null;
      }
    }
  };
  window.setInterval(checkListbox, 500);

  const initialLb = await waitForElement('[role="listbox"][aria-label="Filter options"]');
  currentListbox = initialLb;
  startChipLifecycleObserver(initialLb);
}

export default main;
