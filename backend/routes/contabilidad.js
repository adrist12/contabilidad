import express from 'express';
import {
    queryContabilidad,
    executeContabilidad,
    query
} from '../db.js';

import { syncUnicenta } from './ventas.js';

const router = express.Router();

/* =========================
   CUENTAS
========================= */
router.get('/cuentas', async (_, res) => {
    try {
        const rows = await queryContabilidad(
            'SELECT DISTINCT caja_id, nombre FROM pos_metodos_map ORDER BY nombre'
        );
        res.json(rows);
    } catch (err) {
        console.error('Error obteniendo metodos pago:', err);
        res.status(500).json({ error: 'Error al obtener metodos de pago' });
    }
});
router.get('/tipo', async (_, res) => {
    try {
        const rows = await queryContabilidad(`
            SELECT * from tipo_movimiento
        `);
        res.json(rows);
    } catch (err) {
        console.error('Error obteniendo tipos de movimiento:', err);
        res.status(500).json({ error: 'Error al obtener tipos de movimiento' });
    }
});

/* =========================
   CAJAS
========================= */
router.get('/cajas', async (_, res) => {
    try {
        const rows = await queryContabilidad(
            'SELECT id, nombre, tipo FROM cont_cajas ORDER BY nombre'
        );
        res.json(rows);
    } catch (err) {
        console.error('Error obteniendo cajas:', err);
        res.status(500).json({ error: 'Error al obtener cajas' });
    }
});

router.post('/cajas', async (req, res) => {
    try {
        const { nombre, tipo } = req.body;

        if (!nombre || !tipo) {
            return res.status(400).json({ error: 'Nombre y tipo requeridos' });
        }

        await executeContabilidad(
            'INSERT INTO cont_cajas (nombre, tipo) VALUES (?, ?)',
            [nombre, tipo]
        );

        res.json({ ok: true, message: 'Caja creada exitosamente' });
    } catch (err) {
        console.error('Error creando caja:', err);
        res.status(500).json({ error: 'Error al crear caja' });
    }
});

/* =========================
   MOVIMIENTOS
========================= */
router.get('/movimientos', async (req, res) => {
    const { fecha, tipo, cuenta } = req.query;

    let sql = `
    SELECT 
        m.id,
        m.fecha,
        t.nombre AS tipo,
        m.monto,
        m.concepto,
        m.origen,
        m.referencia,
        c.nombre AS cuenta,
        cj.nombre AS caja
    FROM cont_movimientos m
    JOIN cont_cuentas c ON c.id = m.cuenta_id
    LEFT JOIN cont_cajas cj ON cj.id = m.caja_id
    LEFT JOIN tipo_movimiento t ON t.id = m.tipo_id
    WHERE 1=1
`;
    const params = [];

    if (fecha) {
        sql += ' AND DATE(m.fecha) = ?';
        params.push(fecha);
    }
    if (tipo) {
        sql += ' AND m.tipo_id = ?';
        params.push(tipo);
    }
    if (cuenta) {
        sql += ' AND cuenta_id = ?';
        params.push(cuenta);
    }

    sql += ' ORDER BY fecha DESC LIMIT 200';

    const rows = await queryContabilidad(sql, params);
    res.json(rows);
});

