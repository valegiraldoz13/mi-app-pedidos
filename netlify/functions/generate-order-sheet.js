// netlify/functions/generate-order-sheet.js

// Importa las librerías de Google APIs para Node.js
const { google } = require('googleapis');

// La función principal que Netlify ejecutará cuando se reciba una solicitud HTTP
exports.handler = async (event, context) => {
    // 1. Verificar que la solicitud sea un método POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405, // Código de estado "Método no permitido"
            body: JSON.stringify({ error: 'Método no permitido. Solo se aceptan solicitudes POST.' }),
            headers: { 'Content-Type': 'application/json' },
        };
    }

    let orderData;
    try {
        // 2. Parsear los datos del cuerpo de la solicitud (que vienen como JSON)
        orderData = JSON.parse(event.body);
    } catch (error) {
        return {
            statusCode: 400, // Código de estado "Solicitud incorrecta"
            body: JSON.stringify({ error: 'Formato de JSON inválido en el cuerpo de la solicitud.' }),
            headers: { 'Content-Type': 'application/json' },
        };
    }

    // 3. Obtener las credenciales de la cuenta de servicio desde las variables de entorno de Netlify
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

    // 4. Obtener el ID de la plantilla de Google Sheet y el ID de la carpeta de Drive
    const templateSpreadsheetId = process.env.GOOGLE_SHEET_TEMPLATE_ID;
    console.log('ID de plantilla leído de variable de entorno:', templateSpreadsheetId); // ¡ESTA LÍNEA DE DEPURACIÓN ES CRUCIAL!
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID; // Opcional: si configuraste una carpeta

    if (!templateSpreadsheetId) {
        console.error('GOOGLE_SHEET_TEMPLATE_ID no está configurada.');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error de configuración del servidor: ID de plantilla de hoja de cálculo faltante.' }),
            headers: { 'Content-Type': 'application/json' },
        };
    }

    try {
        // 5. Autenticarse con Google APIs usando la cuenta de servicio
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets', // Permiso para Google Sheets
                'https://www.googleapis.com/auth/drive',       // Permiso para Google Drive (copiar, compartir)
            ],
        });

        // Crear instancias de las APIs de Google Sheets y Drive
        const sheets = google.sheets({ version: 'v4', auth });
        const drive = google.drive({ version: 'v3', auth });

        // 6. Generar un nombre único para la nueva hoja de pedido
        const customerName = orderData.customer.customerName || 'Cliente Desconocido';
        const orderDate = orderData.customer.orderDate || new Date().toISOString().split('T')[0];
        const newSheetName = `Pedido - ${customerName} - ${orderDate} - ${Date.now()}`; // Añadir timestamp para unicidad

        // 7. Copiar la hoja de plantilla
        const copyResponse = await drive.files.copy({
            fileId: templateSpreadsheetId,
            requestBody: {
                name: newSheetName,
                parents: folderId ? [folderId] : [], // Si se especificó una carpeta
            },
        });
        const newSpreadsheetId = copyResponse.data.id;
        const newSpreadsheetUrl = copyResponse.data.webViewLink; // URL de la nueva hoja

        // 8. Escribir los datos del pedido en la nueva hoja
        const orderNumber = `ORD-${Date.now()}`; // Genera un número de pedido único basado en el tiempo

        // Datos del cliente y pedido en sus celdas específicas
        const updateRequests = [
            {
                range: 'C4', // Nro Pedido
                values: [[orderNumber]]
            },
            {
                range: 'C5', // Nombre Cliente
                values: [[orderData.customer.customerName]]
            },
            {
                range: 'F5', // NIT
                values: [[orderData.customer.customerNit]]
            },
            {
                range: 'C6', // Dirección
                values: [[orderData.customer.customerAddress]]
            },
            {
                range: 'F6', // Ciudad
                values: [[orderData.customer.customerCity]]
            },
            {
                range: 'C7', // Vendedor (CORREGIDO: Ahora en C7)
                values: [[orderData.customer.sellerName]]
            },
            {
                range: 'F7', // Fecha (CORREGIDO: Ahora en F7)
                values: [[orderData.customer.orderDate]]
            }
        ];

        // Escribir los datos de los productos
        // Las columnas son: B (Referencia), C (Nombre), D (Cantidad), E (Precio), F (Total), G (Notas Adicionales)
        const productRowsValues = orderData.products.map(product => [
            product.reference,
            product.name,
            product.quantity,
            product.price,
            product.total,
            product.notes // Incluye las notas adicionales en la columna G11 en adelante
        ]);

        // Insertar productos desde B11. El método append empujará las filas existentes hacia abajo.
        await sheets.spreadsheets.values.append({
            spreadsheetId: newSpreadsheetId,
            range: 'Hoja1!B11', // <--- INICIO DE TUS DATOS DE PRODUCTO EN LA PLANTILLA
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: productRowsValues,
            },
        });

        // Escribir el Total General en F18
        await sheets.spreadsheets.values.update({
            spreadsheetId: newSpreadsheetId,
            range: 'Hoja1!F18', // <--- CELDA DEL TOTAL GENERAL EN LA PLANTILLA
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[orderData.grandTotal]],
            },
        });

        // Ejecutar todas las actualizaciones en batch para los datos del cliente/pedido
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: newSpreadsheetId,
            resource: {
                data: updateRequests,
                valueInputOption: 'USER_ENTERED',
            },
        });

        // 9. Configurar permisos de compartir para la nueva hoja (ej: "cualquiera con el enlace puede ver")
        await drive.permissions.create({
            fileId: newSpreadsheetId,
            requestBody: {
                role: 'reader', // 'reader' para ver, 'writer' para editar
                type: 'anyone', // 'anyone' para público con el enlace
            },
        });

        // 10. Devolver la URL de la nueva hoja al front-end
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Hoja de pedido generada y lista para compartir.',
                sheetUrl: newSpreadsheetUrl,
            }),
            headers: { 'Content-Type': 'application/json' },
        };

    } catch (error) {
        console.error('Error en la función generate-order-sheet:', error.message, error.stack);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error interno del servidor al generar la hoja.', details: error.message }),
            headers: { 'Content-Type': 'application/json' },
        };
    }
};
