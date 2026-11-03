"use strict";

/**
 * Browser-only, dependency-free read-only console.
 * Never persist bearer tokens or load content from remote origins.
 */
const $ = (id) => document.getElementById(id);
const state = { view:"overview", project:"", paused:false, pages:new Map(), active:null, sync:0 };
const titles = {
  overview:["Vue générale","Suivi des événements observés, traitements et apprentissages persistés."],
  events:["Événements","Métadonnées normalisées et historiques, sans transcriptions brutes."],
  sessions:["Sessions","Sessions natives, état final et filiation lorsqu'elle est observable."],
  jobs:["Traitements","Jobs persistés, reprises, échecs et file d'attente."],
  memories:["Mémoires","Connaissances conservées avec portée, version et preuves."],
  proposals:["Candidats","Propositions déclaratives et progression du cycle de validation."],
  evaluations:["Évaluations","Décisions fondées sur les mesures de replay et de régression."],
  releases:["Publications","Versions publiées, révisions Git et retours arrière."],
  audit:["Journal d'audit","Historique des transitions et opérations enregistrées."],
  sources:["Connecteurs","Instances provider déclarées dans le profil local."],
  inference:["Inférence / coûts","Utilisation enregistrée et estimations de consommation."]
};
const columns = {
  events:[["at","Observé"],["type","Événement"],["outcome","Issue"],["projectId","Projet"],["metadata.toolName","Outil"],["sessionId","Session"]],
  sessions:[["at","Démarrée"],["sessionId","Session"],["projectId","Projet"],["status","Statut"],["finishedAt","Terminée"]],
  jobs:[["at","Créé"],["type","Job"],["projectId","Projet"],["status","Statut"],["attempts","Tentatives"],["errorCode","Erreur"]],
  memories:[["at","Créée"],["title","Mémoire"],["type","Type"],["status","Statut"],["evidenceCount","Preuves"],["projectId","Projet"]],
  proposals:[["at","Créé"],["type","Type"],["status","Statut"],["projectId","Projet"],["evidenceCount","Preuves"],["digest","Digest"]],
  evaluations:[["at","Créée"],["status","Statut"],["baselineScore","Baseline"],["candidateScore","Candidat"],["samples","Échantillons"],["projectId","Projet"]],
  releases:[["at","Créée"],["logicalKey","Ressource"],["type","Type"],["status","Statut"],["versionId","Version"],["projectId","Projet"]],
  audit:[["at","Horodatage"],["actor","Acteur"],["type","Action"],["subjectType","Objet"],["subjectId","Identifiant"],["projectId","Projet"]],
  sources:[["at","Dernière modification"],["type","Provider"],["runtimeVersion","Version"],["launcher","Lanceur"],["id","Instance"]],
  inference:[["at","Horodatage"],["type","Backend"],["modelName","Modèle"],["inputTokens","Entrée"],["outputTokens","Sortie"],["estimatedCostMicrousd","Estimation µ$"]]
};
const statusWords = {
  accepted:"Accepté",duplicate:"Doublon",running:"En cours",completed:"Terminé",
  succeeded:"Réussi",success:"Réussi",failed:"Échec",dead:"Abandonné",leased:"Réservé",
  queued:"En attente",cancelled:"Annulé",blocked:"Bloqué",unknown:"Inconnu",
  eligible:"Éligible",draft:"Brouillon",promoted:"Promu",evaluating:"Évaluation",
  inconclusive:"Non concluant",passed:"Validé",rejected:"Rejeté",active:"Actif",
  superseded:"Remplacé",rolled_back:"Annulé",published:"Publié",candidate:"Candidat",
  staged:"Préparé",archived:"Archivé",diagnostic:"Diagnostic"
};
const statusKey = (value) => {
  const text = String(value??"").toLowerCase();
  if(["passed","succeeded","success","completed","published","active","eligible","promoted"].includes(text)) return "success";
  if(["failed","dead","blocked","rejected","cancelled"].includes(text))return "warning";
  return "muted";
};
const display = (v) => v===null||v===undefined||v===""?"—":typeof v==="object"?JSON.stringify(v):String(v);
const number = (v) => Intl.NumberFormat("fr-FR").format(Number(v||0));
const date = (v) => {
  if(!v)return "—";
  const value=new Date(v);
  return Number.isNaN(value.getTime())?String(v):new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(value);
};
const short = (value,n=38) => {
  const s=display(value);
  return s.length>n?s.slice(0,n-1)+"…":s;
};
const make = (tag,cls,value) => {
  const e=document.createElement(tag);
  if(cls)e.className=cls;
  if(value!==undefined)e.textContent=String(value);
  return e;
};
function clear(node){node.replaceChildren();}
function setConnection(ok){
  const node=$("connection");
  node.className="connection "+(ok?"online":"offline");
  node.replaceChildren(make("span","led"),document.createTextNode(ok?"Connecté":"Déconnecté"));
}
function notice(message){
  const n=$("notice");
  n.hidden=!message;
  n.textContent=message||"";
}
async function get(path){
  const response=await fetch("/ui/api/"+path,{credentials:"same-origin",cache:"no-store"});
  if(!response.ok)throw new Error(response.status===401?"Session expirée. Relancez la commande 'adaptive-harness ui'.":"Erreur HTTP "+response.status);
  return response.json();
}
const query = (project) => project?"projectId="+encodeURIComponent(project):"";
function projectName(id){
  if(!id)return "Global";
  const p=state.active?.projects?.find(x=>x.id===id);
  return p?.name||short(id,22);
}
function valueOf(record,key){
  let v=key.split(".").reduce((o,k)=>o?.[k],record);
  if(key==="projectId")return projectName(v);
  if(key==="at"||key==="occurredAt"||key==="finishedAt"||key==="publishedAt"||key==="updatedAt")return date(v);
  if(key==="baselineScore"||key==="candidateScore")return v==null?"—":(100*Number(v)).toFixed(1)+" %";
  if(key==="estimatedCostMicrousd")return (Number(v||0)/1e6).toFixed(6)+" $";
  if(key==="outcome"||key==="status")return statusWords[v]||display(v);
  return display(v);
}
function showDetails(title,record){
  $("drawer-title").textContent=title;
  const body=$("drawer-content");clear(body);
  for(const [key,val] of Object.entries(record)){
    const f=make("div","detail-field");
    f.append(make("strong","",key));
    const displayed=key==="projectId"?projectName(val)+" ("+display(val)+")":val;
    f.append(make("code","",typeof displayed==="object"?JSON.stringify(displayed,null,2):display(displayed)));
    body.append(f);
  }
  $("drawer").hidden=false;$("drawer-overlay").hidden=false;
  $("drawer-close").focus();
}
function closeDetails(){
  $("drawer").hidden=true;$("drawer-overlay").hidden=true;
}
function renderProjects(projects){
  const select=$("project"),current=state.project;
  clear(select);
  select.add(new Option("Tous les projets",""));
  for(const project of projects)select.add(new Option(project.name+" · "+short(project.id,12),project.id));
  select.value=current;
  if(select.selectedIndex===-1){state.project="";select.value="";}
}
function metric(label,value,foot,symbol){
  const card=make("article","metric");
  const caption=make("div","metric-label");
  caption.append(document.createTextNode(label),make("span","",symbol));
  card.append(caption,make("div","metric-number",number(value)),make("div","metric-foot",foot));
  return card;
}
function renderMetrics(m){
  const container=$("metrics");clear(container);
  container.append(
    metric("Événements",m.events,"Traces normalisées","◷"),
    metric("Sessions",m.sessions,number(m.running)+" encore en cours","▣"),
    metric("Traitements en attente",m.queued,number(m.retrying)+" en reprise","≋"),
    metric("Mémoires publiées",m.memories,number(m.proposals)+" candidatures","◇"),
    metric("Appels en échec",m.failedTools,"Outils observés","!"),
    metric("Jobs abandonnés",m.dead,"Après épuisement des tentatives","×"),
    metric("Publications actives",m.releases,number(m.evaluations)+" évaluations","⇄"),
    metric("Diagnostics",m.diagnostics,"Incluant les signaux de boucle","⬡")
  );
}
function renderChart(activity){
  const el=$("chart");clear(el);
  const entries=activity.slice(-24);
  while(entries.length<24)entries.unshift({hour:"",events:0,failures:0});
  const max=Math.max(1,...entries.map(x=>Number(x.events)));
  for(const a of entries){
    const node=make("div","chart-bar");
    node.style.height=(Math.max(0,Number(a.events))/max*100)+"%";
    node.title=(a.hour||"Aucun créneau")+": "+number(a.events)+" événements, "+number(a.failures)+" échecs";
    el.append(node);
  }
  const axis=$("chart-axis");clear(axis);
  const anchors=[entries[0]?.hour,entries[12]?.hour,entries[23]?.hour];
  for(const h of anchors)axis.append(make("span","",h?h.replace("T"," · ")+" h":"—"));
  el.setAttribute("aria-label","Historique sur 24 créneaux. Total "+number(entries.reduce((s,x)=>s+Number(x.events),0))+" événements");
}
function renderQueue(jobs,usage){
  const node=$("job-states");clear(node);
  const total=Math.max(1,jobs.reduce((s,x)=>s+Number(x.count),0));
  for(const status of ["queued","leased","succeeded","failed","dead"]){
    const found=jobs.find(x=>x.status===status),count=Number(found?.count||0);
    const item=make("div","job-row");item.dataset.status=status;
    item.append(make("span","",statusWords[status]||status));
    const track=make("div","job-track"),fill=make("div","job-fill");
    fill.style.width=Math.round(count/total*100)+"%";track.append(fill);item.append(track,make("span","job-count",number(count)));
    node.append(item);
  }
  $("cost").textContent=(Number(usage?.estimatedCostMicrousd||0)/1e6).toFixed(5)+" $";
  $("tokens").textContent=number(usage?.inputTokens)+" / "+number(usage?.outputTokens);
}
function renderActivity(overview){
  const node=$("activity");clear(node);
  const combined=[
    ...overview.recentEvents.map(x=>({...x,category:"event",itemTitle:x.type,description:(x.metadata?.toolName||x.sessionId)+" · "+projectName(x.projectId)})),
    ...overview.recentAudit.map(x=>({...x,category:"audit",itemTitle:x.type,description:x.actor+" · "+projectName(x.projectId)}))
  ].sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,14);
  if(!combined.length){node.append(make("div","empty-inline","Aucune activité persistée pour ce projet."));return;}
  for(const item of combined){
    const row=make("button","activity-row");
    row.type="button";
    const mark=make("span","activity-mark "+(item.outcome==="failed"?"warn":item.outcome==="succeeded"?"ok":""));
    const copy=make("span","");
    copy.append(make("span","activity-title",item.itemTitle),make("span","activity-note",item.description));
    row.append(mark,copy,make("time","activity-time",date(item.at)));
    row.addEventListener("click",()=>showDetails(item.itemTitle,item));
    node.append(row);
  }
}
function renderSources(sources){
  const container=$("connectors");clear(container);
  if(!sources.length){container.append(make("div","empty-inline","Aucun connecteur enregistré."));return;}
  for(const item of sources){
    const card=make("div","connector");
    card.append(make("strong","",String(item.type).toUpperCase()+" · "+short(item.runtimeVersion||"Version inconnue",30)),
      make("small","",String(item.launcher||"unknown")+" · "+short(item.id,24)));
    container.append(card);
  }
}
function renderOverview(data){
  state.active=data;
  renderProjects(data.projects);
  renderMetrics(data.metrics);
  renderChart(data.activity||[]);
  renderQueue(data.jobs||[],data.usage);
  renderActivity(data);
  renderSources(data.sources||[]);
  $("last-event").textContent=data.lastEventAt?"Dernier événement : "+date(data.lastEventAt):"Aucun événement observé";
  $("last-sync").textContent=date(data.observedAt);
}
function historyKey(){return state.project+"|"+state.view;}
function renderRows(){
  const page=state.pages.get(historyKey());
  if(!page)return;
  const kind=state.view,fields=columns[kind],head=$("table-head"),body=$("table-body");
  clear(head);clear(body);
  const tr=document.createElement("tr");
  for(const [,label] of fields)tr.append(make("th","",label));
  head.append(tr);
  const filter=$("filter").value.trim().toLowerCase();
  const rows=page.items.filter(r=>!filter||JSON.stringify(r).toLowerCase().includes(filter));
  for(const item of rows){
    const row=make("tr","data-row");
    row.tabIndex=0;
    row.addEventListener("click",()=>showDetails(kind+" · "+short(item.id||item.sessionId||item.cursor,33),item));
    row.addEventListener("keydown",e=>{if(e.key==="Enter")row.click();});
    for(const [key] of fields){
      const cell=document.createElement("td");
      const val=valueOf(item,key);
      if(key==="status"||key==="outcome"){
        cell.append(make("span","pill "+statusKey(item[key]),val));
      }else{
        const id=/^(id|sessionId|sourceId|versionId|subjectId|digest|projectId)$/.test(key);
        cell.append(make("span","cell-clip"+(id?" cell-id":""),short(val,80)));
      }
      row.append(cell);
    }
    body.append(row);
  }
  $("records-count").textContent=number(rows.length)+" résultat"+(rows.length>1?"s":"");
  $("page-state").textContent=number(page.items.length)+" entrées chargées · "+(page.hasMore?"Historique disponible":"Fin de l’historique");
  $("load-more").hidden=!page.hasMore;
  $("empty").hidden=rows.length>0;
}
async function loadHistory(older=false){
  const kind=state.view,project=state.project;
  if(kind==="overview"||state.loading)return;
  const key=project+"|"+kind;
  const existing=state.pages.get(key);
  if(older&&(!existing||!existing.hasMore))return;
  const before=older?existing.nextCursor:null;
  const search=new URLSearchParams({kind,limit:"50"});
  if(project)search.set("projectId",project);
  if(before)search.set("before",String(before));
  state.loading=true;
  try{
    const data=await get("history?"+search);
    if(kind!==state.view||project!==state.project)return;
    if(older){
      const known=new Set(existing.items.map(x=>x.cursor));
      const additions=data.items.filter(x=>!known.has(x.cursor));
      state.pages.set(key,{items:existing.items.concat(additions).slice(0,500),hasMore:data.hasMore,nextCursor:data.nextCursor});
    }else{
      const olderRows=existing?.items||[];
      const known=new Set(data.items.map(x=>x.cursor));
      state.pages.set(key,{items:data.items.concat(olderRows.filter(x=>!known.has(x.cursor))).slice(0,500),
        hasMore:existing?.hasMore||data.hasMore,nextCursor:existing?.nextCursor||data.nextCursor});
    }
    renderRows();
    setConnection(true);
  }catch(err){setConnection(false);notice(err.message);}
  finally{state.loading=false;}
}
async function refresh(){
  const current=++state.sync,project=state.project;
  try{
    const suffix=query(project);
    const data=await get("overview"+(suffix?"?"+suffix:""));
    if(current!==state.sync||project!==state.project)return;
    renderOverview(data);
    setConnection(true);notice("");
    if(state.view!=="overview")await loadHistory();
  }catch(err){if(current===state.sync){setConnection(false);notice(err.message);}}
}
function navigate(view){
  if(!titles[view])return;
  state.view=view;
  $("title").textContent=titles[view][0];
  $("subtitle").textContent=titles[view][1];
  $("breadcrumb").textContent=titles[view][0].toUpperCase();
  $("overview").hidden=view!=="overview";
  $("records").hidden=view==="overview";
  for(const button of document.querySelectorAll("[data-view]"))button.classList.toggle("active",button.dataset.view===view);
  $("filter").value="";
  if(view!=="overview"){
    const p=state.pages.get(historyKey());
    if(p)renderRows();
    else void loadHistory();
  }
}
for(const button of document.querySelectorAll("[data-view]")){
  button.addEventListener("click",()=>navigate(button.dataset.view));
}
$("project").addEventListener("change",()=>{
  state.project=$("project").value;
  state.sync++;
  const page=state.pages.get(historyKey());
  if(page)renderRows();
  else if(state.view!=="overview")$("table-body").replaceChildren();
  void refresh();
});
$("filter").addEventListener("input",renderRows);
$("load-more").addEventListener("click",()=>void loadHistory(true));
$("refresh").addEventListener("click",()=>void refresh());
$("pause").addEventListener("click",()=>{
  state.paused=!state.paused;
  $("pause").textContent=state.paused?"▶ Reprendre":"⏸ Pause";
  $("pause").setAttribute("aria-pressed",String(state.paused));
  if(!state.paused)void refresh();
});
$("see-events").addEventListener("click",()=>navigate("events"));
$("drawer-close").addEventListener("click",closeDetails);
$("drawer-overlay").addEventListener("click",closeDetails);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeDetails();});
setInterval(()=>{if(!state.paused && document.visibilityState==="visible")void refresh();},4000);
void refresh();
