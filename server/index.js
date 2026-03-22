import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

dotenv.config();
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Serve built frontend in production
const distPath = join(__dirname, '..', 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
}

// ═══════════════════════════════════════
// DATABASE
// ═══════════════════════════════════════
const dbPath = join(__dirname, '..', 'medprep.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY, title TEXT, content TEXT, section TEXT, createdAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS qcm_examples (
    id TEXT PRIMARY KEY, name TEXT, content TEXT, section TEXT, type TEXT DEFAULT 'example'
  );
  CREATE TABLE IF NOT EXISTS state (
    key TEXT PRIMARY KEY, value TEXT
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT, isAdmin INTEGER DEFAULT 0, createdAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS colle_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    colleId TEXT, userId TEXT, userName TEXT,
    section TEXT, type TEXT, score REAL, total INTEGER, percentage REAL,
    timestamp INTEGER
  );
  CREATE TABLE IF NOT EXISTS fake_students (
    id TEXT PRIMARY KEY, data TEXT
  );
  CREATE TABLE IF NOT EXISTS colles (
    id TEXT PRIMARY KEY, section TEXT, type TEXT, courseIds TEXT,
    questions TEXT, createdAt INTEGER, active INTEGER DEFAULT 0
  );
`);

// Init state defaults
function getState(key, def) {
  const row = db.prepare('SELECT value FROM state WHERE key=?').get(key);
  return row ? JSON.parse(row.value) : def;
}
function setState(key, val) {
  db.prepare('INSERT OR REPLACE INTO state(key,value) VALUES(?,?)').run(key, JSON.stringify(val));
}

// Init fake students if not exists
if (db.prepare('SELECT COUNT(*) as c FROM fake_students').get().c === 0) {
  const PRENOMS = ["Emma","Lucas","Léa","Hugo","Chloé","Nathan","Manon","Théo","Camille","Enzo","Inès","Louis","Sarah","Raphaël","Jade","Arthur","Louise","Jules","Alice","Gabriel","Lina","Adam","Eva","Noé","Zoé","Tom","Lola","Paul","Anna","Maxime","Clara","Alexandre","Marie","Antoine","Juliette","Victor","Margaux","Clément","Romane","Mathis","Océane","Axel","Charlotte","Samuel","Ambre","Ethan","Lucie","Robin","Pauline","Valentin","Elisa","Romain","Mélissa","Quentin","Agathe","Benjamin","Laura","Dylan","Mathilde","Nolan","Anaïs","Simon","Célia","Damien","Elise","Bastien","Sofia","Florian","Yasmine","Julien","Nina","Thibault","Justine","Kevin","Emilie","Loïc","Solène","Pierre","Leïla","Thomas","Maëlys","William","Rose","Adrien","Constance","Corentin","Salomé","Alexis","Margot","Matthieu","Stella","Tristan","Capucine","Martin","Victoire","Félix","Diane","Gaël","Iris","Oscar","Apolline","Rémi"];
  const NOMS = ["Martin","Bernard","Thomas","Petit","Robert","Richard","Durand","Dubois","Moreau","Laurent","Simon","Michel","Lefebvre","Leroy","Roux","David","Bertrand","Morel","Fournier","Girard","Bonnet","Dupont","Lambert","Fontaine","Rousseau","Vincent","Muller","Lefevre","Faure","André","Mercier","Blanc","Guerin","Boyer","Garnier","Chevalier","François","Legrand","Gauthier","Garcia","Perrin","Robin","Clement","Morin","Nicolas","Henry","Roussel","Mathieu","Gautier","Masson","Marchand","Duval","Denis","Dumont","Marie","Lemaire","Noël","Meyer","Dufour","Meunier","Brun","Blanchard","Giraud","Joly","Riviere","Lucas","Brunet","Gaillard","Barbier","Arnaud","Martinez","Gerard","Roche","Renard","Schmitt","Roy","Leroux","Colin","Vidal","Caron","Picard","Roger","Fabre","Aubert","Lemoine","Renaud","Dumas","Lacroix","Olivier","Philippe","Bourgeois","Pierre","Benoit","Rey","Leclerc","Payet","Rolland","Leclercq","Guillaume","Lecomte","Lopez","Jean","Dupuy","Guillot"];
  const insert = db.prepare('INSERT INTO fake_students(id,data) VALUES(?,?)');
  const tx = db.transaction(() => {
    for (let i = 0; i < 103; i++) {
      insert.run(`fe_${i}`, JSON.stringify({
        id: `fe_${i}`, name: `${PRENOMS[i%PRENOMS.length]} ${NOMS[i%NOMS.length]}`,
        potential: +(0.3 + Math.random() * 0.7).toFixed(3),
        learningRate: +(0.03 + Math.random() * 0.05).toFixed(4),
        forgetRate: +(0.005 + Math.random() * 0.015).toFixed(4),
        consistency: +(0.5 + Math.random() * 0.5).toFixed(3),
        specialization: Math.random() > 0.5 ? "Médecine" : "Dentaire",
        currentSkill: 0, courseMastery: {}, lastPractice: {},
        totalColles: 0, totalScore: 0,
      }));
    }
  });
  tx();
}

// Init default state
if (!getState('timer', null)) setState('timer', { active: false, minutes: 25, section: 'Médecine' });
if (!getState('settings', null)) setState('settings', { nCourses: 3, consec: 0, lastSec: null, selectedCourses: [] });
if (!getState('apiCalls', null)) setState('apiCalls', 0);

// ═══════════════════════════════════════
// AUTH MIDDLEWARE
// ═══════════════════════════════════════
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'admin123';

function isAdmin(req) {
  return req.headers['x-admin-key'] === ADMIN_PW;
}

// ═══════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════

// --- Health ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hasKey: !!process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-4o-mini' });
});

// --- Auth ---
app.post('/api/auth/login', (req, res) => {
  const { name, password } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  const admin = password === ADMIN_PW;
  const userId = admin ? 'admin' : `user_${name.toLowerCase().replace(/\s+/g, '_')}`;
  db.prepare('INSERT OR IGNORE INTO users(id,name,isAdmin,createdAt) VALUES(?,?,?,?)').run(userId, name, admin ? 1 : 0, Date.now());
  res.json({ userId, name, isAdmin: admin });
});

// --- Courses (admin only to write) ---
app.get('/api/courses', (req, res) => {
  res.json(db.prepare('SELECT * FROM courses ORDER BY createdAt DESC').all());
});
app.post('/api/courses', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const { id, title, content, section } = req.body;
  db.prepare('INSERT OR REPLACE INTO courses(id,title,content,section,createdAt) VALUES(?,?,?,?,?)').run(id, title, content, section, Date.now());
  res.json({ ok: true });
});
app.delete('/api/courses/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  db.prepare('DELETE FROM courses WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// --- QCM Examples & Corrections ---
app.get('/api/examples', (req, res) => {
  res.json(db.prepare('SELECT * FROM qcm_examples').all());
});
app.post('/api/examples', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const { id, name, content, section, type } = req.body;
  db.prepare('INSERT OR REPLACE INTO qcm_examples(id,name,content,section,type) VALUES(?,?,?,?,?)').run(id, name, content, section, type || 'example');
  res.json({ ok: true });
});
app.delete('/api/examples/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  db.prepare('DELETE FROM qcm_examples WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// --- Shared State (timer, settings) ---
app.get('/api/state', (req, res) => {
  res.json({
    timer: getState('timer', { active: false, minutes: 25, section: 'Médecine' }),
    settings: getState('settings', { nCourses: 3, consec: 0, lastSec: null, selectedCourses: [] }),
    apiCalls: getState('apiCalls', 0),
    activeColle: getState('activeColle', null),
    colleAlert: getState('colleAlert', null),
  });
});
app.post('/api/state', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const { key, value } = req.body;
  setState(key, value);
  res.json({ ok: true });
});

// --- Active Colle (shared) ---
app.get('/api/colle/active', (req, res) => {
  const colle = getState('activeColle', null);
  res.json(colle);
});
app.post('/api/colle/active', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  setState('activeColle', req.body.colle);
  res.json({ ok: true });
});

// --- Submit results ---
app.post('/api/colle/submit', (req, res) => {
  const { colleId, userId, userName, section, type, score, total, percentage } = req.body;
  db.prepare('INSERT INTO colle_results(colleId,userId,userName,section,type,score,total,percentage,timestamp) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(colleId, userId, userName, section, type, score, total, percentage, Date.now());
  res.json({ ok: true });
});

// --- Rankings ---
app.get('/api/rankings/:colleId', (req, res) => {
  const results = db.prepare('SELECT * FROM colle_results WHERE colleId=? ORDER BY percentage DESC').all(req.params.colleId);
  // Add fake students
  const feRows = db.prepare('SELECT data FROM fake_students').all();
  const feStudents = feRows.map(r => JSON.parse(r.data));
  res.json({ results, feStudents });
});

// --- History ---
app.get('/api/history', (req, res) => {
  const rows = db.prepare('SELECT * FROM colle_results ORDER BY timestamp DESC LIMIT 100').all();
  res.json(rows);
});

// --- Fake Students ---
app.get('/api/fake-students', (req, res) => {
  const rows = db.prepare('SELECT data FROM fake_students').all();
  res.json(rows.map(r => JSON.parse(r.data)));
});
app.post('/api/fake-students/update', (req, res) => {
  const { students } = req.body;
  const update = db.prepare('UPDATE fake_students SET data=? WHERE id=?');
  const tx = db.transaction(() => {
    students.forEach(s => update.run(JSON.stringify(s), s.id));
  });
  tx();
  res.json({ ok: true });
});

// --- OpenAI Proxy ---
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

app.post('/api/generate', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'No API key' });
  const { messages, max_tokens = 4000 } = req.body;
  try {
    const content = messages[0]?.content || '';
    const splitIdx = content.lastIndexOf('\n\nGénère exactement');
    const sys = splitIdx > 0 ? content.substring(0, splitIdx) : '';
    const user = splitIdx > 0 ? content.substring(splitIdx + 2) : content;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: MODEL, max_tokens, temperature: 0.7, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
    });
    if (!response.ok) { const err = await response.text(); return res.status(response.status).json({ error: err }); }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    // Increment API call count
    setState('apiCalls', (getState('apiCalls', 0) || 0) + 1);
    res.json({ content: [{ type: 'text', text }], usage: data.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SPA fallback ---
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  const indexPath = join(distPath, 'index.html');
  if (existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).send('Build not found. Run npm run build first.');
});

app.listen(PORT, () => {
  console.log(`\n🚀 MedPrep v4 on http://localhost:${PORT}`);
  console.log(`   Model: ${MODEL}`);
  console.log(`   Admin password: ${ADMIN_PW}\n`);
});
