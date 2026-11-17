/**
 * CAFETERÍA ARIES - PUNTO DE VENTA, CAJA Y FINANZAS
 * Precarga inmediata en caché (localStorage) + Sincronización con Google Sheets
 * Desarrollado por DIGITALITY
 */

const API_URL = "https://script.google.com/macros/s/AKfycbzbv7a6fO2JgnlP8BOcuMySchEjHC2IkLv3sN6rJnuNyTXj-FPPTjbVRUzmt5EU1T9X/exec";
const INTERVALO_AUTO_REFRESH_MS = 30000; // Auto-refresco cada 30 segundos

let state = {
  insumos: [],
  productos: [],
  ventas: [],
  movimientos: [],
  carrito: [],
  categoriaActual: 'Todas',
  busqueda: '',
  busquedaVenta: '',
  metodoPago: 'Efectivo'
};

let timerAutoRefreshPOS = null;
let sincronizandoPOS = false;

// =========================================================
// PRECARGA INMEDIATA ANTES DEL RENDERIZADO (0ms DE ESPERA)
// =========================================================
(function precargarCachePOS() {
  try {
    state.insumos = JSON.parse(localStorage.getItem('aries_insumos') || '[]');
    state.productos = JSON.parse(localStorage.getItem('aries_productos') || '[]');
    state.ventas = JSON.parse(localStorage.getItem('aries_ventas') || '[]');
    state.movimientos = JSON.parse(localStorage.getItem('aries_movimientos') || '[]');
  } catch (e) {
    console.warn('No se pudo leer caché inicial:', e);
  }
})();

const promesaInicialSheets = fetch(`${API_URL}?action=getData&t=${Date.now()}`)
  .then(res => res.json())
  .catch(() => null);

// =========================================================
// INICIALIZACIÓN DEL DOM
// =========================================================
document.addEventListener('DOMContentLoaded', async () => {
  configurarEventosPOS();
  configurarFormularioMovimiento();

  const habiaCache = state.productos.length > 0 || state.insumos.length > 0;
  if (habiaCache) {
    actualizarVistaPOS();
    setSyncStatus(true, 'Actualizando catálogo...');
  } else {
    mostrarSkeletonCatalogo();
    setSyncStatus(true, 'Precargando desde Sheets...');
  }

  const dataInicial = await promesaInicialSheets;
  if (dataInicial && dataInicial.status === 'success') {
    procesarYGuardarDatosSheets(dataInicial);
    actualizarVistaPOS();
    setSyncStatus(false, 'Conectado');
  } else {
    await cargarDatosPOS(habiaCache);
  }

  iniciarAutoRefreshPOS();

  window.addEventListener('storage', (e) => {
    if (['aries_insumos', 'aries_productos', 'aries_ventas', 'aries_movimientos'].includes(e.key)) {
      cargarDesdeLocal();
      actualizarVistaPOS();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      cargarDatosPOS(true);
    }
  });
});

function iniciarAutoRefreshPOS() {
  if (timerAutoRefreshPOS) clearInterval(timerAutoRefreshPOS);
  timerAutoRefreshPOS = setInterval(() => {
    if (!document.hidden) {
      cargarDatosPOS(true);
    }
  }, INTERVALO_AUTO_REFRESH_MS);
}

function mostrarSkeletonCatalogo() {
  const grid = document.getElementById('grid-productos');
  if (!grid) return;
  grid.innerHTML = `
    <div style="grid-column: 1/-1; text-align:center; padding: 2.5rem 1rem; color: var(--text-muted);">
      <i class="ri-loader-4-line" style="font-size: 2rem; display:inline-block; animation: spin 1s linear infinite; margin-bottom:0.5rem;"></i>
      <p><strong>Precargando productos desde Google Sheets...</strong></p>
      <p style="font-size:0.82rem; margin-top:0.25rem;">Se guardarán en caché para que la próxima entrada sea instantánea.</p>
    </div>
    <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
  `;
}

