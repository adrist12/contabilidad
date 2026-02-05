// db.js: Conexión ligera a MySQL, pool mínimo para bajos recursos
import mysql from 'mysql2/promise.js';
import dotenv from 'dotenv';

dotenv.config();

const eticpos = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 5, // Mínimo para bajos recursos
});
const contabilidad = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME2,
    connectionLimit: 5, // Mínimo para bajos recursos
});

export async function query(sql, params) {
    const [rows] = await eticpos.query(sql, params);
    return rows;
}

export async function execute(sql, params) {
    await eticpos.execute(sql, params);
}

export async function queryContabilidad(sql, params) {
    const [rows] = await contabilidad.query(sql, params);
    return rows;
}

export async function executeContabilidad(sql, params) {
    await contabilidad.execute(sql, params);
}