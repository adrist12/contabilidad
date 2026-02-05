import mysql from 'mysql2/promise';
import { dbConfig } from './config.js';

async function initDB() {
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Conectado a MySQL');

        const sql = `
        CREATE DATABASE IF NOT EXISTS contabilidad_pizzeria
        CHARACTER SET utf8mb4
        COLLATE utf8mb4_general_ci;

        USE contabilidad_pizzeria;

        CREATE TABLE IF NOT EXISTS cont_cuentas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(50) NOT NULL UNIQUE,
            tipo ENUM('ACTIVO','PASIVO','RESULTADO') NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS cont_movimientos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            fecha DATE NOT NULL,
            tipo_id INT,
            cuenta_id INT NOT NULL,
            caja_id INT,
            concepto VARCHAR(255),
            monto DECIMAL(12,2) NOT NULL,
            origen ENUM('POS','MANUAL','AJUSTE') DEFAULT 'MANUAL',
            referencia VARCHAR(60),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tipo_id) REFERENCES tipo_movimiento(id),
            FOREIGN KEY (cuenta_id) REFERENCES cont_cuentas(id),
            FOREIGN KEY (caja_id) REFERENCES cont_cajas(id)
        );

        CREATE TABLE IF NOT EXISTS cont_sync_pos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            receipt_id VARCHAR(50) NOT NULL UNIQUE,
            fecha DATETIME NOT NULL,
            total DECIMAL(12,2) NOT NULL,
            forma_pago VARCHAR(30),
            sincronizado BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS cont_cierres (
            id INT AUTO_INCREMENT PRIMARY KEY,
            fecha DATE NOT NULL UNIQUE,
            ingresos DECIMAL(12,2) NOT NULL,
            egresos DECIMAL(12,2) NOT NULL,
            saldo DECIMAL(12,2) NOT NULL,
            observaciones VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        INSERT IGNORE INTO cont_cuentas (nombre, tipo) VALUES
            ('CAJA', 'ACTIVO'),
            ('BANCO', 'ACTIVO'),
            ('TARJETA', 'ACTIVO'),
            ('NEQUI', 'ACTIVO'),
            ('DAVIPLATA', 'ACTIVO'),
            ('GASTOS', 'RESULTADO'),
            ('IMPUESTOS', 'RESULTADO');
        `;

        await connection.query(sql);
        console.log('🎉 Base de datos contable creada correctamente');

    } catch (err) {
        console.error('❌ Error inicializando BD:', err.message);
    } finally {
        if (connection) await connection.end();
    }
}

initDB();