function procesarYGuardarDatosSheets(data) {
  state.insumos = (data.insumos || []).map(i => ({
    ...i,
    stock: parseFloat(i.stock) || 0,
    minimo: parseFloat(i.minimo) || 0
  }));

  state.productos = (data.productos || []).map(p => {
    let recetaParsed = [];
    try {
      recetaParsed = typeof p.receta === 'string' && p.receta.trim() !== ''
        ? JSON.parse(p.receta)
        : (Array.isArray(p.receta) ? p.receta : []);
    } catch (e) {
      recetaParsed = [];
    }

    const esPostre = p.categoria === 'Postres' || p.usaReceta === 'NO' || p.usaReceta === false;
    return {
      ...p,
      precio: parseFloat(p.precio) || 0,
      usaReceta: !esPostre && recetaParsed.length > 0,
      receta: esPostre ? [] : recetaParsed
    };
  });

  state.ventas = (data.ventas || []).map(v => {
    let itemsParsed = [];
    try {
      itemsParsed = typeof v.items === 'string' && v.items.trim() !== ''
        ? JSON.parse(v.items)
        : (Array.isArray(v.items) ? v.items : []);
    } catch (e) {
      itemsParsed = [];
    }
    return {
      ...v,
      total: parseFloat(v.total) || 0,
      pagoCon: parseFloat(v.pagoCon) || parseFloat(v.total) || 0,
      cambio: parseFloat(v.cambio) || 0,
      items: itemsParsed
    };
  }).reverse();

  state.movimientos = (data.movimientos || []).map(m => ({
    ...m,
    monto: parseFloat(m.monto) || 0
  })).reverse();

  guardarEnLocal();
}

function cambiarSubPanel(idSubPanel, btn) {
  document.querySelectorAll('.subnav-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  document.querySelectorAll('.subpanel').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(idSubPanel);
  if (target) target.classList.add('active');

  const mobileBar = document.getElementById('mobile-cart-bar');
  if (mobileBar) {
    if (idSubPanel === 'vista-pos' && state.carrito.length > 0) {
      mobileBar.classList.remove('hidden');
    } else {
      mobileBar.classList.add('hidden');
    }
  }

  if (idSubPanel === 'vista-gastos') {
    renderizarTablaMovimientos();
  } else if (idSubPanel === 'vista-resumen') {
    renderizarResumenYVentas();
  }
}

async function cargarDatosPOS(silencioso = false) {
  if (sincronizandoPOS) return;
  sincronizandoPOS = true;
  setSyncStatus(true, silencioso ? 'Sincronizando...' : 'Consultando...');

  try {
    const res = await fetch(`${API_URL}?action=getData&t=${Date.now()}`);
    const data = await res.json();

    if (data.status === 'success') {
      procesarYGuardarDatosSheets(data);
      actualizarVistaPOS();
      setSyncStatus(false, 'Conectado');
    } else {
      throw new Error(data.message || 'Respuesta inválida de Sheets');
    }
  } catch (err) {
    console.error('Error al consultar Google Sheets:', err);
    cargarDesdeLocal();
    actualizarVistaPOS();
    setSyncStatus(false, 'Modo Local (Caché)');
    if (!silencioso) {
      mostrarToast('Sin conexión con Sheets. Mostrando productos en caché.', 'warning');
    }
  } finally {
    sincronizandoPOS = false;
  }
}

function cargarDesdeLocal() {
  try {
    state.insumos = JSON.parse(localStorage.getItem('aries_insumos') || '[]');
    state.productos = JSON.parse(localStorage.getItem('aries_productos') || '[]');
    state.ventas = JSON.parse(localStorage.getItem('aries_ventas') || '[]');
    state.movimientos = JSON.parse(localStorage.getItem('aries_movimientos') || '[]');
  } catch (e) {}
}

function guardarEnLocal() {
  localStorage.setItem('aries_insumos', JSON.stringify(state.insumos));
  localStorage.setItem('aries_productos', JSON.stringify(state.productos));
  localStorage.setItem('aries_ventas', JSON.stringify(state.ventas));
  localStorage.setItem('aries_movimientos', JSON.stringify(state.movimientos));
}

function actualizarVistaPOS() {
  verificarAlertasStock();
  actualizarKPIsDelDia();
  renderizarCatalogoPOS();
  renderizarCarrito();
  renderizarTablaMovimientos();
  renderizarResumenYVentas();
}

// =========================================================
// RESUMEN ECONÓMICO DEL DÍA Y SEMANAL
// =========================================================
function esHoy(fechaISO) {
  if (!fechaISO) return false;
  const hoy = new Date().toISOString().split('T')[0];
  return String(fechaISO).startsWith(hoy);
}

function esUltimos7Dias(fechaISO) {
  if (!fechaISO) return true;
  const fecha = new Date(fechaISO);
  if (isNaN(fecha.getTime())) return true;
  const hace7Dias = new Date();
  hace7Dias.setDate(hace7Dias.getDate() - 7);
  return fecha >= hace7Dias;
}

function actualizarKPIsDelDia() {
  const ventasHoy = state.ventas
    .filter(v => esHoy(v.fechaISO))
    .reduce((sum, v) => sum + (parseFloat(v.total) || 0), 0);

  const entradasHoy = state.movimientos
    .filter(m => esHoy(m.fechaISO) && m.tipo === 'INGRESO')
    .reduce((sum, m) => sum + (parseFloat(m.monto) || 0), 0);

  const gastosHoy = state.movimientos
    .filter(m => esHoy(m.fechaISO) && m.tipo === 'EGRESO')
    .reduce((sum, m) => sum + (parseFloat(m.monto) || 0), 0);

  const balanceHoy = (ventasHoy + entradasHoy) - gastosHoy;

  document.getElementById('kpi-ventas-hoy').textContent = `$${ventasHoy.toFixed(2)}`;
  document.getElementById('kpi-entradas-hoy').textContent = `$${entradasHoy.toFixed(2)}`;
  document.getElementById('kpi-gastos-hoy').textContent = `$${gastosHoy.toFixed(2)}`;
  document.getElementById('kpi-balance-hoy').textContent = `$${balanceHoy.toFixed(2)}`;
}

// =========================================================
// SUB-PANEL 2: GASTOS Y ENTRADAS DE CAJA
// =========================================================
function configurarFormularioMovimiento() {
  const form = document.getElementById('form-movimiento');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nuevoMov = {
      id: 'MOV-' + Date.now(),
      fecha: new Date().toLocaleString('es-MX'),
      fechaISO: new Date().toISOString(),
      tipo: document.getElementById('mov-tipo').value,
      categoria: document.getElementById('mov-categoria').value,
      concepto: document.getElementById('mov-concepto').value.trim(),
      monto: parseFloat(document.getElementById('mov-monto').value),
      metodo: document.getElementById('mov-metodo').value
    };

    state.movimientos.unshift(nuevoMov);
    guardarEnLocal();
    actualizarKPIsDelDia();
    renderizarTablaMovimientos();
    renderizarResumenYVentas();
    e.target.reset();

    mostrarToast(
      nuevoMov.tipo === 'EGRESO'
        ? `Gasto registrado: -$${nuevoMov.monto.toFixed(2)}`
        : `Entrada registrada: +$${nuevoMov.monto.toFixed(2)}`,
      nuevoMov.tipo === 'EGRESO' ? 'warning' : 'success'
    );

    await enviarASheets('registrarMovimiento', nuevoMov);
  });
}

