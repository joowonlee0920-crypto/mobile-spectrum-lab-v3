"use strict";

import {
  mean,
  indexOfMaximum,
  toFixedNumber
} from "./utils.js";

/**
 * 이미지를 원본 크기의 Canvas로 변환합니다.
 */
export function createSourceCanvas(
  imageElement
) {
  if (!imageElement) {
    throw new Error(
      "분석할 이미지가 없습니다."
    );
  }

  const imageWidth =
    imageElement.naturalWidth ||
    imageElement.width;

  const imageHeight =
    imageElement.naturalHeight ||
    imageElement.height;

  if (
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    throw new Error(
      "이미지 크기를 확인할 수 없습니다."
    );
  }

  const canvas =
    document.createElement("canvas");

  canvas.width =
    imageWidth;

  canvas.height =
    imageHeight;

  const context =
    canvas.getContext(
      "2d",
      {
        willReadFrequently: true
      }
    );

  if (!context) {
    throw new Error(
      "Canvas 컨텍스트를 생성하지 못했습니다."
    );
  }

  context.drawImage(
    imageElement,
    0,
    0,
    imageWidth,
    imageHeight
  );

  return canvas;
}

/**
 * ROI가 이미지 범위 안에 있는지 검사합니다.
 */
export function validateRoi(
  roi,
  imageWidth,
  imageHeight
) {
  if (!roi) {
    throw new Error(
      "ROI 정보가 없습니다."
    );
  }

  const normalizedRoi = {
    x: Math.round(
      Number(roi.x)
    ),

    y: Math.round(
      Number(roi.y)
    ),

    width: Math.round(
      Number(roi.width)
    ),

    height: Math.round(
      Number(roi.height)
    )
  };

  const values =
    Object.values(normalizedRoi);

  if (
    values.some(
      (value) =>
        !Number.isFinite(value)
    )
  ) {
    throw new Error(
      "ROI 좌표 또는 크기가 올바르지 않습니다."
    );
  }

  if (
    normalizedRoi.width < 1 ||
    normalizedRoi.height < 1
  ) {
    throw new Error(
      "ROI 크기는 1px 이상이어야 합니다."
    );
  }

  if (
    normalizedRoi.x < 0 ||
    normalizedRoi.y < 0 ||
    normalizedRoi.x +
      normalizedRoi.width >
      imageWidth ||
    normalizedRoi.y +
      normalizedRoi.height >
      imageHeight
  ) {
    throw new Error(
      "ROI가 이미지 범위를 벗어났습니다."
    );
  }

  return normalizedRoi;
}

/**
 * ROI의 각 가로 위치에서 세로 방향 픽셀값을 평균합니다.
 *
 * 결과:
 * pixel        : ROI 내부 위치 0~width-1
 * redRaw       : Red 세로 평균
 * greenRaw     : Green 세로 평균
 * blueRaw      : Blue 세로 평균
 * grayBt601    : 0.299R + 0.587G + 0.114B
 * grayMean     : (R + G + B) / 3
 */
export function extractSpectrumFromImage(
  imageElement,
  roi,
  decimalPlaces = 6
) {
  const sourceCanvas =
    createSourceCanvas(
      imageElement
    );

  return extractSpectrumFromCanvas(
    sourceCanvas,
    roi,
    decimalPlaces
  );
}

/**
 * Canvas에서 ROI 스펙트럼을 추출합니다.
 */
export function extractSpectrumFromCanvas(
  sourceCanvas,
  roi,
  decimalPlaces = 6
) {
  if (!sourceCanvas) {
    throw new Error(
      "분석할 Canvas가 없습니다."
    );
  }

  const sourceContext =
    sourceCanvas.getContext(
      "2d",
      {
        willReadFrequently: true
      }
    );

  if (!sourceContext) {
    throw new Error(
      "Canvas 픽셀을 읽을 수 없습니다."
    );
  }

  const normalizedRoi =
    validateRoi(
      roi,
      sourceCanvas.width,
      sourceCanvas.height
    );

  const imageData =
    sourceContext.getImageData(
      normalizedRoi.x,
      normalizedRoi.y,
      normalizedRoi.width,
      normalizedRoi.height
    );

  const rgba =
    imageData.data;

  const spectrum = {
    pixel: [],
    redRaw: [],
    greenRaw: [],
    blueRaw: [],
    grayBt601: [],
    grayMean: []
  };

  for (
    let localX = 0;
    localX <
    normalizedRoi.width;
    localX += 1
  ) {
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;

    for (
      let localY = 0;
      localY <
      normalizedRoi.height;
      localY += 1
    ) {
      const rgbaIndex =
        (
          localY *
            normalizedRoi.width +
          localX
        ) * 4;

      redSum +=
        rgba[rgbaIndex];

      greenSum +=
        rgba[rgbaIndex + 1];

      blueSum +=
        rgba[rgbaIndex + 2];
    }

    const red =
      redSum /
      normalizedRoi.height;

    const green =
      greenSum /
      normalizedRoi.height;

    const blue =
      blueSum /
      normalizedRoi.height;

    const grayBt601 =
      0.299 * red +
      0.587 * green +
      0.114 * blue;

    const grayMean =
      (
        red +
        green +
        blue
      ) / 3;

    spectrum.pixel.push(
      localX
    );

    spectrum.redRaw.push(
      toFixedNumber(
        red,
        decimalPlaces
      )
    );

    spectrum.greenRaw.push(
      toFixedNumber(
        green,
        decimalPlaces
      )
    );

    spectrum.blueRaw.push(
      toFixedNumber(
        blue,
        decimalPlaces
      )
    );

    spectrum.grayBt601.push(
      toFixedNumber(
        grayBt601,
        decimalPlaces
      )
    );

    spectrum.grayMean.push(
      toFixedNumber(
        grayMean,
        decimalPlaces
      )
    );
  }

  return {
    roi:
      normalizedRoi,

    image: {
      width:
        sourceCanvas.width,

      height:
        sourceCanvas.height
    },

    extraction: {
      horizontalIndex:
        "roi-relative",

      verticalAggregation:
        "mean",

      grayBt601Formula:
        "0.299R + 0.587G + 0.114B",

      grayMeanFormula:
        "(R + G + B) / 3",

      decimalPlaces
    },

    spectrum,

    summary:
      calculateSpectrumSummary(
        spectrum
      )
  };
}

