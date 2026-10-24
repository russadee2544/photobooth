// Builds the "Pink Retro" theme images from the two layers exported from the owner's Canva strip
// (192 x 576 design units, exported 1200 x 3600: K = 6.25 px per unit). Run through build-pinkretro.mjs.
// Every variant (1-4 photos, strip or receipt) is assembled from pieces of those layers:
//   B  background bands cut from the background layer (top name band, glow middle, bottom café text)
//   S  sticker groups cut from the transparent sticker layer
//   O  photo frame outlines (rounded rectangles and clouds), drawn under the stickers
// Outputs per variant: paper (dark, JPEG), paper for receipt printers (light, JPEG), over (PNG).
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.Runtime.InteropServices;

public static class PinkRetroTheme
{
    const float K = 6.25f;

    static float F(string s) { return float.Parse(s, CultureInfo.InvariantCulture); }

    static void SaveJpeg(Bitmap bmp, string path, long quality)
    {
        var enc = Array.Find(ImageCodecInfo.GetImageEncoders(), c => c.MimeType == "image/jpeg");
        var prm = new EncoderParameters(1);
        prm.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
        bmp.Save(path, enc, prm);
    }

    // spec: items separated by '|':
    //   C,W,H                              canvas in design units
    //   B,srcY0,srcY1,dstY0,dstY1          full-width background band (stretched to fit)
    //   T,y0,y1                            a band holding white lettering (made dark on receipt paper)
    //   S,srcX,srcY,srcW,srcH,dstX,dstY    sticker piece (same size)
    //   O,shape,x,y,w,h,#rrggbb            frame outline (stroke 2 units)
    public static void Variant(string underSrc, string overSrc, string spec, string cloudPath,
                               string paperOut, string thermalOut, string overOut)
    {
        var items = spec.Split('|');
        var head = items[0].Split(',');
        int W = (int)Math.Round(F(head[1]) * K), H = (int)Math.Round(F(head[2]) * K);
        using (var under = new Bitmap(underSrc))
        using (var over = new Bitmap(overSrc))
        using (var paper = new Bitmap(W, H, PixelFormat.Format24bppRgb))
        using (var front = new Bitmap(W, H, PixelFormat.Format32bppArgb))
        using (var pg = Graphics.FromImage(paper))
        using (var fg = Graphics.FromImage(front))
        {
            pg.Clear(Color.FromArgb(35, 35, 35));
            pg.InterpolationMode = InterpolationMode.HighQualityBicubic;
            pg.PixelOffsetMode = PixelOffsetMode.HighQuality;
            fg.SmoothingMode = SmoothingMode.AntiAlias;
            fg.InterpolationMode = InterpolationMode.HighQualityBicubic;
            fg.PixelOffsetMode = PixelOffsetMode.HighQuality;
            var letterBands = new System.Collections.Generic.List<float[]>();
            // outlines first, stickers over them
            foreach (var raw in items)
            {
                var p = raw.Split(',');
                if (p[0] == "B")
                {
                    var src = new RectangleF(0, F(p[1]) * K, under.Width, (F(p[2]) - F(p[1])) * K);
                    var dst = new RectangleF(0, F(p[3]) * K, W, (F(p[4]) - F(p[3])) * K);
                    pg.DrawImage(under, dst, src, GraphicsUnit.Pixel);
                }
                else if (p[0] == "T") letterBands.Add(new[] { F(p[1]) * K, F(p[2]) * K });
                else if (p[0] == "O")
                {
                    using (var pen = new Pen(ColorTranslator.FromHtml(p[6]), 2 * K) { LineJoin = LineJoin.Round })
                    using (var path = p[1] == "cloud" ? Cloud(cloudPath, F(p[2]) * K, F(p[3]) * K, F(p[4]) * K, F(p[5]) * K)
                                                      : Rounded(F(p[2]) * K, F(p[3]) * K, F(p[4]) * K, F(p[5]) * K))
                        fg.DrawPath(pen, path);
                }
            }
            foreach (var raw in items)
            {
                var p = raw.Split(',');
                if (p[0] != "S") continue;
                var src = new RectangleF(F(p[1]) * K, F(p[2]) * K, F(p[3]) * K, F(p[4]) * K);
                var dst = new RectangleF(F(p[5]) * K, F(p[6]) * K, src.Width, src.Height);
                fg.DrawImage(over, dst, src, GraphicsUnit.Pixel);
            }
            SaveJpeg(paper, paperOut, 90);
            front.Save(overOut, ImageFormat.Png);
            Thermal(paper, letterBands);
            SaveJpeg(paper, thermalOut, 90);
        }
    }

