// ─── KALMAN FILTER ────────────────────────────────────────────────────────────
class KalmanFilter {
  constructor() { this.lat = null; this.lon = null; this.variance = -1; }

  process(lat, lon, accuracy) {
    const v = Math.max(accuracy, 3) ** 2;
    if (this.variance < 0) {
      this.lat = lat; this.lon = lon; this.variance = v;
    } else {
      this.variance += 3;
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
let deviceHeading = 0;       // сглаженный heading (куда смотрит телефон от севера)
let smoothHeading = null;    // для lerp
let smoothArrow   = null;    // сглаженный угол стрелки на цель
let compassReady  = false;
let gpsReady      = false;
let lastCompassMs = 0;
const kalman      = new KalmanFilter();

// ─── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const screenCompass    = $('screen-compass');
const screenMain       = $('screen-main');
const enableCompassBtn = $('enableCompass');
const setPointBtn      = $('setPoint');
const clearPointBtn    = $('clearPoint');
const compassRing      = $('compass-ring');   // вращающееся кольцо
const arrowWrap        = $('arrow-wrap');     // стрелка на цель
const arrowContainer   = $('arrow-container');
const noPoint          = $('no-point');
const distanceValue    = $('distance-value');
const distanceUnit     = $('distance-unit');
const coordsDisplay    = $('coords-display');
const gpsStatusEl      = $('gps-status');
const compassStatusEl  = $('compass-status');
const accuracyLabel    = $('accuracy-label');

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init() {
  const saved = localStorage.getItem('target');
  if (saved) { target = JSON.parse(saved); showArrow(); }

  const needsPermission =
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function';

  if (needsPermission) {
    screenCompass.classList.remove('hidden');
    screenMain.classList.add('hidden');
  } else {
    screenCompass.classList.add('hidden');
    screenMain.classList.remove('hidden');
    startCompass();
    startGPS();
  }
}

// ─── iOS PERMISSION ───────────────────────────────────────────────────────────
enableCompassBtn.addEventListener('click', () => {
  DeviceOrientationEvent.requestPermission()
    .then(res => {
      screenCompass.classList.add('hidden');
      screenMain.classList.remove('hidden');
      if (res === 'granted') startCompass();
      startGPS();
    })
    .catch(() => {
      screenCompass.classList.add('hidden');
      screenMain.classList.remove('hidden');
      startGPS();
    });
});

// ─── COMPASS ──────────────────────────────────────────────────────────────────
function startCompass() {
  window.addEventListener('deviceorientationabsolute', onOrientation, true);
  window.addEventListener('deviceorientation', onOrientation, true);
}

function onOrientation(e) {
  let h = null;

  // iOS — webkitCompassHeading: угол от магнитного севера (0=север, растёт по часовой)
  if (e.webkitCompassHeading != null) {
    h = e.webkitCompassHeading;
  }
  // Android absolute
  else if (e.absolute && e.alpha != null) {
    h = (360 - e.alpha) % 360; // alpha растёт против часовой → инвертируем
  }
  // Fallback
  else if (e.alpha != null) {
    h = (360 - e.alpha) % 360;
  }

  if (h === null) return;
  lastCompassMs = Date.now();

  // Lerp с нормализацией 359→0
  if (smoothHeading === null) {
    smoothHeading = h;
  } else {
    let d = h - smoothHeading;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    smoothHeading = (smoothHeading + d * 0.15 + 360) % 360;
  }
  deviceHeading = smoothHeading;

  // Кольцо вращается так, чтобы N всегда смотрел на север:
  // если телефон повёрнут на H градусов от севера → кольцо крутим на -H
  compassRing.style.transform = `rotate(${-deviceHeading}deg)`;

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

    if (!gpsReady) { gpsReady = true; }
    updateAccuracyUI(acc);
    updateArrow();
  }, err => {
    console.error('GPS:', err);
    gpsStatusEl.classList.remove('active', 'warn');
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
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
    }, () => {
      $('btn-text').textContent = 'Поставить точку';
      alert('Не удалось получить GPS');
    }, { enableHighAccuracy: true, timeout: 10000 });
    return;
  }
  saveTarget();
});

function saveTarget() {
  kalman.reset();
  target = { lat: currentPos.lat, lon: currentPos.lon };
  localStorage.setItem('target', JSON.stringify(target));
  $('btn-text').textContent = 'Обновить точку';
  showArrow();
  updateArrow();
}

// ─── CLEAR ────────────────────────────────────────────────────────────────────
clearPointBtn.addEventListener('click', () => {
  target = null;
  localStorage.removeItem('target');
  arrowContainer.classList.add('hidden');
  noPoint.classList.remove('hidden');
  clearPointBtn.classList.add('hidden');
  $('btn-text').textContent = 'Поставить точку';
});

// ─── SHOW ARROW ───────────────────────────────────────────────────────────────
function showArrow() {
  arrowContainer.classList.remove('hidden');
  noPoint.classList.add('hidden');
  clearPointBtn.classList.remove('hidden');
}

// ─── UPDATE ARROW ─────────────────────────────────────────────────────────────
function updateArrow() {
  if (!target || !currentPos) return;

  const dist = getDistance(currentPos.lat, currentPos.lon, target.lat, target.lon);
  const acc  = currentPos.accuracy || 20;

  // Расстояние меньше погрешности GPS — ненадёжно
  if (dist < acc * 0.7) {
    distanceValue.textContent = '~0';
    distanceUnit.textContent  = 'м';
    coordsDisplay.textContent = `⚠️ Вы в радиусе погрешности ±${Math.round(acc)}м`;
    arrowWrap.style.opacity   = '0.25';
    return;
  }

  arrowWrap.style.opacity = '1';

  // Дистанция
  if (dist >= 1000) {
    distanceValue.textContent = (dist / 1000).toFixed(1);
    distanceUnit.textContent  = 'км';
  } else {
    distanceValue.textContent = Math.round(dist);
    distanceUnit.textContent  = 'м';
  }

  coordsDisplay.textContent = `📍 ${target.lat.toFixed(5)}, ${target.lon.toFixed(5)}  ±${Math.round(acc)}м`;

  if (dist < 5) { showArrived(); return; }

  // Азимут на цель (от севера, по часовой)
  const bearing = getBearing(currentPos.lat, currentPos.lon, target.lat, target.lon);

  // Стрелка должна показывать на цель относительно экрана:
  // bearing — куда цель от севера
  // deviceHeading — куда смотрит верх телефона от севера
  // угол стрелки = bearing - deviceHeading
  const targetAngle = bearing - deviceHeading;

  // Lerp сглаживание
  if (smoothArrow === null) {
    smoothArrow = targetAngle;
  } else {
    let d = targetAngle - smoothArrow;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    smoothArrow += d * 0.2;
  }

  arrowWrap.style.transform = `rotate(${smoothArrow}deg)`;
}

// ─── RAF — следим за свежестью компаса ───────────────────────────────────────
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
  el.innerHTML = '<div class="arrived-text">✅ Вы на месте!</div>';
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