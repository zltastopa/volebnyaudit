/* Volebný audit – vanilla JS, no dependencies. Works from file:// (data come as <script> globals). */
(function () {
  "use strict";

  var collator = new Intl.Collator("sk", { numeric: true, sensitivity: "base" });

  function cellValue(td) {
    if (!td) return "";
    var v = td.getAttribute("data-v");
    return v !== null ? v : td.textContent.trim();
  }

  function compare(a, b) {
    var na = parseFloat(a), nb = parseFloat(b);
    var aNum = a !== "" && !isNaN(na) && isFinite(a), bNum = b !== "" && !isNaN(nb) && isFinite(b);
    if (aNum && bNum) return na - nb;
    if (aNum) return -1;
    if (bNum) return 1;
    if (a === "" && b !== "") return 1;
    if (b === "" && a !== "") return -1;
    return collator.compare(a, b);
  }

  /* ---------------------------------------------------------------- sortable static tables */
  function makeSortable(table) {
    var ths = table.tHead ? table.tHead.rows[0].cells : [];
    Array.prototype.forEach.call(ths, function (th, idx) {
      if (th.hasAttribute("data-nosort")) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sort";
      while (th.firstChild) btn.appendChild(th.firstChild);
      th.appendChild(btn);
      btn.addEventListener("click", function () {
        var dir = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
        Array.prototype.forEach.call(ths, function (o) { o.removeAttribute("aria-sort"); });
        th.setAttribute("aria-sort", dir);
        var body = table.tBodies[0];
        var rows = Array.prototype.slice.call(body.rows);
        rows.sort(function (r1, r2) {
          var c = compare(cellValue(r1.cells[idx]), cellValue(r2.cells[idx]));
          return dir === "ascending" ? c : -c;
        });
        rows.forEach(function (r) { body.appendChild(r); });
      });
    });
  }

  function makeFilterable(input) {
    var table = document.getElementById(input.getAttribute("data-filter-table"));
    var out = document.getElementById(input.getAttribute("data-filter-count"));
    if (!table) return;
    input.addEventListener("input", function () {
      var q = norm(input.value);
      var n = 0;
      Array.prototype.forEach.call(table.tBodies[0].rows, function (r) {
        var show = !q || norm(r.textContent).indexOf(q) !== -1;
        r.hidden = !show;
        if (show) n++;
      });
      if (out) out.textContent = n + " " + (n === 1 ? "riadok" : n >= 2 && n <= 4 ? "riadky" : "riadkov");
    });
  }

  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  /* ---------------------------------------------------------------- findings browser */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function findingsApp(root) {
    var data = window.VA_FINDINGS;
    if (!data) {
      root.innerHTML = '<p class="notice">Dáta nálezov sa nenačítali (chýba súbor data/findings.js).</p>';
      return;
    }
    var L = data.labels;
    var rows = data.rows;
    var base = root.getAttribute("data-root") || "";
    var form = root.querySelector("form.filters");
    var tbody = root.querySelector("tbody");
    var countEl = root.querySelector(".result-count");
    var moreBtn = root.querySelector("button.more");
    var PAGE = 250;
    var limit = PAGE;
    var sortKey = "r", sortDir = 1;

    var FILTERS = [
      ["y", "Rok"], ["kr", "Kraj"], ["ok", "Okres"], ["m", "Obec"], ["k", "Typ súboja"],
      ["d", "Detektor"], ["t", "Stupeň dôkazu"], ["oc", "Vplyv na výsledok"], ["v", "Kritická kontrola"]
    ];

    function optionLabel(key, val) {
      if (key === "t") return val + ": " + L.tier[val];
      if (key === "oc") return val + ": " + L.oc[val];
      if (key === "d") return L.detector[val] || val;
      return val;
    }

    function distinct(key, subset) {
      var seen = {};
      (subset || rows).forEach(function (r) { if (r[key] !== "" && r[key] != null) seen[r[key]] = (seen[r[key]] || 0) + 1; });
      return Object.keys(seen).sort(collator.compare).map(function (k) { return [k, seen[k]]; });
    }

    var selects = {};
    FILTERS.forEach(function (f) {
      var lab = document.createElement("label");
      lab.textContent = f[1];
      var sel = document.createElement("select");
      sel.name = f[0];
      lab.appendChild(sel);
      form.insertBefore(lab, form.querySelector(".wide"));
      selects[f[0]] = sel;
      sel.addEventListener("change", function () { limit = PAGE; refreshOptions(); update(true); });
    });
    var search = form.querySelector('input[type="search"]');
    search.addEventListener("input", function () { limit = PAGE; update(true); });
    form.addEventListener("submit", function (e) { e.preventDefault(); });
    form.querySelector("button.reset").addEventListener("click", function () {
      Object.keys(selects).forEach(function (k) { selects[k].value = ""; });
      search.value = "";
      limit = PAGE;
      refreshOptions();
      update(true);
    });

    function current() {
      var st = {};
      Object.keys(selects).forEach(function (k) { if (selects[k].value) st[k] = selects[k].value; });
      if (search.value.trim()) st.q = search.value.trim();
      return st;
    }

    function matches(r, st, skipKey) {
      for (var k in st) {
        if (k === "q" || k === skipKey) continue;
        if (String(r[k]) !== st[k]) return false;
      }
      if (st.q) {
        var hay = norm([r.m, r.ok, r.kr, r.cand, r.c, r.p, r.mech, r.id].join(" "));
        var words = norm(st.q).split(/\s+/);
        for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) === -1) return false;
      }
      return true;
    }

    // options reflect the other active filters (faceted), keeping the current choice visible
    function refreshOptions() {
      var st = current();
      Object.keys(selects).forEach(function (k) {
        var sel = selects[k];
        var keep = sel.value;
        var subset = rows.filter(function (r) { return matches(r, st, k); });
        var opts = distinct(k, subset);
        sel.innerHTML = "";
        var all = document.createElement("option");
        all.value = "";
        all.textContent = "všetky";
        sel.appendChild(all);
        var found = false;
        opts.forEach(function (o) {
          var op = document.createElement("option");
          op.value = o[0];
          op.textContent = optionLabel(k, o[0]) + " (" + o[1] + ")";
          if (o[0] === keep) found = true;
          sel.appendChild(op);
        });
        if (keep && !found) {
          var op = document.createElement("option");
          op.value = keep;
          op.textContent = optionLabel(k, keep) + " (0)";
          sel.appendChild(op);
        }
        sel.value = keep;
      });
    }

    function tierHtml(t) {
      return t ? '<span class="tier"><span class="stamp t-' + t + '" aria-hidden="true">' + t + "</span>" + esc(L.tier[t]) + "</span>" : "";
    }
    function ocHtml(o) {
      return o ? '<span class="oc o-' + o + '">' + esc(L.oc[o]) + "</span>" : "";
    }
    function candHtml(s) {
      s = s || "";
      if (s.length <= 90) return esc(s);
      var cut = s.lastIndexOf(";", 90);
      return '<span title="' + esc(s) + '">' + esc(s.slice(0, cut > 0 ? cut : 90)) + "; …</span>";
    }

    function render(list) {
      var html = [];
      list.slice(0, limit).forEach(function (r) {
        html.push(
          "<tr>" +
          '<td class="n">' + r.y + "</td>" +
          "<td>" + (r.mu ? '<a href="' + base + esc(r.mu) + '">' + esc(r.m) + "</a>" : esc(r.m)) + '<span class="sub">' + esc(r.ok) + "</span></td>" +
          "<td>" + esc(r.c) + (r.p ? '<span class="sub">' + esc(r.p) + "</span>" : "") + "</td>" +
          "<td>" + candHtml(r.cand) + "</td>" +
          "<td>" + esc(L.detector[r.d] || r.d) + '<span class="sub">' + esc(r.mech) + "</span></td>" +
          "<td>" + tierHtml(r.t) + "</td>" +
          "<td>" + ocHtml(r.oc) + "</td>" +
          '<td><span class="rv rv-' + esc(r.vc || "none") + '">' + esc(r.v) + "</span></td>" +
          '<td class="n">' + esc(r.qs) + "</td>" +
          '<td><a href="' + base + esc(r.u) + '">prípad ' + esc(r.r) + "</a></td>" +
          "</tr>"
        );
      });
      tbody.innerHTML = html.join("") || '<tr><td colspan="10">Žiadny nález nevyhovuje filtrom. Skúste zrušiť niektorý filter.</td></tr>';
      countEl.textContent = "Zobrazených " + fmtN(Math.min(limit, list.length)) + " z " + fmtN(list.length) +
        (list.length === 1 ? " nálezu" : " nálezov") + " (spolu " + fmtN(rows.length) + ")";
      moreBtn.hidden = list.length <= limit;
    }

    function fmtN(n) {  // Slovak thousands separator (non-breaking space), as in the static pages
      return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
    }

    function sortVal(r, key) {
      if (key === "q") return r.q == null ? Infinity : r.q;
      if (key === "t") return r.t || "Z";
      if (key === "oc") return { "1": 0, "2": 1, "3": 2, "0": 3 }[r.oc];
      return r[key];
    }

    function update(writeHash) {
      var st = current();
      var list = rows.filter(function (r) { return matches(r, st); });
      list.sort(function (a, b) {
        var c = compare(String(sortVal(a, sortKey)), String(sortVal(b, sortKey)));
        if (c === 0) c = (a.r || 0) - (b.r || 0);
        return c * sortDir;
      });
      render(list);
      if (writeHash) {
        var parts = Object.keys(st).map(function (k) { return k + "=" + encodeURIComponent(st[k]); });
        var h = parts.length ? "#" + parts.join("&") : " ";
        history.replaceState(null, "", h === " " ? location.pathname + location.search : h);
      }
    }

    // header sorting
    var ths = root.querySelectorAll("thead th[data-key]");
    Array.prototype.forEach.call(ths, function (th) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sort";
      while (th.firstChild) btn.appendChild(th.firstChild);
      th.appendChild(btn);
      btn.addEventListener("click", function () {
        var key = th.getAttribute("data-key");
        if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = 1; }
        Array.prototype.forEach.call(ths, function (o) { o.removeAttribute("aria-sort"); });
        th.setAttribute("aria-sort", sortDir === 1 ? "ascending" : "descending");
        update(false);
      });
    });

    moreBtn.addEventListener("click", function () { limit += PAGE; update(false); });

    // initial state from hash, e.g. nalezy.html#m=Žehra&t=B
    function readHash() {
      var h = location.hash.replace(/^#/, "");
      var st = {};
      h.split("&").forEach(function (p) {
        if (!p) return;
        var i = p.indexOf("=");
        if (i > 0) st[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
      });
      return st;
    }
    function applyHash() {
      var st0 = readHash();
      Object.keys(selects).forEach(function (k) { selects[k].value = ""; });
      search.value = "";
      refreshOptions();
      Object.keys(selects).forEach(function (k) { if (st0[k]) selects[k].value = st0[k]; });
      search.value = st0.q || "";
      refreshOptions();
      Object.keys(selects).forEach(function (k) { if (st0[k]) selects[k].value = st0[k]; });
      limit = PAGE;
      update(false);
    }
    applyHash();
    // links within the page (or the browser's back button) change only the hash
    window.addEventListener("hashchange", applyHash);
  }

  document.addEventListener("DOMContentLoaded", function () {
    Array.prototype.forEach.call(document.querySelectorAll("table[data-sortable]"), makeSortable);
    Array.prototype.forEach.call(document.querySelectorAll("input[data-filter-table]"), makeFilterable);
    var app = document.getElementById("findings-app");
    if (app) findingsApp(app);
  });
})();
