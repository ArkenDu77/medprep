import { useState } from "react";
export default function App() {
  const [count, setCount] = useState(0);
  return (
    <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#06080d",color:"white",fontFamily:"sans-serif"}}>
      <div style={{textAlign:"center"}}>
        <h1 style={{color:"#00dba4",fontSize:32}}>MedPrep</h1>
        <p>Test: le site fonctionne</p>
        <button onClick={()=>setCount(c=>c+1)} style={{padding:"10px 20px",background:"#00dba4",border:"none",borderRadius:8,cursor:"pointer",fontSize:16}}>{count} clics</button>
      </div>
    </div>
  );
}
