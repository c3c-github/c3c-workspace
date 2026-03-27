require('dotenv').config();
const contaAzulService = require('../src/services/contaAzulService');

async function debug302() {
    const saleId = '2857b90e-1081-4be0-aa25-c9d9be832c66'; // Venda 302
    console.log(`--- DEBUG PARCELAS VENDA 302 (CONTA AZUL) ---`);

    try {
        const installments = await contaAzulService.getSaleInstallments(saleId);
        console.log(`Encontradas ${installments.length} parcelas na API:`);
        
        installments.forEach((inst, i) => {
            console.log(`\nParcela #${i + 1}:`);
            console.log(`   - Descrição: ${inst.desc}`);
            console.log(`   - Data: ${inst.date}`);
            console.log(`   - Valor: ${inst.value}`);
            console.log(`   - Status Original CA: ${inst.status}`);
            console.log(`   - ID Evento Financeiro: ${inst.financialEventId}`);
        });

    } catch (error) {
        console.error("ERRO:", error);
    }
}

debug302();