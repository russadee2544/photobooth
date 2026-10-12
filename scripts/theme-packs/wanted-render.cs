// Renders the "Wanted poster" receipt theme (58 mm) as separate layers: an aged-paper background
// per layout and transparent stickers. Run through scripts/theme-packs/build-wanted.ps1.
// Units are 58 mm receipt pixels (384 wide, 203 dpi); stickers are drawn S times larger so they
// stay sharp when the kiosk composes the print at 1200 px wide.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;

public static class WantedTheme
{
    const int S = 3;                                   // sticker scale
    static readonly Color Ink = Color.FromArgb(56, 56, 56);
    static readonly Color Light = Color.FromArgb(246, 238, 222);

    // ------------------------------------------------------------------ helpers
    static Bitmap NewLayer(float w, float h, out Graphics g)
    {
        var bmp = new Bitmap((int)Math.Round(w * S), (int)Math.Round(h * S), PixelFormat.Format32bppArgb);
        g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.ScaleTransform(S, S);
        return bmp;
    }

    static void Save(Bitmap bmp, string dir, string name)
    {
        bmp.Save(Path.Combine(dir, name), ImageFormat.Png);
        bmp.Dispose();
    }

    // Fills text so it fits inside the box (largest size that fits), centred or aligned.
    static void Text(Graphics g, string text, string family, FontStyle style, RectangleF box, Color color,
                     StringAlignment align = StringAlignment.Center, float maxSize = 200f)
    {
        var fam = new FontFamily(family);
        float size = maxSize;
        RectangleF bounds = RectangleF.Empty;
        GraphicsPath path = null;
        for (int i = 0; i < 60; i++)
        {
            if (path != null) path.Dispose();
            path = new GraphicsPath();
            path.AddString(text, fam, (int)style, size, PointF.Empty, StringFormat.GenericTypographic);
            bounds = path.GetBounds();
            if (bounds.Width <= box.Width && bounds.Height <= box.Height) break;
            float k = Math.Min(box.Width / Math.Max(1f, bounds.Width), box.Height / Math.Max(1f, bounds.Height));
            size *= Math.Min(0.98f, k);
        }
        float x = align == StringAlignment.Near ? box.X - bounds.X
                : align == StringAlignment.Far ? box.Right - bounds.Right
                : box.X + (box.Width - bounds.Width) / 2f - bounds.X;
        float y = box.Y + (box.Height - bounds.Height) / 2f - bounds.Y;
        var m = new Matrix();
        m.Translate(x, y);
        path.Transform(m);
        using (var brush = new SolidBrush(color)) g.FillPath(brush, path);
        path.Dispose();
    }

    static PointF[] StarPoints(float cx, float cy, float r, float inner = 0.42f)
    {
        var pts = new PointF[10];
        for (int k = 0; k < 10; k++)
        {
            double a = (-90 + k * 36) * Math.PI / 180.0;
            float rr = k % 2 == 0 ? r : r * inner;
            pts[k] = new PointF(cx + (float)(Math.Cos(a) * rr), cy + (float)(Math.Sin(a) * rr));
        }
        return pts;
    }

    static void Star(Graphics g, float cx, float cy, float r, Color c)
    {
        using (var b = new SolidBrush(c)) g.FillPolygon(b, StarPoints(cx, cy, r));
    }

    // Sheriff-style badge: ring + star.
    static void Badge(Graphics g, float cx, float cy, float r)
    {
        using (var pen = new Pen(Ink, 1.6f)) g.DrawEllipse(pen, cx - r, cy - r, 2 * r, 2 * r);
        Star(g, cx, cy + r * 0.04f, r * 0.86f, Ink);
    }

    static void Rule(Graphics g, float x1, float x2, float y, float width)
    {
        using (var pen = new Pen(Ink, width)) g.DrawLine(pen, x1, y, x2, y);
    }

