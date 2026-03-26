// ─── KALMAN FILTER ────────────────────────────────────────────────────────────
class KalmanFilter {
  constructor() { this.lat = null; this.lon = null; this.variance = -1; }
  process(lat, lon, accuracy) {
    const v = Math.max(accuracy, 3) ** 2;
    if (this.variance < 0) {
      this.lat = lat; this.lon = lon; this.variance = v;
    } else {
      this.variance += 15; // быстрее реагирует на движение
      const k = this.variance / (this.variance + v);
      this.lat += k * (lat - this.lat);
      this.lon += k * (lon - this.lon);
      this.variance *= (1 - k);
    }
    return { lat: this.lat, lon: this.lon };
  }
  reset() { this.lat = null; this.lon = null; this.variance = -1; }
}

// ─── STATE ────────────────────────────────────────────────────────────────────
let target        = null;
let currentPos    = null;
let deviceHeading = 0;
let smoothHeading = null;
let smoothArrow   = null;
let compassReady  = false;
let lastCompassMs = 0;
const kalman      = new KalmanFilter();

// ─── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const screenCompass   = $('screen-compass');
const enableCompassBtn= $('enableCompass');
const setPointBtn     = $('setPoint');
const clearPointBtn   = $('clearPoint');
const compassRing     = $('compass-ring');
const arrowWrap       = $('arrow-wrap');
const compassWrap     = $('compass-wrap');
const distanceWrap    = $('distance-wrap');
const distanceValue   = $('distance-value');
const distanceUnit    = $('distance-unit');
const gpsStatusEl     = $('gps-status');
const compassStatusEl = $('compass-status');
const accuracyLabel   = $('accuracy-label');

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init() {
  const saved = localStorage.getItem('target');
  if (saved) {
    target = JSON.parse(saved);
    showArrow();
  }
  startGPS();
  if (typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function') {
    showCompassBanner();
  } else {
    startCompass();
  }
}

function showCompassBanner() {
  const banner = document.createElement('button');
  banner.style.cssText = `
    position: fixed; inset: 0; width: 100%; height: 100%;
    background: #0a0a0f; border: none; cursor: pointer; z-index: 200;
    display: flex; align-items: center; justify-content: center;
  `;
  banner.innerHTML = '<span style="color:rgba(255,255,255,0.4);font-size:48px;font-family:sans-serif;letter-spacing:0.1em;">Тапни</span>';
  banner.addEventListener('click', () => {
    banner.remove();
    DeviceOrientationEvent.requestPermission()
      .then(res => { if (res === 'granted') startCompass(); })
      .catch(() => {});
  }, { once: true });
  document.body.appendChild(banner);
}

// ─── COMPASS ──────────────────────────────────────────────────────────────────
function startCompass() {
  window.addEventListener('deviceorientationabsolute', onOrientation, true);
  window.addEventListener('deviceorientation', onOrientation, true);
}

function lerpAngle(cur, tgt, f) {
  let d = tgt - cur;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return (cur + d * f + 360) % 360;
}

function onOrientation(e) {
  let h = null;
  if (e.webkitCompassHeading != null)       h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null)   h = (360 - e.alpha) % 360;
  else if (e.alpha != null)                 h = (360 - e.alpha) % 360;
  if (h === null) return;

  lastCompassMs = Date.now();
  smoothHeading = smoothHeading === null ? h : lerpAngle(smoothHeading, h, 0.15);
  deviceHeading = smoothHeading;

  if (!compassReady) {
    compassReady = true;
    compassStatusEl.classList.add('active');
  }

  updateArrow();
}

