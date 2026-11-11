"use strict";

import {
  loadSession,
  getLatestReference
} from "./session.js";

const WAVELENGTH_MIN_NM = 400;
const WAVELENGTH_MAX_NM = 700;

const MATERIAL_COLORS = {
  PP: "#fd8824",
  PET: "#2f74de",
  PS: "#2bb16f",
  PC: "#9b72c8",
  PA: "#db7eb6"
};

const UNKNOWN_COLOR = "#374151";

let capturedUnknownNumber = null;
let capturedUnknownGrayBt601 = new Map();

function prepareCanvas(canvas, height = 250) {
  if (!canvas) throw new Error("그래프 Canvas가 없습니다.");

  const containerWidth =
    canvas.parentElement?.clientWidth ||
    canvas.clientWidth ||
    320;

  const displayWidth = Math.max(1, Math.floor(containerWidth));
  const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);

  canvas.width = Math.round(displayWidth * devicePixelRatio);
  canvas.height = Math.round(height * devicePixelRatio);
  canvas.style.width = "100%";
  canvas.style.maxWidth = "100%";
  canvas.style.height = `${height}px`;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("그래프 Canvas 컨텍스트를 생성하지 못했습니다.");

  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

  return { context, displayWidth, displayHeight: height };
}

export function drawRgbSpectrum(canvas, spectrum) {
  drawSpectrumChart(
    canvas,
    [
      { name: "Red", values: spectrum.redRaw, strokeStyle: "#dc2626" },
      { name: "Green", values: spectrum.greenRaw, strokeStyle: "#16a34a" },
      { name: "Blue", values: spectrum.blueRaw, strokeStyle: "#2563eb" }
    ],
    { yMin: 0, yMax: 255, yDecimals: 0, xLabel: "파장 (nm, 근사)" }
  );
}

export function drawGraySpectrum(canvas, spectrum) {
  captureUnknownBt601ForComparison(spectrum);

  drawSpectrumChart(
    canvas,
    [
      { name: "Gray BT.601", values: spectrum.grayBt601, strokeStyle: "#111827" },
      { name: "Gray Mean", values: spectrum.grayMean, strokeStyle: "#7c3aed" }
    ],
    { yMin: 0, yMax: 255, yDecimals: 0, xLabel: "파장 (nm, 근사)" }
  );
}

export function drawSpectrumChart(canvas, seriesList, options = {}) {
  if (!Array.isArray(seriesList) || seriesList.length === 0) {
    throw new Error("그래프 데이터가 없습니다.");
  }

  const { context, displayWidth, displayHeight } = prepareCanvas(
    canvas,
    Number(options.height || 250)
  );

  context.clearRect(0, 0, displayWidth, displayHeight);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, displayWidth, displayHeight);

  const padding = {
    left: options.yLabel ? 58 : 42,
    right: 16,
    top: 34,
    bottom: 48
  };

  const graphWidth = Math.max(1, displayWidth - padding.left - padding.right);
  const graphHeight = Math.max(1, displayHeight - padding.top - padding.bottom);
  const yMin = Number.isFinite(options.yMin) ? Number(options.yMin) : 0;
  const yMax = Number.isFinite(options.yMax) ? Number(options.yMax) : 255;
  const yDecimals = Number.isInteger(options.yDecimals) ? options.yDecimals : 0;

  drawGrid(context, padding, graphWidth, graphHeight, yMin, yMax, yDecimals);
  drawWavelengthXAxis(
    context,
    padding,
    graphWidth,
    graphHeight,
    options.xLabel || "파장 (nm, 근사)"
  );

  seriesList.forEach((series, seriesIndex) => {
    drawSeries(
      context,
      series,
      seriesIndex,
      padding,
      graphWidth,
      graphHeight,
      yMin,
      yMax
    );
  });

  if (options.yLabel) {
    drawYAxisLabel(context, String(options.yLabel), padding, graphHeight);
  }
}

function drawGrid(context, padding, graphWidth, graphHeight, yMin, yMax, yDecimals) {
  context.strokeStyle = "#e2e8f0";
  context.fillStyle = "#64748b";
  context.lineWidth = 1;
  context.font = "10px sans-serif";
  context.textAlign = "right";

  for (let lineIndex = 0; lineIndex <= 5; lineIndex += 1) {
    const ratio = lineIndex / 5;
    const y = padding.top + graphHeight * ratio;

    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(padding.left + graphWidth, y);
    context.stroke();

    const value = yMax - (yMax - yMin) * ratio;
    context.fillText(Number(value).toFixed(yDecimals), padding.left - 7, y + 4);
  }

  context.textAlign = "start";
}

