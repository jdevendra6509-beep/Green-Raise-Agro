/* Proforma Sales Invoice and Purchase Order: form, saved list and Tally-style print layout.
   Documents are saved in the Google Sheet "Documents" tab and do not change stock.
   Relies on the helpers and state defined in index.html (S, api, loadApp, render, esc, fmt, …). */
"use strict";
const DOCT={pi:{type:'Proforma Invoice',prefix:'PI',title:'PROFORMA INVOICE',party:'Customer',partyTab:'mCust',one:'proforma invoice'},
            po:{type:'Purchase Order',prefix:'PO',title:'PURCHASE ORDER',party:'Supplier',partyTab:'mVend',one:'purchase order'}};
S.docs=null;S.company=null;S.docDraft=null;S.docDel=null;S.docSaving=false;S.docErr='';
const inr=n=>(Math.round((+n||0)*100)/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const qtyTxt=n=>(+n||0).toLocaleString('en-IN',{maximumFractionDigits:3});
const r2=n=>Math.round((+n||0)*100)/100;
const fyOf=d=>{const t=new Date(d*864e5);const y=t.getUTCMonth()>=3?t.getUTCFullYear():t.getUTCFullYear()-1;return String(y).slice(2)+'-'+String(y+1).slice(2)};
const stateCode=g=>{const m=String(g||'').trim().match(/^(\d{2})[A-Z0-9]{13}$/i);return m?m[1]:''};

/* ---------- amounts in words, Indian system ---------- */
const ONES=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const TENS=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function words99(n){return n<20?ONES[n]:TENS[Math.floor(n/10)]+(n%10?' '+ONES[n%10]:'')}
function words999(n){const h=Math.floor(n/100),r=n%100;return (h?ONES[h]+' Hundred'+(r?' ':''):'')+(r?words99(r):'')}
function inWords(amount){
  const a=Math.round((+amount||0)*100);let rupees=Math.floor(a/100);const paise=a%100;
  if(!rupees&&!paise)return 'INR Zero Only';
  const parts=[];const crore=Math.floor(rupees/1e7);rupees%=1e7;const lakh=Math.floor(rupees/1e5);rupees%=1e5;const th=Math.floor(rupees/1e3);rupees%=1e3;
  if(crore)parts.push((crore>999?inWords(crore).replace(/^INR | Only$/g,''):words999(crore))+' Crore');
  if(lakh)parts.push(words99(lakh)+' Lakh');if(th)parts.push(words99(th)+' Thousand');if(rupees)parts.push(words999(rupees));
  return 'INR '+(parts.join(' ')||'Zero')+(paise?' and '+words99(paise)+' paise':'')+' Only';
}

/* ---------- masters lookups ---------- */
function mrows(key){return (S.masters&&S.masters[key]&&S.masters[key].rows)||[]}
const pick=(r,re)=>{const k=Object.keys(r).find(h=>re.test(h));return k?String(r[k]??'').trim():''};
function partyInfo(kind,name){
  const key=kind==='pi'?'Customers':'Vendors',nameCol=kind==='pi'?'Customer Name':'Vendor Name';
  const r=mrows(key).find(x=>cleanName(x[nameCol]).toUpperCase()===cleanName(name).toUpperCase());if(!r)return null;
  const addr=[pick(r,/^address/i),pick(r,/^city$/i)].filter(Boolean).join(', ');
  return {address:addr,gstin:pick(r,/gstin/i).toUpperCase(),state:pick(r,/^state$/i)};
}
function itemInfo(name){
  const r=mrows('Items').find(x=>cleanName(x['Item Name']).toUpperCase()===cleanName(name).toUpperCase());if(!r)return null;
  return {hsn:pick(r,/^hsn/i),unit:pick(r,/^unit|uom/i),rate:toNum(pick(r,/^rate$|price/i)),gst:toNum(pick(r,/gst/i))};
}
function companyCode(){const c=S.company||{};return String(c['State Code']||'').trim().padStart(2,'0').replace(/^00$/,'')||stateCode(c.GSTIN)}

/* ---------- calculation ---------- */
function calcDoc(d){
  const lines=d.lines.filter(l=>cleanName(l.item)).map(l=>{const qty=+l.qty||0,rate=+l.rate||0,disc=+l.disc||0,gst=+l.gst||0;
    const amount=r2(qty*rate*(1-disc/100));return Object.assign({},l,{qty,rate,disc,gst,amount})});
  const cc=companyCode(),pc=stateCode(d.gstin)||(String(d.state||'').match(/\b(\d{2})\b/)||[])[1]||'';
  const inter=!!(cc&&pc&&cc!==pc);
  const taxable=r2(lines.reduce((s,l)=>s+l.amount,0));
  const hsn=new Map();
  for(const l of lines){const k=(l.hsn||'')+'|'+l.gst;const h=hsn.get(k)||{hsn:l.hsn||'',rate:l.gst,taxable:0};h.taxable+=l.amount;hsn.set(k,h)}
  const summary=[...hsn.values()].map(h=>{const tax=r2(h.taxable*h.rate/100);return Object.assign(h,{taxable:r2(h.taxable),tax,cgst:inter?0:r2(tax/2),sgst:inter?0:r2(tax-r2(tax/2)),igst:inter?tax:0})});
  const rates=new Map();for(const h of summary){const g=rates.get(h.rate)||{rate:h.rate,cgst:0,sgst:0,igst:0};g.cgst+=h.cgst;g.sgst+=h.sgst;g.igst+=h.igst;rates.set(h.rate,g)}
  const tax=r2(summary.reduce((s,h)=>s+h.tax,0));const gross=r2(taxable+tax);const total=Math.round(gross);
  return {lines,inter,taxable,tax,summary,rates:[...rates.values()].filter(g=>g.rate>0).sort((a,b)=>a.rate-b.rate),roundOff:r2(total-gross),total,qty:lines.reduce((s,l)=>s+l.qty,0)};
}

/* ---------- saved documents ---------- */
function docGroups(kind){
  const T=DOCT[kind].type;const g=new Map();
  for(const r of (S.docs||[])){if(r.type!==T||/deleted/i.test(r.status||''))continue;if(!g.has(r.id))g.set(r.id,[]);g.get(r.id).push(r)}
  return [...g.values()].map(rs=>{const h=rs[0];const d={id:h.id,type:kind,no:String(h.no||''),date:String(h.date||''),party:h.party||'',address:h.address||'',gstin:h.gstin||'',state:h.state||'',
    ref:h.ref||'',payment:h.payment||'',dispatch:h.dispatch||'',destination:h.destination||'',delivery:h.delivery||'',due:String(h.due||''),narration:h.narration||'',by:h.by||'',created:h.created||'',
    lines:rs.map(r=>({item:r.item,hsn:String(r.hsn||''),qty:+r.qty||0,unit:r.unit||'',rate:+r.rate||0,disc:+r.disc||0,gst:+r.gst||0}))};d.calc=calcDoc(d);return d});
}
function nextNo(kind,dateIso){
  const fy=fyOf(fromIso(dateIso)),pre=DOCT[kind].prefix+'/'+fy+'/';
  const n=docGroups(kind).map(d=>d.no.startsWith(pre)?parseInt(d.no.slice(pre.length),10):0).filter(x=>x>0);
  return pre+String((n.length?Math.max(...n):0)+1).padStart(3,'0');
}
function newDoc(kind){const t=iso(today());return {type:kind,no:nextNo(kind,t),date:t,party:'',address:'',gstin:'',state:'',ref:'',payment:'',dispatch:'',destination:'',delivery:'',due:'',narration:'',
  by:store.get('by',''),lines:[1,2,3].map(()=>({item:'',hsn:'',qty:'',unit:'',rate:'',disc:'',gst:''}))}}

/* ---------- pages ---------- */
function docView(kind){
  const K=DOCT[kind];
  if(S.source!=='hosted')return `<div class="panel"><p class="lede">Open the live site to make documents.</p></div>`;
  if(S.docs===null)return `<div class="panel"><p class="lede">${S.appState==='loading'?'Loading documents from the Google Sheet…':'Documents need the latest Google script. Paste google-apps-script/Code.gs into the sheet\'s Apps Script, put your secret back in, then Deploy → Manage deployments → ✏️ → New version → Deploy. Refresh this page afterwards.'}</p></div>`;
  if(S.docDraft&&S.docDraft.type===kind)return docForm(kind);
  const all=docGroups(kind);const q=S.f['dq_'+kind]||'';
  const rows=q?all.filter(d=>match(d.no,q)||match(d.party,q)||d.lines.some(l=>match(l.item,q))):all;
  const mStart=iso(today()).slice(0,8)+'01';const month=all.filter(d=>d.date>=mStart);
  const noCo=!S.company||!String(S.company['Company Name']||'').trim();
  return `<div class="kpis">
    <div class="kpi"><span class="l">This month</span><span class="v">${fmtInt(month.length)}</span><span class="s">${K.one}s</span></div>
    <div class="kpi"><span class="l">Value this month</span><span class="v">${fmtInt(month.reduce((s,d)=>s+d.calc.total,0))}</span><span class="s">₹ including tax</span></div>
    <div class="kpi"><span class="l">All ${K.one}s</span><span class="v">${fmtInt(all.length)}</span><span class="s">saved in the sheet</span></div></div>
  ${noCo?`<div class="alert"><span class="pill warn">Check</span><div><div class="t">Company details are missing</div><p>Your name, address, GSTIN, PAN and bank details print on every document. Fill them in once under Settings → Company details.</p><div class="act"><button class="btn sm" type="button" data-go="settings">Open Settings</button></div></div></div>`:''}
  <div class="panel"><div class="panel-h"><p>Saved in the Google Sheet tab "Documents". ${kind==='pi'?'A proforma invoice is a quotation-style bill; it does not change stock.':'A purchase order is sent to the supplier; stock changes only when you enter the Inward entry on receipt.'}</p></div>
  <div class="tool">${srch('dq_'+kind,'Search number, party or item')}<button class="btn pri sm" type="button" data-dact="new" data-kind="${kind}">+ New ${K.one}</button>${expBtns('d-'+kind)}</div>
  ${tableHTML('d-'+kind,[
    {k:'no',l:'No.',f:r=>`<button type="button" class="il" data-dact="view" data-kind="${kind}" data-id="${esc(r.id)}">${esc(r.no)}</button>`,x:r=>r.no},
    {k:'date',l:'Date',f:r=>dstr(fromIso(r.date)),x:r=>dstr(fromIso(r.date))},{k:'party',l:K.party},
    {k:'n',l:'Items',n:1,sv:r=>r.lines.length,f:r=>fmtInt(r.lines.length),x:r=>r.lines.length},
    {k:'taxable',l:'Taxable ₹',n:1,sv:r=>r.calc.taxable,f:r=>inr(r.calc.taxable),x:r=>r.calc.taxable},
    {k:'total',l:'Total ₹',n:1,sv:r=>r.calc.total,f:r=>`<b>${inr(r.calc.total)}</b>`,x:r=>r.calc.total},
    {k:'by',l:'Made by'},
    {k:'act',l:'',sv:r=>0,f:r=>`<button type="button" class="btn sm" data-dact="view" data-kind="${kind}" data-id="${esc(r.id)}">View / Print</button> <button type="button" class="btn sm" data-dact="edit" data-kind="${kind}" data-id="${esc(r.id)}">Edit</button> <button type="button" class="btn sm" data-dact="del" data-kind="${kind}" data-id="${esc(r.id)}" ${S.docDel===r.id?'style="border-color:var(--crit);color:var(--crit)"':''}>${S.docDel===r.id?'Tap again to delete':'Delete'}</button>`,x:r=>''}
  ],rows,{sort:'date',dir:-1,title:K.type+'s',empty:all.length?'No match for this search.':`No ${K.one}s yet. Tap "+ New ${K.one}" to make the first one.`})}</div>`;
}
function docForm(kind){
  const K=DOCT[kind],D=S.docDraft,C=calcDoc(D);
  const items=[...new Set([...masterNames('mItems',true),...(S.A?S.A.items.map(i=>i.name):[])])].sort();
  const parties=[...new Set([...masterNames(K.partyTab),...((kind==='pi'?S.A&&S.A.cust:S.A&&S.A.sup)||[]).map(p=>p.name).filter(n=>n!=='(NO NAME)')])].sort();
  const f=(id,l,v,ph='',type='text')=>`<label>${l}<input type="${type}" id="${id}" value="${esc(v)}" placeholder="${esc(ph)}" autocomplete="off"${id==='dParty'?' list="dlDocParty"':''}></label>`;
  const line=(l,i)=>`<tr class="dline" data-i="${i}">
    <td><input type="text" class="dItem" list="dlDocItems" value="${esc(l.item)}" placeholder="Item" aria-label="Item ${i+1}"></td>
    <td><input type="text" class="dHsn" value="${esc(l.hsn)}" aria-label="HSN ${i+1}"></td>
    <td><input type="number" step="any" inputmode="decimal" class="dQty" value="${esc(l.qty)}" aria-label="Quantity ${i+1}"></td>
    <td><input type="text" class="dUnit" value="${esc(l.unit)}" aria-label="Unit ${i+1}"></td>
    <td><input type="number" step="any" inputmode="decimal" class="dRate" value="${esc(l.rate)}" aria-label="Rate ${i+1}"></td>
    <td><input type="number" step="any" inputmode="decimal" class="dDisc" value="${esc(l.disc)}" aria-label="Discount ${i+1}"></td>
    <td><input type="number" step="any" inputmode="decimal" class="dGst" value="${esc(l.gst)}" aria-label="GST ${i+1}"></td>
    <td class="n dAmt">${inr(r2((+l.qty||0)*(+l.rate||0)*(1-(+l.disc||0)/100)))}</td>
    <td><button type="button" class="btn sm" data-dact="rmline" data-i="${i}" aria-label="Remove line ${i+1}">✕</button></td></tr>`;
  return `<form class="panel" id="docForm" novalidate>
    <div class="panel-h"><h2>${D.replaces?'Edit':'New'} ${K.one}</h2><p>Item and party details fill in from the masters. Change anything before saving.</p></div>
    <div class="egrid">
      ${f('dNo','Voucher no.',D.no)}${f('dDate','Dated',D.date,'','date')}
      ${f('dParty',kind==='pi'?'Buyer (Bill to)':'Supplier (Bill from)',D.party,'Name')}${f('dGstin','GSTIN/UIN',D.gstin,'Optional')}
    </div>
    <label class="full">Address<textarea id="dAddress" rows="2" placeholder="Address">${esc(D.address)}</textarea></label>
    <div class="egrid" style="margin-top:10px">
      ${f('dState','State name',D.state,'For example: Maharashtra, Code 27')}
      ${kind==='pi'?f('dRef',"Buyer's order no.",D.ref,'Optional'):f('dRef','Reference no. & date',D.ref,'Optional')}
      ${f('dPayment','Mode/Terms of payment',D.payment,'For example: 30 days')}
      ${f('dDispatch','Dispatched through',D.dispatch,'Optional')}${f('dDestination','Destination',D.destination,'Optional')}
      ${kind==='po'?f('dDue','Due on',D.due,'','date'):''}
      ${f('dDelivery','Terms of delivery',D.delivery,'Optional')}${f('dBy','Made by',D.by,'Your name')}
    </div>
    <div class="tw" style="margin-top:12px"><table class="dtable"><thead><tr><th><button type="button">Description of goods</button></th><th><button type="button">HSN/SAC</button></th><th class="n"><button type="button">Quantity</button></th><th><button type="button">per</button></th><th class="n"><button type="button">Rate ₹</button></th><th class="n"><button type="button">Disc. %</button></th><th class="n"><button type="button">GST %</button></th><th class="n"><button type="button">Amount ₹</button></th><th></th></tr></thead>
      <tbody id="dLines">${D.lines.map(line).join('')}</tbody></table></div>
    <div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn sm" data-dact="addline">+ Add item</button></div>
    <div class="dtotals" id="dTotals">${totalsHTML(C)}</div>
    <label class="full">Narration<textarea id="dNote" rows="2" placeholder="Optional note printed on the document">${esc(D.narration)}</textarea></label>
    <p class="eerr" ${S.docErr?'':'hidden'}>${esc(S.docErr)}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
      <button type="submit" class="btn pri" data-print="0" ${S.docSaving?'disabled':''}>${S.docSaving?'Saving…':'Save'}</button>
      <button type="button" class="btn" data-dact="saveprint" ${S.docSaving?'disabled':''}>Save and print</button>
      <button type="button" class="btn" data-dact="cancel">Cancel</button></div>
    <datalist id="dlDocItems">${items.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
    <datalist id="dlDocParty">${parties.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
  </form>`;
}
function totalsHTML(C){
  const row=(l,v,b)=>`<div class="drow${b?' b':''}"><span>${l}</span><span class="num">${v}</span></div>`;
  return row('Taxable value','₹ '+inr(C.taxable))+C.rates.map(g=>C.inter?row(`IGST @ ${g.rate}%`,'₹ '+inr(g.igst)):row(`CGST @ ${g.rate/2}%`,'₹ '+inr(g.cgst))+row(`SGST @ ${g.rate/2}%`,'₹ '+inr(g.sgst))).join('')
    +(C.roundOff?row('Round off','₹ '+inr(C.roundOff)):'')+row('Total','₹ '+inr(C.total),1)+`<div class="muted" style="font-size:12.5px;margin-top:4px">${esc(inWords(C.total))}</div>`
    +(companyCode()?'':`<div class="muted" style="font-size:12px;margin-top:4px">Add your GSTIN in Settings → Company details so CGST/SGST or IGST is chosen correctly.</div>`);
}
function readDocForm(){
  const D=S.docDraft;const g=id=>{const e=document.getElementById(id);return e?e.value:undefined};
  const map={dNo:'no',dDate:'date',dParty:'party',dGstin:'gstin',dAddress:'address',dState:'state',dRef:'ref',dPayment:'payment',dDispatch:'dispatch',dDestination:'destination',dDue:'due',dDelivery:'delivery',dBy:'by',dNote:'narration'};
  for(const [id,k] of Object.entries(map)){const v=g(id);if(v!==undefined)D[k]=v}
  D.lines=[...document.querySelectorAll('#dLines .dline')].map(r=>({item:r.querySelector('.dItem').value,hsn:r.querySelector('.dHsn').value,qty:r.querySelector('.dQty').value,
    unit:r.querySelector('.dUnit').value,rate:r.querySelector('.dRate').value,disc:r.querySelector('.dDisc').value,gst:r.querySelector('.dGst').value}));
}
function refreshDoc(){
  const C=calcDoc(S.docDraft);
  document.querySelectorAll('#dLines .dline').forEach((r,i)=>{const l=S.docDraft.lines[i];if(l)r.querySelector('.dAmt').textContent=inr(r2((+l.qty||0)*(+l.rate||0)*(1-(+l.disc||0)/100)))});
  const t=$('#dTotals');if(t)t.innerHTML=totalsHTML(C);
}
function rerenderDoc(){const y=window.scrollY;render();window.scrollTo(0,y)}

/* ---------- Tally-style print layout ---------- */
function companyBlock(){
  const c=S.company||{};const st=[c.State,c['State Code']?'Code : '+c['State Code']:''].filter(Boolean).join(', ');
  return `<b class="big">${esc(c['Company Name']||'Green Raise Agro Pvt Ltd')}</b><br>${esc(c.Address||'').replace(/\n/g,'<br>')}${c.City?'<br>'+esc(c.City):''}
    ${c.GSTIN?`<br>GSTIN/UIN: ${esc(c.GSTIN)}`:''}${st?`<br>State Name : ${esc(st)}`:''}${c.Phone?`<br>Contact : ${esc(c.Phone)}`:''}${c.Email?`<br>E-Mail : ${esc(c.Email)}`:''}`;
}
function partyBlock(d,label){
  const code=stateCode(d.gstin);
  return `<span class="lbl">${label}</span><br><b class="big">${esc(d.party)}</b>${d.address?'<br>'+esc(d.address).replace(/\n/g,'<br>'):''}
    ${d.gstin?`<br>GSTIN/UIN : ${esc(d.gstin)}`:''}${d.state||code?`<br>State Name : ${esc(d.state||'')}${code&&!/code/i.test(d.state||'')?`, Code : ${code}`:''}`:''}`;
}
const cell=(l,v)=>`<span class="lbl">${l}</span><br><b>${esc(v||'')}</b>`;
function docPrintHTML(d){
  const K=DOCT[d.type],C=d.calc||calcDoc(d),c=S.company||{},isPO=d.type==='po';
  const head=isPO
    ?`<tr><td rowspan="4" class="half">${companyBlock().replace('<b class="big">','<span class="lbl">Invoice To</span><br><b class="big">')}</td><td>${cell('Voucher No.',d.no)}</td><td>${cell('Dated',dstr(fromIso(d.date)))}</td></tr>
      <tr><td>&nbsp;</td><td>${cell('Mode/Terms of Payment',d.payment)}</td></tr>
      <tr><td>${cell('Reference No. & Date.',d.ref)}</td><td>${cell('Other References','')}</td></tr>
      <tr><td>${cell('Dispatched through',d.dispatch)}</td><td>${cell('Destination',d.destination)}</td></tr>
      <tr><td class="half">${partyBlock(d,'Supplier (Bill from)')}</td><td colspan="2">${cell('Terms of Delivery',d.delivery)}</td></tr>`
    :`<tr><td rowspan="3" class="half">${companyBlock()}</td><td>${cell('Voucher No.',d.no)}</td><td>${cell('Dated',dstr(fromIso(d.date)))}</td></tr>
      <tr><td>${cell("Buyer's Order No.",d.ref)}</td><td>${cell('Mode/Terms of Payment',d.payment)}</td></tr>
      <tr><td>${cell('Dispatched through',d.dispatch)}</td><td>${cell('Destination',d.destination)}</td></tr>
      <tr><td class="half">${partyBlock(d,'Buyer (Bill to)')}</td><td colspan="2">${cell('Terms of Delivery',d.delivery)}</td></tr>`;
  const cols=isPO?['Sl<br>No.','Description of Goods','Due on','Quantity','Rate','per','Disc. %','Amount']:['Sl<br>No.','Description of Goods','HSN/SAC','Quantity','Rate','per','Disc. %','Amount'];
  const body=C.lines.map((l,i)=>`<tr><td class="c">${i+1}</td><td><b>${esc(l.item)}</b></td><td class="c">${isPO?esc(d.due?dstr(fromIso(d.due)):''):esc(l.hsn)}</td><td class="r"><b>${qtyTxt(l.qty)} ${esc(l.unit)}</b></td><td class="r">${inr(l.rate)}</td><td class="c">${esc(l.unit)}</td><td class="r">${l.disc?l.disc+' %':''}</td><td class="r"><b>${inr(l.amount)}</b></td></tr>`).join('');
  const taxRows=C.rates.map(g=>C.inter?`<tr><td></td><td class="r"><b><i>IGST @ ${g.rate}%</i></b></td><td></td><td></td><td class="r">${g.rate} %</td><td></td><td></td><td class="r"><b>${inr(g.igst)}</b></td></tr>`
    :`<tr><td></td><td class="r"><b><i>CGST @ ${g.rate/2}%</i></b></td><td></td><td></td><td class="r">${g.rate/2} %</td><td></td><td></td><td class="r"><b>${inr(g.cgst)}</b></td></tr><tr><td></td><td class="r"><b><i>SGST @ ${g.rate/2}%</i></b></td><td></td><td></td><td class="r">${g.rate/2} %</td><td></td><td></td><td class="r"><b>${inr(g.sgst)}</b></td></tr>`).join('')
    +(C.roundOff?`<tr><td></td><td class="r"><i>Less : Round Off</i></td><td></td><td></td><td></td><td></td><td></td><td class="r">${C.roundOff<0?'(-)':''}${inr(Math.abs(C.roundOff))}</td></tr>`:'');
  const filler=`<tr class="fill"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
  const units=[...new Set(C.lines.map(l=>l.unit).filter(Boolean))];
  const items=`<table class="ti"><thead><tr>${cols.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${body}${taxRows}${filler}</tbody>
    <tfoot><tr><td></td><td class="r">Total</td><td></td><td class="r"><b>${units.length===1?qtyTxt(C.qty)+' '+esc(units[0]):''}</b></td><td></td><td></td><td></td><td class="r"><b>₹ ${inr(C.total)}</b></td></tr></tfoot></table>`;
  const words=`<table class="tw2"><tr><td><span class="lbl">Amount Chargeable (in words)</span><span class="eoe">E. &amp; O.E</span><br><b>${esc(inWords(C.total))}</b></td></tr></table>`;
  const hsn=isPO||!C.tax?'':`<table class="th"><thead>${C.inter
      ?`<tr><th rowspan="2">HSN/SAC</th><th rowspan="2">Taxable<br>Value</th><th colspan="2">Integrated Tax</th><th rowspan="2">Total<br>Tax Amount</th></tr><tr><th>Rate</th><th>Amount</th></tr>`
      :`<tr><th rowspan="2">HSN/SAC</th><th rowspan="2">Taxable<br>Value</th><th colspan="2">Central Tax</th><th colspan="2">State Tax</th><th rowspan="2">Total<br>Tax Amount</th></tr><tr><th>Rate</th><th>Amount</th><th>Rate</th><th>Amount</th></tr>`}</thead>
    <tbody>${C.summary.map(h=>C.inter?`<tr><td>${esc(h.hsn)}</td><td class="r">${inr(h.taxable)}</td><td class="r">${h.rate}%</td><td class="r">${inr(h.igst)}</td><td class="r">${inr(h.tax)}</td></tr>`
      :`<tr><td>${esc(h.hsn)}</td><td class="r">${inr(h.taxable)}</td><td class="r">${h.rate/2}%</td><td class="r">${inr(h.cgst)}</td><td class="r">${h.rate/2}%</td><td class="r">${inr(h.sgst)}</td><td class="r">${inr(h.tax)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td class="r"><b>Total</b></td><td class="r"><b>${inr(C.taxable)}</b></td>${C.inter?`<td></td><td class="r"><b>${inr(C.tax)}</b></td>`:`<td></td><td class="r"><b>${inr(C.summary.reduce((s,h)=>s+h.cgst,0))}</b></td><td></td><td class="r"><b>${inr(C.summary.reduce((s,h)=>s+h.sgst,0))}</b></td>`}<td class="r"><b>${inr(C.tax)}</b></td></tr></tfoot></table>
    <table class="tw2"><tr><td>Tax Amount (in words) : <b>${esc(inWords(C.tax))}</b></td></tr></table>`;
  const bank=c['Bank Name']||c['Account No']?`<span class="lbl">Company's Bank Details</span><br>Bank Name : <b>${esc(c['Bank Name']||'')}</b><br>A/c No. : <b>${esc(c['Account No']||'')}</b><br>Branch &amp; IFS Code : <b>${esc([c.Branch,c.IFSC].filter(Boolean).join(' & '))}</b>`:'';
  const decl=isPO?'':`<span class="lbl"><u>Declaration</u></span><br>${esc(c.Declaration||'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.')}`;
  const foot=`<table class="tf"><tr><td class="half">${c.PAN?`Company's PAN : <b>${esc(c.PAN)}</b><br><br>`:''}${d.narration?`<span class="lbl">Remarks:</span><br>${esc(d.narration)}<br><br>`:''}${decl}</td>
    <td class="half">${isPO?'':bank}<div class="sign"><b>for ${esc(c['Company Name']||'Green Raise Agro Pvt Ltd')}</b><br><br><br><br>Authorised Signatory</div></td></tr></table>`;
  return `<div class="tdoc"><div class="ttl">${K.title}</div><table class="thd">${head}</table>${items}${words}${hsn}${foot}<div class="cg">This is a Computer Generated Document</div></div>`;
}
function printDoc(d){
  let a=document.getElementById('printArea');if(!a){a=document.createElement('div');a.id='printArea';document.body.appendChild(a)}
  a.innerHTML=docPrintHTML(d);const old=document.title;document.title=`${DOCT[d.type].type} ${d.no}`.replace(/[\/\\]/g,'-');
  setTimeout(()=>{try{window.print()}catch(e){toast('Printing is not available here.')}document.title=old},50);
}
function viewDoc(kind,id){
  const d=docGroups(kind).find(x=>x.id===id);if(!d){toast('That document was not found. Refresh and try again.');return}
  openDlg(`${DOCT[kind].type} ${d.no}`,`<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn pri" type="button" data-dact="print" data-kind="${kind}" data-id="${esc(id)}">Print / Save as PDF</button><button class="btn" type="button" data-dact="edit" data-kind="${kind}" data-id="${esc(id)}">Edit</button></div>
    <div class="tprev">${docPrintHTML(d)}</div>`);
}

/* ---------- saving ---------- */
async function saveDoc(andPrint){
  if(S.docSaving)return;readDocForm();const D=S.docDraft,kind=D.type;
  const fail=m=>{S.docErr=m;rerenderDoc();const e=document.querySelector('#docForm .eerr');if(e)e.scrollIntoView({block:'center'})};
  if(!cleanName(D.no))return fail('Enter the voucher number.');
  if(isNaN(fromIso(D.date)))return fail('Enter the date.');
  if(!cleanName(D.party))return fail(`Enter the ${DOCT[kind].party.toLowerCase()}.`);
  const lines=D.lines.filter(l=>cleanName(l.item)||String(l.qty).trim()!=='');
  if(!lines.length)return fail('Add at least one item.');
  for(const l of lines){if(!cleanName(l.item))return fail('One line has a quantity but no item.');if(!(parseFloat(l.qty)>0))return fail(`Enter a quantity for ${cleanName(l.item)}.`)}
  const dup=docGroups(kind).find(x=>x.no.toUpperCase()===cleanName(D.no).toUpperCase()&&x.id!==D.replaces);if(dup)return fail(`Voucher no. ${D.no} is already used. Change the number.`);
  if(D.by)store.set('by',cleanName(D.by));
  const C=calcDoc(Object.assign({},D,{lines}));
  const doc={type:DOCT[kind].type,no:cleanName(D.no),date:D.date,due:D.due||'',party:cleanName(D.party),address:D.address,gstin:cleanName(D.gstin).toUpperCase(),state:cleanName(D.state),
    ref:D.ref,payment:D.payment,dispatch:D.dispatch,destination:D.destination,delivery:D.delivery,narration:D.narration,by:D.by,replaces:D.replaces||'',
    lines:C.lines.map(l=>({item:cleanName(l.item),hsn:cleanName(l.hsn),qty:l.qty,unit:cleanName(l.unit),rate:l.rate,disc:l.disc,gst:l.gst,amount:l.amount}))};
  S.docSaving=true;S.docErr='';rerenderDoc();
  try{
    const j=await api('POST',{action:'docSave',doc});S.docSaving=false;S.docDraft=null;toast(`${DOCT[kind].type} ${doc.no} saved`);
    await loadApp();
    if(andPrint){const d=docGroups(kind).find(x=>x.id===j.id);if(d)printDoc(d)}
  }catch(e){S.docSaving=false;fail('Not saved: '+e.message)}
}

/* ---------- company details (Settings) ---------- */
const CO_FIELDS=['Company Name','Address','City','State','State Code','GSTIN','PAN','Phone','Email','Bank Name','Account No','IFSC','Branch','Declaration'];
function companyPanel(){
  if(S.source!=='hosted'||S.company===null)return '';
  const c=S.company||{};
  return `<form class="panel" id="coForm" novalidate><div class="panel-h"><h2>Company details</h2><p>Printed on proforma invoices and purchase orders. Saved in the Google Sheet tab "Company".</p></div>
    <div class="egrid">${CO_FIELDS.map(k=>/^(address|declaration)$/i.test(k)?'':`<label>${k}<input type="text" data-co="${esc(k)}" value="${esc(c[k]||'')}" autocomplete="off"></label>`).join('')}</div>
    <label class="full">Address<textarea data-co="Address" rows="2">${esc(c.Address||'')}</textarea></label>
    <label class="full">Declaration (printed on the proforma invoice)<textarea data-co="Declaration" rows="2" placeholder="We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.">${esc(c.Declaration||'')}</textarea></label>
    <div style="margin-top:12px"><button class="btn pri" type="submit" id="coSave">Save company details</button></div></form>`;
}
async function saveCompany(){
  const o={};document.querySelectorAll('#coForm [data-co]').forEach(e=>{o[e.dataset.co]=e.value.trim()});
  if(o.GSTIN&&!stateCode(o.GSTIN))return toast('The GSTIN should be 15 characters, starting with the 2-digit state code.');
  if(o.GSTIN&&!o['State Code'])o['State Code']=stateCode(o.GSTIN);
  const b=$('#coSave');b.disabled=true;b.textContent='Saving…';
  try{await api('POST',{action:'companySave',company:o});toast('Company details saved');await loadApp()}catch(e){b.disabled=false;b.textContent='Save company details';toast('Not saved: '+e.message)}
}

/* ---------- events ---------- */
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-dact]');if(!t)return;
  const a=t.dataset.dact,kind=t.dataset.kind||(S.docDraft&&S.docDraft.type),id=t.dataset.id;
  if(a==='new'){S.docDraft=newDoc(kind);S.docErr='';rerenderDoc();window.scrollTo({top:0});return}
  if(a==='cancel'){S.docDraft=null;S.docErr='';rerenderDoc();return}
  if(a==='addline'){readDocForm();S.docDraft.lines.push({item:'',hsn:'',qty:'',unit:'',rate:'',disc:'',gst:''});rerenderDoc();const ins=document.querySelectorAll('#dLines .dItem');if(ins.length)ins[ins.length-1].focus();return}
  if(a==='rmline'){readDocForm();S.docDraft.lines.splice(+t.dataset.i,1);if(!S.docDraft.lines.length)S.docDraft.lines.push({item:'',hsn:'',qty:'',unit:'',rate:'',disc:'',gst:''});rerenderDoc();return}
  if(a==='saveprint'){saveDoc(true);return}
  if(a==='view'){viewDoc(kind,id);return}
  if(a==='print'){const d=docGroups(kind).find(x=>x.id===id);if(d)printDoc(d);return}
  if(a==='edit'){const d=docGroups(kind).find(x=>x.id===id);if(!d)return;closeDlg();
    S.docDraft=Object.assign({},d,{replaces:d.id,lines:d.lines.map(l=>({item:l.item,hsn:l.hsn,qty:String(l.qty),unit:l.unit,rate:String(l.rate),disc:l.disc?String(l.disc):'',gst:l.gst?String(l.gst):''}))});
    delete S.docDraft.calc;S.docErr='';S.tab=kind;render();window.scrollTo({top:0});return}
  if(a==='del'){if(S.docDel!==id){S.docDel=id;rerenderDoc();return}
    try{await api('POST',{action:'docDelete',id});S.docDel=null;toast('Deleted');await loadApp()}catch(err){S.docDel=null;toast('Not deleted: '+err.message);rerenderDoc()}return}
});
document.addEventListener('submit',e=>{
  if(e.target.id==='docForm'){e.preventDefault();saveDoc(false)}
  else if(e.target.id==='coForm'){e.preventDefault();saveCompany()}
});
document.addEventListener('input',e=>{if(e.target.closest&&e.target.closest('#docForm')){readDocForm();refreshDoc()}});
document.addEventListener('change',e=>{
  const el=e.target;if(!el.closest||!el.closest('#docForm'))return;readDocForm();const D=S.docDraft;
  if(el.id==='dParty'){const p=partyInfo(D.type,D.party);if(p){D.address=p.address||D.address;D.gstin=p.gstin||D.gstin;D.state=p.state||D.state}rerenderDoc();return}
  if(el.id==='dDate'&&!D.replaces){D.no=nextNo(D.type,D.date);rerenderDoc();return}
  if(el.classList.contains('dItem')){const i=+el.closest('.dline').dataset.i,l=D.lines[i],it=itemInfo(l.item);
    if(it){if(!l.hsn)l.hsn=it.hsn||'';if(!l.unit)l.unit=it.unit||'';if(l.rate===''&&it.rate!=null)l.rate=String(it.rate);if(l.gst===''&&it.gst!=null)l.gst=String(it.gst)}
    rerenderDoc();return}
});

/* ---------- styles: form and Tally print layout ---------- */
(function(){const st=document.createElement('style');st.textContent=`
#docForm label,#coForm label{display:grid;gap:4px;font-size:13px;color:var(--fg-2)}
#docForm input,#docForm textarea,#coForm input,#coForm textarea{border:1px solid var(--line-2);background:var(--surface);color:var(--fg);border-radius:var(--r);padding:7px 9px;font:inherit;min-width:0;width:100%}
#docForm .full,#coForm .full{margin-top:10px}
.dtable td{padding:4px}.dtable td input{padding:5px 6px!important}
.dtable td:nth-child(1){min-width:200px}.dtable td:nth-child(2){width:90px}.dtable td:nth-child(3),.dtable td:nth-child(5){width:100px}.dtable td:nth-child(4){width:64px}.dtable td:nth-child(6),.dtable td:nth-child(7){width:70px}
.dtotals{margin:12px 0 0 auto;max-width:360px;display:grid;gap:4px}
.drow{display:flex;justify-content:space-between;gap:12px;font-size:13.5px}.drow.b{font-weight:600;font-size:15px;border-top:1px solid var(--line-2);padding-top:6px}
.tprev{margin-top:12px;background:#fff;padding:12px;border:1px solid var(--line);overflow-x:auto}
.tdoc{font:11px/1.35 Arial,Helvetica,sans-serif;color:#000;background:#fff;width:190mm;max-width:100%;margin:0 auto}
.tdoc .ttl{text-align:center;font-weight:bold;font-size:15px;letter-spacing:.04em;margin-bottom:4px}
.tdoc table{width:100%;border-collapse:collapse;color:#000}
.tdoc td,.tdoc th{border:1px solid #000;padding:3px 5px;vertical-align:top;white-space:normal;position:static;background:#fff;color:#000;font-size:11px}
.tdoc th{font-weight:normal;text-align:center}
.tdoc .half{width:50%}.tdoc .big{font-size:12.5px}.tdoc .lbl{font-size:10px}
.tdoc .thd,.tdoc .ti,.tdoc .tw2,.tdoc .th,.tdoc .tf{margin-top:-1px}
.tdoc .ti td{border-top:0;border-bottom:0}.tdoc .ti tfoot td{border-top:1px solid #000;border-bottom:1px solid #000}
.tdoc .ti tr.fill td{height:60px}
.tdoc .r{text-align:right}.tdoc .c{text-align:center}
.tdoc .ti th:nth-child(1){width:6%}.tdoc .ti th:nth-child(2){width:38%}.tdoc .ti th:nth-child(3){width:10%}.tdoc .ti th:nth-child(4){width:11%}.tdoc .ti th:nth-child(5){width:10%}.tdoc .ti th:nth-child(6){width:6%}.tdoc .ti th:nth-child(7){width:7%}
.tdoc .eoe{float:right;font-style:italic;font-size:10px}
.tdoc .sign{text-align:right;margin-top:8px}
.tdoc .cg{text-align:center;font-size:10px;margin-top:4px}
#printArea{display:none}
@media print{
  @page{size:A4;margin:10mm}
  body{background:#fff!important}
  body::before,.shell,dialog,.toast,#sampleBar,.scrim{display:none!important}
  #printArea{display:block}
  .tdoc{width:auto}
}`;document.head.appendChild(st)})();
