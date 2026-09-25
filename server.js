const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const MENU = require('./menu.json');

const STAFF_PASSWORD = process.env.STAFF_PASSWORD;
if (!STAFF_PASSWORD) {
  throw new Error('Falta la variable de entorno STAFF_PASSWORD');
}
const PORT = process.env.PORT || 3000;
// Integración con cafeteria-control (opcional: sin estas variables el botón
// "Enviar a cafeteria-control" responde que no está configurado).
const CONTROL_URL = process.env.CONTROL_URL;
const CONTROL_SECRET = process.env.CONTROL_INTEGRACION_SECRET;
const ESTADOS_VALIDOS = ['pendiente', 'confirmada', 'cancelada', 'completada'];
const MESAS = {
  general: { min: 1, max: 12 },
  vip1: { min: 6, max: 10 },
  vip2: { min: 2, max: 4 }
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reservas (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      celular TEXT NOT NULL,
      juego TEXT NOT NULL,
      fecha DATE NOT NULL,
      hora TEXT NOT NULL,
      personas INTEGER NOT NULL DEFAULT 2,
      estado TEXT NOT NULL DEFAULT 'pendiente',
      notas TEXT,
      creado TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE reservas ADD COLUMN IF NOT EXISTS mesa TEXT NOT NULL DEFAULT 'general';
    ALTER TABLE reservas ADD COLUMN IF NOT EXISTS pedido JSONB;
    ALTER TABLE reservas ADD COLUMN IF NOT EXISTS pedido_enviado_a TEXT;
    ALTER TABLE reservas ADD COLUMN IF NOT EXISTS pedido_enviado_at TIMESTAMP;
  `);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Menú de comida para el catálogo (sin los nombres internos de cafeteria-control)
app.get('/api/menu', (req, res) => {
  const limpio = (i) => ({ id: i.id, grupo: i.grupo, nombre: i.nombre, detalle: i.detalle, color: i.color, foto: i.foto, variantes: i.variantes });
  res.json({ pociones: MENU.pociones.map(limpio), botines: MENU.botines.map(limpio) });
});

// Envuelve un handler async: si la promesa rechaza (p.ej. Postgres rechaza
// una fecha mal formada), lo pasa al middleware de errores en vez de quedar
// como una promesa sin capturar (eso colgaba o hacía fallar la función sin
// dar ninguna respuesta clara al cliente).
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^\d{2}:\d{2}$/;

const POCIONES = new Map(MENU.pociones.map(i => [i.id, i]));
const BOTINES = new Map(MENU.botines.map(i => [i.id, i]));

// Valida y normaliza el pedido de comida: exactamente una poción y un botín por
// persona. Devuelve { pedido } (o null si no hay pedido) o { error }.
function normalizarPedido(raw, personas) {
  if (raw === undefined || raw === null) return { pedido: null };
  if (!Array.isArray(raw) || raw.length !== personas) {
    return { error: 'El pedido de comida debe tener una poción y un botín por persona' };
  }
  const pedido = [];
  for (const p of raw) {
    const pocion = p && POCIONES.get(p.pocion);
    const botin = p && BOTINES.get(p.botin);
    if (!pocion || !botin) return { error: 'El pedido de comida tiene productos que no existen' };
    let variante = null;
    if (pocion.variantes) {
      const v = pocion.variantes[Number(p.variante)];
      if (!v) return { error: 'Escoge el color de la limonada' };
      variante = v.nombre;
    }
    pedido.push({
      nombre: String(p.nombre || '').trim().slice(0, 40),
      pocion: { id: pocion.id, nombre: pocion.nombre, variante },
      botin: { id: botin.id, nombre: botin.nombre }
    });
  }
  return { pedido };
}

async function llamarControl(ruta, opciones = {}) {
  if (!CONTROL_URL || !CONTROL_SECRET) {
    const err = new Error('La integración con cafeteria-control no está configurada');
    err.status = 503;
    throw err;
  }
  const resp = await fetch(CONTROL_URL + ruta, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CONTROL_SECRET },
    signal: AbortSignal.timeout(15000)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data.error || 'cafeteria-control respondió con un error');
    err.status = resp.status === 409 || resp.status === 422 || resp.status === 404 ? resp.status : 502;
    throw err;
  }
  return data;
}

function requireStaff(req, res, next) {
  if (req.body.password !== STAFF_PASSWORD) {
    return res.status(401).json({ error: 'Contraseña de staff incorrecta' });
  }
  next();
}

// Cliente: crear una reserva
app.post('/api/reservas', ah(async (req, res) => {
  const { nombre, celular, juego, fecha, hora, notas } = req.body;
  let { personas, mesa } = req.body;

  if (!nombre || !celular || !juego || !fecha || !hora) {
    return res.status(400).json({ error: 'Faltan datos de la reserva' });
  }
  if (String(celular).replace(/\D/g, '').length < 7) {
    return res.status(400).json({ error: 'El celular no es válido' });
  }
  if (!FECHA_RE.test(fecha)) {
    return res.status(400).json({ error: 'La fecha no es válida' });
  }
  if (!HORA_RE.test(hora)) {
    return res.status(400).json({ error: 'La hora no es válida' });
  }

  if (!MESAS[mesa]) mesa = 'general';
  const { min, max } = MESAS[mesa];
  personas = Number(personas) || min;
  personas = Math.min(Math.max(personas, min), max);

  const { pedido, error: pedidoError } = normalizarPedido(req.body.pedido, personas);
  if (pedidoError) return res.status(400).json({ error: pedidoError });

  const id = crypto.randomBytes(6).toString('hex');
  await pool.query(
    `INSERT INTO reservas (id, nombre, celular, juego, mesa, fecha, hora, personas, notas, pedido)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, nombre, celular, juego, mesa, fecha, hora, personas, notas || null, pedido ? JSON.stringify(pedido) : null]
  );

  res.json({ id });
}));

