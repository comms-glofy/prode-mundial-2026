// ============================================================
//  api-football.js — Resultados automáticos via API-Football
//  RapidAPI plan gratuito: 100 requests/día
//  Documentación: https://www.api-football.com/documentation-v3
// ============================================================

const API_BASE = 'https://api-football-v1.p.rapidapi.com/v3';

const API_HEADERS = {
  'X-RapidAPI-Key': CONFIG.RAPIDAPI_KEY,
  'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
};

// ── Mapeo IDs API-Football → nuestros IDs internos ─────────
// Esta tabla se completa automáticamente la primera vez que corremos sync
const FIXTURE_MAP = {
  // Formato: api_fixture_id: nuestro_partido_id
  // Ejemplo: 1001: 'arg-alg'
  // Se auto-popula con syncFixtureIds()
};

// ── Obtener todos los fixtures del Mundial 2026 ─────────────
async function fetchFixtures() {
  const url = `${API_BASE}/fixtures?league=${CONFIG.WORLD_CUP_ID}&season=${CONFIG.WORLD_CUP_SEASON}`;
  const response = await fetch(url, { headers: API_HEADERS });
  if (!response.ok) throw new Error(`API-Football error: ${response.status}`);
  const json = await response.json();
  return json.response;
}

// ── Sincronizar IDs de API-Football con nuestra BD ─────────
// Corre una vez al inicio del torneo para mapear los IDs
async function syncFixtureIds() {
  console.log('[API-Football] Sincronizando IDs de fixtures...');
  const fixtures = await fetchFixtures();
  const sb = getSupabase();

  for (const fixture of fixtures) {
    const { fixture: f, teams, league } = fixture;
    const homeTeam = normalizeTeamName(teams.home.name);
    const awayTeam = normalizeTeamName(teams.away.name);

    // Buscar el partido en nuestra BD por nombres de equipos
    const { data: partidos } = await sb
      .from('partidos')
      .select('id')
      .ilike('home', `%${homeTeam}%`)
      .ilike('away', `%${awayTeam}%`)
      .limit(1);

    if (partidos && partidos.length > 0) {
      const nuestroId = partidos[0].id;
      // Guardar el api_fixture_id
      await sb
        .from('partidos')
        .update({ api_fixture_id: f.id })
        .eq('id', nuestroId);
      console.log(`[API-Football] Mapeado: ${f.id} → ${nuestroId}`);
    }
  }
  console.log('[API-Football] Sincronización completada.');
}

// ── Obtener y guardar resultados de partidos jugados ────────
async function syncResultados() {
  console.log('[API-Football] Actualizando resultados...');
  const sb = getSupabase();

  // Solo partidos que tienen api_fixture_id y no están finalizados aún
  const { data: partidos } = await sb
    .from('partidos')
    .select('id, api_fixture_id, estado')
    .not('api_fixture_id', 'is', null)
    .neq('estado', 'finalizado');

  if (!partidos || partidos.length === 0) {
    console.log('[API-Football] No hay partidos pendientes de sincronizar.');
    return;
  }

  // Traer fixtures de la API
  const fixtures = await fetchFixtures();
  const fixtureMap = {};
  for (const f of fixtures) {
    fixtureMap[f.fixture.id] = f;
  }

  let actualizados = 0;
  for (const partido of partidos) {
    const apiFixture = fixtureMap[partido.api_fixture_id];
    if (!apiFixture) continue;

    const { fixture, goals, score } = apiFixture;
    const statusShort = fixture.status.short;

    // Estados de la API: NS=no started, 1H/HT/2H=en curso, FT=finalizado, AET/PEN=prórroga/penales
    let nuevoEstado = 'pendiente';
    if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT'].includes(statusShort)) {
      nuevoEstado = 'en_curso';
    } else if (['FT', 'AET', 'PEN'].includes(statusShort)) {
      nuevoEstado = 'finalizado';
    }

    // Solo actualizar si hay cambios relevantes
    if (nuevoEstado === 'pendiente' && partido.estado === 'pendiente') continue;

    const updateData = {
      estado: nuevoEstado,
      updated_at: new Date().toISOString(),
    };

    // Para partidos en curso o finalizados, guardar el marcador
    if (nuevoEstado !== 'pendiente' && goals.home !== null) {
      updateData.goles_home = goals.home;
      updateData.goles_away = goals.away;
    }

    await sb.from('partidos').update(updateData).eq('id', partido.id);

    // Si finalizó, disparar el cálculo de puntos via RPC
    if (nuevoEstado === 'finalizado') {
      await sb.rpc('actualizar_puntos_partido', { partido_id_param: partido.id });
      console.log(`[API-Football] Partido finalizado y puntos calculados: ${partido.id} ${goals.home}-${goals.away}`);
    } else if (nuevoEstado === 'en_curso') {
      console.log(`[API-Football] En curso: ${partido.id} ${goals.home ?? 0}-${goals.away ?? 0}`);
    }

    actualizados++;
  }

  console.log(`[API-Football] ${actualizados} partidos actualizados.`);
  return actualizados;
}

