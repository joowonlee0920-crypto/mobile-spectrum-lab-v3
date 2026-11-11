"use strict";

/**
 * Mobile Spectrum Lab V3 - ROI 자동 정렬과 판정 신뢰도(margin)
 *
 * 1) 자동 정렬
 *    세션 첫 Blank에서 사용자가 확정한 ROI의 Gray(mean) 분포를 '기준 모양(anchor)'으로 저장한다.
 *    이후 사진에서는 같은 크기의 ROI를 좌우로 움직여 가며 기준 모양과의 상관계수(NCC)가
 *    가장 큰 위치를 찾아 ROI를 자동으로 놓는다. 사람이 손으로 ROI를 끌어 놓지 않는다.
 *
 * 2) 판정 신뢰도
 *    margin M = (d2 - d1) / (d1 + d2). M < τ(0.10)이면 '판정 보류'로 표시한다.
 */

import { createSourceCanvas } from "./analysis.js?v=3.0.0";

export const ALIGN_SEARCH_RATIO = 0.6;   // 좌우 탐색 범위 = ROI 가로폭 × 0.6
export const ALIGN_MIN_NCC = 0.90;       // 이보다 낮으면 정렬 신뢰도 낮음 경고
export const ALIGN_LARGE_SHIFT_RATIO = 0.2; // ROI 가로폭의 20% 이상 이동하면 장치 이동 경고
export const MARGIN_TAU = 0.10;

/** 이미지의 [x0, x1) 열 각각에 대해 y..y+h 행의 (R+G+B)/3 평균을 구한다. */
export function columnGrayProfile(imageOrCanvas, x0, x1, y, h) {
  const canvas = imageOrCanvas instanceof HTMLCanvasElement ? imageOrCanvas : createSourceCanvas(imageOrCanvas);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const width = Math.max(0, x1 - x0);
  if (width <= 0 || h <= 0) return [];
  const data = ctx.getImageData(x0, y, width, h).data;
  const out = new Array(width).fill(0);
  for (let row = 0; row < h; row += 1) {
    const base = row * width * 4;
    for (let col = 0; col < width; col += 1) {
      const i = base + col * 4;
      out[col] += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
  }
  return out.map(v => v / h);
}

function ncc(a, b, offset) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i += 1) { ma += a[i]; mb += b[offset + i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - ma, db = b[offset + i] - mb;
    sab += da * db; saa += da * da; sbb += db * db;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

/**
 * anchor: { x, y, width, height, profile }  (세션 첫 Blank의 확정 ROI와 Gray 분포)
 * 반환: { roi, offsetPx, ncc, searchPx, flags[] }
 */
export function alignRoiToAnchor(imageElement, anchor) {
  if (!anchor || !Array.isArray(anchor.profile) || anchor.profile.length < 10) {
    throw new Error("자동 정렬에 사용할 기준 Blank 정보가 없습니다.");
  }
  const canvas = createSourceCanvas(imageElement);
  const iw = canvas.width, ih = canvas.height;
  const w = anchor.width, h = Math.min(anchor.height, ih - anchor.y);
  if (w > iw || anchor.y < 0 || h <= 0) throw new Error("이미지 크기가 기준 측정과 달라 자동 정렬을 할 수 없습니다.");

  const search = Math.round(w * ALIGN_SEARCH_RATIO);
  const x0 = Math.max(0, anchor.x - search);
  const x1 = Math.min(iw, anchor.x + w + search);
  const band = columnGrayProfile(canvas, x0, x1, anchor.y, h);
  const profile = anchor.profile.slice(0, w);

  let best = { offset: anchor.x - x0, score: -2 };
  for (let start = 0; start + w <= band.length; start += 1) {
    const score = ncc(profile, band, start);
    if (score > best.score) best = { offset: start, score };
  }
  const roiX = x0 + best.offset;
  const offsetPx = roiX - anchor.x;
  const flags = [];
  if (best.score < ALIGN_MIN_NCC) flags.push("low_ncc");
  if (Math.abs(offsetPx) >= w * ALIGN_LARGE_SHIFT_RATIO) flags.push("large_shift");
  if (roiX === x0 && x0 > 0 || roiX + w === x1 && x1 < iw) flags.push("search_edge");

  return {
    roi: { x: roiX, y: anchor.y, width: w, height: anchor.height },
    offsetPx,
    ncc: Number(best.score.toFixed(4)),
    searchPx: search,
    flags
  };
}

export function describeAlignment(a) {
  if (!a) return { text: "", type: "" };
  const sign = a.offsetPx > 0 ? "+" : "";
  let text = `자동 정렬: 기준 Blank 대비 ${sign}${a.offsetPx} px 이동, 일치도 ${a.ncc.toFixed(3)}.`;
  let type = "success";
  if (a.flags.includes("large_shift") || a.flags.includes("search_edge")) { text += " 스펙트럼이 크게 이동했습니다. 스마트폰이나 분광기가 움직였는지 확인하세요(자동 정렬로 보정됨)."; type = "warning"; }
  if (a.flags.includes("search_edge")) { text += " 탐색 범위 끝에서 찾았으므로 다시 촬영을 권장합니다."; type = "error"; }
  if (a.flags.includes("low_ncc")) { text += " 일치도가 낮습니다. 빛샘·초점·노출을 확인하고 다시 촬영하세요."; type = "error"; }
  return { text, type };
}

/** Euclidean 순위 목록(ranks, 오름차순)에서 margin과 판정 보류 여부를 계산한다. */
export function marginDecision(ranks, tau = MARGIN_TAU) {
  if (!Array.isArray(ranks) || ranks.length < 2) return { margin: null, decision: "accept" };
  const d1 = ranks[0].distance, d2 = ranks[1].distance;
  const margin = d1 + d2 > 0 ? (d2 - d1) / (d1 + d2) : 0;
  return { margin: Number(margin.toFixed(4)), decision: margin < tau ? "hold" : "accept", tau };
}
