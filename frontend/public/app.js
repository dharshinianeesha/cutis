'use strict';

const element = id => document.getElementById(id);
const API_BASE = String(window.CUTIS_API_BASE || location.origin).replace(/\/$/, '');
const tokenKey = 'cutis_token';
const reminderSlots = ['morning', 'evening'];
const waterGoal = 8;
let token = localStorage.getItem(tokenKey);
let user;
let options;
let latestScan;
let activeScan;
let historyFailed = false;
let activeScreen = 'dashboard';
let analysisRequest = 0;
let loginPending = false;
let authConfig;
let authMode = 'login';
let verificationEmail = '';

async function api(path, method = 'GET', body) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(API_BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'The server could not complete the request.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function showStatus(id, message, error = false) {
  const node = element(id);
  node.textContent = message;
  node.toggleAttribute('data-error', error);
}

function toast(message) {
  const item = document.createElement('div');
  item.className = 'toast';
  item.textContent = message;
  element('toast-stack').append(item);
  setTimeout(() => item.remove(), 10000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[char]);
}

async function initGoogleButton() {
  const retry = element('google-retry');
  retry.hidden = true;
  showStatus('google-status', 'Loading sign-in...');
  try {
    authConfig = await api('/api/auth/config');
    renderAuth();
    if (!authConfig.googleClientId) {
      showStatus('google-status', authConfig.passwordAuth ? '' : 'Sign-in setup is pending.');
      return;
    }
    if (!window.google?.accounts?.id) await loadScript('https://accounts.google.com/gsi/client', 'Google sign-in could not load.');
    window.google.accounts.id.initialize({ client_id: authConfig.googleClientId, callback: signIn });
    renderGoogleButton();
    showStatus('google-status', '');
  } catch (error) {
    showStatus('google-status', error.message || 'Could not connect to Cutis.', true);
    retry.hidden = false;
  }
}

function renderGoogleButton() {
  const slot = element('google-btn-slot');
  slot.hidden = Boolean(verificationEmail);
  if (slot.hidden || !authConfig?.googleClientId || !window.google?.accounts?.id) return;
  slot.replaceChildren();
  window.google.accounts.id.renderButton(slot, {
    theme:'outline', size:'large', text:authMode === 'register' ? 'signup_with' : 'signin_with',
    width:Math.min(340, slot.clientWidth)
  });
}

function renderAuth() {
  const signingUp = authMode === 'register';
  const verifying = Boolean(verificationEmail);
  document.querySelectorAll('[data-auth]').forEach(button => {
    button.setAttribute('aria-pressed', button.dataset.auth === authMode);
  });
  element('auth-title').textContent = verifying ? 'Check your email' : signingUp ? 'Create your account' : 'Welcome back';
  element('login-description').textContent = verifying ? 'Enter the six-digit code sent to ' + verificationEmail + '.'
    : signingUp ? 'Create an account to save your skin profile and scan history.' : 'Sign in to your Cutis account.';
  element('account-form').hidden = verifying || !(signingUp ? authConfig?.passwordSignup : authConfig?.passwordAuth);
  element('auth-name-row').hidden = !signingUp;
  element('auth-name').required = signingUp;
  element('auth-password').autocomplete = signingUp ? 'new-password' : 'current-password';
  element('auth-password').minLength = signingUp ? 6 : 1;
  element('auth-submit').textContent = signingUp ? 'Create account' : 'Sign in';
  element('verification-form').hidden = !verifying;
  if (signingUp && authConfig?.passwordAuth && !authConfig.passwordSignup && !verifying) {
    showStatus('auth-status', authConfig.googleClientId
      ? 'Email sign-up is pending setup. You can create your account with Google.'
      : 'Email sign-up is pending setup.');
  }
}

function setAuthMode(mode) {
  if (loginPending) return;
  authMode = mode;
  verificationEmail = '';
  element('auth-code').value = '';
  element('auth-password').value = '';
  showStatus('auth-status', '');
  renderAuth();
  renderGoogleButton();
}

async function acceptSession(data) {
  if (!data.token || !data.user) throw new Error('Could not start your Cutis session.');
  token = data.token;
  localStorage.setItem(tokenKey, token);
  element('auth-password').value = '';
  await enterApp(data.user);
}

