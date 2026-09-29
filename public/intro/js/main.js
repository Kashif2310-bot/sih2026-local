(() => {
  "use strict";

  /* ---------- Config ---------- */
  const TOTAL_FRAMES = 192;
  const CONCURRENCY = 8;
  const FRAME_URL = (i) => `assets/frames/frame-${String(i + 1).padStart(3, "0")}.jpg`;

  // Entry points into the Ishara app (served from public/intro/ at "/").
  // Entrepreneur opens the full citizen app (scan, assistant, apply, ...);
  // Admin opens only the admin console, which has its own login and shell.
  const ROUTES = {
    entrepreneur: "/home",
    admin: "/admin/login",
  };

  const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let SMOOTHING = reduceMotionQuery.matches ? 1 : 0.14;
  reduceMotionQuery.addEventListener?.("change", (e) => {
    SMOOTHING = e.matches ? 1 : 0.14;
  });

  /* ---------- DOM ---------- */
  const canvas = document.getElementById("logo-canvas");
  const ctx = canvas.getContext("2d");
  const heroSpacer = document.querySelector(".hero-spacer");
  const loadBar = document.getElementById("load-bar");
  const loadBarFill = document.getElementById("load-bar-fill");
  const scrollHint = document.getElementById("scroll-hint");

  /* ---------- Frame store ---------- */
  const images = new Array(TOTAL_FRAMES).fill(null);
  const loaded = new Array(TOTAL_FRAMES).fill(false);
  let loadedCount = 0;

  function loadFrame(index) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        images[index] = img;
        loaded[index] = true;
        loadedCount++;
        updateLoadProgress();
        resolve();
      };
      img.onerror = () => {
        // Count as settled so preloading can't stall on one bad file.
        loadedCount++;
        updateLoadProgress();
        resolve();
      };
      img.src = FRAME_URL(index);
    });
  }

  function updateLoadProgress() {
    const pct = Math.round((loadedCount / TOTAL_FRAMES) * 100);
    loadBarFill.style.width = pct + "%";
    loadBar.setAttribute("aria-valuenow", String(pct));
    if (loadedCount >= TOTAL_FRAMES) {
      loadBar.classList.add("is-complete");
    }
  }

  async function preloadPool(startIndex) {
    let cursor = startIndex;
    const worker = async () => {
      while (cursor < TOTAL_FRAMES) {
        const i = cursor++;
        if (!loaded[i]) await loadFrame(i);
      }
    };
    const workers = Array.from({ length: CONCURRENCY }, worker);
    await Promise.all(workers);
  }

  function nearestLoadedIndex(target) {
    if (loaded[target]) return target;
    for (let d = 1; d < TOTAL_FRAMES; d++) {
      const down = target - d;
      const up = target + d;
      if (down >= 0 && loaded[down]) return down;
      if (up < TOTAL_FRAMES && loaded[up]) return up;
    }
    return -1;
  }

  /* ---------- Canvas sizing (DPR aware) ---------- */
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cssWidth = 0;
  let cssHeight = 0;

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssWidth = canvas.clientWidth;
    cssHeight = canvas.clientHeight;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFrame(Math.round(currentFrame), true);
  }

  /* ---------- Draw (contain-fit, preserves full composition) ---------- */
  let lastDrawnIndex = -1;

  function drawFrame(targetIndex, force) {
    const idx = loaded[targetIndex] ? targetIndex : nearestLoadedIndex(targetIndex);
    if (idx === -1) return;
    if (!force && idx === lastDrawnIndex) return;
    lastDrawnIndex = idx;

    const img = images[idx];
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const imgRatio = img.width / img.height;
    const canvasRatio = cssWidth / cssHeight;
    let w, h;
    if (canvasRatio > imgRatio) {
      h = cssHeight;
      w = h * imgRatio;
    } else {
      w = cssWidth;
      h = w / imgRatio;
    }
    const x = (cssWidth - w) / 2;
    const y = (cssHeight - h) / 2;
    ctx.drawImage(img, x, y, w, h);
  }

  /* ---------- Scroll -> progress -> target frame ---------- */
  let targetFrame = 0;
  let currentFrame = 0;
  let hintVisible = true;

  function getScrollProgress() {
    const rect = heroSpacer.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    if (total <= 0) return 0;
    const scrolled = -rect.top;
    return Math.min(1, Math.max(0, scrolled / total));
  }

  function onScroll() {
    const progress = getScrollProgress();
    targetFrame = progress * (TOTAL_FRAMES - 1);

    if (hintVisible && progress > 0.015) {
      scrollHint.style.opacity = "0";
      hintVisible = false;
    } else if (!hintVisible && progress <= 0.015) {
      scrollHint.style.opacity = "1";
      hintVisible = true;
    }
  }

  /* ---------- Animation loop ---------- */
  function tick() {
    const delta = targetFrame - currentFrame;
    if (Math.abs(delta) < 0.02) {
      currentFrame = targetFrame;
    } else {
      currentFrame += delta * SMOOTHING;
    }
    drawFrame(Math.round(currentFrame), false);
    requestAnimationFrame(tick);
  }

  /* ---------- Scroll-reveal for content sections ---------- */
  function setupReveal() {
    const targets = document.querySelectorAll(".intro-inner, .connect-card");
    if (!("IntersectionObserver" in window)) {
      targets.forEach((el) => el.classList.add("in-view"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.3 }
    );
    targets.forEach((el) => io.observe(el));
  }

  /* ---------- Wire Entrepreneur / Admin entry cards to configured routes ---------- */
  function wireRoutes() {
    document.querySelectorAll("[data-route]").forEach((el) => {
      const destination = ROUTES[el.dataset.route];
      if (destination) el.setAttribute("href", destination);
    });
  }

  /* ---------- Init ---------- */
  async function init() {
    resizeCanvas();
    await loadFrame(0);
    resizeCanvas();

    window.addEventListener("resize", resizeCanvas, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    requestAnimationFrame(tick);
    setupReveal();
    wireRoutes();

    preloadPool(1);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
