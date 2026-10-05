CREATE TABLE IF NOT EXISTS public.layout_sizes (
    layout_id text PRIMARY KEY,
    width_cm numeric NOT NULL DEFAULT 5,
    height_cm numeric NOT NULL DEFAULT 15,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.custom_themes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    theme_type text NOT NULL,
    bg_color text,
    header_text text,
    footer_text text,
    text_color text,
    png_image text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.layout_sizes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access for layout_sizes" ON public.layout_sizes FOR SELECT USING (true);
CREATE POLICY "Allow public insert for layout_sizes" ON public.layout_sizes FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update for layout_sizes" ON public.layout_sizes FOR UPDATE USING (true);

ALTER TABLE public.custom_themes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access for custom_themes" ON public.custom_themes FOR SELECT USING (true);
CREATE POLICY "Allow public insert for custom_themes" ON public.custom_themes FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete for custom_themes" ON public.custom_themes FOR DELETE USING (true);

INSERT INTO public.layout_sizes (layout_id, width_cm, height_cm) VALUES 
('1', 10, 15),
('2', 5, 15),
('3', 5, 15),
('4', 10, 15)
ON CONFLICT (layout_id) DO NOTHING;;
