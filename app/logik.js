/* logik.js – Regel- und Rechenlogik des Cockpits (18.11.2026, aus cockpit.js herausgelöst).
   Reine Funktionen ohne DOM und ohne globalen Zustand: Eingabe sind rules/snapshot/weekly/state
   aus finance-data und ein Zeitpunkt. Läuft im Browser (window.fcLogik, vom Loader vor cockpit.js
   geladen) und in Node (require), damit App und Skripte in tools/ mit derselben Logik rechnen.
   Regelzahlen stehen nie hier, sondern nur in rules.json. */
(function(root){
"use strict";
var MON=["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
function now_(n){return n?new Date(n):new Date()}

/* Kalendertage bis zu einem Datum (Ortszeit): 0 = heute, 1 = morgen, <0 = vorbei. */
function calDays(iso,now){var a=now_(now),t=new Date(iso+"T00:00:00");a.setHours(0,0,0,0);return Math.round((t-a)/864e5)}
function isoLokal(d){var p=function(n){return (n<10?"0":"")+n};return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())}

/* Z0: Upside = WOCHENschluss über der Schwelle (präzisiert 17.11.2026). Zählt nur VOR dem Termin und
   erst nach der Festlegung von Z0 (nio.stufe0.z0Festgelegt; fehlt es, zählt jede Woche vor dem Termin). */
function z0Lage(rules,weekly,now){
  var N=rules.nio,z0=N.stufe0.z0Datum,up=N.upsideUsd,seit=N.stufe0.z0Festgelegt||"",w=(weekly&&weekly.nio)||[];
  var hit=w.find(function(x){return x.closeUsd>up&&x.datum>seit&&(!z0||x.datum<z0)})||null;
  return {z0:z0,up:up,hit:hit,tage:z0?calDays(z0,now):null};
}
/* Fehlende NIO-Wochenschlüsse: jede Woche (Mo–Fr) zwischen erstem Eintrag und der letzten fälligen Woche
   braucht einen Eintrag. Fällig ab Samstag 10 Uhr (Task läuft samstags 8:50). Ein Eintrag an einem anderen
   Wochentag (Feiertag) deckt seine Woche ab. Ergebnis: Freitage der fehlenden Wochen als Date. */
function fehlendeWochen(weekly,now){
  var w=(weekly&&weekly.nio)||[];if(!w.length)return [];
  function mo(iso){var d=new Date(iso+"T12:00:00");d.setDate(d.getDate()-((d.getDay()+6)%7));return d}
  function key(d){return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate()}
  var have={};w.forEach(function(x){have[key(mo(x.datum))]=1});
  var n=now_(now),last=new Date(n);last.setDate(n.getDate()-((n.getDay()+6)%7));last.setHours(12,0,0,0);
  var sat10=new Date(last);sat10.setDate(last.getDate()+5);sat10.setHours(10,0,0,0);
  if(n<sat10)last.setDate(last.getDate()-7);
  var out=[];for(var d=mo(w[0].datum);d<=last;d.setDate(d.getDate()+7)){
    if(!have[key(d)]){var f=new Date(d);f.setDate(d.getDate()+4);out.push(f)}}
  return out;
}
/* Erreichte Verkaufsstufen (Kurs in EUR ≥ Stufe). Ob schon verkauft wurde, weiß die Logik nicht. */
function erreichteStufen(stufen,kursEur){return (stufen||[]).filter(function(t){return kursEur>=t.eur})}
/* Alte Stufe 0 (zwei Wochenschlüsse unter der Schwelle) – nur noch zur Anzeige */
function stufe0(rules,weekly){
  var w=(weekly&&weekly.nio)||[],t=rules.nio.stufe0.triggerUsd,last2=w.slice(-2);
  return {weeks:w,both:last2.length===2&&last2.every(function(x){return x.closeUsd<t}),last:w[w.length-1]};
}

/* Portfolio-Ableitungen aus dem Snapshot */
function derive(rules,snap){
  var s=snap,R=rules;if(!s||!R)return null;
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
function puffer(state){return state&&state.puffer?state.puffer.wert:null}
function tagesgeld(snap){return snap&&typeof snap.tagesgeldEur==="number"?snap.tagesgeldEur:0}
/* Liquiditätsregel: aktiv, wenn der Puffer unter der Schwelle liegt (null = kein Puffer eingetragen) */
function liquiditaetAktiv(rules,state){var p=puffer(state);return p==null?null:p<rules.liquiditaet.pufferMin}
/* BABA-Nachkauf: Sperrgründe (TOR 3 und Liquiditätsregel). TOR 1/2 prüft die Logik nicht. */
function nachkaufSperren(rules,d,state){
  var g=[];if(liquiditaetAktiv(rules,state))g.push("Liquiditätsregel aktiv");if(d.china>rules.chinaAdrMax)g.push("TOR 3 rot");return g;
}

/* Soll-Sparrate eines Monats: Wert aus sollSparrate; vor dem ersten Soll-Monat 0, danach die Plan-Sparrate */
function monIdx(key){var p=key.split(" ");return (+p[1])*12+MON.indexOf(p[0])}
function sollRate(rules,y,m){
  var S=rules.sollSparrate||{},z=rules.zielpfad,k=MON[m]+" "+y;if(S[k]!=null)return S[k];
  var idx=Object.keys(S).map(monIdx).filter(function(v){return !isNaN(v)});if(!idx.length)return z.sparrate;
  return y*12+m<Math.min.apply(null,idx)?0:z.sparrate;
}
/* „Basisfall heute“: Startwert mit Monatszins und den SOLL-Sparraten fortgeschrieben */
function expectedToday(rules,now){
  var z=rules.zielpfad,r=z.rendite/12,sd=new Date(z.startDatum),n=Math.max(0,(now_(now)-sd)/(864e5*30.4375));
  var v=z.startWert,full=Math.floor(n),frac=n-full,y=sd.getFullYear(),m=sd.getMonth();
  for(var k=0;k<=full;k++){m++;if(m>11){m=0;y++}
    var f=k<full?1:frac;v=v*Math.pow(1+r,f)+sollRate(rules,y,m)*f}
  return v;
}
/* Monatsweise Simulation bis zum Ziel wie im Tracker: Monatszins = Jahresrendite / 12, ganze Monate gerundet */
function simulate(v0,rate,start,goal,ret){
  var r=ret/12,v=v0,pv=v0,path=[{m:0,v:v}],n=0;
  while(v<goal&&n<480){pv=v;v=v*(1+r)+rate;n++;path.push({m:n,v:v})}
  var frac=n>0?(n-1)+(goal-pv)/(v-pv):0,m=Math.round(frac);
  var dt=new Date(start.getFullYear(),start.getMonth()+m,1);
  return {n:n,date:dt,path:path,start:start};
}
function monthsBetween(a,b){return (b.getFullYear()-a.getFullYear())*12+(b.getMonth()-a.getMonth())}
/* „So weiter wie bisher“: Ø des ANGELEGTEN Betrags der letzten 3 abgeschlossenen Monate; fehlt „investiert“,
   gilt ersatzweise der Überschuss. */
function istRate(snap){
  var rows=((snap&&snap.sparplan)||[]).filter(function(r){return r.ueberschuss!=null}).slice(-3);
  if(!rows.length)return null;
  var inv=rows.every(function(r){return r.investiert!=null});
  return {rate:rows.reduce(function(a,r){return a+(inv?r.investiert:r.ueberschuss)},0)/rows.length,inv:inv,
    label:rows.map(function(r){return r.monat.slice(0,3)}).join("–")};
}
/* Zielpfad komplett: Vermögen, Abweichung zum Basisfall und die drei Szenarien */
function zielpfad(rules,snap,state,goal,now){
  var d=derive(rules,snap);if(!d)return null;
  var z=Object.assign({},rules.zielpfad);if(goal)z.ziel=goal;
  var p=puffer(state),tg=tagesgeld(snap),ges=d.total+(p||0)+tg,exp=expectedToday(rules,now);
  var sd=new Date(z.startDatum),basisStart=new Date(sd.getFullYear(),sd.getMonth()+1,1);
  var snapD=new Date(snap.stand),nowStart=new Date(snapD.getFullYear(),snapD.getMonth()+1,1);
  var basis=simulate(z.startWert,z.sparrate,basisStart,z.ziel,z.rendite);
  var kurs=simulate(ges,z.sparrate,nowStart,z.ziel,z.rendite);
  var ir=istRate(snap),trend=ir?simulate(ges,ir.rate,nowStart,z.ziel,z.rendite):null;
  return {z:z,d:d,puffer:p,tagesgeld:tg,vermoegen:ges,basisHeute:exp,abweichung:ges-exp,anteil:ges/z.ziel,
    basisStart:basisStart,basis:basis,kurs:kurs,ist:ir,trend:trend};
}

var L={MON:MON,calDays:calDays,isoLokal:isoLokal,z0Lage:z0Lage,fehlendeWochen:fehlendeWochen,erreichteStufen:erreichteStufen,
  stufe0:stufe0,derive:derive,puffer:puffer,tagesgeld:tagesgeld,liquiditaetAktiv:liquiditaetAktiv,nachkaufSperren:nachkaufSperren,
  monIdx:monIdx,sollRate:sollRate,expectedToday:expectedToday,simulate:simulate,monthsBetween:monthsBetween,istRate:istRate,
  zielpfad:zielpfad};
if(typeof module!=="undefined"&&module.exports)module.exports=L;else root.fcLogik=L;
})(typeof window!=="undefined"?window:this);
