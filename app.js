// ============================================================
//  app.js — Lógica principal de la aplicación
// ============================================================

// ── Estado global ──────────────────────────────────────────
const APP = {
  participanteId: localStorage.getItem('prode_participante_id'),
  participante: null,
  partidos: [],
  predicciones: {},  // partidoId → prediccion guardada
  tablaData: [],
  seccionActiva: 'fixture',
};

// ── Inicialización ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  iniciarCountdown();
  await cargarPartidos();
  renderFixture();
  renderProde();

  if (APP.participanteId) {
    await cargarMisDatos();
  }

  cargarTabla();

  // Suscripción realtime: tabla se actualiza sola
  suscribirTabla(() => cargarTabla());
  suscribirResultados(payload => {
    // Actualizar el partido en el estado local
    const idx = APP.partidos.findIndex(p => p.id === payload.new.id);
    if (idx !== -1) APP.partidos[idx] = { ...APP.partidos[idx], ...payload.new };
    renderFixture();
    renderProde();
  });

  // Auto-update de resultados (si hay partido en curso)
  iniciarAutoUpdate();
});

// ── Countdown ──────────────────────────────────────────────
function iniciarCountdown() {
  function tick() {
    const diff = CONFIG.MUNDIAL_START - new Date();
    if (diff <= 0) {
      setCountdown(0, 0, 0, 0);
      return;
    }
    setCountdown(
      Math.floor(diff / 86400000),
      Math.floor((diff % 86400000) / 3600000),
      Math.floor((diff % 3600000) / 60000),
      Math.floor((diff % 60000) / 1000)
    );
  }
  tick();
  setInterval(tick, 1000);
}

function setCountdown(d, h, m, s) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val).padStart(2, '0');
  };
  set('cd-dias', d); set('cd-hrs', h); set('cd-min', m); set('cd-seg', s);
}

// ── Carga de datos ─────────────────────────────────────────
async function cargarPartidos() {
  try {
    APP.partidos = await getPartidos();
  } catch (e) {
    console.warn('Usando fixture local (Supabase no configurado):', e.message);
    APP.partidos = FIXTURE_LOCAL;
  }
}

async function cargarMisDatos() {
  try {
    APP.participante = await getParticipante(APP.participanteId);
    const preds = await getMisPredicciones(APP.participanteId);
    APP.predicciones = {};
    preds.forEach(p => { APP.predicciones[p.partido_id] = p; });
    actualizarUIParticipante();
  } catch (e) {
    console.warn('Error cargando datos del participante:', e);
    // Si el ID guardado ya no existe, limpiar
    localStorage.removeItem('prode_participante_id');
    APP.participanteId = null;
  }
}

async function cargarTabla() {
  try {
    APP.tablaData = await getTabla();
    renderTabla();
  } catch (e) {
    console.warn('Tabla no disponible:', e.message);
    renderTablaDemo();
  }
}

// ── Navegación ─────────────────────────────────────────────
function showSection(nombre, btn) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const sec = document.getElementById('sec-' + nombre);
  if (sec) sec.classList.add('active');
  if (btn) btn.classList.add('active');
  APP.seccionActiva = nombre;
}

// ── Registro de participante ───────────────────────────────
function mostrarModalRegistro() {
  document.getElementById('modal-registro').classList.add('show');
}

function cerrarModalRegistro() {
  document.getElementById('modal-registro').classList.remove('show');
}

async function handleRegistro() {
  const nombre = document.getElementById('reg-nombre').value.trim();
  const empresa = document.getElementById('reg-empresa').value;
  const area = document.getElementById('reg-area').value.trim();
  const errorEl = document.getElementById('reg-error');

  if (!nombre) { errorEl.textContent = 'Por favor ingresá tu nombre.'; return; }
  if (!empresa) { errorEl.textContent = 'Seleccioná tu empresa.'; return; }

  errorEl.textContent = '';
  const btn = document.getElementById('btn-registrar');
  btn.textContent = 'Registrando...';
  btn.disabled = true;

  try {
    const p = await registrarParticipante(nombre, empresa, area);
    APP.participanteId = p.id;
    APP.participante = p;
    localStorage.setItem('prode_participante_id', p.id);
    cerrarModalRegistro();
    actualizarUIParticipante();
    renderProde();
  } catch (e) {
    errorEl.textContent = 'Error al registrar. Intentá de nuevo.';
    console.error(e);
  } finally {
    btn.textContent = 'Registrarme';
    btn.disabled = false;
  }
}

