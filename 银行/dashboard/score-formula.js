(function () {
  "use strict";

  const LABELS = ["收入效率", "收入增长", "盈利质量", "资产质量", "成本控制", "资本内生"];
  const WEIGHTS = [15, 10, 30, 15, 15, 15];
  const CMB = [14.6 / 15, 3.97 / 10, 22.83 / 30, 10.67 / 15, 12.11 / 15, 14.46 / 15].map((x) => +(x * 100).toFixed(1));
  const CD = [6.92 / 15, 7.0 / 10, 18.61 / 30, 12.4 / 15, 11.32 / 15, 6.75 / 15].map((x) => +(x * 100).toFixed(1));

  const radarOpts = (max, step) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } },
    scales: {
      r: {
        min: 0,
        max,
        ticks: { stepSize: step, font: { size: 9 }, backdropColor: "transparent" },
        pointLabels: { font: { size: 12 } },
        grid: { color: "rgba(0,0,0,0.08)" },
      },
    },
  });

  function drawWeights() {
    const el = document.getElementById("chart-weights");
    if (!el || typeof Chart === "undefined") return;
    new Chart(el.getContext("2d"), {
      type: "radar",
      data: {
        labels: LABELS,
        datasets: [{
          label: "维度满分",
          data: WEIGHTS,
          borderColor: "#2f6fed",
          backgroundColor: "rgba(47, 111, 237, 0.15)",
          pointBackgroundColor: "#2f6fed",
        }],
      },
      options: radarOpts(30, 10),
    });
  }

  function drawExample() {
    const el = document.getElementById("chart-example");
    if (!el || typeof Chart === "undefined") return;
    new Chart(el.getContext("2d"), {
      type: "radar",
      data: {
        labels: LABELS,
        datasets: [
          {
            label: "招商银行 2025A",
            data: CMB,
            borderColor: "#2f6fed",
            backgroundColor: "rgba(47, 111, 237, 0.15)",
            pointBackgroundColor: "#2f6fed",
          },
          {
            label: "成都银行 2025A",
            data: CD,
            borderColor: "#d1453b",
            backgroundColor: "rgba(209, 69, 59, 0.08)",
            pointBackgroundColor: "#d1453b",
          },
        ],
      },
      options: radarOpts(100, 20),
    });
  }

  function bindNav() {
    const links = Array.from(document.querySelectorAll(".group-nav-item"));
    const sections = links
      .map((a) => document.querySelector(a.getAttribute("href")))
      .filter(Boolean);
    const setActive = () => {
      const y = window.scrollY + 80;
      let current = sections[0];
      sections.forEach((s) => {
        if (s.offsetTop <= y) current = s;
      });
      links.forEach((a) => {
        a.classList.toggle("active", a.getAttribute("href") === "#" + current.id);
      });
    };
    window.addEventListener("scroll", setActive, { passive: true });
    setActive();
  }

  drawWeights();
  drawExample();
  bindNav();
  bindHelp();

  function bindHelp() {
    const pop = document.getElementById("col-help-pop");
    if (!pop) return;
    const hide = () => {
      pop.classList.add("hidden");
      document.querySelectorAll(".col-help-btn[aria-expanded='true']").forEach((b) => {
        b.setAttribute("aria-expanded", "false");
      });
    };
    const show = (btn) => {
      pop.querySelector(".col-help-title").textContent = btn.getAttribute("data-help-title") || "";
      pop.querySelector(".col-help-body").textContent = btn.getAttribute("data-help-body") || "";
      pop.classList.remove("hidden");
      document.querySelectorAll(".col-help-btn[aria-expanded='true']").forEach((b) => {
        b.setAttribute("aria-expanded", "false");
      });
      btn.setAttribute("aria-expanded", "true");
      const r = btn.getBoundingClientRect();
      const pw = Math.min(300, window.innerWidth - 16);
      pop.style.width = pw + "px";
      let left = r.left + r.width / 2 - pw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
      pop.style.left = left + "px";
      pop.style.top = r.bottom + 8 + "px";
      const ph = pop.offsetHeight;
      if (r.bottom + 8 + ph > window.innerHeight - 8) {
        pop.style.top = Math.max(8, r.top - ph - 8) + "px";
      }
    };
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".col-help-btn");
      if (btn) {
        e.preventDefault();
        const open = btn.getAttribute("aria-expanded") === "true";
        hide();
        if (!open) show(btn);
        return;
      }
      if (!e.target.closest(".col-help-pop")) hide();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hide();
    });
    window.addEventListener("resize", hide);
    document.addEventListener("scroll", hide, true);
  }
})();
