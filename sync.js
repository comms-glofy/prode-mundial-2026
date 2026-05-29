// ============================================================
//  scripts/sync.js
//  Script de Node.js para GitHub Actions
//  Sincroniza resultados de API-Football → Supabase
//  Ejecutado por: .github/workflows/update-results.yml
// ============================================================

const { createClient } = require('@supabase/supabase-js');

// Credenciales desde GitHub Secrets (variables de entorno)
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role key (no anon)
const RAPIDAPI_KEY      = process.env.RAPIDAPI_KEY;
const ACTION            = process.env.ACTION || 'sync_resultados';

// Config Mundial
const WORLD_CUP_ID      = 1;
const WORLD_CUP_SEASON  = 2026;
const API_BASE          = 'https://api-football-v1.p.rapidapi.com/v3';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en los secrets de GitHub.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Mapeo de nombres de equipos ────────────────────────────
const TEAM_MAP = {
  'Argentina': 'Argentina', 'Algeria': 'Argelia', 'Austria': 'Austria',
  'Jordan': 'Jordania', 'Mexico': 'México', 'South Africa': 'Sudáfrica',
  'Czech Republic': 'Rep. Checa', 'Poland': 'Polonia', 'Canada': 'Canadá',
  'Bosnia': 'Bosnia', 'Switzerland': 'Suiza', 'Qatar': 'Qatar',
  'Brazil': 'Brasil', 'Morocco': 'Marruecos', 'Paraguay': 'Paraguay',
  'Australia': 'Australia', 'USA': 'EE.UU.', 'United States': 'EE.UU.',
  'Turkey': 'Turquía', 'Netherlands': 'Países Bajos', 'Japan': 'Japón',
  'Sweden': 'Suecia', 'Tunisia': 'Túnez', 'Germany': 'Alemania',
  'Uruguay': 'Uruguay', 'Colombia': 'Colombia', 'France': 'Francia',
  'Belgium': 'Bélgica', 'Spain': 'España', 'Portugal': 'Portugal',
  'Ivory Coast': 'Costa de Marfil', "Côte d'Ivoire": 'Costa de Marfil',
};

// ── API-Football ───────────────────────────────────────────
async function fetchFixtures() {
  const url = `${API_BASE}/fixtures?league=${WORLD_CUP_ID}&season=${WORLD_CUP_SEASON}`;
  const response = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': RAPIDAPI_KEY,
      'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com',
    }
  });
  if (!response.ok) throw new Error(`API-Football HTTP ${response.status}`);
  const json = await response.json();
  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`API-Football error: ${JSON.stringify(json.errors)}`);
  }
  return json.response || [];
}

// ── Calcular puntos (idéntico al SQL) ─────────────────────
function calcularPuntos(predHome, predAway, realHome, realAway, bonus = false) {
  if (realHome === null || realAway === null) return null;
  let pts = 0;
  if (predHome === realHome && predAway === realAway) {
    pts = 3;
  } else if (
    (predHome > predAway && realHome > realAway) ||
    (predHome < predAway && realHome < realAway) ||
    (predHome === predAway && realHome === realAway)
  ) {
    pts = 1;
  }
  return pts * (bonus ? 2 : 1);
}

// ── Sync IDs del fixture ───────────────────────────────────
async function syncFixtureIds() {
  console.log('🔄 Sincronizando IDs del fixture con API-Football...');
  const fixtures = await fetchFixtures();
  console.log(`📦 ${fixtures.length} fixtures recibidos de la API.`);

  const { data: partidos } = await sb.from('partidos').select('id, home, away');
  let mapeados = 0;

  for (const fixture of fixtures) {
    const { fixture: f, teams } = fixture;
    const apiHome = TEAM_MAP[teams.home.name] || teams.home.name;
    const apiAway = TEAM_MAP[teams.away.name] || teams.away.name;

    const partido = partidos?.find(p =>
      p.home.toLowerCase().includes(apiHome.toLowerCase()) ||
      apiHome.toLowerCase().includes(p.home.toLowerCase())
    );

    if (partido) {
      await sb.from('partidos').update({ api_fixture_id: f.id }).eq('id', partido.id);
      console.log(`  ✅ ${f.id} → ${partido.id} (${apiHome} vs ${apiAway})`);
      mapeados++;
    }
  }

  console.log(`✅ ${mapeados} partidos mapeados.`);
}

