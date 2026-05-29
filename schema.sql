-- ============================================================
--  PRODE MUNDIAL 2026 — Glofy × Don Gestión
--  Ejecutar en: supabase.com → SQL Editor → New query
-- ============================================================

-- 1. TABLA DE PARTIDOS (fixture oficial)
CREATE TABLE IF NOT EXISTS partidos (
  id              TEXT PRIMARY KEY,          -- ej: 'arg-alg'
  api_fixture_id  INTEGER,                   -- ID en API-Football (para auto-sync)
  grupo           TEXT NOT NULL,             -- 'A', 'B', ... 'J'
  home            TEXT NOT NULL,
  away            TEXT NOT NULL,
  fecha_utc       TIMESTAMPTZ NOT NULL,
  sede            TEXT,
  ciudad          TEXT,
  es_argentina    BOOLEAN DEFAULT FALSE,
  fase            TEXT DEFAULT 'grupos',     -- 'grupos', 'octavos', 'cuartos', 'semi', 'final'
  bonus_arg       BOOLEAN DEFAULT FALSE,     -- multiplicador x2 para Argentina en eliminatoria
  -- Resultados (null hasta que se juegue)
  goles_home      INTEGER,
  goles_away      INTEGER,
  estado          TEXT DEFAULT 'pendiente',  -- 'pendiente', 'en_curso', 'finalizado'
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABLA DE PARTICIPANTES
CREATE TABLE IF NOT EXISTS participantes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          TEXT NOT NULL,
  empresa         TEXT NOT NULL CHECK (empresa IN ('Glofy', 'Don Gestión')),
  area            TEXT,
  -- Estadísticas calculadas (se actualizan con trigger)
  puntos_total    INTEGER DEFAULT 0,
  exactos         INTEGER DEFAULT 0,
  ganador_ok      INTEGER DEFAULT 0,
  jugados         INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABLA DE PREDICCIONES
CREATE TABLE IF NOT EXISTS predicciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participante_id UUID NOT NULL REFERENCES participantes(id) ON DELETE CASCADE,
  partido_id      TEXT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  goles_home      INTEGER NOT NULL CHECK (goles_home >= 0 AND goles_home <= 20),
  goles_away      INTEGER NOT NULL CHECK (goles_away >= 0 AND goles_away <= 20),
  -- Resultado del scoring (null hasta que finalice el partido)
  puntos          INTEGER,
  es_exacto       BOOLEAN,
  acerto_ganador  BOOLEAN,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(participante_id, partido_id)          -- 1 predicción por partido por persona
);

-- 4. ÍNDICES para performance
CREATE INDEX IF NOT EXISTS idx_predicciones_participante ON predicciones(participante_id);
CREATE INDEX IF NOT EXISTS idx_predicciones_partido ON predicciones(partido_id);
CREATE INDEX IF NOT EXISTS idx_partidos_fecha ON partidos(fecha_utc);
CREATE INDEX IF NOT EXISTS idx_partidos_grupo ON partidos(grupo);

-- 5. ROW LEVEL SECURITY (Supabase)
ALTER TABLE partidos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE participantes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE predicciones   ENABLE ROW LEVEL SECURITY;

-- Partidos: lectura pública (todos pueden ver el fixture y resultados)
CREATE POLICY "partidos_public_read" ON partidos
  FOR SELECT USING (true);

-- Partidos: escritura solo con service_role (GitHub Actions / admin)
CREATE POLICY "partidos_service_write" ON partidos
  FOR ALL USING (auth.role() = 'service_role');

-- Participantes: lectura pública (tabla de posiciones)
CREATE POLICY "participantes_public_read" ON participantes
  FOR SELECT USING (true);

-- Participantes: cualquiera puede registrarse (INSERT)
CREATE POLICY "participantes_public_insert" ON participantes
  FOR INSERT WITH CHECK (true);

-- Predicciones: lectura pública (para mostrar prodes de todos)
CREATE POLICY "predicciones_public_read" ON predicciones
  FOR SELECT USING (true);

-- Predicciones: cualquiera puede insertar la suya
CREATE POLICY "predicciones_public_insert" ON predicciones
  FOR INSERT WITH CHECK (true);

-- Predicciones: solo se puede editar si el partido todavía no empezó
-- (control adicional en frontend; aquí bloqueamos edición directa)
CREATE POLICY "predicciones_no_update" ON predicciones
  FOR UPDATE USING (false);

-- 6. FUNCIÓN: calcular puntos de una predicción
CREATE OR REPLACE FUNCTION calcular_puntos(
  pred_home INTEGER, pred_away INTEGER,
  real_home INTEGER, real_away INTEGER,
  bonus BOOLEAN DEFAULT FALSE
) RETURNS INTEGER AS $$
DECLARE
  pts INTEGER := 0;
  multiplicador INTEGER := 1;
BEGIN
  IF real_home IS NULL OR real_away IS NULL THEN
    RETURN NULL; -- partido no jugado aún
  END IF;

  IF bonus THEN multiplicador := 2; END IF;

  -- Resultado exacto: 3 puntos
  IF pred_home = real_home AND pred_away = real_away THEN
    pts := 3;
  -- Ganador/empate correcto: 1 punto
  ELSIF (pred_home > pred_away AND real_home > real_away) OR
        (pred_home < pred_away AND real_home < real_away) OR
        (pred_home = pred_away AND real_home = real_away) THEN
    pts := 1;
  END IF;

  RETURN pts * multiplicador;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 7. FUNCIÓN: actualizar puntos cuando llega un resultado
