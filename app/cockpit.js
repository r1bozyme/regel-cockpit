/* cockpit.js – Hauptcode des Regel-Cockpits (bis 17.11.2026 inline in index.html).
   Wird vom Loader am Ende von index.html nach scrub.js geladen. Die Build-Kennung
   steht in index.html (<meta name="app-build">), nicht hier. */
(function(){
"use strict";
var CFG_KEY="fc-sync", API="https://api.github.com";
var BUILD=(document.querySelector('meta[name="app-build"]')||{}).content||"?";
var $=function(s){return document.querySelector(s)};
var D={rules:null,snap:null,weekly:null,state:null,stateSha:null,err:null};

/* ─── Formatierung ─── */
function eur(v,d){d=d||0;return v==null||isNaN(v)?"–":v.toLocaleString("de-DE",{minimumFractionDigits:d,maximumFractionDigits:d})+" €"}
function usd(v){return "$"+v.toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}
function pct(v,d){d=d==null?1:d;return (v*100).toLocaleString("de-DE",{minimumFractionDigits:d,maximumFractionDigits:d})+" %"}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function dDE(iso){return new Date(iso+"T12:00:00").toLocaleDateString("de-DE")}
/* Kalendertage bis zu einem Datum (Ortszeit): 0 = heute, 1 = morgen, <0 = vorbei.
   Früher Math.ceil auf eine Uhrzeit – am Stichtag selbst stand dann „noch 1 Tag“, abends „-0“. */
function calDays(iso){var a=new Date(),t=new Date(iso+"T00:00:00");a.setHours(0,0,0,0);return Math.round((t-a)/864e5)}
function tageText(n){return n===0?"heute":n===1?"morgen":n<0?"vorbei":"noch "+n.toLocaleString("de-DE")+" Tage"}
/* Z0 bewertet an EINER Stelle für Status-Kachel und Wochenschluss-Karte (vorher widersprachen sie sich).
   Upside = WOCHENschluss (letzter NYSE-Handelstag der Woche) über der Schwelle, präzisiert am 17.11.2026:
   ein einzelner Tagesschluss lässt Z0 nicht entfallen. Zählt nur VOR dem Termin und erst nach der
   Festlegung von Z0 (rules.json: nio.stufe0.z0Festgelegt). */
function z0Seit(){return D.rules.nio.stufe0.z0Festgelegt||"2026-11-04"}
function z0Lage(){
  var N=D.rules.nio,z0=N.stufe0.z0Datum,up=N.upsideUsd,w=(D.weekly&&D.weekly.nio)||[];
  var hit=w.find(function(x){return x.closeUsd>up&&x.datum>z0Seit()&&(!z0||x.datum<z0)})||null;
  return {z0:z0,up:up,hit:hit,tage:z0?calDays(z0):null};
}
/* Fehlende NIO-Wochenschlüsse: jede Woche (Mo–Fr) zwischen erstem Eintrag und der letzten fälligen Woche
   braucht einen Eintrag. Fällig ist eine Woche ab Samstag 10 Uhr (Task läuft samstags 8:50). Ein Eintrag
   an einem anderen Wochentag (Feiertag, z. B. Karfreitag) deckt seine Woche ab. */
function fehlendeWochen(){
  var w=(D.weekly&&D.weekly.nio)||[];if(!w.length)return [];
  function mo(iso){var d=new Date(iso+"T12:00:00");d.setDate(d.getDate()-((d.getDay()+6)%7));return d}
  function key(d){return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate()}
  var have={};w.forEach(function(x){have[key(mo(x.datum))]=1});
  var now=new Date(),last=new Date(now);last.setDate(now.getDate()-((now.getDay()+6)%7));last.setHours(12,0,0,0);
  var sat10=new Date(last);sat10.setDate(last.getDate()+5);sat10.setHours(10,0,0,0);
  if(now<sat10)last.setDate(last.getDate()-7);
  var out=[];for(var d=mo(w[0].datum);d<=last;d.setDate(d.getDate()+7)){
    if(!have[key(d)]){var f=new Date(d);f.setDate(d.getDate()+4);out.push(f.toLocaleDateString("de-DE"))}}
  return out;
}
/* Erreichte Verkaufsstufen (Kurs in EUR ≥ Stufe). Ob schon verkauft wurde, kann das Cockpit nicht wissen –
   es nennt den Bestand, damit man es sieht. */
function wochenText(fw){return fw.length>3?fw.length+" Wochen, zuletzt "+fw.slice(-3).join(", "):fw.join(", ")}
function erreichteStufen(stufen,kursEur){return (stufen||[]).filter(function(t){return kursEur>=t.eur})}

/* ─── Konfiguration (Token nur lokal) ─── */
function cfg(){try{return JSON.parse(localStorage.getItem(CFG_KEY))||{}}catch(e){return {}}}
function saveCfg(c){try{localStorage.setItem(CFG_KEY,JSON.stringify(c))}catch(e){}}
function configured(){var c=cfg();return !!(c.token&&c.owner&&c.repo)}
function showSetup(on,fromBack){
  if(!on&&!fromBack&&typeof backLayerClose==="function")backLayerClose();
  var c=cfg();$("#setup").hidden=!on;$("#main").hidden=on&&!D.snap;
  if(on){$("#cfg-owner").value=c.owner||"";$("#cfg-repo").value=c.repo||"finance-data";$("#cfg-token").value="";$("#cfg-cancel").hidden=!configured()}
}
$("#cfg-btn").onclick=function(){var on=$("#setup").hidden;showSetup(on);if(on)backLayerOpen()};
$("#cfg-cancel").onclick=function(){showSetup(false)};
$("#setup").addEventListener("submit",function(e){
  e.preventDefault();var c=cfg();
  c.owner=$("#cfg-owner").value.trim();c.repo=$("#cfg-repo").value.trim();
  var t=$("#cfg-token").value.trim();if(t)c.token=t;
  saveCfg(c);showSetup(false);load();
});

/* ─── GitHub Contents API ─── */
function unb64(s){var bin=atob(s.replace(/\s/g,"")),b=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)b[i]=bin.charCodeAt(i);return new TextDecoder().decode(b)}
function b64(str){var bytes=new TextEncoder().encode(str),s="";for(var i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(s)}
function gh(path,opts){
  var c=cfg();opts=opts||{};
  opts.headers=Object.assign({"Authorization":"Bearer "+c.token,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"},opts.headers||{});
  opts.cache="no-store";
  return fetch(API+"/repos/"+c.owner+"/"+c.repo+"/contents/"+path,opts);
}
function hint(status){return status===401?"Token ungültig oder abgelaufen. Unter „Verbindung“ einen neuen eintragen."
  :status===403?"Token hat keine Rechte auf dieses Repo (Contents: Read and write)."
  :status===404?"Datei oder Repo nicht gefunden. Repo-Name und Token-Freigabe prüfen."
  :"GitHub antwortet mit HTTP "+status+"."}
function getJSON(path){
  return gh(path).then(function(r){
    if(!r.ok){var e=new Error(hint(r.status));e.status=r.status;throw e}
    return r.json().then(function(j){return {data:JSON.parse(unb64(j.content)),sha:j.sha}});
  });
}

function load(){
  if(!configured()){showSetup(true);$("#fresh").textContent="Nicht verbunden";return}
  $("#reload").disabled=true;$("#fresh").textContent="Lädt …";
  Promise.all(["rules.json","snapshot.json","weekly.json","state.json"].map(function(p){return getJSON(p).catch(function(e){return {error:e}})}))
  .then(function(res){
    var bad=res.filter(function(r){return r.error});
    D.err=bad.length?bad[0].error.message:null;
    if(!res[0].error)D.rules=res[0].data;
    if(!res[1].error)D.snap=res[1].data;
    if(!res[2].error)D.weekly=res[2].data;
    if(!res[3].error){D.state=res[3].data;D.stateSha=res[3].sha}
    try{localStorage.setItem("fc-cache",JSON.stringify({rules:D.rules,snap:D.snap,weekly:D.weekly,state:D.state}))}catch(e){}
    $("#main").hidden=false;render();
  }).catch(function(e){D.err=e.message||"Netzwerkfehler";render()})
  .then(function(){$("#reload").disabled=false});
}
$("#reload").onclick=load;

/* Offline-Start: letzten Stand aus dem Cache zeigen */
try{var cached=JSON.parse(localStorage.getItem("fc-cache"));if(cached){D.rules=cached.rules;D.snap=cached.snap;D.weekly=cached.weekly;D.state=cached.state}}catch(e){}

/* ─── Puffer speichern ─── */
/* Datum in Ortszeit: toISOString() ist UTC – zwischen 0 und 1 Uhr (Sommerzeit 2 Uhr) stünde sonst der Vortag drin */
function heuteISO(){var d=new Date(),p=function(n){return (n<10?"0":"")+n};return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())}
/* Schreibt den Puffer in state.json. Bei Konflikt (409/422: Datei inzwischen geändert, z. B. durch den
   Monatsreview) einmal den frischen Stand holen, nur den Puffer darauf setzen und erneut schreiben –
   ein blindes zweites PUT würde die fremde Änderung überschreiben. */
function savePuffer(v,base,sha,retry){
  var st=Object.assign({},base||{});st.puffer={wert:v,geaendert:heuteISO(),quelle:"manuell im Cockpit"};
  var body={message:"Puffer "+v+" €",content:b64(JSON.stringify(st,null,1)),branch:"main"};
  if(sha)body.sha=sha;
  return gh("state.json",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
  .then(function(r){
    if((r.status===409||r.status===422)&&!retry){
      return getJSON("state.json").then(function(x){D.state=x.data;D.stateSha=x.sha;return savePuffer(v,x.data,x.sha,true)});
    }
    if(r.status===409||r.status===422)throw new Error("Datei wurde zwischenzeitlich geändert. Bitte noch einmal speichern.");
    if(!r.ok)throw new Error(hint(r.status));
    return r.json().then(function(j){D.stateSha=j.content.sha;D.state=st});
  });
}
$("#puffer-form").addEventListener("submit",function(e){
  e.preventDefault();
  var v=parseFloat($("#puffer").value);if(isNaN(v))return;
  var btn=$("#puffer-save");btn.disabled=true;$("#puffer-msg").textContent="Speichert …";
  savePuffer(v,D.state,D.stateSha,false)
  .then(function(){$("#puffer-msg").textContent="Gespeichert";render()})
  .catch(function(e){$("#puffer-msg").textContent=e.message})
  .then(function(){btn.disabled=false});
});

/* ─── Ableitungen ─── */
function derive(){
  var s=D.snap,R=D.rules;if(!s||!R)return null;
  var pos=s.positionen||[];
  var by=function(id){return pos.find(function(p){return p.id===id})};
  var val=function(id){var p=by(id);return p?p.wertEur:0};
  var total=pos.reduce(function(a,p){return a+(p.wertEur||0)},0);
  var etf=R.etf.reduce(function(a,id){return a+val(id)},0);
  var crypto=pos.filter(function(p){return p.typ==="crypto"||R.kryptoIsin.indexOf(p.id)>=0}).reduce(function(a,p){return a+p.wertEur},0);
  var nio=by(R.nio.isin),baba=by(R.baba.isin),grab=by(R.grab.isin);
  var nv=nio?nio.wertEur:0,bv=baba?baba.wertEur:0,gv=grab?grab.wertEur:0;
  return {total:total,etf:etf,crypto:crypto,other:total-etf-nv-bv-gv-crypto,nio:nio,baba:baba,grab:grab,fx:s.fxUsdJeEur||1.13,
    china:(nv+bv)/total,spec:(nv+bv+gv+crypto)/total};
}
function puffer(){return D.state&&D.state.puffer?D.state.puffer.wert:null}
function stufe0(){
  var w=(D.weekly&&D.weekly.nio)||[],t=D.rules.nio.stufe0.triggerUsd;
  var last2=w.slice(-2);
  return {weeks:w,both:last2.length===2&&last2.every(function(x){return x.closeUsd<t}),last:w[w.length-1]};
}
/* Soll-Sparrate eines Monats: Wert aus rules.sollSparrate; vor dem ersten Soll-Monat 0 (Umzugsmonat, kein Ziel),
   nach dem letzten die volle Plan-Sparrate. */
var MON=["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
function monIdx(key){var p=key.split(" ");return (+p[1])*12+MON.indexOf(p[0])}
function sollRate(y,m){
  var S=D.rules.sollSparrate||{},z=D.rules.zielpfad,k=MON[m]+" "+y;if(S[k]!=null)return S[k];
  var idx=Object.keys(S).map(monIdx).filter(function(v){return !isNaN(v)});if(!idx.length)return z.sparrate;
  return y*12+m<Math.min.apply(null,idx)?0:z.sparrate;
}
/* „Basisfall heute“: Startwert mit Monatszins und den SOLL-Sparraten fortgeschrieben (17.11.2026). Vorher
   pauschal 1.540 €/Mt ab Start – strenger als das eigene Soll (Sep kein Ziel, Okt–Mär 1.200 €), die
   Abweichung sah dadurch um einige Tausend Euro schlechter aus. Das Zieldatum bleibt der kalibrierte
   Basisfall mit voller Sparrate (simulate). */
function expectedToday(){
  var z=D.rules.zielpfad,r=z.rendite/12,sd=new Date(z.startDatum),n=Math.max(0,(Date.now()-sd)/(864e5*30.4375));
  var v=z.startWert,full=Math.floor(n),frac=n-full,y=sd.getFullYear(),m=sd.getMonth();
  for(var k=0;k<=full;k++){m++;if(m>11){m=0;y++}
    var f=k<full?1:frac;v=v*Math.pow(1+r,f)+sollRate(y,m)*f}
  return v;
}

/* ─── Darstellung ─── */
function chip(lbl,val,note,s,pill,href){return '<'+(href?'a href="'+href+'"':'div')+' class="chip" data-s="'+(s||"")+'"><span class="lbl">'+esc(lbl)+'</span><span class="val">'+val+'</span>'+(pill?"<span>"+pill+"</span>":"")+'<span class="note">'+note+'</span></'+(href?'a':'div')+'>'}
function body(id){return document.querySelector(id+" .body")}

function renderStatus(d){
  var R=D.rules,out=[],p=puffer();
  if(p==null)out.push(chip("Liquiditätsregel","–","Puffer unter Liquidität eintragen.","","","#p-puffer"));
  else{var act=p<R.liquiditaet.pufferMin;
    out.push(chip("Liquiditätsregel",eur(p),act?"Unter "+eur(R.liquiditaet.pufferMin)+": keine Einzelaktien-Zukäufe. ETF-Sparplan läuft weiter. Es fehlen "+eur(R.liquiditaet.pufferMin-p)+".":"Über "+eur(R.liquiditaet.pufferMin)+": Zukäufe regelkonform möglich.",act?"warn":"ok",act?'<span class="pill warn">aktiv</span>':'<span class="pill ok">inaktiv</span>',"#p-puffer"))}
  var L=z0Lage(),z0=L.z0,zd=L.tage,up=L.up,upTxt="$"+up.toFixed(2).replace(".",","),fw=fehlendeWochen();
  var zs,zp,zn;
  if(!z0){zs="crit";zp='<span class="pill crit">offen</span>';zn=R.nio.stufe0.status+". Kein Z0-Termin in rules.json."}
  else if(L.hit){zs="ok";zp='<span class="pill ok">entfällt</span>';zn="Wochenschluss "+dDE(L.hit.datum)+" über "+upTxt+": Upside-Trigger vor dem Termin, Z0 entfällt."}
  else if(zd<=0){zs="crit";zp='<span class="pill crit">fällig</span>';zn="Z0 "+(zd===0?"heute":"seit "+dDE(z0))+" fällig: "+R.nio.stufe0.stueck.toLocaleString("de-DE")+" Stück verkaufen, kursunabhängig."}
  else{zs="warn";zp='<span class="pill warn">terminiert</span>';zn="Pflichtverkauf "+R.nio.stufe0.stueck.toLocaleString("de-DE")+" Stück am "+dDE(z0)+", "+tageText(zd)+". Entfällt nur bei Wochenschluss über "+upTxt+" vor dem Termin. K1/K3 lösen früher aus."}
  if(fw.length)zn+=' <b style="color:var(--warn)">Wochenschluss fehlt: '+wochenText(fw)+'.</b>';
  out.push(chip("NIO Z0",d&&d.nio?usd(d.nio.kursEur*d.fx):"–",zn+(d&&!d.nio?" Keine NIO-Position im Snapshot.":""),zs,zp,"#p-nio"));
  /* Erreichte Leiterstufen als eigene Kachel – vorher meldete das Cockpit sie nirgends */
  [["NIO",d&&d.nio,R.nio.stufen,"#p-nio"],["BABA",d&&d.baba,R.baba.stufen,"#p-baba"]].forEach(function(x){
    var pos=x[1];if(!pos)return;var hit=erreichteStufen(x[2],pos.kursEur);if(!hit.length)return;
    var top=hit[hit.length-1];
    out.push(chip(x[0]+"-Leiter",eur(pos.kursEur,2),hit.map(function(t){return t.name+" ("+eur(t.eur)+"): "+t.stueck.toLocaleString("de-DE")+" Stück"}).join(" · ")+
      " verkaufen, falls noch nicht geschehen. Bestand jetzt "+pos.stueck.toLocaleString("de-DE")+" Stück."+(top.hinweis?" "+esc(top.hinweis)+".":""),
      "crit",'<span class="pill crit">'+esc(top.name)+' erreicht</span>',x[3]))});
  if(d){var over=d.china>R.chinaAdrMax;
    out.push(chip("China-ADR-Anteil",pct(d.china),"NIO + BABA, Grenze "+pct(R.chinaAdrMax,0)+". "+(over?"TOR 3 rot, kein BABA-Nachkauf.":"Unter der Grenze."),over?"warn":"ok",over?'<span class="pill warn">über Grenze</span>':'<span class="pill ok">im Rahmen</span>',"#p-alloc"));
    out.push(chip("Spekulativer Anteil",pct(d.spec),"NIO, BABA, GRAB, Krypto. Der 7-%-Pfad unterstellt einen breiten Markt.",d.spec>0.4?"warn":"ok","","#p-alloc"))}
  $("#status").innerHTML=out.join("");
}
// Datenpunkte für scrub.js (Gedrückthalten zeigt Datum und Wert)
function scrubAttr(pts) {
  const j = JSON.stringify(pts.map(p => ({ x: +(+p.x).toFixed(1), y: p.y.map(v => v == null ? null : +(+v).toFixed(1)), c: p.c, v: p.v, t: p.t })));
  return ` data-scrub="${j.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`;
}
function ladderSvg(points,cur,min,max,log,fmt){
  var W=460,H=118,L=14,R=14,y=58;
  function sx(v){var a=log?Math.log(v):v,lo=log?Math.log(min):min,hi=log?Math.log(max):max;return L+(W-L-R)*Math.min(1,Math.max(0,(a-lo)/(hi-lo)))}
  var g='<svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="Kursleiter"><rect x="'+L+'" y="'+(y-3)+'" width="'+(W-L-R)+'" height="6" rx="3" fill="var(--track)"/>';
  points.forEach(function(p,i){var x=sx(p.v),up=i%2===0;
    g+='<line x1="'+x+'" x2="'+x+'" y1="'+(y-12)+'" y2="'+(y+12)+'" stroke="'+p.c+'" stroke-width="2"/>'+
       '<text x="'+x+'" y="'+(up?y-18:y+26)+'" text-anchor="middle" style="fill:'+p.c+';font-weight:600">'+esc(p.l)+'</text>'+
       '<text x="'+x+'" y="'+(up?y-30:y+38)+'" text-anchor="middle">'+esc(fmt(p.v))+'</text>'});
  if(cur!=null){var x=sx(cur);g+='<circle cx="'+x+'" cy="'+y+'" r="7" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/><text x="'+x+'" y="'+(H-4)+'" text-anchor="middle" style="fill:var(--accent);font-weight:600">jetzt '+esc(fmt(cur))+'</text>'}
  return g+"</svg>";
}
function renderNio(d){
  var el=body("#p-nio");if(!d||!d.nio){el.innerHTML='<div class="empty">Keine NIO-Position im Snapshot.</div>';return}
  var N=D.rules.nio,n=d.nio,fx=d.fx,cur=n.kursEur*fx;
  var pts=[{v:N.stufe0.triggerUsd,l:"Stufe 0 (alt)",c:"var(--muted)"},{v:N.upsideUsd,l:"Upside",c:"var(--ok)"}].concat(N.stufen.map(function(s){return {v:s.eur*fx,l:s.name,c:"var(--muted)"}}));
  var e=N.schaetzung2030Usd;
  el.innerHTML='<div class="chart">'+ladderSvg(pts,cur,2.5,20,true,function(v){return "$"+v.toFixed(2).replace(".",",")})+'</div>'+
  '<dl class="kv"><dt>Bestand</dt><dd>'+n.stueck.toLocaleString("de-DE")+' Stück · '+eur(n.wertEur)+'</dd>'+
  '<dt>Kurs</dt><dd>'+eur(n.kursEur,2)+' / '+usd(cur)+'</dd>'+
  '<dt>Z0</dt><dd>'+(N.stufe0.z0Datum?dDE(N.stufe0.z0Datum)+' · '+tageText(calDays(N.stufe0.z0Datum)):'–')+'</dd>'+
  '<dt>Bis Upside</dt><dd>+'+pct(N.upsideUsd/cur-1)+'</dd>'+
  '<dt>Z0 Volumen</dt><dd>'+N.stufe0.stueck.toLocaleString("de-DE")+' Stück ≈ '+eur(N.stufe0.stueck*n.kursEur)+' (heute)</dd>'+
  '<dt>2030 Bear / Base / Bull</dt><dd>'+usd(e.bear)+' / '+usd(e.base)+' / '+usd(e.bull)+'</dd></dl>';
}
function renderWeek(){
  var el=body("#p-week"),s0=stufe0(),t=D.rules.nio.stufe0.triggerUsd,up=D.rules.nio.upsideUsd;
  if(!s0.weeks.length){el.innerHTML='<div class="empty">Noch keine Wochenschlüsse erfasst. Der geplante Task trägt sie samstags früh nach US-Börsenschluss ein.</div>';return}
  var upTxt="$"+up.toFixed(2).replace(".",","),L=z0Lage(),fw=fehlendeWochen();
  var rows=s0.weeks.slice(-8).reverse().map(function(w){var st=w.closeUsd>up?'<span class="pill ok">über '+upTxt+'</span>':'<span class="pill warn">unter '+upTxt+'</span>';
    return '<tr><td>'+dDE(w.datum)+'</td><td>'+usd(w.closeUsd)+'</td><td>'+st+'</td></tr>'}).join("");
  el.innerHTML='<div class="chart"><table><thead><tr><th>Woche bis</th><th>Schluss</th><th>Status</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
  (fw.length?'<div class="err">Wochenschluss fehlt: '+wochenText(fw)+'. Der Samstags-Task hat diese Woche nicht eingetragen – nachtragen, sonst kann ein Upside-Schluss übersehen werden.</div>':'')+
  '<p class="foot">'+(L.hit?"Upside-Trigger am "+dDE(L.hit.datum)+" erreicht, vor dem Termin: Z0 entfällt."
    :"Upside-Trigger vor dem Termin nicht erreicht. Z0 ("+(L.z0?dDE(L.z0):"–")+") "+(L.z0&&L.tage<=0?"ist fällig.":"bleibt bestehen.")+
     (L.z0&&L.tage<=0&&s0.weeks.some(function(w){return w.closeUsd>up&&w.datum>=L.z0})?" Ein Wochenschluss über "+upTxt+" ab dem Termin zählt nicht mehr.":""))+'</p>';
}
function renderAlloc(d){
  var el=body("#p-alloc");if(!d){el.innerHTML='<div class="empty">Kein Snapshot.</div>';return}
  var parts=[["ETF-Kern",d.etf,"var(--accent)"],["NIO",d.nio?d.nio.wertEur:0,"var(--crit)"],["BABA",d.baba?d.baba.wertEur:0,"var(--warn)"],["GRAB",d.grab?d.grab.wertEur:0,"var(--grab)"],["Krypto",d.crypto,"var(--krypto)"],["Sonstige",d.other,"var(--muted)"]].filter(function(p){return p[1]>0});
  var R=D.rules;
  el.innerHTML='<div class="alloc">'+parts.map(function(p){return '<span title="'+p[0]+'" style="width:'+(p[1]/d.total*100)+'%;background:'+p[2]+'"></span>'}).join("")+'</div>'+
  '<div class="legend keep">'+parts.map(function(p){return '<span><i style="background:'+p[2]+'"></i>'+p[0]+' '+pct(p[1]/d.total,0)+'</span>'}).join("")+'</div>'+
  '<dl class="kv"><dt>Portfolio ohne Cash</dt><dd>'+eur(d.total)+'</dd>'+
  '<dt>ETF-Kern</dt><dd>'+eur(d.etf)+' · '+pct(d.etf/d.total)+'</dd>'+
  '<dt>China-ADR (NIO + BABA)</dt><dd>'+pct(d.china)+' / max. '+pct(R.chinaAdrMax,0)+'</dd>'+
  '<dt>Überhang über Grenze</dt><dd>'+(d.china>R.chinaAdrMax?eur((d.china-R.chinaAdrMax)*d.total):"keiner")+'</dd></dl>';
}
/* BABA-Nachkauf: TOR 3 (China-ADR) UND Liquiditätsregel – Einzelaktien-Zukäufe pausieren, solange der Puffer fehlt */
function nachkauf(d){
  var R=D.rules,p=puffer(),liq=p!=null&&p<R.liquiditaet.pufferMin,tor3=d.china>R.chinaAdrMax,g=[];
  if(liq)g.push("Liquiditätsregel aktiv");if(tor3)g.push("TOR 3 rot");
  return g.length?"gesperrt: "+g.join(", "):"TOR 3 grün, TOR 1/2 prüfen";
}
function renderBaba(d){
  var el=body("#p-baba");if(!d||!d.baba){el.innerHTML='<div class="empty">Keine BABA-Position im Snapshot.</div>';return}
  var b=d.baba,R=D.rules,pts=R.baba.stufen.map(function(t){return {v:t.eur,l:t.name,c:"var(--muted)"}});
  el.innerHTML='<div class="chart">'+ladderSvg(pts,b.kursEur,60,220,false,function(v){return v.toFixed(0)+" €"})+'</div>'+
  '<dl class="kv"><dt>Bestand</dt><dd>'+b.stueck+' Stück · '+eur(b.wertEur)+'</dd>'+
  '<dt>Bis T1 ('+R.baba.stufen[0].eur+' €)</dt><dd>'+(b.kursEur>=R.baba.stufen[0].eur?"erreicht":"+"+pct(R.baba.stufen[0].eur/b.kursEur-1))+'</dd>'+
  '<dt>Nachkauf</dt><dd>'+nachkauf(d)+'</dd></dl>';
}
function renderSpar(){
  var el=body("#p-spar"),rows=(D.snap&&D.snap.sparplan)||[],soll=D.rules.sollSparrate||{};
  var show=rows.filter(function(r){return r.ueberschuss!=null||soll[r.monat]!=null});
  if(!show.length){el.innerHTML='<div class="empty">Keine Sparplan-Werte im Snapshot.</div>';return}
  var W=460,H=190,L=44,B=24,T=10;
  var max=Math.max.apply(null,[4000].concat(show.map(function(r){return r.ueberschuss||0}),show.map(function(r){return soll[r.monat]||0})));
  var bw=(W-L-8)/show.length,sy=function(v){return T+(H-T-B)*(1-v/max)};
  var scrub=scrubAttr(show.map(function(r,i){var x=L+i*bw+bw*0.5,s=soll[r.monat],u=r.ueberschuss,ok=s!=null&&u>=s;
    return {x:x,y:[u!=null?sy(Math.max(0,u)):null,s!=null?sy(s):null],c:[s==null?"var(--muted)":ok?"var(--accent)":"var(--warn)","var(--ink)"],
      v:u!=null?eur(u,2):"Soll "+eur(s,2),
      t:r.monat+(u!=null?(s!=null?" · Soll "+eur(s,2):"")+(r.sparquote!=null?" · "+r.sparquote.toLocaleString("de-DE")+" %":""):" · noch kein Ist")}}));
  var g='<svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="Überschuss pro Monat gegen Soll"'+scrub+'>';
  for(var t=0;t<=max;t+=1000)g+='<line x1="'+L+'" x2="'+(W-4)+'" y1="'+sy(t)+'" y2="'+sy(t)+'" stroke="var(--line)"/><text x="'+(L-6)+'" y="'+(sy(t)+4)+'" text-anchor="end">'+(t/1000)+'k</text>';
  show.forEach(function(r,i){var x=L+i*bw+bw*0.18,w=bw*0.64,s=soll[r.monat];
    if(r.ueberschuss!=null){var v=Math.max(0,r.ueberschuss),ok=s!=null&&r.ueberschuss>=s;g+='<rect x="'+x+'" y="'+sy(v)+'" width="'+w+'" height="'+(sy(0)-sy(v))+'" rx="3" fill="'+(s==null?"var(--muted)":ok?"var(--accent)":"var(--warn)")+'"/>'}
    if(s!=null)g+='<line x1="'+(x-3)+'" x2="'+(x+w+3)+'" y1="'+sy(s)+'" y2="'+sy(s)+'" stroke="var(--ink)" stroke-width="2" stroke-dasharray="'+(r.ueberschuss==null?"4 3":"0")+'"/>';
    g+='<text x="'+(x+w/2)+'" y="'+(H-6)+'" text-anchor="middle">'+r.monat.slice(0,3)+'</text>'});
  g+="</svg>";
  var ist=rows.filter(function(r){return r.ueberschuss!=null&&soll[r.monat]!=null});
  var kum=ist.reduce(function(a,r){return a+r.ueberschuss-soll[r.monat]},0);
  var last=rows.slice().reverse().find(function(r){return r.ueberschuss!=null});
  var next=rows.find(function(r){return r.ueberschuss==null&&soll[r.monat]!=null});
  el.innerHTML='<div class="chart">'+g+'</div>'+
  '<div class="legend"><span><i style="background:var(--accent)"></i>Ist ≥ Soll</span><span><i style="background:var(--warn)"></i>Ist &lt; Soll</span><span><i style="background:var(--muted)"></i>vor Okt 2026, kein Soll</span><span><i style="background:var(--ink);height:2px"></i>Soll (gestrichelt: noch kein Ist)</span></div>'+
  '<dl class="kv"><dt>Überschuss</dt><dd>'+(last?last.monat+": "+eur(last.ueberschuss)+" · "+(last.sparquote!=null?last.sparquote.toLocaleString("de-DE")+" %":"–"):"–")+'</dd>'+
  (last&&last.investiert!=null&&last.netto?'<dt>Angelegt</dt><dd>'+eur(last.investiert)+' · '+pct(last.investiert/last.netto)+'</dd>'+
   '<dt>Nicht angelegt</dt><dd>'+eur(last.ueberschuss-last.investiert)+'</dd>':'')+
  '<dt>Kumuliert vs. Soll</dt><dd>'+(ist.length?(kum>=0?"+":"")+eur(kum):"noch kein Monat mit Soll")+'</dd>'+
  '<dt>Nächster Eintrag</dt><dd>'+(next?next.monat:"–")+'</dd></dl>';
}
function renderGem(){
  var el=body("#p-gem"),g=D.state&&D.state.gemeinschaftskonto;
  if(!g){el.innerHTML='<div class="empty">Noch keine Daten. Werden im Monatsreview eingetragen.</div>';return}
  var m=g.monate||[],norm=m.filter(function(x){return !x.sonder}),base=norm.length?norm:m,n=base.length;
  var al=base.map(function(x){return x.alltag||0}),all=n?al.reduce(function(a,v){return a+v},0)/n:0;
  var lo=n?Math.min.apply(null,al):0,hi=n?Math.max.apply(null,al):0;
  var avgU=m.length?m.reduce(function(a,x){return a+(x.urlaub||0)},0)/m.length:0;
  var fix=g.fixMonat||0,ub=g.urlaubBudgetJahr!=null,url=ub?g.urlaubBudgetJahr/12:avgU;
  var bed=fix+all+url,bLo=fix+lo+url,bHi=fix+hi+url,ein=(g.einzahlungJePerson||0)*2,gap=bed-ein;
  var r50=function(v){return Math.ceil(v/2/50)*50},emp=r50(bed),scale=Math.max(bHi,ein)*1.1,vorl=n<3;
  var rows=m.slice(-6).map(function(x){return '<tr'+(x.sonder?' style="opacity:.55"':'')+'><td>'+esc(x.monat)+(x.sonder?' <small>Sondermonat</small>':'')+'</td><td>'+eur(x.alltag)+'</td><td>'+eur(x.urlaub)+'</td><td>'+eur(x.einrichtung||0)+'</td></tr>'}).join("");
  var sonder=m.filter(function(x){return x.sonder}).map(function(x){return esc(x.monat)+(x.sonderGrund?" ("+esc(x.sonderGrund)+")":"")});
  el.innerHTML='<div class="meter" role="img" aria-label="Einzahlung gegen Bedarf"><span style="width:'+Math.min(100,ein/scale*100)+'%;background:'+(gap>0?"var(--warn)":"var(--ok)")+'"></span>'+(hi>lo?'<b style="left:'+(bLo/scale*100)+'%;width:'+((bHi-bLo)/scale*100)+'%"></b>':'')+'<i style="left:'+(bed/scale*100)+'%"></i></div>'+
  '<dl class="kv"><dt>Kontostand</dt><dd>'+eur(g.wert)+' <small>Stand '+dDE(g.geaendert)+'</small></dd>'+
  '<dt>Einzahlung</dt><dd>'+eur(ein)+' <small>(2 × '+eur(g.einzahlungJePerson)+')</small></dd>'+
  '<dt>Bedarf / Monat</dt><dd>'+eur(bed)+(hi>lo?' <small>Spanne '+eur(bLo)+'–'+eur(bHi)+'</small>':'')+'</dd>'+
  '<dt>· Fixkosten</dt><dd>'+eur(fix)+'</dd><dt>· Alltag Ø</dt><dd>'+eur(all)+'</dd><dt>· Urlaub '+(ub?'Budget':'Ø')+'</dt><dd>'+eur(url)+(ub?' <small>('+eur(g.urlaubBudgetJahr)+'/Jahr)</small>':'')+'</dd>'+
  '<dt>'+(gap>0?"Lücke / Monat":"Überdeckung")+'</dt><dd>'+eur(Math.abs(gap))+'</dd>'+
  '<dt>Nötig je Person</dt><dd>'+eur(emp)+(hi>lo&&r50(bLo)!==r50(bHi)?' <small>Spanne '+eur(r50(bLo))+'–'+eur(r50(bHi))+'</small>':'')+'</dd></dl>'+
  '<div class="chart"><table><thead><tr><th>Monat</th><th>Alltag</th><th>Urlaub</th><th>Einrichtung</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
  '<p class="foot">'+(vorl?'<span class="pill warn">vorläufig</span> ':'')+'Alltag aus '+n+' Monat'+(n===1?'':'en')+(sonder.length?', ohne Sondermonat '+sonder.join(", "):'')+'. '+(vorl?'Ab 3 Monaten belastbar. ':'')+(ub&&g.urlaubHinweis?'Urlaub: '+esc(g.urlaubHinweis)+'. ':'')+'Einrichtung zählt nicht zum Bedarf.</p>';
}
/* Monatsweise Simulation bis zum Ziel: Wert * (1+r) + Sparrate */
function simulate(v0,rate,start,goal,ret){
  /* Wie im Tracker: Monatszins = Jahresrendite / 12, Monate bis zum Ziel auf ganze Monate gerundet */
  var r=ret/12,v=v0,pv=v0,path=[{m:0,v:v}],n=0;
  while(v<goal&&n<480){pv=v;v=v*(1+r)+rate;n++;path.push({m:n,v:v})}
  var frac=n>0?(n-1)+(goal-pv)/(v-pv):0,m=Math.round(frac);
  var dt=new Date(start.getFullYear(),start.getMonth()+m,1);
  return {n:n,date:dt,path:path,start:start};
}
function monthYear(dt){return dt.toLocaleDateString("de-DE",{month:"short",year:"numeric"})}
function monthsBetween(a,b){return (b.getFullYear()-a.getFullYear())*12+(b.getMonth()-a.getMonth())}
/* „So weiter wie bisher“: Ø des tatsächlich ANGELEGTEN Betrags der letzten 3 abgeschlossenen Monate
   (17.11.2026, vorher Ø-Überschuss). Der Überschuss enthält keine Einmaleffekte (Einrichtung, Ablöse) und
   überschätzt, was wirklich im Vermögen ankommt. Fehlt „investiert“, gilt ersatzweise der Überschuss. */
function istRate(){
  var rows=((D.snap&&D.snap.sparplan)||[]).filter(function(r){return r.ueberschuss!=null}).slice(-3);
  if(!rows.length)return null;
  var inv=rows.every(function(r){return r.investiert!=null});
  return {rate:rows.reduce(function(a,r){return a+(inv?r.investiert:r.ueberschuss)},0)/rows.length,inv:inv,
    label:rows.map(function(r){return r.monat.slice(0,3)}).join("–")};
}
function pathChart(series,goal,start,end){
  var W=460,H=200,L=46,R=10,T=12,B=26;
  var span=Math.max(1,monthsBetween(start,end)),max=goal*1.08,min=Math.min.apply(null,series.map(function(s){return s.sim.path[0].v}))*0.9;
  var sx=function(dt){return L+(W-L-R)*monthsBetween(start,dt)/span},sy=function(v){return T+(H-T-B)*(1-(v-min)/(max-min))};
  var sp=[];
  for(var m=0;m<=span;m++){var dm=new Date(start.getFullYear(),start.getMonth()+m,1);
    var vals=series.map(function(s){var k=monthsBetween(s.sim.start,dm);return k>=0&&k<s.sim.path.length?s.sim.path[k].v:null});
    if(vals.every(function(v){return v==null}))continue;
    var hi=series.length-1;while(vals[hi]==null)hi--;
    sp.push({x:sx(dm),y:vals.map(function(v){return v==null?null:sy(Math.min(v,max))}),c:series.map(function(s){return s.c}),
      v:eur(vals[hi],2),
      t:monthYear(dm)+(hi<series.length-1?" · "+series[hi].n:"")+vals.map(function(v,k){return k===hi||v==null?"":" · "+series[k].n+" "+eur(v,2)}).join("")});
  }
  var g='<svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="Pfad bis 500.000 €"'+scrubAttr(sp)+'>';
  var step=goal>500000?200000:100000,ticks=[];for(var tv=step;tv<=goal;tv+=step)ticks.push(tv);ticks.forEach(function(t){if(t<min)return;g+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+sy(t)+'" y2="'+sy(t)+'" stroke="var(--line)"'+(t===goal?' stroke-width="1.5" stroke-dasharray="5 4"':'')+'/><text x="'+(L-6)+'" y="'+(sy(t)+4)+'" text-anchor="end">'+(t>=1e6?(t/1e6).toLocaleString("de-DE")+' Mio':(t/1000)+'k')+'</text>'});
  for(var y=start.getFullYear()+1;y<=end.getFullYear();y++){var dt=new Date(y,0,1);if(monthsBetween(start,dt)%1===0&&(y-start.getFullYear())%2===1)g+='<text x="'+sx(dt)+'" y="'+(H-6)+'" text-anchor="middle">'+y+'</text>'}
  series.forEach(function(s){
    var pts=s.sim.path.map(function(p){var dt=new Date(s.sim.start.getFullYear(),s.sim.start.getMonth()+p.m,1);return sx(dt).toFixed(1)+","+sy(Math.min(p.v,max)).toFixed(1)}).join(" ");
    g+='<polyline points="'+pts+'" fill="none" stroke="'+s.c+'" stroke-width="2.5"'+(s.dash?' stroke-dasharray="6 4"':'')+' stroke-linejoin="round"/>';
    var ex=sx(s.sim.date);g+='<circle cx="'+ex+'" cy="'+sy(goal)+'" r="4.5" fill="'+s.c+'"/>';
  });
  var now=series[series.length-1].sim;g+='<circle cx="'+sx(now.start)+'" cy="'+sy(now.path[0].v)+'" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>';
  return g+'</svg>';
}
function goalSel(){try{var g=+localStorage.getItem("fc-goal");return g===1000000?1000000:500000}catch(e){return 500000}}
document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("#p-ziel .seg button");if(!b)return;
  try{localStorage.setItem("fc-goal",b.dataset.goal)}catch(err){}render()});
function renderZiel(d){
  var el=body("#p-ziel"),p=puffer();
  if(!d){el.innerHTML='<div class="empty">Kein Snapshot.</div>';return}
  var z=Object.assign({},D.rules.zielpfad);z.ziel=goalSel();var ges=d.total+(p||0),exp=expectedToday(),diff=ges-exp,prog=ges/z.ziel;
  $('#ziel-title').textContent='Zielpfad '+(z.ziel>=1e6?'1 Mio. €':eur(z.ziel));
  document.querySelectorAll('#p-ziel .seg button').forEach(function(b){b.classList.toggle('on',+b.dataset.goal===z.ziel)});
  var sd=new Date(z.startDatum),basisStart=new Date(sd.getFullYear(),sd.getMonth()+1,1);
  var snapD=new Date(D.snap.stand),nowStart=new Date(snapD.getFullYear(),snapD.getMonth()+1,1);
  var basis=simulate(z.startWert,z.sparrate,basisStart,z.ziel,z.rendite);
  var kurs=simulate(ges,z.sparrate,nowStart,z.ziel,z.rendite);
  var ir=istRate(),trend=ir?simulate(ges,ir.rate,nowStart,z.ziel,z.rendite):null;
  var today=new Date(),rest=monthsBetween(today,basis.date);
  function delta(sim){var m=monthsBetween(basis.date,sim.date);return m===0?"wie Basisfall":(m>0?"+"+m+" Mon. später":Math.abs(m)+" Mon. früher")}
  function col(sim){var m=monthsBetween(basis.date,sim.date);return m>0?"var(--crit)":m<0?"var(--ok)":"var(--ink)"}
  var end=new Date(Math.max(basis.date,trend?trend.date:basis.date,kurs.date));end=new Date(end.getFullYear(),end.getMonth()+3,1);
  var series=[{sim:basis,c:"var(--muted)",dash:true,n:"Basisfall"}];if(trend)series.push({sim:trend,c:"var(--accent)",n:"So weiter"});
  var kursM=monthsBetween(basis.date,kurs.date),rateM=trend?monthsBetween(kurs.date,trend.date):0;
  el.innerHTML='<div class="alloc" style="height:14px"><span style="width:'+Math.min(100,prog*100)+'%;background:var(--accent)"></span></div>'+
  '<dl class="kv"><dt>Vermögen</dt><dd>'+eur(ges)+' · '+pct(prog)+'</dd>'+
  '<dt>Basisfall heute</dt><dd>'+eur(exp)+'</dd>'+
  '<dt>Abweichung</dt><dd style="color:'+(diff>=0?"var(--ok)":"var(--crit)")+'">'+(diff>=0?"+":"")+eur(diff)+'</dd></dl>'+
  '<div class="chart">'+pathChart(series,z.ziel,basisStart,end)+'</div>'+
  '<div class="legend"><span><i style="background:var(--muted)"></i>Basisfall ('+eur(z.sparrate)+'/Mt)</span>'+(trend?'<span><i style="background:var(--accent)"></i>So weiter wie bisher ('+eur(ir.rate)+'/Mt)</span>':'')+'</div>'+
  '<table><thead><tr><th>Szenario</th><th>'+(z.ziel>=1e6?'1 Mio. €':eur(z.ziel))+' erreicht</th><th>ggü. Basis</th></tr></thead><tbody>'+
  '<tr><td>Basisfall</td><td>'+monthYear(basis.date)+'</td><td>noch '+rest+' Mon.</td></tr>'+
  '<tr><td>Heutiger Stand, Plan-Sparrate</td><td>'+monthYear(kurs.date)+'</td><td style="color:'+col(kurs)+'">'+delta(kurs)+'</td></tr>'+
  (trend?'<tr><td>So weiter wie bisher</td><td>'+monthYear(trend.date)+'</td><td style="color:'+col(trend)+'">'+delta(trend)+'</td></tr>':'')+
  '</tbody></table>'+
  (z.ziel>=1e6?'<p class="foot">Ziel 3 hat bewusst kein Datum. Die Werte zeigen nur, wohin die heutige Kurve führt; der größte Hebel bleibt das Einkommen, nicht die Sparrate.</p>':'')+'<p class="foot">„So weiter wie bisher" startet beim heutigen Vermögen und spart mit dem '+(ir&&ir.inv?"Ø angelegten Betrag":"Ø-Überschuss")+' '+(ir?ir.label:"")+'. '+
  'Davon gehen '+(kursM>=0?"+":"")+kursM+' Mon. auf die Kursentwicklung seit '+dDE(z.startDatum)+' und '+(rateM>=0?"+":"")+rateM+' Mon. auf die Sparrate. '+
  '„Basisfall heute“ rechnet mit den Soll-Sparraten der einzelnen Monate, das Zieldatum mit '+eur(z.sparrate)+'/Mt. '+
  'Alle Szenarien rechnen mit '+pct(z.rendite,0)+' p. a. auf das gesamte Vermögen, obwohl '+pct(d.spec,0)+' in Einzelwerten und Krypto stecken.</p>';
}
function renderPuffer(){
  var el=body("#p-puffer"),p=puffer(),min=D.rules.liquiditaet.pufferMin;
  var inp=$("#puffer");if(document.activeElement!==inp)inp.value=p==null?"":p;
  if(D.state&&D.state.puffer&&!$("#puffer-msg").textContent)$("#puffer-msg").textContent="Stand "+dDE(D.state.puffer.geaendert);
  if(p==null){el.innerHTML='<div class="empty">Noch kein Kontostand eingetragen.</div>';return}
  var scale=Math.max(min*1.25,p),act=p<min;
  el.innerHTML='<div class="meter" role="img" aria-label="Puffer gegen Schwelle"><span style="width:'+Math.min(100,p/scale*100)+'%;background:'+(act?"var(--warn)":"var(--ok)")+'"></span><i style="left:'+(min/scale*100)+'%"></i></div>'+
  '<dl class="kv"><dt>Puffer</dt><dd>'+eur(p)+'</dd><dt>Schwelle</dt><dd>'+eur(min)+'</dd>'+
  '<dt>'+(act?"Es fehlen":"Überschuss über Schwelle")+'</dt><dd style="color:'+(act?"var(--warn)":"var(--ok)")+'">'+eur(Math.abs(min-p))+'</dd>'+
  '<dt>Einzelaktien</dt><dd>'+(act?"pausiert":"erlaubt")+'</dd></dl>'+
  '<p class="foot">'+esc(D.rules.liquiditaet.regel)+'.</p>';
}
function renderRules(){
  var all=D.rules.termine.slice().sort(function(a,b){return a.datum.localeCompare(b.datum)});
  body("#p-rules").innerHTML='<div class="chart"><table><thead><tr><th>Termin</th><th>Datum</th><th>in Tagen</th></tr></thead><tbody>'+
  all.map(function(t){var dd=calDays(t.datum);return '<tr><td>'+esc(t.name)+'</td><td>'+dDE(t.datum)+'</td><td>'+(dd<0?"vorbei":dd===0?"heute":dd.toLocaleString("de-DE"))+'</td></tr>'}).join("")+
  '</tbody></table></div><p class="foot">Kill-Kriterien NIO: '+D.rules.nio.kill.map(esc).join(" · ")+'</p>';
}
function renderFresh(){
  var f=$("#fresh");
  if(D.err){f.textContent=D.err;f.className="fresh stale";return}
  if(!D.snap){f.textContent="Kein Snapshot";f.className="fresh stale";return}
  var t=new Date(D.snap.stand),h=(Date.now()-t)/36e5;
  f.textContent="Snapshot "+t.toLocaleString("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})+(h>72?" · veraltet":"");
  f.className="fresh"+(h>72?" stale":"");
}
function render(){
  renderFresh();
  if(!D.rules||!D.snap){$("#status").innerHTML=D.err?'<div class="err">'+esc(D.err)+'</div>':"";return}
  var d=derive();
  renderStatus(d);renderZiel(d);renderAlloc(d);renderPuffer();renderSpar();renderGem();renderNio(d);renderWeek();renderBaba(d);renderRules();compact();
  $("#source-note").textContent="Daten aus dem privaten Repo: Positionen und Kurse aus Parqet, Ist-Werte aus dem Finanz-Tracker, Regeln Stand "+dDE(D.rules.stand)+". Snapshot werktags abends, Wochenschluss samstags früh.";
}
render();load();
/* ─── Versionsanzeige: zeigt den App-Stand und meldet, wenn auf GitHub Pages eine neuere Version liegt ─── */
function showVersion(newer){
  var el=$("#app-version");if(!el)return;
  el.innerHTML="App-Stand "+esc(BUILD)+(newer?' · <a href="#" id="app-reload">Neue Version '+esc(newer)+' – neu laden</a>':"");
  var a=$("#app-reload");if(a)a.addEventListener("click",function(e){e.preventDefault();location.replace(location.pathname+"?v="+Date.now()+location.hash)});
}
var lastVC=0;
function checkVersion(){
  if(Date.now()-lastVC<60000)return;lastVC=Date.now();
  fetch(location.pathname+"?vc="+Date.now(),{cache:"no-store"}).then(function(r){return r.ok?r.text():""}).then(function(t){
    var mm=/<meta name="app-build" content="([^"]+)"/.exec(t||"");showVersion(mm&&mm[1]!==BUILD?mm[1]:null);
  }).catch(function(){});
}
showVersion(null);checkVersion();
/* ─── Diagnose (17.11.2026): Fehlerprotokoll (Erfassung in index.html), dauerhafter Speicher, Belegung ─── */
var diagPersist=null,diagAll=false;
function diagFmt(t){var d=new Date(t),p=function(n){return (n<10?"0":"")+n};return p(d.getDate())+"."+p(d.getMonth()+1)+". "+p(d.getHours())+":"+p(d.getMinutes())}
function diagBytes(){var fc=0,tl=0;try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i),n=(k.length+(localStorage.getItem(k)||"").length)*2;if(k.indexOf("fc-")===0)fc+=n;else if(k.indexOf("tl-")===0)tl+=n}}catch(e){}return {fc:fc,tl:tl}}
function diagKB(b){return b<1024*900?Math.round(b/1024)+" KB":(Math.round(b/1048576*10)/10).toLocaleString("de-DE")+" MB"}
function diagText(){return (window.fcDiag?fcDiag.read():[]).slice().reverse().map(function(e){return diagFmt(e.t)+"  "+e.m+(e.n>1?" (×"+e.n+")":"")+(e.s?"  ["+e.s+"]":"")}).join("\n")}
function renderDiag(){
  var box=$("#diag");if(!box)return;
  var errs=(window.fcDiag?fcDiag.read():[]).slice().reverse(),ls=diagBytes();
  box.querySelector("summary").textContent="Diagnose · Fehler: "+(errs.length?errs.length:"keine");
  var show=diagAll?errs:errs.slice(0,3);
  box.querySelector(".body").innerHTML='<dl class="kv">'+
    '<dt>Speicher</dt><dd>'+(diagPersist===true?'<span style="color:var(--ok)">dauerhaft ✓</span>':diagPersist===false?'<span style="color:var(--warn)">nicht garantiert</span>':"–")+'</dd>'+
    '<dt>Belegt</dt><dd>Cockpit '+diagKB(ls.fc)+' · Training Log '+diagKB(ls.tl)+'</dd>'+
    '<dt>Fehler</dt><dd>'+(errs.length?errs.length+" · zuletzt "+diagFmt(errs[0].t):"keine")+'</dd></dl>'+
    show.map(function(e){return '<div class="err-row"><b>'+esc(e.m)+(e.n>1?" (×"+e.n+")":"")+'</b>'+diagFmt(e.t)+(e.s?" · "+esc(e.s):"")+'</div>'}).join("")+
    (errs.length?'<div class="row" style="margin-top:8px">'+(errs.length>3?'<button type="button" data-diag="all">'+(diagAll?"Weniger":"Alle "+errs.length)+'</button>':'')+
      '<button type="button" data-diag="copy">Kopieren</button><button type="button" data-diag="clear">Leeren</button></div>':'');
}
document.addEventListener("click",function(e){
  var b=e.target.closest&&e.target.closest("#diag button[data-diag]");if(!b)return;
  var a=b.dataset.diag;
  if(a==="all"){diagAll=!diagAll;renderDiag()}
  else if(a==="clear"){if(window.fcDiag)fcDiag.clear();diagAll=false}
  else if(a==="copy"){var t=diagText(),ok=function(){b.textContent="Kopiert ✓"};
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).then(ok,function(){fb(t);ok()});else{fb(t);ok()}}
  function fb(t){var ta=document.createElement("textarea");ta.value=t;document.body.appendChild(ta);ta.select();try{document.execCommand("copy")}catch(x){}ta.remove()}
});
document.addEventListener("fc:err",renderDiag);
renderDiag();
/* Dauerhafter Speicher: gilt für die ganze Herkunft r1bozyme.github.io (training-log fragt ebenfalls) */
if(navigator.storage&&navigator.storage.persisted)navigator.storage.persisted().then(function(v){
  return v||!navigator.storage.persist?v:navigator.storage.persist()}).then(function(v){diagPersist=v;renderDiag()},function(){});
