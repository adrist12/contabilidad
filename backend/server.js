import express from 'express';
import { createServer } from 'http';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import { Server } from 'socket.io';
import { syncUnicenta } from './routes/ventas.js';
import crypto from 'crypto';
import { query, execute, queryContabilidad, executeContabilidad } from './db.js';
import contabilidadRoutes from './routes/contabilidad.js';


dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────
// HTTP + SOCKET.IO
// ─────────────────────────────────────────────
const server = createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});
app.use(cors());

app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// ─────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log('🟢 Socket conectado:', socket.id);

    socket.on('unir-mesa', (table_name) => {
        socket.join(`mesa:${table_name}`);
        console.log(`📡 Socket ${socket.id} unido a mesa ${table_name}`);
    });

    socket.on('disconnect', () => {
        console.log('🔴 Socket desconectado:', socket.id);
    });
});

// ─────────────────────────────────────────────
// AUTH (BÁSICO)
// ─────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    const rows = await query(
        `SELECT id, name, role
         FROM people
         WHERE name=? AND card=? AND visible=1
         LIMIT 1`,
        [username, password]
    );

    if (!rows.length) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    res.json({
        success: true,
        user: rows[0],
        token: crypto.randomUUID()
    });
});

// Middleware para proteger rutas de contabilidad: requiere rol 'admin'
function isAdminRole(role) {
    if (role === undefined || role === null) return false;
    // aceptar role numeric 0 (o '0') como admin
    const n = Number(role);
    if (!Number.isNaN(n) && n === 0) return true;
    // aceptar string 'admin' (case-insensitive)
    try {
        if (String(role).toLowerCase() === 'admin') return true;
    } catch (e) {
        // ignore
    }
    return false;
}

function requireAdmin(req, res, next) {
    const role = req.header('x-user-role') || (req.body && req.body.user && req.body.user.role) || req.query.role;
    if (!isAdminRole(role)) {
        return res.status(403).json({ error: 'Acceso denegado: se requiere rol administrador' });
    }
    next();
}

// ─────────────────────────────────────────────
// MESAS (DESDE UNICENTA)
// ─────────────────────────────────────────────
app.get('/api/mesas/estado', async (req, res) => {
    const mesas = await query(
        'SELECT name, ticketid FROM places ORDER BY name'
    );
    res.json(mesas);
});

app.get('/api/mesas', async (req, res) => {
    const mesas = await query(
        'SELECT name, ticketid FROM places ORDER BY name'
    );
    res.json(mesas);
});
app.get('/api/categorias', async (req, res) => {
    const categorias = await query(
        'SELECT id, name FROM categories ORDER BY name'
    );
    res.json(categorias);
});

app.get('/api/productos/:catId', async (req, res) => {
    const productos = await query(
        `SELECT id, name, pricesell AS price
         FROM products
         WHERE category=?
         ORDER BY name`,
        [req.params.catId]
    );
    res.json(productos);
});

// Traer todos los productos activos (útil para sincronizar desde UniCenta)
app.get('/api/productos', async (req, res) => {
    const productos = await query(
        `SELECT id, name, pricesell AS price, category
         FROM products
         ORDER BY name`
    );
    res.json(productos);
});

