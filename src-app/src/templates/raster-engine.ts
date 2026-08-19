export async function ditherImage(colorImage: Blob, targetWidth: number = 576): Promise<Blob> {
  const img = new Image();
  const url = URL.createObjectURL(colorImage);
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  
  const targetHeight = Math.floor((img.height * targetWidth) / img.width);
  
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) throw new Error('Canvas 2D context not available');
  
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
  URL.revokeObjectURL(url);
  
  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const data = imageData.data;
  
  // Floyd-Steinberg Dithering
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const idx = (y * targetWidth + x) * 4;
      const oldR = data[idx];
      const oldG = data[idx + 1];
      const oldB = data[idx + 2];
      
      // Simple luminance
      const oldGray = 0.299 * oldR + 0.587 * oldG + 0.114 * oldB;
      const newGray = oldGray < 128 ? 0 : 255;
      const err = oldGray - newGray;
      
      data[idx] = data[idx + 1] = data[idx + 2] = newGray;
      
      const distributeError = (dx: number, dy: number, coeff: number) => {
        if (x + dx >= 0 && x + dx < targetWidth && y + dy >= 0 && y + dy < targetHeight) {
          const eIdx = ((y + dy) * targetWidth + (x + dx)) * 4;
          const eVal = data[eIdx] + err * coeff;
          data[eIdx] = data[eIdx + 1] = data[eIdx + 2] = eVal;
        }
      };
      
      distributeError(1, 0, 7/16);
      distributeError(-1, 1, 3/16);
      distributeError(0, 1, 5/16);
      distributeError(1, 1, 1/16);
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Dither blob generation failed'));
    }, 'image/png'); // Can store as PNG, but metadata can indicate it's dithered
  });
}

export function chunkRaster(rasterData: Uint8Array, stripeHeight: number): Uint8Array[] {
  // Simplified chunking mock
  const chunks: Uint8Array[] = [];
  // Assuming rasterData is raw 1-bit per pixel bitmap data.
  // We chunk it row by row. 
  const bytesPerRow = 576 / 8; 
  const bytesPerStripe = bytesPerRow * stripeHeight;
  
  for (let i = 0; i < rasterData.length; i += bytesPerStripe) {
    chunks.push(rasterData.slice(i, i + bytesPerStripe));
  }
  
  return chunks;
}

export function generateEscPosCommands(chunks: Uint8Array[]): Uint8Array {
  // Mock ESC/POS command generation
  const commands: number[] = [];
  // ESC @ (Initialize)
  commands.push(0x1B, 0x40);
  
  for (const chunk of chunks) {
    // Generate raster print command GS v 0
    commands.push(0x1D, 0x76, 0x30, 0x00);
    // ... width/height bytes
    chunk.forEach(b => commands.push(b));
  }
  
  // GS V (Cut)
  commands.push(0x1D, 0x56, 0x00);
  
  return new Uint8Array(commands);
}
