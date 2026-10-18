const fs=require('fs');
const path=require('path');
const root=__dirname;
function number(s){
 s=String(s||'').trim().replace(/,/g,'');
 if(!s||s==='--') return null;
 const m=s.match(/^(-?\d+(?:\.\d+)?)(万亿|亿|万)?$/);
 return m?Number(m[1])*({'万亿':1e12,'亿':1e8,'万':1e4}[m[2]]||1):Number.isFinite(Number(s))?Number(s):null;
}
function table(answer){
 const lines=String(answer||'').split('\n').filter(s=>s.trim().startsWith('|'));
 if(lines.length<3) return [];
 const cells=s=>s.split('|').slice(1,-1).map(x=>x.trim());
 const header=cells(lines[0]);
 return lines.slice(2).map(s=>Object.fromEntries(cells(s).map((v,i)=>[header[i],v])));
}
const metrics={rev:'营业收入',profit:'归属于母公司股东的净利润',roe:'净资产收益率ROE',cfo:'经营活动产生的现金流量净额',capex:'资本支出',roic:'投入资本回报率ROIC',liabilities:'资产负债率',debt:'带息债务',cash:'现金及现金等价物',gross:'销售毛利率'};
const data={};
const errors=[];
for(const filename of fs.readdirSync(path.join(root,'raw')).filter(s=>/^(financial|balance|update|extra)-.*\.json$/.test(s))){
 const j=JSON.parse(fs.readFileSync(path.join(root,'raw',filename),'utf8'));
 if(!j.response?.data?.answer){errors.push([filename,j.response]);continue;}
 for(const row of table(j.response.data.answer)){
   const code=String(row['证券代码']||'').match(/^(\d+)\.HK$/);
   if(!code) continue;
   const id=code[1].padStart(4,'0');
   const date=row['日期'];
   data[id]||={name:row['证券简称'],periods:{}};
   data[id].periods[date]||={};
   const record=data[id].periods[date];
   for(const [key,indicator] of Object.entries(metrics)){
     const source=Object.keys(row).find(x=>x.startsWith(indicator)||(key==='capex'&&x.startsWith('资本性支出')));
     if(source){record[key]=number(row[source]);record[key+'_source']=filename;}
   }
 }
}
function median(values){values=values.filter(x=>x!=null).sort((a,b)=>a-b);return !values.length?null:values.length%2?values[(values.length-1)/2]:(values[values.length/2-1]+values[values.length/2])/2;}
const annuals=['20231231','20241231','20251231'];
for(const [code,company] of Object.entries(data)){
 const records=annuals.map(d=>company.periods[d]||{});
 const ratio=(a,b)=>a!=null&&b>0?a/b:null;
 const cagr=key=>records[0][key]>0&&records[2][key]>0?Math.sqrt(records[2][key]/records[0][key])-1:null;
 company.summary={years:records.filter(x=>x.rev>0&&x.profit!=null).length,profitable:records.every(x=>x.profit>0),roe:median(records.map(x=>x.roe)),roic:median(records.map(x=>x.roic)),cfo_ratio:median(records.map(x=>ratio(x.cfo,x.profit))),fcf_ratio:median(records.map(x=>x.cfo!=null&&x.capex!=null?ratio(x.cfo-x.capex,x.profit):null)),positive_fcf_years:records.filter(x=>x.cfo!=null&&x.capex!=null&&x.cfo>x.capex).length,rev_cagr:cagr('rev'),profit_cagr:cagr('profit'),liabilities:median(records.map(x=>x.liabilities)),net_debt_cfo:median(records.map(x=>x.debt!=null&&x.cash!=null?ratio(x.debt-x.cash,x.cfo):null)),profit_shock:records.slice(1).some((x,i)=>records[i].profit>0&&Math.abs(x.profit/records[i].profit-1)>.5)};
}
fs.writeFileSync(path.join(root,'parsed.json'),JSON.stringify({generated_at:new Date().toISOString(),errors,data},null,2));
const fmt=(x,d=2)=>x==null?'NA':x.toFixed(d);
console.log('Parsed',Object.keys(data).length,'Errors',errors.length);
for(const [code,c] of Object.entries(data)){
 const s=c.summary;
 console.log([code,c.name,s.years,s.profitable?'P':'LOSS',fmt(s.roe),fmt(s.roic),fmt(s.cfo_ratio),fmt(s.fcf_ratio),s.positive_fcf_years,fmt(s.rev_cagr*100),fmt(s.profit_cagr*100),fmt(s.liabilities),s.profit_shock?'SHOCK':''].join('\t'));
}
