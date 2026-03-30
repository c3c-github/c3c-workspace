require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');
const { getValidToken } = require('../src/services/contaAzulAuth');
const axios = require('axios');

const CA_API_URL = 'https://api-v2.contaazul.com/v1';
const SALE_ID_CA = 'c5029f80-3268-4603-a42e-c584de8b4e20'; // ID CA da Venda 296

async function debugSale296() {
    try {
        const token = await getValidToken();
        const conn = await getSfConnection();
        console.log("🚀 Iniciando Debug Venda 296...");

        // 1. Buscar Detalhes da Venda no CA
        console.log("Buscando venda no Conta Azul...");
        const saleDetail = await axios.get(`${CA_API_URL}/venda/${SALE_ID_CA}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const eventId = saleDetail.data.evento_financeiro ? saleDetail.data.evento_financeiro.id : null;
        console.log(`Evento Financeiro: ${eventId}`);

        if (!eventId) {
            console.log("❌ Venda não possui evento financeiro no CA.");
            return;
        }

        // 2. Buscar Parcelas no CA
        console.log("Buscando parcelas no Conta Azul...");
        const response = await axios.get(`${CA_API_URL}/financeiro/eventos-financeiros/${eventId}/parcelas`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const installments = response.data || [];
        console.log(`Encontradas ${installments.length} parcelas no CA.`);

        // 3. Upsert de Parcelas no Salesforce
        const installmentsToUpsert = installments.map(p => {
            let finalValue = (p.valor_composicao ? p.valor_composicao.valor_liquido : p.valor) || 0;
            if (p.baixas && p.baixas.length > 0) {
                finalValue = p.baixas.reduce((sum, b) => sum + ((b.valor_composicao ? b.valor_composicao.valor_liquido : b.valor_pago) || 0), 0);
            }

            return {
                IDContaAzul__c: p.id,
                VendaContaAzul__r: { IDContaAzul__c: SALE_ID_CA },
                Servico__c: 'a15N5000004n7yvIAA', // Hotmart | Alocação | 296
                Valor__c: finalValue,
                DataVencimento__c: p.data_vencimento,
                Status__c: (p.status || '').toUpperCase(),
                Descricao__c: p.descricao || `Parcela da venda 296`
            };
        });

        console.log("Realizando upsert no Salesforce...");
        const result = await conn.sobject('ParcelaFinanceira__c').upsert(installmentsToUpsert, 'IDContaAzul__c');
        console.log("Resultado Upsert:", JSON.stringify(result, null, 2));

        console.log("\n✅ Sincronização da Venda 296 concluída!");
    } catch (e) {
        console.error("❌ ERRO:", e.response ? e.response.data : e.message);
    }
}

debugSale296();
