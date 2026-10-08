// ==========================================
// 1. CONFIGURACIÓN DE SUPABASE
// ==========================================
let recovering = location.hash.includes('type=recovery'); // viene del enlace del correo
const SUPABASE_URL = 'https://ouleevsfvndqjiuojriq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_M42BXrQBrGzXIz78p6ga2Q_6kM-_GEh';

// Se llama "sb" para no chocar con window.supabase (la librería del CDN)
const sb = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { storage: window.sessionStorage }
    })
  : null;

// ==========================================
// 2. HELPER FUNCTIONS & ESTADO
// ==========================================
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);

const CATS_GASTO = ['Comida', 'Transporte', 'Hogar', 'Servicios', 'Salud', 'Ocio', 'Ropa', 'Deudas', 'Ahorro', 'Otros'];
const CATS_INGRESO = ['Sueldo / Nómina', 'Horas Extra / Bonos', 'Prima / Cesantías', 'Freelance / Servicios', 'Otros'];
const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b', '#a3e635'];

// Fechas en hora LOCAL (toISOString usa UTC y de noche puede dar el día/mes siguiente)
const pad = n => String(n).padStart(2, '0');
const monthKey = (y, m) => `${y}-${pad(m + 1)}`; // m = 0..11
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

let currentUser = null;
let tab = 'res';
let month = todayStr().slice(0, 7);
let transactions = [];
let registering = false;
let historyChart = null;
let catsChart = null;

function msg(icon, title, text = '') {
    if (window.Swal) {
        return Swal.fire({
            icon, title, text,
            background: '#121820', color: '#e2e8f0',
            confirmButtonColor: '#94a3b8', confirmButtonText: 'Aceptar'
        });
    }
    alert(title + (text ? '\n' + text : ''));
    return Promise.resolve();
}

async function ask(title, text) {
    if (window.Swal) {
        const r = await Swal.fire({
            icon: 'warning', title, text,
            background: '#121820', color: '#e2e8f0',
            showCancelButton: true,
            confirmButtonColor: '#ef4444', cancelButtonColor: '#64748b',
            confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar'
        });
        return r.isConfirmed;
    }
    return confirm(title);
}

function displayName() {
    const u = currentUser;
    return u?.user_metadata?.username || u?.email?.split('@')[0] || 'usuario';
}

// ==========================================
// 3. INICIALIZACIÓN Y CARGA DE DATOS
// ==========================================
document.addEventListener('DOMContentLoaded', () => { initApp(); });

async function initApp() {
    if (!sb) {
        return alert('Error: No se pudo cargar la librería de Supabase. Revisa la conexión o los tags en tu index.html');
    }

    // 1. Si la pestaña se cerró y NO es una simple recarga, cerrar sesión
    const navType = performance.getEntriesByType('navigation')[0]?.type;
    if (sessionStorage.getItem('cerrando') === '1' && navType !== 'reload') {
        await sb.auth.signOut();
        sessionStorage.removeItem(KEY_ULTIMA);
    }
    sessionStorage.removeItem('cerrando');

    // 2. Si pasó demasiado tiempo sin actividad, cerrar sesión
    const ultima = Number(sessionStorage.getItem(KEY_ULTIMA) || 0);
    if (ultima && Date.now() - ultima > MAX_INACTIVO_MS) {
        await sb.auth.signOut();
        sessionStorage.removeItem(KEY_ULTIMA);
    }

    const { data: { session } } = await sb.auth.getSession();
    currentUser = session?.user || null;

    if (currentUser) {
        marcarActividad();
        await loadData();
    }
    render();

    sb.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') recovering = true;
        if (registering) return;
        currentUser = session?.user || null;
        setTimeout(async () => {
            if (currentUser) await loadData();
            else transactions = [];
            render();
        }, 0);
    });
}


async function loadData() {
    const { data, error } = await sb
        .from('transacciones')
        .select('*')
        .order('date', { ascending: false })
        .order('id', { ascending: false });

    if (error) {
        console.error('Error cargando transacciones:', error.message);
        return;
    }
    transactions = data || [];
}

