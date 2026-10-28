const $ = (id) => document.getElementById(id);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let filesQueue = [], currentIndex = 0, currentSourceImage = null, currentSourceUrl = null, currentResultUrl = null;
let activeMode = "target", selectedTargetBytes = 512000, isAspectLocked = true, sourceAspectRatio = 1, batchResults = [];

const EXT_MAP = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "image/avif": "avif", "image/gif": "gif", "image/bmp": "bmp" };
const extFor = (t) => EXT_MAP[t] || "webp";
const formatLabel = (t, n) => (t.split("/")[1] || n.split(".").pop() || "IMG").toUpperCase();

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1048576 ? `${(bytes / 1024).toFixed(bytes < 102400 ? 1 : 0)} KB` : `${(bytes / 1048576).toFixed(2)} MB`;
}

function showView(view) {
  const isEditing = view !== "upload";
  if ($("hero-header")) $("hero-header").hidden = isEditing;
  document.querySelector(".hero")?.toggleAttribute("hidden", isEditing);
  document.querySelector("footer")?.toggleAttribute("hidden", isEditing);
  $("upload-view").hidden = view !== "upload";
  $("editor-view").hidden = view !== "editor";
  $("result-view").hidden = view !== "result";
  if (view === "result") {
    $("original-layer").style.clipPath = "inset(0 50% 0 0)";
    $("split-handle").style.left = "50%";
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

const offCanvas = document.createElement("canvas");
const offCtx = offCanvas.getContext("2d", { willReadFrequently: true });

function hasTransparency(img) {
  const w = offCanvas.width = Math.min(img.naturalWidth || img.width, 100);
  const h = offCanvas.height = Math.min(img.naturalHeight || img.height, 100);
  if (!w || !h) return false;
  offCtx.clearRect(0, 0, w, h);
  offCtx.drawImage(img, 0, 0, w, h);
  const d = offCtx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

function chooseFormat(img) {
  const fmt = $("format").value;
  if (fmt !== "auto") return fmt;
  const webpSupported = offCanvas.toDataURL("image/webp").startsWith("data:image/webp");
  return hasTransparency(img) ? (webpSupported ? "image/webp" : "image/png") : (webpSupported ? "image/webp" : "image/jpeg");
}

const canvasToBlob = (canvas, type, q) =>
  new Promise((res, rej) => canvas.toBlob((b) => b ? res(b) : rej(new Error("Image encoding failed")), type, q));

function createCanvas(img, w, h, type) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const bg = $("bg-color-select").value === "transparent" ? null :
             $("bg-color-select").value === "custom" ? $("bg-color-custom").value : $("bg-color-select").value;
  if (type === "image/jpeg" || bg) {
    ctx.fillStyle = bg || "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function encodeAtDimensions(img, w, h, type, targetBytes) {
  const canvas = createCanvas(img, w, h, type);
  if (type === "image/png") return { blob: await canvasToBlob(canvas, type), width: canvas.width, height: canvas.height, quality: null };

  const highBlob = await canvasToBlob(canvas, type, 0.98);
  if (highBlob.size <= targetBytes) return { blob: highBlob, width: canvas.width, height: canvas.height, quality: 0.98 };

  let low = 0.05, high = 0.98, best = null;
  // shortcut: 6 binary search steps (~1.5% precision) cut blob encoding passes in half
  for (let i = 0; i < 6; i++) {
    const q = (low + high) / 2;
    const blob = await canvasToBlob(canvas, type, q);
    if (blob.size <= targetBytes) { best = { blob, quality: q }; low = q; }
    else { high = q; }
  }
  return best ? { ...best, width: canvas.width, height: canvas.height } :
    { blob: await canvasToBlob(canvas, type, 0.05), width: canvas.width, height: canvas.height, quality: 0.05 };
}

async function optimizeTargetMode(img) {
  const targetBytes = selectedTargetBytes === "custom"
    ? Math.max(1, Number($("custom-target").value) || 1) * Number($("custom-unit").value)
    : Number(selectedTargetBytes);
  const type = chooseFormat(img);
  const origW = img.naturalWidth, origH = img.naturalHeight;
  let reqW = Number($("max-width").value) || origW;
  let reqH = Number($("max-height").value) || Math.round(origH * (reqW / origW));
  let w = Math.min(origW, reqW), h = Math.min(origH, reqH), best = null;

  for (let pass = 0; pass < 8; pass++) {
    $("compress-btn-text").textContent = `Optimizing pass ${pass + 1}…`;
    const res = await encodeAtDimensions(img, w, h, type, targetBytes);
    best = res;
    if (res.blob.size <= targetBytes) return { ...res, type };
    // shortcut: scale dimension proportionally to excess file size ratio
    const ratio = Math.min(0.85, Math.sqrt(targetBytes / res.blob.size) * 0.95);
    w = Math.max(32, Math.round(w * ratio));
    h = Math.max(32, Math.round(h * ratio));
    if (w <= 32 || h <= 32) break;
  }
  return { ...best, type };
}

async function optimizeManualMode(img) {
  const type = chooseFormat(img);
  const q = Number($("quality-range").value) / 100, scale = Number($("scale-range").value) / 100;
  let w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const maxW = Number($("max-width").value), maxH = Number($("max-height").value);
  if (maxW && maxW < w) { w = maxW; if (isAspectLocked) h = Math.round(w / sourceAspectRatio); }
  if (maxH && maxH < h) { h = maxH; if (isAspectLocked) w = Math.round(h * sourceAspectRatio); }
  const canvas = createCanvas(img, w, h, type);
  const blob = await canvasToBlob(canvas, type, type === "image/png" ? undefined : q);
  return { blob, width: canvas.width, height: canvas.height, quality: type === "image/png" ? null : q, type };
}

function handleFileSelection(files) {
  $("upload-error").textContent = "";
  const valid = [...files].filter((f) => f.type.startsWith("image/"));
  if (!valid.length) return ($("upload-error").textContent = "Please select valid image files.");
  filesQueue = valid;
  currentIndex = 0;
  batchResults = [];
  renderBatchDrawer();
  loadCurrentFile();
}

function renderBatchDrawer() {
  const len = filesQueue.length;
  $("batch-counter").hidden = $("batch-list-container").hidden = len <= 1;
  $("compress-btn-text").textContent = len > 1 ? `Compress All (${len} Images)` : "Compress Image";
  if (len <= 1) return;
  $("batch-count-text").textContent = `${len} images loaded`;
  $("queue-length").textContent = len;
  $("batch-thumbnails").innerHTML = filesQueue.map((f, i) => `
    <div class="batch-thumb-item ${i === currentIndex ? "active" : ""}" data-idx="${i}">
      <img src="${URL.createObjectURL(f)}" alt="">
      <button class="batch-thumb-remove" data-del="${i}" title="Remove">✕</button>
    </div>
  `).join("");
}

$("batch-thumbnails").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    e.stopPropagation();
    filesQueue.splice(Number(del.dataset.del), 1);
    if (!filesQueue.length) return resetApp();
    if (currentIndex >= filesQueue.length) currentIndex = filesQueue.length - 1;
    renderBatchDrawer();
    loadCurrentFile();
    return;
  }
  const item = e.target.closest("[data-idx]");
  if (item) {
    currentIndex = Number(item.dataset.idx);
    renderBatchDrawer();
    loadCurrentFile();
  }
});

