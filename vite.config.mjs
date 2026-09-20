import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

function directPrintPlugin() {
  return {
    name: 'direct-print-plugin',
    configureServer(server) {
      // Endpoint 1: List all installed printers
      server.middlewares.use('/api/printers', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          return res.end();
        }
        const psCmd = `Get-CimInstance Win32_Printer | Select-Object Name, Default, PortName, DriverName | ConvertTo-Json -Compress`;
        exec(`powershell -NoProfile -Command "${psCmd}"`, (err, stdout) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          if (err) {
            return res.end(JSON.stringify({ printers: [], defaultPrinter: '' }));
          }
          try {
            const raw = JSON.parse(stdout.trim() || '[]');
            const list = Array.isArray(raw) ? raw : [raw];
            const printers = list.map(p => ({
              name: p.Name,
              isDefault: !!p.Default,
              port: p.PortName,
              driver: p.DriverName
            }));
            const def = printers.find(p => p.isDefault)?.name || (printers[0]?.name || '');
            res.end(JSON.stringify({ printers, defaultPrinter: def }));
          } catch (e) {
            res.end(JSON.stringify({ printers: [], defaultPrinter: '' }));
          }
        });
      });

      // Endpoint 2: Direct silent print to Windows printer without any print dialog
      server.middlewares.use('/api/direct-print', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const data = JSON.parse(body || '{}');
            const dataUrl = data.image || '';
            const requestedPrinter = (data.printerName || '').trim();
            const copies = Math.max(1, parseInt(data.copies, 10) || 1);

            if (!dataUrl || !dataUrl.includes('base64,')) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              return res.end(JSON.stringify({ success: false, error: 'invalid_image' }));
            }

            const base64Data = dataUrl.split('base64,')[1];
            const tempFile = path.join(os.tmpdir(), `pb_print_${Date.now()}.png`);
            fs.writeFileSync(tempFile, Buffer.from(base64Data, 'base64'));

            const escapedFile = tempFile.replace(/\\/g, '\\\\');
            const psScript = `
Add-Type -AssemblyName System.Drawing
$targetPrinter = "${requestedPrinter}"
if (-not $targetPrinter) {
    $def = Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1
    if ($def) { $targetPrinter = $def.Name }
    else {
        $xp = Get-CimInstance Win32_Printer | Where-Object { $_.Name -like '*XP*' -or $_.Name -like '*58*' -or $_.Name -like '*POS*' } | Select-Object -First 1
        if ($xp) { $targetPrinter = $xp.Name }
        else { $targetPrinter = (Get-CimInstance Win32_Printer | Select-Object -First 1).Name }
    }
}
if (-not $targetPrinter) { Write-Error "No printer available in Windows"; exit 1 }

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $targetPrinter
$doc.PrinterSettings.Copies = ${copies}
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

$img = [System.Drawing.Image]::FromFile("${escapedFile}")
$doc.add_PrintPage({
    param($sender, $e)
    $pw = $e.PageBounds.Width
    if ($pw -le 0) { $pw = 200 }
    $ph = [int]($img.Height * ($pw / $img.Width))

    # Enable maximum quality image scaling for crisp photo prints
    $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $e.Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $e.Graphics.DrawImage($img, 0, 0, $pw, $ph)
    $e.HasMorePages = $false
})

$doc.Print()
$img.Dispose()
$doc.Dispose()
Write-Output "PRINT_SUCCESS:$targetPrinter"
`;
            const psScriptPath = path.join(os.tmpdir(), `pb_print_runner_${Date.now()}.ps1`);
            fs.writeFileSync(psScriptPath, psScript, 'utf8');

            exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`, (err, stdout, stderr) => {
              try { fs.unlinkSync(tempFile); } catch(e){}
              try { fs.unlinkSync(psScriptPath); } catch(e){}

              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              if (err) {
                console.error('[DirectPrint Server Error]', err, stderr);
                res.statusCode = 500;
                return res.end(JSON.stringify({ success: false, error: err.message, stderr }));
              }
              const matched = stdout.match(/PRINT_SUCCESS:(.+)/);
              const usedPrinter = matched ? matched[1].trim() : targetPrinter;
              console.log(`[DirectPrint] Successfully sent ${copies} copy(ies) to printer "${usedPrinter}" without dialog.`);
              res.end(JSON.stringify({ success: true, printer: usedPrinter, copies }));
            });
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), directPrintPlugin()],
  build: {
    outDir: 'dist-next',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app.html'),
        home: resolve(import.meta.dirname, 'home.html'),
        layout: resolve(import.meta.dirname, 'layout.html'),
        capture: resolve(import.meta.dirname, 'capture.html'),
        retake: resolve(import.meta.dirname, 'retake.html'),
        template: resolve(import.meta.dirname, 'template.html'),
        payment: resolve(import.meta.dirname, 'payment.html'),
        filter: resolve(import.meta.dirname, 'filter.html'),
        processing: resolve(import.meta.dirname, 'processing.html'),
        print: resolve(import.meta.dirname, 'print.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
        templateEditor: resolve(import.meta.dirname, 'template-editor.html'),
      },
    },
  },
});
