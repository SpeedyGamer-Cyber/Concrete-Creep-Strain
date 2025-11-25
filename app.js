"use strict";
/**
 * Creep Coefficient Calculator (EC2-style)
 * - Linear x-axis with {x,y} points (t0 → t)
 * - Cement class parameters exposed in details (var3, var4)
 * - Detailed Calculations panel with copy button
 */

// Cement-class dependent parameters
const cementParams = {
  S: { var3: -1, var4: 0.38 }, // Slow hardening
  N: { var3:  0, var4: 0.25 }, // Normal
  R: { var3:  1, var4: 0.20 }  // Rapid
};

let creepChart = null;

// ---------- Utilities ----------
function $(id){ return document.getElementById(id); }
function valNum(id){ const v = parseFloat($(id).value); return Number.isFinite(v) ? v : NaN; }
function clamp(x, min, max){ return Math.max(min, Math.min(max, x)); }
function getCementClass(){ const r = document.querySelector('input[name="cementClass"]:checked'); return (r && r.value) || 'N'; }
function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

// ---------- Theme ----------
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  const toggle = $('themeSwitch');
  if (toggle) toggle.checked = (theme === 'dark');
  if (creepChart){
    const accent = cssVar('--accent');
    const grid = cssVar('--grid');
    const fg = cssVar('--fg');
    const ds = creepChart.data.datasets[0];
    ds.borderColor = accent;
    ds.backgroundColor = accent + '22';
    creepChart.options.scales.x.grid.color = grid;
    creepChart.options.scales.y.grid.color = grid;
    creepChart.options.scales.x.ticks.color = fg;
    creepChart.options.scales.y.ticks.color = fg;
    creepChart.options.plugins.legend.labels.color = fg;
    creepChart.update();
  }
}

function initTheme(){
  const saved = localStorage.getItem('theme');
  applyTheme(saved || 'light');
  const toggle = $('themeSwitch');
  if (toggle){
    toggle.addEventListener('change', () => {
      const t = toggle.checked ? 'dark' : 'light';
      localStorage.setItem('theme', t);
      applyTheme(t);
    });
  }
}

// ---------- Core Calculation ----------
function computeOnce(inputs){
  const { fck, RH_in, Ac, u, t, t0, T, sigma_c, cementClass } = inputs;
  if (![fck, RH_in, Ac, u, t, t0, T, sigma_c].every(Number.isFinite)) {
    return { error: 'Please enter valid numbers for all required inputs.' };
  }
  if (Ac <= 0 || u <= 0) {
    return { error: 'Area (A_c) and perimeter (u) must be > 0.' };
  }

  const warnings = [];
  let RH = RH_in;
  if (RH < 40 || RH > 100) {
    warnings.push('RH is outside typical 40–100% range. Clamped to model limits.');
    RH = clamp(RH, 40, 100);
  }

  const { var3, var4 } = cementParams[cementClass] || cementParams.N;

  // Strengths & geometry (MPa, mm)
  const fcm = fck + 8;          // mean strength
  const h0  = 2 * Ac / u;       // mm

  // Early-age mean strength at t0 (cement class dependent)
  const safe_t0 = Math.max(t0, 1e-4);
  const fcm_t0  = fcm * Math.exp(var4 * (1 - Math.sqrt(28 / safe_t0)));
  const fck_t0  = fcm_t0 - 8;

  // Modulus (GPa)
  const Ecm    = 22 * Math.pow(fcm / 10, 0.3);
  const Ec     = 1.05 * Ecm;
  const Ecm_t0 = Math.pow(fcm_t0 / fcm, 0.3) * Ecm;

  // Alpha factors
  const alpha1 = Math.pow(35 / fcm, 0.7);
  const alpha2 = Math.pow(35 / fcm, 0.2);
  const alpha3 = Math.pow(35 / fcm, 0.5);

  // φ_RH and β_H
  let phi_RH, beta_H;
  if (fcm <= 35) {
    phi_RH = 1 + (1 - RH / 100) / (0.1 * Math.pow(h0, 1 / 3));
    beta_H = Math.min(1.5 * (1 + Math.pow(0.012 * RH, 18)) * h0 + 250, 1500);
  } else {
    phi_RH = (1 + ((1 - RH / 100) / (0.1 * Math.pow(h0, 1 / 3))) * alpha1) * alpha2;
    beta_H = Math.min(
      1.5 * (1 + Math.pow(0.012 * RH, 18)) * h0 + 250 * alpha3,
      1500 * alpha3
    );
  }

  const beta_fcm = 16.8 / Math.sqrt(fcm);

  // Temperature function (20°C baseline)
  const t_T  = Math.exp(-(4000 / (273 + T) - 13.65)) * safe_t0;
  const t0_T = Math.max(0.5, t_T * Math.pow(9 / (2 + Math.pow(t_T, 1.2)) + 1, var3));

  const beta_t0 = 1 / (0.1 + Math.pow(t0_T, 0.2));

  const dt = Math.max(0, t - t0);
  if (t < t0) warnings.push('t < t₀. No creep has developed before loading; βct,t0 set to 0.');
  const beta_ct_t0 = Math.pow(dt / (beta_H + dt), 0.3);

  const phi0    = phi_RH * beta_fcm * beta_t0;   // notional creep
  const phi_tt0 = phi0 * beta_ct_t0;             // creep at time t

  const k_sigma = sigma_c / Math.max(fck_t0, 1e-6);
  const eps_cci = phi_tt0 * Math.exp(1.5 * (k_sigma - 0.45)) * (sigma_c / Ec); // dimensionless
  if (k_sigma > 0.5) warnings.push('σc/fck,t0 is relatively high; nonlinear effects dominate.');

  return {
    warnings,
    // cement params
    var3, var4, cementClass,
    // geometry & environment
    h0, RH,
    // strengths & modulus
    fck, fcm, fcm_t0, fck_t0, Ecm, Ecm_t0, Ec,
    // alpha & size/humidity
    alpha1, alpha2, alpha3, phi_RH, beta_H, beta_fcm,
    // time/temperature
    t, t0, T, t_T, t0_T, beta_t0, dt, beta_ct_t0,
    // outputs
    phi0, phi_tt0, k_sigma, eps_cci,
  };
}

