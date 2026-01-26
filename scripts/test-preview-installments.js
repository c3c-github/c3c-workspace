require('dotenv').config();
const axios = require('axios');
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    console.log("Iniciando teste de PREVIEW de parcelas (mesma lógica do front)...");
    const saleId = '91f02b71-921e-4e2c-8e95-787667151d25'; 
    
    try {
        const conn = await getSfConnection();
        const configRes = await conn.query("SELECT Token__c FROM Configuracao__c LIMIT 1");
        const token = configRes.records[0].Token__c;

        // 1. Detalhes da venda (Pegar Event ID)
        const saleRes = await axios.get(`https://api-v2.contaazul.com/v1/venda/${saleId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const eventId = saleRes.data.evento_financeiro.id;
        console.log(`Event ID: ${eventId}`);

        // 2. Parcelas
        const instRes = await axios.get(`https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/${eventId}/parcelas`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const rawData = instRes.data;
        console.log("\n--- DADOS BRUTOS DO CONTA AZUL ---");
        console.log(JSON.stringify(rawData[0], null, 2));

        // 3. Simular mapeamento do serviceController.getSaleInstallmentsPreview
        const mapped = rawData.map(p => ({
            desc: p.descricao,
            date: p.data_vencimento ? p.data_vencimento.split('T')[0] : null,
            value: p.valor_composicao ? p.valor_composicao.valor_bruto : (p.valor_pago || 0),
            status: p.status, // <--- Aqui está o ponto
            month: p.data_vencimento ? p.data_vencimento.substring(0, 7) : null
        }));

        console.log("\n--- DADOS MAPEADOS ENVIADOS AO FRONT ---");
        console.log(JSON.stringify(mapped[0], null, 2));

    } catch (error) {
        console.error("ERRO:", error.message);
    }
}

run();
