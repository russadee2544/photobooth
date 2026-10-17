// Renders the "Good Vibes" receipt theme (80 mm), after the owner's Canva photo strip: red paper,
// wavy cloud-shaped photo frames with a black outline, flowers, sparkles and big bubbly lettering.
// Background (per layout height) and transparent stickers. Run through build-goodvibes.mjs.
// Units are 80 mm receipt pixels (576 wide); stickers are drawn S times larger.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;

public static class GoodVibesTheme
{
    const int S = 2;
    static readonly Color Red = Color.FromArgb(242, 59, 47);
    static readonly Color Ink = Color.FromArgb(20, 18, 16);
    static readonly Color Lilac = Color.FromArgb(236, 232, 255);

    static Bitmap NewLayer(float w, float h, out Graphics g)
    {
        var bmp = new Bitmap((int)Math.Round(w * S), (int)Math.Round(h * S), PixelFormat.Format32bppArgb);
        g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.ScaleTransform(S, S);
        return bmp;
    }
    static void Save(Bitmap bmp, string dir, string name) { bmp.Save(Path.Combine(dir, name), ImageFormat.Png); bmp.Dispose(); }

    // A rounded rectangle whose edges bulge out in soft scallops (the cloud frame of the design).
    static GraphicsPath Cloud(float x, float y, float w, float h, float amp, float period)
    {
        float r = Math.Min(w, h) * 0.16f;
        var pts = new List<PointF>();
        // walk the rounded-rect perimeter in small steps, pushing each point out along its normal
        var outline = new GraphicsPath();
        outline.AddArc(x, y, 2 * r, 2 * r, 180, 90);
        outline.AddArc(x + w - 2 * r, y, 2 * r, 2 * r, 270, 90);
        outline.AddArc(x + w - 2 * r, y + h - 2 * r, 2 * r, 2 * r, 0, 90);
        outline.AddArc(x, y + h - 2 * r, 2 * r, 2 * r, 90, 90);
        outline.CloseFigure();
        outline.Flatten(new Matrix(), 0.2f);
        var src = outline.PathPoints;
        // resample evenly
        var even = new List<PointF>();
        float step = 1.5f, carry = 0;
        for (int i = 0; i < src.Length; i++)
        {
            var a = src[i]; var b = src[(i + 1) % src.Length];
            float len = (float)Math.Sqrt((b.X - a.X) * (b.X - a.X) + (b.Y - a.Y) * (b.Y - a.Y));
            for (float t = carry; t < len; t += step) even.Add(new PointF(a.X + (b.X - a.X) * t / len, a.Y + (b.Y - a.Y) * t / len));
            carry = (carry - len) % step; if (carry < 0) carry += step;
        }
        float cx = x + w / 2, cy = y + h / 2, perimeter = even.Count * step;
        int bumps = Math.Max(8, (int)Math.Round(perimeter / period));
        for (int i = 0; i < even.Count; i++)
        {
            var p = even[i];
            var q = even[(i + 1) % even.Count];
            float nx = q.Y - p.Y, ny = -(q.X - p.X);                 // outward normal for a clockwise outline
            float nl = (float)Math.Sqrt(nx * nx + ny * ny); if (nl < 1e-3) continue;
            nx /= nl; ny /= nl;
            if ((p.X - cx) * nx + (p.Y - cy) * ny < 0) { nx = -nx; ny = -ny; }
            double phase = (double)i / even.Count * bumps;
            float bulge = amp * (float)Math.Pow(Math.Abs(Math.Sin(Math.PI * phase)), 0.65);
            pts.Add(new PointF(p.X + nx * bulge, p.Y + ny * bulge));
        }
        var path = new GraphicsPath();
        path.AddPolygon(pts.ToArray());
        return path;
    }

    // Frame for one photo slot: red everywhere outside the cloud, black cloud outline, see-through inside.
    public static void Frame(string dir, string name, float w, float h)
    {
        Graphics g; var bmp = NewLayer(w, h, out g);
        float amp = Math.Min(w, h) * 0.035f, inset = amp + 4;
        var cloud = Cloud(inset, inset, w - 2 * inset, h - 2 * inset, amp, Math.Min(w, h) * 0.2f);
        var outside = new Region(new RectangleF(0, 0, w, h));
        outside.Exclude(cloud);
        using (var b = new SolidBrush(Red)) g.FillRegion(b, outside);
        using (var pen = new Pen(Ink, 3.2f) { LineJoin = LineJoin.Round }) g.DrawPath(pen, cloud);
        g.Dispose(); Save(bmp, dir, name);
    }

    static void Outlined(Graphics g, GraphicsPath path, Color fill, float stroke)
    {
        using (var pen = new Pen(Ink, stroke) { LineJoin = LineJoin.Round }) g.DrawPath(pen, path);
        using (var b = new SolidBrush(fill)) g.FillPath(b, path);
        using (var pen = new Pen(Ink, stroke * 0.55f) { LineJoin = LineJoin.Round }) g.DrawPath(pen, path);
    }

    public static void Sparkle(string dir, string name, float size)
    {
        Graphics g; var bmp = NewLayer(size, size, out g);
        float c = size / 2, R = size * 0.46f, r = size * 0.1f;
        var p = new GraphicsPath();
        var pts = new List<PointF>();
        for (int k = 0; k < 8; k++)
        {
            double a = -Math.PI / 2 + k * Math.PI / 4;
            float rr = k % 2 == 0 ? R : r;
            pts.Add(new PointF(c + (float)Math.Cos(a) * rr, c + (float)Math.Sin(a) * rr));
        }
        p.AddClosedCurve(pts.ToArray(), 0.25f);
        Outlined(g, p, Color.FromArgb(255, 214, 51), size * 0.05f);
        g.Dispose(); Save(bmp, dir, name);
    }

