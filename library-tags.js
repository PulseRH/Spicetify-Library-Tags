(async function() {
        while (!Spicetify.React || !Spicetify.ReactDOM) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        var libraryDtags = (() => {
  // src/app.tsx
  var STORAGE_KEY = "library-tags:state";
  var STORAGE_BACKUP_KEY = "library-tags:state:backup";
  var STORAGE_GLOBAL_KEY = "library-tags:global-state";
  var STORAGE_GLOBAL_BACKUP_KEY = "library-tags:global-state:backup";
  var STORAGE_CORRUPT_KEY = "library-tags:state:corrupt";
  var STORAGE_KEY_PATTERN = /^library-tags:.*state/i;
  var CHIP_PREFIX = "library-tag-chip-";
  var MAX_TAGS = 8;
  var TITLE_TAGS_ATTR = "data-library-tags-title-tags";
  var TITLE_TAGS_URI_ATTR = "data-library-tags-title-uri";
  var TOOLTIP_TAGS_ATTR = "data-library-tags-tooltip-tags";
  var TAG_COLORS = [
    "#1db954",
    "#ff5577",
    "#5570ff",
    "#ffaa22",
    "#bb55ff",
    "#22ccdd",
    "#ffee55",
    "#b0b0b0"
  ];
  var IDB_DB = "library-tags";
  var IDB_STORE = "kv";
  var IDB_RECORD = "state";
  function idbOpen() {
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(IDB_DB, 1);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(IDB_STORE))
            req.result.createObjectStore(IDB_STORE);
        } catch {
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet() {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const r = tx.objectStore(IDB_STORE).get(IDB_RECORD);
      r.onsuccess = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbSet(value) {
    try {
      const db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(value, IDB_RECORD);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn("[library-tags] IndexedDB write failed:", e);
    }
  }
  var TagStore = class {
    constructor() {
      this.state = { tags: [], assignments: {} };
      this.listeners = /* @__PURE__ */ new Set();
      this.idbRaws = [];
    }
    getRaw(key) {
      const values = [];
      try {
        const value = Spicetify.LocalStorage.get(key);
        if (typeof value === "string" && value.length > 0)
          values.push(value);
      } catch {
      }
      try {
        const value = window.localStorage.getItem(key);
        if (typeof value === "string" && value.length > 0)
          values.push(value);
      } catch {
      }
      return Array.from(new Set(values));
    }
    getAllRaw() {
      const values = [
        ...this.idbRaws,
        ...this.getRaw(STORAGE_KEY),
        ...this.getRaw(STORAGE_BACKUP_KEY),
        ...this.getRaw(STORAGE_GLOBAL_KEY),
        ...this.getRaw(STORAGE_GLOBAL_BACKUP_KEY)
      ];
      try {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (!key || !STORAGE_KEY_PATTERN.test(key))
            continue;
          const value = window.localStorage.getItem(key);
          if (typeof value === "string" && value.length > 0)
            values.push(value);
        }
      } catch {
      }
      return Array.from(new Set(values));
    }
    setRaw(key, value) {
      try {
        Spicetify.LocalStorage.set(key, value);
      } catch (e) {
        console.warn("[library-tags] Failed to write Spicetify storage:", e);
      }
      try {
        window.localStorage.setItem(key, value);
      } catch (e) {
        console.warn("[library-tags] Failed to write browser storage:", e);
      }
    }
    stateScore(state) {
      const assignmentCount = Object.values(state.assignments).reduce((sum, ids) => sum + (Array.isArray(ids) ? ids.length : 0), 0);
      return state.tags.length * 1e3 + Object.keys(state.assignments).length * 100 + assignmentCount;
    }
    isDefaultEmptyState(state) {
      return state.tags.length <= 1 && state.tags.every((tag) => !tag.name) && Object.keys(state.assignments).length === 0;
    }
    load() {
      const raws = this.getAllRaw();
      let best = null;
      for (const raw of raws) {
        const parsed = this.parseState(raw);
        if (!parsed)
          continue;
        if (!best || this.stateScore(parsed) > this.stateScore(best))
          best = parsed;
      }
      if (best) {
        this.state = best;
        this.persist();
        return;
      }
      if (raws.length > 0) {
        this.setRaw(STORAGE_CORRUPT_KEY, raws[0]);
        console.error("[library-tags] Stored tag data was invalid and no backup was available. Refusing to overwrite it.");
        return;
      }
      if (this.state.tags.length === 0) {
        this.state.tags.push({
          id: this.nextId(),
          name: "",
          color: TAG_COLORS[0]
        });
      }
    }
    async loadDurable() {
      try {
        const raw = await idbGet();
        if (typeof raw === "string" && raw.length > 0)
          this.idbRaws = [raw];
      } catch (e) {
        console.warn("[library-tags] IndexedDB read failed:", e);
      }
      this.load();
    }
    parseState(raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.tags) || !parsed.assignments || typeof parsed.assignments !== "object") {
          return null;
        }
        const tags = parsed.tags.filter((tag) => tag && typeof tag.id === "string").map((tag) => ({
          id: tag.id,
          name: typeof tag.name === "string" ? tag.name : "",
          color: typeof tag.color === "string" ? tag.color : TAG_COLORS[0]
        })).slice(0, MAX_TAGS);
        const validTagIds = new Set(tags.map((tag) => tag.id));
        const assignments = {};
        for (const [uri, tagIds] of Object.entries(parsed.assignments)) {
          if (typeof uri !== "string" || !Array.isArray(tagIds))
            continue;
          const cleaned = Array.from(new Set(tagIds.filter((id) => typeof id === "string" && validTagIds.has(id))));
          if (cleaned.length > 0)
            assignments[uri] = cleaned;
        }
        return { tags, assignments };
      } catch {
        return null;
      }
    }
    persist() {
      const serialized = JSON.stringify(this.state);
      const score = this.stateScore(this.state);
      const existingBest = this.getAllRaw().map((raw) => this.parseState(raw)).filter((state) => Boolean(state)).sort((a, b) => this.stateScore(b) - this.stateScore(a))[0];
      if (existingBest && this.isDefaultEmptyState(this.state) && this.stateScore(existingBest) > score) {
        this.state = existingBest;
        return;
      }
      this.setRaw(STORAGE_GLOBAL_BACKUP_KEY, serialized);
      this.setRaw(STORAGE_BACKUP_KEY, serialized);
      this.setRaw(STORAGE_GLOBAL_KEY, serialized);
      this.setRaw(STORAGE_KEY, serialized);
      this.idbRaws = [serialized];
      idbSet(serialized);
      for (const l of this.listeners)
        l();
    }
    nextId() {
      const nums = this.state.tags.map((t) => parseInt(t.id, 10)).filter((n) => !Number.isNaN(n));
      const max = nums.length ? Math.max(...nums) : 999;
      return String(Math.max(1e3, max + 1));
    }
    subscribe(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }
    getTags() {
      return this.state.tags.slice();
    }
    getTag(id) {
      return this.state.tags.find((t) => t.id === id);
    }
    canCreate() {
      return this.state.tags.length < MAX_TAGS;
    }
    createTag(name, color) {
      if (!this.canCreate())
        return null;
      const tag = { id: this.nextId(), name, color };
      this.state.tags.push(tag);
      this.persist();
      return tag;
    }
    updateTag(id, patch) {
      const t = this.state.tags.find((x) => x.id === id);
      if (!t)
        return;
      if (patch.name !== void 0)
        t.name = patch.name;
      if (patch.color !== void 0)
        t.color = patch.color;
      this.persist();
    }
    deleteTag(id) {
      this.state.tags = this.state.tags.filter((t) => t.id !== id);
      for (const uri of Object.keys(this.state.assignments)) {
        this.state.assignments[uri] = this.state.assignments[uri].filter((x) => x !== id);
        if (this.state.assignments[uri].length === 0)
          delete this.state.assignments[uri];
      }
      this.persist();
    }
    getAssignments(uri) {
      return this.state.assignments[uri] || [];
    }
    hasTag(uri, tagId) {
      return (this.state.assignments[uri] || []).includes(tagId);
    }
    assign(uris, tagId) {
      for (const uri of uris) {
        const cur = new Set(this.state.assignments[uri] || []);
        cur.add(tagId);
        this.state.assignments[uri] = Array.from(cur);
      }
      this.persist();
    }
    unassign(uris, tagId) {
      for (const uri of uris) {
        const cur = (this.state.assignments[uri] || []).filter((x) => x !== tagId);
        if (cur.length > 0)
          this.state.assignments[uri] = cur;
        else
          delete this.state.assignments[uri];
      }
      this.persist();
    }
  };
  var store = new TagStore();
  var activeTagIds = /* @__PURE__ */ new Set();
  var titleTagNameIndex = /* @__PURE__ */ new Map();
  var cachedStyles = null;
  function getChipStyles(listbox) {
    if (cachedStyles)
      return cachedStyles;
    const isOurChip = (el) => {
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
      if (us && ss && unselected.className !== selected.className) {
        cachedStyles = {
          chipClass: unselected.className,
          spanClass: us.className,
          selectedChipClass: selected.className,
          selectedSpanClass: ss.className
        };
        return cachedStyles;
      }
    }
    return null;
  }
  function setChipVisual(chipEl, spanEl, active, styles) {
    chipEl.className = active ? styles.selectedChipClass : styles.chipClass;
    chipEl.setAttribute("aria-checked", active ? "true" : "false");
    spanEl.className = active ? styles.selectedSpanClass : styles.spanClass;
  }
  function findFilterFiberProps() {
    const lb = document.querySelector('[role="listbox"][aria-label="Filter options"]');
    if (!lb)
      return null;
    const fiberKey = Object.keys(lb).find((k) => k.startsWith("__reactFiber"));
    if (!fiberKey)
      return null;
    let fiber = lb[fiberKey];
    for (let i = 0; i < 80 && fiber; i++) {
      const props = fiber.memoizedProps;
      if (props && typeof props.toggleFilterId === "function") {
        return props;
      }
      fiber = fiber.return;
    }
    return null;
  }
  var origGetContents = null;
  var getContentsCallCount = 0;
  var flatCache = null;
  var FLAT_CACHE_TTL_MS = 3e3;
  function flatCacheKey() {
    return "flat::" + Array.from(activeTagIds).sort().join(",");
  }
  function invalidateFlatCache() {
    flatCache = null;
  }
  async function enumerateAllPlaylistsViaRootlist() {
    const rootlist = await Spicetify.Platform.RootlistAPI.getContents();
    const out = [];
    function walk(items) {
      for (const item of items || []) {
        if (!item)
          continue;
        if (item.type === "folder" && item.items)
          walk(item.items);
        else if (item.type === "playlist")
          out.push(item);
      }
    }
    walk(rootlist?.items || []);
    return out;
  }
  async function buildItemShapeIndex() {
    const index = /* @__PURE__ */ new Map();
    if (!origGetContents)
      return index;
    async function absorb(items) {
      for (const item of items || []) {
        if (!item)
          continue;
        if (item.type === "playlist" && item.uri) {
          index.set(item.uri, item);
        }
      }
    }
    try {
      const rootRes = await origGetContents({
        filters: ["2"],
        offset: 0,
        limit: 1e4
      });
      await absorb(rootRes?.items || []);
      const folders = (rootRes?.items || []).filter((i) => i?.type === "folder");
      const folderResults = await Promise.all(
        folders.map(async (f) => {
          try {
            const r = await origGetContents({
              filters: ["2"],
              folderUri: f.uri,
              offset: 0,
              limit: 1e4
            });
            return r?.items || [];
          } catch {
            return [];
          }
        })
      );
      for (const arr of folderResults)
        await absorb(arr);
    } catch (e) {
      console.warn("[library-tags] buildItemShapeIndex: LibraryAPI fetch failed, will fall back to RootlistAPI shapes:", e);
    }
    return index;
  }
  function installGetContentsPatch() {
    const api = Spicetify.Platform.LibraryAPI;
    if (!api || origGetContents)
      return;
    origGetContents = api.getContents.bind(api);
    api.getContents = async function(params) {
      getContentsCallCount++;
      if (activeTagIds.size === 0 || !origGetContents) {
        return origGetContents ? origGetContents(params) : api.__proto__.getContents.call(api, params);
      }
      const key = flatCacheKey();
      const now = Date.now();
      let flat;
      let envelope;
      if (flatCache && flatCache.key === key && now - flatCache.ts < FLAT_CACHE_TTL_MS) {
        flat = flatCache.items;
        envelope = flatCache.envelope;
      } else {
        const [allPlaylists, shapeIndex] = await Promise.all([
          enumerateAllPlaylistsViaRootlist(),
          buildItemShapeIndex()
        ]);
        const collected = [];
        for (const pl of allPlaylists) {
          const assigned = store.getAssignments(pl.uri);
          if (!assigned.some((tid) => activeTagIds.has(tid)))
            continue;
          collected.push(shapeIndex.get(pl.uri) || pl);
        }
        try {
          envelope = await origGetContents({ ...params, offset: 0, limit: 1 });
        } catch {
          envelope = {};
        }
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
        limit
      };
    };
  }
  var DOWNLOADED_FILTER_ID = "100";
  function getCurrentFilterIds() {
    const props = findFilterFiberProps();
    return (props?.selectedFilters || []).map((f) => String(f.id));
  }
  function filterSetsEqual(a, b) {
    if (a.length !== b.length)
      return false;
    const sa = new Set(a);
    for (const id of b)
      if (!sa.has(id))
        return false;
    return true;
  }
  function waitForFilterChange(baseline, maxMs = 500, stepMs = 15) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (!filterSetsEqual(getCurrentFilterIds(), baseline))
          return resolve();
        if (Date.now() - start > maxMs)
          return resolve();
        setTimeout(tick, stepMs);
      };
      tick();
    });
  }
  function tryEventBasedRefetch() {
    try {
      const api = Spicetify.Platform.LibraryAPI;
      api?._cache?.clear?.();
      const events = api?._events;
      if (!events?.emit)
        return false;
      events.emit("update", { type: "library-tags:refetch" });
      events.emit("operation_complete", { type: "library-tags:refetch" });
      return true;
    } catch (e) {
      console.warn("[library-tags] event-based refetch failed:", e);
      return false;
    }
  }
  async function downloadedToggleRefetch() {
    const p1 = findFilterFiberProps();
    if (!p1?.toggleFilterId)
      return;
    try {
      const snapshot = getCurrentFilterIds();
      const hadDownloaded = snapshot.includes(DOWNLOADED_FILTER_ID);
      const before = snapshot;
      p1.toggleFilterId(DOWNLOADED_FILTER_ID);
      await waitForFilterChange(before);
      const p2 = findFilterFiberProps();
      if (p2?.toggleFilterId) {
        const mid = getCurrentFilterIds();
        p2.toggleFilterId(DOWNLOADED_FILTER_ID);
        await waitForFilterChange(mid);
      }
      const final = getCurrentFilterIds();
      if (final.includes(DOWNLOADED_FILTER_ID) !== hadDownloaded) {
        const p3 = findFilterFiberProps();
        if (p3?.toggleFilterId)
          p3.toggleFilterId(DOWNLOADED_FILTER_ID);
      }
    } catch (e) {
      console.error("[library-tags] downloadedToggleRefetch failed:", e);
    }
  }
  function tryNavigationRefetch() {
    try {
      const history = Spicetify.Platform?.History;
      if (typeof history?.replace !== "function")
        return false;
      const location = history.location || {};
      const params = new URLSearchParams(location.search || "");
      params.set("libraryTagsRefresh", String(Date.now()));
      history.replace({
        ...location,
        search: `?${params.toString()}`,
        state: {
          ...(location.state || {}),
          __libraryTagsRefresh: Date.now()
        }
      });
      return true;
    } catch (e) {
      console.warn("[library-tags] navigation refetch failed:", e);
    }
    return false;
  }
  async function filterPropsRefetch() {
    const props = findFilterFiberProps();
    if (!props?.resetFilterIds || !props?.toggleFilterId)
      return;
    try {
      const selectedIds = getCurrentFilterIds().filter((id) => id !== DOWNLOADED_FILTER_ID);
      props.resetFilterIds();
      await waitForFilterChange(selectedIds, 250);
      for (const id of selectedIds) {
        const nextProps = findFilterFiberProps();
        if (nextProps?.toggleFilterId)
          nextProps.toggleFilterId(id);
        await new Promise((r) => setTimeout(r, 35));
      }
    } catch (e) {
      console.warn("[library-tags] filterPropsRefetch failed:", e);
    }
  }
  async function forceLibraryRefetch() {
    invalidateFlatCache();
    const before = getContentsCallCount;
    if (tryEventBasedRefetch()) {
      await new Promise((r) => setTimeout(r, 150));
      if (getContentsCallCount > before)
        return;
    }
    await filterPropsRefetch();
    if (getContentsCallCount > before)
      return;
    if (tryNavigationRefetch()) {
      await new Promise((r) => setTimeout(r, 150));
      if (getContentsCallCount > before)
        return;
    }
  }
  function makeColoredDot(color, size = 8) {
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
  function uriFromTitleId(id) {
    if (!id)
      return null;
    if (id.startsWith("listrow-title-"))
      return id.slice("listrow-title-".length);
    if (id.startsWith("card-title-"))
      return id.slice("card-title-".length);
    return null;
  }
  function getAssignedTags(uri) {
    return store.getAssignments(uri).map((id) => store.getTag(id)).filter((tag) => Boolean(tag));
  }
  function makeTitleTagMarker(tag) {
    const marker = makeColoredDot(tag.color, 7);
    marker.title = tag.name || "Tag";
    marker.setAttribute("aria-label", tag.name || "Tag");
    marker.style.boxShadow = "0 0 0 1px rgba(0, 0, 0, 0.35)";
    return marker;
  }
  async function refreshTitleTagNameIndex() {
    try {
      let addItem2 = function(item) {
        if (!item?.uri || !item?.name)
          return;
        const tags = getAssignedTags(item.uri);
        if (tags.length === 0)
          return;
        const key = String(item.name).toLowerCase();
        const existing = next.get(key) || [];
        const seen = new Set(existing.map((tag) => tag.id));
        for (const tag of tags) {
          if (!seen.has(tag.id))
            existing.push(tag);
        }
        next.set(key, existing);
      }, walk2 = function(items) {
        for (const item of items || []) {
          if (!item)
            continue;
          if (item.type === "folder") {
            addItem2(item);
            walk2(item.items || []);
          } else if (item.type === "playlist") {
            addItem2(item);
          }
        }
      };
      var addItem = addItem2, walk = walk2;
      const rootlist = await Spicetify.Platform.RootlistAPI.getContents();
      const next = /* @__PURE__ */ new Map();
      walk2(rootlist?.items || []);
      titleTagNameIndex = next;
      renderTitleTags(document);
    } catch (e) {
      console.warn("[library-tags] Failed to refresh title tag name index:", e);
    }
  }
  function findTooltipTitleMatch(tooltip) {
    const walker = document.createTreeWalker(tooltip, NodeFilter.SHOW_TEXT, {
      acceptNode(node2) {
        if (node2.parentElement?.closest(`[${TOOLTIP_TAGS_ATTR}]`)) {
          return NodeFilter.FILTER_REJECT;
        }
        const name2 = (node2.textContent || "").trim().toLowerCase();
        if (name2 && titleTagNameIndex.has(name2)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    });
    const node = walker.nextNode();
    if (!node)
      return null;
    const name = (node.textContent || "").trim().toLowerCase();
    const tags = titleTagNameIndex.get(name) || [];
    if (tags.length === 0)
      return null;
    return { node, name, tags };
  }
  function renderTooltipTags(root = document) {
    const tooltips = Array.from(
      root.querySelectorAll('#hover-or-focus-tooltip, [role="tooltip"]')
    );
    for (const tooltip of tooltips) {
      const existingMarkers = Array.from(tooltip.querySelectorAll(`[${TOOLTIP_TAGS_ATTR}]`));
      const existing = existingMarkers.shift() || null;
      const match = findTooltipTitleMatch(tooltip);
      const tags = match?.tags || [];
      if (tags.length === 0) {
        for (const marker of existingMarkers)
          marker.remove();
        existing?.remove();
        tooltip.normalize();
        continue;
      }
      for (const marker of existingMarkers)
        marker.remove();
      const signature = tags.map((tag) => `${tag.id}:${tag.color}:${tag.name}`).join("|");
      const container = existing || document.createElement("span");
      container.setAttribute(TOOLTIP_TAGS_ATTR, "true");
      container.dataset.signature = signature;
      container.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 6px;
      margin-right: 0;
      vertical-align: middle;
      white-space: nowrap;
    `;
      container.replaceChildren(...tags.map(makeTitleTagMarker));
      if (existing)
        existing.remove();
      match.node.parentNode?.insertBefore(container, match.node.nextSibling);
    }
  }
  function renderTitleTags(root = document) {
    for (const marker of Array.from(root.querySelectorAll(`[${TITLE_TAGS_ATTR}]`))) {
      const parent = marker.parentElement;
      if (!uriFromTitleId(parent?.id || null))
        marker.remove();
    }
    const targets = Array.from(
      root.querySelectorAll(
        '[id^="listrow-title-spotify:playlist:"], [id^="listrow-title-spotify:user:"][id*=":folder:"], [id^="card-title-spotify:playlist:"], [id^="card-title-spotify:user:"][id*=":folder:"]'
      )
    );
    for (const titleEl of targets) {
      const uri = uriFromTitleId(titleEl.id);
      if (!uri)
        continue;
      const assignedTags = getAssignedTags(uri);
      const existing = titleEl.querySelector(`:scope > [${TITLE_TAGS_ATTR}]`);
      if (assignedTags.length === 0) {
        existing?.remove();
        titleEl.removeAttribute(TITLE_TAGS_URI_ATTR);
        continue;
      }
      const signature = assignedTags.map((tag) => `${tag.id}:${tag.color}:${tag.name}`).join("|");
      if (existing?.dataset.signature === signature)
        continue;
      const container = existing || document.createElement("span");
      container.setAttribute(TITLE_TAGS_ATTR, "true");
      container.dataset.signature = signature;
      container.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 6px;
      vertical-align: middle;
      white-space: nowrap;
      flex-shrink: 0;
    `;
      container.replaceChildren(...assignedTags.map(makeTitleTagMarker));
      if (!existing) {
        titleEl.appendChild(container);
        titleEl.style.display = "inline-flex";
        titleEl.style.alignItems = "center";
        titleEl.style.maxWidth = "100%";
      }
      titleEl.setAttribute(TITLE_TAGS_URI_ATTR, uri);
    }
    renderTooltipTags(root);
  }
  function startTitleTagObserver() {
    let rafPending = false;
    const render = () => {
      if (rafPending)
        return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        try {
          renderTitleTags(document);
        } catch (e) {
          console.error("[library-tags] title tag render failed:", e);
        }
      });
    };
    const observer = new MutationObserver(render);
    observer.observe(document.body, { childList: true, subtree: true });
    render();
  }
  function buildOneChip(tag, styles) {
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
    optionDiv.addEventListener(
      "pointerdown",
      async (e) => {
        if (e.button !== 0)
          return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (activeTagIds.has(tag.id))
          activeTagIds.delete(tag.id);
        else
          activeTagIds.add(tag.id);
        setChipVisual(chipDiv, span, activeTagIds.has(tag.id), styles);
        invalidateFlatCache();
        await forceLibraryRefetch();
        if (currentListbox)
          renderAllChips(currentListbox);
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
    document.querySelectorAll(`[id^="${CHIP_PREFIX}"]`).forEach((el) => el.remove());
  }
  function renderAllChips(listbox) {
    const styles = getChipStyles(listbox);
    if (!styles)
      return;
    removeAllTagChips();
    for (const tag of store.getTags()) {
      listbox.appendChild(buildOneChip(tag, styles));
    }
  }
  var chipObserver = null;
  var currentListbox = null;
  function ensureChips(listbox) {
    const expected = store.getTags().length;
    const found = listbox.querySelectorAll(`[id^="${CHIP_PREFIX}"]`).length;
    if (found !== expected)
      renderAllChips(listbox);
  }
  function startChipLifecycleObserver(listbox) {
    if (chipObserver)
      chipObserver.disconnect();
    renderAllChips(listbox);
    chipObserver = new MutationObserver(() => ensureChips(listbox));
    chipObserver.observe(listbox, {
      attributes: true,
      attributeFilter: ["aria-checked"],
      subtree: true,
      childList: true
    });
  }
  async function waitForElement(selector) {
    while (true) {
      const el = document.querySelector(selector);
      if (el)
        return el;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  function openTagEditor(opts) {
    const existing = opts.existing;
    let selectedColor = existing?.color || TAG_COLORS[0];
    const initialName = existing?.name || "";
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "display:flex; flex-direction:column; gap:16px; padding:4px;";
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
    const colorLabel = document.createElement("div");
    colorLabel.textContent = "Color";
    colorLabel.style.cssText = "font-size:13px; color:var(--text-subdued, #b3b3b3);";
    const swatchRow = document.createElement("div");
    swatchRow.style.cssText = "display:flex; gap:10px; flex-wrap:wrap;";
    const swatches = [];
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
      let resultTag;
      if (existing) {
        store.updateTag(existing.id, { name, color: selectedColor });
        resultTag = store.getTag(existing.id);
      } else {
        const created = store.createTag(name, selectedColor);
        if (created)
          resultTag = created;
      }
      Spicetify.PopupModal.hide();
      if (resultTag)
        opts.onDone?.(resultTag);
    };
    saveBtn.addEventListener("click", doSave);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter")
        doSave();
      else if (e.key === "Escape")
        Spicetify.PopupModal.hide();
    });
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    wrapper.appendChild(btnRow);
    Spicetify.PopupModal.display({
      title: opts.title || (existing ? "Edit tag" : "Create tag"),
      content: wrapper,
      isLarge: false
    });
    setTimeout(() => nameInput.focus(), 50);
  }
  var PILL_MENU_ID = "library-tags-pill-menu";
  function showPillMenu(tag, anchorEl) {
    const existing = document.getElementById(PILL_MENU_ID);
    if (existing)
      existing.remove();
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
    const makeItem = (label, onClick, destructive = false) => {
      const btn = document.createElement("button");
      btn.style.cssText = itemStyle;
      if (destructive)
        btn.style.color = "#f15e6c";
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
    const closeHandler = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("click", closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener("click", closeHandler, true), 0);
  }
  var registeredSubMenu = null;
  function isTaggable(uris) {
    return uris.every(
      (u) => u.startsWith("spotify:playlist:") || /^spotify:user:[^:]+:folder:/.test(u)
    );
  }
  function registerContextMenu() {
    if (!Spicetify.ContextMenu)
      return;
    if (registeredSubMenu) {
      try {
        registeredSubMenu.deregister();
      } catch {
      }
      registeredSubMenu = null;
    }
    const items = [];
    for (const tag of store.getTags()) {
      const label = tag.name || UNNAMED_LABEL;
      const assignedItem = new Spicetify.ContextMenu.Item(
        label,
        (uris) => {
          store.unassign(uris, tag.id);
        },
        (uris) => isTaggable(uris) && uris.every((u) => store.hasTag(u, tag.id)),
        Spicetify.SVGIcons?.check || void 0
      );
      const unassignedItem = new Spicetify.ContextMenu.Item(
        label,
        (uris) => {
          store.assign(uris, tag.id);
        },
        (uris) => isTaggable(uris) && !uris.every((u) => store.hasTag(u, tag.id))
      );
      items.push(assignedItem, unassignedItem);
    }
    if (store.canCreate()) {
      const createItem = new Spicetify.ContextMenu.Item(
        "Create new tag\u2026",
        (uris) => {
          openTagEditor({
            title: "Create tag",
            onDone: (tag) => {
              store.assign(uris, tag.id);
            }
          });
        },
        (uris) => isTaggable(uris)
      );
      items.push(createItem);
    }
    const sub = new Spicetify.ContextMenu.SubMenu(
      SUBMENU_LABEL,
      items,
      (uris) => isTaggable(uris),
      false
    );
    sub.register();
    registeredSubMenu = sub;
  }
  var DOT_ATTR = "data-library-tags-dot";
  var UNNAMED_LABEL = "(unnamed tag)";
  var SUBMENU_LABEL = "Add Tag";
  var MOVE_TO_FOLDER_LABEL = "Move to folder";
  function labelToTag(text) {
    return store.getTags().find((t) => (t.name || UNNAMED_LABEL) === text);
  }
  function collectMenuItems(root) {
    const out = [];
    root.querySelectorAll(
      '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'
    ).forEach((el) => out.push(el));
    root.querySelectorAll('[role="menu"] button').forEach((el) => out.push(el));
    return out;
  }
  function decorateMenuItems(root) {
    for (const item of collectMenuItems(root)) {
      if (item.querySelector(`[${DOT_ATTR}]`))
        continue;
      const text = (item.textContent || "").trim();
      if (!text)
        continue;
      const tag = labelToTag(text);
      if (!tag)
        continue;
      const dot = makeColoredDot(tag.color, 10);
      dot.setAttribute(DOT_ATTR, "true");
      dot.style.marginRight = "8px";
      dot.style.verticalAlign = "middle";
      const spans = item.querySelectorAll("span");
      const labelSpan = spans.length ? spans[spans.length - 1] : null;
      if (labelSpan)
        labelSpan.insertBefore(dot, labelSpan.firstChild);
      else
        item.insertBefore(dot, item.firstChild);
    }
  }
  function positionAddTagItem(root) {
    const items = collectMenuItems(root);
    let addTagEl = null;
    let moveToFolderEl = null;
    for (const el of items) {
      const text = (el.textContent || "").trim();
      if (!addTagEl && (text === SUBMENU_LABEL || text.startsWith(SUBMENU_LABEL))) {
        addTagEl = el;
      }
      if (!moveToFolderEl && (text === MOVE_TO_FOLDER_LABEL || text.startsWith(MOVE_TO_FOLDER_LABEL))) {
        moveToFolderEl = el;
      }
    }
    if (!addTagEl || !moveToFolderEl)
      return;
    const addAny = addTagEl;
    const moveAny = moveToFolderEl;
    const addWrap = addAny.closest("li") || addAny;
    const moveWrap = moveAny.closest("li") || moveAny;
    if (addWrap.parentNode !== moveWrap.parentNode)
      return;
    if (addWrap.nextElementSibling === moveWrap)
      return;
    moveWrap.parentNode?.insertBefore(addWrap, moveWrap);
  }
  function startContextMenuObserver() {
    let rafPending = false;
    const scan = () => {
      if (rafPending)
        return;
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
    scan();
  }
  async function main() {
    while (!Spicetify?.Platform?.LibraryAPI || !Spicetify?.Platform?.UserAPI || !Spicetify?.LocalStorage || !Spicetify?.ContextMenu || !Spicetify?.PopupModal) {
      await new Promise((r) => setTimeout(r, 100));
    }
    console.log("[library-tags] Extension loaded");
    await store.loadDurable();
    installGetContentsPatch();
    registerContextMenu();
    startContextMenuObserver();
    startTitleTagObserver();
    refreshTitleTagNameIndex();
    store.subscribe(() => {
      registerContextMenu();
      if (currentListbox)
        renderAllChips(currentListbox);
      refreshTitleTagNameIndex();
      invalidateFlatCache();
      if (activeTagIds.size > 0)
        forceLibraryRefetch();
    });
    const checkListbox = () => {
      const lb = document.querySelector('[role="listbox"][aria-label="Filter options"]');
      if (lb && lb !== currentListbox) {
        currentListbox = lb;
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
  var app_default = main;

  // ../../../Users/Loz/AppData/Local/Temp/spicetify-creator/index.jsx
  (async () => {
    await app_default();
  })();
})();

      })();
