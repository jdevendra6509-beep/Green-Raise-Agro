/* Delivery challan: preview and print, laid out like the Green Raise Agro challan pad.
   Every print gives three copies (Original, Duplicate, Triplicate), one A4 page each. */
(function(){
const COPIES=['Original – Customer','Duplicate – Transporter','Triplicate – Office'];
const ROWS=14; // ruled rows in the goods table, as on the pad
const e=s=>esc(s==null?'':String(s));
const ddmmyy=v=>{const d=sheetDay(v);if(d==null)return '';const t=dObj(d);const p=n=>String(n).padStart(2,'0');return `${p(t.getUTCDate())}/${p(t.getUTCMonth()+1)}/${String(t.getUTCFullYear()).slice(2)}`};
const money=v=>{const n=num(v);return n==null?'':'₹ '+n.toLocaleString('en-IN',{maximumFractionDigits:2})};

function challanOf(id){
  const rows=(S.files.App?S.files.App.rows:[]).filter(r=>r.id===id&&!/deleted/i.test(r.status||''));if(!rows.length)return null;
  const r0=rows[0],x=r0.x||{},g=k=>x[DCX[k]]==null?'':String(x[DCX[k]]);
  const lines=rows.map(r=>{const lx=r.x||{};return {item:r.item,qty:r.qty,hsn:lx[DCL.hsn]||'',pack:lx[DCL.pack]||'',unit:lx[DCL.unit]||'',total:lx[DCL.total]||''}});
  return {id,date:r0.date,party:r0.party,no:g('no'),entity:g('entity'),address:g('address'),mobile:g('mobile'),email:g('email'),ref:g('ref'),
    vehicle:g('vehicle'),transporter:g('transporter'),rate:g('rate'),charges:g('charges'),note:r0.narration||'',lines};
}
function pageHTML(c,copy){
  const co=S.company||{},name=(co['Company Name']||'Green Raise Agro Pvt Ltd').toUpperCase().replace(/\bPVT\b\.?\s*LTD\b\.?/,'PVT. LTD.');
  const addr=[co.Address,co.City].filter(Boolean).join(', ').replace(/\n/g,', ');
  const T=dcTotals(c.lines.map(l=>({item:l.item,qty:String(l.qty),unit:l.unit,pack:l.pack,total:l.total})));
  const body=c.lines.map((l,i)=>`<tr><td class="c">${i+1}</td><td>${e(l.item)}</td><td class="c">${e(l.hsn)}</td><td class="c">${e(l.pack)}</td><td class="c">${e(trimNum(+l.qty))}${l.unit?' '+e(l.unit):''}</td><td class="c">${e(l.total)}</td></tr>`);
  body.push(`<tr class="tot"><td></td><td class="r"><b>Total</b></td><td></td><td></td><td class="c"><b>${e(T.qty)}</b></td><td class="c"><b>${e(T.total)}</b></td></tr>`);
  while(body.length<ROWS)body.push('<tr><td></td><td></td><td></td><td></td><td></td><td></td></tr>');
  const ic=d=>`<svg viewBox="0 0 24 24" width="9" height="9" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const pin='M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4',ph='M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',ml='M4 6h16v12H4zM4 7l8 6 8-6',wb='M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18';
  return `<div class="dcp">
  <div class="dc-copy">${e(copy)}</div>
  <header class="dc-hd">
    <div class="dc-logo"><img src="img/logo.jpg" alt=""><span>GREEN RAISE<br>AGRO PVT LTD</span></div>
    <div class="dc-co"><div class="dc-name">${e(name)}<sup>®</sup></div>
      <div class="dc-info">${addr?`<span>${ic(pin)} Address: ${e(addr)}</span>`:''}${co.Phone?`<span>${ic(ph)} ${e(co.Phone)}</span>`:''}</div>
      <div class="dc-info">${co.Email?`<span>${ic(ml)} ${e(co.Email)}</span>`:''}${co.Website?`<span>${ic(wb)} ${e(co.Website)}</span>`:''}${co.GSTIN?`<span>GSTIN: ${e(co.GSTIN)}</span>`:''}</div></div>
  </header>
  <div class="dc-rule"></div>
  <div class="dc-title"><span class="dc-no">DC No. <b>${e(c.no)}</b></span><h1>Delivery Challan</h1><span class="dc-date">Date : <b>${e(ddmmyy(c.date))}</b></span></div>
  <div class="dc-f"><span class="k">Customer Name :</span><span class="v">${e(c.party)}</span></div>
  <div class="dc-f"><span class="k">Address</span><span class="v"><span class="col">:</span> ${e(c.address)}</span></div>
  <div class="dc-f two"><span class="k">Mobile No.</span><span class="v"><span class="col">:</span> ${e(c.mobile)}${c.ref?` &nbsp; ${e(c.ref)}`:''}</span><span class="k">Email ID :</span><span class="v">${e(c.email)}</span></div>
  <div class="dc-tw"><img class="dc-wm" src="img/logo.jpg" alt="">
  <table class="dc-t"><colgroup><col style="width:7%"><col style="width:39%"><col style="width:13%"><col style="width:13%"><col style="width:14%"><col style="width:14%"></colgroup>
    <thead><tr><th>No.</th><th>Descriptions of Goods</th><th>HSN Code</th><th>Packing</th><th>Qty.</th><th>Total</th></tr></thead>
    <tbody>${body.join('')}</tbody>
    <tfoot>
      <tr><td colspan="4" class="l">Vehicle No. : <b>${e(c.vehicle)}</b></td><td class="c lbl">TOTAL</td><td class="c"><b>${e(T.total||T.qty)}</b></td></tr>
      <tr><td colspan="6" class="l">Transporter : <b>${e(c.transporter)}</b></td></tr>
      <tr><td colspan="6" class="l"><span class="tc">Transporter Charges: <b>${e(c.rate?money(c.rate):'')}</b></span><span class="tc">/MT Total : <b>${e(c.charges?money(c.charges):'')}</b></span></td></tr>
    </tfoot></table></div>
  ${c.entity||c.note?`<div class="dc-meta">${c.entity?`Dispatch from: ${e(c.entity)}`:''}${c.entity&&c.note?' · ':''}${c.note?`Note: ${e(c.note)}`:''}</div>`:''}
  <div class="dc-sg"><span class="mr">वरील प्रमाणे माल तपासून घेतला.</span><span class="for">For ${e(name)}<sup>®</sup></span></div>
  <div class="dc-sg low"><span>Receiver Sign.</span><span>Authorised Sign.</span></div>
</div>`;
}
window.challanHTML=(id,all)=>{const c=challanOf(id);if(!c)return '';return (all?COPIES:[COPIES[0]]).map(k=>pageHTML(c,k)).join('')};
window.printDC=function(id){
  const c=challanOf(id);if(!c){toast('That challan was not found. Refresh and try again.');return}
  openDlg(`Delivery Challan ${c.no}`,`<div class="dc-bar"><button class="btn pri" type="button" data-dcprint="${e(id)}">Print 3 copies</button><span class="muted">Original, Duplicate and Triplicate, one A4 page each. Choose “Save as PDF” in the print window for a PDF.</span></div>
    <div class="dc-prev"><div class="dc-scale">${pageHTML(c,COPIES[0])}</div></div>`);
};
function doPrint(id){
  const c=challanOf(id);if(!c)return;
  let a=document.getElementById('printArea');if(!a){a=document.createElement('div');a.id='printArea';document.body.appendChild(a)}
  a.innerHTML=COPIES.map(k=>pageHTML(c,k)).join('');a.classList.add('dcprint');
  const old=document.title;document.title=`Delivery Challan ${c.no}`;
  const imgs=[...a.querySelectorAll('img')];
  Promise.all(imgs.map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>setTimeout(()=>{try{window.print()}catch(err){toast('Printing is not available here.')}document.title=old;a.classList.remove('dcprint')},60));
}
document.addEventListener('click',ev=>{const b=ev.target.closest&&ev.target.closest('[data-dcprint]');if(b)doPrint(b.dataset.dcprint)});

const st=document.createElement('style');st.textContent=`
.dc-bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.dc-prev{background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:16px;overflow:auto}
.dc-scale{width:190mm;margin:0 auto;background:#fff;box-shadow:0 2px 12px rgb(0 0 0 / .12)}
@media (max-width:820px){.dc-prev{padding:8px}.dc-scale{zoom:.5}}
.dcp{--g:#1f5f2e;--gl:#5e8f4e;position:relative;width:190mm;height:276mm;box-sizing:border-box;padding:7mm 8mm 8mm;color:#111;background:#fff;font:12.5px/1.35 Arial,Helvetica,sans-serif;display:flex;flex-direction:column}
.dcp .dc-copy{position:absolute;top:3mm;right:8mm;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:#555}
.dcp .dc-hd{display:flex;align-items:center;gap:4mm}
.dcp .dc-logo{display:grid;justify-items:center;gap:1mm;padding-right:4mm;border-right:1.5px solid var(--g)}
.dcp .dc-logo img{width:17mm;height:17mm;object-fit:contain}
.dcp .dc-logo span{font:700 7px/1.1 Georgia,'Times New Roman',serif;color:var(--g);text-align:center;letter-spacing:.03em}
.dcp .dc-co{flex:1;min-width:0}
.dcp .dc-name{font:700 26px/1.05 Georgia,'Times New Roman',serif;color:var(--g);letter-spacing:.02em;white-space:nowrap}
.dcp .dc-name sup,.dcp .for sup{font-size:.45em;vertical-align:top}
.dcp .dc-info{display:flex;flex-wrap:wrap;gap:1mm 5mm;font-size:9.5px;color:#333;margin-top:1.4mm}
.dcp .dc-info span{display:inline-flex;align-items:center;gap:1.2mm}
.dcp .dc-info svg{color:var(--g)}
.dcp .dc-rule{border-top:2.2px solid var(--g);border-bottom:.8px solid var(--g);height:1.2mm;margin:2.5mm 0 3mm}
.dcp .dc-title{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;margin-bottom:3mm}
.dcp .dc-title h1{font:700 17px/1 Arial,Helvetica,sans-serif;margin:0;letter-spacing:.02em;color:#111}
.dcp .dc-no{font-size:12px}.dcp .dc-no b{font-size:19px;margin-left:2mm}
.dcp .dc-date{text-align:right;font-size:12.5px}
.dcp .dc-f{display:grid;grid-template-columns:28mm 1fr;align-items:end;gap:2mm;margin:0 0 2.2mm}
.dcp .dc-f.two{grid-template-columns:28mm 1fr auto 52mm}
.dcp .dc-f .k{font-size:12px;white-space:nowrap}
.dcp .dc-f .v{border-bottom:1px solid #444;min-height:5.5mm;font-weight:600;font-size:13px;padding:0 1mm;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.dcp .dc-f .col{font-weight:400}
.dcp .dc-tw{position:relative;flex:1;display:flex;margin-top:1.5mm}
.dcp .dc-wm{position:absolute;left:50%;top:44%;width:70mm;transform:translate(-50%,-50%);opacity:.07;pointer-events:none;filter:grayscale(.2)}
.dcp .dc-t{width:100%;border-collapse:collapse;table-layout:fixed;align-self:stretch;height:100%}
.dcp .dc-t th,.dcp .dc-t td{border:1px solid var(--gl);padding:1.2mm 1.6mm;font-size:12px;color:#111;background:transparent;white-space:normal;position:static;vertical-align:middle;text-align:left;font-weight:400}
.dcp .dc-t thead th{font-weight:700;text-align:center;font-size:11.5px;text-transform:none;letter-spacing:0;color:#111;border-top:1.5px solid var(--g);border-bottom:1.5px solid var(--g)}
.dcp .dc-t tbody td{height:7.6mm}
.dcp .dc-t tr.tot td{border-top:1.2px solid var(--g)}
.dcp .dc-t tfoot td{height:7.6mm;font-weight:400;position:static}
.dcp .dc-t tfoot tr:first-child td{border-top:1.5px solid var(--g)}
.dcp .dc-t .lbl{font-size:10px;font-weight:700;letter-spacing:.05em}
.dcp .dc-t .c{text-align:center}.dcp .dc-t .r{text-align:right}
.dcp .tc{display:inline-block;min-width:48%}
.dcp .dc-meta{font-size:10px;color:#444;margin-top:1.5mm}
.dcp .dc-sg{display:flex;justify-content:space-between;align-items:flex-end;margin-top:4mm;font-size:12.5px}
.dcp .dc-sg .mr{font-family:'Noto Sans Devanagari','Mangal',sans-serif;font-weight:600}
.dcp .dc-sg .for{font:700 13px Georgia,'Times New Roman',serif;color:var(--g)}
.dcp .dc-sg.low{margin-top:14mm;color:#333}
@media print{
  #printArea.dcprint .dcp{page-break-after:always;break-after:page;margin:0 auto}
  #printArea.dcprint .dcp:last-child{page-break-after:auto;break-after:auto}
  #printArea.dcprint{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}`;document.head.appendChild(st);
})();
