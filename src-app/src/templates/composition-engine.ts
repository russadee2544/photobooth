import type { LayoutPreset, Slot } from '../types';
import { applyFilter } from './filter-engine';

export interface CompositionInput {
  layout: LayoutPreset;
  photos: Blob[]; // Order maps to layout slots
  frameOverlay?: Blob;
  filterId?: string;
}

export interface CompositionOutput {
  blob: Blob;
  width: number;
  height: number;
}

export async function composeImage(input: CompositionInput): Promise<CompositionOutput> {
  const canvas = document.createElement('canvas');
  canvas.width = input.layout.canvasSize.width;
  canvas.height = input.layout.canvasSize.height;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context');
  
  // 1. Draw background
  ctx.fillStyle = input.layout.backgroundColor || '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // 2. Draw each photo in its slot
  for (let i = 0; i < input.layout.slots.length; i++) {
    const slot = input.layout.slots[i];
    const photoBlob = input.photos[i];
    
    if (photoBlob) {
      const img = await loadBlobAsImage(photoBlob);
      const cropRect = scaleToCover(img, slot);
      
      // Draw to temporary canvas if filter needed
      if (input.filterId && input.filterId !== 'original') {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = slot.width;
        tempCanvas.height = slot.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
          applyFilter(tempCanvas, input.filterId);
          tempCtx.drawImage(
            img, 
            cropRect.sx, cropRect.sy, cropRect.sw, cropRect.sh,
            0, 0, slot.width, slot.height
          );
          ctx.drawImage(tempCanvas, slot.x, slot.y);
        }
      } else {
        ctx.drawImage(
          img,
          cropRect.sx, cropRect.sy, cropRect.sw, cropRect.sh,
          slot.x, slot.y, slot.width, slot.height
        );
      }
    }
  }
  
  // 3. Draw frame overlay
  if (input.frameOverlay) {
    const frameImg = await loadBlobAsImage(input.frameOverlay);
    ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
  }
  
  // 4. Export
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve({ blob, width: canvas.width, height: canvas.height });
      else reject(new Error('Failed to export composed image'));
    }, 'image/png');
  });
}

function scaleToCover(img: HTMLImageElement, slot: Slot) {
  const imgAspect = img.width / img.height;
  const slotAspect = slot.width / slot.height;
  
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  
  if (imgAspect > slotAspect) {
    // Image is wider than slot
    sw = img.height * slotAspect;
    sx = (img.width - sw) / 2;
  } else {
    // Image is taller than slot
    sh = img.width / slotAspect;
    sy = (img.height - sh) / 2;
  }
  
  return { sx, sy, sw, sh };
}

function loadBlobAsImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => reject(new Error('Failed to load image from blob'));
    img.src = url;
  });
}
