import { query } from './backend/db.js';

async function debug() {
    try {
        console.log('\n=== DEBUGGING DATABASE ===\n');

        // Check categories
        const categories = await query('SELECT id, name FROM categories');
        console.log('CATEGORÍAS:', categories.length, 'encontradas');
        console.table(categories);

        // Check products
        const products = await query('SELECT id, name, category, pricesell FROM products LIMIT 10');
        console.log('\nPRODUCTOS (primeros 10):', products.length, 'encontrados');
        console.table(products);

        // Check table structure
        const productStructure = await query('DESCRIBE products');
        console.log('\nESTRUCTURA DE TABLA PRODUCTS:');
        console.table(productStructure);

        // Test the endpoint logic manually
        const catId = categories.length > 0 ? categories[0].id : null;
        if (catId) {
            console.log(`\n--- Probando con categoria: ${catId} ---`);
            const prods = await query(`
                SELECT 
                  id, 
                  name, 
                  pricesell AS price
                FROM products 
                WHERE category = ?
                ORDER BY name
            `, [catId]);
            console.log(`Productos encontrados para categoria ${catId}:`, prods.length);
            console.table(prods);
        }

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

debug();