async function submitAccount(event) {
  event.preventDefault();
  if (loginPending) return;
  loginPending = true;
  const button = element('auth-submit');
  button.disabled = true;
  const signingUp = authMode === 'register';
  showStatus('auth-status', signingUp ? 'Creating account...' : 'Signing in...');
  try {
    const fields = {email:element('auth-email').value.trim(), password:element('auth-password').value};
    if (signingUp) fields.fullName = element('auth-name').value.trim();
    const data = await api('/api/auth/' + authMode, 'POST', fields);
    if (data.requiresVerification) {
      verificationEmail = data.email;
      element('auth-password').value = '';
      renderAuth();
      renderGoogleButton();
      showStatus('auth-status', 'Enter the code to continue.');
      element('auth-code').focus();
    } else {
      await acceptSession(data);
    }
  } catch (error) {
    showStatus('auth-status', error.message, true);
  } finally {
    loginPending = false;
    button.disabled = false;
  }
}

async function verifyAccount(event) {
  event.preventDefault();
  if (loginPending || !verificationEmail) return;
  loginPending = true;
  element('verify-submit').disabled = true;
  showStatus('auth-status', 'Verifying email...');
  try {
    await acceptSession(await api('/api/auth/verify-otp', 'POST', {
      email:verificationEmail, code:element('auth-code').value
    }));
  } catch (error) {
    showStatus('auth-status', error.message, true);
  } finally {
    loginPending = false;
    element('verify-submit').disabled = false;
  }
}

async function signIn({credential}) {
  if (loginPending) return;
  loginPending = true;
  showStatus('google-status', 'Signing in...');
  try {
    await acceptSession(await api('/api/auth/google', 'POST', { credential }));
  } catch (error) {
    showStatus('google-status', error.message || 'Sign-in failed. Please try again.', true);
  } finally {
    loginPending = false;
  }
}

function signOut() {
  stopCamera();
  localStorage.removeItem(tokenKey);
  window.google?.accounts?.id?.disableAutoSelect();
  location.reload();
}

async function enterApp(account) {
  options = await api('/api/recommend/routine');
  user = account;
  populateOptions();
  fillProfile();
  fillDashboardForm();
  fillLocationForm();
  fillReminderForm();
  renderAccount();
  renderSavedScan();
  renderWater();
  element('today').textContent = new Date().toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });
  element('login-screen').hidden = true;
  element('app-shell').hidden = false;
  if (profileComplete()) {
    element('dashboard-routine-text').textContent = 'Loading your saved recommendations...';
    element('product-content').textContent = 'Loading your saved recommendations...';
  }
  loadScanHistory();
  checkReminders();
  refreshWeather();
}

