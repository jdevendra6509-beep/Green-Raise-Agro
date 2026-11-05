/* Reads Tally Payment / Receipt Register exports and the Item Master.
   Shared by the dashboard page (browser) and build/build.mjs (Node, at deploy time). */
"use strict";
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const cleanName=s=>String(s??'').replace(/\s+/g,' ').trim();
function cleanParty(s){
  let p=cleanName(s).toUpperCase();
  for(let i=0;i<3;i++) p=p.replace(/[\s\-\/#.,]*\d+\s*$/,'').trim();
  p=p.replace(/^[\-\/\s]+|[\-\/\s]+$/g,'');
  return p||'(NO NAME)';
}
function toNum(v){if(typeof v==='number')return v;if(typeof v==='string'){const t=v.replace(/,/g,'').trim();if(t!==''&&!isNaN(+t))return +t}return null}
function toDay(v){
  if(typeof v==='number'&&v>20000&&v<80000) return Math.round(v)-25569;
  if(v instanceof Date) return Math.floor(Date.UTC(v.getFullYear(),v.getMonth(),v.getDate())/864e5);
  if(typeof v==='string'){
    const s=v.trim();let m=s.match(/^(\d{1,2})[-\/. ]([A-Za-z]{3})[A-Za-z]*[-\/. ](\d{2,4})$/);
    if(m){const mi=MON.findIndex(x=>x.toLowerCase()===m[2].toLowerCase());let y=+m[3];if(y<100)y+=2000;if(mi>=0)return Math.floor(Date.UTC(y,mi,+m[1])/864e5)}
    m=s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
    if(m){let y=+m[3];if(y<100)y+=2000;return Math.floor(Date.UTC(y,+m[2]-1,+m[1])/864e5)}
    m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return Math.floor(Date.UTC(+m[1],+m[2]-1,+m[3])/864e5);
  }
  return null;
}
function parseWorkbook(wb,fileName){
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null,blankrows:false});
  const head=rows.slice(0,6).map(r=>(r||[]).filter(c=>c!=null).join(' ')).join(' | ');
  let kind=/payment register/i.test(head)?'Payment':/receipt register/i.test(head)?'Receipt':/journal register/i.test(head)?'Journal':null;
  if(!kind){
    const hi=rows.findIndex((r,i)=>i<15&&r&&r.some(c=>typeof c==='string'&&/^\s*item(\s*name)?\s*$/i.test(c)));
    if(/trial balance/i.test(head)) return parseOpening(rows,fileName);
    if(hi>=0) return parseMaster(rows,hi,fileName);
    let p=0,rc=0;rows.slice(0,400).forEach(r=>r&&r.forEach(c=>{if(c==='Payment')p++;else if(c==='Receipt')rc++}));
    kind=p>rc?'Payment':rc>0?'Receipt':null;
  }
  if(!kind) throw new Error(`"${fileName}" is not a Tally Payment Register, Receipt Register or Item Master.`);
  const company=cleanName(rows[0]&&rows[0][0]);
  const periodText=(rows.slice(0,6).map(r=>r&&r[0]).find(v=>typeof v==='string'&&/\bto\b/i.test(v)&&/\d/.test(v))||'').trim();
  let pFrom=null,pTo=null;const pm=periodText.match(/^(.+?)\s+to\s+(.+)$/i);if(pm){pFrom=toDay(pm[1]);pTo=toDay(pm[2])}
  let start=rows.findIndex(r=>r&&String(r[0]??'').trim()==='Date');start=start<0?0:start+1;
  const V=[];let cur=null;const stockDr=kind==='Payment';
  // Journal: stock adjustments against Bad Debts; every ledger line is kept with a sign (credit = stock in, debit = stock out)
  const add=(name,dr,cr)=>{name=cleanName(name);if(!name||!cur)return;
    if(kind==='Journal'){const q=(cr||0)-(dr||0);if(q)cur.items.push([name,q]);return}const s=stockDr?dr:cr,o=stockDr?cr:dr;
    if(s!=null&&s!==0)cur.items.push([name,s]);else if(o!=null)cur.contra.push(name)};
  for(let i=start;i<rows.length;i++){
    const r=rows[i];if(!r)continue;const a=r[0];
    const d=(typeof a==='number'||a instanceof Date||(typeof a==='string'&&/^\d{1,2}[-\/. ]/.test(a.trim())))?toDay(a):null;
    if(d!=null&&typeof r[1]==='string'){
      let vi=-1;for(let j=2;j<Math.min(r.length,8);j++){if(typeof r[j]==='string'&&r[j].trim()===kind){vi=j;break}}
      if(vi<0)for(let j=2;j<Math.min(r.length,8);j++){if(typeof r[j]==='string'&&r[j].trim()!==''){vi=j;break}}
      if(vi<0)continue;
      cur={d,vno:cleanName(r[vi+1]),party:'',items:[],contra:[],cancel:/^\(cancelled\)$/i.test(r[1].trim())};
      V.push(cur);
      if(!cur.cancel)add(r[1],toNum(r[vi+2]),toNum(r[vi+3]));
    }else if(typeof a==='string'&&a.trim()!==''){
      if(/^total\s*:?\s*$/i.test(a.trim()))break;
      if(cur&&!cur.cancel)add(a,toNum(r[1]),toNum(r[2]));
    }else if((a==null||a==='')&&typeof r[1]==='string'&&r[1].trim()!==''&&cur){
      cur.party=cur.party?cur.party+' '+cleanName(r[1]):cleanName(r[1]);
    }
  }
  V.forEach(v=>{v.cond=kind!=='Journal'&&!v.cancel&&v.items.length>0&&v.contra.length===0});
  if(!V.length) throw new Error(`"${fileName}" looks like a ${kind} Register but no vouchers were found in it.`);
  return {kind,company,periodText,pFrom,pTo,fileName,loadedAt:Date.now(),vouchers:V};
}
function parseMaster(rows,hi,fileName){
  const h=rows[hi].map(c=>String(c??'').toLowerCase().trim());
  const col=(...p)=>h.findIndex(x=>x&&p.some(re=>re.test(x)));
  const ci={item:col(/^item/),cat:col(/categ|group/),unit:col(/^unit|uom/),open:col(/open/),phys:col(/physical|counted|actual/),cdate:col(/count.*date|as on|stock date/),
    min:col(/^min|moq|minimum/),max:col(/^max|maximum/),lead:col(/lead/),rate:col(/rate|price|cost/),excl:col(/exclude|ignore/),merge:col(/merge|alias|same as/)};
  const items={};let n=0;
  for(let i=hi+1;i<rows.length;i++){
    const r=rows[i];if(!r)continue;const name=cleanName(r[ci.item]);if(!name)continue;
    const g=k=>ci[k]>=0?r[ci[k]]:null;
    const o={name,cat:cleanName(g('cat')).toUpperCase()||null,unit:cleanName(g('unit'))||null,open:toNum(g('open')),phys:toNum(g('phys')),cdate:toDay(g('cdate')),
      min:toNum(g('min')),max:toNum(g('max')),lead:toNum(g('lead')),rate:toNum(g('rate')),exclude:/^(y|yes|1|true|x)$/i.test(String(g('excl')??'').trim()),merge:cleanName(g('merge'))||null};
    if(o.phys!=null&&o.cdate==null)o.phys=null;
    items[name]=o;n++;
  }
  return {kind:'Master',fileName,loadedAt:Date.now(),items,count:n};
}