function drawWavelengthXAxis(context, padding, graphWidth, graphHeight, xLabel) {
  const tickRatios = [0, 0.25, 0.5, 0.75, 1];

  context.font = "10px sans-serif";
  context.fillStyle = "#64748b";
  context.strokeStyle = "#cbd5e1";
  context.lineWidth = 1;

  tickRatios.forEach((ratio, index) => {
    const x = padding.left + ratio * graphWidth;
    const axisY = padding.top + graphHeight;
    const wavelength = Math.round(
      WAVELENGTH_MIN_NM + ratio * (WAVELENGTH_MAX_NM - WAVELENGTH_MIN_NM)
    );

    context.beginPath();
    context.moveTo(x, axisY);
    context.lineTo(x, axisY + 5);
    context.stroke();

    context.textAlign =
      index === 0
        ? "left"
        : index === tickRatios.length - 1
          ? "right"
          : "center";

    context.fillText(String(wavelength), x, axisY + 17);
  });

  context.fillStyle = "#64748b";
  context.font = "11px sans-serif";
  context.textAlign = "center";
  context.fillText(
    xLabel,
    padding.left + graphWidth / 2,
    padding.top + graphHeight + 37
  );
  context.textAlign = "start";
}

function drawYAxisLabel(context, text, padding, graphHeight) {
  context.save();
  context.fillStyle = "#64748b";
  context.font = "10px sans-serif";
  context.textAlign = "center";
  context.translate(12, padding.top + graphHeight / 2);
  context.rotate(-Math.PI / 2);
  context.fillText(text, 0, 0);
  context.restore();
}

function drawSeries(
  context,
  series,
  seriesIndex,
  padding,
  graphWidth,
  graphHeight,
  yMin,
  yMax
) {
  const values = series.values;
  if (!Array.isArray(values) || values.length === 0) return;

  context.beginPath();
  context.strokeStyle = series.strokeStyle || "#111827";
  context.lineWidth = Number(series.lineWidth || 1.5);
  context.lineJoin = "round";
  context.lineCap = "round";
  context.setLineDash(Array.isArray(series.lineDash) ? series.lineDash : []);

  const range = Math.max(1e-12, yMax - yMin);

  values.forEach((value, pointIndex) => {
    const x =
      padding.left +
      (pointIndex / Math.max(1, values.length - 1)) * graphWidth;

    const clamped = Math.min(Math.max(Number(value), yMin), yMax);
    const ratio = (clamped - yMin) / range;
    const y = padding.top + (1 - ratio) * graphHeight;

    if (pointIndex === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });

  context.stroke();
  context.setLineDash([]);
  drawLegend(context, series, seriesIndex, padding);
}

function drawLegend(context, series, seriesIndex, padding) {
  const startX = padding.left + seriesIndex * 110;
  const lineY = 16;

  context.save();
  context.strokeStyle = series.strokeStyle || "#111827";
  context.lineWidth = Number(series.lineWidth || 2);
  context.setLineDash(Array.isArray(series.lineDash) ? series.lineDash : []);
  context.beginPath();
  context.moveTo(startX, lineY);
  context.lineTo(startX + 14, lineY);
  context.stroke();
  context.restore();

  context.fillStyle = "#334155";
  context.font = "10px sans-serif";
  context.fillText(series.name, startX + 18, 19);
}

function minMaxNormalize(values) {
  if (!Array.isArray(values) || values.length === 0) return [];

  const finite = values.map(Number).filter(Number.isFinite);
  if (finite.length === 0) return values.map(() => 0);

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const range = max - min;

  if (Math.abs(range) < 1e-12) return values.map(() => 0);
  return values.map(value => (Number(value) - min) / range);
}

function averageArrays(arrays) {
  if (!Array.isArray(arrays) || arrays.length === 0) return [];
  const n = Math.min(...arrays.map(array => array.length));

  return Array.from(
    { length: n },
    (_, index) =>
      arrays.reduce((sum, array) => sum + Number(array[index]), 0) / arrays.length
  );
}

function relativeAtt(sample, blank) {
  const n = Math.min(sample.length, blank.length);
  return Array.from({ length: n }, (_, index) => {
    const b = Number(blank[index]);
    return Math.abs(b) < 1e-9 ? 0 : 1 - Number(sample[index]) / b;
  });
}

function captureUnknownBt601ForComparison(spectrum) {
  try {
    const session = loadSession();
    if (!session || session.sessionType !== "unknown") return;
    if (!Array.isArray(spectrum?.grayBt601)) return;

    if (capturedUnknownNumber !== session.unknownNumber) {
      capturedUnknownNumber = session.unknownNumber;
      capturedUnknownGrayBt601 = new Map();
    }

    const repeatIndex = Number(session.currentRepeatIndex || 0);
    capturedUnknownGrayBt601.set(repeatIndex, [...spectrum.grayBt601]);
  } catch {
    // 표시용 데이터 수집 실패는 실제 분류 계산에 영향을 주지 않습니다.
  }
}

function ensureComparisonUi() {
  const card = document.getElementById("classificationCard");
  if (!card) return null;

  let section = document.getElementById("spectrumComparisonSection");
  if (section) return section;

  section = document.createElement("div");
  section.id = "spectrumComparisonSection";
  section.style.marginTop = "24px";
  section.innerHTML = `
    <h4 style="margin:0 0 8px;">미지 시료와 기준 스펙트럼 비교</h4>
    <div class="chart-container">
      <canvas id="classificationSpectrumCanvas" class="spectrum-chart"></canvas>
    </div>
    <p id="classificationSpectrumNote" class="analysis-description" style="margin-top:10px;">
      표시 그래프는 Gray BT.601 기반 상대감쇠를 최소-최대 정규화한 값이며, 실제 재질 판정은 Gray Mean 기반 정규화 전 Relative attenuation의 Euclidean distance를 사용함.
    </p>
  `;

  const classificationNote = document.getElementById("classificationNote");
  if (classificationNote) classificationNote.insertAdjacentElement("afterend", section);
  else card.appendChild(section);

  return section;
}

function keepOnlyTopTwoRows() {
  const ranking = document.getElementById("similarityRanking");
  if (!ranking) return;

  [...ranking.children].forEach((row, index) => {
    row.style.display = index < 2 ? "" : "none";
  });

  const heading = ranking.previousElementSibling;
  if (heading && /^H[1-6]$/.test(heading.tagName)) {
    heading.textContent = "Top-2 유사도 순위";
  }
}

function showComparisonMessage(message) {
  ensureComparisonUi();
  const canvas = document.getElementById("classificationSpectrumCanvas");
  const note = document.getElementById("classificationSpectrumNote");

  if (canvas) {
    const { context, displayWidth, displayHeight } = prepareCanvas(canvas, 180);
    context.clearRect(0, 0, displayWidth, displayHeight);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, displayWidth, displayHeight);
    context.fillStyle = "#64748b";
    context.font = "12px sans-serif";
    context.textAlign = "center";
    context.fillText(message, displayWidth / 2, displayHeight / 2);
  }

  if (note) {
    note.textContent =
      "표시 그래프는 Gray BT.601 기반으로 생성됩니다. 실제 판정 알고리즘은 Gray Mean + Euclidean distance를 그대로 사용합니다.";
  }
}

