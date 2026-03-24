import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

dotenv.config();
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json({ limit: '5mb' }));
const distPath = join(__dirname, '..', 'dist');
if (existsSync(distPath)) app.use(express.static(distPath));

// ═══════════ TURSO DB ═══════════
const db = createClient({
  url: process.env.TURSO_URL || 'file:medprep.db',
  authToken: process.env.TURSO_TOKEN || undefined,
});

async function initDB() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS courses (id TEXT PRIMARY KEY, title TEXT, content TEXT, section TEXT, createdAt INTEGER);
    CREATE TABLE IF NOT EXISTS qcm_examples (id TEXT PRIMARY KEY, name TEXT, content TEXT, section TEXT, type TEXT DEFAULT 'example');
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, isAdmin INTEGER DEFAULT 0, createdAt INTEGER);
    CREATE TABLE IF NOT EXISTS colle_results (id INTEGER PRIMARY KEY AUTOINCREMENT, colleId TEXT, userId TEXT, userName TEXT, section TEXT, type TEXT, score REAL, total INTEGER, percentage REAL, timestamp INTEGER);
    CREATE TABLE IF NOT EXISTS fake_students (id TEXT PRIMARY KEY, data TEXT);
  `);
  const count = await db.execute('SELECT COUNT(*) as c FROM fake_students');
  if (count.rows[0].c === 0) {
    const P = ["Emma","Lucas","Léa","Hugo","Chloé","Nathan","Manon","Théo","Camille","Enzo","Inès","Louis","Sarah","Raphaël","Jade","Arthur","Louise","Jules","Alice","Gabriel","Lina","Adam","Eva","Noé","Zoé","Tom","Lola","Paul","Anna","Maxime","Clara","Alexandre","Marie","Antoine","Juliette","Victor","Margaux","Clément","Romane","Mathis","Océane","Axel","Charlotte","Samuel","Ambre","Ethan","Lucie","Robin","Pauline","Valentin","Elisa","Romain","Mélissa","Quentin","Agathe","Benjamin","Laura","Dylan","Mathilde","Nolan","Anaïs","Simon","Célia","Damien","Elise","Bastien","Sofia","Florian","Yasmine","Julien","Nina","Thibault","Justine","Kevin","Emilie","Loïc","Solène","Pierre","Leïla","Thomas","Maëlys","William","Rose","Adrien","Constance","Corentin","Salomé","Alexis","Margot","Matthieu","Stella","Tristan","Capucine","Martin","Victoire","Félix","Diane","Gaël","Iris","Oscar","Apolline","Rémi"];
    const N = ["Martin","Bernard","Thomas","Petit","Robert","Richard","Durand","Dubois","Moreau","Laurent","Simon","Michel","Lefebvre","Leroy","Roux","David","Bertrand","Morel","Fournier","Girard","Bonnet","Dupont","Lambert","Fontaine","Rousseau","Vincent","Muller","Lefevre","Faure","André","Mercier","Blanc","Guerin","Boyer","Garnier","Chevalier","François","Legrand","Gauthier","Garcia","Perrin","Robin","Clement","Morin","Nicolas","Henry","Roussel","Mathieu","Gautier","Masson","Marchand","Duval","Denis","Dumont","Marie","Lemaire","Noël","Meyer","Dufour","Meunier","Brun","Blanchard","Giraud","Joly","Riviere","Lucas","Brunet","Gaillard","Barbier","Arnaud","Martinez","Gerard","Roche","Renard","Schmitt","Roy","Leroux","Colin","Vidal","Caron","Picard","Roger","Fabre","Aubert","Lemoine","Renaud","Dumas","Lacroix","Olivier","Philippe","Bourgeois","Pierre","Benoit","Rey","Leclerc","Payet","Rolland","Leclercq","Guillaume","Lecomte","Lopez","Jean","Dupuy","Guillot"];
    const batch = [];
    for (let i = 0; i < 103; i++) {
      batch.push({ sql: 'INSERT OR IGNORE INTO fake_students(id,data) VALUES(?,?)', args: [`fe_${i}`, JSON.stringify({
        id:`fe_${i}`,name:`${P[i%P.length]} ${N[i%N.length]}`,potential:+(0.3+Math.random()*0.7).toFixed(3),learningRate:+(0.03+Math.random()*0.05).toFixed(4),forgetRate:+(0.005+Math.random()*0.015).toFixed(4),consistency:+(0.5+Math.random()*0.5).toFixed(3),specialization:Math.random()>0.5?"Médecine":"Dentaire",currentSkill:0,courseMastery:{},lastPractice:{},totalColles:0,totalScore:0,
      })] });
    }
    await db.batch(batch);
  }
  const tr = await db.execute({sql:'SELECT value FROM state WHERE key=?',args:['timer']});
  if (tr.rows.length === 0) {
    await db.batch([
      {sql:'INSERT OR IGNORE INTO state(key,value) VALUES(?,?)',args:['timer',JSON.stringify({active:false,minutes:25,section:'Médecine'})]},
      {sql:'INSERT OR IGNORE INTO state(key,value) VALUES(?,?)',args:['settings',JSON.stringify({nCourses:3,consec:0,lastSec:null,selectedCourses:[]})]},
      {sql:'INSERT OR IGNORE INTO state(key,value) VALUES(?,?)',args:['apiCalls','0']},
    ]);
  }
  console.log('✅ Database ready');
}

async function getS(k,d){const r=await db.execute({sql:'SELECT value FROM state WHERE key=?',args:[k]});return r.rows.length>0?JSON.parse(r.rows[0].value):d}
async function setS(k,v){await db.execute({sql:'INSERT OR REPLACE INTO state(key,value) VALUES(?,?)',args:[k,JSON.stringify(v)]})}

const ADMIN_PW = process.env.ADMIN_PASSWORD || 'admin123';
const isAdm = r => r.headers['x-admin-key'] === ADMIN_PW;

// ═══════════ ROUTES ═══════════
app.get('/api/health',(q,r)=>r.json({status:'ok',hasKey:!!process.env.OPENAI_API_KEY,turso:!!process.env.TURSO_URL}));

app.post('/api/auth/login',async(q,r)=>{
  const{name,password}=q.body;if(!name)return r.status(400).json({error:'Nom requis'});
  const admin=password===ADMIN_PW;const userId=admin?'admin':`user_${name.toLowerCase().replace(/\s+/g,'_')}`;
  await db.execute({sql:'INSERT OR IGNORE INTO users(id,name,isAdmin,createdAt) VALUES(?,?,?,?)',args:[userId,name,admin?1:0,Date.now()]});
  r.json({userId,name,isAdmin:admin});
});

app.get('/api/courses',async(q,r)=>{const x=await db.execute('SELECT * FROM courses ORDER BY createdAt DESC');r.json(x.rows)});
app.post('/api/courses',async(q,r)=>{if(!isAdm(q))return r.status(403).json({error:'Admin only'});const{id,title,content,section}=q.body;await db.execute({sql:'INSERT OR REPLACE INTO courses(id,title,content,section,createdAt) VALUES(?,?,?,?,?)',args:[id,title,content,section,Date.now()]});r.json({ok:true})});
app.delete('/api/courses/:id',async(q,r)=>{if(!isAdm(q))return r.status(403).json({error:'Admin only'});await db.execute({sql:'DELETE FROM courses WHERE id=?',args:[q.params.id]});r.json({ok:true})});

app.get('/api/examples',async(q,r)=>{const x=await db.execute('SELECT * FROM qcm_examples');r.json(x.rows)});
app.post('/api/examples',async(q,r)=>{if(!isAdm(q))return r.status(403).json({error:'Admin only'});const{id,name,content,section,type}=q.body;await db.execute({sql:'INSERT OR REPLACE INTO qcm_examples(id,name,content,section,type) VALUES(?,?,?,?,?)',args:[id,name,content,section,type||'example']});r.json({ok:true})});
app.delete('/api/examples/:id',async(q,r)=>{if(!isAdm(q))return r.status(403).json({error:'Admin only'});await db.execute({sql:'DELETE FROM qcm_examples WHERE id=?',args:[q.params.id]});r.json({ok:true})});

app.get('/api/state',async(q,r)=>{r.json({timer:await getS('timer',{active:false,minutes:25,section:'Médecine'}),settings:await getS('settings',{nCourses:3,consec:0,lastSec:null,selectedCourses:[]}),apiCalls:await getS('apiCalls',0),activeColle:await getS('activeColle',null),colleAlert:await getS('colleAlert',null)})});
app.post('/api/state',async(q,r)=>{if(!isAdm(q))return r.status(403).json({error:'Admin only'});await setS(q.body.key,q.body.value);r.json({ok:true})});

app.get('/api/colle/active',async(q,r)=>{r.json(await getS('activeColle',null))});
app.post('/api/colle/active',async(q,r)=>{if(!isAdm(q))return r.status(403).json({error:'Admin only'});await setS('activeColle',q.body.colle);r.json({ok:true})});

app.post('/api/colle/submit',async(q,r)=>{const{colleId,userId,userName,section,type,score,total,percentage}=q.body;await db.execute({sql:'INSERT INTO colle_results(colleId,userId,userName,section,type,score,total,percentage,timestamp) VALUES(?,?,?,?,?,?,?,?,?)',args:[colleId,userId,userName,section,type,score,total,percentage,Date.now()]});r.json({ok:true})});

app.get('/api/rankings/:colleId',async(q,r)=>{const x=await db.execute({sql:'SELECT * FROM colle_results WHERE colleId=? ORDER BY percentage DESC',args:[q.params.colleId]});r.json({results:x.rows})});

app.get('/api/history',async(q,r)=>{const x=await db.execute('SELECT * FROM colle_results ORDER BY timestamp DESC LIMIT 100');r.json(x.rows)});

app.get('/api/fake-students',async(q,r)=>{const x=await db.execute('SELECT data FROM fake_students');r.json(x.rows.map(row=>JSON.parse(row.data)))});
app.post('/api/fake-students/update',async(q,r)=>{const{students}=q.body;await db.batch(students.map(s=>({sql:'UPDATE fake_students SET data=? WHERE id=?',args:[JSON.stringify(s),s.id]})));r.json({ok:true})});

const MODEL=process.env.OPENAI_MODEL||'gpt-4o-mini';
app.post('/api/generate',async(q,r)=>{
  if(!process.env.OPENAI_API_KEY)return r.status(500).json({error:'No API key'});
  const{messages,max_tokens=8000}=q.body;
  try{
    const c=messages[0]?.content||'';const si=c.lastIndexOf('\n\nGénère exactement');
    const sys=si>0?c.substring(0,si):'';const user=si>0?c.substring(si+2):c;
    const res=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:MODEL,max_tokens,temperature:0.7,messages:[{role:'system',content:sys},{role:'user',content:user}]})});
    if(!res.ok){const err=await res.text();return r.status(res.status).json({error:err})}
    const data=await res.json();const text=data.choices?.[0]?.message?.content||'';
    const cur=await getS('apiCalls',0);await setS('apiCalls',(cur||0)+1);
    r.json({content:[{type:'text',text}],usage:data.usage});
  }catch(err){r.status(500).json({error:err.message})}
});

app.get('*',(q,r)=>{if(q.path.startsWith('/api'))return r.status(404).json({error:'Not found'});const p=join(distPath,'index.html');if(existsSync(p))r.sendFile(p);else r.status(404).send('Build not found')});

initDB().then(()=>{app.listen(PORT,()=>{console.log(`\n🚀 MedPrep v4 on http://localhost:${PORT}\n   Model: ${MODEL}\n   DB: ${process.env.TURSO_URL?'Turso ☁️':'Local SQLite'}\n`)})}).catch(e=>{console.error('DB fail:',e);process.exit(1)});