/* ─── Reiter: immer nur ein Bereich sichtbar ─── */
var TAB_KEY="fc-tab";
function groupsAll(){return [].slice.call(document.querySelectorAll("#main .group"))}
var curTab=null;
/* Kopf („Regel-Cockpit") beim Ansichtswechsel: War er schon weggescrollt, bleibt er weg und die
   neue Ansicht beginnt direkt unter der Reiterleiste. Gemessen wird VOR dem Umschalten – eine kürzere
   Ansicht kappt die Scrollposition sonst schon vorher, und der Kopf ist im Status-Reiter höher als sonst. */
function safeTop(){var s=document.querySelector(".sbar");return s?s.offsetHeight:0}
function docTop(el){return el.getBoundingClientRect().top+window.scrollY}
function kopfWeg(){
  var h=document.querySelector(".wrap>header");if(!h||!h.offsetHeight)return false;
  return window.scrollY+safeTop()>=docTop(h)+h.offsetHeight/2;   /* Faustregel: zur Hälfte draußen */
}
function scrollNachWechsel(weg,t){
  var m=document.getElementById("main"),keep=weg&&m?Math.max(0,docTop(m)-safeTop()):0;
  /* Zu kurze Ansichten bekommen unten Platz, damit der Kopf weg bleiben kann; sonst wieder entfernen */
  document.body.style.minHeight=keep?(keep+window.innerHeight)+"px":"";
  var y=keep;
  if(t){var ty=docTop(t)-(parseFloat(getComputedStyle(t).scrollMarginTop)||0);y=Math.max(ty,keep)}
  try{window.scrollTo({top:y,left:0,behavior:"instant"})}catch(e){window.scrollTo(0,y)}
}
function showTab(id,target,dir){
  var weg=kopfWeg();
  var gs=groupsAll();if(!gs.some(function(g){return g.id===id}))id="g-status";
  gs.forEach(function(g){g.hidden=g.id!==id;g.classList.remove("in-l","in-r");if(g.id===id&&dir){void g.offsetWidth;g.classList.add(dir>0?"in-l":"in-r")}});
  curTab=id;document.body.classList.toggle("tab-status",id==="g-status");
  document.querySelectorAll(".jump a").forEach(function(a){var on=a.getAttribute("href")==="#"+id;a.classList.toggle("on",on);
    if(on&&a.scrollIntoView)try{a.scrollIntoView({inline:"center",block:"nearest"})}catch(e){}});
  try{localStorage.setItem(TAB_KEY,id)}catch(e){}
  var t=target&&document.getElementById(target);
  if(t){var d=t.querySelector("details.more");if(d)d.open=true}
  scrollNachWechsel(weg,t);
  if(typeof backFollow==="function")backFollow();
}
document.addEventListener("click",function(e){
  var a=e.target.closest&&e.target.closest('a[href^="#"]');if(!a)return;
  var id=a.getAttribute("href").slice(1),el=document.getElementById(id);if(!el)return;
  var g=el.classList.contains("group")?el:el.closest(".group");if(!g)return;
  e.preventDefault();showTab(g.id,g===el?null:id);
});
(function(){var h=location.hash.slice(1),saved=null;try{saved=localStorage.getItem(TAB_KEY)}catch(e){}
  var el=h&&document.getElementById(h),g=el&&(el.classList.contains("group")?el:el.closest(".group"));
  showTab(g?g.id:(saved||"g-status"),g&&g!==el?h:null)})();