function renderizarTablaMovimientos() {
  const tbodyMovs = document.getElementById('tabla-movimientos-panel');
  if (!tbodyMovs) return;

  if (state.movimientos.length === 0) {
    tbodyMovs.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No hay gastos ni entradas extra registrados.</td></tr>`;
    return;
  }

  tbodyMovs.innerHTML = state.movimientos.map(m => {
    const esIngreso = m.tipo === 'INGRESO';
    return `
      <tr>
        <td><small>${m.fecha}</small></td>
        <td><span class="pill-tipo ${esIngreso ? 'pill-ingreso' : 'pill-egreso'}">${esIngreso ? 'ENTRADA' : 'GASTO'}</span></td>
        <td>${m.categoria}</td>
        <td>${m.concepto}</td>
        <td>${m.metodo}</td>
        <td><strong class="${esIngreso ? 'text-success' : 'text-danger'}">${esIngreso ? '+' : '-'}$${parseFloat(m.monto).toFixed(2)}</strong></td>
      </tr>
    `;
  }).join('');
}

// =========================================================
// SUB-PANEL 3: RESUMEN SEMANAL E HISTORIAL DE VENTAS
// =========================================================
function renderizarResumenYVentas() {
  const ventasSem = state.ventas.filter(v => esUltimos7Dias(v.fechaISO));
  const movsSem = state.movimientos.filter(m => esUltimos7Dias(m.fechaISO));

  const totalVentasSem = ventasSem.reduce((s, v) => s + (parseFloat(v.total) || 0), 0);
  const totalEntradasSem = movsSem.filter(m => m.tipo === 'INGRESO').reduce((s, m) => s + (parseFloat(m.monto) || 0), 0);
  const totalGastosSem = movsSem.filter(m => m.tipo === 'EGRESO').reduce((s, m) => s + (parseFloat(m.monto) || 0), 0);
  const utilidadSem = (totalVentasSem + totalEntradasSem) - totalGastosSem;

  document.getElementById('sem-ventas').textContent = `$${totalVentasSem.toFixed(2)}`;
  document.getElementById('sem-tickets').textContent = `${ventasSem.length} ventas registradas`;
  document.getElementById('sem-entradas').textContent = `$${totalEntradasSem.toFixed(2)}`;
  document.getElementById('sem-gastos').textContent = `$${totalGastosSem.toFixed(2)}`;
  document.getElementById('sem-utilidad').textContent = `$${utilidadSem.toFixed(2)}`;

  const tbodyVentas = document.getElementById('tabla-historial-ventas');
  if (!tbodyVentas) return;

  const filtradas = state.ventas.filter(v => {
    if (!state.busquedaVenta) return true;
    const textoItems = (v.items || []).map(i => i.nombre).join(' ').toLowerCase();
    return (
      String(v.id).toLowerCase().includes(state.busquedaVenta) ||
      String(v.metodoPago).toLowerCase().includes(state.busquedaVenta) ||
      textoItems.includes(state.busquedaVenta)
    );
  });

  if (filtradas.length === 0) {
    tbodyVentas.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.5rem;">Aún no hay ventas registradas que coincidan.</td></tr>`;
    return;
  }

  tbodyVentas.innerHTML = filtradas.map(v => {
    const resumenItems = (v.items || []).map(i => `${i.cantidad}x ${i.nombre}`).join(', ');
    return `
      <tr>
        <td><strong>${v.id}</strong><br><small style="color:var(--text-muted)">${v.fecha}</small></td>
        <td>${resumenItems}</td>
        <td>${v.metodoPago}</td>
        <td>$${(parseFloat(v.pagoCon) || parseFloat(v.total)).toFixed(2)}</td>
        <td>$${(parseFloat(v.cambio) || 0).toFixed(2)}</td>
        <td><strong class="text-success">$${parseFloat(v.total).toFixed(2)}</strong></td>
      </tr>
    `;
  }).join('');
}