CREATE OR REPLACE FUNCTION actualizar_puntos_partido(partido_id_param TEXT)
RETURNS void AS $$
DECLARE
  p partidos%ROWTYPE;
  pred predicciones%ROWTYPE;
  pts INTEGER;
  exacto BOOLEAN;
  gano BOOLEAN;
BEGIN
  SELECT * INTO p FROM partidos WHERE id = partido_id_param;

  IF p.estado != 'finalizado' THEN RETURN; END IF;

  FOR pred IN SELECT * FROM predicciones WHERE partido_id = partido_id_param LOOP
    pts := calcular_puntos(
      pred.goles_home, pred.goles_away,
      p.goles_home, p.goles_away,
      p.bonus_arg
    );
    exacto := (pred.goles_home = p.goles_home AND pred.goles_away = p.goles_away);
    gano   := pts > 0 AND NOT exacto;

    UPDATE predicciones SET
      puntos = pts,
      es_exacto = exacto,
      acerto_ganador = gano,
      updated_at = NOW()
    WHERE id = pred.id;
  END LOOP;

  -- Recalcular totales de cada participante
  UPDATE participantes par SET
    puntos_total  = COALESCE((SELECT SUM(puntos)  FROM predicciones WHERE participante_id = par.id AND puntos IS NOT NULL), 0),
    exactos       = COALESCE((SELECT COUNT(*) FROM predicciones WHERE participante_id = par.id AND es_exacto = true), 0),
    ganador_ok    = COALESCE((SELECT COUNT(*) FROM predicciones WHERE participante_id = par.id AND acerto_ganador = true), 0),
    jugados       = COALESCE((SELECT COUNT(*) FROM predicciones WHERE participante_id = par.id AND puntos IS NOT NULL), 0),
    updated_at    = NOW();
END;
$$ LANGUAGE plpgsql;

-- 8. FIXTURE INICIAL — Partidos de Argentina (Grupo J)
-- Los IDs de api_fixture_id se actualizarán con la GitHub Action al inicio del torneo
INSERT INTO partidos (id, grupo, home, away, fecha_utc, sede, ciudad, es_argentina, fase) VALUES
  ('arg-alg', 'J', 'Argentina', 'Argelia',  '2026-06-17 01:00:00+00', 'Arrowhead Stadium', 'Kansas City', TRUE, 'grupos'),
  ('aut-jor', 'J', 'Austria',   'Jordania', '2026-06-16 21:00:00+00', 'AT&T Stadium',      'Dallas',       FALSE, 'grupos'),
  ('arg-aut', 'J', 'Argentina', 'Austria',  '2026-06-22 17:00:00+00', 'AT&T Stadium',      'Dallas',       TRUE,  'grupos'),
  ('alg-jor', 'J', 'Argelia',   'Jordania', '2026-06-22 21:00:00+00', 'Arrowhead Stadium', 'Kansas City',  FALSE, 'grupos'),
  ('arg-jor', 'J', 'Argentina', 'Jordania', '2026-06-28 02:00:00+00', 'AT&T Stadium',      'Dallas',       TRUE,  'grupos'),
  ('aut-alg', 'J', 'Austria',   'Argelia',  '2026-06-28 02:00:00+00', 'Arrowhead Stadium', 'Kansas City',  FALSE, 'grupos')
ON CONFLICT (id) DO NOTHING;

-- Otros partidos destacados
INSERT INTO partidos (id, grupo, home, away, fecha_utc, sede, ciudad, es_argentina, fase) VALUES
  ('mex-sud', 'A', 'México',        'Sudáfrica',      '2026-06-11 22:00:00+00', 'Estadio Azteca',       'Ciudad de México', FALSE, 'grupos'),
  ('che-pol', 'A', 'Rep. Checa',    'Polonia',         '2026-06-12 03:00:00+00', 'Rose Bowl',            'Los Ángeles',       FALSE, 'grupos'),
  ('can-bos', 'B', 'Canadá',        'Bosnia',          '2026-06-12 22:00:00+00', 'BMO Field',            'Toronto',           FALSE, 'grupos'),
  ('sui-qat', 'B', 'Suiza',         'Qatar',           '2026-06-13 02:00:00+00', 'BC Place',             'Vancouver',         FALSE, 'grupos'),
  ('bra-mar', 'C', 'Brasil',        'Marruecos',       '2026-06-14 02:00:00+00', 'MetLife Stadium',      'Nueva York',        FALSE, 'grupos'),
  ('par-aus', 'C', 'Paraguay',      'Australia',       '2026-06-14 21:00:00+00', 'NRG Stadium',          'Houston',           FALSE, 'grupos'),
  ('usa-par', 'D', 'EE.UU.',        'Paraguay',        '2026-06-15 02:00:00+00', 'Gillette Stadium',     'Boston',            FALSE, 'grupos'),
  ('tur-aus', 'D', 'Turquía',       'Australia',       '2026-06-15 21:00:00+00', 'Rose Bowl',            'Los Ángeles',       FALSE, 'grupos'),
  ('ned-jap', 'F', 'Países Bajos',  'Japón',           '2026-06-15 19:00:00+00', 'Levi''s Stadium',      'San Francisco',     FALSE, 'grupos'),
  ('sue-tun', 'F', 'Suecia',        'Túnez',           '2026-06-15 00:00:00+00', 'Estadio GNP',          'Guadalajara',       FALSE, 'grupos')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- ¡Listo! Ahora ir a js/config.js y completar las credenciales
-- ============================================================
