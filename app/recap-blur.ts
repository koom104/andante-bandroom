// Premultiplied pixels keep translucent light edges from developing dark fringes.
export function blurRecapPixels(pixels: Uint8ClampedArray, width: number, height: number, radius: number) {
  let source = new Float32Array(pixels.length);
  let target = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    for (let c = 0; c < 3; c++) source[i + c] = pixels[i + c] * alpha;
    source[i + 3] = pixels[i + 3];
  }
  const r = Math.max(1, Math.round(radius));
  // Three separable box passes approximate Gaussian blur without Canvas.filter.
  for (let pass = 0; pass < 3; pass++) {
    for (const horizontal of [true, false]) {
      const length = horizontal ? width : height;
      const lines = horizontal ? height : width;
      const stride = horizontal ? 4 : width * 4;
      for (let line = 0; line < lines; line++) {
        const base = horizontal ? line * width * 4 : line * 4;
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let k = -r; k <= r; k++) sum += source[base + Math.max(0, Math.min(length - 1, k)) * stride + c];
          for (let pos = 0; pos < length; pos++) {
            target[base + pos * stride + c] = sum / (2 * r + 1);
            sum += source[base + Math.min(length - 1, pos + r + 1) * stride + c]
              - source[base + Math.max(0, pos - r) * stride + c];
          }
        }
      }
      [source, target] = [target, source];
    }
  }
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = source[i + 3];
    for (let c = 0; c < 3; c++) pixels[i + c] = alpha > 0 ? source[i + c] * 255 / alpha : 0;
    pixels[i + 3] = alpha;
  }
}

export function blurredRecapLayer(source: CanvasImageSource, width: number, height: number, radius: number) {
  const layer = document.createElement("canvas");
  const scale = Math.min(1, 270 / width);
  layer.width = Math.max(1, Math.round(width * scale));
  layer.height = Math.max(1, Math.round(height * scale));
  const ctx = layer.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("블러 이미지를 만들 수 없습니다.");
  ctx.drawImage(source, 0, 0, layer.width, layer.height);
  const image = ctx.getImageData(0, 0, layer.width, layer.height);
  blurRecapPixels(image.data, layer.width, layer.height, radius * scale);
  ctx.putImageData(image, 0, 0);
  return layer;
}