// Staff: listar reservas (opcionalmente filtradas por fecha)
app.post('/api/reservas/list', requireStaff, ah(async (req, res) => {
  const { fecha } = req.body;
  const result = fecha
    ? await pool.query('SELECT * FROM reservas WHERE fecha = $1 ORDER BY hora', [fecha])
    : await pool.query(
        `SELECT * FROM reservas WHERE fecha >= CURRENT_DATE
         ORDER BY fecha, hora LIMIT 100`
      );
  res.json(result.rows);
}));

// Staff: cambiar el estado de una reserva
app.post('/api/reservas/:id/estado', requireStaff, ah(async (req, res) => {
  const { estado } = req.body;
  if (!ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  const result = await pool.query(
    'UPDATE reservas SET estado = $1 WHERE id = $2 RETURNING *',
    [estado, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Reserva no encontrada' });
  res.json(result.rows[0]);
}));

// Staff: mesas de cafeteria-control (para elegir a cuál mandar el pedido)
app.post('/api/staff/mesas-control', requireStaff, ah(async (req, res) => {
  res.json(await llamarControl('/api/integracion/mesas'));
}));

// Staff: crear en cafeteria-control un pedido por persona con la comida de la reserva
app.post('/api/reservas/:id/enviar-control', requireStaff, ah(async (req, res) => {
  const { mesa_id } = req.body;
  if (!mesa_id) return res.status(400).json({ error: 'Escoge la mesa de cafeteria-control' });

  const found = await pool.query('SELECT * FROM reservas WHERE id = $1', [req.params.id]);
  const reserva = found.rows[0];
  if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
  if (!reserva.pedido) return res.status(400).json({ error: 'Esta reserva no tiene pedido de comida' });
  if (reserva.pedido_enviado_at) {
    return res.status(409).json({ error: 'Este pedido ya se envió a ' + reserva.pedido_enviado_a });
  }

  // Marca el envío ANTES de llamar, para que un doble clic no cree pedidos duplicados.
  const claimed = await pool.query(
    'UPDATE reservas SET pedido_enviado_at = NOW() WHERE id = $1 AND pedido_enviado_at IS NULL RETURNING id',
    [reserva.id]
  );
  if (claimed.rows.length === 0) return res.status(409).json({ error: 'Este pedido ya se está enviando' });

  const personas = reserva.pedido.map((p, i) => ({
    nombre: (p.nombre || (i === 0 ? reserva.nombre : '')) + (p.pocion.variante ? ' · ' + p.pocion.variante : ''),
    pocion: POCIONES.get(p.pocion.id).control,
    botin: BOTINES.get(p.botin.id).control
  }));

  try {
    const data = await llamarControl('/api/integracion/pedido-reserva', {
      method: 'POST',
      body: JSON.stringify({ mesa_id, personas })
    });
    await pool.query('UPDATE reservas SET pedido_enviado_a = $1 WHERE id = $2', [data.mesa, reserva.id]);
    res.json({ ok: true, mesa: data.mesa, pedidos: data.pedidos });
  } catch (err) {
    await pool.query('UPDATE reservas SET pedido_enviado_at = NULL WHERE id = $1', [reserva.id]);
    throw err;
  }
}));

app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Error del servidor, intenta de nuevo' });
});

// En modo local levanta el servidor; en Vercel exporta el handler serverless
const ready = initDb().catch(err => {
  console.error('Error conectando a la base de datos:', err);
  process.exit(1);
});

if (require.main === module) {
  ready.then(() => app.listen(PORT, () => console.log(`Sale a Mesa catálogo corriendo en puerto ${PORT}`)));
}

module.exports = async (req, res) => {
  await ready;
  app(req, res);
};
