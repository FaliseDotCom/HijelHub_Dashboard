// Copyright (c) 2026 Hijel. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, this software
// is provided "AS IS", WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
// express or implied. The author(s) accept no liability for any damages,
// loss, or consequences arising from the use or misuse of this software.
// See the License for the full terms governing permissions and limitations.

const App = (() => {
  let theme = {};
  let rawDataFiles = [];
  let decryptedDataFiles = [];
  let chartInstances = [];

  /**
   * Repos currently on screen, in config order, with their loaded data.
   * @type {Array<{ idx: number, owner: string, repo: string, data: Object|null }>}
   */
  let repoEntries = [];

  /**
   * Active sort option key and direction (1 ascending, -1 descending).
   * @type {{ key: string, dir: number }}
   */
  let sortState = { key: "order", dir: 1 };

  /**
   * localStorage key that remembers the chosen sort between visits.
   * @type {string}
   */
  const SORT_STORAGE_KEY = "repo-sort";

  // ── Helpers ──────────────────────────────────────────────────────────────

  function getCSS(v) {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  }

  function fmt(n) {
    return n != null ? n.toLocaleString() : "0";
  }

  /**
   * Adds up one numeric field over a list of entries.
   * @param {Array<Object>} list Entries to add up.
   * @param {string} field Name of the numeric field.
   * @returns {number} Sum of the field, 0 for an empty list.
   */
  function sumBy(list, field) {
    return list.reduce((s, v) => s + (v[field] || 0), 0);
  }

  /**
   * Formats a date as e.g. "Oct 24, 2026", independent of theme dateFormat.
   * @param {Date} d Date to format.
   * @returns {string} Short month, day and year.
   */
  function longDate(d) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  /**
   * Describes how long ago a timestamp was, e.g. "today", "5d ago", "3mo ago".
   * @param {string} iso ISO 8601 timestamp.
   * @returns {string} Compact relative time.
   */
  function timeAgo(iso) {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days < 1) return "today";
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }

  /**
   * Inner SVG markup of the small 16×16 icons used by repo badges and the
   * sort bar, keyed by name.
   * @type {Object<string, string>}
   */
  const ICONS = {
    order: '<path d="M3 4h10M3 8h10M3 12h10"/>',
    name: '<path d="M2 13 5 3l3 10M3.2 9.5h3.6M10 6h4l-4 7h4"/>',
    visitors: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>',
    clones: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>',
    referrers: '<path d="M9 2.5h4.5V7M13.5 2.5 7 9M11.5 9.5v4h-9v-9h4"/>',
    stars: '<path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6Z"/>',
    forks: '<path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 0-1.5 0v.878H6.75v-.878a2.25 2.25 0 1 0-1.5 0ZM8 13.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm0-8.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM4.25 5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm7.5 0a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM8 9v2.5"/>',
    issues: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5v4M8 10.5v.5"/>',
    pulls: '<path d="M10 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM6 7v6M10 5v4"/>',
    comments: '<path d="M2.5 3.5h11v7.5H8l-3 2.5V11H2.5Z"/>',
    releases: '<path d="M2.5 2.5h5l6 6-5 5-6-6Z"/><circle cx="5.5" cy="5.5" r="1"/>',
    downloads: '<path d="M8 2v8M5 7l3 3 3-3M3 13h10"/>',
    pushed: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>',
    sort: '<path d="M5 2.5v11M2.5 11 5 13.5 7.5 11M11 13.5v-11M8.5 5 11 2.5 13.5 5"/>',
    ascending: '<path d="M8 13V3M4 7l4-4 4 4"/>',
    descending: '<path d="M8 3v10M4 9l4 4 4-4"/>',
  };

  /**
   * Renders one of the ICONS as a decorative inline SVG.
   * @param {string} name Key in ICONS.
   * @returns {string} SVG markup.
   */
  function icon(name) {
    return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  /** Escapes a string for safe insertion into HTML */
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  /**
   * Formats a date string (YYYY-MM-DD) according to the theme dateFormat.
   * dateFormat is any arrangement of D, M, Y (e.g. "DMY", "MDY", "YMD").
   * Produces DD/MM/YY, MM/DD/YY, YY/MM/DD etc. with "/" separator.
   */
  function dateLabel(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(2);

    const format = parseDateFormat(theme.dateFormat);
    const parts = format.map((c) => {
      if (c === "D") return dd;
      if (c === "M") return mm;
      if (c === "Y") return yy;
      return dd;
    });
    return parts.join("/");
  }

  /**
   * Parses a dateFormat string (e.g. "DMY", "MDY", "YMD") into an array of
   * component letters [D, M, Y]. Falls back to ["D","M","Y"] if invalid.
   */
  function parseDateFormat(formatStr) {
    if (!formatStr || typeof formatStr !== "string") return ["D", "M", "Y"];
    const upper = formatStr.toUpperCase().replace(/[^DMY]/g, "");
    const chars = [];
    for (const c of upper) {
      if ((c === "D" || c === "M" || c === "Y") && !chars.includes(c)) {
        chars.push(c);
      }
    }
    if (chars.length !== 3) return ["D", "M", "Y"];
    return chars;
  }

  /**
   * Returns the start date string for the chart viewport.
   * defaultChartRange is a number of days (e.g. 30, 90, 180, 365).
   * 0 means show all data.
   */
  function rangeStartDate(rangeDays) {
    const days = typeof rangeDays === "number" ? rangeDays : parseInt(rangeDays, 10);
    if (!days || days <= 0) return null; // 0 or invalid = show all
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  // ── Theme ────────────────────────────────────────────────────────────────

  async function loadTheme() {
    try {
      const res = await fetch("theme.json");
      theme = await res.json();
    } catch {
      theme = {};
    }

    // Apply fonts
    const fonts = theme.fonts || {};
    const fontFamilies = [
      fonts.heading || "DM Sans",
      fonts.body || "DM Sans",
      fonts.mono || "JetBrains Mono",
    ];
    const uniqueFonts = [...new Set(fontFamilies)];
    const fontLink = document.getElementById("google-fonts");
    if (fontLink) {
      const families = uniqueFonts.map((f) => f.replace(/ /g, "+") + ":wght@400;500;600").join("&family=");
      fontLink.href = `https://fonts.googleapis.com/css2?family=${families}&display=swap`;
    }

    document.documentElement.style.setProperty("--font-h", `'${fonts.heading || "DM Sans"}', system-ui, sans-serif`);
    document.documentElement.style.setProperty("--font-b", `'${fonts.body || "DM Sans"}', system-ui, sans-serif`);
    document.documentElement.style.setProperty("--font-m", `'${fonts.mono || "JetBrains Mono"}', monospace`);

    // Title
    const title = theme.title || "Traffic Dashboard";
    document.title = title;
    const titleEl = document.getElementById("header-title");
    if (titleEl) titleEl.textContent = title;

    // Logo — use DOM API to avoid innerHTML XSS
    const logoContainer = document.getElementById("header-logo");
    if (logoContainer) {
      if (theme.logo) {
        logoContainer.innerHTML = "";
        const img = document.createElement("img");
        img.src = theme.logo;
        img.alt = "Logo";
        img.onerror = () => { logoContainer.style.display = "none"; };
        logoContainer.appendChild(img);
        logoContainer.className = "header-logo";
      } else {
        logoContainer.innerHTML = `<svg viewBox="0 0 16 16" fill="none"><rect x="2.5" y="9" width="3" height="5" rx="0.8" fill="white" opacity="0.55"/><rect x="6.5" y="5.5" width="3" height="8.5" rx="0.8" fill="white" opacity="0.75"/><rect x="10.5" y="2.5" width="3" height="11.5" rx="0.8" fill="white"/></svg>`;
        logoContainer.className = "header-logo-default";
      }
    }

    // Default mode
    const saved = localStorage.getItem("theme-mode");
    const mode = saved || theme.defaultMode || "light";
    applyMode(mode);
  }

  function applyMode(mode) {
    const colors = theme.colors || {};
    const palette = mode === "dark" ? colors.dark : colors.light;
    if (palette) {
      document.documentElement.style.setProperty("--bg", palette.bg);
      document.documentElement.style.setProperty("--bg2", palette.bgSecondary);
      document.documentElement.style.setProperty("--bg3", palette.bgTertiary);
      document.documentElement.style.setProperty("--tx", palette.text);
      document.documentElement.style.setProperty("--tx2", palette.textSecondary);
      document.documentElement.style.setProperty("--tx3", palette.textMuted);
      document.documentElement.style.setProperty("--accent", palette.accent);
      document.documentElement.style.setProperty("--accent-soft", palette.accentSoft);
      document.documentElement.style.setProperty("--border", palette.border);
      document.documentElement.style.setProperty("--chart1", palette.chartLine1);
      document.documentElement.style.setProperty("--chart2", palette.chartLine2);
      document.documentElement.style.setProperty("--shadow", palette.shadow);
    }
    document.documentElement.setAttribute("data-theme", mode === "dark" ? "dark" : "");
    localStorage.setItem("theme-mode", mode);
  }

  function toggleTheme() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const mode = isDark ? "light" : "dark";
    applyMode(mode);
    updateAllChartColors();
  }

  // ── Data loading ─────────────────────────────────────────────────────────

  async function loadConfig() {
    try {
      const res = await fetch("config.json");
      return await res.json();
    } catch {
      return { repos: [] };
    }
  }

  async function loadDataFile(repoFullName) {
    const [owner, repo] = repoFullName.split("/");
    const filename = `${owner}--${repo}.json`;
    try {
      const res = await fetch(`data/${filename}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  // ── Decrypt flow ─────────────────────────────────────────────────────────

  function hasEncryptedFiles() {
    return rawDataFiles.some((f) => f && f.format === "encrypted");
  }

  async function attemptDecrypt(password) {
    const errEl = document.getElementById("decrypt-err");
    if (!password) {
      errEl.textContent = "Please enter a password";
      return false;
    }

    try {
      const decrypted = [];
      for (const file of rawDataFiles) {
        if (!file) {
          decrypted.push(null);
          continue;
        }
        if (file.format === "encrypted") {
          const d = await DashCrypto.decryptDataFile(file, password);
          decrypted.push(d);
        } else {
          decrypted.push(file);
        }
      }
      decryptedDataFiles = decrypted;
      sessionStorage.setItem("dash-pw", password);
      document.getElementById("decrypt-modal").classList.add("hidden");
      return true;
    } catch {
      errEl.textContent = "Incorrect password. Please try again.";
      document.getElementById("decrypt-pw").value = "";
      document.getElementById("decrypt-pw").focus();
      return false;
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  function showSkeleton(repos) {
    const main = document.getElementById("dashboard-content");
    let html = "";
    for (let i = 0; i < repos.length; i++) {
      html += `<div class="skeleton-row"><div class="skeleton skeleton-header"></div><div class="row g-3"><div class="col-md-4 col-12"><div class="skeleton skeleton-card"></div></div><div class="col-md-4 col-12"><div class="skeleton skeleton-card"></div></div><div class="col-md-4 col-12"><div class="skeleton skeleton-card"></div></div></div></div>`;
    }
    main.innerHTML = html;
  }

  function renderDashboard(config, dataFiles) {
    const main = document.getElementById("dashboard-content");
    chartInstances = [];
    let html = "";

    // Update header timestamp
    let latestUpdate = "";
    for (const f of dataFiles) {
      if (f && f.updated && f.updated > latestUpdate) latestUpdate = f.updated;
    }
    const updatedEl = document.getElementById("header-updated");
    if (updatedEl && latestUpdate) {
      const d = new Date(latestUpdate);
      updatedEl.textContent = `Updated ${longDate(d)} \u00b7 ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
    }

    repoEntries = config.repos.map((repoFullName, idx) => {
      const [owner, repo] = repoFullName.split("/");
      return { idx, owner, repo, data: dataFiles[idx] };
    });
    // A remembered sort whose data is not collected yet falls back to config order
    if (!isSortAvailable(findSortOption(sortState.key))) {
      sortState = { key: "order", dir: 1 };
    }
    if (repoEntries.length > 1) {
      html += renderSortBar();
    }
    html += '<div id="repo-list">';

    for (let i = 0; i < config.repos.length; i++) {
      const repoFullName = config.repos[i];
      const data = dataFiles[i];
      const [owner, repo] = repoFullName.split("/");
      const idx = i;

      const forks = data ? data.forks || 0 : 0;
      const issues = data && data.issues ? data.issues : { closed: 0, open: 0 };
      const pullRequests = data && data.pullRequests ? data.pullRequests : { merged: 0, open: 0 };
      const views = data && data.data ? data.data.views || [] : [];
      const clones = data && data.data ? data.data.clones || [] : [];
      const referrers = data && data.data ? data.data.referrers || [] : [];
      const releases = data && data.data ? data.data.releases || [] : [];

      // All-time totals for headline numbers
      const totalViews = sumBy(views, "count");
      const uniqueViews = sumBy(views, "uniques");
      const totalClones = sumBy(clones, "count");
      const uniqueClones = sumBy(clones, "uniques");

      const ownerEsc = esc(owner);
      const repoEsc = esc(repo);
      const ownerInitialEsc = esc(owner.charAt(0).toUpperCase());
      const repoUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

      // Show error message if data file failed to load
      const dataError = !data;

      html += `
      <div class="repo-section" id="repo-${idx}">
        <div class="repo-header">
          <div class="repo-avatar">
            <img src="https://avatars.githubusercontent.com/${encodeURIComponent(owner)}?s=60" alt="" onerror="this.style.display='none'; this.parentElement.textContent='${ownerInitialEsc}'">
          </div>
          <a class="repo-name" href="${repoUrl}" target="_blank" rel="noopener noreferrer">
            <span class="owner">${ownerEsc} /</span> ${repoEsc}
          </a>
          ${data && typeof data.stars === "number" ? renderBadge(`${repoUrl}/stargazers`, "Stars", "stars", fmt(data.stars)) : ""}
          ${renderBadge(`${repoUrl}/network/members`, "Forks", "forks", fmt(forks))}
          ${renderBadge(`${repoUrl}/issues`, "Issues", "issues", `
            <span title="Closed issues">${fmt(issues.closed)}</span>
            <span class="badge-sep">/</span>
            <span class="${issues.open > 0 ? "badge-accent" : ""}" title="Open issues">${fmt(issues.open)}</span>`)}
          ${renderBadge(`${repoUrl}/pulls`, "Pull requests", "pulls", `
            <span title="Merged PRs">${fmt(pullRequests.merged)}</span>
            <span class="badge-sep">/</span>
            <span class="${pullRequests.open > 0 ? "badge-accent" : ""}" title="Open PRs">${fmt(pullRequests.open)}</span>`)}
          ${data && typeof data.comments === "number" ? renderBadge(`${repoUrl}/issues?q=sort%3Acomments-desc`, "Comments on issues and pull requests", "comments", fmt(data.comments)) : ""}
          ${dataError ? "" : renderBadge(`${repoUrl}/releases`, "Releases", "releases", `
            <span title="Releases">${fmt(releases.length)}</span>
            <span class="badge-sep">/</span>
            <span title="Release downloads">${fmt(sumBy(releases, "downloads"))}</span>`, "releases downloads")}
          ${data && data.pushedAt ? renderBadge(`${repoUrl}/commits`, `Last push ${longDate(new Date(data.pushedAt))}`, "pushed", timeAgo(data.pushedAt)) : ""}
          <button class="csv-btn" data-repo-idx="${idx}" onclick="App.exportCSV(${idx})"${dataError ? " disabled" : ""}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 12V14H12V12M8 2V10M5 7L8 10L11 7"/></svg>
            CSV
          </button>
        </div>
        <div class="row g-3">
          <!-- Visitors -->
          <div class="col-md-4 col-12">
            <div class="card-dash" data-sort-target="visitors">
              <div class="card-label">Visitors</div>
              ${dataError
                ? '<div class="no-data-msg">Data not yet collected</div>'
                : `<div class="card-value">${fmt(totalViews)}</div>
              <div class="card-sub"><strong>${fmt(uniqueViews)}</strong> unique</div>
              <div class="chart-wrap"><canvas id="visitors-${idx}"></canvas></div>
              ${renderChartControls(`visitors-${idx}`)}`}
            </div>
          </div>
          <!-- Clones -->
          <div class="col-md-4 col-12">
            <div class="card-dash" data-sort-target="clones">
              <div class="card-label">Clones</div>
              ${dataError
                ? '<div class="no-data-msg">Data not yet collected</div>'
                : `<div class="card-value">${fmt(totalClones)}</div>
              <div class="card-sub"><strong>${fmt(uniqueClones)}</strong> unique</div>
              <div class="chart-wrap"><canvas id="clones-${idx}"></canvas></div>
              ${renderChartControls(`clones-${idx}`)}`}
            </div>
          </div>
          <!-- Referrers / Releases -->
          <div class="col-md-4 col-12">
            <div class="card-dash" id="card3-${idx}" data-sort-target="referrers">
              <div class="tabs">
                <div class="tab active" onclick="App.switchTab('card3-${idx}','ref')">Referrers</div>
                <div class="tab" onclick="App.switchTab('card3-${idx}','rel')">Releases</div>
              </div>
              <div class="tab-content ref">
                ${dataError ? '<div class="no-data-msg">Data not yet collected</div>' : renderReferrersTable(referrers)}
              </div>
              <div class="tab-content rel" style="display:none" id="releases-${idx}">
                <div class="no-data-msg">Loading releases\u2026</div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    }

    html += "</div>";
    main.innerHTML = html;
    applySort();

    // Create charts (skip for repos with no data)
    for (let i = 0; i < config.repos.length; i++) {
      const data = dataFiles[i];
      if (!data || !data.data) continue;
      const views = data.data.views || [];
      const clones = data.data.clones || [];

      createChart(`visitors-${i}`, views);
      createChart(`clones-${i}`, clones);
    }

    // Render releases from data files (fetched by cron, not client-side)
    for (let i = 0; i < config.repos.length; i++) {
      const data = dataFiles[i];
      const container = document.getElementById(`releases-${i}`);
      if (!container) continue;
      const releases = data && data.data && data.data.releases ? data.data.releases : [];
      if (releases.length === 0) {
        container.innerHTML = '<div class="no-data-msg">No releases</div>';
      } else {
        let rows = "";
        for (const r of releases) {
          rows += `<tr><td>${esc(r.tag)}</td><td>${fmt(r.downloads)}</td></tr>`;
        }
        container.innerHTML = `<div class="ref-scroll-container"><table class="ref-table"><thead><tr><th>Release</th><th>Downloads</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      }
    }
  }

  /**
   * Icon-only chart buttons, in display order. Each label doubles as the
   * screen reader text and the tooltip.
   * @type {Array<{ label: string, action: string, icon: string }>}
   */
  const CHART_BUTTONS = [
    { label: "Pan left", action: "App.panChart('{id}', -1)", icon: '<path d="m15 18-6-6 6-6"/>' },
    { label: "Pan right", action: "App.panChart('{id}', 1)", icon: '<path d="m9 18 6-6-6-6"/>' },
    { label: "Zoom in", action: "App.zoomChart('{id}', 1)", icon: '<path d="M5 12h14M12 5v14"/>' },
    { label: "Zoom out", action: "App.zoomChart('{id}', -1)", icon: '<path d="M5 12h14"/>' },
    { label: "Reset zoom", action: "App.resetZoom('{id}')", icon: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>' },
  ];

  /**
   * Renders the legend and the pan/zoom buttons below a chart.
   * @param {string} canvasId Id of the chart canvas the buttons control.
   * @returns {string} Controls markup.
   */
  function renderChartControls(canvasId) {
    let buttons = "";
    for (const b of CHART_BUTTONS) {
      buttons += `<button type="button" class="chart-btn" title="${b.label}" onclick="${b.action.replace("{id}", canvasId)}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b.icon}</svg>
                    <span class="visually-hidden">${b.label}</span>
                  </button>`;
    }
    return `<div class="chart-controls">
                <div class="chart-legend">
                  <div class="chart-legend-item"><div class="legend-line" style="border-color:var(--chart1)"></div>Total</div>
                  <div class="chart-legend-item"><div class="legend-line dashed" style="border-color:var(--chart2)"></div>Unique</div>
                </div>
                <div class="chart-buttons">
                  <svg class="chart-buttons-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                  ${buttons}
                </div>
              </div>`;
  }

  /**
   * Renders a pill-shaped repo header badge that links to GitHub.
   * @param {string} href Link target.
   * @param {string} title Tooltip describing the value.
   * @param {string} iconName Key in ICONS.
   * @param {string} content Badge content markup, already escaped.
   * @param {string} [sortTarget] Space-separated sort option keys whose
   *   values this badge shows, highlighted while sorting on them.
   * @returns {string} Badge markup.
   */
  function renderBadge(href, title, iconName, content, sortTarget = iconName) {
    return `<a class="repo-badge" href="${href}" target="_blank" rel="noopener noreferrer" title="${esc(title)}" data-sort-target="${sortTarget}">
            ${icon(iconName)}
            ${content}
          </a>`;
  }

  function renderReferrersTable(referrers) {
    if (referrers.length === 0) {
      return '<div class="no-data-msg">No referrer data yet</div>';
    }
    let rows = "";
    for (const r of referrers) {
      rows += `<tr><td>${esc(r.referrer)}</td><td>${fmt(r.count)}</td><td>${fmt(r.uniques)}</td></tr>`;
    }
    return `<div class="ref-scroll-container"><table class="ref-table"><thead><tr><th>Site</th><th>Visits</th><th>Unique</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // ── Sorting ──────────────────────────────────────────────────────────────

  /**
   * Returns one traffic list of a repo's data file.
   * @param {Object|null} data Repo data file.
   * @param {string} key "views", "clones", "referrers" or "releases".
   * @returns {Array<Object>|null} The list, or null when no traffic data was loaded.
   */
  function trafficList(data, key) {
    return data && data.data ? data.data[key] || [] : null;
  }

  /**
   * Sort values for a daily traffic list: total count, then unique count.
   * @param {Array<Object>|null} list Daily entries from trafficList.
   * @returns {Array<number>} Sort values, empty when there is no data.
   */
  function trafficTotals(list) {
    return list ? [sumBy(list, "count"), sumBy(list, "uniques")] : [];
  }

  /**
   * Sort values for an "open / done" pair such as issues or pull requests:
   * all of them, then the open ones.
   * @param {Object|undefined} pair Counts object, e.g. { open, closed }.
   * @param {string} doneKey Name of the finished count, "closed" or "merged".
   * @returns {Array<number>} Sort values, empty when the counts are missing.
   */
  function pairTotals(pair, doneKey) {
    return pair ? [pair.open + pair[doneKey], pair.open] : [];
  }

  /**
   * Sort values for a single number on the data file.
   * @param {*} value Field value.
   * @returns {Array<number>} The number, or empty when it was not collected.
   */
  function numberValue(value) {
    return typeof value === "number" ? [value] : [];
  }

  /**
   * Options in the sort bar, in display order. `value` returns what a repo is
   * compared on, most significant first, or an empty array when that repo has
   * no such data; those repos always go last. `dir` is the direction picked
   * when the option is first chosen: 1 ascending, -1 descending. `tab` is
   * the referrers/releases card tab that lists the sorted data.
   * @type {Array<{ key: string, label: string, title: string, dir: number, tab?: string, value: function(Object): Array }>}
   */
  const SORT_OPTIONS = [
    { key: "order", label: "Default", title: "Order of config.json", dir: 1, value: (e) => [e.idx] },
    { key: "name", label: "Name", title: "Repository name", dir: 1, value: (e) => [e.repo.toLowerCase(), e.owner.toLowerCase()] },
    { key: "visitors", label: "Visitors", title: "All-time visitors, then unique visitors", dir: -1, value: (e) => trafficTotals(trafficList(e.data, "views")) },
    { key: "clones", label: "Clones", title: "All-time clones, then unique clones", dir: -1, value: (e) => trafficTotals(trafficList(e.data, "clones")) },
    { key: "referrers", label: "Referrers", title: "Visits from referring sites, then number of sites", dir: -1, tab: "ref", value: (e) => {
      const referrers = trafficList(e.data, "referrers");
      return referrers ? [sumBy(referrers, "count"), referrers.length] : [];
    } },
    { key: "stars", label: "Stars", title: "Stars", dir: -1, value: (e) => numberValue(e.data && e.data.stars) },
    { key: "forks", label: "Forks", title: "Forks", dir: -1, value: (e) => numberValue(e.data && e.data.forks) },
    { key: "issues", label: "Issues", title: "All issues, then open issues", dir: -1, value: (e) => pairTotals(e.data && e.data.issues, "closed") },
    { key: "pulls", label: "PRs", title: "Merged and open pull requests, then open ones", dir: -1, value: (e) => pairTotals(e.data && e.data.pullRequests, "merged") },
    { key: "comments", label: "Comments", title: "Comments on issues and pull requests", dir: -1, value: (e) => numberValue(e.data && e.data.comments) },
    { key: "releases", label: "Releases", title: "Number of releases, then release downloads", dir: -1, tab: "rel", value: (e) => {
      const releases = trafficList(e.data, "releases");
      return releases ? [releases.length, sumBy(releases, "downloads")] : [];
    } },
    { key: "downloads", label: "Downloads", title: "Release downloads over all releases", dir: -1, tab: "rel", value: (e) => {
      const releases = trafficList(e.data, "releases");
      return releases ? [sumBy(releases, "downloads")] : [];
    } },
    { key: "pushed", label: "Last push", title: "Most recent push to any branch", dir: -1, value: (e) => (e.data && e.data.pushedAt ? [e.data.pushedAt] : []) },
  ];

  /**
   * Looks up a sort option by key.
   * @param {string} key Option key.
   * @returns {Object|undefined} The option, or undefined when unknown.
   */
  function findSortOption(key) {
    return SORT_OPTIONS.find((o) => o.key === key);
  }

  /**
   * Explains why a sort option can't be used: no repo on screen has its data
   * yet (older data files lack fields that later collector versions add), or
   * every repo that has it has the same value, so sorting changes nothing.
   * @param {Object|undefined} option Sort option.
   * @returns {string} Reason for the tooltip, or "" when the option can be used.
   */
  function sortUnavailableReason(option) {
    if (!option) return "unknown option";
    const distinct = new Set();
    for (const e of repoEntries) {
      const value = option.value(e);
      if (value.length > 0) distinct.add(JSON.stringify(value));
    }
    if (distinct.size === 0) return "available after the next data collection";
    if (distinct.size === 1) return "every repo has the same value";
    return "";
  }

  /**
   * Tells whether sorting on an option would order the repos meaningfully.
   * @param {Object|undefined} option Sort option.
   * @returns {boolean} True when the option can be used.
   */
  function isSortAvailable(option) {
    return sortUnavailableReason(option) === "";
  }

  /**
   * Restores the sort chosen on a previous visit.
   * @returns {void}
   */
  function loadSortState() {
    try {
      const saved = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) || "null");
      if (saved && findSortOption(saved.key) && (saved.dir === 1 || saved.dir === -1)) {
        sortState = { key: saved.key, dir: saved.dir };
      }
    } catch {
      // Unreadable or blocked storage keeps the default order
    }
  }

  /**
   * Renders the sort bar shown above the repo list.
   * @returns {string} Sort bar markup.
   */
  function renderSortBar() {
    let buttons = "";
    for (const o of SORT_OPTIONS) {
      const active = o.key === sortState.key;
      const reason = sortUnavailableReason(o);
      const available = reason === "";
      let title = o.title;
      if (!available) title += ` · ${reason}`;
      else if (active) title += " · click to reverse";
      const dirName = sortState.dir < 0 ? "descending" : "ascending";
      buttons += `<button type="button" class="sort-btn${active ? " active" : ""}" data-sort="${o.key}" title="${title}" aria-pressed="${active}"${available ? "" : ' aria-disabled="true"'} onclick="App.setSort('${o.key}')">
                ${icon(o.key)}
                <span>${o.label}</span>
                ${active ? `<span class="sort-dir">${icon(dirName)}<span class="visually-hidden">, ${dirName}</span></span>` : ""}
              </button>`;
    }
    return `<div class="sort-bar" id="sort-bar" role="toolbar" aria-label="Sort repositories">
              <span class="sort-label">${icon("sort")}</span>
              ${buttons}
            </div>`;
  }

  /**
   * Compares two repos for the active sort. Repos without data for it go
   * last in either direction; ties keep config order.
   * @param {{ entry: Object, value: Array }} a First repo and its sort values.
   * @param {{ entry: Object, value: Array }} b Second repo and its sort values.
   * @returns {number} Negative when a comes first, positive when b does.
   */
  function compareRepos(a, b) {
    if (a.value.length === 0 || b.value.length === 0) {
      return (b.value.length - a.value.length) || (a.entry.idx - b.entry.idx);
    }
    for (let i = 0; i < a.value.length; i++) {
      const x = a.value[i];
      const y = b.value[i];
      const diff = typeof x === "string" ? x.localeCompare(y) : x - y;
      if (diff !== 0) return diff * sortState.dir;
    }
    return a.entry.idx - b.entry.idx;
  }

  /**
   * Shows where the sorted values are: highlights the badges and cards that
   * hold them and, for referrers and releases, opens the tab that lists them.
   * @returns {void}
   */
  function showSortTarget() {
    const key = sortState.key;
    document.querySelectorAll("[data-sort-target]").forEach((el) => {
      el.classList.toggle("sorted", el.dataset.sortTarget.split(" ").includes(key));
    });
    const option = findSortOption(key);
    if (!option || !option.tab) return;
    for (const entry of repoEntries) {
      switchTab(`card3-${entry.idx}`, option.tab);
    }
  }

  /**
   * Reorders the repo sections on screen for the active sort. Sections are
   * moved rather than re-rendered, so charts keep their zoom and pan.
   * @returns {void}
   */
  function applySort() {
    showSortTarget();
    const list = document.getElementById("repo-list");
    const option = findSortOption(sortState.key);
    if (!list || !option) return;
    const sorted = repoEntries
      .map((entry) => ({ entry, value: option.value(entry) }))
      .sort(compareRepos);
    for (const { entry } of sorted) {
      list.appendChild(document.getElementById(`repo-${entry.idx}`));
    }
  }

  /**
   * Sorts the repos by an option; choosing the active option again reverses
   * the direction. The choice is remembered for the next visit.
   * @param {string} key Sort option key.
   * @returns {void}
   */
  function setSort(key) {
    const option = findSortOption(key);
    if (!isSortAvailable(option)) return;
    sortState = key === sortState.key
      ? { key, dir: -sortState.dir }
      : { key, dir: option.dir };
    try {
      localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sortState));
    } catch {
      // The sort still applies for this visit
    }

    const bar = document.getElementById("sort-bar");
    if (bar) {
      const hadFocus = bar.contains(document.activeElement);
      bar.outerHTML = renderSortBar();
      if (hadFocus) document.querySelector(`#sort-bar [data-sort="${key}"]`).focus();
    }
    applySort();
  }

  // ── Charts ───────────────────────────────────────────────────────────────

  function createChart(canvasId, dataPoints) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const labels = dataPoints.map((d) => dateLabel(d.date));
    // Plot against the day index on a linear scale so panning is stepless
    const totals = dataPoints.map((d, i) => ({ x: i, y: d.count }));
    const uniques = dataPoints.map((d, i) => ({ x: i, y: d.uniques }));
    const maxIdx = Math.max(labels.length - 1, 0);
    const maxCount = dataPoints.reduce((m, d) => Math.max(m, d.count, d.uniques), 0);

    // Compute initial viewport using days-based range
    const defaultRange = theme.defaultChartRange;
    const minDate = rangeStartDate(defaultRange);
    let minIdx = 0;
    if (minDate && dataPoints.length > 0) {
      for (let i = 0; i < dataPoints.length; i++) {
        if (dataPoints[i].date >= minDate) { minIdx = i; break; }
      }
    }

    const zoomOptions = {};
    if (typeof ChartZoom !== "undefined" || (Chart.registry && Chart.registry.getPlugin("zoom"))) {
      zoomOptions.zoom = {
        wheel: { enabled: true },
        pinch: { enabled: true },
        mode: "x",
      };
      zoomOptions.pan = {
        enabled: true,
        mode: "x",
      };
      // Keep the view inside the data and show at least three days
      zoomOptions.limits = {
        x: { min: 0, max: maxIdx, minRange: 2 },
      };
    }

    // Read font families from theme CSS vars for tooltip consistency
    const tooltipHeadingFont = getCSS("--font-h") || "'DM Sans', system-ui, sans-serif";
    const tooltipMonoFont = getCSS("--font-m") || "'JetBrains Mono', monospace";

    const chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        datasets: [
          {
            label: "Total",
            data: totals,
            borderColor: getCSS("--chart1"),
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: getCSS("--chart1"),
            pointHoverBackgroundColor: getCSS("--chart1"),
            // Monotone curves never overshoot, so flat zero stretches stay flat
            cubicInterpolationMode: "monotone",
            fill: false,
          },
          {
            label: "Unique",
            data: uniques,
            borderColor: getCSS("--chart2"),
            borderWidth: 2,
            borderDash: [5, 4],
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: getCSS("--chart2"),
            pointHoverBackgroundColor: getCSS("--chart2"),
            cubicInterpolationMode: "monotone",
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        // Transitions lag behind panning and zooming, so redraw instantly
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(0,0,0,0.8)",
            titleFont: { family: tooltipHeadingFont, size: 12, weight: "500" },
            bodyFont: { family: tooltipMonoFont, size: 11 },
            padding: 10,
            cornerRadius: 6,
            displayColors: true,
            boxWidth: 8,
            boxHeight: 2,
            boxPadding: 4,
            callbacks: {
              title: (items) => labels[items[0].parsed.x],
              label: (item) => ` ${item.dataset.label}: ${item.formattedValue}`,
            },
          },
          zoom: zoomOptions,
        },
        scales: {
          x: {
            type: "linear",
            bounds: "data",
            ticks: {
              color: getCSS("--tx3"),
              font: { family: tooltipMonoFont, size: 9 },
              maxRotation: 0,
              maxTicksLimit: 6,
              precision: 0,
              includeBounds: false,
              callback: (value) => labels[value] || "",
            },
            grid: { color: getCSS("--border"), lineWidth: 0.5 },
            border: { display: false },
            min: minIdx,
            max: maxIdx,
          },
          y: {
            ticks: {
              color: getCSS("--tx3"),
              font: { family: tooltipMonoFont, size: 9 },
              maxTicksLimit: 4,
            },
            grid: { color: getCSS("--border"), lineWidth: 0.5 },
            border: { display: false },
            beginAtZero: true,
            // Fit all data, not just the visible days, so zoom stays horizontal
            suggestedMax: maxCount,
          },
        },
      },
    });

    chartInstances.push({ id: canvasId, chart, defaultMinIdx: minIdx });
  }

  function updateAllChartColors() {
    for (const { chart } of chartInstances) {
      chart.options.scales.x.ticks.color = getCSS("--tx3");
      chart.options.scales.y.ticks.color = getCSS("--tx3");
      chart.options.scales.x.grid.color = getCSS("--border");
      chart.options.scales.y.grid.color = getCSS("--border");
      chart.data.datasets[0].borderColor = getCSS("--chart1");
      chart.data.datasets[0].pointBackgroundColor = getCSS("--chart1");
      chart.data.datasets[0].pointHoverBackgroundColor = getCSS("--chart1");
      chart.data.datasets[1].borderColor = getCSS("--chart2");
      chart.data.datasets[1].pointBackgroundColor = getCSS("--chart2");
      chart.data.datasets[1].pointHoverBackgroundColor = getCSS("--chart2");
      chart.update("none");
    }
  }

  /**
   * Share of the visible chart width moved by one pan button press.
   * @type {number}
   */
  const PAN_STEP = 0.25;

  /**
   * Zoom factor applied by one zoom button press.
   * @type {number}
   */
  const ZOOM_STEP = 1.25;

  /**
   * Looks up a chart created by createChart.
   * @param {string} canvasId Id of the chart canvas.
   * @returns {Object|undefined} The chart entry, or undefined when absent.
   */
  function findChart(canvasId) {
    return chartInstances.find((c) => c.id === canvasId);
  }

  /**
   * Pans a chart horizontally by PAN_STEP of its visible width.
   * @param {string} canvasId Id of the chart canvas.
   * @param {number} direction -1 for earlier dates, 1 for later dates.
   * @returns {void}
   */
  function panChart(canvasId, direction) {
    const entry = findChart(canvasId);
    if (!entry || !entry.chart.pan) return;
    const { chart } = entry;
    const width = chart.chartArea.right - chart.chartArea.left;
    // A positive pixel delta drags the content right, revealing earlier dates
    chart.pan({ x: -direction * width * PAN_STEP }, undefined, "none");
  }

  /**
   * Zooms a chart horizontally around its centre by ZOOM_STEP.
   * @param {string} canvasId Id of the chart canvas.
   * @param {number} direction 1 to zoom in, -1 to zoom out.
   * @returns {void}
   */
  function zoomChart(canvasId, direction) {
    const entry = findChart(canvasId);
    if (!entry || !entry.chart.zoom) return;
    const factor = direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    entry.chart.zoom({ x: factor }, "none");
  }

  function resetZoom(canvasId) {
    const entry = findChart(canvasId);
    if (!entry) return;
    const { chart, defaultMinIdx } = entry;
    if (chart.resetZoom) {
      chart.resetZoom("none");
    }
    chart.options.scales.x.min = defaultMinIdx;
    chart.update("none");
  }

  // ── Tabs ─────────────────────────────────────────────────────────────────

  function switchTab(cardId, type) {
    const card = document.getElementById(cardId);
    if (!card) return;
    card.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    card.querySelectorAll(".tab-content").forEach((c) => (c.style.display = "none"));
    if (type === "ref") {
      card.querySelector(".tab:first-child").classList.add("active");
      card.querySelector(".tab-content.ref").style.display = "block";
    } else {
      card.querySelector(".tab:last-child").classList.add("active");
      card.querySelector(".tab-content.rel").style.display = "block";
    }
  }

  // ── CSV export ───────────────────────────────────────────────────────────

  function exportCSV(repoIdx) {
    const data = decryptedDataFiles[repoIdx] || rawDataFiles[repoIdx];
    if (!data || !data.data) return;

    const repoName = data.repo.replace("/", "--");
    const today = new Date().toISOString().slice(0, 10);
    const filename = `${repoName}--traffic--${today}.csv`;

    const views = data.data.views || [];
    const clones = data.data.clones || [];
    const referrers = data.data.referrers || [];

    // Merge views and clones by date
    const dateMap = new Map();
    for (const v of views) {
      dateMap.set(v.date, { views: v.count, unique_views: v.uniques, clones: 0, unique_clones: 0 });
    }
    for (const c of clones) {
      const existing = dateMap.get(c.date) || { views: 0, unique_views: 0, clones: 0, unique_clones: 0 };
      existing.clones = c.count;
      existing.unique_clones = c.uniques;
      dateMap.set(c.date, existing);
    }

    // Use ISO dates (YYYY-MM-DD) in CSV for machine-readability
    const sortedDates = [...dateMap.keys()].sort();
    let csv = "date,views,unique_views,clones,unique_clones\n";
    for (const date of sortedDates) {
      const d = dateMap.get(date);
      csv += `${date},${d.views},${d.unique_views},${d.clones},${d.unique_clones}\n`;
    }

    // Add referrers section
    if (referrers.length > 0) {
      csv += "\nreferrer,count,uniques\n";
      for (const r of referrers) {
        csv += `${r.referrer},${r.count},${r.uniques}\n`;
      }
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    // Delay revoke to allow the download to start in all browsers
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  async function init() {
    await loadTheme();
    loadSortState();

    const config = await loadConfig();
    if (config.repos.length === 0) {
      document.getElementById("dashboard-content").innerHTML =
        '<div class="no-data-msg" style="padding:48px 0">No repositories configured. Edit <code>config.json</code> to add repos.</div>';
      return;
    }

    showSkeleton(config.repos);

    // Load all data files
    rawDataFiles = await Promise.all(config.repos.map(loadDataFile));

    // Check encryption
    if (hasEncryptedFiles()) {
      // Try sessionStorage cache first
      const cachedPw = sessionStorage.getItem("dash-pw");
      if (cachedPw) {
        const ok = await attemptDecrypt(cachedPw);
        if (!ok) {
          sessionStorage.removeItem("dash-pw");
          document.getElementById("decrypt-modal").classList.remove("hidden");
          return;
        }
      } else {
        document.getElementById("decrypt-modal").classList.remove("hidden");
        return;
      }
    } else {
      decryptedDataFiles = rawDataFiles;
    }

    renderDashboard(config, decryptedDataFiles);
  }

  // Public decrypt handler — called after modal password entry
  async function handleDecrypt() {
    const pw = document.getElementById("decrypt-pw").value;
    const ok = await attemptDecrypt(pw);
    if (ok) {
      const config = await loadConfig();
      renderDashboard(config, decryptedDataFiles);
    }
  }

  return {
    init,
    toggleTheme,
    switchTab,
    setSort,
    panChart,
    zoomChart,
    resetZoom,
    exportCSV,
    handleDecrypt,
  };
})();

document.addEventListener("DOMContentLoaded", App.init);
