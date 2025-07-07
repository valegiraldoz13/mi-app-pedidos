// netlify/functions/add-order-to-sheet.js

// Importa las librerías de Google APIs para Node.js
const { google } = require('googleapis');

// La función principal que Netlify ejecutará cuando se reciba una solicitud HTTP
exports.handler = async (event, context) => {
    console.log('--- add-order-to-sheet.js function invoked ---'); // Línea de depuración

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Método no permitido. Solo se aceptan solicitudes POST.' }),
            headers: { 'Content-Type': 'application/json' },
        };
    }

    let orderData;
    try {
        orderData = JSON.parse(event.body);
    } catch (error) {
        console.error('Error al parsear el cuerpo de la solicitud:', error);
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Formato de JSON inválido en el cuerpo de la solicitud.' }),
            headers: { 'Content-Type': 'application/json' },
        };
    }

    const credentialsString = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
    if (!credentialsString) {
        console.error('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS no está configurada para add-order-to-sheet.');
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
        console.error('Error al parsear las credenciales de Google para add-order-to-sheet:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error de configuración del servidor: formato de credenciales inválido.' }),
            headers: { 'Content-Type': 'application/json' },
        };
    }

    const mainOrdersSpreadsheetId = process.env.GOOGLE_MAIN_ORDERS_SHEET_ID;

    if (!mainOrdersSpreadsheetId) {
        console.error('GOOGLE_MAIN_ORDERS_SHEET_ID no está configurada.');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error de configuración del servidor: ID de hoja principal de pedidos faltante.' }),
            headers: { 'Content-Type': 'application/json' },
        };
    }

    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'], // Permiso de escritura en Sheets
        });

        const sheets = google.sheets({ version: 'v4', auth });

        // Generar un ID de Pedido único para este pedido completo
        const orderUniqueId = `ORD-${Date.now()}`;
        console.log('ID de Pedido único generado:', orderUniqueId); // Depuración

        const rowsToAppend = []; // Este array contendrá múltiples filas para un solo pedido

        // Crear una fila por cada producto en el pedido
        orderData.products.forEach((product, index) => {
            // Detalles del pedido que se repiten en cada fila de producto
            const commonOrderDetails = [
                orderUniqueId, // ID Pedido
                orderData.customer.orderDate, // Fecha Pedido
                orderData.customer.customerName, // Nombre Cliente
                orderData.customer.customerNit, // NIT Cliente
                orderData.customer.customerAddress, // Dirección Cliente
                orderData.customer.customerCity, // Ciudad Cliente
                orderData.customer.customerPhone, // Teléfono Cliente
                orderData.customer.customerEmail, // Email Cliente
                orderData.customer.sellerName // Nombre Vendedor
            ];

            // Detalles específicos de este producto
            const productDetails = [
                product.reference, // Ref Producto
                product.name,      // Nombre Producto
                product.quantity,  // Cantidad
                product.price,     // Precio Unitario
                product.total,     // Total Producto
                product.notes      // Notas Producto
            ];

            // Combinar detalles comunes y detalles del producto
            let currentRow = [...commonOrderDetails, ...productDetails];

            // Añadir el Total General solo a la primera fila de productos de este pedido
            if (index === 0) {
                currentRow.push(orderData.grandTotal); // Total General Pedido
            } else {
                currentRow.push(''); // Dejar vacío para los productos subsiguientes del mismo pedido
            }

            rowsToAppend.push(currentRow); // Añadir la fila completa al array de filas a insertar
        });

        console.log('Filas a insertar en la hoja principal:', rowsToAppend); // Depuración

        // --- Insertar las nuevas filas en la hoja principal ---
        // AJUSTA ESTE RANGO a la hoja y el rango donde quieres que se añadan las nuevas filas
        // Asumiendo 16 columnas (A:P) para la nueva estructura
        await sheets.spreadsheets.values.append({
            spreadsheetId: mainOrdersSpreadsheetId,
            range: 'Hoja1!A:P', // <--- AJUSTA ESTO AL RANGO DE TU HOJA PRINCIPAL DE PEDIDOS
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: rowsToAppend, // Ahora insertamos un array de arrays (múltiples filas)
            },
        });

        console.log('Pedido registrado con éxito en la hoja principal.');
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Pedido registrado en hoja principal.' }),
            headers: { 'Content-Type': 'application/json' },
        };

    } catch (error) {
        console.error('Error en la función add-order-to-sheet:', error.message, error.stack);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error interno del servidor al registrar el pedido principal.', details: error.message }),
            headers: { 'Content-Type': 'application/json' },
        };
    }
};