// ── Sync resultados ────────────────────────────────────────
async function syncResultados() {
  console.log('⚡ Sincronizando resultados...');

  const fixtures = await fetchFixtures();
  const fixtureMap = {};
  for (const f of fixtures) fixtureMap[f.fixture.id] = f;

  const { data: partidos } = await sb
    .from('partidos')
    .select('*')
    .not('api_fixture_id', 'is', null)
    .neq('estado', 'finalizado');

  if (!partidos || partidos.length === 0) {
    console.log('✅ No hay partidos pendientes de actualizar.');
    return;
  }

  let actualizados = 0;
  let puntosCalculados = 0;

  for (const partido of partidos) {
    const apiFixture = fixtureMap[partido.api_fixture_id];
    if (!apiFixture) {
      console.log(`  ⚠️ No encontrado en API: ${partido.id} (api_id: ${partido.api_fixture_id})`);
      continue;
    }

    const { fixture: f, goals } = apiFixture;
    const statusShort = f.status.short;

    let nuevoEstado = 'pendiente';
    if (['1H','HT','2H','ET','BT','P','INT'].includes(statusShort)) nuevoEstado = 'en_curso';
    else if (['FT','AET','PEN'].includes(statusShort)) nuevoEstado = 'finalizado';

    if (nuevoEstado === 'pendiente' && partido.estado === 'pendiente') continue;

    const updateData = { estado: nuevoEstado, updated_at: new Date().toISOString() };
    if (nuevoEstado !== 'pendiente' && goals.home !== null) {
      updateData.goles_home = goals.home;
      updateData.goles_away = goals.away;
    }

    const { error } = await sb.from('partidos').update(updateData).eq('id', partido.id);
    if (error) { console.error(`  ❌ Error actualizando ${partido.id}:`, error); continue; }

    actualizados++;
    console.log(`  📊 ${partido.id}: ${goals.home ?? '?'}-${goals.away ?? '?'} [${nuevoEstado}]`);

    // Calcular puntos si finalizó
    if (nuevoEstado === 'finalizado' && goals.home !== null) {
      const { data: predicciones } = await sb
        .from('predicciones')
        .select('*')
        .eq('partido_id', partido.id);

      for (const pred of (predicciones || [])) {
        const pts = calcularPuntos(
          pred.goles_home, pred.goles_away,
          goals.home, goals.away,
          partido.bonus_arg
        );
        const esExacto = pred.goles_home === goals.home && pred.goles_away === goals.away;
        const acertoGanador = pts > 0 && !esExacto;

        await sb.from('predicciones').update({
          puntos: pts,
          es_exacto: esExacto,
          acerto_ganador: acertoGanador,
          updated_at: new Date().toISOString(),
        }).eq('id', pred.id);

        puntosCalculados++;
      }

      // Recalcular totales de todos los participantes afectados
      const participanteIds = [...new Set(predicciones?.map(p => p.participante_id) || [])];
      for (const pid of participanteIds) {
        const { data: allPreds } = await sb
          .from('predicciones')
          .select('puntos, es_exacto, acerto_ganador')
          .eq('participante_id', pid)
          .not('puntos', 'is', null);

        const totales = (allPreds || []).reduce((acc, p) => ({
          puntos_total: acc.puntos_total + (p.puntos || 0),
          exactos: acc.exactos + (p.es_exacto ? 1 : 0),
          ganador_ok: acc.ganador_ok + (p.acerto_ganador ? 1 : 0),
          jugados: acc.jugados + 1,
        }), { puntos_total: 0, exactos: 0, ganador_ok: 0, jugados: 0 });

        await sb.from('participantes').update({
          ...totales,
          updated_at: new Date().toISOString(),
        }).eq('id', pid);
      }

      console.log(`  🎯 Puntos calculados para ${puntosCalculados} predicciones de ${partido.id}`);
    }
  }

  console.log(`\n✅ Sync completado: ${actualizados} partido(s) actualizado(s), ${puntosCalculados} predicciones puntuadas.`);
}

// ── Main ───────────────────────────────────────────────────
(async () => {
  console.log(`🏆 Prode Mundial 2026 — Sync Script`);
  console.log(`📅 ${new Date().toISOString()}`);
  console.log(`🎯 Acción: ${ACTION}\n`);

  try {
    if (ACTION === 'sync_fixture_ids') {
      await syncFixtureIds();
    } else {
      await syncResultados();
    }
    console.log('\n🏁 Script finalizado exitosamente.');
    process.exit(0);
  } catch (e) {
    console.error('\n❌ Error fatal:', e.message);
    process.exit(1);
  }
})();