// ─── GPS ──────────────────────────────────────────────────────────────────────
function startGPS() {
  if (!navigator.geolocation) { alert('Геолокация не поддерживается'); return; }
  navigator.geolocation.watchPosition(pos => {
    const acc = pos.coords.accuracy;
    const f   = kalman.process(pos.coords.latitude, pos.coords.longitude, acc);
    currentPos = { lat: f.lat, lon: f.lon, accuracy: acc };
    gpsStatusEl.classList.add('active');
    updateAccuracyUI(acc);
    updateArrow();
  }, err => {
    console.error('GPS:', err);
    if (err.code === 1) {
      accuracyLabel.textContent = 'нет доступа';
    }
    gpsStatusEl.classList.remove('active', 'warn');
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
}

function updateAccuracyUI(acc) {
  const a = Math.round(acc);
  accuracyLabel.textContent = `±${a}м`;
  gpsStatusEl.classList.remove('active', 'warn');
  if (a <= 15)      gpsStatusEl.classList.add('active');
  else if (a <= 40) gpsStatusEl.classList.add('warn');
}

// ─── SET POINT ────────────────────────────────────────────────────────────────
setPointBtn.addEventListener('click', () => {
  if (!currentPos) {
    $('btn-text').textContent = 'Жду GPS...';
    navigator.geolocation.getCurrentPosition(pos => {
      const f = kalman.process(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      currentPos = { lat: f.lat, lon: f.lon, accuracy: pos.coords.accuracy };
      saveTarget();
    }, (err) => {
      $('btn-text').innerHTML = 'Поставить<br/>точку';
      if (err.code === 1) {
        alert('Разрешите доступ к геолокации:\nНастройки → Конфиденциальность → Службы геолокации → Safari/Kozlovich → При использовании');
      } else {
        alert('GPS недоступен. Выйдите на улицу и попробуйте снова.');
      }
    }, { enableHighAccuracy: true, timeout: 15000 });
    return;
  }
  saveTarget();
});

function saveTarget() {
  kalman.reset();
  movedAway = false;
  smoothArrow = null;
  target = { lat: currentPos.lat, lon: currentPos.lon };
  localStorage.setItem('target', JSON.stringify(target));
  distanceValue.textContent = '0';
  distanceUnit.textContent = 'м';
  showArrow();
  updateArrow();
}

// ─── CLEAR ────────────────────────────────────────────────────────────────────
clearPointBtn.addEventListener('click', () => {
  target = null;
  localStorage.removeItem('target');
  setPointBtn.classList.remove('hidden');
  compassWrap.classList.add('hidden');
  distanceWrap.classList.add('hidden');
  clearPointBtn.classList.add('hidden');
  $('btn-text').innerHTML = 'Поставить<br/>точку';
});

// ─── SHOW ARROW ───────────────────────────────────────────────────────────────
function showArrow() {
  setPointBtn.classList.add('hidden');
  compassWrap.classList.remove('hidden');
  distanceWrap.classList.remove('hidden');
  clearPointBtn.classList.remove('hidden');
}

let movedAway = false;

// ─── UPDATE ARROW ─────────────────────────────────────────────────────────────
function updateArrow() {
  if (!target || !currentPos) return;

  const dist = getDistance(currentPos.lat, currentPos.lon, target.lat, target.lon);
  const acc  = currentPos.accuracy || 20;

  // Считаем что отошли если дистанция > 20м
  if (dist > 20) movedAway = true;

  if (dist < 5 || dist < acc * 0.7) {
    if (movedAway) showArrived();
    return;
  }

  arrowWrap.style.opacity = '1';

  if (dist >= 1000) {
    distanceValue.textContent = (dist / 1000).toFixed(1);
    distanceUnit.textContent  = 'км';
  } else {
    distanceValue.textContent = Math.round(dist);
    distanceUnit.textContent  = 'м';
  }

  const bearing     = getBearing(currentPos.lat, currentPos.lon, target.lat, target.lon);
  const targetAngle = bearing - deviceHeading;

  if (smoothArrow === null) {
    smoothArrow = targetAngle;
  } else {
    let diff = targetAngle - smoothArrow;
    // Нормализуем в [-180, 180] — исключаем прыжок через 0/360
    diff = diff - Math.round(diff / 360) * 360;
    smoothArrow = smoothArrow + diff * 0.3;
  }

  arrowWrap.style.transform = `rotate(${smoothArrow}deg)`;
}

// ─── RAF ──────────────────────────────────────────────────────────────────────
;(function loop() {
  if (compassReady && Date.now() - lastCompassMs > 3000) {
    compassStatusEl.classList.remove('active');
    compassStatusEl.classList.add('warn');
  }
  requestAnimationFrame(loop);
})();

// ─── ARRIVED ──────────────────────────────────────────────────────────────────
let arrivedShown = false;
function showArrived() {
  if (arrivedShown) return;
  arrivedShown = true;
  const el = document.createElement('div');
  el.className = 'arrived-overlay';
  el.innerHTML = '<div class="arrived-text">Вы на месте!</div>';
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 50);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.remove(); arrivedShown = false; }, 500);
  }, 3000);
}

// ─── MATH ─────────────────────────────────────────────────────────────────────
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = d => d * Math.PI / 180;
  const a = Math.sin(r(lat2-lat1)/2)**2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2-lon1)/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getBearing(lat1, lon1, lat2, lon2) {
  const r = d => d * Math.PI / 180;
  const dL = r(lon2 - lon1);
  const y  = Math.sin(dL) * Math.cos(r(lat2));
  const x  = Math.cos(r(lat1)) * Math.sin(r(lat2)) -
    Math.sin(r(lat1)) * Math.cos(r(lat2)) * Math.cos(dL);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

// ─── SERVICE WORKER ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js');

init();