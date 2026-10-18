(function(root){
  "use strict";
  const dimensions=[{id:"growth",name:"增长动能",weight:20,color:"#337bb7"},{id:"profit",name:"盈利质量",weight:20,color:"#167b73"},{id:"cash",name:"现金创造",weight:25,color:"#559684"},{id:"investment",name:"投入纪律",weight:15,color:"#a77d36"},{id:"resilience",name:"财务韧性",weight:10,color:"#7583a9"},{id:"returns",name:"股东回报",weight:10,color:"#b96872"}];
  const rules=[
    {id:"revenueYoY",dim:"growth",name:"收入同比",weight:12,unit:"%",stops:[[-10,0],[0,30],[10,65],[20,90],[30,100]],formula:"相邻完整财年收入同比；-10/0/10/20/30%对应0/30/65/90/100分"},
    {id:"revenueCagr",dim:"growth",name:"两年收入CAGR",weight:8,unit:"%",stops:[[-5,0],[0,30],[10,70],[20,100]],formula:"两年收入复合增速；-5/0/10/20%对应0/30/70/100分"},
    {id:"roic",dim:"profit",name:"年度ROIC",weight:12,unit:"%",stops:[[0,0],[5,30],[10,60],[20,90],[30,100]],formula:"供应商ROIC；0/5/10/20/30%对应0/30/60/90/100分，不混合不同供应商公式"},
    {id:"opMarginDelta",dim:"profit",name:"经营利润率变化",weight:8,unit:"pct",stops:[[-5,0],[-2,25],[0,60],[2,85],[5,100]],formula:"本财年经营利润率减上财年；-5/-2/0/2/5pct对应0/25/60/85/100分"},
    {id:"cashConversion",dim:"cash",name:"CFO / 归母利润",weight:10,unit:"倍",stops:[[0,0],[0.5,25],[1,70],[1.5,100]],formula:"正归母利润时CFO/利润；亏损且CFO≤0记0分，亏损但CFO>0记40分"},
    {id:"fcfMargin",dim:"cash",name:"统一代理FCF率",weight:10,unit:"%",stops:[[-5,0],[0,25],[5,50],[15,85],[25,100]],formula:"(CFO-现金购建资产)/收入；-5/0/5/15/25%对应0/25/50/85/100分"},
    {id:"positiveFcfYears",dim:"cash",name:"近三年FCF为正次数",weight:5,unit:"年",stops:[[0,0],[1,30],[2,65],[3,100]],formula:"连续三个完整财年的FCF代理值；0/1/2/3年对应0/30/65/100分"},
    {id:"capexCfo",dim:"investment",name:"现金CapEx / CFO",weight:10,unit:"%",stops:[[0,100],[25,85],[50,60],[100,20],[150,0]],formula:"0/25/50/100/150%对应100/85/60/20/0分；CFO≤0时记0分。AI投入仅反映短期现金压力"},
    {id:"sbcRatio",dim:"investment",name:"SBC / 收入",weight:5,unit:"%",stops:[[0,100],[2,90],[5,65],[10,25],[15,0]],formula:"0/2/5/10/15%对应100/90/65/25/0分；未披露记缺项"},
    {id:"currentRatio",dim:"resilience",name:"流动比率",weight:5,unit:"倍",stops:[[0.5,0],[1,50],[1.5,80],[2,100]],formula:"流动资产/流动负债；0.5/1/1.5/2倍对应0/50/80/100分"},
    {id:"liabilities",dim:"resilience",name:"资产负债率",weight:5,unit:"%",stops:[[20,100],[40,80],[60,50],[80,10],[100,0]],formula:"20/40/60/80/100%对应100/80/50/10/0分；经营性应付也计入，结合模式判断"},
    {id:"returnCoverage",dim:"returns",name:"现金分配 / CFO",weight:6,unit:"%",stops:[[0,0],[10,30],[30,70],[60,100],[100,70],[150,0]],formula:"合并报表分红+回购/CFO；需两项均单列，CFO≤0且现金分配>0记0；超过CFO后惩罚不可持续分配"},
    {id:"dilution",dim:"returns",name:"摊薄股数同比",weight:4,unit:"%",stops:[[-5,100],[-2,90],[0,70],[2,40],[5,0]],formula:"同口径摊薄加权平均股数同比；-5/-2/0/2/5%对应100/90/70/40/0分；不得用回购金额代替"}
  ];
  const finite=v=>typeof v==="number"&&Number.isFinite(v);
  function interpolate(v,stops){if(!finite(v))return null;if(v<=stops[0][0])return stops[0][1];for(let i=1;i<stops.length;i++){const [x,y]=stops[i], [a,b]=stops[i-1];if(v<=x)return b+(y-b)*(v-a)/(x-a);}return stops.at(-1)[1];}
  function values(period){const v={...(period?.values||{})};if(finite(v.cfo)&&finite(v.profit)){v.cashConversion=v.profit>0?v.cfo/v.profit:null;v.lossCashScore=v.profit<=0?(v.cfo>0?40:0):null;}if(finite(v.capex)&&finite(v.cfo))v.capexCfo=v.cfo>0?v.capex/v.cfo*100:Infinity;if(finite(v.sbc)&&v.revenue>0)v.sbcRatio=v.sbc/v.revenue*100;if(finite(v.dividends)&&finite(v.buybacks)&&finite(v.cfo))v.returnCoverage=v.cfo>0?(v.dividends+v.buybacks)/v.cfo*100:Infinity;return v;}
  function score(period,weights){const v=values(period), dims=dimensions.map(d=>({...d,weight:weights?.[d.id]??d.weight}));let earned=0,available=0;const items=rules.map(rule=>{const dim=dims.find(d=>d.id===rule.dim);const original=dimensions.find(d=>d.id===rule.dim);const weight=rule.weight*dim.weight/original.weight;let result=interpolate(v[rule.id],rule.stops);if(rule.id==="cashConversion"&&v.lossCashScore!=null)result=v.lossCashScore;if((rule.id==="capexCfo"||rule.id==="returnCoverage")&&v[rule.id]===Infinity)result=0;const contribution=result===null?null:result/100*weight;if(result!==null){available+=weight;earned+=contribution;}return {...rule,value:v[rule.id],score:result,contribution,weight};});const maximum=dims.reduce((s,d)=>s+d.weight,0);const coverage=maximum>0?available/maximum*100:0;return {items,earned,available,coverage,total:coverage>=80&&available>0?earned/available*100:null,dimensions:dims.map(d=>{const rows=items.filter(r=>r.dim===d.id);const av=rows.filter(r=>r.score!==null).reduce((s,r)=>s+r.weight,0);const e=rows.reduce((s,r)=>s+(r.contribution||0),0);return {...d,earned:e,available:av,score:av?e/av*100:null};})};}
  function period(company,year="latest"){return year==="latest"?company.annuals.at(-1):company.annuals.find(p=>p.label===year)||null;}
  const api={dimensions,rules,score,values,period,finite,interpolate};root.InternetModel=api;if(typeof module!=="undefined")module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