/* =========================
   REGISTRAR MOVIMIENTO
========================= */
router.post('/movimientos', async (req, res) => {
    const { tipo_id, cuenta_id, monto, concepto, caja_id } = req.body;

    if (!tipo_id || !cuenta_id || !monto) {
        return res.status(400).json({ error: 'Datos incompletos' });
    }

    try {
        await executeContabilidad(`
            INSERT INTO cont_movimientos
            (fecha, tipo_id, cuenta_id, caja_id, concepto, monto, origen)
             VALUES (NOW(), ?, ?, ?, ?, ?, 'MANUAL')
        `, [tipo_id, cuenta_id|| 1, caja_id || null, concepto, monto]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Error registrando movimiento:', err);
        res.status(500).json({ error: 'Error al registrar movimiento' });
    }
});

/* =========================
   VENTAS DEL DÍA (UNICENTA)
========================= */
router.get('/ventas-dia', async (_, res) => {
    const rows = await query(`
        SELECT IFNULL(SUM(p.total),0) AS total
        FROM RECEIPTS r
        JOIN PAYMENTS p ON p.RECEIPT = r.ID
        WHERE DATE(r.DATENEW) = CURDATE()
    `);

    res.json({ total: Number(rows[0].total || 0) });
});

/* =========================
   DETALLES DE MOVIMIENTOS POR MES
========================= */
router.get('/detalle-movimientos', async (req, res) => {
    try {
        const mes = Number(req.query.mes);
        const anio = Number(req.query.anio);

        if (!mes || !anio) {
            return res.status(400).json({ error: 'Mes y año requeridos' });
        }

        const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
        const hasta = mes === 12
            ? `${anio + 1}-01-01`
            : `${anio}-${String(mes + 1).padStart(2, '0')}-01`;

        const movimientos = await queryContabilidad(`
            SELECT 
                m.fecha,
                t.nombre AS tipo,
                m.concepto,
                m.monto,
                c.nombre AS cuenta,
                cj.nombre AS caja
            FROM cont_movimientos m
            JOIN cont_cuentas c ON c.id = m.cuenta_id
            LEFT JOIN cont_cajas cj ON cj.id = m.caja_id
            LEFT JOIN tipo_movimiento t ON t.id = m.tipo_id
            WHERE m.fecha >= ? AND m.fecha < ?
            ORDER BY cj.nombre, t.nombre DESC, m.fecha DESC
        `, [desde, hasta]);

        // Agrupar por CAJA (método de pago)
        const cajas = {};
        movimientos.forEach(m => {
            const cajaNombre = m.caja || 'SIN ASIGNAR';
            if (!cajas[cajaNombre]) {
                cajas[cajaNombre] = {
                    nombre: cajaNombre,
                    ingresos: 0,
                    egresos: [],
                    totalEgresos: 0
                };
            }

            if (m.tipo === 'INGRESO') {
                cajas[cajaNombre].ingresos += Number(m.monto);
            } else {
                cajas[cajaNombre].egresos.push({
                    tipo: m.tipo,
                    monto: Number(m.monto),
                    concepto: m.concepto,
                    fecha: m.fecha
                });
                cajas[cajaNombre].totalEgresos += Number(m.monto);
            }
        });

        res.json(cajas);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error cargando detalles' });
    }
});

/* =========================
   BALANCE GENERAL
========================= */
router.get('/balances', async (_, res) => {
    const rows = await queryContabilidad(`
        SELECT
            SUM(CASE WHEN tipo_id=1 THEN monto ELSE 0 END) ingresos,
            SUM(CASE WHEN tipo_id=2 THEN monto ELSE 0 END) egresos
        FROM cont_movimientos
    `);

    const ingresos = Number(rows[0].ingresos || 0);
    const egresos = Number(rows[0].egresos || 0);

    res.json({
        ingresos,
        egresos,
        saldo: ingresos - egresos
    });
});

/* =========================
   RESUMEN MENSUAL
========================= */
router.get('/resumen-mensual', async (req, res) => {
    try {
        const mes = Number(req.query.mes);
        const anio = Number(req.query.anio);

        if (!mes || !anio) {
            return res.status(400).json({ error: 'Mes y año requeridos' });
        }

        const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
        const hasta = mes === 12
            ? `${anio + 1}-01-01`
            : `${anio}-${String(mes + 1).padStart(2, '0')}-01`;

        const totales = await queryContabilidad(`
            SELECT
                SUM(CASE WHEN tipo_id=1 THEN monto ELSE 0 END) ingresos,
                SUM(CASE WHEN tipo_id=2 THEN monto ELSE 0 END) egresos
            FROM cont_movimientos
            WHERE fecha >= ? AND fecha < ?
        `, [desde, hasta]);

        const porMetodo = await queryContabilidad(`
    SELECT 
        c.nombre AS caja,
        t.nombre AS tipo,
        SUM(m.monto) AS total
    FROM cont_movimientos m
    JOIN cont_cajas c ON c.id = m.caja_id
    JOIN tipo_movimiento t ON t.id = m.tipo_id
    WHERE m.fecha >= ? 
      AND m.fecha < ?
    GROUP BY c.id, m.tipo_id
    ORDER BY c.nombre, m.tipo_id
`, [desde, hasta]);

        const ingresos = Number(totales[0].ingresos || 0);
        const egresos = Number(totales[0].egresos || 0);

        res.json({
            mes: `${anio}-${String(mes).padStart(2, '0')}`,
            ingresos,
            egresos,
            saldo: ingresos - egresos,
            por_metodo: porMetodo
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error calculando resumen mensual' });
    }
});

/* =========================
   SINCRONIZAR UNICENTA
========================= */
router.post('/sync-unicenta', async (req, res) => {

    try {

        const { desde, hasta } = req.body;

        const synced = await syncUnicenta(desde, hasta);

        res.json({ synced });

    } catch (err) {

        console.error('Error sincronizando Unicenta:', err);

        res.status(500).json({ error: 'Error sincronizando Unicenta' });

    }

});

export default router;