// ── Auto-update en el frontend (cuando hay partido en curso) ─
let autoUpdateInterval = null;

async function iniciarAutoUpdate() {
  if (!CONFIG.AUTO_UPDATE) return;
  if (CONFIG.RAPIDAPI_KEY === 'TU_RAPIDAPI_KEY_AQUI') return; // No configurado aún

  const ahora = new Date();
  const sb = getSupabase();

  // Verificar si hay algún partido en curso o próximo en las próximas 2 horas
  const en2horas = new Date(ahora.getTime() + 2 * 60 * 60 * 1000);
  const { data: proximos } = await sb
    .from('partidos')
    .select('id')
    .or(`estado.eq.en_curso,and(estado.eq.pendiente,fecha_utc.lte.${en2horas.toISOString()})`)
    .limit(1);

  if (proximos && proximos.length > 0) {
    console.log('[AutoUpdate] Partido próximo o en curso, activando polling cada 5 min...');
    if (autoUpdateInterval) clearInterval(autoUpdateInterval);
    autoUpdateInterval = setInterval(syncResultados, CONFIG.UPDATE_INTERVAL_MS);
    await syncResultados(); // Primera consulta inmediata
  }
}

function detenerAutoUpdate() {
  if (autoUpdateInterval) {
    clearInterval(autoUpdateInterval);
    autoUpdateInterval = null;
  }
}

// ── Normalizar nombres de equipos ──────────────────────────
function normalizeTeamName(name) {
  const MAP = {
    'Argentina': 'Argentina',
    'Algeria': 'Argelia',
    'Austria': 'Austria',
    'Jordan': 'Jordania',
    'Mexico': 'México',
    'South Africa': 'Sudáfrica',
    'Czech Republic': 'Rep. Checa',
    'Poland': 'Polonia',
    'Canada': 'Canadá',
    'Bosnia': 'Bosnia',
    'Switzerland': 'Suiza',
    'Qatar': 'Qatar',
    'Brazil': 'Brasil',
    'Morocco': 'Marruecos',
    'Paraguay': 'Paraguay',
    'Australia': 'Australia',
    'USA': 'EE.UU.',
    'United States': 'EE.UU.',
    'Turkey': 'Turquía',
    'Netherlands': 'Países Bajos',
    'Japan': 'Japón',
    'Sweden': 'Suecia',
    'Tunisia': 'Túnez',
    'Germany': 'Alemania',
    'Uruguay': 'Uruguay',
    'Colombia': 'Colombia',
    'France': 'Francia',
    'Belgium': 'Bélgica',
    'Spain': 'España',
    'Portugal': 'Portugal',
  };
  return MAP[name] || name;
}
