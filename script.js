// ==========================================
// 1. CONFIGURACIÓN DE SUPABASE
// ==========================================
const SUPABASE_URL = 'https://ouleevsfvndqjiuojriq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_M42BXrQBrGzXIz78p6ga2Q_6kM-_GEh';

// Se llama "sb" para no chocar con window.supabase (la librería del CDN)
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ==========================================
// 2. HELPER FUNCTIONS & ESTADO
// ==========================================
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);

const CATS_GASTO = ['Comida', 'Transporte', 'Hogar', 'Servicios', 'Salud', 'Ocio', 'Ropa', 'Deudas', 'Ahorro', 'Otros'];
const CATS_INGRESO = ['Sueldo / Nómina', 'Horas Extra / Bonos', 'Prima / Cesantías', 'Freelance / Servicios', 'Otros'];

let currentUser = null;
let tab = 'res';
let month = new Date().toISOString().slice(0, 7);
let transactions = [];
let registering = false; // evita que la app entre sola mientras se registra

// Alertas bonitas con SweetAlert2 (si no cargó, usa alert normal)
function msg(icon, title, text = '') {
    if (window.Swal) {
        return Swal.fire({
            icon, title, text,
            background: '#121820',
            color: '#e2e8f0',
            confirmButtonColor: '#94a3b8',
            confirmButtonText: 'Aceptar'
        });
    }
    alert(title + (text ? '\n' + text : ''));
    return Promise.resolve();
}

async function ask(title, text) {
    if (window.Swal) {
        const r = await Swal.fire({
            icon: 'warning', title, text,
            background: '#121820',
            color: '#e2e8f0',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar'
        });
        return r.isConfirmed;
    }
    return confirm(title);
}

// Nombre a mostrar: el usuario que eligió al registrarse
function displayName() {
    const u = currentUser;
    return u?.user_metadata?.username || u?.email?.split('@')[0] || 'usuario';
}