/* Tally Trial Balance of the item ledgers = opening stock. Stock in posts as credit, so stock = credit - debit,
   taken from the last Debit/Credit pair (the closing balance column). */
const TB_SKIP=/^(cash|cash in hand|petty cash|.*\bbank\b.*|grand total|total|difference in opening balances?|opening stock|closing stock|profit & loss a\/c|capital.*)$/i;
function parseOpening(rows,fileName){
  const periodText=(rows.slice(0,8).map(r=>r&&r[0]).find(v=>typeof v==='string'&&/\bto\b/i.test(v)&&/\d/.test(v))||'').trim();
  const pm=periodText.match(/^(.+?)\s+to\s+(.+)$/i);const asOn=pm?toDay(pm[2]):null;
  const hi=rows.findIndex((r,i)=>i<15&&r&&r.some(c=>typeof c==='string'&&/^debit$/i.test(c.trim())));
  if(hi<0||asOn==null) throw new Error(`"${fileName}" looks like a Trial Balance but its date or Debit/Credit columns were not found.`);
  const h=rows[hi];let dc=-1,cc=-1;h.forEach((c,i)=>{if(typeof c==='string'){if(/^debit$/i.test(c.trim()))dc=i;if(/^credit$/i.test(c.trim()))cc=i}});
  const items={};let n=0;
  for(let i=hi+1;i<rows.length;i++){
    const r=rows[i];if(!r)continue;const name=cleanName(r[0]);if(!name||TB_SKIP.test(name))continue;
    const dr=toNum(r[dc])||0,cr=toNum(r[cc])||0;if(!dr&&!cr)continue;
    items[name]=(items[name]||0)+cr-dr;n++;
  }
  return {kind:'Opening',fileName,periodText,asOn,loadedAt:Date.now(),items,count:n};
}
/* compact pack for storage / snapshot */
function pack(f){if(!f||!f.vouchers)return f;const names=[],idx=new Map();const ix=n=>{let i=idx.get(n);if(i==null){i=names.length;names.push(n);idx.set(n,i)}return i};
  return {kind:f.kind,company:f.company,periodText:f.periodText,pFrom:f.pFrom,pTo:f.pTo,fileName:f.fileName,loadedAt:f.loadedAt,names,
    v:f.vouchers.map(v=>[v.d,v.vno,v.party,v.cancel?1:0,v.cond?1:0,v.items.map(([n,q])=>[ix(n),q]),v.contra.map(ix)])}}
function unpack(p){if(!p||!p.v)return p;const N=p.names;
  return {kind:p.kind,company:p.company,periodText:p.periodText,pFrom:p.pFrom,pTo:p.pTo,fileName:p.fileName,loadedAt:p.loadedAt,
    vouchers:p.v.map(a=>({d:a[0],vno:a[1],party:a[2],cancel:!!a[3],cond:!!a[4],items:a[5].map(([i,q])=>[N[i],q]),contra:a[6].map(i=>N[i])}))}}
if(typeof module!=="undefined")module.exports={parseWorkbook,parseMaster,parseOpening,pack,unpack,cleanName,toDay,MON};