/* ─── Android-Zurück (17.11.2026, nach training-log back.js) ───
   Jeder Reiter bekommt einen Verlaufseintrag {fcTab, i}; Zurück führt zum vorherigen Reiter, egal ob
   per Reiterleiste, Status-Kachel oder Wischen dorthin gewechselt. Unterste Ebene ist „Status“, von dort
   verlässt Zurück die App.
   - Kein Endlos-Stapel: Liegt der Ziel-Reiter schon weiter unten im Verlauf, springt der Verlauf dorthin.
   - „Verbindung“ (Formular) ist eine Ebene {fcLayer}: Zurück schließt nur das Formular.
   - Erster Eintrag erst bei der ersten Berührung: Chrome überspringt Einträge ohne Nutzeraktion.
   - scrollRestoration manual: sonst stellt der Browser nach scrollNachWechsel die alte Position her. */
var ROOT_TAB="g-status",bStack=[ROOT_TAB],bIdx=0,bArmed=false,bWait=false,bFromPop=false,bLayer=false;
try{history.scrollRestoration="manual"}catch(e){}
history.replaceState({fcTab:ROOT_TAB,i:0},"");
function hst(){return history.state||{}}
function backFollow(){
  if(!bArmed||bFromPop)return;
  var s=hst();
  if(s.fcLayer){                                   /* Ebene obenauf: erst abbauen, dann nachziehen */
    if(bLayer){bLayer=false;showSetup(false,true)}
    if(!bWait){bWait=true;history.back()}return;
  }
  if(bWait)return;
  if(bStack[bIdx]===curTab)return;
  var k=bStack.slice(0,bIdx).lastIndexOf(curTab);
  if(k>=0){var d=k-bIdx;bIdx=k;bStack.length=k+1;bWait=true;history.go(d)}
  else{bStack.length=bIdx+1;bStack.push(curTab);bIdx++;history.pushState({fcTab:curTab,i:bIdx},"")}
}
function backLayerOpen(){if(!bArmed||bLayer)return;bLayer=true;history.pushState({fcLayer:1},"")}
function backLayerClose(){if(!bLayer)return;bLayer=false;if(hst().fcLayer){bWait=true;history.back()}}
window.addEventListener("popstate",function(){
  var s=hst();
  if(bLayer&&!s.fcLayer){bLayer=false;showSetup(false,true)}   /* Zurück bei offenem Formular */
  if(s.fcLayer){if(!bLayer)history.back();return}               /* verwaiste Ebene überspringen */
  if(typeof s.i==="number")bIdx=s.i;
  if(bWait){bWait=false;backFollow();return}
  if(!s.fcTab||s.fcTab===curTab)return;
  bFromPop=true;try{showTab(s.fcTab)}finally{bFromPop=false}
});
function bFirst(){
  ["touchend","click","keydown"].forEach(function(t){document.removeEventListener(t,bFirst,true)});
  bArmed=true;backFollow();
}
["touchend","click","keydown"].forEach(function(t){document.addEventListener(t,bFirst,true)});
/* ─── Wischen wie unter Android: Seite folgt dem Finger, rastet ein oder federt zurück.
   Überall möglich, auch auf Diagrammen: Bewegt sich der Finger in den ersten 200 ms waagerecht,
   ist es ein Seitenwechsel. Bleibt er 200 ms ruhig, übernimmt das Diagramm (Gedrückthalten, scrub.js). ─── */