$("clear-queue").addEventListener("click", resetApp);

const loadImage = (src) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = rej;
  img.src = src;
});

async function loadCurrentFile() {
  if (!filesQueue.length) return;
  const file = filesQueue[currentIndex];
  if (currentSourceUrl) URL.revokeObjectURL(currentSourceUrl);
  currentSourceUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(currentSourceUrl);
    currentSourceImage = img;
    sourceAspectRatio = img.naturalWidth / img.naturalHeight;
    $("preview").src = $("original-preview-split").src = currentSourceUrl;
    $("file-name").textContent = file.name;
    $("original-info").textContent = `${img.naturalWidth} × ${img.naturalHeight} · ${formatBytes(file.size)}`;
    showView("editor");
  } catch {
    $("upload-error").textContent = "Error reading image file.";
  }
}

async function runCompression() {
  if (!filesQueue.length || !currentSourceImage) return;
  const btn = $("compress-button"), btnText = $("compress-btn-text"), origText = btnText.textContent;
  btn.disabled = true;
  $("status").textContent = "";

  try {
    if (filesQueue.length === 1) {
      const res = activeMode === "target" ? await optimizeTargetMode(currentSourceImage) : await optimizeManualMode(currentSourceImage);
      displaySingleResult(res, filesQueue[0]);
    } else {
      batchResults = [];
      for (let i = 0; i < filesQueue.length; i++) {
        btnText.textContent = `Compressing ${i + 1} of ${filesQueue.length}…`;
        const file = filesQueue[i], img = await loadImage(URL.createObjectURL(file));
        const res = activeMode === "target" ? await optimizeTargetMode(img) : await optimizeManualMode(img);
        batchResults.push({ file, ...res });
      }
      displayBatchResults();
    }
  } catch (err) {
    $("status").textContent = err.message || "An error occurred during compression.";
  } finally {
    btn.disabled = false;
    btnText.textContent = origText;
  }
}

