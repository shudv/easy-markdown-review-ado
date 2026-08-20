/*
 * Showcase annotation overlay (browser-side).
 *
 * Injected on top of a real Storybook story (the production PR-tab / Documents
 * hub UI) by scripts/gif/build-showcase.mjs. It draws a "guided tour" layer —
 * a dimming spotlight, a numbered feature badge, a caption bar, a wordmark and
 * an intro/outro card — and exposes a tiny deterministic API so the Node
 * capture loop can render one exact frame at a time (no wall-clock animation,
 * so every screenshot is reproducible).
 *
 * This file is a build-time asset generator only. It is NOT part of the shipped
 * extension bundle.
 */
(function () {
  if (window.__tour) return;

  const NS = "emr-tour";
  const ACCENT = "#0b6cff";
  const INK = "#0a0c10";

  function el(tag, css, parent) {
    const node = document.createElement(tag);
    if (css) Object.assign(node.style, css);
    if (parent) parent.appendChild(node);
    return node;
  }

  let root, scrim, spot, badge, badgeNum, badgeLabel, caption, capTitle, capSub;
  let brand, card, cardTitle, cardSub, progress;

  function setup() {
    if (root) return;
    root = el(
      "div",
      {
        position: "fixed",
        inset: "0",
        zIndex: "2147483000",
        pointerEvents: "none",
        fontFamily:
          '"Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
        color: "#fff",
        overflow: "hidden",
      },
      document.body,
    );
    root.setAttribute("data-" + NS, "");

    // Plain full-viewport scrim (used for intro/outro when there is no spot).
    scrim = el("div", {
      position: "absolute",
      inset: "0",
      background: INK,
      opacity: "0",
    });
    root.appendChild(scrim);

    // Spotlight: a transparent rect whose huge box-shadow dims everything else.
    spot = el("div", {
      position: "absolute",
      left: "0",
      top: "0",
      width: "0",
      height: "0",
      borderRadius: "12px",
      boxShadow: "0 0 0 100vmax rgba(10,12,16,0)",
      outline: "2px solid rgba(11,108,255,0)",
      outlineOffset: "3px",
      opacity: "0",
      transition: "none",
    });
    root.appendChild(spot);

    // Numbered feature badge (circle + label pill).
    badge = el("div", {
      position: "absolute",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "8px 16px 8px 8px",
      background: ACCENT,
      color: "#fff",
      borderRadius: "999px",
      boxShadow: "0 10px 30px rgba(4,20,60,0.45)",
      opacity: "0",
      transformOrigin: "left center",
      whiteSpace: "nowrap",
    });
    badgeNum = el("div", {
      width: "30px",
      height: "30px",
      borderRadius: "999px",
      background: "rgba(255,255,255,0.18)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: "700",
      fontSize: "15px",
      lineHeight: "1",
    });
    badgeLabel = el("div", {
      fontSize: "17px",
      fontWeight: "600",
      letterSpacing: "0.2px",
    });
    badge.appendChild(badgeNum);
    badge.appendChild(badgeLabel);
    root.appendChild(badge);

    // Bottom caption bar.
    caption = el("div", {
      position: "absolute",
      left: "50%",
      bottom: "34px",
      transform: "translateX(-50%)",
      maxWidth: "76%",
      textAlign: "center",
      background: "rgba(10,13,20,0.92)",
      border: "1px solid rgba(255,255,255,0.14)",
      backdropFilter: "blur(2px)",
      padding: "15px 28px",
      borderRadius: "14px",
      boxShadow: "0 12px 40px rgba(0,0,0,0.42)",
      opacity: "0",
    });
    capTitle = el("div", {
      fontSize: "24px",
      fontWeight: "700",
      letterSpacing: "0.2px",
    });
    capSub = el("div", {
      fontSize: "17px",
      fontWeight: "400",
      marginTop: "5px",
      color: "rgba(255,255,255,0.92)",
    });
    caption.appendChild(capTitle);
    caption.appendChild(capSub);
    root.appendChild(caption);

    // Scene progress dots (top center).
    progress = el("div", {
      position: "absolute",
      top: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      display: "flex",
      gap: "7px",
      opacity: "0",
    });
    root.appendChild(progress);

    // Wordmark (bottom-left) on a subtle dark pill so it stays legible over
    // both dark-dimmed content and a brightly-lit spotlight (e.g. the nav).
    brand = el("div", {
      position: "absolute",
      left: "22px",
      bottom: "22px",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "7px 14px 7px 8px",
      background: "rgba(10,12,16,0.42)",
      borderRadius: "999px",
      opacity: "0",
    });
    const dot = el("div", {
      width: "22px",
      height: "22px",
      borderRadius: "6px",
      background: "linear-gradient(135deg,#0b6cff,#3aa0ff)",
      boxShadow: "0 4px 12px rgba(11,108,255,0.5)",
    });
    const wm = el("div", {
      fontSize: "15px",
      fontWeight: "700",
      color: "#fff",
      textShadow: "0 1px 6px rgba(0,0,0,0.6)",
    });
    wm.textContent = "Easy Markdown Review";
    brand.appendChild(dot);
    brand.appendChild(wm);
    root.appendChild(brand);

    // Centered intro/outro card.
    card = el("div", {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%,-50%)",
      textAlign: "center",
      opacity: "0",
      maxWidth: "80%",
    });
    cardTitle = el("div", {
      fontSize: "40px",
      fontWeight: "800",
      letterSpacing: "-0.5px",
      textShadow: "0 4px 24px rgba(0,0,0,0.55)",
    });
    cardSub = el("div", {
      fontSize: "20px",
      fontWeight: "500",
      marginTop: "12px",
      color: "rgba(255,255,255,0.9)",
      textShadow: "0 2px 14px rgba(0,0,0,0.5)",
    });
    card.appendChild(cardTitle);
    card.appendChild(cardSub);
    root.appendChild(card);
  }

  function clamp01(n) {
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  // Render exactly one frame from an explicit state object (computed in Node).
  function render(s) {
    setup();
    const dim = clamp01(s.dim ?? 0);

    if (s.spot) {
      const r = s.spot;
      spot.style.opacity = "1";
      spot.style.left = r.x + "px";
      spot.style.top = r.y + "px";
      spot.style.width = r.w + "px";
      spot.style.height = r.h + "px";
      spot.style.borderRadius = (r.radius ?? 12) + "px";
      spot.style.boxShadow = "0 0 0 100vmax rgba(10,12,16," + dim + ")";
      const ring = clamp01(s.ringOpacity ?? 1);
      spot.style.outline = "2.5px solid rgba(11,108,255," + ring + ")";
      scrim.style.opacity = "0";
    } else {
      // No focus target: dim the whole viewport with a solid rgba scrim (a
      // box-shadow "hole" trick under-dims when the hole is off-screen, so use
      // a plain full-bleed layer here — matches the feature-scene darkness).
      spot.style.opacity = "0";
      spot.style.boxShadow = "none";
      scrim.style.background = "rgba(10,12,16," + dim + ")";
      scrim.style.opacity = "1";
    }

    if (s.badge) {
      const a = clamp01(s.badge.appear);
      badge.style.opacity = String(a);
      badgeNum.textContent = String(s.badge.num);
      badgeLabel.textContent = s.badge.label;
      // Position first (top-left anchor), then clamp inside the viewport.
      badge.style.left = s.badge.x + "px";
      badge.style.top = s.badge.y + "px";
      badge.style.transform = "none";
      const bw = badge.getBoundingClientRect().width;
      const bh = badge.getBoundingClientRect().height;
      let bx = s.badge.x;
      let by = s.badge.y;
      if (bx + bw > window.innerWidth - 12) bx = window.innerWidth - 12 - bw;
      if (bx < 12) bx = 12;
      if (by + bh > window.innerHeight - 12) by = window.innerHeight - 12 - bh;
      if (by < 12) by = 12;
      badge.style.left = bx + "px";
      badge.style.top = by + "px";
      const slide = (1 - a) * -12;
      badge.style.transform =
        "translateX(" + slide + "px) scale(" + (0.9 + a * 0.1) + ")";
    } else {
      badge.style.opacity = "0";
    }

    if (s.caption) {
      const a = clamp01(s.caption.appear);
      caption.style.opacity = String(a);
      caption.style.transform =
        "translateX(-50%) translateY(" + (1 - a) * 14 + "px)";
      capTitle.textContent = s.caption.title || "";
      capSub.textContent = s.caption.sub || "";
      capSub.style.display = s.caption.sub ? "block" : "none";
    } else {
      caption.style.opacity = "0";
    }

    if (s.progress) {
      progress.style.opacity = String(clamp01(s.progress.appear ?? 1));
      const total = s.progress.total || 0;
      while (progress.children.length < total) {
        el(
          "div",
          {
            width: "8px",
            height: "8px",
            borderRadius: "999px",
            background: "rgba(255,255,255,0.35)",
            transition: "none",
          },
          progress,
        );
      }
      for (let i = 0; i < progress.children.length; i++) {
        const on = i === s.progress.index;
        const d = progress.children[i];
        d.style.background = on ? "#fff" : "rgba(255,255,255,0.32)";
        d.style.width = on ? "22px" : "8px";
      }
    } else {
      progress.style.opacity = "0";
    }

    brand.style.opacity = String(clamp01(s.brandAppear ?? 0));

    if (s.card) {
      const a = clamp01(s.card.appear);
      card.style.opacity = String(a);
      card.style.transform =
        "translate(-50%,-50%) translateY(" +
        (1 - a) * 16 +
        "px) scale(" +
        (0.98 + a * 0.02) +
        ")";
      cardTitle.textContent = s.card.title || "";
      cardSub.textContent = s.card.sub || "";
      cardSub.style.display = s.card.sub ? "block" : "none";
    } else {
      card.style.opacity = "0";
    }
  }

  // Measure a target rect (union when the selector matches many elements),
  // clamped to the viewport with padding, in CSS pixels.
  function measure(selector, opts) {
    opts = opts || {};
    const pad = opts.pad ?? 10;
    const nodes = Array.from(document.querySelectorAll(selector));
    if (!nodes.length) return null;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    const cap = opts.max ?? nodes.length;
    nodes.slice(0, cap).forEach((n) => {
      const r = n.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      x0 = Math.min(x0, r.left);
      y0 = Math.min(y0, r.top);
      x1 = Math.max(x1, r.right);
      y1 = Math.max(y1, r.bottom);
    });
    if (!isFinite(x0)) return null;
    x0 -= pad;
    y0 -= pad;
    x1 += pad;
    y1 += pad;
    const vw = window.innerWidth,
      vh = window.innerHeight;
    x0 = Math.max(2, x0);
    y0 = Math.max(2, y0);
    x1 = Math.min(vw - 2, x1);
    y1 = Math.min(vh - 2, y1);
    if (opts.maxHeight && y1 - y0 > opts.maxHeight) y1 = y0 + opts.maxHeight;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  window.__tour = { setup, render, measure };
})();
