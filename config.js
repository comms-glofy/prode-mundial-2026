// ============================================================
//  CONFIGURACIÓN — reemplazar con tus credenciales reales
//  NO subas este archivo con datos reales a un repo público
// ============================================================

const CONFIG = {
  // Supabase → supabase.com → tu proyecto → Settings → API
  SUPABASE_URL: 'https://lfwhdioadztmruicwgju.supabase.co/rest/v1/',
  SUPABASE_ANON_KEY: 'sb_publishable_cxhoa8Jw6WCK1KTm9Ug1Ag_4OxFSLU2',

  // RapidAPI → rapidapi.com/api-sports/api/api-football
  RAPIDAPI_KEY: 'c61f6b721374bbddfcb823d173d9b4a0',

  // Panel admin
  ADMIN_PASSWORD: 'glofy2026',

  // Mundial
  WORLD_CUP_ID: 1,
  WORLD_CUP_SEASON: 2026,
  MUNDIAL_START: new Date('2026-06-11T16:00:00-06:00'),

  // Auto-actualización cada 5 min cuando hay partido en curso
  AUTO_UPDATE: true,
  UPDATE_INTERVAL_MS: 5 * 60 * 1000,
};
