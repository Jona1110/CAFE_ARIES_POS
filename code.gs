/**
 * BACKEND API - CAFETERÍA ARIES (POS + FINANZAS + INVENTARIO)
 * Desarrollado por DIGITALITY
 */

const SS = SpreadsheetApp.getActiveSpreadsheet();

function getOrCreateSheet(name, headers) {
  let sheet = SS.getSheetByName(name);
  if (!sheet) {
    sheet = SS.insertSheet(name);
  }
  if (sheet.getLastRow() === 0 && headers && headers.length > 0) {
    sheet.appendRow(headers);
  }
  return sheet;
}

function doGet(e) {
  const action = e.parameter.action;
  
  if (action === 'getData') {
    return jsonResponse({
      status: 'success',
      insumos: getSheetData('Insumos'),
      productos: getSheetData('Productos'),
      ventas: getSheetData('Ventas'),
      movimientos: getSheetData('Movimientos')
    });
  }
  
  return jsonResponse({ status: 'error', message: 'Acción GET no válida' });
}

function doPost(e) {
  try {
    const raw = e.postData ? e.postData.contents : '{}';
    const data = JSON.parse(raw);
    const action = data.action;

    switch (action) {
      case 'registrarVenta':
        return registrarVenta(data.payload);
      case 'registrarMovimiento':
        return registrarMovimiento(data.payload);
      case 'guardarProducto':
        return guardarOEditarProducto(data.payload);
      case 'eliminarProducto':
        return eliminarFilaPorId('Productos', data.payload.id);
      case 'guardarInsumo':
        return guardarOEditarInsumo(data.payload);
      case 'eliminarInsumo':
        return eliminarFilaPorId('Insumos', data.payload.id);
      case 'reabastecerInsumo':
        return reabastecerInsumo(data.payload);
      default:
        return jsonResponse({ status: 'error', message: 'Acción POST no válida' });
    }
  } catch (error) {
    return jsonResponse({ status: 'error', message: error.toString() });
  }
}

function getSheetData(sheetName) {
  const sheet = SS.getSheetByName(sheetName);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  
  const headers = rows[0];
  return rows.slice(1).map(row => {
    let obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

// --- REGISTRAR VENTA + DESCUENTO INSUMOS + ENTRADA ECONÓMICA ---
function registrarVenta(venta) {
  const sheetVentas = getOrCreateSheet('Ventas', [
    'id', 'fecha', 'fechaISO', 'items', 'total', 'metodoPago', 'pagoCon', 'cambio'
  ]);
  const sheetInsumos = getOrCreateSheet('Insumos', [
    'id', 'nombre', 'unidad', 'stock', 'minimo'
  ]);

  sheetVentas.appendRow([
    venta.id,
    venta.fecha,
    venta.fechaISO || new Date().toISOString(),
    JSON.stringify(venta.items),
    venta.total,
    venta.metodoPago,
    venta.pagoCon || venta.total,
    venta.cambio || 0
  ]);

  // Descontar insumos de recetas (Postres no descuentan)
  if (venta.descuentos && Object.keys(venta.descuentos).length > 0) {
    const insumosData = sheetInsumos.getDataRange().getValues();
    for (let i = 1; i < insumosData.length; i++) {
      const idInsumo = insumosData[i][0];
      if (venta.descuentos[idInsumo]) {
        const stockActual = parseFloat(insumosData[i][3]) || 0;
        const nuevoStock = Math.max(0, stockActual - parseFloat(venta.descuentos[idInsumo]));
        sheetInsumos.getRange(i + 1, 4).setValue(nuevoStock);
      }
    }
  }

  return jsonResponse({ status: 'success', message: 'Venta guardada en Sheets' });
}

// --- REGISTRAR GASTOS / SALIDAS / ENTRADAS EXTRA ---
function registrarMovimiento(mov) {
  const sheet = getOrCreateSheet('Movimientos', [
    'id', 'fecha', 'fechaISO', 'tipo', 'categoria', 'concepto', 'monto', 'metodo'
  ]);

  sheet.appendRow([
    mov.id,
    mov.fecha,
    mov.fechaISO || new Date().toISOString(),
    mov.tipo,       // 'INGRESO' o 'EGRESO'
    mov.categoria,  // 'Insumos', 'Servicios', 'Nómina', 'Fondo Caja', 'Otros'
    mov.concepto,
    mov.monto,
    mov.metodo
  ]);

  return jsonResponse({ status: 'success', message: 'Movimiento financiero registrado' });
}

// --- CRUD PRODUCTOS ---
function guardarOEditarProducto(prod) {
  const sheet = getOrCreateSheet('Productos', ['id', 'nombre', 'categoria', 'precio', 'usaReceta', 'receta']);
  const rows = sheet.getDataRange().getValues();
  const filaDatos = [
    prod.id,
    prod.nombre,
    prod.categoria,
    prod.precio,
    prod.usaReceta ? 'SI' : 'NO',
    JSON.stringify(prod.receta || [])
  ];

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === prod.id) {
      sheet.getRange(i + 1, 1, 1, filaDatos.length).setValues([filaDatos]);
      return jsonResponse({ status: 'success', message: 'Producto actualizado' });
    }
  }

  sheet.appendRow(filaDatos);
  return jsonResponse({ status: 'success', message: 'Producto creado' });
}

// --- CRUD INSUMOS ---
function guardarOEditarInsumo(insumo) {
  const sheet = getOrCreateSheet('Insumos', ['id', 'nombre', 'unidad', 'stock', 'minimo']);
  const rows = sheet.getDataRange().getValues();
  const filaDatos = [
    insumo.id,
    insumo.nombre,
    insumo.unidad,
    insumo.stock,
    insumo.minimo
  ];

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === insumo.id) {
      sheet.getRange(i + 1, 1, 1, filaDatos.length).setValues([filaDatos]);
      return jsonResponse({ status: 'success', message: 'Insumo actualizado' });
    }
  }

  sheet.appendRow(filaDatos);
  return jsonResponse({ status: 'success', message: 'Insumo creado' });
}

function reabastecerInsumo(datos) {
  const sheet = getOrCreateSheet('Insumos', ['id', 'nombre', 'unidad', 'stock', 'minimo']);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === datos.id) {
      const actual = parseFloat(rows[i][3]) || 0;
      sheet.getRange(i + 1, 4).setValue(actual + parseFloat(datos.cantidad));
      break;
    }
  }
  return jsonResponse({ status: 'success', message: 'Stock actualizado' });
}

function eliminarFilaPorId(sheetName, id) {
  const sheet = SS.getSheetByName(sheetName);
  if (!sheet) return jsonResponse({ status: 'error', message: 'Hoja no existe' });
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      sheet.deleteRow(i + 1);
      return jsonResponse({ status: 'success', message: 'Registro eliminado' });
    }
  }
  return jsonResponse({ status: 'error', message: 'ID no encontrado' });
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}