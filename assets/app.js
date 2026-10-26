/* Volebný audit: municipality search and table filters. No dependencies; the pages work without it. */
(function () {
  "use strict";
  var fold = function (s) {
    return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  };
  var root = document.documentElement.getAttribute("data-root") || "";

  /* "/" focuses the page search, or opens the municipality search page */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    var input = document.querySelector("[data-obce-search] input");
    e.preventDefault();
    if (input) input.focus();
    else location.href = root + "obce/";
  });

  /* municipality search over assets/obce.json: [[name, slug, okres], …] */
  var index = null, loading = null;
  function load() {
    if (index) return Promise.resolve(index);
    if (!loading) {
      loading = fetch(root + "assets/obce.json").then(function (r) { return r.json(); }).then(function (rows) {
        index = rows.map(function (r) { return { n: r[0], s: r[1], o: r[2], f: fold(r[0]) }; });
        return index;
      });
    }
    return loading;
  }
  function match(q) {
    var f = fold(q);
    if (!f) return [];
    var a = [], b = [];
    for (var i = 0; i < index.length; i++) {
      var r = index[i], k = r.f.indexOf(f);
      if (k === 0 || (k > 0 && r.f.charAt(k - 1) === " ")) a.push(r);
      else if (k > 0) b.push(r);
    }
    return a.concat(b);
  }
  document.querySelectorAll("[data-obce-search]").forEach(function (form) {
    var input = form.querySelector("input"), list = form.querySelector(".results");
    var limit = parseInt(form.getAttribute("data-limit") || "8", 10), cur = -1, hits = [];
    var full = form.hasAttribute("data-full");
    function render() {
      var q = input.value;
      if (!q.trim()) { list.hidden = true; input.setAttribute("aria-expanded", "false"); return; }
      hits = match(q);
      var shown = hits.slice(0, limit);
      list.innerHTML = "";
      if (!shown.length) {
        var li = document.createElement("li");
        li.className = "empty"; li.textContent = "Žiadna obec sa nenašla.";
        list.appendChild(li);
      }
      shown.forEach(function (r, i) {
        var li = document.createElement("li"), a = document.createElement("a"), s = document.createElement("span");
        li.setAttribute("role", "presentation");
        a.href = root + "obce/" + r.s + "/"; a.id = form.id + "-opt-" + i; a.setAttribute("role", "option");
        a.textContent = r.n; s.textContent = r.o ? "okres " + r.o : "";
        a.appendChild(s); li.appendChild(a); list.appendChild(li);
      });
      if (hits.length > shown.length) {
        var more = document.createElement("li");
        more.className = "empty";
        more.textContent = "a ďalších " + (hits.length - shown.length) + " – spresnite názov";
        list.appendChild(more);
      }
      cur = -1; list.hidden = false; input.setAttribute("aria-expanded", "true");
      input.removeAttribute("aria-activedescendant");
    }
    function move(d) {
      var opts = list.querySelectorAll("a");
      if (!opts.length) return;
      if (cur >= 0) opts[cur].setAttribute("aria-selected", "false");
      cur = (cur + d + opts.length) % opts.length;
      opts[cur].setAttribute("aria-selected", "true");
      input.setAttribute("aria-activedescendant", opts[cur].id);
      opts[cur].scrollIntoView({ block: "nearest" });
    }
    input.addEventListener("focus", load, { once: true });
    input.addEventListener("input", function () { load().then(render); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Escape") { list.hidden = true; input.setAttribute("aria-expanded", "false"); }
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      load().then(function () {
        if (!input.value.trim()) return;
        var opts = list.querySelectorAll("a");
        var pick = cur >= 0 ? opts[cur] : (hits.length === 1 || (hits.length && fold(hits[0].n) === fold(input.value)) ? opts[0] : null);
        if (pick) location.href = pick.href;
        else if (!full) location.href = root + "obce/?q=" + encodeURIComponent(input.value);
        else render();
      });
    });
    document.addEventListener("click", function (e) { if (!form.contains(e.target)) list.hidden = true; });
    form.querySelector(".searchbar").addEventListener("click", function (e) { if (e.target.tagName !== "BUTTON") input.focus(); });
    if (full) {
      var q = new URLSearchParams(location.search).get("q");
      if (q) { input.value = q; load().then(render); }
    }
  });

  /* table filters: text box + chip groups (data-filter-key on the chip group, data-<key> on rows); the state is
     kept in the query string (?q=…&tier=…) so a filtered view can be shared */
  document.querySelectorAll("[data-table-filter]").forEach(function (box) {
    var table = document.getElementById(box.getAttribute("data-table-filter"));
    if (!table) return;
    var rows = Array.prototype.slice.call(table.tBodies[0].rows);
    var text = rows.map(function (r) { return fold(r.textContent); });
    var input = box.querySelector("input[type=search]");
    var out = box.querySelector("[aria-live]");
    var state = {}, params = new URLSearchParams(location.search);
    function apply(save) {
      var q = input ? fold(input.value) : "", n = 0;
      rows.forEach(function (r, i) {
        var ok = !q || text[i].indexOf(q) !== -1;
        for (var k in state) if (ok && state[k] && r.getAttribute("data-" + k) !== state[k]) ok = false;
        r.hidden = !ok; if (ok) n++;
      });
      if (out) out.textContent = "Zobrazené riadky: " + n + " z " + rows.length;
      if (save && history.replaceState) {
        var p = new URLSearchParams(location.search);
        if (input && input.value.trim()) p.set("q", input.value.trim()); else p.delete("q");
        for (var k2 in state) if (state[k2]) p.set(k2, state[k2]); else p.delete(k2);
        var s = p.toString();
        history.replaceState(null, "", location.pathname + (s ? "?" + s : "") + location.hash);
      }
    }
    function press(group, b) {
      group.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
      b.setAttribute("aria-pressed", "true");
      state[group.getAttribute("data-filter-key")] = b.getAttribute("data-value") || "";
    }
    box.querySelectorAll("[data-filter-key]").forEach(function (group) {
      var want = params.get(group.getAttribute("data-filter-key"));
      group.querySelectorAll("button").forEach(function (b) {
        if (want && b.getAttribute("data-value") === want) press(group, b);
        b.addEventListener("click", function () { press(group, b); apply(true); });
      });
    });
    if (input) {
      if (params.get("q")) input.value = params.get("q");
      input.addEventListener("input", function () { apply(true); });
    }
    box.hidden = false;
    apply(false);
  });
})();
