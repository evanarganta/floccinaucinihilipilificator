const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

const uploadView = $("#upload-view");
const editorView = $("#editor-view");
const resultView = $("#result-view");
const fileInput = $("#file-input");
const dropZone = $("#drop-zone");
const uploadError = $("#upload-error");
const heroHeader = $(".hero");
const footerElem = $("footer");

const preview = $("#preview");
const fileName = $("#file-name");
const originalInfo = $("#original-info");

const tabTarget = $("#tab-target");
const tabManual = $("#tab-manual");
const targetModeControls = $("#target-mode-controls");
const manualModeControls = $("#manual-mode-controls");

const presets = $("#presets");
const customTargetWrap = $("#custom-target-wrap");
const customTarget = $("#custom-target");
const customUnit = $("#custom-unit");

const qualityRange = $("#quality-range");
const qualityValue = $("#quality-value");
const scaleRange = $("#scale-range");
const scaleValue = $("#scale-value");
const scalePresetBtns = $$(".scale-preset-btn");

const quickResBtns = $$(".res-btn");
const maxWidthInput = $("#max-width");
const maxHeightInput = $("#max-height");
const lockAspectBtn = $("#lock-aspect");

const formatSelect = $("#format");
const bgColorSelect = $("#bg-color-select");
const bgColorCustom = $("#bg-color-custom");

const compressButton = $("#compress-button");
const compressBtnText = $("#compress-btn-text");
const statusText = $("#status");

const batchCounter = $("#batch-counter");
const batchCountText = $("#batch-count-text");
const batchListContainer = $("#batch-list-container");
const batchThumbnails = $("#batch-thumbnails");
const queueLengthText = $("#queue-length");
const clearQueueBtn = $("#clear-queue");

const reduction = $("#reduction");
const resultSummary = $("#result-summary");
const originalResultSize = $("#original-result-size");
const originalResultDimensions = $("#original-result-dimensions");
const compressedResultSize = $("#compressed-result-size");
const compressedResultDimensions = $("#compressed-result-dimensions");
const resultPreview = $("#result-preview");
const originalPreviewSplit = $("#original-preview-split");
const downloadButton = $("#download-button");
const downloadBtnText = $("#download-btn-text");
const copyButton = $("#copy-button");
const adjustButton = $("#adjust-button");

const splitSliderContainer = $("#split-slider-container");
const originalLayer = $("#original-layer");
const splitHandle = $("#split-handle");
const zoomBtns = $$(".zoom-btn");

const batchResultsWrap = $("#batch-results-wrap");
const batchResultsList = $("#batch-results-list");
const batchCompletedCount = $("#batch-completed-count");
const downloadZipButton = $("#download-zip-button");

let filesQueue = [];
let currentIndex = 0;
let currentSourceImage = null;
let currentSourceUrl = null;
let currentResultUrl = null;

let activeMode = "target";
let selectedTargetBytes = 512000;
let isAspectLocked = true;
let sourceAspectRatio = 1;
let batchResults = [];

document.documentElement.setAttribute("data-theme", "dark");

function updateOuterVisibility(isEditingOrResult) {
  if (heroHeader) heroHeader.hidden = isEditingOrResult;
  if (footerElem) footerElem.hidden = isEditingOrResult;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 102400 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function extensionFor(type) {
  return ({
    "image/webp": "webp",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/avif": "avif"
  })[type] || "webp";
}

function getTargetBytes() {
  if (selectedTargetBytes !== "custom") return Number(selectedTargetBytes);
  const value = Number(customTarget.value);
  const multiplier = Number(customUnit.value);
  return Math.max(1, value || 1) * multiplier;
}

function supportsType(type) {
  const canvas = document.createElement("canvas");
  return canvas.toDataURL(type).startsWith(`data:${type}`);
}

function hasTransparency(image) {
  const sampleWidth = Math.min(image.naturalWidth || image.width, 200);
  const sampleHeight = Math.min(image.naturalHeight || image.height, 200);
  if (!sampleWidth || !sampleHeight) return false;

  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, sampleWidth, sampleHeight);

  const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) return true;
  }
  return false;
}

function chooseFormat(image) {
  if (formatSelect.value !== "auto") return formatSelect.value;
  if (hasTransparency(image)) {
    return supportsType("image/webp") ? "image/webp" : "image/png";
  }
  return supportsType("image/webp") ? "image/webp" : "image/jpeg";
}