// ==========================================
// 4. CÁLCULOS
// ==========================================
function getFiltered(type, status) {
    return transactions.filter(t => t.type === type && t.status === status && t.date.startsWith(month));
}

function sum(type, status) {
    return getFiltered(type, status).reduce((acc, t) => acc + Number(t.amount), 0);
}

function getPrevMonthKey(key) {
    const [y, m] = key.split('-').map(Number);
    return monthKey(new Date(y, m - 2, 1).getFullYear(), new Date(y, m - 2, 1).getMonth());
}

function getMonthMetrics(mKey) {
    const txs = transactions.filter(t => t.status === 'real' && t.date.startsWith(mKey));
    const ing = txs.filter(t => t.type === 'ingreso').reduce((a, b) => a + Number(b.amount), 0);
    const gas = txs.filter(t => t.type === 'gasto').reduce((a, b) => a + Number(b.amount), 0);
    return { ing, gas, ahorro: ing - gas };
}

// Ahorro de cada mes y acumulado (suma de todos los meses hasta el seleccionado)
function getSavingsByMonth() {
    const map = {};
    transactions.filter(t => t.status === 'real').forEach(t => {
        const k = t.date.slice(0, 7);
        map[k] = (map[k] || 0) + (t.type === 'ingreso' ? 1 : -1) * Number(t.amount);
    });
    let acc = 0;
    return Object.keys(map).sort().map(k => { acc += map[k]; return { k, mes: map[k], acc }; })
        .filter(r => r.k <= month);
}

function monthLabel(k) {
    const [y, m] = k.split('-').map(Number);
    const n = new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'short', year: 'numeric' }).replace(/\./g, '');
    return n.charAt(0).toUpperCase() + n.slice(1);
}

function getCategories() {
    const map = {};
    getFiltered('gasto', 'real').forEach(t => { map[t.category] = (map[t.category] || 0) + Number(t.amount); });
    return Object.entries(map).map(([c, s]) => ({ c, s })).sort((a, b) => b.s - a.s);
}

// % de variación: devuelve null si no hay base de comparación
function pct(curr, prev) {
    return prev !== 0 ? ((curr - prev) / Math.abs(prev)) * 100 : null;
}

// ==========================================
// 5. RENDER PRINCIPAL
// ==========================================
function render() {
    if (recovering) return showNewPasswordForm();
    if (!currentUser) return login();

    let h = `<div class="row" style="margin-bottom:16px"><h1>Hola, ${esc(displayName())}</h1><input type="month" value="${month}" style="width:auto;margin:0;padding:6px 10px;font-size:13px" onchange="month=this.value;render()"></div>`;

    h += tab === 'res' ? resumen()
        : tab === 'mov' ? lista('real')
        : tab === 'plan' ? lista('plan')
        : tab === 'rep' ? reporte()
        : ajustes();

    h += `<button class="fab" id="btn-add">+</button>
          <nav>${[['res', 'Resumen'], ['mov', 'Movimientos'], ['plan', 'Planeado'], ['rep', 'Reporte'], ['aj', 'Ajustes']]
            .map(([k, t]) => `<a class="${tab === k ? 'on' : ''}" onclick="tab='${k}';render()">${t}</a>`).join('')}</nav>`;
    $('#app').innerHTML = h;

    const fab = $('#btn-add');
    if (fab) fab.onclick = form;

    // Los gráficos se dibujan DESPUÉS de que el HTML ya existe en la página
    if (tab === 'rep') renderReportCharts();
}