function renderClassificationComparison() {
  const card = document.getElementById("classificationCard");
  if (!card || card.classList.contains("hidden")) return;

  keepOnlyTopTwoRows();

  const material = document
    .getElementById("predictionMaterial")
    ?.textContent
    ?.trim();

  if (!material || !MATERIAL_COLORS[material]) return;

  const ref = getLatestReference();
  const referenceSpectrum = ref?.spectraBt601?.[material];
  const blankBt601 = ref?.blankBt601;

  if (!Array.isArray(referenceSpectrum) || !Array.isArray(blankBt601)) {
    showComparisonMessage("BT.601 비교 그래프를 위해 기준을 새로 측정해 주세요.");
    return;
  }

  const repeats = [0, 1, 2]
    .map(index => capturedUnknownGrayBt601.get(index))
    .filter(Array.isArray);

  if (repeats.length < 3) {
    showComparisonMessage("UNKNOWN 3회 측정값을 확인해 주세요.");
    return;
  }

  const unknownGrayBt601 = averageArrays(repeats);
  const unknownRelativeAttenuation = relativeAtt(unknownGrayBt601, blankBt601);

  const normalizedReference = minMaxNormalize(referenceSpectrum);
  const normalizedUnknown = minMaxNormalize(unknownRelativeAttenuation);

  ensureComparisonUi();
  const note = document.getElementById("classificationSpectrumNote");
  if (note) {
    note.textContent =
      "표시 그래프는 Gray BT.601 기반 상대감쇠를 최소-최대 정규화한 값이며, 실제 재질 판정은 Gray Mean 기반 정규화 전 Relative attenuation의 Euclidean distance를 사용함.";
  }

  const canvas = document.getElementById("classificationSpectrumCanvas");
  if (!canvas) return;

  drawSpectrumChart(
    canvas,
    [
      {
        name: `${material} 기준`,
        values: normalizedReference,
        strokeStyle: MATERIAL_COLORS[material],
        lineWidth: 1.9
      },
      {
        name: "UNKNOWN 평균",
        values: normalizedUnknown,
        strokeStyle: UNKNOWN_COLOR,
        lineWidth: 3.0,
        lineDash: [8, 5]
      }
    ],
    {
      yMin: 0,
      yMax: 1,
      yDecimals: 1,
      yLabel: "정규화된 상대감쇠",
      xLabel: "파장 (nm, 근사)",
      height: 280
    }
  );
}

function installClassificationComparisonObserver() {
  const install = () => {
    const card = document.getElementById("classificationCard");
    if (!card || card.dataset.comparisonObserverInstalled === "true") return;

    card.dataset.comparisonObserverInstalled = "true";

    const observer = new MutationObserver(() => {
      if (!card.classList.contains("hidden")) {
        requestAnimationFrame(renderClassificationComparison);
      }
    });

    observer.observe(card, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
}

installClassificationComparisonObserver();