// =========================================================
// ALERTAS DE STOCK BAJO
// =========================================================
function verificarAlertasStock() {
  const bajos = state.insumos.filter(i => i.stock <= i.minimo);
  const badge = document.getElementById('badge-alertas');
  const banner = document.getElementById('alerta-banner');
  const mensaje = document.getElementById('alerta-mensaje');

  if (bajos.length > 0) {
    badge.textContent = bajos.length;
    badge.classList.remove('hidden');
    banner.classList.remove('hidden');

    const nombres = bajos.map(i => `${i.nombre} (${i.stock} ${i.unidad})`).join(', ');
    mensaje.textContent = `¡Insumos por terminarse! Reabastecer: ${nombres}`;
  } else {
    badge.classList.add('hidden');
    banner.classList.add('hidden');
  }
}

// =========================================================
// SUB-PANEL 1: CATÁLOGO Y CARRITO POS
// =========================================================
function configurarEventosPOS() {
  document.getElementById('buscar-producto').addEventListener('input', (e) => {
    state.busqueda = e.target.value.toLowerCase();
    renderizarCatalogoPOS();
  });

  const inputBuscarVenta = document.getElementById('buscar-venta');
  if (inputBuscarVenta) {
    inputBuscarVenta.addEventListener('input', (e) => {
      state.busquedaVenta = e.target.value.toLowerCase();
      renderizarResumenYVentas();
    });
  }

  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.categoriaActual = btn.dataset.cat;
      renderizarCatalogoPOS();
    });
  });

  document.querySelectorAll('.pay-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pay-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.metodoPago = btn.dataset.method;

      const cajaEfectivo = document.getElementById('caja-efectivo');
      cajaEfectivo.classList.toggle('hidden', state.metodoPago !== 'Efectivo');
    });
  });

  document.getElementById('monto-recibido').addEventListener('input', calcularCambio);

  document.getElementById('btn-limpiar-ticket').addEventListener('click', () => {
    state.carrito = [];
    document.getElementById('monto-recibido').value = '';
    renderizarCarrito();
  });

  document.getElementById('btn-completar-venta').addEventListener('click', procesarVenta);
}

function verificarDisponibilidadProducto(producto) {
  if (!producto.usaReceta || producto.categoria === 'Postres' || !producto.receta || producto.receta.length === 0) {
    return true;
  }
  for (const item of producto.receta) {
    const insumo = state.insumos.find(i => i.id === item.idInsumo);
    if (!insumo || insumo.stock < item.cantidad) {
      return false;
    }
  }
  return true;
}

