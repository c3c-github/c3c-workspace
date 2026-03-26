require('dotenv').config();
const { getValidToken } = require('../src/services/contaAzulAuth');

async function heartbeat() {
    console.log(`[${new Date().toISOString()}] Verificando integridade do token Conta Azul...`);
    try {
        const token = await getValidToken();
        if (token) {
            console.log("Token está válido e pronto para uso.");
        }
    } catch (e) {
        console.error("FALHA CRÍTICA NO HEARTBEAT:", e.message);
        // Aqui poderíamos enviar um e-mail ou alerta se o token morrer
        process.exit(1);
    }
}

heartbeat();
