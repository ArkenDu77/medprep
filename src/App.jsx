import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════ THEME ═══════════
const T = {
  bg:"#06080d",surface:"#0d1117",card:"#131a27",border:"#1b2538",borderLight:"#253352",
  accent:"#00dba4",accentSoft:"#00c89640",accentBg:"#00dba410",
  danger:"#ef4444",dangerSoft:"#ef444425",warn:"#f59e0b",warnSoft:"#f59e0b20",info:"#6366f1",
  med:"#34d399",medBg:"#34d39915",medBorder:"#34d39935",
  dent:"#f472b6",dentBg:"#f472b615",dentBorder:"#f472b635",
  text:"#e8edf5",textSec:"#8b95a8",textDim:"#4a5568",
  gold:"#fbbf24",silver:"#94a3b8",bronze:"#d97706",radius:12,radiusSm:8,
};
const font=`'Outfit','Inter',system-ui,sans-serif`;

// ═══════════ API HELPERS ═══════════
const adminKey = () => sessionStorage.getItem('mp_admin_key') || '';
const hdr = () => ({ 'Content-Type':'application/json','x-admin-key':adminKey() });
const api = {
  get: async (u) => { const r=await fetch(u); return r.json(); },
  post: async (u,b) => { const r=await fetch(u,{method:'POST',headers:hdr(),body:JSON.stringify(b)}); return r.json(); },
  del: async (u) => { const r=await fetch(u,{method:'DELETE',headers:hdr()}); return r.json(); },
};

// ═══════════ PDF ═══════════
let pdfOk=false;
function loadPdf(){return new Promise((res,rej)=>{if(pdfOk&&window.pdfjsLib)return res(window.pdfjsLib);const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";s.onload=()=>{window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";pdfOk=true;res(window.pdfjsLib)};s.onerror=rej;document.head.appendChild(s)})}
async function pdfText(file){const lib=await loadPdf();const buf=await file.arrayBuffer();const pdf=await lib.getDocument({data:buf}).promise;let t="";for(let i=1;i<=pdf.numPages;i++){const pg=await pdf.getPage(i);const c=await pg.getTextContent();t+=c.items.map(x=>x.str).join(" ")+"\n\n"}return t.trim()}

// ═══════════ QCM GENERATION ═══════════
function splitIntoSections(text) {
  const chunks = text.split(/\n{2,}|\r\n{2,}/).filter(c => c.trim().length > 30);
  if (chunks.length === 0) return [{ num: 1, text: text.substring(0, 3000) }];
  return chunks.map((c, i) => ({ num: i + 1, text: c.trim().substring(0, 500) }));
}

async function verifyCorrections(questions, courseText) {
  // 2nd API call: verify each question's correctAnswers against the course
  const qSummary = questions.map((q, i) => {
    const opts = q.options?.map((o, j) => `${o.label}) ${o.text}`).join("\n") || "";
    const correct = (q.correctAnswers || []).map(j => String.fromCharCode(65 + j)).join(",");
    return `Q${i + 1}: ${q.question}\n${opts}\nRéponses marquées correctes: ${correct}`;
  }).join("\n\n");

  const sys = `Tu es un vérificateur de QCM médical. On te donne des QCM et le cours source.
TRAVAIL: Pour CHAQUE question, vérifie que les réponses marquées correctes sont VRAIMENT correctes selon le cours, et que les réponses marquées fausses sont VRAIMENT fausses.
RÈGLE: Base-toi UNIQUEMENT sur le texte du cours. Si un item reprend fidèlement le cours, il est VRAI. Si un item contredit le cours (même d'un seul mot), il est FAUX.
Réponds UNIQUEMENT en JSON: {"corrections":[{"q":0,"correctAnswers":[0,1,3],"explanation":"citation du cours"},{"q":1,"correctAnswers":[2],"explanation":"citation"},...]}
q = index de la question (0-based). correctAnswers = les VRAIS indices corrects après vérification. Inclus TOUTES les questions, même celles qui ne changent pas.`;

  const user = `COURS:\n${courseText.substring(0, 6000)}\n\nQCM À VÉRIFIER:\n${qSummary}\n\nJSON uniquement.`;
  try {
    const r = await api.post("/api/generate", { messages: [{ role: "user", content: `${sys}\n\n${user}` }], max_tokens: 4000 });
    const t = r.content?.map(i => i.text || "").join("") || "";
    const p = JSON.parse(t.replace(/```json|```/g, "").trim());
    if (p.corrections?.length) return p.corrections;
    return null;
  } catch { return null; }
}

async function generateQuestions(courses, type, section, numQ, examples, corrections, difficulty) {
  numQ = Math.max(15, numQ);
  const diff = difficulty || 'medium';
  const courseTexts = courses.map(c => {
    const sections = splitIntoSections(c.content);
    return `=== COURS: ${c.title} (${c.id}) — ${sections.length} sections ===\n${sections.map(s => `[SECTION ${s.num}] ${s.text}`).join("\n\n")}`;
  }).join("\n\n");
  const txt = courseTexts.length > 12000 ? courseTexts.substring(0, 12000) + "\n[...tronqué]" : courseTexts;
  let ex = "";
  if (examples?.length || corrections?.length) {
    ex = "\n\n====== MODÈLES QCM (IMITE CE FORMAT) ======\n";
    examples?.forEach((e, i) => { ex += `\n--- QCM ${i+1} ---\n${e.content.substring(0, 2000)}\n`; });
    corrections?.forEach((c, i) => { ex += `\n--- CORRECTION ${i+1} ---\n${c.content.substring(0, 2000)}\n`; });
    ex += "\n====== FIN ======\n";
  }
  const isQ = type === "QROC";
  const diffRules = diff === 'easy' ? `FACILE: Questions directes sur les fondamentaux. Aucune ambiguïté.`
    : diff === 'hard' ? `DIFFICILE: Détails précis, chiffres exacts, exceptions. Pièges = modification d'UN mot d'une phrase du cours.`
    : `MOYEN: Mélange fondamentaux et détails. Bonne connaissance requise.`;

  const sys = `Tu es un générateur de QCM pour médecine/odontologie LAS 2.

RÈGLE FONDAMENTALE: Tout provient UNIQUEMENT du cours fourni. COPIE FIDÈLE. Zéro reformulation. Zéro interprétation.

INTERDICTIONS:
- JAMAIS utiliser de connaissances externes
- JAMAIS reformuler ni interpréter le cours
- JAMAIS inventer un item qui n'a aucun rapport avec le cours
- JAMAIS créer de piège basé sur des connaissances hors cours

CONSTRUCTION DES ITEMS:
- Items VRAIS = copies EXACTES de phrases du cours (mot à mot)
- Items FAUX = MÊME phrase du cours MAIS avec UNE modification (un mot remplacé, un chiffre changé, une condition inversée)
- L'étudiant doit pouvoir retrouver la justification de CHAQUE item (vrai ou faux) dans le cours
- Exemple: si le cours dit "Le pH salivaire normal est de 7.2", un item faux serait "Le pH salivaire normal est de 6.8"

${diffRules}

RÈGLES:
1. JSON valide UNIQUEMENT
2. 5 items (A-E) par question. De 1 à 5 bonnes réponses. Varie.
3. Items TOUS DIFFÉRENTS. Pas de "aucune" ni "toutes correctes".
4. COUVRE TOUTES LES SECTIONS. Min 1 question par section. Max 3.
5. Pour chaque item FAUX, "explanation" doit indiquer quel mot a été changé et citer le passage original du cours

FORMAT: {"questions":[${isQ ? `{"type":"QROC","courseId":"ID","question":"...","answer":"1-4 mots","difficulty":"${diff}","explanation":"«citation cours»"}` : `{"type":"QCM","courseId":"ID","question":"...","options":["A) phrase exacte du cours","B) phrase exacte du cours","C) phrase du cours avec 1 mot modifié","D) phrase exacte du cours","E) phrase du cours avec 1 mot modifié"],"correctAnswers":[0,1,3],"difficulty":"${diff}","explanation":"Pour chaque item faux: mot modifié → mot original. Citation: «passage exact du cours»"}`}]}
${isQ ? "QROC = 1-4 mots MAX." : ""}
${ex ? "IMITE le style des exemples fournis." : ""}`;

  const user = `Génère exactement ${numQ} ${isQ ? "QROC" : type === "EBC" ? "QCM EBC" : "QCM"} difficulté ${diff} pour ${section}. COUVRE TOUTES LES SECTIONS.\n\n${txt}${ex}\n\nJSON uniquement.`;
  try {
    const r = await api.post("/api/generate", { messages: [{ role: "user", content: `${sys}\n\n${user}` }], max_tokens: 8000 });
    const t = r.content?.map(i => i.text || "").join("") || "";
    const p = JSON.parse(t.replace(/```json|```/g, "").trim());
    if (!p.questions?.length) return [];

    let qs = p.questions.map((q, i) => ({ ...q, id: `g_${Date.now()}_${i}`, section, courseId: q.courseId || courses[0]?.id, options: q.options?.map((o, j) => ({ label: String.fromCharCode(65 + j), text: typeof o === "string" ? o.replace(/^[A-E]\)\s*/, "") : o })) }));

    // AUTO-VERIFICATION: 2nd API call to check corrections
    const fullCourse = courses.map(c => c.content).join("\n\n");
    const verified = await verifyCorrections(qs, fullCourse);
    if (verified) {
      verified.forEach(v => {
        if (v.q >= 0 && v.q < qs.length && Array.isArray(v.correctAnswers)) {
          qs[v.q].correctAnswers = v.correctAnswers;
          if (v.explanation) qs[v.q].explanation = v.explanation;
        }
      });
    }

    return qs;
  } catch (e) { console.error(e); return []; }
}