// Crear ticket para una mesa
app.post('/api/mesa/crear-ticket', async (req, res) => {
    const { name } = req.body;

    try {
        if (!name) {
            return res.status(400).json({ error: 'Mesa requerida' });
        }

        // Verificar que la mesa existe
        const mesaRow = await query('SELECT name FROM places WHERE name = ?', [name]);
        if (!mesaRow.length) {
            return res.status(404).json({ error: 'Mesa no encontrada' });
        }

        // Crear nuevo ticket
        const nuevoUUID = crypto.randomUUID();
        const rawTicket = await query('SELECT MAX(ticketid) as ultimo FROM tickets');
        const ticketNum = (parseInt(rawTicket[0].ultimo) || 0) + 1;

        await execute(
            'INSERT INTO tickets (id, tickettype, ticketid, person, status) VALUES (?, 0, ?, "0", 0)',
            [nuevoUUID, ticketNum]
        );

        // Asignar ticket a mesa
        await execute('UPDATE places SET ticketid = ? WHERE name = ?', [ticketNum, name]);

        console.log(`✅ Ticket #${ticketNum} creado para mesa "${name}"`);
        res.json({ ok: true, ticketId: ticketNum });
    } catch (err) {
        console.error('Error en /api/mesa/crear-ticket:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/mesa/abrir', async (req, res) => {
    const { table_name } = req.body;

    if (!table_name) {
        return res.status(400).json({ error: 'Mesa requerida' });
    }

    const payload = {
        action: 'OPEN_TABLE',
        table_name,
        source: 'WEB',
        ts: Date.now()
    };

    await execute(
        'INSERT INTO web_orders (table_name, payload, status) VALUES (?, ?, "PENDING")',
        [table_name, JSON.stringify(payload)]
    );

    res.json({ success: true });
});

// ─────────────────────────────────────────────
// ESTADO DE MESA (RESPUESTA DEL CLI)
// ─────────────────────────────────────────────
app.get('/api/mesa/:table_name/estado', async (req, res) => {
    const { table_name } = req.params;

    const rows = await query(
        'SELECT payload FROM web_sync WHERE table_name=? LIMIT 1',
        [table_name]
    );

    res.json(rows.length ? JSON.parse(rows[0].payload) : {
        table_name,
        sharedticket: null,
        status: 'FREE'
    });
});

// ─────────────────────────────────────────────
// PEDIDOS → JAVA → UNICENTA
// ─────────────────────────────────────────────
app.post('/api/pedidos/agregar', async (req, res) => {
    const { table_name, items } = req.body;

    if (!table_name || !items?.length) {
        return res.status(400).json({ error: 'Datos incompletos' });
    }

    // Validar que la mesa exista
    const mesa = await query(
        'SELECT ID FROM places WHERE NAME=? LIMIT 1',
        [table_name]
    );

    if (!mesa.length) {
        return res.status(404).json({ error: 'Mesa no existe' });
    }

    const payload = {
        table_name,
        items,
        source: 'WEB',
        ts: Date.now()
    };

    await execute(
        'INSERT INTO web_orders (table_name, payload, status) VALUES (?, ?, "PENDING")',
        [table_name, JSON.stringify(payload)]
    );

    io.emit('mesas-actualizadas');
    res.json({ ok: true });
});

// ─────────────────────────────────────────────
// ELIMINAR ITEMS
// ─────────────────────────────────────────────
app.post('/api/pedidos/eliminar', async (req, res) => {
    const { table_name, itemIds } = req.body;

    if (!table_name || !itemIds?.length) {
        return res.status(400).json({ error: 'Datos incompletos' });
    }

    const payload = {
        table_name,
        itemIds,
        action: 'DELETE_ITEMS',
        source: 'WEB',
        ts: Date.now()
    };

    await execute(
        'INSERT INTO web_orders (table_name, payload, status) VALUES (?, ?, "PENDING")',
        [table_name, JSON.stringify(payload)]
    );

    io.to(`mesa:${table_name}`).emit('pedido-eliminado', payload);
    res.json({ success: true });
});

// ─────────────────────────────────────────────
// LECTURA DE PEDIDOS (DESDE JAVA)
// ─────────────────────────────────────────────
app.get('/api/mesa/:table_name/pedidos', async (req, res) => {
    const { table_name } = req.params;

    const rows = await query(
        'SELECT payload FROM web_sync WHERE table_name=? LIMIT 1',
        [table_name]
    );

    res.json(rows[0]?.payload || { items: [] });
});

// ─────────────────────────────────────────────
// CIERRE DE MESA (INTENCIÓN)
// ─────────────────────────────────────────────
app.post('/api/mesa/:table_name/cerrar', async (req, res) => {
    const { table_name } = req.params;
    const payload = {
        table_name,
        action: 'CLOSE',
        source: 'WEB',
        ts: Date.now()
    };

    await execute(
        'INSERT INTO web_orders (table_name, payload, status) VALUES (?, ?, "PENDING")',
        [table_name, JSON.stringify(payload)]
    );

    io.emit('mesas-actualizadas');
    res.json({ ok: true });
});

// Obtener estado del pedido (web-sync) - Ahora simplificado para traer items agregados vía web
app.get('/api/web-sync/:mesaName', async (req, res) => {
    const { mesaName } = req.params;

    try {
        // Obtener los últimos items agregados desde web para esta mesa
        const webOrders = await query(
            `SELECT payload FROM web_orders 
             WHERE table_name = ? AND status = 'PENDING'
             ORDER BY id DESC LIMIT 1`,
            [mesaName]
        );

        if (!webOrders.length) {
            return res.json({ items: [] });
        }

        const payload = JSON.parse(webOrders[0].payload);
        const items = payload.items || [];

        res.json({ items });
    } catch (err) {
        console.error('Error en /api/web-sync:', err);
        res.json({ items: [] });
    }
});

// Obtener pedidos sincronizados desde UniCenta (web_sync)
app.get('/api/web-sync-from-unicenta/:mesaName', async (req, res) => {
    const { mesaName } = req.params;

    try {
        const syncData = await query(
            'SELECT payload FROM web_sync WHERE table_name = ? ORDER BY updated_at DESC LIMIT 1',
            [mesaName]
        );

        if (!syncData.length) {
            return res.json({ items: [] });
        }

        const payload = JSON.parse(syncData[0].payload);
        // Asegurar que siempre devolvemos en formato { items: [...] }
        const items = payload.items || payload;
        res.json({ items: Array.isArray(items) ? items : [] });
    } catch (err) {
        console.error('Error en /api/web-sync-from-unicenta:', err);
        res.json({ items: [] });
    }
});




//Contabilidad routes (protegidas por rol admin)
// API
app.use('/api/contabilidad', requireAdmin, contabilidadRoutes);
// ─────────────────────────────────────────────
// SERVER
// ─────────────────────────────────────────────
server.listen(port, () => {
    console.log(`✅ Backend listo en http://localhost:${port}`);
});
