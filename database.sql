-- Database Schema for Supabase

-- 1. Table des messages (Sert pour l'historique du chat)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  session_id UUID -- Permet de séparer les différentes conversations
);

-- 2. Table des rendez-vous (Sert pour l'agenda)
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_name TEXT NOT NULL,
  reason TEXT,
  appointment_date TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'confirmed'
);

-- 3. Table des résumés (Sert pour le docteur)
CREATE TABLE IF NOT EXISTS summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  session_id UUID -- Permet de lier le résumé à sa conversation
);

-- Permissions de base pour permettre l'écriture/lecture anonyme 
-- Note: À affiner pour la production
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anonymous" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anonymous" ON appointments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anonymous" ON summaries FOR ALL USING (true) WITH CHECK (true);