// ═══════════ CONTEST AGENT — manual check ═══════════
async function contestItem(question, optionIdx, optionText, isCorrect, courseContent) {
  const sys = `Tu es un correcteur d'examen médical. Un étudiant conteste un item.
RÈGLE: Base-toi UNIQUEMENT sur le cours. Cite le passage EXACT (mot à mot, entre guillemets).
Si le cours ne contient pas l'info pour trancher, dis-le.
Si l'étudiant a raison et la correction est fausse, dis-le CLAIREMENT: "La correction est erronée. L'item est en réalité [VRAI/FAUX]."
Réponds en 2-3 phrases. Sois précis.`;
  const user = `QUESTION: ${question.question}
ITEM: ${String.fromCharCode(65+optionIdx)}) ${optionText}
CORRECTION ACTUELLE: marqué ${isCorrect?"VRAI":"FAUX"}
Pourquoi cet item est-il ${isCorrect?"vrai":"faux"} ?

COURS:\n${courseContent.substring(0,4000)}`;
  try {
    const r = await api.post("/api/generate",{messages:[{role:"user",content:`${sys}\n\n${user}`}],max_tokens:500});
    return r.content?.map(i=>i.text||"").join("")||"Erreur.";
  } catch { return "Erreur de connexion."; }
}

// ═══════════ FAKE STUDENT SIM ═══════════
function simFE(st,questions,courseIds,ts){
  courseIds.forEach(cid=>{const c=st.courseMastery[cid]||0;st.courseMastery[cid]=Math.min(1,c+st.learningRate*st.potential*(1-c*0.7));st.lastPractice[cid]=ts});
  Object.keys(st.courseMastery).forEach(cid=>{if(!courseIds.includes(cid)){const d=(ts-(st.lastPractice[cid]||ts))/864e5;if(d>0)st.courseMastery[cid]*=Math.exp(-st.forgetRate*d)}});
  st.currentSkill=Math.min(1,st.currentSkill+st.learningRate*st.potential*0.5*(1-st.currentSkill));
  let sc=0;
  questions.forEach(q=>{const cm=st.courseMastery[q.courseId]||0;const sp=q.section===st.specialization?0.08:0;const df=(q.difficulty||0.5)*0.15;const pr=Math.max(0.02,Math.min(0.95,cm*0.6+st.currentSkill*0.3+sp-df+(Math.random()-0.5)*(1-st.consistency)*0.3));let er=0;const n=q.options?q.options.length:5;for(let o=0;o<n;o++){if((q.correctAnswers?q.correctAnswers.includes(o):o===0)!==(Math.random()<pr))er++}sc+=er===0?1:er===1?0.5:er===2?0.2:0});
  st.totalColles++;st.totalScore+=sc;
  return{score:sc,total:questions.length,pct:questions.length>0?(sc/questions.length)*100:0};
}

// ═══════════ SCORE /20 ═══════════
function scoreQ(e){return e===0?1:e===1?0.5:e===2?0.2:0}
function to20(score,total){return total>0?+((score/total)*20).toFixed(2):0}