/**
 * 영상 프레임 여러 개의 스펙트럼을 평균합니다.
 */
export function averageSpectrumResults(
  analysisResults,
  decimalPlaces = 6
) {
  if (
    !Array.isArray(analysisResults) ||
    analysisResults.length === 0
  ) {
    throw new Error(
      "평균할 스펙트럼 결과가 없습니다."
    );
  }

  const firstResult =
    analysisResults[0];

  const pointCount =
    firstResult.spectrum.pixel.length;

  const channelNames = [
    "redRaw",
    "greenRaw",
    "blueRaw",
    "grayBt601",
    "grayMean"
  ];

  analysisResults.forEach(
    (result) => {
      if (
        result.spectrum.pixel.length !==
        pointCount
      ) {
        throw new Error(
          "프레임별 스펙트럼 길이가 서로 다릅니다."
        );
      }
    }
  );

  const averagedSpectrum = {
    pixel:
      [...firstResult.spectrum.pixel],

    redRaw:
      Array(pointCount).fill(0),

    greenRaw:
      Array(pointCount).fill(0),

    blueRaw:
      Array(pointCount).fill(0),

    grayBt601:
      Array(pointCount).fill(0),

    grayMean:
      Array(pointCount).fill(0)
  };

  channelNames.forEach(
    (channelName) => {
      for (
        let pointIndex = 0;
        pointIndex < pointCount;
        pointIndex += 1
      ) {
        const values =
          analysisResults.map(
            (result) =>
              result.spectrum[
                channelName
              ][pointIndex]
          );

        averagedSpectrum[
          channelName
        ][pointIndex] =
          toFixedNumber(
            mean(values),
            decimalPlaces
          );
      }
    }
  );

  return {
    roi:
      {...firstResult.roi},

    image:
      {...firstResult.image},

    extraction: {
      ...firstResult.extraction,

      frameAggregation:
        "mean",

      frameCount:
        analysisResults.length
    },

    spectrum:
      averagedSpectrum,

    summary:
      calculateSpectrumSummary(
        averagedSpectrum
      )
  };
}

/**
 * 스펙트럼의 기초 요약값을 계산합니다.
 */
export function calculateSpectrumSummary(
  spectrum
) {
  const gray =
    spectrum.grayBt601;

  if (
    !Array.isArray(gray) ||
    gray.length === 0
  ) {
    return {
      dataLength: 0,
      peakPixel: -1,
      peakIntensity: 0,
      minimumPixel: -1,
      minimumIntensity: 0,
      intensityRange: 0,
      meanIntensity: 0
    };
  }

  const peakPixel =
    indexOfMaximum(gray);

  let minimumPixel = 0;

  for (
    let index = 1;
    index < gray.length;
    index += 1
  ) {
    if (
      gray[index] <
      gray[minimumPixel]
    ) {
      minimumPixel = index;
    }
  }

  const peakIntensity =
    gray[peakPixel];

  const minimumIntensity =
    gray[minimumPixel];

  return {
    dataLength:
      gray.length,

    peakPixel,

    peakIntensity:
      toFixedNumber(
        peakIntensity
      ),

    minimumPixel,

    minimumIntensity:
      toFixedNumber(
        minimumIntensity
      ),

    intensityRange:
      toFixedNumber(
        peakIntensity -
        minimumIntensity
      ),

    meanIntensity:
      toFixedNumber(
        mean(gray)
      )
  };
}