function actualizarUIParticipante() {
  if (!APP.participante) return;
  const el = document.getElementById('user-info');
  if (el) {
    el.innerHTML = `
      <span class="user-nombre">${APP.participante.nombre}</span>
      <span class="user-empresa">${APP.participante.empresa}</span>
    `;
  }
  // Mostrar puntos si ya jugó
  const pts = APP.participante.puntos_total || 0;
  const ptsEl = document.getElementById('mis-puntos');
  if (ptsEl) ptsEl.textContent = pts;
}

// ── Guardar predicciones ───────────────────────────────────
async function guardarTodasLasPredicciones() {
  if (!APP.participanteId) {
    mostrarModalRegistro();
    return;
  }

  const btn = document.getElementById('btn-guardar-prode');
  btn.textContent = 'Guardando...';
  btn.disabled = true;

  let guardados = 0;
  let errores = 0;

  for (const partido of APP.partidos) {
    const homeInput = document.getElementById(`home-${partido.id}`);
    const awayInput = document.getElementById(`away-${partido.id}`);

    if (!homeInput || !awayInput) continue;

    const homeVal = homeInput.value;
    const awayVal = awayInput.value;

    // Solo guardar si se completaron ambos campos
    if (homeVal === '' || awayVal === '') continue;

    // No guardar si ya existe predicción para este partido
    if (APP.predicciones[partido.id]) continue;

    try {
      const pred = await guardarPrediccion(
        APP.participanteId,
        partido.id,
        parseInt(homeVal),
        parseInt(awayVal)
      );
      APP.predicciones[partido.id] = pred;
      guardados++;
    } catch (e) {
      if (e.message.includes('cerradas')) {
        // Partido ya empezó, deshabilitar input
        homeInput.disabled = true;
        awayInput.disabled = true;
      } else {
        errores++;
        console.error(`Error guardando ${partido.id}:`, e);
      }
    }
  }

  btn.disabled = false;

  if (guardados > 0) {
    btn.textContent = `✅ ${guardados} prediccion${guardados > 1 ? 'es' : ''} guardada${guardados > 1 ? 's' : ''}`;
    document.getElementById('success-msg').classList.add('show');
    setTimeout(() => {
      btn.textContent = 'GUARDAR MI PRODE ⚽';
      document.getElementById('success-msg').classList.remove('show');
    }, 4000);
    renderProde(); // Actualizar UI con predicciones guardadas
  } else if (errores > 0) {
    btn.textContent = '⚠️ Hubo errores, intentá de nuevo';
    setTimeout(() => { btn.textContent = 'GUARDAR MI PRODE ⚽'; }, 3000);
  } else {
    btn.textContent = 'No hay nuevas predicciones para guardar';
    setTimeout(() => { btn.textContent = 'GUARDAR MI PRODE ⚽'; }, 3000);
  }
}