// ═══════════ UI ═══════════
const bst=(v="primary")=>({padding:"10px 22px",borderRadius:T.radiusSm,border:"none",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:font,transition:"all .2s",...(v==="primary"&&{background:T.accent,color:T.bg}),...(v==="secondary"&&{background:T.card,color:T.text,border:`1px solid ${T.border}`}),...(v==="danger"&&{background:T.dangerSoft,color:T.danger}),...(v==="ghost"&&{background:"transparent",color:T.textSec}),...(v==="med"&&{background:T.medBg,color:T.med,border:`1px solid ${T.medBorder}`}),...(v==="dent"&&{background:T.dentBg,color:T.dent,border:`1px solid ${T.dentBorder}`})});
const crd=x=>({background:T.card,borderRadius:T.radius,padding:20,border:`1px solid ${T.border}`,...x});
const inp={width:"100%",padding:"10px 14px",background:T.bg,border:`1px solid ${T.border}`,borderRadius:T.radiusSm,color:T.text,fontSize:13,outline:"none",fontFamily:font,boxSizing:"border-box"};
function Btn({children,onClick,v="primary",disabled,sx}){return<button disabled={disabled} onClick={onClick} style={{...bst(v),opacity:disabled?0.4:1,cursor:disabled?"not-allowed":"pointer",...sx}}>{children}</button>}
function Badge({children,color}){return<span style={{padding:"3px 10px",borderRadius:20,fontSize:10,fontWeight:700,letterSpacing:"0.5px",background:`${color}18`,color,border:`1px solid ${color}35`,textTransform:"uppercase"}}>{children}</span>}
function Stat({label,value,color,sub,icon}){return<div style={crd({flex:1,minWidth:120,padding:"14px 16px"})}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>{icon&&<span style={{fontSize:14}}>{icon}</span>}<span style={{fontSize:10,color:T.textDim,textTransform:"uppercase",letterSpacing:"1px",fontWeight:600}}>{label}</span></div><div style={{fontSize:24,fontWeight:800,color:color||T.accent,lineHeight:1}}>{value}</div>{sub&&<div style={{fontSize:10,color:T.textDim,marginTop:4}}>{sub}</div>}</div>}
function Rk({rank}){const c=rank===1?T.gold:rank===2?T.silver:rank===3?T.bronze:T.textDim;const e=rank===1?"🥇":rank===2?"🥈":rank===3?"🥉":null;return<div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:28,height:28,borderRadius:"50%",fontSize:e?13:11,fontWeight:800,background:`${c}15`,color:c,border:`2px solid ${c}50`,flexShrink:0}}>{e||rank}</div>}
function SecTag({s}){const m=s==="Médecine";return<Badge color={m?T.med:T.dent}>{m?"🩺 ":"🦷 "}{s}</Badge>}
function Dots({msg}){return<div style={{display:"flex",alignItems:"center",gap:8,padding:40,justifyContent:"center"}}><div style={{display:"flex",gap:4}}>{[0,1,2].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:T.accent,animation:`mp 1.2s ease ${i*.2}s infinite`}}/>)}</div><span style={{fontSize:13,color:T.textSec}}>{msg||"Chargement..."}</span><style>{`@keyframes mp{0%,80%,100%{opacity:.3;transform:scale(.8)}40%{opacity:1;transform:scale(1.2)}}`}</style></div>}
const fmt=s=>`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

// ═══════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════
export default function App(){
  // Auth
  const[user,setUser]=useState(null);
  const[loginName,setLoginName]=useState("");
  const[loginPw,setLoginPw]=useState("");
  // Data
  const[page,setPage]=useState("dashboard");
  const[courses,setCourses]=useState([]);
  const[examples,setExamples]=useState([]);
  const[state,setSt]=useState({timer:{active:false,minutes:25,section:"Médecine"},settings:{nCourses:3,consec:0,lastSec:null,selectedCourses:[]},apiCalls:0,activeColle:null,colleAlert:null});
  const[hist,setHist]=useState([]);
  const[fe,setFe]=useState([]);
  // Colle
  const[curColle,setCurColle]=useState(null);
  const[curAns,setCurAns]=useState({});
  const[qrocAns,setQrocAns]=useState({});
  const[validated,setValidated]=useState({});
  const[curQ,setCurQ]=useState(0);
  const[examTime,setExamTime]=useState(0);
  const[results,setResults]=useState(null);
  const[loading,setLoading]=useState(false);
  const[difficulty,setDifficulty]=useState("medium");
  const[contestLoading,setContestLoading]=useState(null);
  const[contestResults,setContestResults]=useState({});
  const[corrOverrides,setCorrOverrides]=useState({});
  const[savedColles,setSavedColles]=useState([]);
  // Import
  const[impTitle,setImpTitle]=useState("");
  const[impText,setImpText]=useState("");
  const[impSec,setImpSec]=useState("Médecine");
  const[impType,setImpType]=useState("course");
  const[selTrain,setSelTrain]=useState(null);
  const fileRef=useRef(null);
  const examRef=useRef(null);
  const pollRef=useRef(null);
  const[cd,setCd]=useState(0);
  const cdRef=useRef(null);

  // Mobile detection — MUST be before any early return
  const[mobile,setMobile]=useState(false);
  useEffect(()=>{const h=()=>setMobile(window.innerWidth<768);h();window.addEventListener('resize',h);return()=>window.removeEventListener('resize',h)},[]);

  const isAdmin=user?.isAdmin;
  const timer=state.timer||{};
  const settings=state.settings||{};
  const blocked=settings.lastSec&&settings.consec>=2?settings.lastSec:null;

  // ═══════ POLLING — sync state every 3s ═══════
  const curColleRef=useRef(curColle);
  const resultsRef=useRef(results);
  useEffect(()=>{curColleRef.current=curColle},[curColle]);
  useEffect(()=>{resultsRef.current=results},[results]);

  const refresh=useCallback(async()=>{
    try{
      const[c,ex,s,h,f,sc]=await Promise.all([api.get("/api/courses"),api.get("/api/examples"),api.get("/api/state"),api.get("/api/history"),api.get("/api/fake-students"),api.get("/api/saved-colles")]);
      setCourses(c);setExamples(ex);setSt(s);setHist(h);setFe(f);setSavedColles(sc);
      if(s.activeColle&&!curColleRef.current&&!resultsRef.current) setCurColle(s.activeColle);
    }catch(e){console.warn("Poll err",e)}
  },[]);

  useEffect(()=>{
    if(!user)return;
    refresh();
    pollRef.current=setInterval(refresh,3000);
    return()=>clearInterval(pollRef.current);
  },[user]);

  // Exam timer
  useEffect(()=>{if(curColle&&!results){setExamTime(0);examRef.current=setInterval(()=>setExamTime(p=>p+1),1000);return()=>clearInterval(examRef.current)}else clearInterval(examRef.current)},[curColle,results]);

  // Local countdown display
  useEffect(()=>{
    if(timer.active&&timer.endTime){
      const tick=()=>{const left=Math.max(0,Math.round((timer.endTime-Date.now())/1000));setCd(left)};
      tick();
      cdRef.current=setInterval(tick,1000);
      return()=>clearInterval(cdRef.current);
    }else{clearInterval(cdRef.current);setCd(0)}
  },[timer.active,timer.endTime]);

  // ═══════ ADMIN ACTIONS ═══════
  const setServerState=async(key,value)=>{await api.post("/api/state",{key,value})};

  const startTimer=async()=>{
    const sec=blocked?(settings.section==="Médecine"?"Dentaire":"Médecine"):settings.section||"Médecine";
    const mins=timer.minutes||25;
    // Pick courses for alert
    const pool=courses.filter(c=>c.section===sec);
    const manual=(settings.selectedCourses||[]).map(id=>courses.find(c=>c.id===id)).filter(c=>c&&c.section===sec);
    const sel=manual.length>0?manual:pool.sort(()=>Math.random()-0.5).slice(0,Math.min(settings.nCourses||3,pool.length));
    await setServerState('timer',{active:true,minutes:mins,section:sec,endTime:Date.now()+mins*60000});
    await setServerState('colleAlert',{section:sec,courses:sel.map(c=>({id:c.id,title:c.title}))});
    refresh();
  };
  const stopTimer=async()=>{await setServerState('timer',{...timer,active:false,endTime:null});await setServerState('colleAlert',null);refresh()};

  const startColle=async(sec,ebc=false,cid=null)=>{
    if(blocked===sec){alert(`⚠️ Rotation → ${sec==="Médecine"?"Dentaire":"Médecine"}`);return}
    const pool=cid?courses.filter(c=>c.id===cid):courses.filter(c=>c.section===sec);
    if(!pool.length){alert("Aucun cours.");return}
    const sel=cid?pool:pool.sort(()=>Math.random()-0.5).slice(0,Math.min(settings.nCourses||3,pool.length));
    const numQ=ebc?50:Math.max(15,18+Math.floor(Math.random()*3));
    setLoading(true);
    const exs=examples.filter(e=>e.section===sec&&e.type==="example");
    const corrs=examples.filter(e=>e.section===sec&&e.type==="correction");
    let qs=await generateQuestions(sel,ebc?"EBC":"QCM",sec,numQ,exs,corrs,difficulty);
    if(!qs.length){
      alert("Génération impossible.");setLoading(false);return;
    }
    const colle={id:`col_${Date.now()}`,section:sec,courseIds:sel.map(c=>c.id),questions:qs,type:ebc?"EBC":"QCM",createdAt:Date.now()};
    // Save colle to server (for reuse + shared)
    if(isAdmin){
      await api.post("/api/colle/active",{colle});
      await api.post("/api/saved-colles",{id:colle.id,section:colle.section,type:colle.type,courseIds:colle.courseIds,questions:colle.questions});
    }
    setCurColle(colle);setCurAns({});setQrocAns({});setValidated({});setCurQ(0);setResults(null);setPage("colle");
    // Update rotation
    if(isAdmin){
      const newConsec=settings.lastSec===sec?(settings.consec||0)+1:1;
      await setServerState('settings',{...settings,consec:newConsec,lastSec:sec});
    }
    await setServerState('colleAlert',null);
    setLoading(false);
  };

  const submitColle=async()=>{
    if(!curColle)return;const now=Date.now();let myS=0;
    curColle.questions.forEach(q=>{
      if(q.type==="QCM"){const sl=curAns[q.id]||[],cr=q.correctAnswers||[];let er=0;(q.options||[]).forEach((_,i)=>{if(cr.includes(i)!==sl.includes(i))er++});myS+=scoreQ(er)}
      else{const a=(qrocAns[q.id]||"").trim().toLowerCase(),e=(q.answer||q.expectedAnswer||"").trim().toLowerCase();myS+=(a&&(a===e||a.includes(e)||e.includes(a)))?1:0}
    });
    const myP=curColle.questions.length>0?(myS/curColle.questions.length)*100:0;
    const my20=to20(myS,curColle.questions.length);
    // Submit MY result to server
    await api.post("/api/colle/submit",{colleId:curColle.id,userId:user.userId,userName:user.name,section:curColle.section,type:curColle.type,score:myS,total:curColle.questions.length,percentage:myP});
    // Simulate FE
    const feUpdated=fe.map(f=>{const c={...f,courseMastery:{...f.courseMastery},lastPractice:{...f.lastPractice}};simFE(c,curColle.questions,curColle.courseIds,now);return c});
    await api.post("/api/fake-students/update",{students:feUpdated});
    // Fetch ALL real user results for this colle from server
    let realUsers=[];
    try{
      const rk=await api.get(`/api/rankings/${curColle.id}`);
      realUsers=(rk.results||[]).map(r=>({id:r.userId,name:r.userId===user.userId?`⭐ ${r.userName}`:r.userName,score:r.score,pct:r.percentage,note20:to20(r.score,r.total),isMe:r.userId===user.userId,isReal:true}));
    }catch(e){
      realUsers=[{id:user.userId,name:`⭐ ${user.name}`,score:myS,pct:myP,note20:my20,isMe:true,isReal:true}];
    }
    // Simulate FE for ranking
    const feRank=fe.map(f=>{const c={...f,courseMastery:{...f.courseMastery},lastPractice:{...f.lastPractice}};const r=simFE(c,curColle.questions,curColle.courseIds,now);return{id:f.id,name:f.name,score:r.score,pct:r.pct,note20:to20(r.score,r.total),isMe:false,isReal:false}});
    // Merge real users + FE, sort by percentage
    const ranking=[...realUsers,...feRank].sort((a,b)=>b.pct-a.pct);
    const myRank=ranking.findIndex(r=>r.isMe)+1;
    setResults({section:curColle.section,type:curColle.type,myScore:myS,total:curColle.questions.length,myPct:myP,my20,myRank,totalStudents:ranking.length,ranking,timestamp:now});
    setFe(feUpdated);
    if(isAdmin) await api.post("/api/colle/active",{colle:null});
    refresh();
  };

  const toggle=(qid,oidx)=>{setCurAns(p=>{const c=p[qid]||[];return{...p,[qid]:c.includes(oidx)?c.filter(i=>i!==oidx):[...c,oidx]}});setValidated(p=>{const n={...p};delete n[qid];return n})};

  const flipItem=(qId,optIdx)=>{
    const q=curColle?.questions.find(x=>x.id===qId);
    const current=corrOverrides[qId]||q?.correctAnswers||[];
    const next=current.includes(optIdx)?current.filter(i=>i!==optIdx):[...current,optIdx];
    const newOverrides={...corrOverrides,[qId]:next};
    setCorrOverrides(newOverrides);
    // Auto-recalc
    if(curColle&&results){
      let myS=0;
      curColle.questions.forEach(qq=>{
        const cr=newOverrides[qq.id]||qq.correctAnswers||[];
        if(qq.type==="QCM"){const sl=curAns[qq.id]||[];let er=0;(qq.options||[]).forEach((_,i)=>{if(cr.includes(i)!==sl.includes(i))er++});myS+=scoreQ(er)}
        else{const a=(qrocAns[qq.id]||"").trim().toLowerCase(),e=(qq.answer||qq.expectedAnswer||"").trim().toLowerCase();myS+=(a&&(a===e||a.includes(e)||e.includes(a)))?1:0}
      });
      const myP=curColle.questions.length>0?(myS/curColle.questions.length)*100:0;
      const my20=to20(myS,curColle.questions.length);
      const ranking=results.ranking.map(r=>r.isMe?{...r,score:myS,pct:myP,note20:my20}:r).sort((a,b)=>b.pct-a.pct);
      const myRank=ranking.findIndex(r=>r.isMe)+1;
      setResults(prev=>({...prev,myScore:myS,myPct:myP,my20,myRank,ranking}));
    }
  };

  const recalcScore=()=>{
    if(!curColle||!results)return;
    let myS=0;
    curColle.questions.forEach(q=>{
      const cr=corrOverrides[q.id]||q.correctAnswers||[];
      if(q.type==="QCM"){const sl=curAns[q.id]||[];let er=0;(q.options||[]).forEach((_,i)=>{if(cr.includes(i)!==sl.includes(i))er++});myS+=scoreQ(er)}
      else{const a=(qrocAns[q.id]||"").trim().toLowerCase(),e=(q.answer||q.expectedAnswer||"").trim().toLowerCase();myS+=(a&&(a===e||a.includes(e)||e.includes(a)))?1:0}
    });
    const myP=curColle.questions.length>0?(myS/curColle.questions.length)*100:0;
    const my20=to20(myS,curColle.questions.length);
    const ranking=results.ranking.map(r=>r.isMe?{...r,score:myS,pct:myP,note20:my20}:r).sort((a,b)=>b.pct-a.pct);
    const myRank=ranking.findIndex(r=>r.isMe)+1;
    setResults(prev=>({...prev,myScore:myS,myPct:myP,my20,myRank,ranking}));
  };

  // File upload
  const handleFile=async e=>{
    const file=e.target.files?.[0];if(!file)return;
    let text="";
    if(file.type==="application/pdf"){setLoading(true);try{text=await pdfText(file)}catch{alert("Erreur PDF.")}setLoading(false)}
    else{text=await new Promise(r=>{const rd=new FileReader();rd.onload=ev=>r(ev.target.result);rd.readAsText(file)})}
    if(!text){e.target.value="";return}
    if(impType==="course"){setImpText(text);setImpTitle(file.name.replace(/\.[^.]+$/,""))}
    else{
      const t=impType==="qcm_correction"?"correction":"example";
      await api.post("/api/examples",{id:`${t}_${Date.now()}`,name:file.name,content:text,section:impSec,type:t});
      refresh();
    }
    e.target.value="";
  };
  const addCourse=async()=>{
    if(!impTitle.trim()||!impText.trim())return;
    await api.post("/api/courses",{id:`c_${Date.now()}`,title:impTitle.trim(),content:impText.trim(),section:impSec});
    setImpTitle("");setImpText("");refresh();
  };

  // ═══════════════════════════════════════
  // LOGIN SCREEN
  // ═══════════════════════════════════════
  if(!user) return(
    <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:T.bg,fontFamily:font}}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/>
      <div style={{...crd({padding:32,width:"90%",maxWidth:340}),textAlign:"center"}}>
        <div style={{fontSize:28,fontWeight:900,color:T.accent,marginBottom:4}}>MedPrep</div>
        <div style={{fontSize:10,color:T.textDim,textTransform:"uppercase",letterSpacing:"1.5px",marginBottom:24}}>Concours Santé</div>
        <input value={loginName} onChange={e=>setLoginName(e.target.value)} placeholder="Votre prénom" style={{...inp,marginBottom:8,textAlign:"center"}}/>
        <input value={loginPw} onChange={e=>setLoginPw(e.target.value)} placeholder="Mot de passe admin (optionnel)" type="password" style={{...inp,marginBottom:14,textAlign:"center",fontSize:12}}/>
        <Btn onClick={async()=>{
          if(!loginName.trim())return;
          const r=await api.post("/api/auth/login",{name:loginName.trim(),password:loginPw});
          if(r.isAdmin) sessionStorage.setItem('mp_admin_key',loginPw);
          setUser(r);
        }} sx={{width:"100%"}}>Entrer</Btn>
        <div style={{fontSize:10,color:T.textDim,marginTop:10}}>Sans mot de passe = mode étudiant</div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // PAGES
  // ═══════════════════════════════════════
  const colleAlert=state.colleAlert;
  const apiCalls=state.apiCalls||0;
  const medC=courses.filter(c=>c.section==="Médecine");
  const dentC=courses.filter(c=>c.section==="Dentaire");

  const dashPage=()=>{
    const n=hist.filter(h=>h.userId===user.userId).length;
    const myHist=hist.filter(h=>h.userId===user.userId);
    const avg=n?myHist.reduce((a,h)=>a+h.percentage,0)/n:0;
    return<div>
      <h1 style={{fontSize:24,fontWeight:800,color:T.text,margin:0}}>Tableau de bord</h1>
      <p style={{color:T.textSec,fontSize:13,margin:"4px 0 16px"}}>Bienvenue {user.name} {isAdmin&&<Badge color={T.accent}>ADMIN</Badge>}</p>
      <div className="mp-stats" style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
        <Stat icon="📝" label="Colles" value={n}/>
        <Stat icon="📈" label="Moy." value={n?`${to20(avg/100*20,20).toFixed(1)}/20`:"—"} color={avg>=60?T.accent:avg>0?T.warn:T.textDim}/>
        <Stat icon="📚" label="Cours" value={courses.length} color={T.info}/>
      </div>
      {/* Timer + Alert */}
      {timer.active&&<div style={{...crd({marginBottom:14,padding:"12px 16px"}),background:T.accentBg,borderColor:T.accentSoft,display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:28}}>⏱</span>
        <div style={{flex:1}}><div style={{fontSize:10,color:T.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:"1px"}}>Prochaine colle</div><div style={{fontSize:28,fontWeight:800,color:T.text,fontVariantNumeric:"tabular-nums",fontFamily:"monospace"}}>{fmt(cd)}</div></div>
        {isAdmin&&<Btn v="danger" onClick={stopTimer} sx={{fontSize:11,padding:"6px 12px"}}>Stop</Btn>}
      </div>}
      {colleAlert&&<div style={{...crd({marginBottom:14,padding:16}),background:`${T.accent}08`,borderColor:`${T.accent}40`}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}><span style={{fontSize:22}}>🔔</span><div><div style={{fontSize:14,fontWeight:800,color:T.accent}}>Colle prévue — {colleAlert.section}</div></div></div>
        {colleAlert.courses?.map((c,i)=><div key={c.id||i} style={{...crd({padding:"7px 12px",marginBottom:3}),display:"flex",gap:8}}><span style={{color:T.accent,fontWeight:700,fontSize:12}}>{i+1}.</span><span style={{fontSize:13,color:T.text}}>{c.title}</span></div>)}
        {isAdmin&&<Btn onClick={()=>startColle(colleAlert.section)} sx={{marginTop:10}}>🚀 Lancer la colle</Btn>}
      </div>}
      {blocked&&<div style={{...crd({marginBottom:14,padding:"10px 14px"}),background:T.warnSoft}}><span style={{fontSize:12,color:T.warn,fontWeight:600}}>⚠️ Rotation → {blocked==="Médecine"?"Dentaire":"Médecine"}</span></div>}
      {/* Quick launch (admin) */}
      {isAdmin&&<div className="mp-launch" style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
        {[["Médecine",T.med,T.medBg,T.medBorder,"🩺",medC],["Dentaire",T.dent,T.dentBg,T.dentBorder,"🦷",dentC]].map(([sc,col,bg,bd,ic,ar])=>
          <div key={sc} onClick={()=>startColle(sc)} style={{...crd({flex:1,minWidth:160,cursor:"pointer",padding:14}),background:bg,borderColor:bd,opacity:blocked===sc?0.35:1}}>
            <div style={{fontSize:13,fontWeight:700,color:col}}>{ic} QCM {sc}</div><div style={{fontSize:10,color:T.textSec}}>{ar.length} cours</div>
          </div>)}
      </div>}
      {/* History */}
      {myHist.length>0&&<div><h3 style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:8}}>Mon historique</h3>
        {myHist.slice(0,8).map((h,i)=><div key={i} style={{...crd({marginBottom:4,padding:"8px 12px"}),display:"flex",alignItems:"center",gap:8}}>
          <div style={{flex:1}}><div style={{fontSize:12,fontWeight:600,color:T.text}}>{h.type} · {to20(h.score,h.total).toFixed(1)}/20</div><div style={{fontSize:10,color:T.textDim}}>{new Date(h.timestamp).toLocaleString("fr-FR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</div></div>
          <SecTag s={h.section}/><span style={{fontSize:14,fontWeight:800,color:h.percentage>=60?T.accent:T.warn}}>{to20(h.score,h.total).toFixed(1)}</span>
        </div>)}
      </div>}
      {/* Saved colles */}
      {savedColles.length>0&&<div style={{marginTop:14}}>
        <h3 style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:8}}>📦 Colles sauvegardées</h3>
        {savedColles.map(sc=><div key={sc.id} style={{...crd({marginBottom:4,padding:"8px 12px"}),display:"flex",alignItems:"center",gap:8}}>
          <div style={{flex:1}}>
            <div style={{fontSize:12,fontWeight:600,color:T.text}}>{sc.type} — {sc.section}</div>
            <div style={{fontSize:10,color:T.textDim}}>{new Date(sc.createdAt).toLocaleString("fr-FR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</div>
          </div>
          <SecTag s={sc.section}/>
          <Btn v="secondary" sx={{fontSize:10,padding:"4px 10px"}} onClick={async()=>{
            const full=await api.get(`/api/saved-colles/${sc.id}`);
            if(full.questions){
              const colle={id:`redo_${Date.now()}`,section:full.section,courseIds:full.courseIds,questions:full.questions,type:full.type,createdAt:Date.now()};
              if(isAdmin) await api.post("/api/colle/active",{colle});
              setCurColle(colle);setCurAns({});setQrocAns({});setValidated({});setCurQ(0);setResults(null);setCorrOverrides({});setContestResults({});setPage("colle");
            }
          }}>Refaire</Btn>
          {isAdmin&&<button onClick={async()=>{if(confirm("Supprimer cette colle ?")){await api.del(`/api/saved-colles/${sc.id}`);refresh()}}} style={{background:"none",border:"none",color:T.danger,cursor:"pointer",fontSize:12}}>🗑</button>}
        </div>)}
      </div>}
    </div>;
  };

  const coursesP=()=><div>
    <h1 style={{fontSize:24,fontWeight:800,color:T.text,margin:0}}>Cours & Sources</h1>
    <p style={{color:T.textSec,fontSize:13,margin:"4px 0 16px"}}>Partagés entre tous les étudiants</p>
    {isAdmin&&<div style={crd({marginBottom:16})}>
      <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
        {[["course","📚 Cours"],["qcm_example","📝 QCM Exemple"],["qcm_correction","✅ Correction"]].map(([v,l])=><button key={v} onClick={()=>setImpType(v)} style={{...bst(impType===v?"primary":"secondary"),fontSize:11,padding:"6px 12px"}}>{l}</button>)}
      </div>
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        {["Médecine","Dentaire"].map(s=><button key={s} onClick={()=>setImpSec(s)} style={{...bst(impSec===s?(s==="Médecine"?"med":"dent"):"ghost"),fontSize:11,padding:"5px 12px"}}>{s}</button>)}
      </div>
      <input ref={fileRef} type="file" accept=".pdf,.txt,.md" style={{display:"none"}} onChange={handleFile}/>
      <div onClick={()=>fileRef.current?.click()} style={{border:`2px dashed ${T.borderLight}`,borderRadius:T.radiusSm,padding:14,textAlign:"center",cursor:"pointer",marginBottom:8}}>
        <div style={{fontSize:20}}>📄</div><div style={{fontSize:11,color:T.textSec,fontWeight:600}}>Importer PDF</div>
      </div>
      {impType==="course"&&<><input value={impTitle} onChange={e=>setImpTitle(e.target.value)} placeholder="Titre" style={{...inp,marginBottom:6}}/><textarea value={impText} onChange={e=>setImpText(e.target.value)} placeholder="Contenu..." rows={4} style={{...inp,resize:"vertical",fontFamily:font}}/><Btn onClick={addCourse} sx={{marginTop:8}} disabled={!impTitle.trim()||!impText.trim()}>Importer</Btn></>}
      {impType!=="course"&&<div style={{fontSize:11,color:T.textSec,padding:"6px 0"}}>Importez un PDF via le bouton ci-dessus.</div>}
    </div>}
    {/* Examples & corrections */}
    {examples.length>0&&<div style={{marginBottom:14}}>
      <h3 style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:6}}>QCM Exemples & Corrections</h3>
      {examples.map(e=><div key={e.id} style={{...crd({padding:"7px 12px",marginBottom:3}),display:"flex",alignItems:"center",gap:8}}>
        <span>{e.type==="correction"?"✅":"📝"}</span><span style={{flex:1,fontSize:12,color:T.text}}>{e.name}</span><SecTag s={e.section}/>
        {isAdmin&&<button onClick={async()=>{await api.del(`/api/examples/${e.id}`);refresh()}} style={{background:"none",border:"none",color:T.textDim,cursor:"pointer"}}>×</button>}
      </div>)}
    </div>}
    {["Médecine","Dentaire"].map(sec=>{const arr=courses.filter(c=>c.section===sec);if(!arr.length)return null;return<div key={sec} style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><SecTag s={sec}/><span style={{fontSize:11,color:T.textDim}}>{arr.length}</span></div>
      {arr.map(c=><div key={c.id} style={{...crd({padding:"8px 12px",marginBottom:3}),display:"flex",alignItems:"center",gap:8}}>
        <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:T.text}}>{c.title}</div></div>
        {isAdmin&&<button onClick={async()=>{await api.del(`/api/courses/${c.id}`);refresh()}} style={{background:"none",border:"none",color:T.textDim,cursor:"pointer",fontSize:14}}>×</button>}
      </div>)}
    </div>})}
  </div>;

  const colleP=()=>{
    if(!curColle)return<div style={{textAlign:"center",padding:40,color:T.textDim}}><Dots msg="En attente d'une colle..."/></div>;
    if(results){const r=results;return<div>
      <h1 style={{fontSize:24,fontWeight:800,color:T.text,marginBottom:14}}>Résultats</h1>
      <div className="mp-stats" style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
        <Stat icon="✅" label="Note" value={`${r.my20.toFixed(1)}/20`} color={r.my20>=12?T.accent:T.warn}/>
        <Stat icon="📊" label="Score" value={`${r.myScore.toFixed(1)}/${r.total}`} color={r.myPct>=60?T.accent:T.warn}/>
        <Stat icon="🏆" label="Rang" value={`${r.myRank}e`} color={r.myRank<=10?T.gold:T.text} sub={`/${r.totalStudents}`}/>
      </div>
      <h3 style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:6}}>Correction <span style={{fontSize:10,color:T.textDim,fontWeight:400}}>— cliquez ❓ pour vérifier, ↕️ pour inverser</span></h3>
      {Object.keys(corrOverrides).length>0&&<div style={{marginBottom:8}}><Btn onClick={recalcScore} v="primary" sx={{fontSize:11,padding:"6px 14px"}}>🔄 Recalculer ma note ({Object.keys(corrOverrides).length} correction(s) modifiée(s))</Btn></div>}
      {curColle.questions.map((q,idx)=>{const sl=curAns[q.id]||[],cr=corrOverrides[q.id]||q.correctAnswers||[];return<div key={q.id} style={crd({marginBottom:5,padding:10})}>
        <div style={{fontSize:10,color:T.textDim,marginBottom:2}}>Q{idx+1} {corrOverrides[q.id]&&<Badge color={T.warn}>MODIFIÉE</Badge>}</div>
        <div style={{fontSize:12,fontWeight:600,color:T.text,marginBottom:6}}>{q.question}</div>
        {q.type==="QCM"&&q.options?.map((o,i)=>{const ok=cr.includes(i),pk=sl.includes(i),cKey=`${q.id}_${i}`,resp=contestResults[cKey]||"",isErronee=resp.toLowerCase().includes("erroné")||resp.toLowerCase().includes("en réalité vrai")||resp.toLowerCase().includes("en réalité faux");return<div key={i}>
          <div style={{padding:"4px 8px",marginBottom:contestResults[cKey]?0:2,borderRadius:T.radiusSm,border:`1px solid ${ok?T.accent+"40":pk?T.danger+"40":T.border}`,background:ok?`${T.accent}12`:pk?`${T.danger}12`:"transparent",display:"flex",gap:6,fontSize:11,alignItems:"center"}}>
            <span style={{fontWeight:700,color:ok?T.accent:pk?T.danger:T.textDim}}>{o.label}</span>
            <span style={{color:T.text,flex:1}}>{o.text}</span>
            {ok&&<span style={{color:T.accent}}>✓</span>}{pk&&!ok&&<span style={{color:T.danger}}>✗</span>}
            <span onClick={async(e)=>{e.stopPropagation();if(contestResults[cKey]||contestLoading===cKey)return;setContestLoading(cKey);const cd=courses.find(c=>c.id===q.courseId);const rsp=await contestItem(q,i,o.text,ok,cd?.content||"");setContestResults(p=>({...p,[cKey]:rsp}));setContestLoading(null)}} style={{color:T.textDim,fontSize:10,cursor:"pointer",padding:"2px 4px"}}>❓</span>
            <span onClick={(e)=>{e.stopPropagation();flipItem(q.id,i)}} style={{color:T.warn,fontSize:10,cursor:"pointer",padding:"2px 4px"}} title="Inverser vrai/faux">↕️</span>
          </div>
          {contestLoading===cKey&&<div style={{padding:"6px 10px",fontSize:10,color:T.textSec}}>⏳ Vérification dans le cours...</div>}
          {contestResults[cKey]&&<div style={{padding:"6px 10px",marginBottom:2,borderRadius:T.radiusSm,background:isErronee?`${T.danger}10`:`${T.warn}08`,borderLeft:`2px solid ${isErronee?T.danger:T.warn}`,fontSize:10,color:T.text,lineHeight:1.5}}>
            <span style={{fontWeight:700,color:isErronee?T.danger:T.warn}}>{isErronee?"⚠️ Correction erronée":"🔍 Analyse"} :</span> {contestResults[cKey]}
            {isErronee&&<div style={{marginTop:4}}><span onClick={()=>flipItem(q.id,i)} style={{color:T.accent,cursor:"pointer",fontWeight:700,textDecoration:"underline",fontSize:10}}>→ Cliquer ici pour corriger cet item</span></div>}
          </div>}
        </div>})}
        {q.type==="QROC"&&<div style={{fontSize:11}}><span style={{color:T.textSec}}>Vous: </span><span style={{color:T.warn}}>{qrocAns[q.id]||"(vide)"}</span> → <span style={{color:T.accent}}>{q.answer||q.expectedAnswer}</span></div>}
        {q.explanation&&<div style={{marginTop:6,padding:"8px 10px",borderRadius:T.radiusSm,background:`${T.info}10`,borderLeft:`3px solid ${T.info}`}}>
          <div style={{fontSize:9,color:T.info,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:3}}>📖 Extrait du cours</div>
          <div style={{fontSize:11,color:T.text,lineHeight:1.6}}>{q.explanation}</div>
        </div>}
      </div>})}
      <h3 style={{fontSize:13,fontWeight:700,color:T.text,margin:"14px 0 6px"}}>Classement</h3>
      <div style={{...crd({padding:0}),maxHeight:300,overflowY:"auto"}}>
        {r.ranking.slice(0,40).map((st,i)=><div key={st.id||i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",borderBottom:`1px solid ${T.border}`,background:st.isMe?T.accentBg:st.isReal?`${T.info}08`:"transparent"}}>
          <Rk rank={i+1}/><div style={{flex:1,fontSize:11,fontWeight:st.isMe?800:st.isReal?700:400,color:st.isMe?T.accent:st.isReal?T.text:T.textSec}}>{st.name}{st.isReal&&!st.isMe?" 👤":""}</div><span style={{fontSize:12,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{st.note20?.toFixed(1)||"—"}/20</span>
        </div>)}
      </div>
      <Btn onClick={()=>{setResults(null);setCurColle(null);setPage("dashboard")}} sx={{marginTop:12}}>Retour</Btn>
    </div>}
    // Exam view
    const vC=Object.keys(validated).length;const allV=vC===curColle.questions.length;
    const q=curColle.questions[curQ];
    return<div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div><h1 style={{fontSize:18,fontWeight:800,color:T.text,margin:0}}>{curColle.type} — {curColle.section}</h1><div style={{fontSize:10,color:T.textSec}}>{vC}/{curColle.questions.length} validées</div></div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:T.radiusSm,padding:"4px 12px",display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:12}}>⏱</span><span style={{fontSize:16,fontWeight:800,color:T.accent,fontFamily:"monospace",fontVariantNumeric:"tabular-nums"}}>{fmt(examTime)}</span>
          </div>
          <SecTag s={curColle.section}/>
        </div>
      </div>
      <div style={{height:3,background:T.border,borderRadius:2,marginBottom:6}}><div style={{height:"100%",borderRadius:2,background:T.accent,width:`${(vC/curColle.questions.length)*100}%`,transition:"width .3s"}}/></div>
      <div className="mp-qnav" style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:12}}>
        {curColle.questions.map((_,i)=>{const v=validated[curColle.questions[i].id],c=i===curQ;return<div key={i} onClick={()=>setCurQ(i)} style={{width:28,height:28,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,cursor:"pointer",background:c?T.accent:v?`${T.accent}25`:T.card,color:c?T.bg:v?T.accent:T.textDim,border:`1px solid ${c?T.accent:v?`${T.accent}50`:T.border}`}}>{i+1}</div>})}
      </div>
      {q&&<div style={crd({padding:16,marginBottom:10})}>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
          <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:24,height:24,borderRadius:"50%",fontSize:10,fontWeight:700,background:T.accentBg,color:T.accent}}>{curQ+1}</span>
          {q.type==="QROC"&&<Badge color={T.info}>QROC</Badge>}
          {validated[q.id]&&<Badge color={T.accent}>VALIDÉE</Badge>}
        </div>
        <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:12,lineHeight:1.6}}>{q.question}</div>
        {q.type==="QCM"&&q.options?.map((o,i)=>{const sel=(curAns[q.id]||[]).includes(i);return<div key={i} onClick={()=>toggle(q.id,i)} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 12px",marginBottom:3,borderRadius:T.radiusSm,cursor:"pointer",background:sel?T.accentBg:"transparent",border:`1px solid ${sel?T.accentSoft:T.border}`,transition:"all .15s"}}>
          <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:22,height:22,borderRadius:5,fontSize:11,fontWeight:700,flexShrink:0,background:sel?T.accent:T.bg,color:sel?T.bg:T.textDim}}>{o.label}</span><span style={{fontSize:13,color:T.text,lineHeight:1.5}}>{o.text}</span>
        </div>})}
        {q.type==="QROC"&&<input value={qrocAns[q.id]||""} onChange={e=>{setQrocAns(p=>({...p,[q.id]:e.target.value}));setValidated(p=>{const n={...p};delete n[q.id];return n})}} placeholder="1-4 mots max" maxLength={60} style={inp}/>}
        <div style={{display:"flex",gap:6,marginTop:12}}>
          {!validated[q.id]&&<Btn onClick={()=>{setValidated(p=>({...p,[q.id]:true}));if(curQ<curColle.questions.length-1){let n=curQ+1;while(n<curColle.questions.length&&validated[curColle.questions[n].id])n++;if(n<curColle.questions.length)setCurQ(n)}}}>✓ Valider</Btn>}
          {validated[q.id]&&curQ<curColle.questions.length-1&&<Btn v="secondary" onClick={()=>setCurQ(Math.min(curQ+1,curColle.questions.length-1))}>Suivante →</Btn>}
          {curQ>0&&<Btn v="ghost" onClick={()=>setCurQ(curQ-1)}>← Préc.</Btn>}
        </div>
      </div>}
      <div style={{position:"sticky",bottom:0,padding:"10px 0",background:T.bg,borderTop:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:10}}>
        <Btn onClick={submitColle} disabled={!allV}>📝 Soumettre ({vC}/{curColle.questions.length})</Btn>
        {!allV&&<span style={{fontSize:10,color:T.textDim}}>Validez toutes les questions</span>}
        <span style={{marginLeft:"auto",fontSize:11,color:T.textSec,fontVariantNumeric:"tabular-nums"}}>⏱ {fmt(examTime)}</span>
      </div>
    </div>;
  };

  const settingsP=()=>{
    if(!isAdmin) return<div><h1 style={{fontSize:24,fontWeight:800,color:T.text}}>Paramètres</h1><p style={{color:T.textDim,fontSize:13,marginTop:8}}>Seul l'admin peut modifier les paramètres.</p></div>;
    const sec=blocked?(settings.section==="Médecine"?"Dentaire":"Médecine"):settings.section||"Médecine";
    const secC=courses.filter(c=>c.section===sec);
    return<div>
      <h1 style={{fontSize:24,fontWeight:800,color:T.text,marginBottom:14}}>Paramètres</h1>
      <div style={crd({marginBottom:12})}>
        <h3 style={{fontSize:13,fontWeight:700,color:T.text,marginTop:0,marginBottom:4}}>📋 Cours prochaine colle</h3>
        <div style={{fontSize:10,color:T.textSec,marginBottom:8}}>Sélection pour {sec}. Vide = aléatoire.</div>
        <div style={{maxHeight:200,overflowY:"auto"}}>
          {secC.map(c=>{const sel=(settings.selectedCourses||[]).includes(c.id);return<div key={c.id} onClick={async()=>{const cur=settings.selectedCourses||[];const next=cur.includes(c.id)?cur.filter(x=>x!==c.id):[...cur,c.id];await setServerState('settings',{...settings,selectedCourses:next});refresh()}} style={{...crd({padding:"8px 12px",marginBottom:3,cursor:"pointer"}),background:sel?T.accentBg:T.card,borderColor:sel?`${T.accent}50`:T.border,display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:18,height:18,borderRadius:5,border:`2px solid ${sel?T.accent:T.borderLight}`,background:sel?T.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>{sel&&<span style={{color:T.bg,fontSize:11,fontWeight:800}}>✓</span>}</div>
            <span style={{fontSize:12,color:T.text,fontWeight:600}}>{c.title}</span>
          </div>})}
        </div>
      </div>
      <div style={crd({marginBottom:12})}>
        <h3 style={{fontSize:13,fontWeight:700,color:T.text,marginTop:0,marginBottom:8}}>⏱ Timer</h3>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          <Btn onClick={timer.active?stopTimer:startTimer} v={timer.active?"danger":"primary"}>{timer.active?"⏹ Stop":"▶ Lancer"}</Btn>
          {timer.active&&<Badge color={T.accent}>ACTIF</Badge>}
        </div>
        <label style={{fontSize:10,color:T.textSec,display:"block",marginBottom:3}}>Minutes</label>
        <input type="number" value={timer.minutes||25} onChange={async e=>{await setServerState('timer',{...timer,minutes:Math.max(1,parseInt(e.target.value)||25)});refresh()}} style={{...inp,width:80,marginBottom:8}}/>
        <label style={{fontSize:10,color:T.textSec,display:"block",marginBottom:3}}>Cours/colle</label>
        <input type="number" value={settings.nCourses||3} onChange={async e=>{await setServerState('settings',{...settings,nCourses:Math.max(1,parseInt(e.target.value)||3)});refresh()}} style={{...inp,width:80,marginBottom:8}}/>
        <label style={{fontSize:10,color:T.textSec,display:"block",marginBottom:3}}>Section</label>
        <div style={{display:"flex",gap:6}}>
          {["Médecine","Dentaire"].map(s=><button key={s} onClick={async()=>{await setServerState('settings',{...settings,section:s});refresh()}} style={{...bst(settings.section===s?(s==="Médecine"?"med":"dent"):"secondary"),fontSize:11,padding:"6px 14px"}}>{s}</button>)}
        </div>
        <label style={{fontSize:10,color:T.textSec,display:"block",marginBottom:3,marginTop:10}}>Difficulté QCM</label>
        <div style={{display:"flex",gap:6}}>
          {[["easy","🟢 Facile"],["medium","🟡 Moyen"],["hard","🔴 Difficile"]].map(([v,l])=><button key={v} onClick={()=>setDifficulty(v)} style={{...bst(difficulty===v?"primary":"secondary"),fontSize:11,padding:"6px 12px"}}>{l}</button>)}
        </div>
      </div>
      <div style={crd({marginBottom:12})}>
        <h3 style={{fontSize:13,fontWeight:700,color:T.text,marginTop:0,marginBottom:6}}>Notation /20</h3>
        <div style={{fontSize:11,color:T.textSec,lineHeight:2}}>
          <div><span style={{color:T.accent,fontWeight:700}}>0 err</span> → 1pt</div>
          <div><span style={{color:T.warn,fontWeight:700}}>1 err</span> → 0.5pt</div>
          <div><span style={{color:T.warn,fontWeight:700}}>2 err</span> → 0.2pt</div>
          <div><span style={{color:T.danger,fontWeight:700}}>3+</span> → 0pt</div>
          <div style={{marginTop:4,color:T.accent}}>Note/20 = (score/nb questions) × 20</div>
        </div>
      </div>
    </div>;
  };

  const rankP=()=>{
    const last=hist[0];
    if(!last) return<div><h1 style={{fontSize:24,fontWeight:800,color:T.text}}>Classement</h1><div style={{textAlign:"center",padding:40,color:T.textDim,fontSize:13}}>Passez une colle.</div></div>;
    return<div><h1 style={{fontSize:24,fontWeight:800,color:T.text,marginBottom:14}}>Classement</h1>
      <div style={{...crd({padding:0}),maxHeight:"70vh",overflowY:"auto"}}>
        {results?.ranking?.map((st,i)=><div key={st.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",borderBottom:`1px solid ${T.border}`,background:st.isMe?T.accentBg:"transparent"}}>
          <Rk rank={i+1}/><div style={{flex:1,fontSize:11,fontWeight:st.isMe?800:400,color:st.isMe?T.accent:T.text}}>{st.name}</div><span style={{fontSize:12,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{st.note20?.toFixed(1)||"—"}/20</span>
        </div>)||<div style={{padding:20,color:T.textDim,fontSize:12}}>Dernière colle: {to20(last.score,last.total).toFixed(1)}/20</div>}
      </div></div>;
  };

  // NAV
  const nav=[{id:"dashboard",l:"Dashboard",i:"📊"},{id:"courses",l:"Cours",i:"📚"},{id:"colle",l:"Colle",i:"📝"},{id:"ranking",l:"Classement",i:"🏆"},{id:"settings",l:"Paramètres",i:"⚙️"}];

  return<div style={{display:"flex",flexDirection:mobile?"column":"row",height:"100vh",fontFamily:font,background:T.bg,color:T.text,overflow:"hidden"}}>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/>
    <style>{`
      @media(max-width:767px){
        .mp-stats{flex-direction:column!important}
        .mp-stats>div{min-width:auto!important}
        .mp-qnav>div{width:26px!important;height:26px!important;fontSize:9px!important}
        .mp-launch{flex-direction:column!important}
        .mp-launch>div{min-width:auto!important}
      }
      input,textarea,button{font-size:16px!important}
      @media(min-width:768px){input,textarea,button{font-size:13px!important}}
    `}</style>

    {/* Desktop sidebar */}
    {!mobile&&<div style={{width:170,flexShrink:0,background:T.surface,borderRight:`1px solid ${T.border}`,display:"flex",flexDirection:"column",padding:"12px 8px"}}>
      <div style={{padding:"0 6px",marginBottom:16}}><div style={{fontSize:18,fontWeight:900,color:T.accent,letterSpacing:"-1px"}}>MedPrep</div><div style={{fontSize:8,color:T.textDim,letterSpacing:"1.5px",textTransform:"uppercase"}}>v4 · Partagé</div></div>
      <nav style={{display:"flex",flexDirection:"column",gap:2}}>
        {nav.map(n=>{const a=page===n.id;return<button key={n.id} onClick={()=>setPage(n.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:T.radiusSm,background:a?T.accentBg:"transparent",border:a?`1px solid ${T.accentSoft}`:"1px solid transparent",color:a?T.accent:T.textSec,fontSize:11,fontWeight:a?700:500,cursor:"pointer",fontFamily:font,textAlign:"left"}}><span style={{fontSize:13}}>{n.i}</span>{n.l}</button>})}
      </nav>
      <div style={{flex:1}}/>
      <div style={{...crd({padding:"8px 10px"}),background:T.card}}>
        <div style={{fontSize:9,color:T.textDim}}>Connecté</div>
        <div style={{fontSize:11,fontWeight:700,color:T.text}}>{user.name}</div>
        {isAdmin&&<div style={{fontSize:9,color:T.accent}}>Admin</div>}
        <button onClick={()=>{setUser(null);sessionStorage.removeItem('mp_admin_key')}} style={{background:"none",border:"none",color:T.textDim,cursor:"pointer",fontSize:10,marginTop:4,padding:0}}>Déconnexion</button>
      </div>
    </div>}

    {/* Mobile header */}
    {mobile&&<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",background:T.surface,borderBottom:`1px solid ${T.border}`,flexShrink:0}}>
      <div style={{fontSize:16,fontWeight:900,color:T.accent}}>MedPrep</div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:11,color:T.text,fontWeight:600}}>{user.name}</span>
        {isAdmin&&<Badge color={T.accent}>ADM</Badge>}
        <button onClick={()=>{setUser(null);sessionStorage.removeItem('mp_admin_key')}} style={{background:"none",border:"none",color:T.textDim,cursor:"pointer",fontSize:10,padding:0}}>↪</button>
      </div>
    </div>}

    {/* Main content */}
    <main style={{flex:1,overflowY:"auto",padding:mobile?"14px 12px 80px":"18px 22px",WebkitOverflowScrolling:"touch"}}>
      <div style={{maxWidth:800,margin:"0 auto"}}>
        {loading&&<Dots msg="Génération via l'API..."/>}
        {!loading&&page==="dashboard"&&dashPage()}
        {!loading&&page==="courses"&&coursesP()}
        {!loading&&page==="colle"&&colleP()}
        {!loading&&page==="ranking"&&rankP()}
        {!loading&&page==="settings"&&settingsP()}
      </div>
    </main>

    {/* Mobile bottom nav */}
    {mobile&&<div style={{display:"flex",justifyContent:"space-around",alignItems:"center",padding:"6px 0 env(safe-area-inset-bottom, 6px)",background:T.surface,borderTop:`1px solid ${T.border}`,flexShrink:0,position:"fixed",bottom:0,left:0,right:0,zIndex:100}}>
      {nav.map(n=>{const a=page===n.id;return<button key={n.id} onClick={()=>setPage(n.id)} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"6px 8px",background:"none",border:"none",cursor:"pointer",color:a?T.accent:T.textDim}}>
        <span style={{fontSize:18}}>{n.i}</span>
        <span style={{fontSize:8,fontWeight:a?700:500}}>{n.l}</span>
      </button>})}
    </div>}
  </div>;
}