function getBackgroundColor() {
  if (bgColorSelect.value === "transparent") return null;
  if (bgColorSelect.value === "custom") return bgColorCustom.value;
  return bgColorSelect.value;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Browser image encoding failed."));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

function createCanvas(image, width, height, type) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));

  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const fillColor = getBackgroundColor();
  if (type === "image/jpeg" || fillColor) {
    context.fillStyle = fillColor || "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function encodeAtDimensions(image, width, height, type, targetBytes) {
  const canvas = createCanvas(image, width, height, type);

  if (type === "image/png") {
    const blob = await canvasToBlob(canvas, type);
    return { blob, width, height, quality: null };
  }

  const highBlob = await canvasToBlob(canvas, type, 0.98);
  if (highBlob.size <= targetBytes) {
    return { blob: highBlob, width, height, quality: 0.98 };
  }

  let low = 0.05;
  let high = 0.98;
  let best = null;

  for (let i = 0; i < 9; i++) {
    const quality = (low + high) / 2;
    const blob = await canvasToBlob(canvas, type, quality);

    if (blob.size <= targetBytes) {
      best = { blob, quality };
      low = quality;
    } else {
      high = quality;
    }
  }

  if (best) return { ...best, width, height };

  const minBlob = await canvasToBlob(canvas, type, 0.05);
  return { blob: minBlob, width, height, quality: 0.05 };
}

async function optimizeTargetMode(image) {
  const targetBytes = getTargetBytes();
  const type = chooseFormat(image);

  const origW = image.naturalWidth;
  const origH = image.naturalHeight;

  let reqW = Number(maxWidthInput.value) || origW;
  let reqH = Number(maxHeightInput.value) || Math.round(origH * (reqW / origW));

  let width = Math.min(origW, reqW);
  let height = Math.min(origH, reqH);

  let bestResult = null;

  for (let attempt = 0; attempt < 10; attempt++) {
    statusText.textContent = `Optimizing pass ${attempt + 1}…`;
    const result = await encodeAtDimensions(image, width, height, type, targetBytes);
    bestResult = result;

    if (result.blob.size <= targetBytes) return { ...result, type };

    width = Math.max(1, Math.round(width * 0.85));
    height = Math.max(1, Math.round(height * 0.85));

    if (width < 32 || height < 32) break;
  }

  return { ...bestResult, type };
}

async function optimizeManualMode(image) {
  const type = chooseFormat(image);
  const quality = Number(qualityRange.value) / 100;
  const scale = Number(scaleRange.value) / 100;

  const origW = image.naturalWidth;
  const origH = image.naturalHeight;

  let width = Math.round(origW * scale);
  let height = Math.round(origH * scale);

  if (maxWidthInput.value && Number(maxWidthInput.value) < width) {
    width = Number(maxWidthInput.value);
    if (isAspectLocked) height = Math.round(width / sourceAspectRatio);
  }
  if (maxHeightInput.value && Number(maxHeightInput.value) < height) {
    height = Number(maxHeightInput.value);
    if (isAspectLocked) width = Math.round(height * sourceAspectRatio);
  }

  const canvas = createCanvas(image, width, height, type);
  const blob = await canvasToBlob(canvas, type, type === "image/png" ? undefined : quality);

  return { blob, width, height, quality: type === "image/png" ? null : quality, type };
}

tabTarget.addEventListener("click", () => switchMode("target"));
tabManual.addEventListener("click", () => switchMode("manual"));

function switchMode(mode) {
  activeMode = mode;
  if (mode === "target") {
    tabTarget.classList.add("active");
    tabTarget.setAttribute("aria-selected", "true");
    tabManual.classList.remove("active");
    tabManual.setAttribute("aria-selected", "false");
    targetModeControls.hidden = false;
    manualModeControls.hidden = true;
  } else {
    tabManual.classList.add("active");
    tabManual.setAttribute("aria-selected", "true");
    tabTarget.classList.remove("active");
    tabTarget.setAttribute("aria-selected", "false");
    targetModeControls.hidden = true;
    manualModeControls.hidden = false;
  }
}

qualityRange.addEventListener("input", () => {
  qualityValue.textContent = `${qualityRange.value}%`;
});

scaleRange.addEventListener("input", () => {
  scaleValue.textContent = `${scaleRange.value}%`;
  updateScalePresetButtons(Number(scaleRange.value));
});

scalePresetBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const scale = Number(btn.dataset.scale);
    scaleRange.value = scale;
    scaleValue.textContent = `${scale}%`;
    updateScalePresetButtons(scale);
  });
});

function updateScalePresetButtons(currentScale) {
  scalePresetBtns.forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.scale) === currentScale);
  });
}

