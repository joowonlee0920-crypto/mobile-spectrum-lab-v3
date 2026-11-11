"use strict";

const DEFAULT_ROI_WIDTH = 265;
const DEFAULT_ROI_HEIGHT = 700;
const MINIMUM_ROI_SIZE = 10;
const ROI_STORAGE_KEY = "msl-v2-roi-size-265x700";

export function createRoiController({
  canvas, widthInput, heightInput, lockButton, confirmButton,
  messageElement, xValue, yValue, widthValue, heightValue, sizeSummary
}) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("roi.js: Canvas 컨텍스트를 생성하지 못했습니다.");

  let imageElement = null;
  let displayScale = 1;
  let sizeLocked = false;
  let sessionSizeForced = false;
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let nudgeStep = 5;
  let roi = { x: 0, y: 0, width: DEFAULT_ROI_WIDTH, height: DEFAULT_ROI_HEIGHT };

  const assist = ensureAssistUi();
  loadSavedRoiSize();
  bindEvents();
  updateInformation();

  function bindEvents() {
    canvas.addEventListener("pointerdown", handlePointerDownCapture, true);
    window.addEventListener("pointermove", handlePointerMoveCapture, true);
    window.addEventListener("pointerup", handlePointerUpCapture, true);
    window.addEventListener("pointercancel", handlePointerUpCapture, true);
    canvas.addEventListener("keydown", handleKeydownCapture, true);
    document.addEventListener("click", handleNudgeCapture, true);

    canvas.addEventListener("pointerdown", startDrag);
    window.addEventListener("pointermove", moveDrag, { passive: false });
    window.addEventListener("pointerup", endDrag, { passive: false });
    window.addEventListener("pointercancel", endDrag, { passive: false });
    canvas.addEventListener("keydown", handleKeyboardMove);

    widthInput.addEventListener("input", applyInputSizeLive);
    heightInput.addEventListener("input", applyInputSizeLive);

    document.querySelectorAll("[data-roi-nudge]").forEach(button => {
      button.addEventListener("click", () => nudge(button.dataset.roiNudge, nudgeStep));
    });

    assist.stepButtons.forEach(button => {
      button.addEventListener("click", () => {
        nudgeStep = Number(button.dataset.roiAssistStep || 5);
        updateStepButtons();
      });
    });
    updateStepButtons();

    const panel = document.querySelector(".roi-nudge-panel");
    if (panel) {
      new MutationObserver(() => {
        if ((sizeLocked || widthInput.disabled) && panel.classList.contains("hidden")) {
          panel.classList.remove("hidden");
        }
      }).observe(panel, { attributes: true, attributeFilter: ["class"] });
    }
  }

  function ensureAssistUi() {
    const container = canvas.parentElement;
    const panel = document.querySelector(".roi-nudge-panel");
    if (!container || !panel) return { zoomCanvas: null, stepButtons: [] };

    let zoomCanvas = document.getElementById("roiZoomCanvas");
    if (!zoomCanvas) {
      const wrap = document.createElement("div");
      wrap.id = "roiZoomWrap";
      wrap.innerHTML = `
        <div class="roi-zoom-title"><strong>ROI 확대 보기</strong><span>노란 영역에 스펙트럼이 들어오도록 맞추세요.</span></div>
        <canvas id="roiZoomCanvas" width="320" height="220"></canvas>`;
      container.insertAdjacentElement("afterend", wrap);
      zoomCanvas = wrap.querySelector("canvas");
    }

    let selector = panel.querySelector(".roi-step-selector");
    if (!selector) {
      selector = document.createElement("div");
      selector.className = "roi-step-selector";
      selector.innerHTML = `<span>이동 간격</span><div>
        <button type="button" data-roi-assist-step="1">1 px</button>
        <button type="button" data-roi-assist-step="5">5 px</button>
        <button type="button" data-roi-assist-step="10">10 px</button>
      </div>`;
      const grid = panel.querySelector(".roi-nudge-grid");
      panel.insertBefore(selector, grid);
    }

    if (!document.getElementById("roiMobileAssistStyle")) {
      const style = document.createElement("style");
      style.id = "roiMobileAssistStyle";
      style.textContent = `
        #roiZoomWrap{margin-top:12px;padding:12px;border:1px solid #dbe3ee;border-radius:14px;background:#f8fafc}
        .roi-zoom-title{display:flex;justify-content:space-between;gap:10px;margin-bottom:8px;font-size:12px}
        .roi-zoom-title span{color:#64748b}
        #roiZoomCanvas{display:block;width:100%;height:auto;max-height:240px;border:1px solid #cbd5e1;border-radius:10px;background:#0f172a}
        .roi-step-selector{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap}
        .roi-step-selector>span{font-size:12px;font-weight:700;color:#334155}
        .roi-step-selector>div{display:flex;gap:6px}
        .roi-step-selector button{min-width:54px;min-height:36px;padding:7px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font-weight:800}
        .roi-step-selector button.selected{border-color:#2563eb;background:#dbeafe;color:#1d4ed8}
        html.spectrometer-180 #roiCanvas,
        html.spectrometer-180 #roiZoomCanvas{transform:none!important;transform-origin:50% 50%!important}
        @media(max-width:680px){.roi-zoom-title{display:block}.roi-zoom-title span{display:block;margin-top:3px}.roi-nudge-grid button{width:52px!important;height:46px!important;font-size:20px!important}}
      `;
      document.head.appendChild(style);
    }
    return { zoomCanvas, stepButtons: [...selector.querySelectorAll("[data-roi-assist-step]")] };
  }

  function updateStepButtons() {
    assist.stepButtons.forEach(button => {
      button.classList.toggle("selected", Number(button.dataset.roiAssistStep) === nudgeStep);
    });
  }

  function setImage(image) {
    if (!image) throw new Error("ROI에 표시할 이미지가 없습니다.");
    imageElement = image;
    const iw = getImageWidth();
    const ih = getImageHeight();
    if (iw <= 0 || ih <= 0) throw new Error("ROI 이미지 크기를 확인할 수 없습니다.");

    if (widthInput.disabled && heightInput.disabled && !sizeLocked) {
      roi.width = Math.min(Math.max(MINIMUM_ROI_SIZE, Math.round(Number(widthInput.value))), iw);
      roi.height = Math.min(Math.max(MINIMUM_ROI_SIZE, Math.round(Number(heightInput.value))), ih);
      roi.x = Math.round((iw - roi.width) / 2);
      roi.y = Math.round((ih - roi.height) / 2);
      sizeLocked = true;
      sessionSizeForced = true;
      confirmButton.disabled = false;
    }

    roi.x = clamp(roi.x, 0, Math.max(0, iw - roi.width));
    roi.y = clamp(roi.y, 0, Math.max(0, ih - roi.height));
    updateInformation();

    requestAnimationFrame(() => {
      document.querySelector(".roi-nudge-panel")?.classList.remove("hidden");
      draw();
    });
  }

  function reset(options = {}) {
    if (!imageElement) throw new Error("ROI를 설정할 이미지가 없습니다.");
    const iw = getImageWidth();
    const ih = getImageHeight();
    const fixed = options.fixedSize || null;

    if (fixed) {
      roi.width = Math.min(Math.max(MINIMUM_ROI_SIZE, Math.round(Number(fixed.width))), iw);
      roi.height = Math.min(Math.max(MINIMUM_ROI_SIZE, Math.round(Number(fixed.height))), ih);
      roi.x = clamp(Math.round(Number(options.initialPosition?.x ?? (iw - roi.width) / 2)), 0, iw - roi.width);
      roi.y = clamp(Math.round(Number(options.initialPosition?.y ?? (ih - roi.height) / 2)), 0, ih - roi.height);
      sizeLocked = true;
      sessionSizeForced = true;
      widthInput.value = roi.width;
      heightInput.value = roi.height;
      widthInput.disabled = true;
      heightInput.disabled = true;
      lockButton.disabled = true;
      confirmButton.disabled = false;
      updateInformation();
      draw();
      return;
    }

    sizeLocked = false;
    sessionSizeForced = false;
    widthInput.disabled = false;
    heightInput.disabled = false;
    lockButton.disabled = false;
    confirmButton.disabled = true;
    roi.width = Math.min(DEFAULT_ROI_WIDTH, iw);
    roi.height = Math.min(DEFAULT_ROI_HEIGHT, ih);
    roi.x = Math.round((iw - roi.width) / 2);
    roi.y = Math.round((ih - roi.height) / 2);
    widthInput.value = roi.width;
    heightInput.value = roi.height;
    updateInformation();
    draw();
    showMessage("첫 Blank에서 스펙트럼 전체가 들어오도록 ROI 크기와 위치를 맞춘 뒤 크기를 고정하세요.");
  }

  function lockSize() {
    if (!imageElement) return showMessage("ROI를 설정할 이미지가 없습니다.", "error");
    if (sizeLocked) return showMessage("ROI 크기는 이미 고정되어 있습니다. 위치는 계속 조정할 수 있습니다.", "success");
    const iw = getImageWidth();
    const ih = getImageHeight();
    const w = Math.round(Number(widthInput.value));
    const h = Math.round(Number(heightInput.value));
    if (!Number.isFinite(w) || w < MINIMUM_ROI_SIZE || !Number.isFinite(h) || h < MINIMUM_ROI_SIZE) {
      return showMessage(`ROI 크기는 ${MINIMUM_ROI_SIZE}px 이상이어야 합니다.`, "error");
    }
    if (w > iw || h > ih) return showMessage("ROI 크기가 원본 이미지보다 큽니다.", "error");
    roi.width = w;
    roi.height = h;
    roi.x = clamp(roi.x, 0, iw - w);
    roi.y = clamp(roi.y, 0, ih - h);
    sizeLocked = true;
    widthInput.disabled = true;
    heightInput.disabled = true;
    lockButton.disabled = true;
    confirmButton.disabled = false;
    saveRoiSize();
    updateInformation();
    draw();
    showMessage("ROI 크기를 고정했습니다. 이후 사진마다 위치는 다시 조정할 수 있습니다.", "success");
  }

  function applyInputSizeLive() {
    if (!imageElement || sizeLocked) return;
    const iw = getImageWidth();
    const ih = getImageHeight();
    const w = Math.round(Number(widthInput.value));
    const h = Math.round(Number(heightInput.value));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < MINIMUM_ROI_SIZE || h < MINIMUM_ROI_SIZE) return;
    const cx = roi.x + roi.width / 2;
    const cy = roi.y + roi.height / 2;
    roi.width = Math.min(w, iw);
    roi.height = Math.min(h, ih);
    roi.x = clamp(Math.round(cx - roi.width / 2), 0, iw - roi.width);
    roi.y = clamp(Math.round(cy - roi.height / 2), 0, ih - roi.height);
    updateInformation();
    draw();
  }

  function draw() {
    if (!imageElement) return;
    const iw = getImageWidth();
    const parentWidth = canvas.parentElement?.clientWidth || 320;
    displayScale = Math.min(1, Math.min(860, Math.max(280, parentWidth - 4)) / iw);
    const dw = Math.max(1, Math.round(iw * displayScale));
    const dh = Math.max(1, Math.round(getImageHeight() * displayScale));
    if (canvas.width !== dw) canvas.width = dw;
    if (canvas.height !== dh) canvas.height = dh;
    context.clearRect(0, 0, dw, dh);
    context.drawImage(imageElement, 0, 0, dw, dh);

    const r = displayRoi();
    context.save();
    context.fillStyle = "rgba(0,0,0,.34)";
    context.fillRect(0, 0, dw, r.y);
    context.fillRect(0, r.y + r.height, dw, dh - r.y - r.height);
    context.fillRect(0, r.y, r.x, r.height);
    context.fillRect(r.x + r.width, r.y, dw - r.x - r.width, r.height);
    context.strokeStyle = "#facc15";
    context.lineWidth = Math.max(2, 3 * displayScale);
    context.setLineDash([8,5]);
    context.strokeRect(r.x, r.y, r.width, r.height);
    context.setLineDash([]);
    context.fillStyle = "rgba(250,204,21,.12)";
    context.fillRect(r.x, r.y, r.width, r.height);
    context.restore();
    drawZoom();
  }

  function drawZoom() {
    const z = assist.zoomCanvas;
    if (!z || !imageElement) return;
    const c = z.getContext("2d");
    if (!c) return;
    const iw = getImageWidth();
    const ih = getImageHeight();
    const px = Math.max(12, Math.round(roi.width * .35));
    const py = Math.max(12, Math.round(roi.height * .18));
    const sx = clamp(roi.x - px, 0, iw - 1);
    const sy = clamp(roi.y - py, 0, ih - 1);
    const ex = clamp(roi.x + roi.width + px, sx + 1, iw);
    const ey = clamp(roi.y + roi.height + py, sy + 1, ih);
    const sw = ex - sx;
    const sh = ey - sy;
    const scale = Math.min(z.width / sw, z.height / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (z.width - dw) / 2;
    const dy = (z.height - dh) / 2;
    c.clearRect(0,0,z.width,z.height);
    c.fillStyle = "#0f172a";
    c.fillRect(0,0,z.width,z.height);
    c.drawImage(imageElement, sx, sy, sw, sh, dx, dy, dw, dh);
    c.save();
    c.strokeStyle = "#facc15";
    c.lineWidth = 3;
    c.setLineDash([8,5]);
    c.strokeRect(dx + (roi.x - sx) * scale, dy + (roi.y - sy) * scale, roi.width * scale, roi.height * scale);
    c.restore();
  }

  function displayRoi() {
    return { x: roi.x * displayScale, y: roi.y * displayScale, width: roi.width * displayScale, height: roi.height * displayScale };
  }

  function mounted180() {
    return document.documentElement.classList.contains("spectrometer-180");
  }

  function bypassLock() {
    return sizeLocked || widthInput.disabled || mounted180();
  }

  function handlePointerDownCapture(event) {
    if (!bypassLock()) return;
    startDrag(event);
    event.stopImmediatePropagation();
  }
  function handlePointerMoveCapture(event) {
    if (!dragging || !bypassLock()) return;
    moveDrag(event);
    event.stopImmediatePropagation();
  }
  function handlePointerUpCapture(event) {
    if (!dragging || !bypassLock()) return;
    endDrag(event);
    event.stopImmediatePropagation();
  }
  function handleKeydownCapture(event) {
    if (!bypassLock() || !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) return;
    handleKeyboardMove(event);
    event.stopImmediatePropagation();
  }
  function handleNudgeCapture(event) {
    const button = event.target.closest?.("[data-roi-nudge]");
    if (!button || !(sizeLocked || widthInput.disabled)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    nudge(button.dataset.roiNudge, nudgeStep);
  }

  function startDrag(event) {
    if (!imageElement) return;
    const point = sourcePoint(event);
    const comfortX = Math.max(0, 44 / Math.max(displayScale,.01) - roi.width) / 2;
    const comfortY = Math.max(0, 44 / Math.max(displayScale,.01) - roi.height) / 2;
    const inside = point.x >= roi.x - comfortX && point.x <= roi.x + roi.width + comfortX && point.y >= roi.y - comfortY && point.y <= roi.y + roi.height + comfortY;

    if (!inside && (sizeLocked || widthInput.disabled)) {
      roi.x = clamp(Math.round(point.x - roi.width / 2), 0, getImageWidth() - roi.width);
      roi.y = clamp(Math.round(point.y - roi.height / 2), 0, getImageHeight() - roi.height);
      updateInformation();
      draw();
    } else if (!inside) {
      return;
    }

    dragging = true;
    dragOffsetX = point.x - roi.x;
    dragOffsetY = point.y - roi.y;
    try { canvas.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  }

  function moveDrag(event) {
    if (!dragging) return;
    const point = sourcePoint(event);
    roi.x = clamp(Math.round(point.x - dragOffsetX), 0, getImageWidth() - roi.width);
    roi.y = clamp(Math.round(point.y - dragOffsetY), 0, getImageHeight() - roi.height);
    updateInformation();
    draw();
    event.preventDefault();
  }

  function endDrag(event) {
    dragging = false;
    try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch {}
  }

  function sourcePoint(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / rect.width) / displayScale;
    const y = (event.clientY - rect.top) * (canvas.height / rect.height) / displayScale;
    return { x, y };
  }

  function nudge(direction, step) {
    if (!imageElement) return;
    let dx = 0, dy = 0;
    if (direction === "left") dx = -step;
    if (direction === "right") dx = step;
    if (direction === "up") dy = -step;
    if (direction === "down") dy = step;
    roi.x = clamp(Math.round(roi.x + dx), 0, getImageWidth() - roi.width);
    roi.y = clamp(Math.round(roi.y + dy), 0, getImageHeight() - roi.height);
    updateInformation();
    draw();
  }

  function handleKeyboardMove(event) {
    const step = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowLeft") nudge("left", step);
    else if (event.key === "ArrowRight") nudge("right", step);
    else if (event.key === "ArrowUp") nudge("up", step);
    else if (event.key === "ArrowDown") nudge("down", step);
    else return;
    event.preventDefault();
  }

  function updateInformation() {
    const current = {
      x: Math.round(roi.x), y: Math.round(roi.y),
      width: Math.round(roi.width), height: Math.round(roi.height)
    };
    xValue.textContent = String(current.x);
    yValue.textContent = String(current.y);
    widthValue.textContent = String(current.width);
    heightValue.textContent = String(current.height);
    sizeSummary.textContent = `${current.width} × ${current.height} px`;
    window.__MSL_CURRENT_ROI = { ...current };
  }

  function saveRoiSize() {
    try { localStorage.setItem(ROI_STORAGE_KEY, JSON.stringify({ width: roi.width, height: roi.height })); } catch {}
  }
  function loadSavedRoiSize() {
    try {
      const saved = JSON.parse(localStorage.getItem(ROI_STORAGE_KEY) || "null");
      if (saved?.width >= MINIMUM_ROI_SIZE) widthInput.value = Math.round(saved.width);
      else widthInput.value = DEFAULT_ROI_WIDTH;
      if (saved?.height >= MINIMUM_ROI_SIZE) heightInput.value = Math.round(saved.height);
      else heightInput.value = DEFAULT_ROI_HEIGHT;
    } catch {
      widthInput.value = DEFAULT_ROI_WIDTH;
      heightInput.value = DEFAULT_ROI_HEIGHT;
    }
  }
  function getRoi() {
    if (!imageElement) throw new Error("ROI 이미지가 설정되지 않았습니다.");
    if (!sizeLocked) throw new Error("ROI 크기를 먼저 고정하세요.");
    return { x: Math.round(roi.x), y: Math.round(roi.y), width: Math.round(roi.width), height: Math.round(roi.height) };
  }
  function getImageWidth() { return imageElement?.naturalWidth || imageElement?.width || 0; }
  function getImageHeight() { return imageElement?.naturalHeight || imageElement?.height || 0; }
  function showMessage(text, type = "") {
    messageElement.className = `status-message${type ? ` ${type}` : ""}`;
    messageElement.textContent = text;
  }

  return {
    setImage, reset, draw, lockSize, getRoi,
    isSizeLocked() { return sizeLocked; },
    isSessionSizeForced() { return sessionSizeForced; },
    getImage() { return imageElement; }
  };
}

function normalize(value, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= MINIMUM_ROI_SIZE ? n : fallback;
}
function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}