function navigate(screen, focus) {
  if (activeScreen === 'scan' && screen !== 'scan') stopCamera();
  activeScreen = screen;
  document.querySelectorAll('.screen').forEach(node => { node.hidden = node.id !== 'screen-' + screen; });
  document.querySelectorAll('[data-nav]').forEach(button => {
    if (button.dataset.nav === screen) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  if (focus) {
    const target = element(focus);
    target.scrollIntoView({block:'start'});
    target.querySelector('input')?.focus({preventScroll:true});
  }
}

function selectOptions(id, values, prompt) {
  const list = element(id);
  list.replaceChildren(new Option(prompt, ''));
  Object.entries(values).forEach(([value, label]) => list.add(new Option(label, value)));
}
function populateOptions() {
  const skinTypes = Object.fromEntries(options.skinTypes.map(type => [type, type]));
  for (const id of ['dashboard-skin', 'profile-skin']) selectOptions(id, skinTypes, 'Choose skin type');
  for (const id of ['dashboard-weather', 'profile-weather', 'location-weather']) selectOptions(id, options.weather, 'Choose weather');
  selectOptions('profile-gender', Object.fromEntries(options.genders.map(gender => [gender, gender])), 'Select if you wish');
  const labels = Object.entries(options.concerns).map(([key, title]) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = key;
    label.append(input, document.createTextNode(title));
    return label;
  });
  element('profile-concerns').replaceChildren(...labels);
}
function fillDashboardForm() {
  element('dashboard-skin').value = user.skinType;
  element('dashboard-weather').value = user.weather;
}
function fillLocationForm() {
  element('location-label').value = user.location;
  element('location-weather').value = user.weather;
}
function fillProfile() {
  element('profile-name').value = user.fullName;
  element('profile-age').value = user.age ?? '';
  element('profile-gender').value = user.gender;
  element('profile-skin').value = user.skinType;
  element('profile-weather').value = user.weather;
  element('profile-location').value = user.location;
  element('profile-shaves').checked = user.shavesFace;
  document.querySelectorAll('#profile-concerns input').forEach(input => { input.checked = user.concerns.includes(input.value); });
}
function fillReminderForm() {
  for (const slot of reminderSlots) element('reminder-' + slot).value = user.reminderTimes[slot];
}
function renderAccount() {
  const names = user.fullName.trim().split(/\s+/);
  element('greeting').textContent = 'Welcome, ' + names[0];
  element('account-name').textContent = user.fullName;
  element('account-avatar').textContent = names.slice(0, 2).map(name => name[0]).join('').toUpperCase();
  const fields = {
    Email: user.identifier,
    Age: user.age ?? 'Add your age',
    Gender: user.gender || 'Optional',
    'Skin type': user.skinType,
    Location: user.location || 'Not set',
    Weather: options.weather[user.weather],
    Concerns: user.concerns.map(key => options.concerns[key]).join(', ') || 'None selected'
  };
  element('profile-summary').innerHTML = Object.entries(fields).map(([label, value]) =>
    '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + '</dd></div>'
  ).join('');
  const slots = reminderSlots.filter(slot => user.reminderTimes[slot]).map(slot => {
    const [hour, minute] = user.reminderTimes[slot].split(':');
    const date = new Date(2000, 0, 1, Number(hour), Number(minute));
    return slot[0].toUpperCase() + slot.slice(1) + ' ' + date.toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'});
  });
  element('dashboard-reminders').textContent = slots.join(' · ') || 'Set times that fit your day.';
  element('dashboard-location').textContent = user.location ? 'Saved location · ' + user.location : '';
  renderWeatherSummary();
}

async function saveProfile(fields, form, status) {
  if (locationBusy && ('weather' in fields || 'location' in fields)) {
    showStatus(status, 'Wait for the weather lookup to finish.');
    return false;
  }
  const button = element(form);
  button.disabled = true;
  showStatus(status, 'Saving profile...');
  try {
    const result = await api('/api/users/me', 'PATCH', fields);
    for (const key of Object.keys(fields)) user[key] = result.user[key];
    if ('location' in fields || 'weather' in fields) {
      user.weatherReading = result.user.weatherReading;
      if (!user.weatherReading) liveWeatherCoordinates = null;
    }
    fillDashboardForm();
    fillProfile();
    fillLocationForm();
    renderAccount();
    showStatus(status, 'Profile saved.');
    showRoutine();
    return true;
  } catch (error) {
    showStatus(status, error.message, true);
    return false;
  } finally {
    button.disabled = false;
  }
}
function profileComplete() {
  return Number.isInteger(user?.age) && user.age >= 13 && options.skinTypes.includes(user.skinType);
}
async function saveDashboard(event) {
  event.preventDefault();
  const weather = element('dashboard-weather').value;
  const fields = { skinType: element('dashboard-skin').value };
  if (weather !== user.weather) fields.weather = weather;
  if (!profileComplete()) {
    element('profile-skin').value = fields.skinType;
    element('profile-weather').value = weather;
    showStatus('profile-status', 'Add your age and any concerns, then save to start your analysis.');
    navigate('profile');
    element('profile-age').focus();
    return;
  }
  if (await saveProfile(fields, 'dashboard-save', 'dashboard-status')) navigate('products');
}

let locationBusy = false;
let pendingWeather = null;
let liveWeatherCoordinates = null;
let lastWeatherAttempt = 0;
const weatherRefreshMs = 15 * 60 * 1000;

function weatherCondition(code) {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code < 50) return 'Fog';
  if (code < 60) return 'Drizzle';
  if (code < 70) return 'Rain';
  if (code < 80) return 'Snow';
  if (code < 85) return 'Showers';
  if (code < 90) return 'Snow showers';
  return 'Thunderstorms';
}

function renderWeatherSummary() {
  const reading = user.weatherReading;
  const place = user.location?.split(',')[0] || 'Set location';
  const button = element('weather-summary');
  const stale = reading && Date.now() - Date.parse(reading.observedAt) > 30 * 60 * 1000;
  const values = element('weather-summary-values');
  values.hidden = !reading;
  values.textContent = reading ? '· ' + Math.round(reading.temperature) + '°C · ' + Math.round(reading.humidity) + '% RH' : '';
  element('weather-summary-text').textContent = place + (stale ? ' (saved)' : '');
  button.title = reading ? place + ' ' + values.textContent + ' · ' + weatherCondition(reading.code) + ' · ' +
    new Date(reading.observedAt).toLocaleString() + ' · Open-Meteo' : 'Open location and weather';
  renderWeatherDetails(pendingWeather?.weatherReading || reading, pendingWeather?.label || user.location, Boolean(pendingWeather));
}

