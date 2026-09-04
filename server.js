const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const STAFF_PASSWORD = process.env.STAFF_PASSWORD || 'saleamesa2026';
const PORT = process.env.PORT || 3000;
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
  `);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireStaff(req, res, next) {
  if (req.body.password !== STAFF_PASSWORD) {
    return res.status(401).json({ error: 'Contraseña de staff incorrecta' });
  }
  next();
}

// Cliente: crear una reserva
app.post('/api/reservas', async (req, res) => {
  const { nombre, celular, juego, fecha, hora, notas } = req.body;
  let { personas, mesa } = req.body;

  if (!nombre || !celular || !juego || !fecha || !hora) {
    return res.status(400).json({ error: 'Faltan datos de la reserva' });
  }

  if (!MESAS[mesa]) mesa = 'general';
  const { min, max } = MESAS[mesa];
  personas = Number(personas) || min;
  personas = Math.min(Math.max(personas, min), max);

  const id = crypto.randomBytes(6).toString('hex');
  await pool.query(
    `INSERT INTO reservas (id, nombre, celular, juego, mesa, fecha, hora, personas, notas)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, nombre, celular, juego, mesa, fecha, hora, personas, notas || null]
  );

  res.json({ id });
});

// Staff: listar reservas (opcionalmente filtradas por fecha)
app.post('/api/reservas/list', requireStaff, async (req, res) => {
  const { fecha } = req.body;
  const result = fecha
    ? await pool.query('SELECT * FROM reservas WHERE fecha = $1 ORDER BY hora', [fecha])
    : await pool.query(
        `SELECT * FROM reservas WHERE fecha >= CURRENT_DATE
         ORDER BY fecha, hora LIMIT 100`
      );
  res.json(result.rows);
});

// Staff: cambiar el estado de una reserva
app.post('/api/reservas/:id/estado', requireStaff, async (req, res) => {
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
