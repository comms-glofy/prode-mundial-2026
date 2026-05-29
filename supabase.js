// ============================================================
//  supabase.js — Cliente de base de datos
// ============================================================

// Usamos la librería oficial de Supabase (cargada via CDN en index.html)
let _supabase = null;

function getSupabase() {
  if (!_supabase) {
    _supabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
  return _supabase;
}

// ── PARTICIPANTES ──────────────────────────────────────────

async function registrarParticipante(nombre, empresa, area = '') {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('participantes')
    .insert({ nombre, empresa, area })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getParticipante(id) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('participantes')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

// ── TABLA DE POSICIONES ────────────────────────────────────

async function getTabla() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('participantes')
    .select('*')
    .order('puntos_total', { ascending: false })
    .order('exactos', { ascending: false })
    .order('ganador_ok', { ascending: false });
  if (error) throw error;
  return data;
}

// ── PARTIDOS ───────────────────────────────────────────────

async function getPartidos(fase = null) {
  const sb = getSupabase();
  let query = sb
    .from('partidos')
    .select('*')
    .order('fecha_utc', { ascending: true });
  if (fase) query = query.eq('fase', fase);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function getPartido(id) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('partidos')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

// ── PREDICCIONES ───────────────────────────────────────────

async function guardarPrediccion(participanteId, partidoId, golesHome, golesAway) {
  const sb = getSupabase();

  // Verificar que el partido no haya empezado
  const partido = await getPartido(partidoId);
  const ahora = new Date();
  const fechaPartido = new Date(partido.fecha_utc);

  if (ahora >= fechaPartido) {
    throw new Error('Las predicciones para este partido ya están cerradas.');
  }

  const { data, error } = await sb
    .from('predicciones')
    .insert({
      participante_id: participanteId,
      partido_id: partidoId,
      goles_home: golesHome,
      goles_away: golesAway,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getMisPredicciones(participanteId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('predicciones')
    .select(`
      *,
      partidos (
        id, home, away, fecha_utc, grupo, es_argentina,
        goles_home, goles_away, estado
      )
    `)
    .eq('participante_id', participanteId)
    .order('partidos(fecha_utc)', { ascending: true });
  if (error) throw error;
  return data;
}

async function getPrediccionesPartido(partidoId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('predicciones')
    .select(`
      *,
      participantes (nombre, empresa)
    `)
    .eq('partido_id', partidoId)
    .order('puntos', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data;
}

// ── SUSCRIPCIÓN REALTIME (tabla en vivo) ───────────────────

function suscribirTabla(callback) {
  const sb = getSupabase();
  return sb
    .channel('tabla-posiciones')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'participantes'
    }, callback)
    .subscribe();
}

function suscribirResultados(callback) {
  const sb = getSupabase();
  return sb
    .channel('resultados-live')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'partidos'
    }, callback)
    .subscribe();
}