presets.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-bytes]");
  if (!button) return;

  [...presets.querySelectorAll("button")].forEach((item) => item.classList.remove("active"));
  button.classList.add("active");

  selectedTargetBytes = button.dataset.bytes === "custom" ? "custom" : Number(button.dataset.bytes);
  customTargetWrap.hidden = selectedTargetBytes !== "custom";
});

lockAspectBtn.addEventListener("click", () => {
  isAspectLocked = !isAspectLocked;
  lockAspectBtn.classList.toggle("active", isAspectLocked);
});

maxWidthInput.addEventListener("input", () => {
  if (isAspectLocked && currentSourceImage && maxWidthInput.value) {
    const w = Number(maxWidthInput.value);
    maxHeightInput.value = Math.round(w / sourceAspectRatio);
  }
});

maxHeightInput.addEventListener("input", () => {
  if (isAspectLocked && currentSourceImage && maxHeightInput.value) {
    const h = Number(maxHeightInput.value);
    maxWidthInput.value = Math.round(h * sourceAspectRatio);
  }
});

quickResBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    quickResBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    const res = btn.dataset.res;
    if (res === "original" || !currentSourceImage) {
      maxWidthInput.value = "";
      maxHeightInput.value = "";
    } else {
      const targetW = Number(res);
      maxWidthInput.value = targetW;
      if (isAspectLocked) {
        maxHeightInput.value = Math.round(targetW / sourceAspectRatio);
      }
    }
  });
});

bgColorSelect.addEventListener("change", () => {
  bgColorCustom.hidden = bgColorSelect.value !== "custom";
});

function handleFileSelection(files) {
  uploadError.textContent = "";
  const validFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));

  if (validFiles.length === 0) {
    uploadError.textContent = "Please select valid image files (PNG, JPEG, WebP, GIF, BMP, AVIF).";
    return;
  }

  filesQueue = validFiles;
  currentIndex = 0;
  batchResults = [];

  renderBatchDrawer();
  loadCurrentFile();
}

function renderBatchDrawer() {
  if (filesQueue.length <= 1) {
    batchCounter.hidden = true;
    batchListContainer.hidden = true;
    compressBtnText.textContent = "Shrink Image";
    return;
  }

  batchCounter.hidden = false;
  batchCountText.textContent = `${filesQueue.length} images loaded`;
  queueLengthText.textContent = filesQueue.length;
  batchListContainer.hidden = false;
  batchThumbnails.innerHTML = "";
  compressBtnText.textContent = `Shrink All (${filesQueue.length} Images)`;

  filesQueue.forEach((file, index) => {
    const thumbDiv = document.createElement("div");
    thumbDiv.className = `batch-thumb-item ${index === currentIndex ? "active" : ""}`;

    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    thumbDiv.appendChild(img);

    const removeBtn = document.createElement("button");
    removeBtn.className = "batch-thumb-remove";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeFileFromQueue(index);
    });

    thumbDiv.appendChild(removeBtn);

    thumbDiv.addEventListener("click", () => {
      currentIndex = index;
      renderBatchDrawer();
      loadCurrentFile();
    });

    batchThumbnails.appendChild(thumbDiv);
  });
}

function removeFileFromQueue(index) {
  filesQueue.splice(index, 1);
  if (filesQueue.length === 0) {
    resetApp();
    return;
  }
  if (currentIndex >= filesQueue.length) {
    currentIndex = filesQueue.length - 1;
  }
  renderBatchDrawer();
  loadCurrentFile();
}

clearQueueBtn.addEventListener("click", () => resetApp());

function loadCurrentFile() {
  if (filesQueue.length === 0) return;

  const file = filesQueue[currentIndex];
  if (currentSourceUrl) URL.revokeObjectURL(currentSourceUrl);

  currentSourceUrl = URL.createObjectURL(file);
  const img = new Image();

  img.onload = () => {
    currentSourceImage = img;
    sourceAspectRatio = img.naturalWidth / img.naturalHeight;
    preview.src = currentSourceUrl;
    originalPreviewSplit.src = currentSourceUrl;

    fileName.textContent = file.name;
    originalInfo.textContent = `${img.naturalWidth} × ${img.naturalHeight} · ${formatBytes(file.size)}`;

    showEditor();
  };

  img.onerror = () => {
    uploadError.textContent = "Error reading image file.";
  };

  img.src = currentSourceUrl;
}