// ==========================================
// 6. VISTA: RESUMEN
// ==========================================
function resumen() {
    const gen = sum('ingreso', 'real');
    const gas = sum('gasto', 'real');
    const pg = sum('ingreso', 'plan');
    const pp = sum('gasto', 'plan');
    const disp = gen - gas;
    const proy = disp + pg - pp;
    const cats = getCategories();
    const mx = cats[0]?.s || 1;

    return `
    <div class="card">
        <h2>Disponible Real</h2>
        <div class="big ${disp < 0 ? 'ko' : ''}">${money(disp)}</div>
        <div class="mu" style="margin-top:4px">Ingresos − gastos ejecutados del mes</div>
    </div>
    <div class="g">
        <div class="card"><h2>Ingresado</h2><b>${money(gen)}</b></div>
        <div class="card"><h2>Gastado</h2><b>${money(gas)}</b></div>
        <div class="card"><h2>Por Ingresar</h2><b class="mu">${money(pg)}</b></div>
        <div class="card"><h2>Por Gastar</h2><b class="mu">${money(pp)}</b></div>
    </div>
    <div class="card">
        <h2>Proyección Fin de Mes</h2>
        <div class="big ${proy < 0 ? 'ko' : ''}" style="font-size:22px">${money(proy)}</div>
    </div>
    <div class="card">
        <h2>Desglose de Gastos</h2>
        ${cats.length ? cats.map(c => `
            <div style="margin-bottom:10px">
                <div class="row"><span style="font-size:14px">${esc(c.c)}</span><b>${money(c.s)}</b></div>
                <div class="bar"><i style="width:${(c.s / mx) * 100}%"></i></div>
            </div>`).join('') : '<div class="mu">Sin gastos registrados este mes.</div>'}
    </div>`;
}

// ==========================================
// 7. VISTA: REPORTE (DASHBOARD)
// ==========================================
function variacion(curr, prev, masEsMalo = false) {
    const p = pct(curr, prev);
    if (p === null) return '<span class="mu">sin dato previo</span>';
    const sube = curr >= prev;
    const bueno = masEsMalo ? !sube : sube;
    return `<span class="${bueno ? 'ok' : 'ko'}" style="font-weight:600">${sube ? '↑' : '↓'} ${Math.abs(p).toFixed(1)}%</span> <span class="mu">vs mes anterior</span>`;
}

function reporte() {
    const curr = getMonthMetrics(month);
    const prev = getMonthMetrics(getPrevMonthKey(month));
    const cats = getCategories();
    const totalGas = cats.reduce((a, c) => a + c.s, 0);
    const tasaAhorro = curr.ing > 0 ? (curr.ahorro / curr.ing) * 100 : null;
    const difAhorro = curr.ahorro - prev.ahorro;
    const hayPrev = prev.ing !== 0 || prev.gas !== 0;
    const ahorros = getSavingsByMonth();
    const totalAcum = ahorros.length ? ahorros[ahorros.length - 1].acc : 0;

    return `
    <div class="card">
        <h2>Ahorro del mes</h2>
        <div class="big ${curr.ahorro < 0 ? 'ko' : ''}">${money(curr.ahorro)}</div>
        <div style="margin-top:6px;font-size:12px">
            ${hayPrev ? `<span class="${difAhorro >= 0 ? 'ok' : 'ko'}" style="font-weight:600">${difAhorro >= 0 ? '↑' : '↓'} ${money(Math.abs(difAhorro))}</span>
            <span class="mu">vs mes anterior (${money(prev.ahorro)})</span>` : '<span class="mu">Sin registros del mes anterior.</span>'}
        </div>
        ${tasaAhorro !== null ? `<div class="mu" style="margin-top:6px">Ahorraste el <b>${tasaAhorro.toFixed(1)}%</b> de tus ingresos</div>` : ''}
    </div>

    <div class="card">
        <h2>Ahorro total acumulado</h2>
        <div class="big ${totalAcum < 0 ? 'ko' : 'ok'}">${money(totalAcum)}</div>
        <div class="mu" style="margin-top:4px">Suma de todos los meses hasta ${monthLabel(month)}</div>
        ${ahorros.length ? `
        <div style="margin-top:14px">
            <div class="row mu" style="padding-bottom:6px;border-bottom:1px solid var(--bd)"><span style="flex:1">Mes</span><span style="flex:1;text-align:right">Ahorro del mes</span><span style="flex:1;text-align:right">Acumulado</span></div>
            ${[...ahorros].reverse().slice(0, 12).map(r => `
            <div class="row" style="padding:8px 0;border-bottom:1px solid var(--bd);font-size:13px">
                <span style="flex:1">${monthLabel(r.k)}</span>
                <span style="flex:1;text-align:right" class="${r.mes < 0 ? 'ko' : 'ok'}">${money(r.mes)}</span>
                <b style="flex:1;text-align:right">${money(r.acc)}</b>
            </div>`).join('')}
        </div>` : ''}
    </div>

    <div class="g">
        <div class="card">
            <h2>Ingresos</h2><b>${money(curr.ing)}</b>
            <div style="font-size:11px;margin-top:4px">${variacion(curr.ing, prev.ing)}</div>
        </div>
        <div class="card">
            <h2>Gastos</h2><b>${money(curr.gas)}</b>
            <div style="font-size:11px;margin-top:4px">${variacion(curr.gas, prev.gas, true)}</div>
        </div>
    </div>

    <div class="card">
        <h2>Histórico (últimos 6 meses)</h2>
        <div style="position:relative;height:200px;width:100%"><canvas id="chartHistory"></canvas></div>
    </div>

    <div class="card">
        <h2>Distribución de gastos</h2>
        ${cats.length ? `
            <div style="position:relative;height:200px;width:100%;margin-bottom:12px"><canvas id="chartCats"></canvas></div>
            ${cats.map((c, i) => `
                <div class="row" style="margin-bottom:6px">
                    <span style="font-size:13px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${COLORS[i % COLORS.length]};margin-right:6px"></span>${esc(c.c)}</span>
                    <span style="font-size:13px"><b>${money(c.s)}</b> <span class="mu">${((c.s / totalGas) * 100).toFixed(0)}%</span></span>
                </div>`).join('')}
        ` : '<div class="mu">Sin gastos registrados este mes.</div>'}
    </div>`;
}

