-- =========================================================================
-- SKRIP SETUP SUPABASE UNTUK SCADA MONITORING PDAM
-- Salin dan jalankan seluruh skrip ini di:
-- Supabase Dashboard -> Project -> SQL Editor -> New Query -> Klik "RUN"
-- =========================================================================

-- 1. Buat tabel scada_telemetry jika belum ada
CREATE TABLE IF NOT EXISTS public.scada_telemetry (
    node_id TEXT PRIMARY KEY,
    node_label TEXT,
    pressure_bar NUMERIC DEFAULT 0,
    pressure_m NUMERIC DEFAULT 0,
    confidence NUMERIC DEFAULT 1.0,
    officer_name TEXT DEFAULT 'Petugas Lapangan PDAM',
    gauge_type TEXT DEFAULT 'manual',
    notes TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Pastikan kolom-kolom penting tersedia jika tabel lama sudah ada
ALTER TABLE public.scada_telemetry ADD COLUMN IF NOT EXISTS node_label TEXT;
ALTER TABLE public.scada_telemetry ADD COLUMN IF NOT EXISTS pressure_bar NUMERIC DEFAULT 0;
ALTER TABLE public.scada_telemetry ADD COLUMN IF NOT EXISTS pressure_m NUMERIC DEFAULT 0;
ALTER TABLE public.scada_telemetry ADD COLUMN IF NOT EXISTS confidence NUMERIC DEFAULT 1.0;
ALTER TABLE public.scada_telemetry ADD COLUMN IF NOT EXISTS officer_name TEXT DEFAULT 'Petugas Lapangan PDAM';
ALTER TABLE public.scada_telemetry ADD COLUMN IF NOT EXISTS gauge_type TEXT DEFAULT 'manual';
ALTER TABLE public.scada_telemetry ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.scada_telemetry ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 3. Atur Keamanan Akses (Row Level Security) untuk Anon & Authenticated
ALTER TABLE public.scada_telemetry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public full access for scada_telemetry" ON public.scada_telemetry;
CREATE POLICY "Public full access for scada_telemetry"
ON public.scada_telemetry
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- 4. Aktifkan Realtime Replication agar perubahan di HP langsung tersinkron di PC
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = 'scada_telemetry'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.scada_telemetry;
    END IF;
END $$;

-- 5. Set REPLICA IDENTITY FULL agar payload event realtime mengirim data utuh
ALTER TABLE public.scada_telemetry REPLICA IDENTITY FULL;
