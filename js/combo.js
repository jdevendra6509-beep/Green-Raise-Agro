/* Searchable dropdown for every field that suggests values (items, parties, units, categories…).
   It takes over any <input list="…">: the <datalist> stays the source of options, the browser's own
   list is switched off, and a proper menu opens under the field with details, keyboard control and
   "+ Add new" for items, customers and suppliers. */
(function(){
let box=null,cur=null,opts=[],hi=-1,typed=false;
const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toUpperCase();
function upgrade(root){
  (root.querySelectorAll?root:document).querySelectorAll('input[list]').forEach(el=>{
    el.dataset.combo=el.getAttribute('list');el.removeAttribute('list');
    el.setAttribute('role','combobox');el.setAttribute('aria-autocomplete','list');el.setAttribute('aria-expanded','false');el.autocomplete='off';
  });
}
new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.nodeType===1)upgrade(n)}).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',()=>upgrade(document));

// details shown under each option
function meta(list,v){
  try{
    if(list==='dlItems'||list==='dlDocItems'){const it=window.itemInfo&&itemInfo(v);const bits=[];
      if(it){if(it.unit)bits.push(it.unit);if(it.pack)bits.push(it.pack);if(it.hsn)bits.push('HSN '+it.hsn)}
      const a=S.A&&S.A.items.find(i=>i.name===v);if(a)bits.push('Stock '+fmt(a.close));return bits.join(' · ')}
    if(list==='dlParty'){const D=S.draft||{};const key=D.type==='OUT'?'Customers':'Vendors',col=D.type==='OUT'?'Customer Name':'Vendor Name';
      const r=window.mrows&&mrows(key).find(x=>norm(x[col])===norm(v));if(!r)return '';return [pick(r,/^city$/i),pick(r,/^(phone|mobile)/i)].filter(Boolean).join(' · ')}
  }catch(e){}
  return '';
}
function addNew(list,q){
  if(!cur||!cur.closest('#entryForm')||!q)return null;
  if(list==='dlItems')return {tab:'mItems',field:'item',label:`Add “${q}” as a new item`};
  if(list==='dlParty'){const D=S.draft||{};return D.type==='OUT'?{tab:'mCust',field:'party',label:`Add “${q}” as a new customer`}:{tab:'mVend',field:'party',label:`Add “${q}” as a new supplier`}}
  return null;
}
function source(list){const dl=document.getElementById(list);return dl?[...dl.options].map(o=>o.value).filter(Boolean):[]}
function open(el,showAll){
  cur=el;const list=el.dataset.combo,q=el.value.trim(),nq=norm(q);
  const all=source(list);
  let m=showAll||!nq?all:all.filter(v=>norm(v).includes(nq));
  if(nq&&!showAll)m.sort((a,b)=>(norm(a).startsWith(nq)?0:1)-(norm(b).startsWith(nq)?0:1));
  const exact=all.some(v=>norm(v)===nq);
  opts=m.slice(0,60).map(v=>({v,meta:meta(list,v)}));
  const an=!exact?addNew(list,q):null;if(an)opts.push({add:an});
  if(!box){box=document.createElement('div');box.className='cbx';box.setAttribute('role','listbox');box.id='cbxList';document.body.appendChild(box);
    box.addEventListener('mousedown',e=>e.preventDefault());
    box.addEventListener('click',e=>{const o=e.target.closest('[data-i]');if(o)choose(+o.dataset.i)})}
  const mark=v=>{if(!nq)return esc(v);const i=norm(v).indexOf(nq);return i<0?esc(v):esc(v.slice(0,i))+'<mark>'+esc(v.slice(i,i+q.length))+'</mark>'+esc(v.slice(i+q.length))};
  hi=opts.length&&!opts[0].add?0:-1;
  box.innerHTML=opts.length?opts.map((o,i)=>o.add?`<div class="cbo add" data-i="${i}" role="option"><span class="pl">+</span><span>${esc(o.add.label)}</span></div>`
    :`<div class="cbo${i===hi?' on':''}" data-i="${i}" role="option" aria-selected="${i===hi}"><span class="v">${mark(o.v)}</span>${o.meta?`<span class="m">${esc(o.meta)}</span>`:''}</div>`).join('')
    +(m.length>60?`<div class="cbn">${m.length-60} more – keep typing to narrow down</div>`:'')
    :`<div class="cbn">${all.length?'No match':'Nothing to choose yet'}</div>`;
  box.hidden=false;el.setAttribute('aria-expanded','true');el.setAttribute('aria-controls','cbxList');place();
}
function place(){
  if(!box||box.hidden||!cur||!cur.isConnected){close();return}
  const r=cur.getBoundingClientRect(),vh=window.innerHeight,below=vh-r.bottom,h=Math.min(300,box.scrollHeight);
  box.style.minWidth=Math.max(r.width,240)+'px';box.style.maxWidth=Math.max(r.width,Math.min(460,window.innerWidth-16))+'px';
  box.style.left=Math.min(r.left,window.innerWidth-Math.max(r.width,240)-8)+'px';
  if(below<h+12&&r.top>below){box.style.top='';box.style.bottom=(vh-r.top+4)+'px'}else{box.style.bottom='';box.style.top=(r.bottom+4)+'px'}
}
function close(){if(box)box.hidden=true;if(cur)cur.setAttribute('aria-expanded','false');hi=-1}
function choose(i){
  const o=opts[i],el=cur;if(!o||!el)return;close();
  if(o.add){const b=document.createElement('button');b.dataset.quick=o.add.tab;b.dataset.qf=o.add.field;b.hidden=true;el.closest('#entryForm').appendChild(b);b.click();b.remove();return}
  el.value=o.v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  const next=el.closest('.eline')?el.closest('.eline').querySelector('.enQty'):null;if(next&&el.classList.contains('enItem')){const n=document.querySelector(`.eline[data-i="${el.closest('.eline').dataset.i}"] .enQty`);if(n)n.focus()}
}
function move(d){if(!opts.length)return;hi=(hi+d+opts.length)%opts.length;box.querySelectorAll('.cbo').forEach(n=>{const on=+n.dataset.i===hi;n.classList.toggle('on',on);n.setAttribute('aria-selected',on);if(on)n.scrollIntoView({block:'nearest'})})}
document.addEventListener('focusin',e=>{const el=e.target;if(el.dataset&&el.dataset.combo&&!(window.S&&S.inRender)){typed=false;open(el,true)}});
document.addEventListener('input',e=>{const el=e.target;if(el.dataset&&el.dataset.combo&&e.isTrusted){typed=true;open(el,false)}});
document.addEventListener('mousedown',e=>{const el=e.target;if(el.dataset&&el.dataset.combo&&document.activeElement===el&&(!box||box.hidden))open(el,true)});
document.addEventListener('focusout',e=>{if(e.target===cur)setTimeout(()=>{if(document.activeElement!==cur)close()},120)});
document.addEventListener('keydown',e=>{
  const el=e.target;if(!el.dataset||!el.dataset.combo)return;
  if(e.key==='ArrowDown'){e.preventDefault();if(!box||box.hidden)open(el,true);else move(1)}
  else if(e.key==='ArrowUp'){e.preventDefault();if(box&&!box.hidden)move(-1)}
  else if(e.key==='Enter'&&box&&!box.hidden&&hi>=0){e.preventDefault();choose(hi)}
  else if(e.key==='Escape'&&box&&!box.hidden){e.preventDefault();e.stopPropagation();close()}
  else if(e.key==='Tab'&&box&&!box.hidden&&typed&&hi>=0&&el.value.trim()&&opts[hi]&&!opts[hi].add&&norm(opts[hi].v).startsWith(norm(el.value))&&norm(opts[hi].v)!==norm(el.value)){el.value=opts[hi].v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));close()}
},true);
window.addEventListener('resize',place);window.addEventListener('scroll',place,true);

