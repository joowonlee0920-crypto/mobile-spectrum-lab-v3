"use strict";

export function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function standardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const average = mean(values);
  const squaredDifferenceSum = values.reduce((sum, value) => {
    const difference = value - average;
    return sum + difference * difference;
  }, 0);
  return Math.sqrt(squaredDifferenceSum / (values.length - 1));
}

export function coefficientOfVariation(values) {
  const average = mean(values);
  if (average === 0) return 0;
  return (standardDeviation(values) / Math.abs(average)) * 100;
}

export function indexOfMaximum(values) {
  if (!Array.isArray(values) || values.length === 0) return -1;
  let maximumIndex = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[maximumIndex]) maximumIndex = index;
  }
  return maximumIndex;
}

export function sanitizeFileName(fileName) {
  return String(fileName || "data")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
}

/**
 * iPhone/iPad 및 홈 화면 실행(PWA)에서는 일반 a[download]가
 * 안정적으로 동작하지 않는 경우가 있어 Web Share 파일 저장을 우선 사용합니다.
 * 공유 시트에서 '파일에 저장'을 선택하면 CSV를 Files 앱에 보관할 수 있습니다.
 */
export async function downloadBlob(fileName, content, mimeType) {
  const safeName = sanitizeFileName(fileName);
  const type = `${mimeType};charset=utf-8`;
  const blob = content instanceof Blob ? content : new Blob([content], { type });

  const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent || "");
  const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;

  if ((isAppleMobile || isStandalone) && typeof File !== "undefined" && navigator.share) {
    try {
      const file = new File([blob], safeName, { type: blob.type || type });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: safeName });
        return true;
      }
    } catch (error) {
      if (error?.name === "AbortError") return false;
      console.warn("파일 공유 저장 실패, 일반 다운로드로 전환합니다.", error);
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = safeName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
  return true;
}

export function toFixedNumber(value, decimalPlaces = 6) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Number(numericValue.toFixed(decimalPlaces));
}
