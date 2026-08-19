import { getLayoutPreset } from './layout-presets';

export function generateGuideSpec(layoutId: string): HTMLCanvasElement | null {
  const layout = getLayoutPreset(layoutId);
  if (!layout) return null;
  
  const canvas = document.createElement('canvas');
  canvas.width = layout.canvasSize.width;
  canvas.height = layout.canvasSize.height;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  
  // Draw background
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Draw bleed zone (10 dots min margin)
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
  
  ctx.fillStyle = '#ff0000';
  ctx.font = '12px Arial';
  ctx.fillText('BLEED ZONE', 15, 25);
  
  // Draw slots
  ctx.setLineDash([]);
  layout.slots.forEach((slot, index) => {
    ctx.strokeStyle = '#0000ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(slot.x, slot.y, slot.width, slot.height);
    
    // Fill transparent area placeholder
    ctx.fillStyle = 'rgba(0,0,255,0.1)';
    ctx.fillRect(slot.x, slot.y, slot.width, slot.height);
    
    // Labels
    ctx.fillStyle = '#0000ff';
    ctx.font = 'bold 24px Arial';
    ctx.fillText(`SLOT ${index + 1}`, slot.x + slot.width / 2 - 40, slot.y + slot.height / 2);
    ctx.font = '14px Arial';
    ctx.fillText(`${slot.width} x ${slot.height} (x:${slot.x}, y:${slot.y})`, slot.x + slot.width / 2 - 70, slot.y + slot.height / 2 + 25);
  });
  
  // Draw logo area
  if (layout.logoArea) {
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.strokeRect(layout.logoArea.x, layout.logoArea.y, layout.logoArea.width, layout.logoArea.height);
    
    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('LOGO AREA', layout.logoArea.x + 10, layout.logoArea.y + 25);
  }
  
  return canvas;
}

export function getCanvaTemplateUrl(layoutId: string): string {
  // Placeholder mapping, can be expanded
  const mappings: Record<string, string> = {
    'classic_3': 'https://canva.com/template/classic-3',
    'classic_4': 'https://canva.com/template/classic-4',
    'duo': 'https://canva.com/template/duo',
    'portrait': 'https://canva.com/template/portrait',
    'grid_4': 'https://canva.com/template/grid-4'
  };
  
  return mappings[layoutId] || 'https://canva.com/';
}
