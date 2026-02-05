import { query, executeContabilidad, queryContabilidad } from '../db.js';
export async function syncUnicenta(desde, hasta) {

    console.log(`\n📤 Sincronizando Unicenta: ${desde} → ${hasta}`);

    // Cuenta contable VENTAS
    const cuentaRows = await queryContabilidad(`
        SELECT id FROM cont_cuentas WHERE nombre='VENTAS'
    `);

    if (!cuentaRows.length) {
        throw new Error('No existe la cuenta VENTAS');
    }

    const cuentaIdVentas = cuentaRows[0].id;

    // Ventas POS
    const ventas = await query(`
        SELECT 
            r.ID AS receipt_id,
            r.DATENEW AS fecha,
            p.TOTAL AS monto,
            p.PAYMENT AS metodo
        FROM RECEIPTS r
        JOIN PAYMENTS p ON p.RECEIPT = r.ID
        WHERE r.DATENEW >= ?
          AND r.DATENEW < DATE_ADD(?, INTERVAL 1 DAY)
    `, [desde, hasta]);

    console.log(`📊 Ventas encontradas: ${ventas.length}`);

    let synced = 0;

    for (const v of ventas) {

        // Mapear método POS → caja
        const map = await queryContabilidad(`
            SELECT caja_id
            FROM pos_metodos_map
            WHERE pos_codigo = ?
        `, [v.metodo]);

        if (!map.length) {
            console.warn(`⚠ Método POS no mapeado: ${v.metodo}`);
            continue;
        }

        const cajaId = map[0].caja_id;

        await executeContabilidad(`
            INSERT IGNORE INTO cont_movimientos
            (
                fecha,
                tipo_id,
                cuenta_id,
                caja_id,
                monto,
                origen,
                referencia
            )
            VALUES (DATE(?), 1, ?, ?, ?, 'POS', ?)
        `, [
            v.fecha,
            cuentaIdVentas,
            cajaId,
            v.monto,
            v.receipt_id
        ]);

        synced++;
    }

    console.log(`✅ Insertadas: ${synced}`);

    return synced;
}