function displaySingleResult(res, file) {
  if (currentResultUrl) URL.revokeObjectURL(currentResultUrl);
  currentResultUrl = URL.createObjectURL(res.blob);
  $("result-preview").src = $("download-button").href = currentResultUrl;
  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  $("download-button").download = `${base}-floccinaucinihilipilificated.${extFor(res.type)}`;

  const saved = Math.max(0, (1 - res.blob.size / file.size) * 100);
  $("reduction").textContent = `${saved.toFixed(1)}% smaller.`;
  $("result-summary").textContent = file.name;
  $("original-result-size").textContent = formatBytes(file.size);
  $("original-result-dimensions").textContent = `${formatLabel(file.type, file.name)}: ${currentSourceImage.naturalWidth} × ${currentSourceImage.naturalHeight}`;
  $("compressed-result-size").textContent = formatBytes(res.blob.size);
  $("compressed-result-dimensions").textContent = `${formatLabel(res.type, file.name)}: ${res.width} × ${res.height}`;

  $("batch-results-wrap").hidden = true;
  $("download-button").hidden = $("copy-button").hidden = false;
  showView("result");
}

function displayBatchResults() {
  const origTot = batchResults.reduce((s, r) => s + r.file.size, 0);
  const compTot = batchResults.reduce((s, r) => s + r.blob.size, 0);
  const saved = Math.max(0, (1 - compTot / origTot) * 100);

  $("reduction").textContent = `${saved.toFixed(1)}% smaller overall`;
  $("result-summary").textContent = `Processed ${batchResults.length} images. Saved ${formatBytes(origTot - compTot)}.`;
  $("original-result-size").textContent = formatBytes(origTot);
  $("original-result-dimensions").textContent = `${batchResults.length} items`;
  $("compressed-result-size").textContent = formatBytes(compTot);
  $("compressed-result-dimensions").textContent = `${batchResults.length} items`;

  $("batch-results-list").innerHTML = batchResults.map((r) => {
    const name = `${r.file.name.replace(/\.[^.]+$/, "")}-floccinaucinihilipilificated.${extFor(r.type)}`;
    return `
      <div class="batch-res-item">
        <span class="batch-res-name">${r.file.name}</span>
        <span class="batch-res-size">${formatBytes(r.file.size)} → <strong>${formatBytes(r.blob.size)}</strong></span>
        <a class="batch-res-dl" href="${URL.createObjectURL(r.blob)}" download="${name}">Download</a>
      </div>`;
  }).join("");

  $("batch-completed-count").textContent = batchResults.length;
  $("batch-results-wrap").hidden = false;
  $("download-button").hidden = $("copy-button").hidden = true;
  showView("result");
}

$("download-zip-button").addEventListener("click", async () => {
  if (typeof JSZip === "undefined") return alert("ZIP library is loading, please try again.");
  const zip = new JSZip();
  batchResults.forEach((r) => {
    zip.file(`${r.file.name.replace(/\.[^.]+$/, "")}-floccinaucinihilipilificated.${extFor(r.type)}`, r.blob);
  });
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "compressed-images.zip";
  a.click();
});

$("copy-button").addEventListener("click", async () => {
  if (!currentResultUrl) return;
  const label = $("copy-button").querySelector("span");
  try {
    const res = await fetch(currentResultUrl);
    let blob = await res.blob();
    if (blob.type !== "image/png") {
      const img = await loadImage(currentResultUrl);
      const c = createCanvas(img, img.naturalWidth, img.naturalHeight, "image/png");
      blob = await canvasToBlob(c, "image/png");
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    const old = label.textContent;
    label.textContent = "Copied! ✓";
    setTimeout(() => (label.textContent = old), 2000);
  } catch {
    alert("Could not copy image to clipboard. Right-click the image to copy.");
  }
});

function resetApp() {
  if (currentSourceUrl) URL.revokeObjectURL(currentSourceUrl);
  if (currentResultUrl) URL.revokeObjectURL(currentResultUrl);
  filesQueue = []; currentIndex = 0; currentSourceImage = currentSourceUrl = currentResultUrl = null; batchResults = [];
  $("file-input").value = $("upload-error").textContent = $("status").textContent = $("max-width").value = $("max-height").value = "";
  $("preview").removeAttribute("src");
  $("result-preview").removeAttribute("src");
  $("original-preview-split").removeAttribute("src");
  showView("upload");
}

// Split slider pointer events
const splitContainer = $("split-slider-container");
let isDragging = false;
function updateSplit(x) {
  const r = splitContainer.getBoundingClientRect();
  const pct = Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100));
  $("original-layer").style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
  $("split-handle").style.left = `${pct}%`;
}
splitContainer.addEventListener("pointerdown", (e) => { isDragging = true; splitContainer.setPointerCapture(e.pointerId); updateSplit(e.clientX); });
splitContainer.addEventListener("pointermove", (e) => isDragging && updateSplit(e.clientX));
const endDrag = (e) => { if (isDragging) { isDragging = false; try { splitContainer.releasePointerCapture(e.pointerId); } catch {} } };
splitContainer.addEventListener("pointerup", endDrag);
splitContainer.addEventListener("pointercancel", endDrag);

