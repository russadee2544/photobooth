import type { LayoutPreset } from '../types';

export interface FrameValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export interface FrameVersion {
  versionNumber: number;
  sanitizedBlob: Blob;
  warnings: string[];
  overridden: boolean;
  timestamp: number;
}

const frameVersions = new Map<string, FrameVersion[]>();

export async function validatePngStructure(file: File): Promise<FrameValidationResult> {
  const errors: string[] = [];
  if (file.type !== 'image/png') {
    errors.push('File must be a PNG image.');
  }
  
  // Basic magic bytes check (simplified)
  const buffer = await file.slice(0, 8).arrayBuffer();
  const view = new Uint8Array(buffer);
  const magic = [137, 80, 78, 71, 13, 10, 26, 10];
  const isPng = magic.every((val, i) => val === view[i]);
  
  if (!isPng) {
    errors.push('File structure is not valid PNG.');
  }

  return { valid: errors.length === 0, warnings: [], errors };
}

export async function validateDimensions(file: File, layout: LayoutPreset): Promise<FrameValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  const img = new Image();
  const url = URL.createObjectURL(file);
  
  await new Promise((resolve) => {
    img.onload = resolve;
    img.onerror = resolve;
    img.src = url;
  });
  
  if (img.width !== layout.canvasSize.width || img.height !== layout.canvasSize.height) {
    errors.push(`Dimensions mismatch. Expected ${layout.canvasSize.width}x${layout.canvasSize.height}, got ${img.width}x${img.height}.`);
  }
  
  URL.revokeObjectURL(url);
  
  return { valid: errors.length === 0, warnings, errors };
}

export async function sanitizeFrame(file: File): Promise<Blob> {
  // Simplistic decoding and re-encoding to strip metadata
  const img = new Image();
  const url = URL.createObjectURL(file);
  
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx?.drawImage(img, 0, 0);
  
  URL.revokeObjectURL(url);
  
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to sanitize frame'));
    }, 'image/png');
  });
}

export async function checkDecompressionBomb(file: File, maxPixels: number): Promise<FrameValidationResult> {
  const errors: string[] = [];
  // Approximate size ratio check
  // A true decompression bomb check might read PNG headers directly
  if (file.size > 20 * 1024 * 1024) {
    errors.push('File size too large, possible decompression bomb.');
  }
  return { valid: errors.length === 0, warnings: [], errors };
}

export function publishVersion(frameId: string, sanitizedBlob: Blob, warnings: string[], overridden: boolean) {
  let versions = frameVersions.get(frameId) || [];
  const versionNumber = versions.length + 1;
  
  const newVersion: FrameVersion = {
    versionNumber,
    sanitizedBlob,
    warnings,
    overridden,
    timestamp: Date.now()
  };
  
  versions.push(newVersion);
  frameVersions.set(frameId, versions);
  return newVersion;
}

export function getVersionHistory(frameId: string, limit = 5): FrameVersion[] {
  const versions = frameVersions.get(frameId) || [];
  return versions.slice().reverse().slice(0, limit);
}

export function getActiveVersion(frameId: string): FrameVersion | undefined {
  const versions = frameVersions.get(frameId) || [];
  return versions[versions.length - 1];
}

export function rollbackToVersion(frameId: string, versionNumber: number): FrameVersion | undefined {
  const versions = frameVersions.get(frameId) || [];
  const target = versions.find(v => v.versionNumber === versionNumber);
  if (target) {
    publishVersion(frameId, target.sanitizedBlob, target.warnings, true);
  }
  return getActiveVersion(frameId);
}