// ==========================================
// 3. INICIALIZACIÓN Y CARGA DE DATOS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    if (!sb) {
        return alert('Error: No se pudo cargar la librería de Supabase. Revisa la conexión o los tags en tu index.html');
    }

    const { data: { session } } = await sb.auth.getSession();
    currentUser = session?.user || null;

    if (currentUser) {
        await loadData();
    }
    render();

    // Escuchar cambios de sesión (login/logout).
    // OJO: no se hace await directamente aquí dentro, por eso el setTimeout.
    sb.auth.onAuthStateChange((event, session) => {
        if (registering) return; // durante el registro no entramos a la app
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
// 4. CÁLCULOS Y RENDERIZADO
// ==========================================
function getFiltered(type, status) {
    return transactions.filter(t => t.type === type && t.status === status && t.date.startsWith(month));
}

function sum(type, status) {
    return getFiltered(type, status).reduce((acc, t) => acc + Number(t.amount), 0);
}

function render() {
    if (!currentUser) return login();

    let h = `<div class="row" style="margin-bottom:16px"><h1>Hola, ${esc(displayName())}</h1><input type="month" value="${month}" style="width:auto;margin:0;padding:6px 10px;font-size:13px" onchange="month=this.value;render()"></div>`;
    h += tab === 'res' ? resumen() : tab === 'mov' ? lista('real') : tab === 'plan' ? lista('plan') : ajustes();
    h += `<button class="fab" id="btn-add">+</button>
          <nav>${[['res', 'Resumen'], ['mov', 'Movimientos'], ['plan', 'Planeado'], ['aj', 'Ajustes']].map(([k, t]) => `<a class="${tab === k ? 'on' : ''}" onclick="tab='${k}';render()">${t}</a>`).join('')}</nav>`;
    $('#app').innerHTML = h;

    const fab = $('#btn-add');
    if (fab) fab.onclick = form;
}

function resumen() {
    const gen = sum('ingreso', 'real'), gas = sum('gasto', 'real');
    const pg = sum('ingreso', 'plan'), pp = sum('gasto', 'plan');
    const disp = gen - gas, proy = disp + pg - pp;

    const realGastos = getFiltered('gasto', 'real');
    const catMap = {};
    realGastos.forEach(t => {
        catMap[t.category] = (catMap[t.category] || 0) + Number(t.amount);
    });

    const cats = Object.entries(catMap)
        .map(([c, s]) => ({ c, s }))
        .sort((a, b) => b.s - a.s);

    const mx = cats[0]?.s || 1;

    return `
    <div class="card">
        <h2>Disponible Real</h2>
        <div class="big ${disp < 0 ? 'ko' : ''}">${money(disp)}</div>
        <div class="mu" style="margin-top:4px">Ingresos acumulados − gastos ejecutados</div>
    </div>
    <div class="g">
        <div class="card"><h2>Ingresado</h2><b>${money(gen)}</b></div>
        <div class="card"><h2>Gastado</h2><b>${money(gas)}</b></div>
        <div class="card"><h2>Por Ingresar</h2><b class="mu">${money(pg)}</b></div>
        <div class="card"><h2>Por Gastar</h2><b class="mu">${money(pp)}</b></div>
    </div>
    <div class="card">
        <h2>Proyección Fin de Mes</h2>
        <div class="big" style="font-size:22px">${money(proy)}</div>
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
        <p style="font-size:14px; margin-top:8px;"><b>Usuario:</b> ${esc(displayName())}</p>
        <p style="font-size:14px; margin-top:4px;"><b>Correo:</b> ${esc(currentUser.email)}</p>
    </div>
    <div class="card">
        <h2>Sesión</h2>
        <button class="s" style="background:#e53e3e; color:white; border:none;" onclick="logout()">Cerrar sesión</button>
    </div>`;
}

// ==========================================
// 5. OPERACIONES CRUD (CREAR, ACTUALIZAR, BORRAR)
// ==========================================
function form() {
    const oldModal = $('#m');
    if (oldModal) oldModal.remove();

    const today = new Date().toISOString().slice(0, 10);
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
        <input id="f_d" type="date" value="${today}">
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
    const cats = isGasto ? CATS_GASTO : CATS_INGRESO;

    $('#form-title').textContent = isGasto ? 'Registrar Gasto' : 'Registrar Ingreso de Trabajo';
    $('#f_c').innerHTML = cats.map(c => `<option>${c}</option>`).join('');
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
        date: date
    };

    const { error } = await sb.from('transacciones').insert([newTx]);

    if (error) {
        return msg('error', 'Error al guardar', error.message);
    }

    const m = $('#m');
    if (m) m.remove();

    await loadData();
    render();
}

async function done(id) {
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await sb
        .from('transacciones')
        .update({ status: 'real', date: today })
        .eq('id', id);

    if (error) return msg('error', 'Error al actualizar', error.message);

    await loadData();
    render();
}

async function del(id) {
    if (!(await ask('¿Eliminar registro?', 'Esta acción no se puede deshacer.'))) return;

    const { error } = await sb
        .from('transacciones')
        .delete()
        .eq('id', id);

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
// 6. AUTENTICACIÓN (LOGIN Y REGISTRO)
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
        <div style="text-align:center; margin-top:14px;">
            <a style="color:var(--acc); font-size:13px; cursor:pointer;" onclick="showRegisterForm()">¿No tienes cuenta? Regístrate aquí</a>
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
        <div style="text-align:center; margin-top:14px;">
            <a style="color:var(--acc); font-size:13px; cursor:pointer;" onclick="login()">¿Ya tienes cuenta? Inicia sesión</a>
        </div>
    </div>`;

    $('#btn-do-register').onclick = registerUser;
    $('#reg_p').onkeydown = e => { if (e.key === 'Enter') registerUser(); };
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

    registering = true; // bloquea la entrada automática a la app

    // El usuario se guarda en los metadatos de la cuenta
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

    // Si Supabase abrió sesión automática, la cerramos para que inicie sesión él mismo
    await sb.auth.signOut();
    currentUser = null;
    transactions = [];
    registering = false;

    await msg('success', '¡Cuenta creada!', 'Tu cuenta se creó exitosamente. Ahora inicia sesión.');
    login();
}