    // ------------------------------------------------------------------ stickers
    public static void Header(string dir)
    {
        Graphics g; var bmp = NewLayer(360, 64, out g);
        Rule(g, 0, 360, 1f, 1.4f);
        foreach (float bx in new float[] { 0f, 290f })
        {
            var box = new RectangleF(bx + 1, 6, 68, 36);
            using (var b = new SolidBrush(Ink)) g.FillRectangle(b, box);
            using (var pen = new Pen(Light, 0.9f)) g.DrawRectangle(pen, box.X + 2.5f, box.Y + 2.5f, box.Width - 5, box.Height - 5);
            Text(g, "BREAKING", "Courier New", FontStyle.Bold, new RectangleF(box.X + 7, box.Y + 7, box.Width - 14, 10), Light);
            Text(g, "NEWS", "Courier New", FontStyle.Bold, new RectangleF(box.X + 7, box.Y + 19, box.Width - 14, 10), Light);
        }
        Text(g, "Criminal News", "Old English Text MT", FontStyle.Regular, new RectangleF(92, 9, 176, 30), Ink);
        Star(g, 84, 24, 5.5f, Ink);
        Star(g, 276, 24, 5.5f, Ink);
        // dark info bar
        var bar = new RectangleF(0, 47, 360, 16);
        using (var b = new SolidBrush(Ink)) g.FillRectangle(b, bar);
        Text(g, "VOL. 10, NO. 4", "Courier New", FontStyle.Bold, new RectangleF(6, 50.5f, 92, 9), Light, StringAlignment.Near);
        Text(g, "MOST WANTED PERSON", "Courier New", FontStyle.Bold, new RectangleF(124, 50.5f, 112, 9), Light);
        Text(g, "EST. 2026", "Courier New", FontStyle.Bold, new RectangleF(270, 50.5f, 84, 9), Light, StringAlignment.Far);
        Star(g, 112, 55, 4.2f, Light);
        Star(g, 248, 55, 4.2f, Light);
        g.Dispose(); Save(bmp, dir, "header.png");
    }

    public static void Title(string dir)
    {
        Graphics g; var bmp = NewLayer(360, 72, out g);
        Text(g, "WANTED", "Playbill", FontStyle.Regular, new RectangleF(2, 1, 356, 70), Ink);
        g.Dispose(); Save(bmp, dir, "title.png");
    }

    public static void WantedFor(string dir)
    {
        Graphics g; var bmp = NewLayer(360, 54, out g);
        Rule(g, 0, 360, 2f, 2.2f);
        Rule(g, 0, 360, 6f, 1f);
        Badge(g, 17, 32, 13);
        Badge(g, 343, 32, 13);
        Text(g, "WANTED FOR: STEALING HEARTS. EXCESSIVE SMILING.", "Courier New", FontStyle.Bold, new RectangleF(36, 16, 288, 13), Ink);
        Text(g, "TOO MUCH FUN. GOOD VIBES. GROUP SELFIES.", "Courier New", FontStyle.Bold, new RectangleF(36, 34, 288, 13), Ink);
        g.Dispose(); Save(bmp, dir, "wanted-for.png");
    }

    // Outline drawn over a photo slot (the photo shows through the middle).
    public static void Frame(string dir, string name, float w, float h)
    {
        Graphics g; var bmp = NewLayer(w, h, out g);
        using (var pen = new Pen(Ink, 2.6f)) g.DrawRectangle(pen, 1.3f, 1.3f, w - 2.6f, h - 2.6f);
        g.Dispose(); Save(bmp, dir, name);
    }

    public static void NameBar(string dir)
    {
        Graphics g; var bmp = NewLayer(360, 36, out g);
        using (var b = new SolidBrush(Ink)) g.FillRectangle(b, 0, 0, 180, 36);
        using (var pen = new Pen(Ink, 2f)) g.DrawRectangle(pen, 181, 1, 178, 34);
        Text(g, "MOST WANTED", "Bahnschrift SemiBold Condensed", FontStyle.Regular, new RectangleF(10, 7, 160, 22), Light);
        Text(g, "$1,000,000 REWARD", "Bahnschrift SemiBold Condensed", FontStyle.Regular, new RectangleF(190, 7, 160, 22), Ink);
        g.Dispose(); Save(bmp, dir, "name-bar.png");
    }

    public static void Description(string dir)
    {
        Graphics g; var bmp = NewLayer(360, 50, out g);
        using (var pen = new Pen(Ink, 1.6f)) g.DrawRectangle(pen, 0.8f, 0.8f, 358.4f, 48.4f);
        string[] lines = {
            "LAST SEEN HAVING THE TIME OF THEIR LIVES AT",
            "MEMORIES PHOTO BOOTH. EXTREMELY PHOTOGENIC.",
            "APPROACH WITH A SMILE. HANDLE WITH CARE."
        };
        for (int i = 0; i < lines.Length; i++)
            Text(g, lines[i], "Courier New", FontStyle.Bold, new RectangleF(10, 7 + i * 12.5f, 340, 9.5f), Ink);
        g.Dispose(); Save(bmp, dir, "description.png");
    }

