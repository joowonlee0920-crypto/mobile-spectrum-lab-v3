"use strict";

import { downloadSessionCsv } from "./export.js";

export const REFERENCE_ORDER = ["Blank", "PP", "PET", "PS", "PA", "PC"];
export const REPEAT_COUNT = 3;
export const REFERENCE_VALID_MS = 4 * 60 * 60 * 1000;
const SESSION_KEY = "msl-v2-current-session";
const REFERENCE_KEY = "msl-v2-reference-library";
const UNKNOWN_COUNTER_KEY = "msl-v2-unknown-counter";

function setGlobalRoi(value) {
  if (typeof window === "undefined") return;
  window.__MSL_CURRENT_ROI = value ? { ...value } : null;
}

function getGlobalRoi() {
  if (typeof window === "undefined") return null;
  const value = window.__MSL_CURRENT_ROI;
  return value ? { ...value } : null;
}

function attachLiveRoi(session, initialRoi = null) {
  let storedRoi = initialRoi ? { ...initialRoi } : null;
  setGlobalRoi(storedRoi);

  Object.defineProperty(session, "roi", {
    enumerable: true,
    configurable: true,
    get() {
      const live = getGlobalRoi();
      return live || (storedRoi ? { ...storedRoi } : null);
    },
    set(value) {
      storedRoi = value ? { ...value } : null;
      setGlobalRoi(storedRoi);
    }
  });

  return session;
}

export function createSession({projectName, sessionName, lightSource, measurementMode, sessionType="reference", unknownNumber=null}) {
  const measurementOrder = sessionType === "reference" ? [...REFERENCE_ORDER] : ["Unknown"];
  const session = {
    version: "3.0.0",
    projectName: (projectName || "2026 과학전람회").trim(),
    sessionName: (sessionName || "측정").trim(),
    lightSource: lightSource || "6500K LED",
    measurementMode,
    sessionType,
    unknownNumber,
    measurementOrder,
    repeatCount: REPEAT_COUNT,
    currentStepIndex: 0,
    currentRepeatIndex: 0,
    measurements: [],
    roi: null,
    roiSize: null,
    anchor: null,
    autoAlign: true,
    classification: null,
    currentAnalysis: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  return session;
}

export function getCurrentMeasurement(session) {
  const sampleType = session.measurementOrder[session.currentStepIndex];
  if (!sampleType) throw new Error("현재 측정 단계를 찾을 수 없습니다.");
  const displayName = sampleType === "Unknown" && session.unknownNumber
    ? `UNKNOWN-${String(session.unknownNumber).padStart(3,"0")}` : sampleType;
  return {
    sampleType, displayName,
    repeatNumber: session.currentRepeatIndex + 1,
    stepNumber: session.currentStepIndex + 1,
    totalSteps: session.measurementOrder.length,
    instruction: sampleType === "Blank"
      ? "광 경로에 시료와 지지체를 두지 않은 상태로 측정하세요."
      : sampleType === "Unknown"
        ? `${displayName} 시료를 장치에 고정한 채 측정하세요.`
        : `${sampleType} 표준 시료를 장치에 고정한 채 측정하세요.`
  };
}

export function addMeasurement(session, analysisResult) {
  const cur = getCurrentMeasurement(session);
  session.measurements.push({
    sampleType: cur.sampleType,
    displayName: cur.displayName,
    repeatNumber: cur.repeatNumber,
    roi: {...analysisResult.roi},
    roiMode: analysisResult.roiMode || "manual",
    alignment: analysisResult.alignment ? {...analysisResult.alignment, flags:[...(analysisResult.alignment.flags||[])]} : null,
    spectrum: analysisResult.spectrum,
    summary: analysisResult.summary,
    capturedAt: new Date().toISOString()
  });
  session.updatedAt = new Date().toISOString();
}

export function advanceMeasurement(session) {
  session.currentRepeatIndex += 1;
  if (session.currentRepeatIndex >= session.repeatCount) {
    session.currentRepeatIndex = 0;
    session.currentStepIndex += 1;
  }
  session.updatedAt = new Date().toISOString();

  const completed = session.currentStepIndex >= session.measurementOrder.length;

  if (completed) {
    void downloadSessionCsv(session).catch(error => {
      console.warn("완료 세션 CSV 자동 저장 실패", error);
    });
  }

  return completed;
}

export function saveSession(session) { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
export function loadSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!parsed) return null;
    return parsed;
  } catch {
    return null;
  }
}
export function clearSavedSession() { localStorage.removeItem(SESSION_KEY); }

export function getNextUnknownNumber() {
  const next = Number(localStorage.getItem(UNKNOWN_COUNTER_KEY) || "0") + 1;
  localStorage.setItem(UNKNOWN_COUNTER_KEY, String(next));
  return next;
}

function averageChannel(records, channelName) {
  if (!Array.isArray(records) || records.length === 0) return [];
  const arrays = records
    .map(record => record?.spectrum?.[channelName])
    .filter(Array.isArray);
  if (arrays.length === 0) return [];
  const n = Math.min(...arrays.map(array => array.length));
  return Array.from(
    { length: n },
    (_, index) => arrays.reduce((sum, array) => sum + Number(array[index]), 0) / arrays.length
  );
}

function relativeAttenuation(sample, blank) {
  const n = Math.min(sample.length, blank.length);
  return Array.from({ length: n }, (_, index) => {
    const b = Number(blank[index]);
    return Math.abs(b) < 1e-9 ? 0 : 1 - Number(sample[index]) / b;
  });
}

function addBt601DisplayReference(reference) {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!session || session.sessionType !== "reference" || !Array.isArray(session.measurements)) {
      return reference;
    }

    const groups = {};
    for (const name of REFERENCE_ORDER) {
      groups[name] = session.measurements.filter(record => record.sampleType === name);
    }

    const blankBt601 = averageChannel(groups.Blank, "grayBt601");
    if (blankBt601.length === 0) return reference;

    const spectraBt601 = {};
    for (const material of ["PP", "PET", "PS", "PA", "PC"]) {
      const sampleBt601 = averageChannel(groups[material], "grayBt601");
      if (sampleBt601.length === 0) return reference;
      spectraBt601[material] = relativeAttenuation(sampleBt601, blankBt601);
    }

    return {
      ...reference,
      blankBt601,
      spectraBt601,
      displaySpectrumChannel: "grayBt601"
    };
  } catch {
    return reference;
  }
}

export function saveReference(reference) {
  const all = getReferenceHistory();
  const enrichedReference = addBt601DisplayReference(reference);
  all.unshift(enrichedReference);
  localStorage.setItem(REFERENCE_KEY, JSON.stringify(all.slice(0, 30)));
}

export function getReferenceHistory() { try { return JSON.parse(localStorage.getItem(REFERENCE_KEY) || "[]"); } catch { return []; } }
export function getLatestReference() { return getReferenceHistory()[0] || null; }
export function getReferenceAgeMs(ref) { return ref ? Date.now() - new Date(ref.createdAt).getTime() : Infinity; }
export function isReferenceExpired(ref) { return getReferenceAgeMs(ref) > REFERENCE_VALID_MS; }
export function markLightRestarted() {
  const ref = getLatestReference();
  if (!ref) return;
  const all = getReferenceHistory();
  all[0] = {...all[0], lightRestartedAt: new Date().toISOString()};
  localStorage.setItem(REFERENCE_KEY, JSON.stringify(all));
}