// ── Render: Fixture ────────────────────────────────────────
function renderFixture() {
  const container = document.getElementById('fixture-container');
  if (!container) return;

  // Agrupar partidos
  const grupos = {};
  for (const p of APP.partidos) {
    if (!grupos[p.grupo]) grupos[p.grupo] = [];
    grupos[p.grupo].push(p);
  }

  const ordenGrupos = Object.keys(grupos).sort();

  container.innerHTML = ordenGrupos.map(grupo => {
    const partidos = grupos[grupo];
    const equipos = [...new Set(partidos.flatMap(p => [p.home, p.away]))].join(' · ');

    return `
      <div class="grupo-section">
        <div class="grupo-header">
          <div class="grupo-badge">GRUPO ${grupo}</div>
          <div class="grupo-equipos">${equipos}</div>
        </div>
        <div class="partidos-grid">
          ${partidos.map(p => renderPartidoCard(p)).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderPartidoCard(p) {
  const fecha = formatFecha(p.fecha_utc);
  const hora = formatHoraARG(p.fecha_utc);
  const esArg = p.es_argentina;
  const estado = p.estado;

  let marcador = '';
  if (estado === 'finalizado' && p.goles_home !== null) {
    marcador = `<div class="marcador-final">${p.goles_home} — ${p.goles_away}</div>`;
  } else if (estado === 'en_curso' && p.goles_home !== null) {
    marcador = `<div class="marcador-live"><span class="live-dot"></span>${p.goles_home} — ${p.goles_away} EN VIVO</div>`;
  }

  const estadoBadge = estado === 'finalizado'
    ? `<span class="estado-badge estado-fin">Finalizado</span>`
    : estado === 'en_curso'
    ? `<span class="estado-badge estado-live">EN VIVO</span>`
    : '';

  return `
    <div class="partido-card ${esArg ? 'arg' : ''} ${estado !== 'pendiente' ? 'partido-' + estado : ''}">
      <div class="partido-meta">
        <span class="partido-fecha-tag">${fecha}</span>
        <div style="display:flex;align-items:center;gap:6px">
          ${estadoBadge}
          <span class="partido-hora">${hora} hs ARG</span>
        </div>
      </div>
      ${marcador}
      <div class="partido-enfrentamiento">
        <div class="partido-equipo home">${p.home}${esArg && p.home === 'Argentina' ? ' 🇦🇷' : ''}</div>
        <div class="partido-vs">VS</div>
        <div class="partido-equipo away">${p.away}</div>
      </div>
      <div class="partido-sede">📍 ${p.sede || ''} · ${p.ciudad || ''}</div>
    </div>
  `;
}

// ── Render: Prode ──────────────────────────────────────────
function renderProde() {
  const container = document.getElementById('prode-form-container');
  if (!container) return;

  const argPartidos = APP.partidos.filter(p => p.es_argentina);
  const otrosPartidos = APP.partidos.filter(p => !p.es_argentina);

  container.innerHTML = `
    <div>
      <div class="prode-grupo-title">🇦🇷 Partidos de Argentina</div>
      ${argPartidos.map(p => renderProdeItem(p)).join('')}
    </div>
    <div>
      <div class="prode-grupo-title">⚽ Otros Partidos Destacados</div>
      ${otrosPartidos.map(p => renderProdeItem(p)).join('')}
    </div>
  `;
}

function renderProdeItem(p) {
  const pred = APP.predicciones[p.id];
  const fecha = formatFecha(p.fecha_utc);
  const hora = formatHoraARG(p.fecha_utc);
  const ahora = new Date();
  const fechaPartido = new Date(p.fecha_utc);
  const cerrado = ahora >= fechaPartido;
  const finalizado = p.estado === 'finalizado';

  // Si ya hay predicción guardada
  if (pred) {
    const pts = pred.puntos;
    const ptsLabel = pts !== null
      ? `<span class="pred-pts ${pts >= 3 ? 'pts-ok' : pts > 0 ? 'pts-parcial' : 'pts-zero'}">${pts >= 6 ? `🎯 ${pts} pts ×2` : pts === 3 ? `🎯 ${pts} pts` : pts > 0 ? `✅ ${pts} pt` : '✗ 0 pts'}</span>`
      : `<span class="pred-pts pts-pending">Pendiente</span>`;

    return `
      <div class="prode-partido-item ${p.es_argentina ? 'arg' : ''} pred-guardada">
        <div class="prode-label">
          <div class="prode-equipos">${p.home} vs ${p.away}${p.es_argentina ? ' <span class="tag-arg">ARG</span>' : ''}</div>
          <div class="prode-meta">📅 ${fecha} · ${hora} hs ARG</div>
        </div>
        <div class="pred-score-show">
          <span class="pred-marcador">${pred.goles_home} — ${pred.goles_away}</span>
          ${ptsLabel}
        </div>
      </div>
    `;
  }

  // Partido cerrado (ya empezó) sin predicción
  if (cerrado) {
    return `
      <div class="prode-partido-item ${p.es_argentina ? 'arg' : ''} pred-cerrada">
        <div class="prode-label">
          <div class="prode-equipos">${p.home} vs ${p.away}${p.es_argentina ? ' <span class="tag-arg">ARG</span>' : ''}</div>
          <div class="prode-meta">📅 ${fecha} · ${hora} hs ARG</div>
        </div>
        <div class="pred-cerrada-msg">⏰ Quiniela cerrada</div>
      </div>
    `;
  }

  // Input abierto
  return `
    <div class="prode-partido-item ${p.es_argentina ? 'arg' : ''}">
      <div class="prode-label">
        <div class="prode-equipos">${p.home} vs ${p.away}${p.es_argentina ? ' <span class="tag-arg">ARG</span>' : ''}</div>
        <div class="prode-meta">📅 ${fecha} · ${hora} hs ARG</div>
      </div>
      <div class="prode-score">
        <input class="prode-input" type="number" min="0" max="20" step="1" placeholder="0" id="home-${p.id}" />
        <span class="prode-dash">—</span>
        <input class="prode-input" type="number" min="0" max="20" step="1" placeholder="0" id="away-${p.id}" />
      </div>
    </div>
  `;
}

// ── Render: Tabla ──────────────────────────────────────────
function renderTabla() {
  const body = document.getElementById('tabla-body');
  if (!body) return;

  if (!APP.tablaData || APP.tablaData.length === 0) {
    body.innerHTML = `<div class="empty-tabla"><p>Nadie se registró todavía. ¡Sé el primero!</p></div>`;
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const premioTexts = ['$150.000', '$100.000', '$50.000'];
  const premioClasses = ['pb-gold', 'pb-silver', 'pb-bronze'];
  const podiumClasses = ['podium-1', 'podium-2', 'podium-3'];

  body.innerHTML = APP.tablaData.map((p, i) => `
    <div class="tabla-row ${i < 3 ? podiumClasses[i] : ''} ${APP.participanteId === p.id ? 'mi-fila' : ''}">
      <div class="tabla-pos ${i === 0 ? 'p1' : i === 1 ? 'p2' : i === 2 ? 'p3' : ''}">${i < 3 ? medals[i] : (i + 1)}</div>
      <div>
        <div class="tabla-nombre">${p.nombre} ${APP.participanteId === p.id ? '<span class="yo-badge">Vos</span>' : ''}</div>
        <div class="tabla-area">${p.empresa}${p.area ? ' · ' + p.area : ''}</div>
        ${i < 3 ? `<span class="premio-badge ${premioClasses[i]}">${premioTexts[i]}</span>` : ''}
      </div>
      <div class="tabla-cell">${p.exactos}</div>
      <div class="tabla-cell">${p.ganador_ok}</div>
      <div class="tabla-cell">${p.jugados}</div>
      <div class="tabla-pts">${p.puntos_total}</div>
    </div>
  `).join('');
}

function renderTablaDemo() {
  // Datos de ejemplo mientras Supabase no está configurado
  APP.tablaData = [
    { id: 'x1', nombre: 'Valentina R.', empresa: 'Glofy', area: 'RRHH', exactos: 4, ganador_ok: 7, jugados: 12, puntos_total: 19 },
    { id: 'x2', nombre: 'Tomás M.', empresa: 'Glofy', area: 'Tech', exactos: 3, ganador_ok: 8, jugados: 12, puntos_total: 17 },
    { id: 'x3', nombre: 'Sofía L.', empresa: 'Don Gestión', area: 'Operaciones', exactos: 3, ganador_ok: 7, jugados: 11, puntos_total: 16 },
    { id: 'x4', nombre: 'Martín G.', empresa: 'Don Gestión', area: 'Ventas', exactos: 2, ganador_ok: 9, jugados: 12, puntos_total: 15 },
    { id: 'x5', nombre: 'Camila P.', empresa: 'Glofy', area: 'Marketing', exactos: 2, ganador_ok: 8, jugados: 11, puntos_total: 14 },
  ];
  renderTabla();
  document.querySelector('#sec-tabla > p').textContent = '⚠️ Datos de ejemplo · Configura Supabase para activar la tabla real';
}

// ── Helpers de fecha ───────────────────────────────────────
function formatFecha(isoString) {
  const d = new Date(isoString);
  const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${dias[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]}`;
}

function formatHoraARG(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// ── Fixture local (fallback sin conexión) ──────────────────
const FIXTURE_LOCAL = [
  { id:'arg-alg', grupo:'J', home:'Argentina', away:'Argelia',  fecha_utc:'2026-06-17T01:00:00Z', sede:'Arrowhead Stadium', ciudad:'Kansas City', es_argentina:true,  estado:'pendiente', goles_home:null, goles_away:null },
  { id:'aut-jor', grupo:'J', home:'Austria',   away:'Jordania', fecha_utc:'2026-06-16T21:00:00Z', sede:'AT&T Stadium',      ciudad:'Dallas',       es_argentina:false, estado:'pendiente', goles_home:null, goles_away:null },
  { id:'arg-aut', grupo:'J', home:'Argentina', away:'Austria',  fecha_utc:'2026-06-22T17:00:00Z', sede:'AT&T Stadium',      ciudad:'Dallas',       es_argentina:true,  estado:'pendiente', goles_home:null, goles_away:null },
  { id:'alg-jor', grupo:'J', home:'Argelia',   away:'Jordania', fecha_utc:'2026-06-22T21:00:00Z', sede:'Arrowhead Stadium', ciudad:'Kansas City',  es_argentina:false, estado:'pendiente', goles_home:null, goles_away:null },
  { id:'arg-jor', grupo:'J', home:'Argentina', away:'Jordania', fecha_utc:'2026-06-28T02:00:00Z', sede:'AT&T Stadium',      ciudad:'Dallas',       es_argentina:true,  estado:'pendiente', goles_home:null, goles_away:null },
  { id:'aut-alg', grupo:'J', home:'Austria',   away:'Argelia',  fecha_utc:'2026-06-28T02:00:00Z', sede:'Arrowhead Stadium', ciudad:'Kansas City',  es_argentina:false, estado:'pendiente', goles_home:null, goles_away:null },
  { id:'mex-sud', grupo:'A', home:'México',    away:'Sudáfrica',fecha_utc:'2026-06-11T22:00:00Z', sede:'Estadio Azteca',    ciudad:'Ciudad de México', es_argentina:false, estado:'pendiente', goles_home:null, goles_away:null },
  { id:'bra-mar', grupo:'C', home:'Brasil',    away:'Marruecos',fecha_utc:'2026-06-14T02:00:00Z', sede:'MetLife Stadium',   ciudad:'Nueva York',   es_argentina:false, estado:'pendiente', goles_home:null, goles_away:null },
  { id:'usa-par', grupo:'D', home:'EE.UU.',    away:'Paraguay', fecha_utc:'2026-06-15T02:00:00Z', sede:'Gillette Stadium',  ciudad:'Boston',       es_argentina:false, estado:'pendiente', goles_home:null, goles_away:null },
  { id:'ned-jap', grupo:'F', home:'Países Bajos', away:'Japón', fecha_utc:'2026-06-15T19:00:00Z', sede:"Levi's Stadium",  ciudad:'San Francisco', es_argentina:false, estado:'pendiente', goles_home:null, goles_away:null },
];
