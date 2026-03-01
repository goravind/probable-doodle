(function attachUiComponents(globalScope) {
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function TextBlock({ text = "", tone = "body", maxLines = 0 } = {}) {
    const safe = escapeHtml(text || "");
    const clamp = Number(maxLines) > 0 ? ` style="-webkit-line-clamp:${Number(maxLines)};"` : "";
    const cls = `text-block ${tone}${Number(maxLines) > 0 ? " clamped" : ""}`;
    return `<p class="${cls}"${clamp}>${safe}</p>`;
  }

  function renderListItems(items = [], level = 1, ordered = false) {
    if (!Array.isArray(items) || items.length === 0) {
      return `<li class="empty">None</li>`;
    }
    return items
      .map((item) => {
        if (item && typeof item === "object" && Array.isArray(item.children)) {
          const head = escapeHtml(item.text || "");
          const childTag = ordered ? "ol" : "ul";
          return `<li><span>${head}</span><${childTag} class="indented-list level-${Math.min(4, level + 1)}">${renderListItems(item.children, level + 1, ordered)}</${childTag}></li>`;
        }
        return `<li><span>${escapeHtml(item)}</span></li>`;
      })
      .join("");
  }

  function IndentedList({ items = [], ordered = false, level = 1 } = {}) {
    const tag = ordered ? "ol" : "ul";
    return `<${tag} class="indented-list level-${Math.max(1, Math.min(4, level))}">${renderListItems(items, level, ordered)}</${tag}>`;
  }

  function Card({ title = "", subtitle = "", bodyHtml = "", footerHtml = "", className = "" } = {}) {
    const safeTitle = escapeHtml(title || "");
    const safeSubtitle = escapeHtml(subtitle || "");
    return [
      `<article class="ui-card ${className}">`,
      `<header class="ui-card-head">${safeTitle ? `<h3>${safeTitle}</h3>` : ""}${safeSubtitle ? `<p>${safeSubtitle}</p>` : ""}</header>`,
      `<div class="ui-card-body">${bodyHtml || ""}</div>`,
      footerHtml ? `<footer class="ui-card-foot">${footerHtml}</footer>` : "",
      `</article>`
    ].join("");
  }

  function ExpandableSection({ id = "", title = "Section", contentHtml = "", open = false } = {}) {
    return [
      `<details class="expandable-section"${open ? " open" : ""}${id ? ` id="${escapeHtml(id)}"` : ""}>`,
      `<summary>${escapeHtml(title)}</summary>`,
      `<div class="expandable-body">${contentHtml || ""}</div>`,
      `</details>`
    ].join("");
  }

  function ErrorBanner({ message = "", actions = [] } = {}) {
    const actionHtml = Array.isArray(actions) && actions.length
      ? `<div class="actions">${actions.map((label) => `<span class="chip muted">${escapeHtml(label)}</span>`).join("")}</div>`
      : "";
    return `<div class="action-error"><div class="text">${escapeHtml(message)}</div>${actionHtml}</div>`;
  }

  function SuccessBanner({ message = "" } = {}) {
    return `<div class="action-success">${escapeHtml(message)}</div>`;
  }

  function LoadingSkeleton({ lines = 3 } = {}) {
    const safeLines = Math.max(1, Math.min(8, Number(lines) || 3));
    const bars = Array.from({ length: safeLines }).map((_, idx) => `<div class="loading-skeleton line w-${idx % 2 === 0 ? 100 : 70}"></div>`).join("");
    return `<div class="loading-skeleton-stack" aria-hidden="true">${bars}</div>`;
  }

  const api = {
    escapeHtml,
    TextBlock,
    IndentedList,
    Card,
    ExpandableSection,
    ErrorBanner,
    SuccessBanner,
    LoadingSkeleton
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  globalScope.UIComponents = api;
})(typeof window !== "undefined" ? window : globalThis);
