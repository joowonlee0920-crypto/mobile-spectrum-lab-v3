"use strict";

import { downloadBlob, sanitizeFileName } from "./utils.js";

export function spectrumToCsv(analysisResult) {
  if (!analysisResult || !analysisResult.spectrum) {
    throw new Error("CSV로 저장할 분석 결과가 없습니다.");
  }

  const spectrum = analysisResult.spectrum;
  const rows = [[
    "pixel",
    "red_raw",
    "green_raw",
    "blue_raw",
    "gray_bt601",
    "gray_mean"
  ].join(",")];

  for (let index = 0; index < spectrum.pixel.length; index += 1) {
    rows.push([
      spectrum.pixel[index],
      Number(spectrum.redRaw[index]).toFixed(6),
      Number(spectrum.greenRaw[index]).toFixed(6),
      Number(spectrum.blueRaw[index]).toFixed(6),
      Number(spectrum.grayBt601[index]).toFixed(6),
      Number(spectrum.grayMean[index]).toFixed(6)
    ].join(","));
  }

  return "\uFEFF" + rows.join("\n");
}

export async function downloadSpectrumCsv({
  analysisResult,
  sessionName = "session",
  sampleName = "Blank",
  repeatNumber = 1
}) {
  const csv = spectrumToCsv(analysisResult);
  const safeSessionName = sanitizeFileName(sessionName);
  const safeSampleName = sanitizeFileName(sampleName);
  const repeatText = String(repeatNumber).padStart(2, "0");
  const fileName = `${safeSessionName}_${safeSampleName}_${repeatText}_raw.csv`;
  return downloadBlob(fileName, csv, "text/csv");
}

function csvValue(value) {
  const text = value == null ? "" : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * 한 세션의 모든 측정 원자료를 하나의 CSV로 저장합니다.
 * 기준 세션이면 총 18회, UNKNOWN 세션이면 총 3회가 포함됩니다.
 */
export async function downloadSessionCsv(session) {
  if (!session || !Array.isArray(session.measurements) || session.measurements.length === 0) {
    throw new Error("저장할 세션 측정 데이터가 없습니다.");
  }

  const header = [
    "project_name","session_name","session_type","light_source","measurement_mode","mount_orientation",
    "sample_type","sample_name","repeat","captured_at",
    "roi_x","roi_y","roi_width","roi_height",
    "pixel","red_raw","green_raw","blue_raw","gray_bt601","gray_mean",
    "app_version","roi_mode","anchor_roi_x","align_offset_px","align_ncc","align_flags",
    "pred_top1","pred_top2","dist_top1","dist_top2","margin","decision"
  ];
  const c = session.classification || null;
  const cls = c ? [c.ranks[0]?.material, c.ranks[1]?.material, c.ranks[0]?.distance?.toFixed(6), c.ranks[1]?.distance?.toFixed(6), c.margin, c.decision] : ["","","","","",""];
  const anchorX = session.anchor?.x ?? "";

  const rows = [header.join(",")];

  session.measurements.forEach(record => {
    const spectrum = record.spectrum || {};
    const n = Array.isArray(spectrum.pixel) ? spectrum.pixel.length : 0;
    for (let index = 0; index < n; index += 1) {
      rows.push([
        session.projectName,
        session.sessionName,
        session.sessionType,
        session.lightSource,
        session.measurementMode,
        session.mountOrientation || "normal",
        record.sampleType,
        record.displayName,
        record.repeatNumber,
        record.capturedAt,
        record.roi?.x,
        record.roi?.y,
        record.roi?.width,
        record.roi?.height,
        spectrum.pixel[index],
        Number(spectrum.redRaw?.[index] ?? 0).toFixed(6),
        Number(spectrum.greenRaw?.[index] ?? 0).toFixed(6),
        Number(spectrum.blueRaw?.[index] ?? 0).toFixed(6),
        Number(spectrum.grayBt601?.[index] ?? 0).toFixed(6),
        Number(spectrum.grayMean?.[index] ?? 0).toFixed(6),
        session.version || "",
        record.roiMode || "manual",
        anchorX,
        record.alignment?.offsetPx ?? "",
        record.alignment?.ncc ?? "",
        (record.alignment?.flags || []).join("|"),
        ...cls
      ].map(csvValue).join(","));
    }
  });

  const safeSessionName = sanitizeFileName(session.sessionName || "session");
  let suffix = "reference_18_measurements";
  if (session.sessionType !== "reference") {
    const unknownLabel = `UNKNOWN-${String(session.unknownNumber || 0).padStart(3, "0")}`;
    suffix = `${unknownLabel}_3_measurements`;
  }
  const fileName = `${safeSessionName}_${suffix}.csv`;
  return downloadBlob(fileName, "\uFEFF" + rows.join("\n"), "text/csv");
}

export async function downloadSpectrumJson({
  analysisResult,
  sessionName = "session",
  sampleName = "Blank",
  repeatNumber = 1
}) {
  const safeSessionName = sanitizeFileName(sessionName);
  const safeSampleName = sanitizeFileName(sampleName);
  const repeatText = String(repeatNumber).padStart(2, "0");
  const fileName = `${safeSessionName}_${safeSampleName}_${repeatText}.json`;
  return downloadBlob(fileName, JSON.stringify(analysisResult, null, 2), "application/json");
}
