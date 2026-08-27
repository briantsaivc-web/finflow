const { chromium } = require('playwright');
(async ()=>{
  const browser=await chromium.launch();
  const page=await browser.newPage();
  for(const [src,out] of [['quickstart.html','FinFlow_快速上手指南.pdf'],['rulebook.html','FinFlow_完整規則手冊.pdf']]){
    await page.goto('file://'+process.cwd()+'/'+src);
    await page.waitForTimeout(300);
    await page.pdf({path:out, format:'A4', printBackground:true,
      displayHeaderFooter:true,
      headerTemplate:'<span></span>',
      footerTemplate:'<div style="width:100%;text-align:center;font-size:8px;color:#9aa3ae;font-family:sans-serif">FinFlow 財商沙盒 — <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin:{top:'14mm',bottom:'16mm',left:'0',right:'0'}});
    console.log(out,'done');
  }
  await browser.close();
})();
