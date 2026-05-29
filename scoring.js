// ============================================================
//  scoring.js — Sistema de puntuación (espejo del SQL)
//  Se usa en el frontend para previsualización
// ============================================================

function calcularPuntos(predHome, predAway, realHome, realAway, bonusArg = false) {
  if (realHome === null || realAway === null) return null;

  let pts = 0;
  const mult = bonusArg ? 2 : 1;

  if (predHome === realHome && predAway === realAway) {
    pts = 3; // Resultado exacto
  } else if (
    (predHome > predAway && realHome > realAway) ||
    (predHome < predAway && realHome < realAway) ||
    (predHome === predAway && realHome === realAway)
  ) {
    pts = 1; // Ganador/empate correcto
  }

  return pts * mult;
}

function descripcionPuntos(pts, bonusArg) {
  if (pts === null) return '—';
  if (pts === 0) return '0 pts';
  const base = bonusArg ? pts / 2 : pts;
  if (base === 3) return bonusArg ? `🎯 6 pts (×2 ARG)` : '🎯 3 pts';
  if (base === 1) return bonusArg ? `✅ 2 pts (×2 ARG)` : '✅ 1 pt';
  return `${pts} pts`;
}

// Calcular puntaje total de un participante a partir de sus predicciones
function calcularTotales(predicciones) {
  return predicciones.reduce((acc, pred) => {
    if (pred.puntos === null) return acc;
    acc.total += pred.puntos;
    if (pred.es_exacto) acc.exactos++;
    if (pred.acerto_ganador) acc.ganador_ok++;
    acc.jugados++;
    return acc;
  }, { total: 0, exactos: 0, ganador_ok: 0, jugados: 0 });
}

// Generar badge visual de puntos
function badgePuntos(pts, bonusArg) {
  if (pts === null) return `<span class="badge-pts badge-pending">—</span>`;
  if (pts === 0) return `<span class="badge-pts badge-zero">0</span>`;
  const cls = pts >= 6 ? 'badge-gold' : pts >= 3 ? 'badge-green' : 'badge-blue';
  const label = bonusArg && pts > 1 ? `${pts} ×2` : pts;
  return `<span class="badge-pts ${cls}">${label}</span>`;
}
