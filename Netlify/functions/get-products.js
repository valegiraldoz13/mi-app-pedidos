// netlify/functions/get-products.js

// Importa las librerías de Google APIs para Node.js
const { google } = require('googleapis');

// La función principal que Netlify ejecutará cuando se reciba una solicitud HTTP
exports.handler = async (event, context) => {
    // 1. Verificar que la solicitud sea un método GET (para obtener datos)
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405, // Código de estado "Método no permitido"
            body: JSON.stringify({ error: 'Método no permitido. Solo se aceptan solicitudes GET.' }),
            headers: { 'Content-Type': 'application/json' },
        };
    }

    // 2. Obtener las credenciales de la cuenta de servicio desde las variables de entorno de Netlify
    const credentialsString = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
    if (!credentialsString) {
        console.error('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS no está configurada.');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error de configuración del servidor: credenciales de Google faltantes.' }),
            headers: { 'Content-Type': 'application/json' },
        };
    }

    let credentials;
    try {
        credentials = JSON.parse(credentialsString);
    } catch (error) {
        console.error('Error al parsear las credenciales de Google:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error de configuración del servidor: formato de credenciales inválido.' }),
            headers: { 'Content-Type': 'application/json' },
        };
    }

    // 3. Obtener el ID de la hoja de productos desde las variables de entorno de Netlify
    const productSpreadsheetId = process.env.GOOGLE_PRODUCT_SHEET_ID; // Nueva variable de entorno
    if (!productSpreadsheetId) {
        console.error('GOOGLE_PRODUCT_SHEET_ID no está configurada.');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error de configuración del servidor: ID de hoja de productos faltante.' }),
            headers: { 'Content-Type': 'application/json' },
        };
    }

    try {
        // 4. Autenticarse con Google APIs usando la cuenta de servicio
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets.readonly', // Permiso de SOLO LECTURA para Google Sheets
            ],
        });

        // Crear instancia de la API de Google Sheets
        const sheets = google.sheets({ version: 'v4', auth });

        // 5. Leer los datos de la hoja de productos
        // Asume que los datos están en la primera hoja (Hoja1) y en el rango A:C
        // AJUSTA ESTE RANGO si tus columnas de productos no son A, B, C o si la hoja se llama diferente.
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: productSpreadsheetId,
            range: 'Hoja1!A:C', // <--- AJUSTA ESTO AL RANGO DE TUS DATOS DE PRODUCTOS
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return {
                statusCode: 200,
                body: JSON.stringify({ products: [] }), // Devolver un array vacío si no hay datos
                headers: { 'Content-Type': 'application/json' },
            };
        }

        // 6. Procesar los datos para devolver un formato amigable (array de objetos)
        const headers = rows[0]; // La primera fila son los encabezados (reference, name, price)
        const products = rows.slice(1).map(row => { // Las filas siguientes son los datos
            let product = {};
            headers.forEach((header, index) => {
                // Asegurarse de que 'price' sea un número
                if (header === 'price') {
                    product[header] = parseFloat(row[index]);
                } else {
                    product[header] = row[index];
                }
            });
            return product;
        });

        // 7. Devolver la lista de productos al front-end
        return {
            statusCode: 200,
            body: JSON.stringify({ products }),
            headers: { 'Content-Type': 'application/json' },
        };

    } catch (error) {
        console.error('Error en la función get-products:', error.message, error.stack);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error interno del servidor al obtener productos.', details: error.message }),
            headers: { 'Content-Type': 'application/json' },
        };
    }
};