function renderReportCharts() {
    if (!window.Chart) return;

    const [y, m] = month.split('-').map(Number);
    const labels = [], ingData = [], gasData = [];

    for (let i = 5; i >= 0; i--) {
        const d = new Date(y, m - 1 - i, 1);
        const mm = getMonthMetrics(monthKey(d.getFullYear(), d.getMonth()));
        const n = d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
        labels.push(n.charAt(0).toUpperCase() + n.slice(1));
        ingData.push(mm.ing);
        gasData.push(mm.gas);
    }

    if (historyChart) { historyChart.destroy(); historyChart = null; }
    if (catsChart) { catsChart.destroy(); catsChart = null; }

    const ctxH = document.getElementById('chartHistory');
    if (ctxH) {
        historyChart = new Chart(ctxH, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Ingresos', data: ingData, backgroundColor: '#22c55e', borderRadius: 4 },
                    { label: 'Gastos', data: gasData, backgroundColor: '#ef4444', borderRadius: 4 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#e2e8f0', font: { size: 11 } } } },
                scales: {
                    x: { ticks: { color: '#64748b' }, grid: { display: false } },
                    y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } }
                }
            }
        });
    }

    const cats = getCategories();
    const ctxC = document.getElementById('chartCats');
    if (ctxC && cats.length) {
        catsChart = new Chart(ctxC, {
            type: 'doughnut',
            data: {
                labels: cats.map(c => c.c),
                datasets: [{
                    data: cats.map(c => c.s),
                    backgroundColor: cats.map((_, i) => COLORS[i % COLORS.length]),
                    borderWidth: 0
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
}

// ==========================================
// 8. VISTAS: LISTAS Y AJUSTES
// ==========================================
function lista(st) {
    const rows = transactions.filter(t => t.status === st && t.date.startsWith(month));
    return `<div class="card">
        <h2>${st === 'real' ? 'Historial de Movimientos' : 'Planificaciones'}</h2>
        ${rows.length ? rows.map(r => `
            <div class="it">
                <div>
                    <b style="font-size:14px">${esc(r.note || r.category)}</b>
                    <div class="mu">${esc(r.category)} · ${r.date}</div>
                </div>
                <div style="text-align:right">
                    <b class="${r.type === 'gasto' ? 'ko' : 'ok'}">${r.type === 'gasto' ? '-' : '+'}${money(r.amount)}</b>
                    <div style="display:flex;gap:4px;margin-top:4px;justify-content:flex-end">
                        ${st === 'plan' ? `<button class="sm" onclick="done(${r.id})">Ejecutar</button>` : ''}
                        <button class="sm d" onclick="del(${r.id})">✕</button>
                    </div>
                </div>
            </div>`).join('') : '<div class="mu">Sin registros.</div>'}
    </div>`;
}

function ajustes() {
    return `
    <div class="card">
        <h2>Información de la Cuenta</h2>
        <p class="mu">Tus datos están sincronizados en la nube de forma segura.</p>
        <p style="font-size:14px;margin-top:8px"><b>Usuario:</b> ${esc(displayName())}</p>
        <p style="font-size:14px;margin-top:4px"><b>Correo:</b> ${esc(currentUser.email)}</p>
    </div>
    <div class="card">
        <h2>Sesión</h2>
        <button class="s" style="background:#e53e3e;color:white;border:none" onclick="logout()">Cerrar sesión</button>
    </div>`;
}

// ==========================================
// 9. OPERACIONES CRUD
// ==========================================
function form() {
    const oldModal = $('#m');
    if (oldModal) oldModal.remove();

    const d = document.createElement('div');
    d.className = 'modal';
    d.id = 'm';
    d.innerHTML = `
    <div>
        <h1 style="margin-bottom:14px" id="form-title">Registrar Operación</h1>
        <select id="f_t" onchange="updateFormMode(this.value)">
            <option value="gasto">Gasto (-)</option>
            <option value="ingreso">Ingreso (+)</option>
        </select>
        <select id="f_s">
            <option value="real">Realizado hoy</option>
            <option value="plan">Planeado / Futuro</option>
        </select>
        <input id="f_a" type="number" inputmode="decimal" placeholder="Monto (ej. 50000)">
        <select id="f_c"></select>
        <input id="f_n" placeholder="Detalle">
        <input id="f_d" type="date" value="${todayStr()}">
        <button id="btn-save">Guardar</button>
        <button class="s" style="margin-top:8px" id="btn-cancel">Cancelar</button>
    </div>`;
    document.body.appendChild(d);

    updateFormMode('gasto');
    $('#btn-save').onclick = add;
    $('#btn-cancel').onclick = () => $('#m').remove();
}

function updateFormMode(type) {
    const isGasto = type === 'gasto';
    $('#form-title').textContent = isGasto ? 'Registrar Gasto' : 'Registrar Ingreso de Trabajo';
    $('#f_c').innerHTML = (isGasto ? CATS_GASTO : CATS_INGRESO).map(c => `<option>${c}</option>`).join('');
    $('#f_n').placeholder = isGasto
        ? 'Detalle (ej. Mercado, Pasajes, Casa)'
        : 'Detalle (ej. Sueldo quincena, Bono, Trabajo extra)';
}

async function add() {
    const a = parseFloat($('#f_a').value);
    if (!(a > 0)) return msg('warning', 'Monto inválido', 'Ingrese un monto válido');

    const date = $('#f_d').value;
    if (!date) return msg('warning', 'Falta la fecha', 'Seleccione una fecha');
    month = date.slice(0, 7);

    // user_id se llena solo en Supabase con default auth.uid()
    const newTx = {
        type: $('#f_t').value,
        status: $('#f_s').value,
        amount: a,
        category: $('#f_c').value,
        note: $('#f_n').value.trim(),
        date
    };

    const { error } = await sb.from('transacciones').insert([newTx]);
    if (error) return msg('error', 'Error al guardar', error.message);

    const m = $('#m');
    if (m) m.remove();

    await loadData();
    render();
}

async function done(id) {
    const { error } = await sb
        .from('transacciones')
        .update({ status: 'real', date: todayStr() })
        .eq('id', id);

    if (error) return msg('error', 'Error al actualizar', error.message);

    await loadData();
    render();
}

async function del(id) {
    if (!(await ask('¿Eliminar registro?', 'Esta acción no se puede deshacer.'))) return;

    const { error } = await sb.from('transacciones').delete().eq('id', id);
    if (error) return msg('error', 'Error al eliminar', error.message);

    await loadData();
    render();
}

async function logout() {
    await sb.auth.signOut();
    currentUser = null;
    transactions = [];
    render();
}

// ==========================================
// 10. AUTENTICACIÓN (LOGIN Y REGISTRO)
// ==========================================
function login() {
    const app = $('#app');
    if (!app) return;

    app.innerHTML = `
    <div class="card" style="margin-top:10vh">
        <h1 style="margin-bottom:6px">Control Financiero</h1>
        <p class="mu" style="margin-bottom:16px">Iniciar Sesión</p>
        <input id="u" placeholder="Correo electrónico" type="email" autocomplete="username">
        <input id="p" type="password" placeholder="Contraseña" autocomplete="current-password">
        <button id="btn-login">Ingresar</button>
        <div style="text-align:center;margin-top:14px">
            <a style="color:var(--acc);font-size:13px;cursor:pointer" onclick="showRegisterForm()">¿No tienes cuenta? Regístrate aquí</a>
            <br><br>
            <a style="color:var(--acc);font-size:13px;cursor:pointer" onclick="showForgotForm()">¿Olvidaste tu contraseña?</a>
        </div>
    </div>`;

    $('#btn-login').onclick = auth;
    $('#p').onkeydown = e => { if (e.key === 'Enter') auth(); };
}

function showRegisterForm() {
    const app = $('#app');
    if (!app) return;

    app.innerHTML = `
    <div class="card" style="margin-top:10vh">
        <h1 style="margin-bottom:6px">Crear Nueva Cuenta</h1>
        <p class="mu" style="margin-bottom:16px">Tus datos quedarán respaldados en la nube</p>
        <input id="reg_n" placeholder="Nombre de usuario" type="text" maxlength="20" autocomplete="nickname">
        <input id="reg_u" placeholder="Correo electrónico" type="email" autocomplete="username">
        <input id="reg_p" type="password" placeholder="Contraseña (mínimo 6 caracteres)" autocomplete="new-password">
        <button id="btn-do-register">Registrarse</button>
        <div style="text-align:center;margin-top:14px">
            <a style="color:var(--acc);font-size:13px;cursor:pointer" onclick="login()">¿Ya tienes cuenta? Inicia sesión</a>
        </div>
    </div>`;

    $('#btn-do-register').onclick = registerUser;
    $('#reg_p').onkeydown = e => { if (e.key === 'Enter') registerUser(); };
}

function showForgotForm() {
    $('#app').innerHTML = `
    <div class="card" style="margin-top:10vh">
        <h1 style="margin-bottom:6px">Recuperar contraseña</h1>
        <p class="mu" style="margin-bottom:16px">Te enviaremos un enlace a tu correo para crear una nueva</p>
        <input id="rec_u" placeholder="Correo electrónico" type="email" autocomplete="username">
        <button id="btn-rec">Enviar enlace</button>
        <div style="text-align:center;margin-top:14px">
            <a style="color:var(--acc);font-size:13px;cursor:pointer" onclick="login()">Volver a iniciar sesión</a>
        </div>
    </div>`;
    $('#btn-rec').onclick = sendRecovery;
    $('#rec_u').onkeydown = e => { if (e.key === 'Enter') sendRecovery(); };
}

async function sendRecovery() {
    const email = $('#rec_u').value.trim();
    if (!email) return msg('warning', 'Falta el correo', 'Escribe tu correo electrónico');

    const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname
    });
    if (error) return msg('error', 'No se pudo enviar', error.message);

    await msg('success', 'Revisa tu correo', 'Si el correo está registrado, te llegó un enlace para crear una contraseña nueva. Mira también en spam.');
    login();
}

function showNewPasswordForm() {
    $('#app').innerHTML = `
    <div class="card" style="margin-top:10vh">
        <h1 style="margin-bottom:6px">Nueva contraseña</h1>
        <p class="mu" style="margin-bottom:16px">Escribe la contraseña nueva para tu cuenta</p>
        <input id="np1" type="password" placeholder="Nueva contraseña (mínimo 6 caracteres)" autocomplete="new-password">
        <input id="np2" type="password" placeholder="Repite la contraseña" autocomplete="new-password">
        <button id="btn-np">Guardar contraseña</button>
    </div>`;
    $('#btn-np').onclick = saveNewPassword;
    $('#np2').onkeydown = e => { if (e.key === 'Enter') saveNewPassword(); };
}

async function saveNewPassword() {
    const p1 = $('#np1').value, p2 = $('#np2').value;
    if (p1.length < 6) return msg('warning', 'Contraseña muy corta', 'Debe tener al menos 6 caracteres');
    if (p1 !== p2) return msg('warning', 'No coinciden', 'Las dos contraseñas deben ser iguales');

    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) return msg('error', 'No se pudo cambiar', error.message);

    recovering = false;
    history.replaceState(null, '', location.pathname); // limpia el enlace de la barra
    await msg('success', '¡Listo!', 'Tu contraseña fue cambiada.');
    const { data: { session } } = await sb.auth.getSession();
    currentUser = session?.user || null;
    if (currentUser) await loadData();
    render();
}

async function auth() {
    const email = $('#u').value.trim();
    const password = $('#p').value;

    if (!email || !password) {
        return msg('warning', 'Campos incompletos', 'Por favor complete todos los campos');
    }

    const { data, error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
        const texto = error.message === 'Invalid login credentials'
            ? 'Correo o contraseña incorrectos'
            : error.message;
        return msg('error', 'Error al iniciar sesión', texto);
    }

    // onAuthStateChange se encarga de cargar datos y dibujar la app
    currentUser = data.user;
}

async function registerUser() {
    const username = $('#reg_n').value.trim();
    const email = $('#reg_u').value.trim();
    const password = $('#reg_p').value;

    if (!username || !email || !password) {
        return msg('warning', 'Campos incompletos', 'Escriba usuario, correo y contraseña');
    }
    if (username.length < 3) {
        return msg('warning', 'Usuario muy corto', 'El usuario debe tener al menos 3 caracteres');
    }
    if (password.length < 6) {
        return msg('warning', 'Contraseña muy corta', 'La contraseña debe tener al menos 6 caracteres');
    }

    registering = true;

    const { error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { username } }
    });

    if (error) {
        registering = false;
        const texto = /already registered/i.test(error.message)
            ? 'Ese correo ya está registrado'
            : error.message;
        return msg('error', 'Error al registrarse', texto);
    }

    await sb.auth.signOut();
    currentUser = null;
    transactions = [];
    registering = false;

    await msg('success', '¡Cuenta creada!', 'Tu cuenta se creó exitosamente. Ahora inicia sesión.');
    login();
}

// ===== Cierre de sesión por inactividad =====
const MAX_INACTIVO_MS = 5 * 60 * 1000; // 5 minutos
const KEY_ULTIMA = 'ultima_actividad';

function marcarActividad() {
    sessionStorage.setItem(KEY_ULTIMA, Date.now());
}

async function revisarInactividad() {
    if (!currentUser) return;
    const ultima = Number(sessionStorage.getItem(KEY_ULTIMA) || 0);
    if (ultima && Date.now() - ultima > MAX_INACTIVO_MS) {
        await logout();
        msg('info', 'Sesión cerrada', 'Se cerró por inactividad.');
    }
}

['click', 'keydown', 'touchstart', 'scroll'].forEach(ev =>
    document.addEventListener(ev, marcarActividad, { passive: true })
);

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revisarInactividad();
});

setInterval(revisarInactividad, 30 * 1000);

// Marca que la pestaña se está cerrando (no aplica si va a bfcache)
window.addEventListener('pagehide', e => {
    if (!e.persisted) sessionStorage.setItem('cerrando', '1');
});
