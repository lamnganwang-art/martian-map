// ---------- Config ----------
const EXTENT = [77.0, 18.0, 77.9, 18.8];     // [minLon, minLat, maxLon, maxLat]
const MARS_RADIUS_KM = 3389.5;
const GRID_N = 200;
const LIMITS = { caution: 10, avoid: 20 };    // degrees

// Approximate coordinates for layout only. Verify against real data before the demo.
const STOPS = [
  { name:'Landing site', lon:77.45, lat:18.44, note:'Where the rover touched down. A flat, safe starting point.' },
  { name:'Delta front',  lon:77.36, lat:18.46, note:'Remains of an ancient river delta. Strong candidate for preserved signs of past life.' },
  { name:'Maaz unit',    lon:77.40, lat:18.41, note:'Rock unit near the landing site. Helps date the crater floor.' },
  { name:'Seitah unit',  lon:77.37, lat:18.38, note:'Ridged, rugged terrain with ancient rock. Harder to drive, rich in science.' },
  { name:'Crater rim',   lon:77.18, lat:18.55, note:'Older bedrock from before the crater formed. Long and steep drive.' }
];

// ---------- Slope data (synthetic: swap for your real grid later) ----------
const slope = new Float32Array(GRID_N * GRID_N);
for (let y = 0; y < GRID_N; y++) for (let x = 0; x < GRID_N; x++) {
  const u = x / GRID_N * 6.28, v = y / GRID_N * 6.28;
  const n = Math.sin(u*2 + v) + Math.sin(v*3 - u*1.5) + 0.6*Math.sin(u*5 + v*4) + 0.4*Math.cos(v*7 - u*3);
  slope[y * GRID_N + x] = Math.max(0, (n + 2) * 6.5);
}

function slopeAt(lon, lat) {
  const x = Math.floor((lon - EXTENT[0]) / (EXTENT[2] - EXTENT[0]) * GRID_N);
  const y = Math.floor((EXTENT[3] - lat) / (EXTENT[3] - EXTENT[1]) * GRID_N);
  if (x < 0 || y < 0 || x >= GRID_N || y >= GRID_N) return null;
  return slope[y * GRID_N + x];
}

function slopeImageUrl() {
  const c = document.createElement('canvas'); c.width = c.height = GRID_N;
  const ctx = c.getContext('2d'), img = ctx.createImageData(GRID_N, GRID_N);
  for (let i = 0; i < slope.length; i++) {
    const s = slope[i];
    const [r, g, b] = s < LIMITS.caution ? [63,174,90] : s < LIMITS.avoid ? [230,202,46] : [208,64,48];
    img.data.set([r, g, b, 150], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

// ---------- Map ----------
const slopeLayer = new ol.layer.Image({
  source: new ol.source.ImageStatic({ url: slopeImageUrl(), imageExtent: EXTENT, projection: 'EPSG:4326' })
});

// TODO: add the real Mars base map (Mars Trek) beneath these layers.
const gridLayer = new ol.layer.Graticule({
  strokeStyle: new ol.style.Stroke({ color: 'rgba(241,228,214,0.25)', width: 1 }),
  showLabels: true
});

const stopSource = new ol.source.Vector();
STOPS.forEach(s => stopSource.addFeature(
  new ol.Feature({ geometry: new ol.geom.Point([s.lon, s.lat]), stop: s })));
const stopsLayer = new ol.layer.Vector({
  source: stopSource,
  style: new ol.style.Style({
    image: new ol.style.Circle({ radius: 7, fill: new ol.style.Fill({ color: '#e8a35a' }),
      stroke: new ol.style.Stroke({ color: '#1c1310', width: 2 }) })
  })
});

const routeSource = new ol.source.Vector();
const routeLayer = new ol.layer.Vector({
  source: routeSource,
  style: f => f.get('kind') === 'line'
    ? new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#ffffff', width: 3, lineDash: [8, 6] }) })
    : new ol.style.Style({ image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: '#ffffff' }),
        stroke: new ol.style.Stroke({ color: '#1c1310', width: 2 }) }) })
});

const map = new ol.Map({
  target: 'map',
  layers: [gridLayer, slopeLayer, routeLayer, stopsLayer],
  view: new ol.View({ projection: 'EPSG:4326', center: [77.45, 18.4], zoom: 10 })
});
map.getView().fit(EXTENT, { size: map.getSize() });

// ---------- Layer switcher ----------
[['l-grid', gridLayer], ['l-slope', slopeLayer], ['l-stops', stopsLayer]].forEach(([id, layer]) =>
  document.getElementById(id).addEventListener('change', e => layer.setVisible(e.target.checked)));

// ---------- Route tool ----------
let points = [];

function haversineKm(a, b) {
  const rad = d => d * Math.PI / 180;
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat/2)**2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon/2)**2;
  return 2 * MARS_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function summarize(a, b) {
  const N = 150; let max = 0, caution = 0, avoid = 0, count = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N, s = slopeAt(a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t);
    if (s === null) continue;
    count++; max = Math.max(max, s);
    if (s >= LIMITS.avoid) avoid++; else if (s >= LIMITS.caution) caution++;
  }
  const share = count ? (caution + avoid) / count : 0;
  // Rating rule: any ground over 20° = Unsafe; over 25% caution/avoid ground = Caution.
  const rating = max >= LIMITS.avoid ? 'Unsafe' : share > 0.25 ? 'Caution' : 'Safe';
  return { dist: haversineKm(a, b), max, caution: caution / (count || 1), avoid: avoid / (count || 1), rating };
}

function clearRoute() {
  points = []; routeSource.clear();
  ['s-dist','s-max','s-share','rating'].forEach(id => document.getElementById(id).textContent = '–');
}
document.getElementById('reset').addEventListener('click', clearRoute);

map.on('singleclick', evt => {
  const hit = map.forEachFeatureAtPixel(evt.pixel, f => f.get('stop') ? f : null,
    { layerFilter: l => l === stopsLayer });
  if (hit) {
    const s = hit.get('stop');
    document.getElementById('stop-info').textContent = s.name + ': ' + s.note;
    return;
  }
  if (points.length === 2) clearRoute();
  points.push(evt.coordinate);
  routeSource.addFeature(new ol.Feature({ geometry: new ol.geom.Point(evt.coordinate), kind: 'pt' }));
  if (points.length === 2) {
    routeSource.addFeature(new ol.Feature({ geometry: new ol.geom.LineString(points), kind: 'line' }));
    const r = summarize(points[0], points[1]);
    document.getElementById('s-dist').textContent = r.dist.toFixed(1) + ' km';
    document.getElementById('s-max').textContent = r.max.toFixed(0) + '°';
    document.getElementById('s-share').textContent = (r.caution*100).toFixed(0) + '% / ' + (r.avoid*100).toFixed(0) + '%';
    const el = document.getElementById('rating');
    el.textContent = r.rating;
    el.style.color = r.rating === 'Safe' ? '#3fae5a' : r.rating === 'Caution' ? '#e6ca2e' : '#d04030';
  }
});