const st=document.createElement('style');st.textContent=`
.cbx{position:fixed;z-index:60;background:var(--surface);border:1px solid var(--line-2);border-radius:12px;box-shadow:var(--sh2);padding:6px;max-height:300px;overflow:auto;overscroll-behavior:contain;font:14px/1.3 var(--f-body)}
.cbx[hidden]{display:none}
.cbo{display:grid;gap:2px;padding:8px 10px;border-radius:8px;cursor:pointer;color:var(--fg)}
.cbo .v{font-weight:500}.cbo .m{font-size:12px;color:var(--fg-3)}
.cbo mark{background:transparent;color:var(--accent-ink);font-weight:700}
.cbo.on,.cbo:hover{background:var(--accent-soft)}
.cbo.add{display:flex;align-items:center;gap:8px;color:var(--accent-ink);font-weight:600;border-top:1px solid var(--line);border-radius:0 0 8px 8px;margin-top:4px;padding-top:10px}
.cbo.add .pl{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:var(--accent);color:var(--on-accent);font-weight:700}
.cbn{padding:8px 10px;font-size:12.5px;color:var(--fg-3)}
input[data-combo]{padding-right:32px!important;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a939c' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")!important;background-repeat:no-repeat!important;background-position:right 11px center!important}
`;document.head.appendChild(st);
})();
