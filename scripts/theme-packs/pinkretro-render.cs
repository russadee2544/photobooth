// Turns the two layers exported from the owner's Canva strip ("Pink Retro", 192 x 576 design units,
// exported 1200 x 3600) into theme images. Run through build-pinkretro.mjs.
//   Over:  the transparent sticker layer + the photo frames' outlines (rounded rectangles and clouds).
//   Paper: the background as JPEG; ThermalPaper: the same made light for receipt paper
//          (dark background -> white, white lettering -> dark) so the printer does not burn a black slip.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;

public static class PinkRetroTheme
{
    static void SaveJpeg(Bitmap bmp, string path, long quality)
    {
        var enc = Array.Find(ImageCodecInfo.GetImageEncoders(), c => c.MimeType == "image/jpeg");
        var prm = new EncoderParameters(1);
        prm.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
        bmp.Save(path, enc, prm);
    }

    public static void Paper(string src, string dest) { using (var b = new Bitmap(src)) SaveJpeg(b, dest, 90); }

    // shapes: "kind,x,y,w,h,#rrggbb,weight;..." in output pixels; cloud = unit-square cubic path below.
    public static void Over(string src, string dest, string shapes, string cloudPath)
    {
        using (var bmp = new Bitmap(src))
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            // Outlines go under the stickers: draw them on a separate layer, then the stickers over it.
            using (var outlines = new Bitmap(bmp.Width, bmp.Height, PixelFormat.Format32bppArgb))
            {
                using (var og = Graphics.FromImage(outlines))
                {
                    og.SmoothingMode = SmoothingMode.AntiAlias;
                    foreach (var item in shapes.Split(';'))
                    {
                        if (item.Length == 0) continue;
                        var p = item.Split(',');
                        float x = F(p[1]), y = F(p[2]), w = F(p[3]), h = F(p[4]);
                        var color = ColorTranslator.FromHtml(p[5]);
                        using (var pen = new Pen(color, F(p[6])))
                        using (var path = p[0] == "cloud" ? Cloud(cloudPath, x, y, w, h) : Rounded(x, y, w, h))
                        {
                            pen.LineJoin = LineJoin.Round;
                            og.DrawPath(pen, path);
                        }
                    }
                    og.DrawImage(bmp, 0, 0, bmp.Width, bmp.Height);
                }
                outlines.Save(dest, ImageFormat.Png);
            }
        }
    }

    static float F(string s) { return float.Parse(s, CultureInfo.InvariantCulture); }

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

    // "M x y C x1 y1 x2 y2 x y ..." in a unit square, scaled into the box.
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

    public static void ThermalPaper(string src, string dest)
    {
        using (var bmp = new Bitmap(src))
        {
            var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
            var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format24bppRgb);
            var px = new byte[data.Stride * bmp.Height];
            Marshal.Copy(data.Scan0, px, 0, px.Length);
            for (int yy = 0; yy < bmp.Height; yy++)
                for (int xx = 0; xx < bmp.Width; xx++)
                {
                    int i = yy * data.Stride + xx * 3;
                    float b = px[i], g = px[i + 1], r = px[i + 2];
                    float max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b));
                    // The glows were painted over #232323: recover each pixel's colour and coverage, then lay
                    // it over white instead (lighter, so the printer's dot gain does not muddy it).
                    float cov = Math.Max(0, Math.Min(1, (max - 35f) / 220f));
                    // white lettering -> dark ink (only where the text is: the name at the top and the lines at the bottom)
                    bool letter = min > 225 && max - min < 18 && (yy < bmp.Height * 0.07 || yy > bmp.Height * 0.84);
                    float nr, ng, nb;
                    if (letter) { nr = ng = nb = 40; }
                    else
                    {
                        float k = cov > 0.01f ? 1f / cov : 0f;
                        float cr = Math.Min(255, (r - 35f * (1 - cov)) * k), cg = Math.Min(255, (g - 35f * (1 - cov)) * k), cb = Math.Min(255, (b - 35f * (1 - cov)) * k);
                        float a2 = cov * 0.8f;
                        nr = 255 * (1 - a2) + cr * a2; ng = 255 * (1 - a2) + cg * a2; nb = 255 * (1 - a2) + cb * a2;
                    }
                    px[i] = (byte)nb; px[i + 1] = (byte)ng; px[i + 2] = (byte)nr;
                }
            Marshal.Copy(px, 0, data.Scan0, px.Length);
            bmp.UnlockBits(data);
            SaveJpeg(bmp, dest, 90);
        }
    }
}
