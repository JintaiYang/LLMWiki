(function () {
  "use strict";
  const pages = [
    ["industry.html", "行业总览"],
    ["index.html", "公司对比"],
    ["stock.html", "个股深度"],
    ["score-formula.html", "评分方法"],
    ["knowledge.html", "财务知识库"],
  ];
  const page = location.pathname.split("/").pop() || "index.html";
  const nav = document.createElement("nav");
  nav.className = "research-nav";
  nav.setAttribute("aria-label", "研究页面导航");
  const links = pages.map(([href, label]) => {
    const current = href === page || (page === "" && href === "index.html");
    return `<a href="${href}"${current ? ' class="active" aria-current="page"' : ""}>${label}</a>`;
  }).join("");
  nav.innerHTML = `<div class="research-nav-inner"><a class="research-brand" href="industry.html"><img src="favicon.svg" width="26" height="26" alt="">白酒研究台</a><div class="research-links">${links}</div><span class="nav-version"><span id="nav-model-version"></span><span>成熟行业研究</span></span></div>`;
  document.body.prepend(nav);
  window.LiquorNavigation = {
    update({ code, version }) {
      nav.querySelector("#nav-model-version").textContent = version;
      nav.querySelectorAll(".research-links a").forEach((link, index) => {
        if (["stock.html", "score-formula.html", "knowledge.html"].includes(pages[index][0])) link.href = pages[index][0] + "?" + new URLSearchParams({ code });
      });
    },
  };
})();