function renderWeatherDetails(reading, label, pending = false) {
  element('weather-metrics').hidden = !reading;
  element('saved-weather-detail').textContent = reading
    ? label + ' · ' + new Date(reading.observedAt).toLocaleString() + (pending ? ' · Unsaved' : '')
    : 'No live reading saved yet.';
  if (!reading) return;
  element('weather-temperature').textContent = Math.round(reading.temperature) + '°C';
  element('weather-humidity').textContent = Math.round(reading.humidity) + '% RH';
  element('weather-condition').textContent = weatherCondition(reading.code);
}

async function fetchWeather(coords, cityId) {
  const query = new URLSearchParams({
    latitude: coords.latitude.toFixed(2),
    longitude: coords.longitude.toFixed(2),
    current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
    timeformat: 'unixtime'
  });
  const response = await fetch('https://api.open-meteo.com/v1/forecast?' + query, {signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error('Weather lookup failed.');
  const {current} = await response.json();
  const {temperature_2m:temp, relative_humidity_2m:humidity, wind_speed_10m:wind, weather_code:code, time} = current;
  if (![temp, humidity, wind, time].every(Number.isFinite) || !Number.isInteger(code)) throw new Error('Weather readings were unavailable.');
  const weather = temp < 16 && humidity < 55 ? 'cold'
    : temp >= 27 && humidity >= 65 ? 'humid'
    : temp >= 27 && code <= 2 ? 'sunny'
    : humidity < 40 || (humidity < 50 && wind >= 22) ? 'dry' : 'mild';
  return { weather, weatherReading:{ temperature:temp, humidity, code, observedAt:new Date(time * 1000).toISOString(), cityId } };
}

async function commitLiveWeather(fields, coords) {
  const previousWeather = user.weather;
  const previousLocation = user.location;
  const {user: saved} = await api('/api/users/me', 'PATCH', fields);
  liveWeatherCoordinates = coords;
  for (const id of ['dashboard-weather', 'profile-weather', 'location-weather']) {
    if (element(id).value === previousWeather) element(id).value = saved.weather;
  }
  for (const id of ['profile-location', 'location-label']) {
    if (element(id).value === previousLocation) element(id).value = saved.location;
  }
  user.weather = saved.weather;
  user.location = saved.location;
  user.weatherReading = saved.weatherReading;
  renderAccount();
  if (previousWeather !== user.weather || previousLocation !== user.location) showRoutine();
}

async function refreshWeather() {
  if (!user || document.hidden || locationBusy || activeScreen === 'location' || activeScreen === 'profile') return;
  renderWeatherSummary();
  const cityId = user.weatherReading?.cityId;
  if ((!cityId && !liveWeatherCoordinates) || Date.now() - lastWeatherAttempt < weatherRefreshMs ||
      Date.now() - Date.parse(user.weatherReading?.observedAt) < weatherRefreshMs) return;
  lastWeatherAttempt = Date.now();
  locationBusy = true;
  try {
    let coords = liveWeatherCoordinates;
    if (!coords) {
      const response = await fetch('https://geocoding-api.open-meteo.com/v1/get?id=' + cityId, {signal:AbortSignal.timeout(10000)});
      if (!response.ok) return;
      coords = await response.json();
    }
    const reading = await fetchWeather(coords, cityId);
    await commitLiveWeather({ location:user.location, ...reading }, coords);
  } catch {
    // Keep the last saved reading and show its age when a refresh fails.
  } finally {
    locationBusy = false;
  }
}


async function getPlaceName(coords) {
  const params = new URLSearchParams({
    lat: coords.latitude,
    lon: coords.longitude,
    format: 'json'
  });

  const response = await fetch(
    'https://nominatim.openstreetmap.org/reverse?' + params,
    { signal: AbortSignal.timeout(10000) }
  );

  if (!response.ok) {
    throw new Error('Location lookup failed.');
  }

  const data = await response.json();
  const address = data.address || {};

  const city =
    address.city ||
    address.town ||
    address.village ||
    address.suburb ||
    address.county;

  return [
    city,
    address.state,
    address.country
  ].filter(Boolean).join(', ') || 'Current location';
}





async function lookupWeather(label, getCoordinates, {saveNow = false, cityId} = {}) {
  if (locationBusy) return;
  locationBusy = true;
  pendingWeather = null;
  renderWeatherSummary();
  const buttons = [element('use-local-weather'), element('live-location')];
  buttons.forEach(button => { button.disabled = true; });
  const status = saveNow ? 'live-weather-status' : 'location-status';
  showStatus(status, 'Checking local weather...');
  try {
    const coords = await getCoordinates();
    const placeName = await getPlaceName(coords);
    const reading = await fetchWeather(coords, cityId);
    if (saveNow) {
      await commitLiveWeather({ location:placeName, ...reading }, coords);
      fillLocationForm();
      showStatus(status, '');
    } else {
      pendingWeather = { label: placeName, coords, ...reading };
      element('location-label').value = placeName;
      element('location-weather').value = reading.weather;
      renderWeatherDetails(reading.weatherReading, placeName, true);
      showStatus(status, label + ' · ' + Math.round(reading.weatherReading.temperature) + '°C · ' +
        Math.round(reading.weatherReading.humidity) + '% humidity. Save to update your routine.');
    }
  } catch (error) {
    showStatus(status, error.code === 1 ? 'Location permission was declined. Choose a city instead.' :
      'Could not update live weather. You can choose a city or set the weather manually.', true);
  } finally {
    buttons.forEach(button => { button.disabled = false; });
    locationBusy = false;
  }
}

function useLocalWeather(saveNow = false) {
  if (!navigator.geolocation) {
    showStatus(saveNow ? 'live-weather-status' : 'location-status', 'Location is unavailable here. Search for your city or enter it manually.', true);
    return;
  }
  lookupWeather('Current location', () => new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(position => resolve(position.coords), reject, { timeout:10000, maximumAge:300000 });
  }), {saveNow});
}