function renderizarCatalogoPOS() {
  const grid = document.getElementById('grid-productos');
  if (!grid) return;

  if (state.productos.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align:center; padding: 2.5rem 1rem; color: var(--text-muted);">
        <i class="ri-store-3-line" style="font-size: 2.5rem; opacity: 0.4; display:block; margin-bottom:0.5rem;"></i>
        <p><strong>No hay productos registrados todavía.</strong></p>
        <p style="font-size:0.85rem; margin-top:0.35rem;">Ve a <strong>Inventario y Recetas</strong> para dar de alta tus bebidas y postres.</p>
      </div>`;
    return;
  }

  const filtrados = state.productos.filter(p => {
    const coincideCat = state.categoriaActual === 'Todas' || p.categoria === state.categoriaActual;
    const coincideBusq = p.nombre.toLowerCase().includes(state.busqueda);
    return coincideCat && coincideBusq;
  });

  if (filtrados.length === 0) {
    grid.innerHTML = `<p style="color:var(--text-muted); grid-column: 1/-1;">No se encontraron productos en esta categoría.</p>`;
    return;
  }

  grid.innerHTML = filtrados.map(prod => {
    const esPostre = prod.categoria === 'Postres' || !prod.usaReceta;
    const disponible = verificarDisponibilidadProducto(prod);

    return `
      <div class="product-card ${disponible ? '' : 'sin-stock'}" 
           onclick="${disponible ? `agregarAlCarrito('${prod.id}')` : `mostrarToast('Insumos insuficientes para preparar ${prod.nombre}', 'error')`}">
        ${!disponible ? '<span class="tag-agotado">Sin Insumos</span>' : ''}
        <div>
          <span class="prod-cat-tag ${esPostre ? 'postre' : ''}">${prod.categoria}</span>
          <h3>${prod.nombre}</h3>
        </div>
        <div class="prod-footer-card">
          <div class="prod-price">$${prod.precio.toFixed(2)}</div>
          <span class="prod-type-hint">${esPostre ? 'Directo' : 'Con receta'}</span>
        </div>
      </div>
    `;
  }).join('');
}

function agregarAlCarrito(idProducto) {
  const prod = state.productos.find(p => p.id === idProducto);
  if (!prod) return;

  const existente = state.carrito.find(item => item.id === idProducto);
  if (existente) {
    existente.cantidad += 1;
  } else {
    state.carrito.push({ ...prod, cantidad: 1 });
  }
  renderizarCarrito();
}

function cambiarCantidadCarrito(idProducto, delta) {
  const index = state.carrito.findIndex(item => item.id === idProducto);
  if (index === -1) return;

  state.carrito[index].cantidad += delta;
  if (state.carrito[index].cantidad <= 0) {
    state.carrito.splice(index, 1);
  }
  renderizarCarrito();
}

function calcularCambio() {
  const total = state.carrito.reduce((acc, i) => acc + (i.precio * i.cantidad), 0);
  const recibido = parseFloat(document.getElementById('monto-recibido').value) || 0;
  const cambioEl = document.getElementById('monto-cambio');

  if (recibido >= total && total > 0) {
    cambioEl.textContent = `$${(recibido - total).toFixed(2)}`;
    cambioEl.style.color = 'var(--success)';
  } else {
    cambioEl.textContent = '$0.00';
    cambioEl.style.color = 'var(--text-muted)';
  }
}

function renderizarCarrito() {
  const container = document.getElementById('ticket-items');
  const btnCheckout = document.getElementById('btn-completar-venta');
  const mobileBar = document.getElementById('mobile-cart-bar');

  if (state.carrito.length === 0) {
    container.innerHTML = `
      <div class="empty-ticket">
        <i class="ri-cup-line"></i>
        <p>Selecciona bebidas o postres del menú para iniciar la venta</p>
      </div>`;
    document.getElementById('ticket-cantidad').textContent = '0';
    document.getElementById('ticket-total').textContent = '$0.00';
    document.getElementById('monto-cambio').textContent = '$0.00';
    btnCheckout.disabled = true;

    if (mobileBar) mobileBar.classList.add('hidden');
    return;
  }

  let totalArticulos = 0;
  let totalDinero = 0;

  container.innerHTML = state.carrito.map(item => {
    const subtotal = item.precio * item.cantidad;
    totalArticulos += item.cantidad;
    totalDinero += subtotal;

    return `
      <div class="ticket-item">
        <div class="item-info">
          <h4>${item.nombre}</h4>
          <span>$${item.precio.toFixed(2)} c/u • Subtotal: $${subtotal.toFixed(2)}</span>
        </div>
        <div class="item-controls">
          <button class="qty-btn" onclick="cambiarCantidadCarrito('${item.id}', -1)">-</button>
          <strong>${item.cantidad}</strong>
          <button class="qty-btn" onclick="cambiarCantidadCarrito('${item.id}', 1)">+</button>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('ticket-cantidad').textContent = totalArticulos;
  document.getElementById('ticket-total').textContent = `$${totalDinero.toFixed(2)}`;
  btnCheckout.disabled = false;
  calcularCambio();

  if (mobileBar) {
    const vistaPosActiva = document.getElementById('vista-pos')?.classList.contains('active');
    document.getElementById('mobile-cart-count').textContent = totalArticulos;
    document.getElementById('mobile-cart-total').textContent = `$${totalDinero.toFixed(2)}`;
    mobileBar.classList.toggle('hidden', !vistaPosActiva);
  }
}

function irAOrdenActual() {
  const ticketEl = document.getElementById('panel-orden-actual');
  if (ticketEl) {
    ticketEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function procesarVenta() {
  if (state.carrito.length === 0) return;

  const totalVenta = state.carrito.reduce((acc, i) => acc + (i.precio * i.cantidad), 0);
  const recibido = parseFloat(document.getElementById('monto-recibido').value) || totalVenta;

  if (state.metodoPago === 'Efectivo' && document.getElementById('monto-recibido').value !== '' && recibido < totalVenta) {
    mostrarToast('El monto recibido es menor al total a cobrar.', 'warning');
    return;
  }

  const descuentosTotales = {};

  for (const itemCarrito of state.carrito) {
    if (itemCarrito.usaReceta && itemCarrito.categoria !== 'Postres' && Array.isArray(itemCarrito.receta)) {
      for (const ing of itemCarrito.receta) {
        const totalIngrediente = ing.cantidad * itemCarrito.cantidad;
        descuentosTotales[ing.idInsumo] = (descuentosTotales[ing.idInsumo] || 0) + totalIngrediente;
      }
    }
  }

  for (const [idInsumo, requerido] of Object.entries(descuentosTotales)) {
    const insumo = state.insumos.find(i => i.id === idInsumo);
    if (!insumo || insumo.stock < requerido) {
      mostrarToast(`Stock insuficiente de: ${insumo ? insumo.nombre : idInsumo}`, 'error');
      return;
    }
  }

  for (const [idInsumo, requerido] of Object.entries(descuentosTotales)) {
    const insumo = state.insumos.find(i => i.id === idInsumo);
    if (insumo) {
      insumo.stock = Math.max(0, parseFloat((insumo.stock - requerido).toFixed(2)));
    }
  }

  const cambio = state.metodoPago === 'Efectivo' ? Math.max(0, recibido - totalVenta) : 0;
  const ahora = new Date();

  const ventaPayload = {
    id: 'VTA-' + Date.now(),
    fecha: ahora.toLocaleString('es-MX'),
    fechaISO: ahora.toISOString(),
    items: state.carrito.map(i => ({
      nombre: i.nombre,
      categoria: i.categoria,
      cantidad: i.cantidad,
      precio: i.precio
    })),
    total: totalVenta,
    metodoPago: state.metodoPago,
    pagoCon: recibido,
    cambio: cambio,
    descuentos: descuentosTotales
  };

  state.ventas.unshift(ventaPayload);
  state.carrito = [];
  document.getElementById('monto-recibido').value = '';
  guardarEnLocal();
  actualizarVistaPOS();

  mostrarToast(`Venta cobrada ($${totalVenta.toFixed(2)}) y enviada a Sheets`, 'success');

  await enviarASheets('registrarVenta', ventaPayload);
}

// =========================================================
// CONEXIÓN CON GOOGLE SHEETS
// =========================================================
async function enviarASheets(action, payload) {
  setSyncStatus(true, 'Guardando en Sheets...');
  try {
    await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({ action, payload })
    });
    setSyncStatus(false, 'Conectado');
  } catch (err) {
    console.error('Error enviando datos a Sheets:', err);
    setSyncStatus(false, 'Error de red');
    mostrarToast('Error de red al guardar en Google Sheets.', 'error');
  }
}

function setSyncStatus(syncing, text) {
  const dot = document.querySelector('.status-sync .dot');
  const label = document.getElementById('sync-text');
  if (dot) dot.classList.toggle('syncing', syncing);
  if (label) label.textContent = text;
}

function mostrarToast(mensaje, tipo = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  toast.textContent = mensaje;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 3800);
}