async function runCompression() {
  if (filesQueue.length === 0 || !currentSourceImage) return;

  compressButton.disabled = true;
  statusText.textContent = "Processing image(s)…";

  try {
    if (filesQueue.length === 1) {
      const result = activeMode === "target"
        ? await optimizeTargetMode(currentSourceImage)
        : await optimizeManualMode(currentSourceImage);

      displaySingleResult(result, filesQueue[0]);
    } else {
      batchResults = [];
      for (let i = 0; i < filesQueue.length; i++) {
        statusText.textContent = `Compressing ${i + 1} of ${filesQueue.length}…`;
        const file = filesQueue[i];

        const img = await loadImageFromFile(file);
        const result = activeMode === "target"
          ? await optimizeTargetMode(img)
          : await optimizeManualMode(img);

        batchResults.push({
          file,
          blob: result.blob,
          width: result.width,
          height: result.height,
          type: result.type
        });
      }

      displayBatchResults();
    }
  } catch (err) {
    console.error(err);
    statusText.textContent = err.message || "An error occurred during compression.";
  } finally {
    compressButton.disabled = false;
  }
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function displaySingleResult(result, file) {
  if (currentResultUrl) URL.revokeObjectURL(currentResultUrl);
  currentResultUrl = URL.createObjectURL(result.blob);

  resultPreview.src = currentResultUrl;
  downloadButton.href = currentResultUrl;

  const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
  downloadButton.download = `${baseName}-compressed.${extensionFor(result.type)}`;

  const savedPercent = Math.max(0, (1 - result.blob.size / file.size) * 100);
  reduction.textContent = `${savedPercent.toFixed(1)}% smaller`;
  resultSummary.textContent = `Compressed from ${formatBytes(file.size)} down to ${formatBytes(result.blob.size)}.`;

  originalResultSize.textContent = formatBytes(file.size);
  originalResultDimensions.textContent = `${currentSourceImage.naturalWidth} × ${currentSourceImage.naturalHeight}`;

  compressedResultSize.textContent = formatBytes(result.blob.size);
  compressedResultDimensions.textContent = `${result.width} × ${result.height} · ${result.type.replace("image/", "").toUpperCase()}`;

  batchResultsWrap.hidden = true;
  downloadButton.hidden = false;
  copyButton.hidden = false;

  updateOuterVisibility(true);
  editorView.hidden = true;
  resultView.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function displayBatchResults() {
  const totalOriginalSize = batchResults.reduce((acc, curr) => acc + curr.file.size, 0);
  const totalCompressedSize = batchResults.reduce((acc, curr) => acc + curr.blob.size, 0);
  const savedPercent = Math.max(0, (1 - totalCompressedSize / totalOriginalSize) * 100);

  reduction.textContent = `${savedPercent.toFixed(1)}% smaller overall`;
  resultSummary.textContent = `Processed ${batchResults.length} images. Saved total of ${formatBytes(totalOriginalSize - totalCompressedSize)}.`;

  originalResultSize.textContent = formatBytes(totalOriginalSize);
  originalResultDimensions.textContent = `${batchResults.length} items`;

  compressedResultSize.textContent = formatBytes(totalCompressedSize);
  compressedResultDimensions.textContent = `${batchResults.length} items`;

  batchResultsList.innerHTML = "";
  batchResults.forEach((item) => {
    const itemUrl = URL.createObjectURL(item.blob);
    const row = document.createElement("div");
    row.className = "batch-res-item";

    const baseName = item.file.name.replace(/\.[^.]+$/, "");
    const dlName = `${baseName}-compressed.${extensionFor(item.type)}`;

    row.innerHTML = `
      <span class="batch-res-name">${item.file.name}</span>
      <span class="batch-res-size">${formatBytes(item.file.size)} → <strong>${formatBytes(item.blob.size)}</strong></span>
      <a class="batch-res-dl" href="${itemUrl}" download="${dlName}">Download</a>
    `;

    batchResultsList.appendChild(row);
  });

  batchCompletedCount.textContent = batchResults.length;
  batchResultsWrap.hidden = false;
  downloadButton.hidden = true;
  copyButton.hidden = true;

  updateOuterVisibility(true);
  editorView.hidden = true;
  resultView.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

downloadZipButton.addEventListener("click", async () => {
  if (typeof JSZip === "undefined") {
    alert("ZIP library is loading, please try again in a moment.");
    return;
  }

  const zip = new JSZip();
  batchResults.forEach((item) => {
    const baseName = item.file.name.replace(/\.[^.]+$/, "");
    const fileName = `${baseName}-compressed.${extensionFor(item.type)}`;
    zip.file(fileName, item.blob);
  });

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const zipUrl = URL.createObjectURL(zipBlob);

  const link = document.createElement("a");
  link.href = zipUrl;
  link.download = "compressed-images.zip";
  link.click();
});

copyButton.addEventListener("click", async () => {
  if (!currentResultUrl) return;

  try {
    const response = await fetch(currentResultUrl);
    const blob = await response.blob();

    if (blob.type === "image/png") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } else {
      const img = new Image();
      img.src = currentResultUrl;
      await new Promise((res) => (img.onload = res));

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);

      canvas.toBlob(async (pngBlob) => {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      }, "image/png");
    }

    const origText = copyButton.querySelector("span").textContent;
    copyButton.querySelector("span").textContent = "Copied! ✓";
    setTimeout(() => {
      copyButton.querySelector("span").textContent = origText;
    }, 2000);
  } catch (err) {
    console.error(err);
    alert("Could not copy image to clipboard automatically. You can right-click the image to copy.");
  }
});

let isDraggingSplit = false;

function updateSplitPosition(clientX) {
  const rect = splitSliderContainer.getBoundingClientRect();
  let percentage = ((clientX - rect.left) / rect.width) * 100;
  percentage = Math.max(0, Math.min(100, percentage));

  originalLayer.style.width = `${percentage}%`;
  splitHandle.style.left = `${percentage}%`;
}

splitSliderContainer.addEventListener("mousedown", (e) => {
  isDraggingSplit = true;
  updateSplitPosition(e.clientX);
});

window.addEventListener("mousemove", (e) => {
  if (!isDraggingSplit) return;
  updateSplitPosition(e.clientX);
});

window.addEventListener("mouseup", () => {
  isDraggingSplit = false;
});

splitSliderContainer.addEventListener("touchstart", (e) => {
  isDraggingSplit = true;
  updateSplitPosition(e.touches[0].clientX);
});

window.addEventListener("touchmove", (e) => {
  if (!isDraggingSplit) return;
  updateSplitPosition(e.touches[0].clientX);
});

window.addEventListener("touchend", () => {
  isDraggingSplit = false;
});

zoomBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    zoomBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    const mode = btn.dataset.zoom;
    const imgs = [resultPreview, originalPreviewSplit];

    imgs.forEach((img) => {
      if (mode === "fit") {
        img.style.transform = "none";
        img.style.maxHeight = "400px";
      } else if (mode === "100") {
        img.style.transform = "scale(1.2)";
        img.style.maxHeight = "none";
      } else if (mode === "200") {
        img.style.transform = "scale(1.8)";
        img.style.maxHeight = "none";
      }
    });
  });
});

