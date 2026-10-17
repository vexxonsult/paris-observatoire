import { dossier, sources, events, illustrativeRoute } from './data.js';

const $ = id => document.getElementById(id);
const colors = { rassemblement:'#b7cc9a', incendie:'#f5a465', incident:'#df796c', blocage:'#8eb4cf', annonce:'#d4be7b' };
const categories = { rassemblement:'Rassemblement', incendie:'Incendie', incident:'Incident / prévention', blocage:'Blocage', annonce:'Annonce' };
const state = { minute:dossier.endMinute, selected:null, playing:false, speed:300, filters:new Set(Object.keys(colors)), search:'', route:false, ready:false, markers:new Map(), mobile:false, reduced:matchMedia('(prefers-reduced-motion: reduce)').matches };
let map, routeMarker, lastFrame = 0, lastRenderedMinute = -1, mapErrorCount = 0;
const pad = n => String(n).padStart(2,'0');
const hhmm = minute => `${pad(Math.floor(minute/60))}:${pad(Math.floor(minute%60))}`;
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const matches = event => state.filters.has(event.category) && `${event.title} ${event.place} ${event.description}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(state.search);
const eligible = () => events.filter(matches);
const shown = () => eligible().filter(event=>event.minute <= state.minute);
const icon = category => {
  const paths = {incendie:'<path d="M8 2c1 3-3 4-3 8a4 4 0 0 0 8 0c0-2-1-3-2-4 0 2-1 3-2 3 1-3 1-5-1-7Z"/>',rassemblement:'<circle cx="8" cy="5" r="2"/><path d="M4 14v-2a4 4 0 0 1 8 0v2M2 6a2 2 0 0 0 0 4m12-4a2 2 0 0 1 0 4"/>',incident:'<path d="m8 2 7 12H1L8 2Z"/><path d="M8 6v4m0 2v.1"/>',blocage:'<path d="M2 5h12v6H2zM4 5l4 6m0-6 4 6M3 11v3m10-3v3"/>',annonce:'<circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/>'};
  return `<svg viewBox="0 0 16 16" aria-hidden="true">${paths[category]}</svg>`;
};

function renderList() {
  const list = eligible();
  $('list-count').textContent = `${list.length} ENTRÉE${list.length > 1 ? 'S' : ''} DANS LE DOSSIER`;
  $('event-list').innerHTML = list.length ? list.map(e=>`<button class="event-item ${e.id===state.selected?'selected':''} ${e.minute>state.minute?'future':''}" data-event="${e.id}" style="--color:${colors[e.category]}" aria-label="${hhmm(e.minute)} — ${esc(e.title)}${e.minute>state.minute?', aller à cette heure':''}" aria-pressed="${e.id===state.selected}"><span class="event-hour">${hhmm(e.minute)}</span><span class="event-body"><span class="event-category"><i class="dot"></i>${categories[e.category]}${e.minute>state.minute?' · à venir':''}</span><h3>${esc(e.title)}</h3><span class="event-meta"><span>${esc(sources[e.sourceIds[0]].name.split(' / ')[0])}</span><span class="confidence">${e.confidence}</span></span></span><span class="event-arrow">↗</span></button>`).join('') : '<div class="empty-list">Aucune entrée pour ces filtres.<br>Essayez un autre lieu ou réactivez une catégorie.</div>';
  $('event-list').querySelectorAll('[data-event]').forEach(button=>button.addEventListener('click',()=>selectEvent(button.dataset.event,true)));
}

function renderSources() {
  $('source-list').innerHTML = Object.values(sources).map(s=>`<article class="source-card"><a href="${s.url}" target="_blank" rel="noopener noreferrer">${esc(s.name)} <span>↗</span></a><p>${esc(s.kind)}</p><p><small>${esc(s.updatedAt)}</small></p><p>${esc(s.access)}</p></article>`).join('') + '<p class="source-limit">BFMTV, CNews et X : aucun contenu directement vérifiable retenu. La couverture de la région est partielle. Les annonces ne prouvent pas la tenue d’une action.</p><button class="latest-button" id="source-method">Lire la méthode ↗</button>';
  $('source-method').addEventListener('click',()=>$('method-dialog').showModal());
}

function renderDetail() {
  const event = events.find(e=>e.id===state.selected);
  if(!event || event.minute>state.minute || !matches(event)) { $('detail').hidden=true;return; }
  $('detail').hidden=false;
  $('detail').innerHTML = `<div class="detail-top"><div class="detail-topline"><span class="event-category" style="--color:${colors[event.category]}"><i class="dot"></i>${categories[event.category]}</span><button class="detail-close" id="detail-close" aria-label="Fermer le détail">✕</button></div><h3>${esc(event.title)}</h3><div class="detail-location">⌖ &nbsp;${esc(event.place)}</div></div><div class="detail-content"><p>${esc(event.description)}</p><div class="detail-time"><span>Confirmation</span><b>${event.confidence}</b></div><div class="detail-time"><span>État rapporté</span><b>${esc(event.status)}</b></div><div class="detail-time"><span>Heure de l’événement</span><b>${event.eventTime || 'Non établie'}</b></div><div class="detail-time"><span>Publication du point</span><b>${event.publishedTime ? `17/10 · ${event.publishedTime}` : 'Non disponible'}</b></div><p class="timing-note">${esc(event.timing)}</p><div class="precision"><b>LOCALISATION APPROXIMATIVE</b>${esc(event.precision)}.</div><div class="detail-links"><span>SOURCES CONSULTABLES</span>${event.sourceIds.map(id=>`<a href="${sources[id].url}" target="_blank" rel="noopener noreferrer">${esc(sources[id].name)} <span>↗</span></a>`).join('')}</div><p class="effect-notice">${esc(event.note)}</p><button class="latest-button" id="replay-event">↺ Rejouer ce signalement</button></div>`;
  $('detail-close').addEventListener('click',()=>{state.selected=null;render();});
  $('replay-event').addEventListener('click',()=>{setTime(event.minute);setPlaying(true);});
}

function selectEvent(id, seek=false) {
  const event=events.find(e=>e.id===id);
  if(!event) return;
  setPlaying(false);
  state.selected=id;
  if(seek) state.minute=event.minute;
  document.querySelector('.sidebar').classList.remove('mobile-open');
  state.mobile=false;
  $('mobile-events').textContent='☷ Chronologie';
  render();
  if(state.ready) {
    const mobile=innerWidth<=800;
    map.flyTo({center:event.coords,zoom:event.id==='evry'?13.8:15.1,pitch:map.getPitch()>0?55:0,bearing:-17,padding:{left:mobile?25:80,right:mobile?25:315,top:mobile?100:80,bottom:mobile?220:90},duration:state.reduced?0:1500,essential:false});
  }
}

function renderTimeline() {
  const formatted=hhmm(state.minute);
  $('current-time').innerHTML=formatted.replace(':','<span>:</span>');
  $('time-slider').value=Math.floor(state.minute);
  $('time-slider').setAttribute('aria-valuetext',`${formatted}, heure de Paris le 17 octobre 2026`);
  $('replay-label').textContent=`${state.playing?'LECTURE':'RELECTURE'} · ${formatted}`;
  const progress=(state.minute-dossier.startMinute)/(dossier.endMinute-dossier.startMinute)*100;
  document.querySelector('.timeline-track').style.setProperty('--progress',`${progress}%`);
  $('time-thumb').style.left=`${progress}%`;
  $('timeline-ticks').innerHTML=eligible().map(e=>`<span class="timeline-tick" style="left:${(e.minute-dossier.startMinute)/(dossier.endMinute-dossier.startMinute)*100}%;--color:${colors[e.category]}" title="${hhmm(e.minute)} · ${esc(e.title)}"></span>`).join('');
  const visible=shown();
  $('stat-events').textContent=pad(visible.length);
  $('stat-fires').textContent=pad(visible.filter(e=>e.category==='incendie').length);
  $('stat-sources').textContent=pad(new Set(visible.flatMap(e=>e.sourceIds)).size);
  $('empty-map').hidden=visible.length>0;
}

function updateMarkers() {
  if(!state.ready)return;
  for(const event of events) {
    const marker=state.markers.get(event.id);
    if(!marker)continue;
    const node=marker.getElement();
    node.style.display=event.minute<=state.minute && matches(event)?'flex':'none';
    node.classList.toggle('selected',event.id===state.selected);
    node.classList.toggle('recent',state.minute>=event.minute&&state.minute<event.minute+4);
    node.style.opacity=event.id===state.selected||state.minute-event.minute<30?'1':'.72';
  }
  const routeVisible=state.route&&state.minute>=930&&state.filters.has('rassemblement');
  if(map.getLayer('route-line')) map.setLayoutProperty('route-line','visibility',routeVisible?'visible':'none');
  if(map.getLayer('route-glow')) map.setLayoutProperty('route-glow','visibility',routeVisible?'visible':'none');
  updateRoute();
}

function routePosition(minute) {
  const fraction=Math.max(0,Math.min(1,(minute-930)/(1083-930)));
  const distances=illustrativeRoute.slice(1).map((p,i)=>Math.hypot((p[0]-illustrativeRoute[i][0])*.66,p[1]-illustrativeRoute[i][1]));
  const total=distances.reduce((a,b)=>a+b,0);let remaining=fraction*total;
  for(let i=0;i<distances.length;i++){
    if(remaining<=distances[i]){const f=remaining/distances[i];return illustrativeRoute[i].map((v,j)=>v+(illustrativeRoute[i+1][j]-v)*f);}
    remaining-=distances[i];
  }
  return illustrativeRoute.at(-1);
}
function updateRoute() {
  if(!routeMarker)return;
  const visible=state.route&&state.minute>=930&&state.minute<=1083&&state.filters.has('rassemblement');
  routeMarker.getElement().style.display=visible?'block':'none';
  if(visible)routeMarker.setLngLat(routePosition(state.minute));
  $('route-notice').hidden=!state.route;
}

function render() {renderList();renderTimeline();renderDetail();updateMarkers();lastRenderedMinute=Math.floor(state.minute);}
function setTime(minute){state.minute=Math.max(dossier.startMinute,Math.min(dossier.endMinute,Number(minute)));render();}
function setPlaying(value){state.playing=value;$('play-button').classList.toggle('playing',value);$('play-button').setAttribute('aria-label',value?'Mettre en pause':'Lire la journée');$('play-icon').textContent=value?'Ⅱ':'▶';$('replay-label').textContent=`${value?'LECTURE':'RELECTURE'} · ${hhmm(state.minute)}`;}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4500);}

async function initializeMap() {
  if(!window.maplibregl){$('map-loading').textContent='La bibliothèque cartographique est indisponible. La chronologie et les sources restent consultables.';return;}
  try{
    const response=await fetch('https://tiles.openfreemap.org/styles/dark');
    if(!response.ok)throw new Error(`Fond cartographique : ${response.status}`);
    const style=await response.json();
    for(const layer of style.layers){
      if(layer.paint?.['fill-pattern'])delete layer.paint['fill-pattern'];
      if(layer.type==='background')layer.paint['background-color']='#182024';
      if(layer.type==='fill'&&layer.id.includes('water'))layer.paint['fill-color']='#182c36';
      if(layer.type==='fill'&&/park|landcover|landuse/.test(layer.id))layer.paint['fill-color']='#1c2829';
      if(layer.type==='line'&&/road|bridge|tunnel/.test(layer.id)){layer.paint['line-color']=/motorway|trunk|primary/.test(layer.id)?'#48514f':'#344044';}
      if(layer.type==='symbol'&&layer.layout?.['text-field']){
        layer.layout['text-field']=['coalesce',['get','name:fr'],['get','name']];
        layer.paint={...layer.paint,'text-color':'#9caeb5','text-halo-color':'#182024','text-halo-width':1.2};
        if(/poi|housenumber/.test(layer.id))layer.layout.visibility='none';
      }
    }
    map=new maplibregl.Map({container:'map',style,center:[2.351,48.866],zoom:12.7,pitch:48,bearing:-17,maxPitch:70,minZoom:8,maxZoom:19,antialias:true,attributionControl:{compact:true},maxBounds:[[1.25,48.02],[3.65,49.4]]});
    map.on('load',()=>{
      const before=map.getStyle().layers.find(l=>l.type==='symbol'&&l.layout?.['text-field'])?.id;
      map.addLayer({id:'buildings-3d',source:'openmaptiles','source-layer':'building',type:'fill-extrusion',minzoom:12,paint:{'fill-extrusion-color':['interpolate',['linear'],['coalesce',['get','render_height'],12],0,'#273236',35,'#414b4b',100,'#6b7266'],'fill-extrusion-height':['coalesce',['get','render_height'],12],'fill-extrusion-base':['coalesce',['get','render_min_height'],0],'fill-extrusion-opacity':.9,'fill-extrusion-vertical-gradient':true}},before);
      map.setLight({anchor:'viewport',color:'#f8d4a4',intensity:.38,position:[1.5,220,40]});
      map.addSource('route',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:illustrativeRoute},properties:{}}});
      map.addLayer({id:'route-glow',type:'line',source:'route',layout:{visibility:'none','line-cap':'round'},paint:{'line-color':'#f5a465','line-width':10,'line-opacity':.1,'line-blur':5}});
      map.addLayer({id:'route-line',type:'line',source:'route',layout:{visibility:'none','line-cap':'round'},paint:{'line-color':'#f5a465','line-width':2,'line-dasharray':[2,3],'line-opacity':.8}});
      for(const event of events){
        const node=document.createElement('button');node.className=`marker ${event.category}`;node.style.setProperty('--color',colors[event.category]);node.innerHTML=icon(event.category)+`<span class="marker-label">${hhmm(event.minute)} · ${esc(event.place)}</span>`;node.setAttribute('aria-label',`${hhmm(event.minute)} — ${event.title}`);node.title=`${event.place} · ${hhmm(event.minute)} · position approximative`;
        node.addEventListener('click',ev=>{ev.stopPropagation();selectEvent(event.id);});
        state.markers.set(event.id,new maplibregl.Marker({element:node}).setLngLat(event.coords).addTo(map));
      }
      const moving=document.createElement('div');moving.className='marker-dot';moving.title='Position illustrative interpolée, pas un suivi réel';
      routeMarker=new maplibregl.Marker({element:moving}).setLngLat(illustrativeRoute[0]).addTo(map);
      state.ready=true;$('map-loading').hidden=true;updateMarkers();
      map.on('move',resizeEffects);map.on('resize',resizeEffects);resizeEffects();
    });
    map.on('error',error=>{mapErrorCount++;console.warn('Carte :',error.error?.message);if(!state.ready&&mapErrorCount>3){$('map-loading').textContent='Le fond de carte ne répond pas. La chronologie reste disponible. Rechargez la page pour réessayer.';}});
    setTimeout(()=>{if(!state.ready)$('map-loading').textContent='Le chargement du fond de carte prend du temps. Vérifiez votre connexion ; les événements restent disponibles à gauche.';},18000);
  }catch(error){console.error(error);$('map-loading').textContent='Carte indisponible (connexion ou WebGL). Vous pouvez consulter toute la chronologie et les sources.';}
}

const canvas=$('atmosphere');const ctx=canvas.getContext('2d');let effectWidth=0,effectHeight=0;
function resizeEffects(){const bounds=canvas.getBoundingClientRect();effectWidth=bounds.width;effectHeight=bounds.height;const dpr=Math.min(devicePixelRatio||1,2);if(canvas.width!==Math.round(effectWidth*dpr)||canvas.height!==Math.round(effectHeight*dpr)){canvas.width=Math.round(effectWidth*dpr);canvas.height=Math.round(effectHeight*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);}}
function drawEffects(time){
  ctx.clearRect(0,0,effectWidth,effectHeight);
  if(!state.ready||state.reduced)return;
  const active=shown().filter(e=>e.effect&&state.minute>=e.minute&&state.minute<e.minute+4);
  for(const event of active){
    const p=map.project(event.coords);if(p.x<0||p.x>effectWidth||p.y<0||p.y>effectHeight)continue;
    const scale=Math.max(.65,Math.min(1.7,(map.getZoom()-10)/3));
    const t=time/1000;
    if(event.effect==='fire'){
      const glow=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,45*scale);glow.addColorStop(0,'rgba(253,131,46,.3)');glow.addColorStop(1,'rgba(253,100,30,0)');ctx.fillStyle=glow;ctx.fillRect(p.x-50*scale,p.y-50*scale,100*scale,100*scale);
      for(let i=0;i<9;i++){const phase=(t*.75+i*.137)%1;const x=p.x+Math.sin(t*3+i*2)*5*scale;const y=p.y-phase*31*scale;ctx.beginPath();ctx.ellipse(x,y,(2+3*(1-phase))*scale,(4+7*(1-phase))*scale,Math.sin(i)*.3,0,Math.PI*2);ctx.fillStyle=`rgba(255,${120+Math.round(phase*100)},70,${(1-phase)*.75})`;ctx.fill();}
    }
    for(let i=0;i<13;i++){
      const phase=(t*.12+i/13)%1;const drift=Math.sin(i*4)*7+phase*30;const x=p.x+drift*scale;const y=p.y-12*scale-phase*115*scale;const radius=(7+phase*25)*scale;const smoke=ctx.createRadialGradient(x,y,1,x,y,radius);smoke.addColorStop(0,`rgba(131,141,140,${(1-phase)*.14})`);smoke.addColorStop(1,'rgba(70,85,90,0)');ctx.fillStyle=smoke;ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
    }
  }
}
function frame(time){
  const elapsed=lastFrame?Math.min((time-lastFrame)/1000,.25):0;lastFrame=time;
  if(state.playing){
    state.minute=Math.min(dossier.endMinute,state.minute+elapsed*state.speed/60);
    if(Math.floor(state.minute)!==lastRenderedMinute){render();}
    else updateRoute();
    if(state.minute>=dossier.endMinute){setPlaying(false);render();toast('Fin du dossier · dernier point de source à 18:26.');}
  }
  drawEffects(time);requestAnimationFrame(frame);
}

$('play-button').addEventListener('click',()=>{if(!state.playing&&state.minute>=dossier.endMinute){state.selected=null;setTime(dossier.startMinute);}setPlaying(!state.playing);});
$('time-slider').addEventListener('input',event=>{setPlaying(false);setTime(event.target.value);});
$('speed').addEventListener('change',event=>state.speed=Number(event.target.value));
$('latest-button').addEventListener('click',()=>{setPlaying(false);state.selected=null;setTime(dossier.endMinute);overview(false);});
$('search').addEventListener('input',event=>{state.search=event.target.value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();render();});
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{const filter=button.dataset.filter;if(state.filters.has(filter))state.filters.delete(filter);else state.filters.add(filter);button.classList.toggle('active',state.filters.has(filter));button.setAttribute('aria-pressed',state.filters.has(filter));render();}));
$('route-toggle').addEventListener('change',event=>{state.route=event.target.checked;updateMarkers();$('route-notice').hidden=!state.route;if(state.route)toast('Liaison illustrative de 15:30 à 18:03. Les positions intermédiaires sont estimées.');});
$('zoom-in').addEventListener('click',()=>{if(state.ready)map.zoomIn({duration:300});});
$('zoom-out').addEventListener('click',()=>{if(state.ready)map.zoomOut({duration:300});});
$('pitch-button').addEventListener('click',()=>{if(!state.ready)return;const tilted=map.getPitch()<10;map.easeTo({pitch:tilted?55:0,duration:state.reduced?0:800});$('pitch-button').classList.toggle('active',tilted);$('pitch-button').setAttribute('aria-pressed',tilted);$('pitch-button').textContent=tilted?'3D':'2D';});
$('rotate-button').addEventListener('click',()=>{if(state.ready)map.easeTo({bearing:map.getBearing()+45,duration:state.reduced?0:600});});
$('north-button').addEventListener('click',()=>{if(state.ready)map.easeTo({bearing:0,duration:state.reduced?0:600});});
function overview(idf){
  $('paris-view').classList.toggle('active',!idf);$('idf-view').classList.toggle('active',idf);
  if(state.ready)map.flyTo({center:idf?[2.38,48.79]:[2.351,48.866],zoom:idf?9.65:12.7,bearing:idf?0:-17,pitch:idf?30:48,padding:{left:0,right:0,top:0,bottom:0},duration:state.reduced?0:1400});
  $('pitch-button').classList.add('active');$('pitch-button').setAttribute('aria-pressed','true');$('pitch-button').textContent='3D';
}
$('paris-view').addEventListener('click',()=>overview(false));$('idf-view').addEventListener('click',()=>overview(true));
function switchTab(tab){const isEvents=tab==='events';$('events-panel').hidden=!isEvents;$('sources-panel').hidden=isEvents;$('events-tab').setAttribute('aria-selected',isEvents);$('sources-tab').setAttribute('aria-selected',!isEvents);}
$('events-tab').addEventListener('click',()=>switchTab('events'));$('sources-tab').addEventListener('click',()=>switchTab('sources'));
document.querySelector('.tabs').addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();const toEvents=$('sources-tab').getAttribute('aria-selected')==='true';switchTab(toEvents?'events':'sources');$(toEvents?'events-tab':'sources-tab').focus();}});
$('method-button').addEventListener('click',()=>$('method-dialog').showModal());$('close-method').addEventListener('click',()=>$('method-dialog').close());$('method-dialog').addEventListener('click',event=>{if(event.target===$('method-dialog')){const r=$('method-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('method-dialog').close();}});
$('mobile-events').addEventListener('click',()=>{state.mobile=!state.mobile;document.querySelector('.sidebar').classList.toggle('mobile-open',state.mobile);$('mobile-events').textContent=state.mobile?'✕ Fermer':'☷ Chronologie';});
$('export-button').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({dossier,sources,events,illustrativeRoute,routeDisclaimer:'Liaison illustrative, pas une trace GPS.'},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='paris-17-octobre-2026-sources.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Dossier et sources exportés.');});
document.addEventListener('keydown',event=>{const input=/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||'');if(event.code==='Space'&&!input&&!$('method-dialog').open&&document.activeElement===document.body){event.preventDefault();$('play-button').click();}if(event.key==='Escape'){state.selected=null;render();document.querySelector('.sidebar').classList.remove('mobile-open');state.mobile=false;$('mobile-events').textContent='☷ Chronologie';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)setPlaying(false);});
window.addEventListener('resize',resizeEffects);
const labels=[540,660,780,900,1020,1106];
document.querySelectorAll('.time-labels span').forEach((label,i)=>{label.style.left=`${(labels[i]-dossier.startMinute)/(dossier.endMinute-dossier.startMinute)*100}%`;});
renderSources();render();resizeEffects();initializeMap();requestAnimationFrame(frame);