    // Same shape as the kiosk's 'rounded' slot (radius = 14% of the short side).
    static GraphicsPath Rounded(float x, float y, float w, float h)
    {
        float r = Math.Min(w, h) * 0.14f, d = r * 2;
        var path = new GraphicsPath();
        path.AddArc(x, y, d, d, 180, 90);
        path.AddArc(x + w - d, y, d, d, 270, 90);
        path.AddArc(x + w - d, y + h - d, d, d, 0, 90);
        path.AddArc(x, y + h - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    // "M x y C x1 y1 x2 y2 x y ..." in a unit square (template-engine.js CLOUD), scaled into the box.
    static GraphicsPath Cloud(string unitPath, float x, float y, float w, float h)
    {
        var path = new GraphicsPath();
        var parts = unitPath.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
        PointF cur = PointF.Empty;
        for (int i = 0; i < parts.Length;)
        {
            string cmd = parts[i++];
            Func<PointF> pt = () => { var q = new PointF(x + F(parts[i]) * w, y + F(parts[i + 1]) * h); i += 2; return q; };
            if (cmd == "M") cur = pt();
            else if (cmd == "C") { var a = pt(); var b = pt(); var c = pt(); path.AddBezier(cur, a, b, c); cur = c; }
        }
        path.CloseFigure();
        return path;
    }

    // Receipt paper: the glows were painted over #232323; recover each pixel's colour and coverage and lay
    // it over white instead (lighter, so dot gain does not muddy it). White lettering becomes dark ink.
    static void Thermal(Bitmap bmp, System.Collections.Generic.List<float[]> letterBands)
    {
        var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format24bppRgb);
        var px = new byte[data.Stride * bmp.Height];
        Marshal.Copy(data.Scan0, px, 0, px.Length);
        for (int yy = 0; yy < bmp.Height; yy++)
        {
            bool inLetters = letterBands.Exists(b => yy >= b[0] && yy <= b[1]);
            for (int xx = 0; xx < bmp.Width; xx++)
            {
                int i = yy * data.Stride + xx * 3;
                float b = px[i], g = px[i + 1], r = px[i + 2];
                float max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b));
                float cov = Math.Max(0, Math.Min(1, (max - 35f) / 220f));
                float nr, ng, nb;
                if (inLetters && min > 225 && max - min < 18) { nr = ng = nb = 40; }
                else
                {
                    float k = cov > 0.01f ? 1f / cov : 0f;
                    float cr = Math.Min(255, (r - 35f * (1 - cov)) * k), cg = Math.Min(255, (g - 35f * (1 - cov)) * k), cb = Math.Min(255, (b - 35f * (1 - cov)) * k);
                    float a2 = cov * 0.8f;
                    nr = 255 * (1 - a2) + cr * a2; ng = 255 * (1 - a2) + cg * a2; nb = 255 * (1 - a2) + cb * a2;
                }
                px[i] = (byte)nb; px[i + 1] = (byte)ng; px[i + 2] = (byte)nr;
            }
        }
        Marshal.Copy(px, 0, data.Scan0, px.Length);
        bmp.UnlockBits(data);
    }
}