function showEditor() {
  updateOuterVisibility(true);
  uploadView.hidden = true;
  resultView.hidden = true;
  editorView.hidden = false;
}

function resetApp() {
  if (currentSourceUrl) URL.revokeObjectURL(currentSourceUrl);
  if (currentResultUrl) URL.revokeObjectURL(currentResultUrl);

  filesQueue = [];
  currentIndex = 0;
  currentSourceImage = null;
  currentSourceUrl = null;
  currentResultUrl = null;
  batchResults = [];

  fileInput.value = "";
  preview.removeAttribute("src");
  resultPreview.removeAttribute("src");
  originalPreviewSplit.removeAttribute("src");

  uploadError.textContent = "";
  statusText.textContent = "";
  maxWidthInput.value = "";
  maxHeightInput.value = "";

  updateOuterVisibility(false);
  editorView.hidden = true;
  resultView.hidden = true;
  uploadView.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

fileInput.addEventListener("change", () => handleFileSelection(fileInput.files));

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragging");
  });
});

dropZone.addEventListener("drop", (e) => {
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleFileSelection(e.dataTransfer.files);
  }
});

window.addEventListener("paste", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  const items = Array.from(e.clipboardData.items);
  const imageItems = items.filter((item) => item.type.startsWith("image/"));

  if (imageItems.length > 0) {
    const files = imageItems.map((item) => item.getAsFile());
    handleFileSelection(files);
  }
});

compressButton.addEventListener("click", runCompression);
$("#new-image").addEventListener("click", resetApp);
$("#result-new-image").addEventListener("click", resetApp);
adjustButton.addEventListener("click", () => {
  updateOuterVisibility(true);
  resultView.hidden = true;
  editorView.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
});

window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !editorView.hidden) {
    runCompression();
  }
});

window.addEventListener("beforeunload", () => {
  if (currentSourceUrl) URL.revokeObjectURL(currentSourceUrl);
  if (currentResultUrl) URL.revokeObjectURL(currentResultUrl);
});