    static void Flower(Graphics g, float cx, float cy, float R, int petals, Color petal, Color centre)
    {
        var all = new GraphicsPath();
        for (int k = 0; k < petals; k++)
        {
            double a = k * 2 * Math.PI / petals;
            var e = new GraphicsPath();
            e.AddEllipse(-R * 0.32f, -R, R * 0.64f, R * 0.95f);
            var m = new Matrix();
            m.Translate(cx, cy);
            m.Rotate((float)(a * 180 / Math.PI));
            e.Transform(m);
            all.AddPath(e, false);
        }
        all.FillMode = FillMode.Winding;
        Outlined(g, all, petal, R * 0.06f);
        var c = new GraphicsPath(); c.AddEllipse(cx - R * 0.3f, cy - R * 0.3f, R * 0.6f, R * 0.6f);
        Outlined(g, c, centre, R * 0.06f);
    }

    public static void Daisy(string dir, string name, float size)
    {
        Graphics g; var bmp = NewLayer(size, size, out g);
        Flower(g, size / 2, size / 2, size * 0.46f, 9, Color.FromArgb(255, 250, 236), Color.FromArgb(240, 128, 170));
        g.Dispose(); Save(bmp, dir, name);
    }

    public static void PinkFlower(string dir, string name, float size)
    {
        Graphics g; var bmp = NewLayer(size, size, out g);
        Flower(g, size / 2, size / 2, size * 0.46f, 6, Color.FromArgb(246, 166, 196), Color.FromArgb(255, 245, 226));
        g.Dispose(); Save(bmp, dir, name);
    }

    public static void Hearts(string dir, string name, float size)
    {
        Graphics g; var bmp = NewLayer(size, size, out g);
        Func<float, float, float, float, GraphicsPath> heart = (cx, cy, s, rot) =>
        {
            var p = new GraphicsPath();
            p.AddBezier(0, 0.35f, -0.55f, -0.05f, -0.45f, -0.6f, 0, -0.3f);
            p.AddBezier(0, -0.3f, 0.45f, -0.6f, 0.55f, -0.05f, 0, 0.35f);
            p.CloseFigure();
            var m = new Matrix(); m.Translate(cx, cy); m.Rotate(rot); m.Scale(s, s); p.Transform(m);
            return p;
        };
        Outlined(g, heart(size * 0.4f, size * 0.55f, size * 0.62f, -14), Color.FromArgb(246, 166, 196), size * 0.04f);
        Outlined(g, heart(size * 0.72f, size * 0.3f, size * 0.34f, 16), Color.FromArgb(255, 214, 51), size * 0.035f);
        g.Dispose(); Save(bmp, dir, name);
    }

    // GOOD / VIBES in heavy rounded letters, lilac with a thick black outline, then the shop name.
    public static void Title(string dir, string name, float w, float h)
    {
        Graphics g; var bmp = NewLayer(w, h, out g);
        Action<string, RectangleF> word = (text, box) =>
        {
            var fam = new FontFamily("Gill Sans Ultra Bold");
            float size = 200f; GraphicsPath p = null; RectangleF b = RectangleF.Empty;
            for (int i = 0; i < 60; i++)
            {
                if (p != null) p.Dispose();
                p = new GraphicsPath(FillMode.Winding);
                p.AddString(text, fam, 0, size, PointF.Empty, StringFormat.GenericTypographic);
                b = p.GetBounds();
                if (b.Width <= box.Width && b.Height <= box.Height) break;
                size *= Math.Min(0.98f, Math.Min(box.Width / b.Width, box.Height / b.Height));
            }
            var m = new Matrix(); m.Translate(box.X + (box.Width - b.Width) / 2 - b.X, box.Y + (box.Height - b.Height) / 2 - b.Y); p.Transform(m);
            using (var pen = new Pen(Ink, size * 0.16f) { LineJoin = LineJoin.Round }) g.DrawPath(pen, p);
            using (var br = new SolidBrush(Lilac)) g.FillPath(br, p);
        };
        word("GOOD", new RectangleF(w * 0.12f, 6, w * 0.76f, h * 0.36f));
        word("VIBES", new RectangleF(w * 0.06f, h * 0.4f, w * 0.88f, h * 0.36f));
        var sub = new GraphicsPath();
        var fam2 = new FontFamily("Arial Black");
        sub.AddString("BAANMAI AI OON", fam2, 0, h * 0.11f, PointF.Empty, StringFormat.GenericTypographic);
        var sb = sub.GetBounds();
        var sm = new Matrix(); sm.Translate((w - sb.Width) / 2 - sb.X, h * 0.84f - sb.Y); sub.Transform(sm);
        using (var br = new SolidBrush(Ink)) g.FillPath(br, sub);
        g.Dispose(); Save(bmp, dir, name);
    }

    public static void Paper(string dir, string name, int w, int h)
    {
        const int K = 2;
        using (var bmp = new Bitmap(w * K, h * K, PixelFormat.Format24bppRgb))
        using (var g = Graphics.FromImage(bmp))
        {
            g.Clear(Red);
            var enc = Array.Find(ImageCodecInfo.GetImageEncoders(), c => c.MimeType == "image/jpeg");
            var prm = new EncoderParameters(1);
            prm.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 90L);
            bmp.Save(Path.Combine(dir, name), enc, prm);
        }
    }
}