function updateThemeControl() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const button = element('theme-toggle');
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.querySelector('use').setAttribute('href', dark ? '#icon-sun' : '#icon-moon');
  document.querySelector('meta[name="theme-color"]').content = dark ? '#141b25' : '#202b39';
}

function toggleTheme() {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('cutis_theme', root.dataset.theme);
  updateThemeControl();
}

async function searchLocations(event) {
  event.preventDefault();
  const search = element('location-search').value.trim();
  if (search.length < 2) return;
  const button = element('search-location');
  const results = element('location-results');
  results.replaceChildren();
  button.disabled = true;
  showStatus('location-status', 'Searching for places...');
  try {
    const params = new URLSearchParams({name:search, count:5, language:'en'});
    const response = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + params, {signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('City search failed.');
    const data = await response.json();
    const places = (data.results || []).filter(place => place.name && Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
    for (const place of places) {
      const label = [...new Set([place.name, place.admin1, place.country].filter(Boolean))].join(', ').slice(0, 120);
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'button secondary';
      choice.textContent = label;
      choice.addEventListener('click', () => lookupWeather(label, () => place, {cityId:place.id}));
      results.append(choice);
    }
    showStatus('location-status', places.length ? 'Choose a place to check its weather.' : 'No results. Try a different city name or enter it manually.');
  } catch (error) {
    showStatus('location-status', 'City search is unavailable. Enter your location manually.', true);
  } finally {
    button.disabled = false;
  }
}

async function saveLocation(event) {
  event.preventDefault();
  if (locationBusy) {
    showStatus('location-save-status', 'Wait for the weather lookup to finish.');
    return;
  }
  const location = element('location-label').value.trim();
  const weather = element('location-weather').value;
  const match = pendingWeather?.label === location && pendingWeather.weather === weather ? pendingWeather : null;
  if (location === user.location && weather === user.weather && !match) return;
  const fields = { location, weather };
  if (match) fields.weatherReading = match.weatherReading;
  if (await saveProfile(fields, 'location-save', 'location-save-status')) {
    liveWeatherCoordinates = match?.coords || null;
    pendingWeather = null;
    renderWeatherSummary();
    showStatus('live-weather-status', '');
  }
}
async function saveFullProfile(event) {
  event.preventDefault();
  const fields = {
    fullName: element('profile-name').value,
    age: element('profile-age').valueAsNumber,
    gender: element('profile-gender').value,
    skinType: element('profile-skin').value,
    shavesFace: element('profile-shaves').checked,
    concerns: [...document.querySelectorAll('#profile-concerns input:checked')].map(input => input.value)
  };
  if (element('profile-weather').value !== user.weather) fields.weather = element('profile-weather').value;
  if (element('profile-location').value.trim() !== user.location) fields.location = element('profile-location').value.trim();
  if (await saveProfile(fields, 'profile-save', 'profile-status')) navigate('products');
}

function renderWater() {
  const glasses = element('hydra-glasses');
  glasses.replaceChildren();
  element('hydra-count').textContent = user.hydrationCount + ' / ' + waterGoal;
  for (let count = 1; count <= waterGoal; count++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'glass';
    button.textContent = count;
    button.setAttribute('aria-label', 'Log ' + count + (count === 1 ? ' glass' : ' glasses'));
    button.setAttribute('aria-pressed', count <= user.hydrationCount);
    button.addEventListener('click', () => saveWater(count === user.hydrationCount ? count - 1 : count));
    glasses.append(button);
  }
}
async function saveWater(count) {
  element('hydra-glasses').querySelectorAll('button').forEach(button => { button.disabled = true; });
  showStatus('hydra-status', 'Saving...');
  try {
    const {user: saved} = await api('/api/users/me', 'PATCH', {hydrationCount:count});
    user.hydrationCount = saved.hydrationCount;
    showStatus('hydra-status', 'Water intake saved.');
  } catch (error) {
    showStatus('hydra-status', 'Could not save water intake. Try again.', true);
  } finally {
    renderWater();
  }
}

async function saveReminders(event) {
  event.preventDefault();
  const button = element('reminder-save');
  button.disabled = true;
  showStatus('reminder-status', 'Saving reminder times...');
  try {
    const reminderTimes = Object.fromEntries(reminderSlots.map(slot => [slot, element('reminder-' + slot).value]));
    const {user: saved} = await api('/api/users/me', 'PATCH', {reminderTimes});
    user.reminderTimes = saved.reminderTimes;
    renderAccount();
    showStatus('reminder-status', 'Reminders saved.');
    checkReminders();
  } catch (error) {
    showStatus('reminder-status', error.message, true);
  } finally {
    button.disabled = false;
  }
}
function checkReminders(now = new Date()) {
  if (!user || document.hidden) return;
  const time = [now.getHours(), now.getMinutes()].map(n => String(n).padStart(2, '0')).join(':');
  for (const slot of reminderSlots) {
    if (user.reminderTimes[slot] !== time) continue;
    const key = ['cutis-reminder', user.id, slot].join(':');
    const occurrence = now.toDateString() + ' ' + time;
    if (sessionStorage.getItem(key) === occurrence) continue;
    sessionStorage.setItem(key, occurrence);
    toast('Time for your ' + slot + ' skincare routine.');
  }
}

function scanMetrics(scan) {
  const entries = [
    ['Hydration estimate', scan.hydration + '%'],
    ['Shine estimate', scan.oilLevel + '%'],
    ['Redness estimate', scan.redness + '%']
  ];
  return entries.map(([label, value]) =>
    '<div><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>'
  ).join('');
}
function renderSavedScan() {
  const empty = historyFailed ? 'Saved scans could not be loaded. Refresh to try again.' : 'No saved scan yet.';
  element('profile-scan').innerHTML = latestScan ? '<div class="metrics">' + scanMetrics(latestScan) + '</div><p>Photo-estimated skin type · ' +
    escapeHtml(latestScan.detectedSkinType) + '</p>' : '<p>' + empty + '</p>';
  element('latest-hydration').textContent = latestScan ? latestScan.hydration + '%' : '—';
  element('latest-scan-detail').textContent = latestScan
    ? 'Saved ' + new Date(latestScan.createdAt).toLocaleDateString() + ' · photo-based estimate'
    : historyFailed ? empty : 'Take a face scan to add a photo-based estimate.';
}
async function loadScanHistory() {
  try {
    const {results} = await api('/api/scan/history?limit=1');
    const saved = results[0];
    if (!latestScan && saved) {
      latestScan = saved;
    }
  } catch (error) {
    historyFailed = true;
  }
  renderSavedScan();
  if (!activeScan) showRoutine();
}

function routineMarkup(result) {
  const e = escapeHtml;
  const steps = result.products.map(({step, product}) => '<li><h3>' + e(step) + '</h3><p>' + e(product) + '</p></li>').join('');
  const cues = result.scanCues.map(({label,value}) => e(label) + ' · ' + e(value) + '%').join(' &nbsp; / &nbsp; ');
  return '<section class="card"><div class="routine-heading"><span class="badge">Profile + scan match</span><h2>' + e(result.skinType) +
    ' skin routine</h2><p>' + e([user.location, result.weather].filter(Boolean).join(' · ')) + '</p></div>' +
    '<div class="match-evidence"><strong>' + e(result.focus) + '</strong><p>' + cues + '</p></div><ol class="routine-list">' + steps + '</ol>' +
    '<div class="routine-notes"><section><h3>Weather adjustment</h3><p>' + e(result.weatherNote) +
    '</p></section><section><h3>Profile guidance</h3><p>' + e(result.ageNote) + '</p>' +
    (result.groomingNote ? '<p>' + e(result.groomingNote) + '</p>' : '') +
    '</section><section><h3>Everyday habits</h3><ul>' + result.habits.map(habit => '<li>' + e(habit) + '</li>').join('') + '</ul></section></div>' +
    '<p class="fine-print">Photo readings are estimates. Introduce new products one at a time and patch-test first. ' +
    '<a href="https://www.aad.org/public/everyday-care/skin-care-secrets/prevent-skin-problems/test-skin-care-products/" target="_blank" rel="noopener">How to patch-test</a></p></section>';
}

async function showRoutine() {
  const requestId = ++analysisRequest;
  const products = element('product-content');
  const scanProducts = element('scan-products');
  const dashboard = element('dashboard-routine-text');
  function paint(markup, text, title = 'Your skincare routine') {
    products.innerHTML = markup;
    if (activeScan?._id) scanProducts.innerHTML = markup;
    dashboard.textContent = text;
    element('profile-routine-text').textContent = text;
    element('dashboard-routine-title').textContent = title;
  }
  const states = {
    needs_profile: ['Choose your skin type', 'Save a specific skin type in your profile to qualify for product matches.', 'profile', 'Open profile'],
    needs_scan: ['Save a face scan', 'Your selected skin type is ready. Complete a face scan to look for product matches.', 'scan', 'Open face scan'],
    no_match: ['No targeted match', 'Your saved scan did not show elevated redness, lower hydration, or elevated shine in Cutis’s matching ranges.', 'scan', 'View face scan']
  };
  paint('<p class="card">Checking your saved profile and face scan...</p>', 'Checking your profile and scan...');
  try {
    const data = await api('/api/recommend/routine', 'POST', { scanId:activeScan?._id });
    if (requestId !== analysisRequest) return;
    if (data.state !== 'matched') {
      const [title, text, screen, action] = states[data.state];
      paint('<section class="card match-empty"><span class="badge">Profile + scan</span><h2>' + title +
        '</h2><p>' + text + '</p><button type="button" class="button primary" data-go="' + screen + '">' + action + '</button></section>', text, title);
      return;
    }
    paint(routineMarkup(data), 'Matched to your ' + data.skinType.toLowerCase() + ' skin profile and ' + data.focus.toLowerCase() + '.', data.skinType + ' skin routine');
  } catch (error) {
    if (requestId !== analysisRequest) return;
    paint('<section class="card"><p>Product recommendations could not load.</p><button type="button" class="button secondary" data-retry-routine>Try again</button></section>',
      'Product recommendations could not load. Open Products to try again.');
  }
}

let camStream;
let openingCamera = false;
let capturing = false;
function stopCamera() {
  camStream?.getTracks().forEach(track => track.stop());
  camStream = undefined;
  const video = element('cam-video');
  video.srcObject = null;
  video.hidden = true;
  element('camera-placeholder').hidden = false;
  element('guide-overlay').hidden = true;
  element('scan-controls').hidden = true;
  showStatus('camera-status', '');
}
async function startCamera() {
  if (openingCamera || camStream) return;
  openingCamera = true;
  const button = element('camera-start');
  button.disabled = true;
  showStatus('camera-status', 'Opening camera...');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost.');
    const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'}});
    if (activeScreen !== 'scan') {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    camStream = stream;
    const video = element('cam-video');
    video.srcObject = stream;
    video.hidden = false;
    element('camera-placeholder').hidden = true;
    element('guide-overlay').hidden = false;
    element('scan-controls').hidden = false;
    showStatus('camera-status', 'Center your face inside the guide.');
    loadFaceDetector().catch(() => {});
    loadSkinModel();
  } catch (error) {
    showStatus('camera-status', error.name === 'NotAllowedError' ? 'Allow camera access in your browser and try again.' : error.message, true);
  } finally {
    button.disabled = false;
    openingCamera = false;
  }
}
async function captureFace() {
  const stream = camStream;
  const video = element('cam-video');
  if (!stream || capturing) return;
  if (!video.videoWidth || !video.videoHeight) {
    showStatus('camera-status', 'Wait for the preview to appear, then capture again.');
    return;
  }
  capturing = true;
  const button = element('camera-capture');
  button.disabled = true;
  showStatus('camera-status', 'Detecting your face. The first scan may take a moment...');
  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const detector = await loadFaceDetector();
    const faces = await detector.estimateFaces(canvas, {flipHorizontal:false});
    if (camStream !== stream) return;
    if (faces.length !== 1) throw new Error('Keep exactly one face in view, then capture again.');
    const {xMin, yMin, width, height} = faces[0].box;
    const x = Math.max(0, Math.floor(xMin + width * .15));
    const y = Math.max(0, Math.floor(yMin + height * .18));
    const w = Math.min(canvas.width - x, Math.floor(width * .7));
    const h = Math.min(canvas.height - y, Math.floor(height * .65));
    if (w < 60 || h < 60) throw new Error('Move closer to the camera and try again.');
    const face = document.createElement('canvas');
    face.width = w;
    face.height = h;
    const context = face.getContext('2d');
    context.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    const reading = analyzeSkinFromImageData(context.getImageData(0, 0, w, h));
    if (!reading) throw new Error('Could not read the face area. Please capture again.');
    stopCamera();
    saveScan({
      hydration: reading.hydration, oilLevel: reading.oil, redness: reading.redness,
      ita: reading.ita, detectedSkinType: estimateSkinType(reading, face)
    });
  } catch (error) {
    if (camStream === stream) showStatus('camera-status', error.message || 'The scan could not run. Please try again.', true);
  } finally {
    capturing = false;
    button.disabled = false;
  }
}

async function saveScan(reading) {
  activeScan = reading;
  element('analysis-result').hidden = false;
  element('scan-metrics').innerHTML = scanMetrics(reading);
  showStatus('scan-save-status', 'Saving scan...');
  element('scan-products').textContent = 'Product matching starts once your scan is saved.';
  try {
    const {result} = await api('/api/scan', 'POST', reading);
    if (!latestScan || new Date(result.createdAt) >= new Date(latestScan.createdAt)) latestScan = result;
    renderSavedScan();
    if (activeScan === reading) {
      activeScan = result;
      showStatus('scan-save-status', 'Scan saved · photo-estimated skin type: ' + reading.detectedSkinType);
      showRoutine();
    }
  } catch (error) {
    if (activeScan === reading) {
      showStatus('scan-save-status', 'Scan could not be saved. Capture it again to get matches for this reading.', true);
      element('scan-products').replaceChildren();
    }
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.nav || button.dataset.go) navigate(button.dataset.nav || button.dataset.go, button.dataset.focus);
  if (button.dataset.auth) setAuthMode(button.dataset.auth);
  if (button.hasAttribute('data-retry-routine')) showRoutine();
});
element('google-retry').addEventListener('click', initGoogleButton);
element('account-form').addEventListener('submit', submitAccount);
element('verification-form').addEventListener('submit', verifyAccount);
element('verify-back').addEventListener('click', () => setAuthMode(authMode));
element('logout').addEventListener('click', signOut);
element('dashboard-form').addEventListener('submit', saveDashboard);
element('use-local-weather').addEventListener('click', () => useLocalWeather());
element('live-location').addEventListener('click', () => useLocalWeather(true));
element('theme-toggle').addEventListener('click', toggleTheme);
updateThemeControl();
element('location-search-form').addEventListener('submit', searchLocations);
element('location-form').addEventListener('submit', saveLocation);
element('profile-form').addEventListener('submit', saveFullProfile);
element('reminders').addEventListener('submit', saveReminders);
element('camera-start').addEventListener('click', startCamera);
element('camera-stop').addEventListener('click', stopCamera);
element('camera-capture').addEventListener('click', captureFace);
document.addEventListener('visibilitychange', () => { checkReminders(); refreshWeather(); });
window.addEventListener('pagehide', stopCamera);
setInterval(checkReminders, 15000);
setInterval(refreshWeather, 60000);

(async () => {
  if (token) {
    try {
      const data = await api('/api/auth/me');
      await enterApp(data.user);
      return;
    } catch (error) {
      if (error.status === 401 || error.status === 404) {
        token = null;
        localStorage.removeItem(tokenKey);
      }
    }
  }
  await initGoogleButton();
})();
