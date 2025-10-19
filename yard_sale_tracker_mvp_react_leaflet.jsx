import React, { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41],
});

const uid = () => Math.random().toString(36).slice(2, 10);
const toISODate = (d) => new Date(d).toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();
const clamp = (n, min, max) => Math.max(min, Math.min(n, max));

function getThuSatRange(now = new Date()) {
  const day = now.getDay();
  const toThu = (4 - day + 7) % 7;
  const toSat = (6 - day + 7) % 7;
  const thu = new Date(now); thu.setDate(now.getDate() + toThu);
  const sat = new Date(now); sat.setDate(now.getDate() + toSat);
  return { start: toISODate(thu), end: toISODate(sat) };
}

function distanceMi(a, b) {
  if (!a || !b) return Infinity;
  const R = 3958.7613;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const aVal = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return R * c;
}

function isIOS(ua = navigator.userAgent) { return /iPad|iPhone|iPod/i.test(ua); }
function appleMapsUrl(lat, lng, label = "Destination") { return `http://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(label)}`; }
function googleMapsUrl(lat, lng) { return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`; }
function directionsHref(lat, lng, label) { return isIOS() ? appleMapsUrl(lat, lng, label) : googleMapsUrl(lat, lng); }

const LS_SALES = "yst_sales_v1";
const LS_FAVS = "yst_favs_v1";
const LS_PROFILE = "yst_profile_v1";

const ALL_CATEGORIES = [
  "clothing",
  "furniture",
  "electronics",
  "toys",
  "books",
  "tools",
  "antiques",
  "baby",
  "sports",
  "kitchen",
];

export default function App() {
  const [sales, setSales] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_SALES)) || [];
    } catch {
      return [];
    }
  });
  const [favs, setFavs] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(LS_FAVS)) || []);
    } catch {
      return new Set();
    }
  });
  const [profile, setProfile] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(LS_PROFILE));
      if (parsed) {
        const notifyRadiusMi =
          parsed.notifyRadiusMi ?? (parsed.notifyRadiusKm != null ? parsed.notifyRadiusKm : 5);
        return { ...parsed, notifyRadiusMi };
      }
      return { id: uid(), name: "Guest", home: null, notifyRadiusMi: 5 };
    } catch {
      return { id: uid(), name: "Guest", home: null, notifyRadiusMi: 5 };
    }
  });
  const [view, setView] = useState("map");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState({
    dateFrom: toISODate(new Date()),
    dateTo: toISODate(new Date(Date.now() + 1000 * 60 * 60 * 24 * 14)),
    cats: new Set(),
    onlyNearby: false,
    radiusMi: 10,
    ignoreDate: false,
  });
  const [editing, setEditing] = useState(null);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => localStorage.setItem(LS_SALES, JSON.stringify(sales)), [sales]);
  useEffect(() =>
    localStorage.setItem(LS_FAVS, JSON.stringify(Array.from(favs))),
  [favs]);
  useEffect(() => localStorage.setItem(LS_PROFILE, JSON.stringify(profile)), [profile]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = new Date(filter.dateFrom);
    const to = new Date(filter.dateTo);
    return sales.filter((s) => {
      const sFrom = new Date(s.dateFrom);
      const sTo = new Date(s.dateTo);
      const overlaps = filter.ignoreDate ? true : (sFrom <= to && sTo >= from);
      if (!overlaps) return false;
      if (filter.cats.size > 0) {
        const hasCat = s.categories?.some((c) => filter.cats.has(c));
        if (!hasCat) return false;
      }
      if (q) {
        const hay = [
          s.title,
          s.description,
          s.address,
          s.contact?.email,
          s.contact?.phone,
          ...(s.categories || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filter.onlyNearby && profile.home && s.location) {
        const mi = distanceMi(profile.home, s.location);
        if (mi > filter.radiusMi) return false;
      }
      return true;
    });
  }, [sales, filter, query, profile.home]);

  useEffect(() => {
    const degLonAtEquatorMi = distanceMi({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    console.assert(degLonAtEquatorMi > 68 && degLonAtEquatorMi < 70, "distanceMi sanity check failed");
    const zero = distanceMi({ lat: 10, lng: 10 }, { lat: 10, lng: 10 });
    console.assert(zero === 0, "distanceMi zero distance failed");
    const nyc = { lat: 40.7128, lng: -74.006 };
    const la = { lat: 34.0522, lng: -118.2437 };
    const nycLa = distanceMi(nyc, la);
    console.assert(nycLa > 2400 && nycLa < 2500, "distanceMi NYC-LA range check failed");
    console.assert(isIOS("iPhone") === true, "isIOS iPhone fail");
    console.assert(isIOS("Android") === false, "isIOS Android fail");
    console.assert(appleMapsUrl(1,2,"X").includes("maps.apple.com"), "appleMapsUrl fail");
    console.assert(googleMapsUrl(1,2).includes("google.com/maps/dir"), "googleMapsUrl fail");
  }, []);

  useEffect(() => {
    const ok = !!DefaultIcon?.options?.shadowUrl && DefaultIcon.options.shadowUrl.includes("marker-shadow.png");
    console.assert(ok, "icon shadowUrl invalid");
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const makeIcon = async (size) => {
          const c = document.createElement("canvas"); c.width = size; c.height = size;
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0,size,size);
          ctx.fillStyle = "#111827"; ctx.beginPath(); ctx.arc(size/2,size/2,size*0.44,0,Math.PI*2); ctx.fill();
          ctx.font = Math.floor(size*0.5)+"px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#f59e0b"; ctx.fillText("🪧", size/2, size/2 + Math.floor(size*0.04));
          return c.toDataURL("image/png");
        };
        const icon192 = await makeIcon(192);
        const icon512 = await makeIcon(512);
        const manifest = {
          name: "Yard Sale Tracker",
          short_name: "Yard Sales",
          start_url: ".",
          display: "standalone",
          background_color: "#ffffff",
          theme_color: "#111827",
          icons: [
            { src: icon192, sizes: "192x192", type: "image/png", purpose: "any maskable" },
            { src: icon512, sizes: "512x512", type: "image/png", purpose: "any maskable" },
          ],
        };
        const mUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" }));
        const link = document.createElement("link"); link.rel = "manifest"; link.href = mUrl; document.head.appendChild(link);
        const theme = document.querySelector('meta[name="theme-color"]') || document.createElement("meta");
        theme.setAttribute("name","theme-color"); theme.setAttribute("content","#111827"); if (!theme.parentNode) document.head.appendChild(theme);
      } catch {}
    })();

    if ("serviceWorker" in navigator) {
      const swCode = `const C='yst-v4';
const OFFLINE_KEY='__OFFLINE__';
const OFFLINE_HTML='<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Offline</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f8fafc;color:#0f172a}main{max-width:28rem;padding:1.25rem;text-align:center;background:#fff;border:1px solid #e5e7eb;border-radius:1rem;box-shadow:0 1px 2px rgba(0,0,0,.05)}h1{font-size:1.125rem;margin:0 0 .5rem}p{font-size:.875rem;margin:.5rem 0}</style></head><body><main><div style="font-size:42px">🪧</div><h1>You're offline</h1><p>We couldn't reach the network. Map tiles and new data won't load, but your app shell is cached.</p><p>Reconnect and refresh to continue.</p></main></body></html>';
self.addEventListener('install',e=>{e.waitUntil((async()=>{const c=await caches.open(C);await c.put(OFFLINE_KEY,new Response(OFFLINE_HTML,{headers:{'Content-Type':'text/html;charset=UTF-8'}}));})());self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(a=>Promise.all(a.filter(k=>k!==C).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('message',e=>{const d=e.data||{};if(d.type==='PRECACHE'&&Array.isArray(d.urls)){e.waitUntil((async()=>{const c=await caches.open(C);await c.addAll(d.urls.filter(Boolean));})());}});
self.addEventListener('fetch',e=>{const r=e.request; if(r.method!=='GET') return; const u=new URL(r.url);
  if(r.mode==='navigate'){
    if(u.origin!==location.origin){return;}
    e.respondWith((async()=>{const c=await caches.open(C);
      try{const resp=await fetch(r); if(resp.ok) c.put(u.href, resp.clone()); return resp}catch(err){
        const hit=await c.match(u.href)||await c.match(new URL('/', location.origin).href)||await c.match(OFFLINE_KEY);
        return hit || new Response('offline',{status:503});
      }
    })());
    return;
  }
  if(u.origin!==location.origin){ if(u.hostname.endsWith('tile.openstreetmap.org')) return; }
  e.respondWith((async()=>{const c=await caches.open(C); const hit=await c.match(r); if(hit) return hit; try{const resp=await fetch(r); if(resp.ok && u.origin===location.origin) c.put(r, resp.clone()); return resp}catch(err){ if(hit) return hit; return new Response('offline',{status:503}) } })());
});`;
      const swUrl = URL.createObjectURL(new Blob([swCode], { type: "text/javascript" }));
      navigator.serviceWorker.register(swUrl).then((reg) => {
        const collectShell = () => {
          const s = new Set();
          s.add(new URL('/', location.origin).href);
          s.add(new URL('index.html', location.origin).href);
          s.add(new URL(location.pathname, location.href).href);
          document.querySelectorAll('link[rel="modulepreload"],link[rel="stylesheet"]').forEach(el=>{ if(el.href){ const u=new URL(el.href, location.href); if(u.origin===location.origin) s.add(u.href); }});
          document.querySelectorAll('script[type="module"]').forEach(el=>{ if(el.src){ const u=new URL(el.src, location.href); if(u.origin===location.origin) s.add(u.href); }});
          return Array.from(s);
        };
        const sendPrecache = () => {
          const urls = collectShell();
          if (reg.active) reg.active.postMessage({ type: 'PRECACHE', urls });
        };
        if (reg.active) sendPrecache(); else navigator.serviceWorker.ready.then(()=>sendPrecache());
      }).catch(()=>{});
    }});
          document.querySelectorAll('script[type="module"]').forEach(el=>{ if(el.src){ const u=new URL(el.src, location.href); if(u.origin===location.origin) s.add(u.href); }});
          return Array.from(s);
        };
        const sendPrecache = () => {
          const urls = collectShell();
          if (reg.active) reg.active.postMessage({ type: 'PRECACHE', urls });
        };
        if (reg.active) sendPrecache(); else navigator.serviceWorker.ready.then(()=>sendPrecache());
      }).catch(()=>{});
    }
  }, []);

  function toggleFav(id) {
    setFavs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function saveSale(sale) {
    setSales((prev) => {
      const exists = prev.some((p) => p.id === sale.id);
      return exists ? prev.map((p) => (p.id === sale.id ? sale : p)) : [sale, ...prev];
    });
    setEditing(null);
    setView("map");
  }

  function removeSale(id) {
    setSales((prev) => prev.filter((s) => s.id !== id));
    setFavs((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function setHome(loc) {
    setProfile((p) => ({ ...p, home: loc }));
  }

  function importJson(jsonText) {
    try {
      const data = JSON.parse(jsonText);
      if (!Array.isArray(data)) throw new Error("Expected an array of sales");
      const cleaned = data.map((s) => ({
        id: s.id || uid(),
        title: s.title || "Yard Sale",
        address: s.address || "",
        location: s.location || null,
        dateFrom: s.dateFrom || toISODate(new Date()),
        dateTo: s.dateTo || s.dateFrom || toISODate(new Date()),
        timeStart: s.timeStart || "08:00",
        timeEnd: s.timeEnd || "12:00",
        categories: Array.isArray(s.categories) ? s.categories : [],
        photos: Array.isArray(s.photos) ? s.photos : [],
        description: s.description || "",
        contact: s.contact || {},
        createdAt: s.createdAt || nowISO(),
        updatedAt: nowISO(),
        userId: s.userId || profile.id,
      }));
      setSales(cleaned);
    } catch (e) {
      alert("Import error: " + e.message);
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(sales, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "yard-sales.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-200">🪧</span>
            <h1 className="text-xl font-bold">Yard Sale Tracker</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              className={`px-3 py-1.5 rounded-xl text-sm ${view === "map" ? "bg-gray-900 text-white" : "bg-gray-100"}`}
              onClick={() => setView("map")}
            >
              Map
            </button>
            <button
              className={`px-3 py-1.5 rounded-xl text-sm ${view === "list" ? "bg-gray-900 text-white" : "bg-gray-100"}`}
              onClick={() => setView("list")}
            >
              List
            </button>
            <button
              className={`px-3 py-1.5 rounded-xl text-sm ${view === "add" ? "bg-gray-900 text-white" : "bg-gray-100"}`}
              onClick={() => setView("add")}
            >
              Add Sale
            </button>
            <button
              className={`px-3 py-1.5 rounded-xl text-sm ${view === "profile" ? "bg-gray-900 text-white" : "bg-gray-100"}`}
              onClick={() => setView("profile")}
            >
              Profile
            </button>
          </div>
        </div>
      </header>

      {!online && (
        <div className="mx-auto max-w-6xl px-4 pt-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm px-3 py-2">
            You’re offline. Map tiles and new data won’t load until you’re back online.
          </div>
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-4">
        <Toolbar
          query={query}
          setQuery={setQuery}
          filter={filter}
          setFilter={setFilter}
          profile={profile}
          setProfile={setProfile}
        />

        {view === "map" && (
          <MapView
            sales={filtered}
            onEdit={(s) => {
              setEditing(s);
              setView("add");
            }}
            home={profile.home}
            setHome={setHome}
            radiusMi={filter.onlyNearby ? filter.radiusMi : null}
          />
        )}

        {view === "list" && (
          <SaleList
            sales={filtered}
            favs={favs}
            onFav={toggleFav}
            onEdit={(s) => {
              setEditing(s);
              setView("add");
            }}
            onDelete={(id) => removeSale(id)}
          />
        )}

        {view === "add" && (
          <SaleForm
            initial={editing}
            onCancel={() => {
              setEditing(null);
              setView("map");
            }}
            onSave={saveSale}
          />
        )}

        {view === "profile" && (
          <Profile
            profile={profile}
            setProfile={setProfile}
            exportJson={exportJson}
            importJson={importJson}
          />
        )}
      </main>

      <footer className="py-8 text-center text-xs text-gray-500">MVP demo — local only.</footer>
    </div>
  );
}

function Toolbar({ query, setQuery, filter, setFilter, profile, setProfile }) {
  const [catOpen, setCatOpen] = useState(false);
  const onCenterMe = () => {
    if (!navigator.geolocation) { alert("Location not available"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setProfile((p) => ({ ...p, home: { lat: pos.coords.latitude, lng: pos.coords.longitude } })),
      () => alert("Couldn't get your location")
    );
  };
  const onReset = () => {
    const start = toISODate(new Date());
    const end = toISODate(new Date(Date.now() + 7*24*60*60*1000));
    setQuery("");
    setFilter({ dateFrom: start, dateTo: end, cats: new Set(), onlyNearby: false, radiusMi: 10, ignoreDate: false });
  };
  return (
    <div className="mb-4 grid gap-3 md:grid-cols-12">
      <div className="md:col-span-6">
        <input
          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-400 focus:ring-2 focus:ring-gray-300 outline-none"
          placeholder="Search: antiques, books, electronics…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="md:col-span-6 flex flex-wrap items-center gap-2">
        <input
          type="date"
          className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
          value={filter.dateFrom}
          onChange={(e) => setFilter((f) => ({ ...f, dateFrom: e.target.value }))}
        />
        <span className="text-sm text-gray-500">to</span>
        <input
          type="date"
          className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
          value={filter.dateTo}
          onChange={(e) => setFilter((f) => ({ ...f, dateTo: e.target.value }))}
        />
        <div className="flex flex-wrap gap-2">
          <button className="px-2 py-1 text-xs rounded-lg border" onClick={() => {
            const d = toISODate(new Date());
            setFilter((f) => ({ ...f, dateFrom: d, dateTo: d, ignoreDate: false }));
          }}>Today</button>
          <button className="px-2 py-1 text-xs rounded-lg border" onClick={() => {
            const t = new Date(); t.setDate(t.getDate() + 1);
            const d = toISODate(t);
            setFilter((f) => ({ ...f, dateFrom: d, dateTo: d, ignoreDate: false }));
          }}>Tomorrow</button>
          <button className="px-2 py-1 text-xs rounded-lg border" onClick={() => {
            const { start, end } = getThuSatRange(new Date());
            setFilter((f) => ({ ...f, dateFrom: start, dateTo: end, ignoreDate: false }));
          }}>This weekend</button>
          <button className="px-2 py-1 text-xs rounded-lg border" onClick={() => {
            const start = toISODate(new Date());
            const end = toISODate(new Date(Date.now() + 7*24*60*60*1000));
            setFilter((f) => ({ ...f, dateFrom: start, dateTo: end, ignoreDate: false }));
          }}>Next 7 days</button>
          <button className="px-2 py-1 text-xs rounded-lg border" onClick={() => {
            const start = toISODate(new Date());
            const end = toISODate(new Date(Date.now() + 365*24*60*60*1000));
            setFilter((f) => ({ ...f, dateFrom: start, dateTo: end, ignoreDate: false }));
          }}>All upcoming</button>
        </div>
        <button
          className={`px-3 py-2 rounded-xl text-sm border ${catOpen ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-300"}`}
          onClick={() => setCatOpen((s) => !s)}
        >
          Categories
        </button>
        {catOpen && (
          <div className="w-full md:w-auto md:absolute z-10 bg-white border border-gray-200 rounded-xl p-3 shadow-sm flex flex-wrap gap-2">
            {ALL_CATEGORIES.map((c) => {
              const selected = filter.cats.has(c);
              return (
                <button
                  key={c}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${selected ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-300"}`}
                  onClick={() =>
                    setFilter((f) => {
                      const next = new Set(f.cats);
                      next.has(c) ? next.delete(c) : next.add(c);
                      return { ...f, cats: next };
                    })
                  }
                >
                  {c}
                </button>
              );
            })}
          </div>
        )}
        <label className="ml-auto inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filter.onlyNearby}
            onChange={(e) => setFilter((f) => ({ ...f, onlyNearby: e.target.checked }))}
          />
          Nearby <span className="text-xs text-gray-500">matches date filter</span>
        </label>
        <input
          type="number"
          className="w-20 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
          min={1}
          max={200}
          value={filter.radiusMi}
          onChange={(e) => setFilter((f) => ({ ...f, radiusMi: clamp(Number(e.target.value || 0), 1, 200) }))}
          disabled={!filter.onlyNearby}
        />
        <span className="text-sm text-gray-500">mi</span>
        <label className="inline-flex items-center gap-2 text-sm ml-2">
          <input type="checkbox" checked={filter.ignoreDate} onChange={(e) => setFilter((f) => ({ ...f, ignoreDate: e.target.checked }))} />
          Ignore date filter
        </label>
        <button className="px-2 py-1 text-xs rounded-lg border" onClick={onCenterMe}>Center on me</button>
        <button className="px-2 py-1 text-xs rounded-lg border" onClick={onReset}>Reset filters</button>
      </div>
      {!profile.home && (
        <div className="md:col-span-12 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2">
          Tip: set a Home pin in Profile so "Nearby" can filter by your location.
        </div>
      )}
    </div>
  );
}

function MapView({ sales, onEdit, home, setHome, radiusMi }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const circleRef = useRef(null);
  const defaultCenter = home || { lat: 35.091, lng: -92.442 };

  useEffect(() => {
    if (!mapRef.current && mapEl.current) {
      const m = L.map(mapEl.current, { zoomControl: true, scrollWheelZoom: true, dragging: true, touchZoom: true, tap: false, keyboard: true }).setView([defaultCenter.lat, defaultCenter.lng], 12);
      if (mapEl.current) mapEl.current.classList.add("cursor-grab");
      m.on("dragstart", () => mapEl.current && mapEl.current.classList.add("cursor-grabbing"));
      m.on("dragend", () => mapEl.current && mapEl.current.classList.remove("cursor-grabbing"));
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors" }).addTo(m);
      m.on("click", (e) => {
        if (e.originalEvent && e.originalEvent.shiftKey) {
          setHome({ lat: e.latlng.lat, lng: e.latlng.lng });
        }
      });
      mapRef.current = m;
    }
  }, []);

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setView([
        home?.lat ?? defaultCenter.lat,
        home?.lng ?? defaultCenter.lng,
      ]);
    }
  }, [home?.lat, home?.lng]);

  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach((mk) => mk.remove());
    markersRef.current = [];
    if (home) {
      const mkHome = L.marker([home.lat, home.lng], { icon: DefaultIcon })
        .addTo(mapRef.current)
        .bindPopup("Home");
      markersRef.current.push(mkHome);
    }
    sales.forEach((s) => {
      const lat = s.location?.lat ?? defaultCenter.lat;
      const lng = s.location?.lng ?? defaultCenter.lng;
      const mk = L.marker([lat, lng], { icon: DefaultIcon }).addTo(mapRef.current);
      const dirUrl = directionsHref(lat, lng, s.title || s.address || "Yard Sale");
      const html = `<div class=\"text-sm space-y-1\"><div class=\"font-semibold\">${s.title || "Yard Sale"}</div><div class=\"text-xs text-gray-500\">${s.address || ""}</div><div class=\"text-xs\">${s.dateFrom} → ${s.dateTo} • ${s.timeStart}–${s.timeEnd}</div><div class=\"text-xs\">${(s.categories || []).join(", ")}</div>${s.description ? `<div class=\\\"text-xs mt-1\\\">${s.description}</div>` : ""}<div class=\"grid grid-cols-2 gap-2 mt-2\"><button id=\"edit-${s.id}\" class=\"w-full rounded-lg bg-gray-900 text-white text-xs px-2 py-1\">Edit</button><a href=\"${dirUrl}\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"w-full text-center rounded-lg bg-white border text-xs px-2 py-1\">Directions</a></div></div>`;
      mk.bindPopup(html);
      mk.on("popupopen", () => {
        const btn = document.getElementById(`edit-${s.id}`);
        if (btn) btn.onclick = () => onEdit(s);
      });
      markersRef.current.push(mk);
    });
    if (circleRef.current) {
      circleRef.current.remove();
      circleRef.current = null;
    }
    if (home && radiusMi) {
      circleRef.current = L.circle([home.lat, home.lng], {
        radius: radiusMi * 1609.344,
        color: "#222",
        opacity: 0.35,
      }).addTo(mapRef.current);
    }
  }, [sales, home?.lat, home?.lng, radiusMi]);

  return (
    <div
      ref={mapEl}
      className="h-[70vh] w-full overflow-hidden rounded-2xl border border-gray-200"
      style={{ touchAction: "pan-x pan-y" }}
    />
  );
}

function SaleForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    () =>
      initial || {
        id: uid(),
        title: "Yard Sale",
        address: "",
        location: null,
        dateFrom: toISODate(new Date()),
        dateTo: toISODate(new Date()),
        timeStart: "08:00",
        timeEnd: "12:00",
        categories: [],
        photos: [],
        description: "",
        contact: { phone: "", email: "" },
        createdAt: nowISO(),
        updatedAt: nowISO(),
        userId: "local",
      }
  );
  useEffect(() => {
    if (initial) setForm(initial);
  }, [initial]);
  function setField(key, val) {
    setForm((f) => ({ ...f, [key]: val, updatedAt: nowISO() }));
  }
  function toggleCat(cat) {
    setForm((f) => {
      const has = f.categories.includes(cat);
      return {
        ...f,
        categories: has
          ? f.categories.filter((c) => c !== cat)
          : [...f.categories, cat],
      };
    });
  }
  function addPhoto(url) {
    if (!url) return;
    setForm((f) => ({ ...f, photos: [...f.photos, url] }));
  }
  function removePhoto(idx) {
    setForm((f) => ({ ...f, photos: f.photos.filter((_, i) => i !== idx) }));
  }
  function onPickHere(latlng) {
    setForm((f) => ({ ...f, location: latlng, address: f.address || "Dropped pin" }));
  }
  function submit(e) {
    e.preventDefault();
    if (!form.location) {
      alert("Please pick a location on the map.");
      return;
    }
    onSave(form);
  }
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium">Title</label>
          <input
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm"
            value={form.title}
            onChange={(e) => setField("title", e.target.value)}
            placeholder="Huge moving sale!"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Address</label>
          <input
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm"
            value={form.address}
            onChange={(e) => setField("address", e.target.value)}
            placeholder="123 Main St, City, ST"
          />
          <p className="text-xs text-gray-500 mt-1">
            (Optional text; location is set by clicking the map)
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium">Start date</label>
            <input
              type="date"
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm"
              value={form.dateFrom}
              onChange={(e) => setField("dateFrom", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">End date</label>
            <input
              type="date"
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm"
              value={form.dateTo}
              onChange={(e) => setField("dateTo", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Time start</label>
            <input
              type="time"
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm"
              value={form.timeStart}
              onChange={(e) => setField("timeStart", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Time end</label>
            <input
              type="time"
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm"
              value={form.timeEnd}
              onChange={(e) => setField("timeEnd", e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium">Categories</label>
          <div className="flex flex-wrap gap-2 mt-1">
            {ALL_CATEGORIES.map((c) => (
              <button
                type="button"
                key={c}
                className={`px-3 py-1.5 rounded-lg text-sm border ${
                  form.categories.includes(c)
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white border-gray-300"
                }`}
                onClick={() => toggleCat(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium">
            Photos (URLs)
            <span className="text-xs text-gray-500 font-normal">
              
              — paste a link, then add
            </span>
          </label>
          <PhotoAdder onAdd={addPhoto} />
          {form.photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-2">
              {form.photos.map((url, i) => (
                <div key={i} className="relative">
                  <img
                    src={url}
                    alt="photo"
                    className="w-full h-24 object-cover rounded-lg border"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute top-1 right-1 bg-white/90 rounded px-2 text-xs border"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="block text sm font-medium">Description</label>
          <textarea
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm"
            rows={3}
            value={form.description}
            onChange={(e) => setField("description", e.target.value)}
            placeholder="Kids clothes, toys, small appliances…"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium">Phone (optional)</label>
            <input
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm"
              value={form.contact.phone}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  contact: { ...f.contact, phone: e.target.value },
                }))
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Email (optional)</label>
            <input
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm"
              value={form.contact.email}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  contact: { ...f.contact, email: e.target.value },
                }))
              }
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 rounded-xl bg-gray-900 text-white" type="submit">
            Save
          </button>
          <button
            className="px-4 py-2 rounded-xl bg-gray-100"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </form>

      <div className="h-[70vh] w-full overflow-hidden rounded-2xl border border-gray-200">
        <MapPicker onPick={onPickHere} current={form.location} />
      </div>
    </div>
  );
}

function PhotoAdder({ onAdd }) {
  const [val, setVal] = useState("");
  return (
    <div className="flex gap-2">
      <input
        className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm"
        placeholder="https://…"
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
      <button
        type="button"
        className="px-3 py-2 rounded-xl bg-gray-900 text-white"
        onClick={() => {
          onAdd(val);
          setVal("");
        }}
      >
        Add
      </button>
    </div>
  );
}

function MapPicker({ onPick, current }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const defaultCenter = current || { lat: 35.091, lng: -92.442 };
  useEffect(() => {
    if (!mapRef.current && mapEl.current) {
      const m = L.map(mapEl.current, { zoomControl: true, scrollWheelZoom: true, dragging: true, touchZoom: true, tap: false, keyboard: true }).setView([ defaultCenter.lat, defaultCenter.lng ], 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(m);
      m.on("click", (e) => {
        const latlng = { lat: e.latlng.lat, lng: e.latlng.lng };
        if (markerRef.current)
          markerRef.current.setLatLng([latlng.lat, latlng.lng]);
        else
          markerRef.current = L.marker([latlng.lat, latlng.lng], { icon: DefaultIcon })
            .addTo(m)
            .bindPopup("Sale location");
        onPick(latlng);
      });
      mapRef.current = m;
    }
  }, []);
  useEffect(() => {
    if (mapRef.current && current) {
      mapRef.current.setView([current.lat, current.lng]);
      if (markerRef.current) markerRef.current.setLatLng([current.lat, current.lng]);
      else
        markerRef.current = L.marker([current.lat, current.lng], { icon: DefaultIcon })
          .addTo(mapRef.current)
          .bindPopup("Sale location");
    }
  }, [current?.lat, current?.lng]);
  return <div ref={mapEl} className="h-full w-full" style={{ touchAction: "pan-x pan-y" }} />;
}

function SaleList({ sales, favs, onFav, onEdit, onDelete }) {
  if (sales.length === 0)
    return (
      <div className="text-center text-sm text-gray-500 py-16">
        No sales match your filters yet.
      </div>
    );
  return (
    <div className="grid gap-3">
      {sales.map((s) => (
        <div
          key={s.id}
          className="rounded-2xl border border-gray-200 p-4 flex gap-3"
        >
          <div className="w-28 h-20 rounded-xl bg-gray-100 overflow-hidden border">
            {s.photos?.[0] ? (
              <img
                src={s.photos[0]}
                alt="thumb"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full grid place-items-center text-2xl">
                🪧
              </div>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-start gap-2">
              <h3 className="font-semibold">{s.title || "Yard Sale"}</h3>
              <span className="ml-auto text-xs text-gray-500">
                {s.dateFrom} → {s.dateTo} • {s.timeStart}-{s.timeEnd}
              </span>
            </div>
            <div className="text-xs text-gray-600">{s.address}</div>
            <div className="text-xs mt-1">{(s.categories || []).join(", ")}</div>
            {s.description && (
              <div className="text-xs mt-1 line-clamp-2">{s.description}</div>
            )}
            <div className="mt-2 flex gap-2">
              <button
                className={`px-3 py-1.5 rounded-lg text-xs border ${
                  favs.has(s.id)
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white border-gray-300"
                }`}
                onClick={() => onFav(s.id)}
              >
                {favs.has(s.id) ? "★ Favorited" : "☆ Favorite"}
              </button>
              <button
                className="px-3 py-1.5 rounded-lg text-xs border bg-white border-gray-300"
                onClick={() => onEdit(s)}
              >
                Edit
              </button>
              <a
                className="px-3 py-1.5 rounded-lg text-xs border bg-white border-gray-300"
                href={directionsHref(s.location?.lat ?? "", s.location?.lng ?? "", s.title || s.address || "Yard Sale")}
                target="_blank"
                rel="noopener noreferrer"
              >
                Directions
              </a>
              <button
                className="px-3 py-1.5 rounded-lg text-xs border bg-white border-gray-300"
                onClick={() => onDelete(s.id)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Profile({ profile, setProfile, exportJson, importJson }) {
  const [name, setName] = useState(profile.name || "");
  const [radius, setRadius] = useState(profile.notifyRadiusMi || 5);
  const [importText, setImportText] = useState("");
  useEffect(() => setName(profile.name || ""), [profile.name]);
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium">Display name</label>
          <input
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Notify radius (mi)</label>
          <input
            type="number"
            className="w-32 rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value) || 0)}
          />
        </div>
        <div className="flex gap-2">
          <button
            className="px-4 py-2 rounded-xl bg-gray-900 text-white"
            onClick={() =>
              setProfile((p) => ({
                ...p,
                name,
                notifyRadiusMi: clamp(radius, 1, 200),
              }))
            }
          >
            Save Profile
          </button>
        </div>
        <div className="text-xs text-gray-500">
          Shift+Click on the map (Map tab) to set your Home pin.
        </div>
      </div>
      <div className="space-y-3">
        <div className="rounded-2xl border border-gray-200 p-3">
          <div className="text-sm font-medium mb-2">Data export</div>
          <button className="px-4 py-2 rounded-xl bg-gray-100 border" onClick={exportJson}>
            Download sales JSON
          </button>
        </div>
        <div className="rounded-2xl border border-gray-200 p-3">
          <div className="text-sm font-medium mb-2">Data import</div>
          <textarea
            className="w-full h-32 rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm"
            placeholder="Paste JSON array of sales…"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <button
              className="px-4 py-2 rounded-xl bg-gray-900 text-white"
              onClick={() => importJson(importText)}
            >
              Import
            </button>
            <button
              className="px-4 py-2 rounded-xl bg-gray-100"
              onClick={() => setImportText("")}
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
