require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');
const { getValidToken } = require('../src/services/contaAzulAuth');
const axios = require('axios');

const CA_API_URL = 'https://api-v2.contaazul.com/v1';
const SALE_ID_CA = 'c5029f80-3268-4603-a42e-c584de8b4e20'; // Venda 296

async function testSync296() {
    try {
        const token = await getValidToken();
        const conn = await getSfConnection();
        console.log("🚀 INICIANDO TESTE CIRÚRGICO - VENDA 296");

        // 1. Estado Atual no SF
        const currentSf = await conn.query(`SELECT Id, IDContaAzul__c, Status__c, Valor__c, Name FROM ParcelaFinanceira__c WHERE VendaContaAzul__r.IDContaAzul__c = '${SALE_ID_CA}'`);
        console.log(`\n📊 Estado Atual no Salesforce (${currentSf.records.length} parcelas):`);
        currentSf.records.forEach(p => console.log(`   - ${p.Name} | ID CA: ${p.IDContaAzul__c} | Status: ${p.Status__c} | Valor: ${p.Valor__c}`));

        // 2. Buscar no Conta Azul
        console.log(`\n☁️ Buscando dados no Conta Azul...`);
        const saleDetail = await axios.get(`${CA_API_URL}/venda/${SALE_ID_CA}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const eventId = saleDetail.data.evento_financeiro.id;
        const serviceId = (await conn.query(`SELECT Servico__c FROM VendaServico__c WHERE Venda__r.IDContaAzul__c = '${SALE_ID_CA}' LIMIT 1`)).records[0].Servico__c;

        const response = await axios.get(`${CA_API_URL}/financeiro/eventos-financeiros/${eventId}/parcelas`, { headers: { 'Authorization': `Bearer ${token}` } });
        const caParcelas = response.data || [];

        const updates = caParcelas.map(p => {
            let finalValue = (p.valor_composicao ? p.valor_composicao.valor_liquido : p.valor) || 0;
            if (p.baixas && p.baixas.length > 0) {
                finalValue = p.baixas.reduce((sum, b) => sum + ((b.valor_composicao ? b.valor_composicao.valor_liquido : b.valor_pago) || 0), 0);
            }
            return {
                IDContaAzul__c: p.id,
                VendaContaAzul__r: { IDContaAzul__c: SALE_ID_CA },
                Servico__c: serviceId,
                Valor__c: finalValue,
                DataVencimento__c: p.data_vencimento,
                Status__c: p.status,
                Descricao__c: p.descricao || `Venda 296`
            };
        });

        // 3. Executar Upsert
        console.log(`\n💾 Executando upsert de ${updates.length} parcelas...`);
        const results = await conn.sobject('ParcelaFinanceira__c').upsert(updates, 'IDContaAzul__c');

        results.forEach((res, i) => {
            if (res.success) {
                console.log(`   ✅ Parcela ${i+1}: Sucesso! (Status Enviado: ${updates[i].Status__c} | Valor: ${updates[i].Valor__c})`);
            } else {
                console.log(`   ❌ Parcela ${i+1}: ERRO - ${JSON.stringify(res.errors)}`);
            }
        });

        // 4. Verificação Final no SF
        const finalSf = await conn.query(`SELECT Id, IDContaAzul__c, Status__c, Valor__c, Name FROM ParcelaFinanceira__c WHERE VendaContaAzul__r.IDContaAzul__c = '${SALE_ID_CA}'`);
        console.log(`\n📉 Estado Final no Salesforce:`);
        finalSf.records.forEach(p => console.log(`   - ${p.Name} | Status: ${p.Status__c} | Valor: ${p.Valor__c}`));

    } catch (e) {
        console.error("\n❌ FALHA NO SCRIPT:", e.message);
    }
}

testSync296();