// Zoom controls
document.querySelector(".zoom-controls").addEventListener("click", (e) => {
  const btn = e.target.closest(".zoom-btn");
  if (!btn) return;
  $$(".zoom-btn").forEach((b) => b.classList.toggle("active", b === btn));
  const z = btn.dataset.zoom;
  [$("result-preview"), $("original-preview-split")].forEach((img) => {
    img.style.transform = z === "fit" ? "none" : `scale(${z === "100" ? 1.2 : 1.8})`;
    img.style.maxHeight = z === "fit" ? "400px" : "none";
  });
});

// UI Controls & Listeners
$("tab-target").addEventListener("click", () => switchMode("target"));
$("tab-manual").addEventListener("click", () => switchMode("manual"));
function switchMode(mode) {
  activeMode = mode;
  $("tab-target").classList.toggle("active", mode === "target");
  $("tab-target").setAttribute("aria-selected", String(mode === "target"));
  $("tab-manual").classList.toggle("active", mode === "manual");
  $("tab-manual").setAttribute("aria-selected", String(mode === "manual"));
  $("target-mode-controls").hidden = mode !== "target";
  $("manual-mode-controls").hidden = mode !== "manual";
}

$("quality-range").addEventListener("input", (e) => $("quality-value").textContent = `${e.target.value}%`);
$("scale-range").addEventListener("input", (e) => {
  $("scale-value").textContent = `${e.target.value}%`;
  $$(".scale-preset-btn").forEach((b) => b.classList.toggle("active", b.dataset.scale === e.target.value));
});

document.querySelector(".scale-presets").addEventListener("click", (e) => {
  const btn = e.target.closest(".scale-preset-btn");
  if (!btn) return;
  $("scale-range").value = btn.dataset.scale;
  $("scale-value").textContent = `${btn.dataset.scale}%`;
  $$(".scale-preset-btn").forEach((b) => b.classList.toggle("active", b === btn));
});

$("presets").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-bytes]");
  if (!btn) return;
  $$("#presets button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  selectedTargetBytes = btn.dataset.bytes === "custom" ? "custom" : Number(btn.dataset.bytes);
  $("custom-target-wrap").hidden = selectedTargetBytes !== "custom";
});

$("lock-aspect").addEventListener("click", () => {
  isAspectLocked = !isAspectLocked;
  $("lock-aspect").classList.toggle("active", isAspectLocked);
  $("lock-aspect").setAttribute("aria-pressed", String(isAspectLocked));
});

$("max-width").addEventListener("input", () => {
  if (isAspectLocked && currentSourceImage && $("max-width").value) {
    $("max-height").value = Math.round(Number($("max-width").value) / sourceAspectRatio);
  }
});

$("max-height").addEventListener("input", () => {
  if (isAspectLocked && currentSourceImage && $("max-height").value) {
    $("max-width").value = Math.round(Number($("max-height").value) * sourceAspectRatio);
  }
});

document.querySelector(".quick-res-buttons").addEventListener("click", (e) => {
  const btn = e.target.closest(".res-btn");
  if (!btn) return;
  $$(".res-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  if (btn.dataset.res === "original" || !currentSourceImage) {
    $("max-width").value = $("max-height").value = "";
  } else {
    const tw = Number(btn.dataset.res);
    $("max-width").value = tw;
    if (isAspectLocked) $("max-height").value = Math.round(tw / sourceAspectRatio);
  }
});

$("bg-color-select").addEventListener("change", (e) => $("bg-color-custom").hidden = e.target.value !== "custom");
$("compress-button").addEventListener("click", runCompression);
$("new-image").addEventListener("click", resetApp);
$("result-new-image").addEventListener("click", resetApp);
$("adjust-button").addEventListener("click", () => showView("editor"));

// Drag & Drop, File Input, Paste, Keyboard
const drop = $("drop-zone");
$("file-input").addEventListener("change", (e) => handleFileSelection(e.target.files));
["dragenter", "dragover"].forEach((evt) => drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.add("dragging"); }));
["dragleave", "drop"].forEach((evt) => drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.remove("dragging"); }));
drop.addEventListener("drop", (e) => e.dataTransfer.files?.length && handleFileSelection(e.dataTransfer.files));

window.addEventListener("paste", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const items = [...e.clipboardData.items].filter((i) => i.type.startsWith("image/"));
  if (items.length) handleFileSelection(items.map((i) => i.getAsFile()));
});

window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !$("editor-view").hidden) runCompression();
});

window.addEventListener("beforeunload", () => {
  if (currentSourceUrl) URL.revokeObjectURL(currentSourceUrl);
  if (currentResultUrl) URL.revokeObjectURL(currentResultUrl);
});