(function(){
  var m=document.getElementById("main");if(!m)return;
  var HOLD=200,LOCK=10,s0=null;
  function hScroll(el){for(;el&&el!==m;el=el.parentElement){if(el.scrollWidth>el.clientWidth+2&&/(auto|scroll)/.test(getComputedStyle(el).overflowX))return true}return false}
  function cur(){return document.getElementById(curTab)}
  m.addEventListener("touchstart",function(e){
    if(e.touches.length!==1){s0=null;return}
    var t=e.touches[0],el=e.target;
    if(el.closest&&el.closest(".jump,input,select,textarea")||hScroll(el)){s0=null;return}
    s0={x:t.clientX,y:t.clientY,t:Date.now(),lock:null,dx:0}},{passive:true});
  m.addEventListener("touchmove",function(e){
    if(!s0)return;var t=e.touches[0],dx=t.clientX-s0.x,dy=t.clientY-s0.y;
    if(!s0.lock){if(Math.abs(dx)<LOCK&&Math.abs(dy)<LOCK)return;
      s0.lock=(Date.now()-s0.t<HOLD&&Math.abs(dx)>1.2*Math.abs(dy))?"h":"v";
      if(s0.lock==="v"){s0=null;return}}
    var ids=groupsAll().map(function(g){return g.id}),i=ids.indexOf(curTab);
    if((dx>0&&i===0)||(dx<0&&i===ids.length-1))dx=dx/3;   /* Widerstand am Rand */
    s0.dx=dx;var g=cur();if(g){g.style.transition="none";g.style.transform="translateX("+dx+"px)"}
    if(e.cancelable)e.preventDefault()},{passive:false});
  function end(){
    if(!s0||s0.lock!=="h"){s0=null;return}
    var g=cur(),dx=s0.dx,v=Math.abs(dx)/Math.max(1,Date.now()-s0.t),W=window.innerWidth;
    var ids=groupsAll().map(function(x){return x.id}),i=ids.indexOf(curTab),n=i+(dx<0?1:-1);s0=null;if(!g)return;
    if((Math.abs(dx)>W*0.22||v>0.5)&&n>=0&&n<ids.length&&Math.abs(dx)>30){
      g.style.transition="transform .16s ease-in";g.style.transform="translateX("+(dx<0?-W:W)+"px)";
      setTimeout(function(){g.style.transition="";g.style.transform="";showTab(ids[n],null,dx<0?1:-1)},160);
    }else{g.style.transition="transform .2s ease-out";g.style.transform="";setTimeout(function(){g.style.transition=""},220)}
  }
  m.addEventListener("touchend",end,{passive:true});m.addEventListener("touchcancel",end,{passive:true});
})();
/* ─── Karten verdichten: Kernzahlen oben, Rest unter „Details" ─── */
function keysMap(){return {"p-ziel":["Vermögen","Abweichung"],"p-alloc":["China-ADR (NIO + BABA)","ETF-Kern"],"p-puffer":["Puffer","Es fehlen","Überschuss über Schwelle"],
  "p-spar":["Überschuss","Angelegt"],"p-gem":["Lücke / Monat","Überdeckung","Einzahlung"],"p-nio":["Bestand","Z0"],"p-baba":["Bestand","Bis T1"]}}
