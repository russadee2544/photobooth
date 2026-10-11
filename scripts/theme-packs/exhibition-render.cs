// Renders the "Exhibition ticket" receipt theme (58 mm): a plain ticket background per layout and
// transparent stickers (ticket stub, footer). Run through scripts/theme-packs/build-exhibition.mjs.
// Units are 58 mm receipt pixels (384 wide, 203 dpi); stickers are drawn S times larger.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;

public static class ExhibitionTheme
{
    const int S = 3;
    static readonly Color Ink = Color.FromArgb(10, 10, 10);

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

    // Largest text that fits the box; optional letter spacing (in em) for the airy small caps.
    static void Text(Graphics g, string text, string family, FontStyle style, RectangleF box, Color color, float tracking = 0f)
    {
        var fam = new FontFamily(family);
        float size = 200f;
        GraphicsPath path = null;
        RectangleF bounds = RectangleF.Empty;
        for (int i = 0; i < 60; i++)
        {
            if (path != null) path.Dispose();
            path = new GraphicsPath();
            if (tracking <= 0f) path.AddString(text, fam, (int)style, size, PointF.Empty, StringFormat.GenericTypographic);
            else
            {
                float x = 0;
                foreach (char ch in text)
                {
                    if (ch == ' ') { x += size * (0.45f + tracking); continue; }
                    // monospace: every glyph gets the same advance, so spacing stays even
                    var one = new GraphicsPath();
                    one.AddString(ch.ToString(), fam, (int)style, size, new PointF(x, 0), StringFormat.GenericTypographic);
                    path.AddPath(one, false);
                    one.Dispose();
                    x += size * (0.55f + tracking);
                }
            }
            bounds = path.GetBounds();
            if (bounds.Width <= box.Width && bounds.Height <= box.Height) break;
            float k = Math.Min(box.Width / Math.Max(1f, bounds.Width), box.Height / Math.Max(1f, bounds.Height));
            size *= Math.Min(0.98f, k);
        }
        var m = new Matrix();
        m.Translate(box.X + (box.Width - bounds.Width) / 2f - bounds.X, box.Y + (box.Height - bounds.Height) / 2f - bounds.Y);
        path.Transform(m);
        using (var brush = new SolidBrush(color)) g.FillPath(brush, path);
        path.Dispose();
    }

    // Decorative barcode (fixed pattern so every print looks the same).
    static void Barcode(Graphics g, RectangleF box, Color color, int seed)
    {
        var rnd = new Random(seed);
        float x = box.X;
        using (var b = new SolidBrush(color))
            while (x < box.Right - 2)
            {
                float bar = (float)(0.8 + rnd.Next(0, 4) * 0.75);
                float gap = (float)(0.9 + rnd.Next(0, 3) * 0.8);
                if (x + bar > box.Right) break;
                g.FillRectangle(b, x, box.Y, bar, box.Height);
                x += bar + gap;
            }
    }

    // Ticket stub across the top: black, perforated lower edge, half-circle bites at both sides.
    public static void Stub(string dir, float w, float h, float notchR)
    {
        Graphics g; var bmp = NewLayer(w, h, out g);
        var shape = new GraphicsPath();
        float body = h - 4;                                   // the perforation teeth hang below this line
        shape.AddRectangle(new RectangleF(0, 0, w, body));
        int teeth = (int)(w / 6);
        float tw = w / teeth;
        for (int i = 0; i < teeth; i++)
            shape.AddPolygon(new[] { new PointF(i * tw, body - 0.5f), new PointF(i * tw + tw / 2, body + 3.5f), new PointF((i + 1) * tw, body - 0.5f) });
        var region = new Region(shape);
        var bite = new GraphicsPath();
        bite.AddEllipse(-notchR, body - notchR, notchR * 2, notchR * 2);
        bite.AddEllipse(w - notchR, body - notchR, notchR * 2, notchR * 2);
        region.Exclude(bite);
        using (var b = new SolidBrush(Ink)) g.FillRegion(b, region);

        Text(g, "EXHIBITION", "Arial Black", FontStyle.Regular, new RectangleF(30, 16, w - 60, 46), Color.White);
        Barcode(g, new RectangleF(44, 72, w - 88, 30), Color.White, 7);
        Text(g, "Ticket Code : 123-456-7890", "Arial", FontStyle.Regular, new RectangleF(70, 110, w - 140, 13), Color.White);
        g.Dispose(); Save(bmp, dir, "stub.png");
    }

    public static void Footer(string dir, float w, float h)
    {
        Graphics g; var bmp = NewLayer(w, h, out g);
        using (var pen = new Pen(Ink, 0.9f)) { pen.DashPattern = new float[] { 4, 3 }; g.DrawLine(pen, 0, 1, w, 1); }
        Text(g, "BAANMAI AI OON", "Consolas", FontStyle.Regular, new RectangleF(w * 0.18f, 12, w * 0.64f, 10), Ink, 0.55f);
        Text(g, "CAFE & RESTAURANT", "Consolas", FontStyle.Regular, new RectangleF(w * 0.14f, 27, w * 0.72f, 10), Ink, 0.55f);
        g.Dispose(); Save(bmp, dir, "footer.png");
    }

    // Plain white ticket with a hairline edge, one per layout height.
    public static void Paper(string dir, string name, int w, int h)
    {
        const int K = 2;
        using (var bmp = new Bitmap(w * K, h * K, PixelFormat.Format24bppRgb))
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.White);
            using (var pen = new Pen(Color.FromArgb(205, 205, 205), 1.2f * K))
                g.DrawRectangle(pen, 0.6f * K, 0.6f * K, (w - 1.2f) * K, (h - 1.2f) * K);
            var enc = Array.Find(ImageCodecInfo.GetImageEncoders(), c => c.MimeType == "image/jpeg");
            var prm = new EncoderParameters(1);
            prm.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 85L);
            bmp.Save(Path.Combine(dir, name), enc, prm);
        }
    }
}