    public static void Footer(string dir)
    {
        Graphics g; var bmp = NewLayer(360, 48, out g);
        Rule(g, 0, 360, 1.5f, 2.2f);
        Rule(g, 0, 360, 5.5f, 1f);
        var box = new RectangleF(36, 11, 288, 35);
        using (var pen = new Pen(Ink, 2f)) g.DrawRectangle(pen, box.X, box.Y, box.Width, box.Height);
        Text(g, "PLEASE SMILE FOR THE CAMERA", "Bahnschrift SemiBold Condensed", FontStyle.Regular,
             new RectangleF(box.X + 10, box.Y + 6, box.Width - 20, box.Height - 12), Ink);
        Badge(g, 17, 28.5f, 13);
        Badge(g, 343, 28.5f, 13);
        g.Dispose(); Save(bmp, dir, "footer.png");
    }

    // The user's rubber stamp, trimmed to its visible pixels.
    public static void Stamp(string source, string dir)
    {
        using (var src = new Bitmap(source))
        {
            int minX = src.Width, minY = src.Height, maxX = -1, maxY = -1;
            for (int y = 0; y < src.Height; y++)
                for (int x = 0; x < src.Width; x++)
                    if (src.GetPixel(x, y).A > 16)
                    {
                        if (x < minX) minX = x; if (y < minY) minY = y;
                        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
                    }
            var crop = new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
            using (var outBmp = src.Clone(crop, PixelFormat.Format32bppArgb))
                outBmp.Save(Path.Combine(dir, "stamp.png"), ImageFormat.Png);
        }
    }

    // ------------------------------------------------------------------ background
    // Aged newsprint: warm base, soft stains, fine grain and darker edges. Light enough that the
    // black-and-white receipt print stays clean.
    public static void Paper(string dir, string name, int unitsW, int unitsH, int seed)
    {
        const int K = 2;
        int w = unitsW * K, h = unitsH * K;
        var rnd = new Random(seed);
        Func<int, float[,]> grid = cell =>
        {
            int gw = w / cell + 3, gh = h / cell + 3;
            var a = new float[gw, gh];
            for (int i = 0; i < gw; i++) for (int j = 0; j < gh; j++) a[i, j] = (float)rnd.NextDouble();
            return a;
        };
        int[] cells = { 160, 60, 18 };
        float[] weights = { 0.55f, 0.3f, 0.15f };
        var grids = new float[cells.Length][,];
        for (int o = 0; o < cells.Length; o++) grids[o] = grid(cells[o]);
        Func<int, int, float> noise = (x, y) =>
        {
            float v = 0;
            for (int o = 0; o < cells.Length; o++)
            {
                float fx = x / (float)cells[o], fy = y / (float)cells[o];
                int ix = (int)fx, iy = (int)fy;
                float tx = fx - ix, ty = fy - iy;
                tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
                var gr = grids[o];
                float a = gr[ix, iy] + (gr[ix + 1, iy] - gr[ix, iy]) * tx;
                float b = gr[ix, iy + 1] + (gr[ix + 1, iy + 1] - gr[ix, iy + 1]) * tx;
                v += (a + (b - a) * ty) * weights[o];
            }
            return v;   // 0..1
        };
        var bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb);
        var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
        var bytes = new byte[data.Stride * h];
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                float n = noise(x, y) - 0.5f;
                float grain = (float)(rnd.NextDouble() - 0.5);
                float dx = Math.Min(x, w - 1 - x) / (float)(w * 0.18f);
                float dy = Math.Min(y, h - 1 - y) / (float)(h * 0.06f + w * 0.1f);
                float edge = 1f - Math.Min(1f, Math.Min(dx, dy));       // 1 at the border, 0 inside
                edge = edge * edge;
                float shade = n * 22f + grain * 7f - edge * 24f;
                int r = Clamp(244 + shade), gg = Clamp(232 + shade * 1.05f), b = Clamp(206 + shade * 1.2f);
                int idx = y * data.Stride + x * 3;
                bytes[idx] = (byte)b; bytes[idx + 1] = (byte)gg; bytes[idx + 2] = (byte)r;
            }
        }
        System.Runtime.InteropServices.Marshal.Copy(bytes, 0, data.Scan0, bytes.Length);
        bmp.UnlockBits(data);
        var enc = Array.Find(ImageCodecInfo.GetImageEncoders(), c => c.MimeType == "image/jpeg");
        var prm = new EncoderParameters(1);
        prm.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 82L);
        bmp.Save(Path.Combine(dir, name), enc, prm);
        bmp.Dispose();
    }

    static int Clamp(float v) { return v < 0 ? 0 : v > 255 ? 255 : (int)v; }
}