function compact(){
  var KEYS=keysMap();
  Object.keys(KEYS).forEach(function(pid){
    var b=body("#"+pid);if(!b||b.querySelector("details.more"))return;
    var dl=b.querySelector("dl.kv");if(!dl)return;
    var key=document.createElement("div");key.className="key";
    KEYS[pid].forEach(function(lbl){[].slice.call(dl.querySelectorAll("dt")).forEach(function(dt){
      if(dt.textContent.trim()!==lbl)return;var dd=dt.nextElementSibling;if(!dd)return;
      var x=document.createElement("div");x.innerHTML="<span>"+esc(dt.textContent)+"</span><b"+(dd.getAttribute("style")?' style="'+dd.getAttribute("style")+'"':"")+">"+dd.innerHTML+"</b>";key.appendChild(x)})});
    var det=document.createElement("details");det.className="more";det.innerHTML="<summary>Details</summary>";
    var keptMeter=false,keptChart=false;
    [].slice.call(b.children).forEach(function(n){
      var c=n.classList;
      if(!keptMeter&&(c.contains("meter")||c.contains("alloc"))){keptMeter=true;return}
      if(!keptChart&&c.contains("chart")&&pid!=="p-gem"){keptChart=true;return}
      if(c.contains("keep"))return;
      det.appendChild(n)});
    if(det.children.length>1)b.appendChild(det);
    if(key.children.length){var first=b.querySelector(".keep")||b.querySelector(".meter,.alloc");
      if(first&&first.nextSibling)b.insertBefore(key,first.nextSibling);else if(first)b.appendChild(key);else b.insertBefore(key,b.firstChild)}
  });
}
document.addEventListener("visibilitychange",function(){if(!document.hidden){checkVersion();if(configured())load()}});
})();