function generateSeries(inputs, points = 400){
  const { t0, t } = inputs;
  const t_start = Math.max(t0, 0);
  const t_end   = Math.max(t, t_start);
  const n = Math.max(2, Math.floor(points));
  const xs = [], ys = [];
  if (t_end <= t_start){ xs.push(t_start, t_start+1); ys.push(0,0); return { xs, ys }; }
  for (let i = 0; i < n; i++){
    const ti = t_start + (i/(n-1)) * (t_end - t_start);
    const res = computeOnce({ ...inputs, t: ti });
    const y = (res && !res.error) ? res.phi_tt0 : NaN;
    xs.push(ti); ys.push(y);
  }
  return { xs, ys };
}

// ---------- Chart ----------
function initChart(){
  const ctx = $('creepChart').getContext('2d');
  const accent = cssVar('--accent');
  const grid = cssVar('--grid');
  const fg = cssVar('--fg');
  creepChart = new Chart(ctx, {
    type: 'line',
    data: { datasets: [{ label: 'φ(t, t₀)', data: [], borderColor: accent, backgroundColor: accent + '22', borderWidth: 2, fill: true, tension: 0.22, pointRadius: 0 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false, // dataset will be {x,y}
      scales: {
        x: {
          type: 'linear',
          title: { text: 'Time t (days)', display: true, color: fg },
          grid: { color: grid },
          ticks: {
            color: fg,
            callback: (val) => Math.round(val),
          }
        },
        y: {
          title: { text: 'Creep coefficient φ(t, t₀)', display: true, color: fg },
          grid: { color: grid },
          beginAtZero: true,
          ticks: {
            color: fg,
            callback: (val) => Number(val).toFixed(2)
          }
        }
      },
      plugins: {
        legend: { display: true, labels: { color: fg } },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: { label: (ctx) => ` φ = ${Number(ctx.parsed.y).toFixed(3)}` }
        }
      },
      interaction: { mode: 'index', intersect: false }
    }
  });
}

function updateChart(xs, ys){
  if (!creepChart) initChart();
  const points = xs.map((x, i) => ({ x, y: ys[i] }));
  creepChart.data.datasets[0].data = points;
  if (xs && xs.length){
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    creepChart.options.scales.x.min = Math.round(minX);
    creepChart.options.scales.x.max = Math.round(maxX);
  } else {
    delete creepChart.options.scales.x.min;
    delete creepChart.options.scales.x.max;
  }
  creepChart.update();
}

// ---------- Rendering ----------
function fmt(x, d=3){ return Number.isFinite(x) ? x.toFixed(d) : '—'; }
function fmtN(x, d=3){ return Number.isFinite(x) ? x.toFixed(d) : '—'; }

function calculateAndRender(){
  const inputs = {
    fck: valNum('fck'), RH_in: valNum('RH'), Ac: valNum('Ac'), u: valNum('u'),
    t: valNum('t'), t0: valNum('t0'), T: valNum('T'), sigma_c: valNum('sigma_c'),
    cementClass: getCementClass()
  };

  const out = computeOnce(inputs);
  const warnEl = $('warn');
  if (out.error){
    warnEl.textContent = out.error;
    renderResults(null);
    updateChart([], []);
    $('calc_details').textContent = '—';
    return;
  }
  warnEl.textContent = (out.warnings || []).join(' ') || '';

  renderResults(out);
  const series = generateSeries(inputs, 400);
  updateChart(series.xs, series.ys);
  renderCalcDetails(out, inputs);
}

function renderResults(out){
  if (!out){
    $('res_h0').textContent = '—';
    $('res_phi0').textContent = '—';
    $('res_beta').textContent = '—';
    $('res_phi_tt0').textContent = '—';
    $('res_epscci').textContent = '—';
    return;
  }
  $('res_h0').textContent      = fmt(out.h0, 1);
  $('res_phi0').textContent    = fmt(out.phi0, 3);
  $('res_beta').textContent    = fmt(out.beta_ct_t0, 3);
  $('res_phi_tt0').textContent = fmt(out.phi_tt0, 3);
  $('res_epscci').textContent  = Number.isFinite(out.eps_cci) ? Number(out.eps_cci).toExponential(6) : '—';
}

function renderCalcDetails(out, inputs){
  const L = [];
  // Inputs
  L.push('INPUTS');
  L.push(`  f_ck = ${fmtN(out.fck,3)} MPa, f_cm = f_ck + 8 = ${fmtN(out.fcm,3)} MPa`);
  L.push(`  RH = ${fmtN(out.RH,1)} %, A_c = ${fmtN(inputs.Ac,1)} mm², u = ${fmtN(inputs.u,1)} mm`);
  L.push(`  t0 = ${fmtN(out.t0,2)} days, t = ${fmtN(out.t,2)} days, Δt = t − t0 = ${fmtN(out.dt,2)} days`);
  L.push(`  T = ${fmtN(out.T,1)} °C, σ_c = ${fmtN(inputs.sigma_c,3)} MPa`);
  L.push('');
  L.push('CEMENT CLASS PARAMETERS');
  L.push(`  Cement class = ${inputs.cementClass}  (var3 = ${fmtN(out.var3,0)}, var4 = ${fmtN(out.var4,2)})`);
  L.push('');

  // Geometry
  L.push('GEOMETRY / SIZE');
  L.push(`  h0 = 2·A_c / u = 2·${fmtN(inputs.Ac,1)} / ${fmtN(inputs.u,1)} = ${fmtN(out.h0,3)} mm`);
  L.push('');

  // Strength & Modulus
  L.push('STRENGTH & MODULUS');
  L.push(`  f_cm(t0) = f_cm · exp( var4 · (1 − √(28/t0)) ) = ${fmtN(out.fcm,3)} · exp( var4 · (1 − √(28/${fmtN(out.t0,3)})) ) = ${fmtN(out.fcm_t0,3)} MPa`);
  L.push(`  f_ck(t0) = f_cm(t0) − 8 = ${fmtN(out.fck_t0,3)} MPa`);
  L.push(`  E_cm = 22 · (f_cm/10)^0.3 = ${fmtN(out.Ecm,3)} GPa;  E_c = 1.05·E_cm = ${fmtN(out.Ec,3)} GPa`);
  L.push(`  E_cm(t0) = (f_cm(t0)/f_cm)^0.3 · E_cm = ${fmtN(out.Ecm_t0,3)} GPa`);
  L.push('');

  // Alpha factors
  L.push('ALPHA FACTORS (for f_cm > or ≤ 35 MPa)');
  L.push(`  α1 = (35/f_cm)^0.7 = ${fmtN(out.alpha1,4)},  α2 = (35/f_cm)^0.2 = ${fmtN(out.alpha2,4)},  α3 = (35/f_cm)^0.5 = ${fmtN(out.alpha3,4)}`);
  L.push('');

  // Humidity & Size
  L.push('HUMIDITY & SIZE FUNCTIONS');
  L.push(`  φ_RH = ${fmtN(out.phi_RH,4)}`);
  L.push(`  β_H  = ${fmtN(out.beta_H,3)}`);
  L.push(`  β_fcm = 16.8 / √f_cm = ${fmtN(out.beta_fcm,4)}`);
  L.push('');

  // Temperature & Time
  L.push('TEMPERATURE & LOADING AGE');
  L.push(`  t_T  = exp( -(4000/(273+T) − 13.65) ) · t0 = ${fmtN(out.t_T,4)}`);
  L.push(`  t0_T = max(0.5, t_T · ( 9/(2 + t_T^1.2) + 1 )^{var3} ) = ${fmtN(out.t0_T,4)}`);
  L.push(`  β_t0 = 1 / (0.1 + t0_T^0.2) = ${fmtN(out.beta_t0,4)}`);
  L.push('');

  // Development
  L.push('TIME DEVELOPMENT');
  L.push(`  β_ct,t0 = ( Δt / (β_H + Δt) )^0.3 = ( ${fmtN(out.dt,2)} / (${fmtN(out.beta_H,2)} + ${fmtN(out.dt,2)}) )^0.3 = ${fmtN(out.beta_ct_t0,4)}`);
  L.push('');

  // Final
  L.push('CREEP COEFFICIENTS & STRAIN');
  L.push(`  φ0 = φ_RH · β_fcm · β_t0 = ${fmtN(out.phi_RH,4)} × ${fmtN(out.beta_fcm,4)} × ${fmtN(out.beta_t0,4)} = ${fmtN(out.phi0,4)}`);
  L.push(`  φ(t,t0) = φ0 · β_ct,t0 = ${fmtN(out.phi0,4)} × ${fmtN(out.beta_ct_t0,4)} = ${fmtN(out.phi_tt0,4)}`);
  L.push(`  k_σ = σ_c / f_ck(t0) = ${fmtN(inputs.sigma_c,3)} / ${fmtN(out.fck_t0,3)} = ${fmtN(out.k_sigma,4)}`);
  L.push('  ε_cci(t0) = φ(t,t0) · exp(1.5·(k_σ − 0.45)) · (σ_c / E_c)');
  L.push(`           = ${fmtN(out.phi_tt0,4)} · exp(1.5·(${fmtN(out.k_sigma,4)} − 0.45)) · (${fmtN(inputs.sigma_c,3)} / ${fmtN(out.Ec,3)} GPa)`);
  L.push(`           = ${Number(out.eps_cci).toExponential(6)} (dimensionless)  ≈ ${(out.eps_cci*1e6).toFixed(1)} µε`);

  $('calc_details').textContent = L.join('\n');
}

// ---------- Form & Events ----------
function resetForm(){
  ['fck','RH','Ac','u','t0','t','T','sigma_c','ts'].forEach(id => $(id).value = '');
  document.querySelector('input[name="cementClass"][value="N"]').checked = true;
  $('warn').textContent = '';
  renderResults(null);
  updateChart([], []);
  $('calc_details').textContent = '—';
}

function attachEvents(){
  $('btnCalc').addEventListener('click', calculateAndRender);
  $('btnReset').addEventListener('click', resetForm);

  const ids = ['fck','RH','Ac','u','t0','t','T','sigma_c','ts'];
  ids.forEach(id => {
    $(id).addEventListener('input', () => {
      if ($('autoUpdate').checked) calculateAndRender();
    });
  });

  document.querySelectorAll('input[name="cementClass"]').forEach(r => {
    r.addEventListener('change', () => {
      if ($('autoUpdate').checked) calculateAndRender();
    });
  });

  $('btnCopyCalc').addEventListener('click', () => {
    const txt = $('calc_details').textContent || '';
    navigator.clipboard.writeText(txt).catch(() => {});
  });
}

// ---------- Boot ----------
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initChart();
  attachEvents();
});
